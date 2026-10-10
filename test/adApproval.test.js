// Run only against an isolated local replica set. Never reads the application .env.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const Campaign = require('../src/models/internalCampiagnModel');
const User = require('../src/models/userModel');
const Business = require('../src/models/businessModel');
const Transaction = require('../src/models/transtionModel');
const AdType = require('../src/models/advertisementModel');
const Company = require('../src/models/commpanyModelV2');
const service = require('../src/services/adApprovalService');
let controller, owner, business, adType;
let metaCalls = 0;
let allowMetaBuild = false;
const buildRequests = [];
const response = () => ({ code: 200, status(n) { this.code=n; return this; }, json(b) { this.body=b; return this; } });
before(async () => {
  const uri = process.env.AD_APPROVAL_TEST_URI;
  if (!/^mongodb:\/\/127\.0\.0\.1:27187\/codex_ad_approval_test(?:\?|$)/.test(uri || '')) throw new Error('Explicit isolated local AD_APPROVAL_TEST_URI required');
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([Campaign.init(), User.init(), Transaction.init(), Business.init(), AdType.init(), Company.init()]);
  owner = await User.create({ name: 'Approval test', wallet: 100000 });
  business = await Business.create({ userId: owner._id, businessName: 'Test only', pageName: 'Test Page', pageId: 'test-page', pageAccessToken: 'test-token' });
  adType = await AdType.create({ advertisementType: 'LEADS' });
  const file = path.resolve(__dirname, '../src/controllers/adsDetailsController.js');
  const realRequire = createRequire(file);
  const mocks = {
    axios: { get: async () => { metaCalls++; throw new Error('Unexpected Meta request before approval'); }, post: async (url, payload) => { metaCalls++; if (!allowMetaBuild) throw new Error('Unexpected Meta request before approval'); buildRequests.push({url,payload}); return {data:{id:`test-${url.split('/').pop()}`}}; } },
    './invoiceController': { generateInvoice: async () => {} },
    './notificationController': { sendNotificationToMultipleTokens: async () => {} },
    '../helpers/appNotificationHelper': {}, '../utils/bucketHelper': {},
    './transtionController': { createTransaction: async (doc, session) => (await Transaction.create([doc], { session }))[0]._id },
  };
  const ctx = { __filename: file, __dirname: path.dirname(file), exports: {}, require: name => mocks[name] || realRequire(name), process: { env: {adAccountId:"test-account"} }, console: { log(){},info(){},warn(){},error(){} }, Buffer, URLSearchParams, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\naddCreativeImg = async () => ({id: \"test-creative\"}); getFormId = async () => ({leadFormId: \"test-form\"});', ctx, { filename: file });
  controller = ctx.exports;
});
after(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
function payload(key, overrides={}) {
  return { businessId: String(business._id), name: 'Approval test', addTypeId: String(adType._id), transactionId: key,
    facebookBudget: 1000, instaBudget: 0, isFacebookAdEnabled: true, interest: '[{"id":"1","name":"test"}]',
    location: '{"countries":["IN"]}', startDate: Math.floor(Date.now()/1000), endDate: Math.floor(Date.now()/1000)+86400,
    imageVideo: ['https://example.com/test.jpg'], type: 'SingleImage', ...overrides };
}
async function submit(key, overrides={}) { const res=response(); await controller.createAdSetDefineBudgetAndDuration({ user: owner, body: payload(key,overrides) },res); return res; }
test('payment persists pending approval, debits once and makes zero Meta requests', async () => {
  const before = (await User.findById(owner._id)).wallet;
  const result=await submit('wallet_once'); assert.equal(result.code,201,JSON.stringify(result.body));
  const c=await Campaign.findById(result.body.data.campaignId);
  assert.equal(c.approvalStatus,'PENDING'); assert.equal(c.status,'PENDING_APPROVAL'); assert.equal(c.mainAdId,undefined);
  assert.equal((await User.findById(owner._id)).wallet,before-c.chargedAmount);
  const repeat=await submit('wallet_once'); assert.equal(repeat.code,200);
  assert.equal(await Transaction.countDocuments({ adsId:c._id,type:'DEBIT' }),1);
  assert.equal((await User.findById(owner._id)).wallet,before-c.chargedAmount); assert.equal(metaCalls,0);
});
test('rejection refunds full debit once even for concurrent requests; closed reference cannot be reused',async()=>{
  const r=await submit('wallet_reject'); assert.equal(r.code,201);
  const c=await Campaign.findById(r.body.data.campaignId);const before=(await User.findById(owner._id)).wallet;
  const outcomes=await Promise.allSettled([service.rejectCampaign(c._id,owner._id,'Incorrect creative'),service.rejectCampaign(c._id,owner._id,'Duplicate rejection')]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await User.findById(owner._id)).wallet,before+c.chargedAmount);
  assert.equal(await Transaction.countDocuments({adsId:c._id,type:'CREDIT'}),1);
  assert.equal((await Campaign.findById(c._id)).status,'ADMIN_REJECTED');
  assert.equal((await submit('wallet_reject')).code,400);
  await assert.rejects(service.approveCampaign(c._id,owner._id));
});
test('approve and reject race has exactly one winner and consistent funds',async()=>{
  const r=await submit('wallet_race');const id=r.body.data.campaignId;const before=(await User.findById(owner._id)).wallet;
  const outcomes=await Promise.allSettled([service.approveCampaign(id,owner._id),service.rejectCampaign(id,owner._id,'Not suitable')]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const c=await Campaign.findById(id);assert.equal((await User.findById(owner._id)).wallet,before+(c.approvalStatus==='REJECTED'?c.chargedAmount:0));
  assert.equal(metaCalls,0);
});
test('insufficient wallet rolls back the campaign and ledger',async()=>{
  const count=await Campaign.countDocuments();const ledger=await Transaction.countDocuments();
  const r=await submit('wallet_insufficient',{facebookBudget:1e9});assert.equal(r.code,400);
  assert.equal(await Campaign.countDocuments(),count);assert.equal(await Transaction.countDocuments(),ledger);
});
test('payment credit belonging to a different user cannot fund a request',async()=>{
  await Transaction.create({userId:new mongoose.Types.ObjectId(),type:'CREDIT',transactionId:'pay_foreign',amount:10000});
  assert.equal((await submit('pay_foreign')).code,400);assert.equal(await Campaign.countDocuments({submissionKey:'pay_foreign'}),0);
});
test('concurrent duplicate submission never double-debits',async()=>{
  const before=(await User.findById(owner._id)).wallet;
  const results=await Promise.all([submit('wallet_parallel'),submit('wallet_parallel')]);
  assert.ok(results.some(r=>r.code===201));const c=await Campaign.findOne({submissionKey:'wallet_parallel'});
  assert.equal(await Campaign.countDocuments({submissionKey:'wallet_parallel'}),1);
  assert.equal((await User.findById(owner._id)).wallet,before-c.chargedAmount);
});
test('approval queues delivery without another charge and shifts the full paid duration',async()=>{
  const r=await submit('wallet_approve',{startDate:1000,endDate:87400});const before=(await User.findById(owner._id)).wallet;
  await service.approveCampaign(r.body.data.campaignId,owner._id);const c=await Campaign.findById(r.body.data.campaignId).select('+submissionPayload');
  assert.equal(c.deliveryJobState,'QUEUED');assert.equal(c.approvalStatus,'APPROVED');
  assert.ok(c.submissionPayload.startDate>Date.now()/1000);assert.equal(c.submissionPayload.endDate-c.submissionPayload.startDate,86400);
  assert.equal((await User.findById(owner._id)).wallet,before);await assert.rejects(service.approveCampaign(c._id,owner._id));
});
test('delivery rejects unapproved requests and changed Page before any external action',async()=>{
  const calls=[];const deps={api:{post:async(...a)=>calls.push(a)},models:{Business:{findById:()=>({lean:async()=>({pageId:'other'})})}},build:async()=>calls.push('build')};
  await assert.rejects(service.deliverCampaign({approvalStatus:'PENDING'},deps),/approval/);
  await assert.rejects(service.deliverCampaign({approvalStatus:'APPROVED',paymentStatus:'APPROVED',submissionPageId:'old'},deps),/Page changed/);
  assert.equal(calls.length,0);
});
test('Meta objects activate child first and campaign last; no DONE marker on funding failure',async()=>{
  const calls=[];const c={_id:'c',approvalStatus:'APPROVED',paymentStatus:'APPROVED',submissionPageId:'page',mainAdId:'ad',facebookAdSetId:'adset',externalCampiagnId:'ext',location:{countries:['IN']}};
  const deps={api:{get:async()=>({data:{targeting:{geo_locations:{countries:['IN']}}}}),post:async url=>calls.push(url.split('/').pop())},build:async()=>assert.fail('must reuse objects'),models:{Business:{findById:()=>({lean:async()=>({pageId:'page'})})},External:{findById:async()=>({meta_CampaignId:'campaign'})},Campaign:{updateOne:async(_,patch)=>{if(patch.$set.deliveryJobState==='DONE')calls.push('DONE')}}}};
  await service.deliverCampaign(c,deps);assert.deepEqual(calls,['ad','adset','campaign','DONE']);
  calls.length=0;deps.api.post=async()=>{throw new Error('Insufficient funds')};await assert.rejects(service.deliverCampaign(c,deps));assert.equal(calls.length,0);
});

test('approved builder creates only paused Meta objects and never charges a second time',async()=>{
  const c=await Campaign.findOne({submissionKey:'wallet_approve'}).select('+submissionPayload');
  const before=(await User.findById(owner._id)).wallet;const ledger=await Transaction.countDocuments({type:'DEBIT'});
  allowMetaBuild=true;
  try { await controller.buildApprovedCampaign(c._id,c.submissionPayload); } finally { allowMetaBuild=false; }
  assert.equal((await User.findById(owner._id)).wallet,before);assert.equal(await Transaction.countDocuments({type:'DEBIT'}),ledger);
  assert.deepEqual(buildRequests.map(x=>x.payload.status),['PAUSED','PAUSED','PAUSED']);
  const saved=await Campaign.findById(c._id);assert.equal(saved.mainAdId,'test-ads');assert.equal(saved.facebookAdSetId,'test-adsets');assert.equal(saved.approvalStatus,'APPROVED');
});
test('billing retry shifts paused delivery dates but does not extend a campaign already active',async()=>{
  const c={_id:'c',approvalStatus:'APPROVED',paymentStatus:'APPROVED',submissionPageId:'page',mainAdId:'ad',facebookAdSetId:'adset',externalCampiagnId:'ext',location:{countries:['IN']},totalBudget:1000,submissionPayload:{startDate:1000,endDate:87400}};
  let parentStatus='PAUSED';const calls=[];
  const deps={api:{get:async()=>({data:{status:parentStatus,targeting:{geo_locations:{countries:['IN']}}}}),post:async(url,payload)=>calls.push({url,payload})},models:{Business:{findById:()=>({lean:async()=>({pageId:'page'})})},External:{findById:async()=>({meta_CampaignId:'campaign'})},Campaign:{updateOne:async()=>{}}}};
  await service.deliverCampaign(c,deps);
  const schedule=calls.find(x=>x.payload.start_time).payload;
  assert.equal((Date.parse(schedule.end_time)-Date.parse(schedule.start_time))/1000,86400);
  assert.ok(Date.parse(schedule.start_time)>Date.now());assert.equal(calls.find(x=>x.payload.spend_cap).payload.spend_cap,100000);
  parentStatus='ACTIVE';calls.length=0;await service.deliverCampaign(c,deps);
  assert.equal(calls.some(x=>x.payload.start_time),false);
});
test('normal users cannot call admin approval and pending delivery controls are blocked',async()=>{
  const {isAdmin}=require('../src/middlewares/authMidd');const res=response();let next=false;
  isAdmin({user:owner},res,()=>{next=true});assert.equal(next,false);assert.equal(res.code,401);
  const {requireDeliveryAccess}=require('../src/middlewares/adCampaignAccess');
  const c=await Campaign.findOne({submissionKey:'wallet_once'});const gate=response();
  await requireDeliveryAccess({body:{internalCampaignId:c._id},user:owner},gate,()=>{next=true});assert.equal(gate.code,409);assert.equal(next,false);
});
test('Meta city/state/PIN selection is saved and sent to ad set unchanged',async()=>{
  const location={cities:[{key:'1019761',radius:0,distance_unit:'kilometer'}],regions:[{key:'1753'}],zips:[{key:'IN:462023'}]};
  const r=await submit('wallet_meta_keys',{location:JSON.stringify(location),targetArea:'Bhopal (City only) + Madhya Pradesh + 462023'});assert.equal(r.code,201);
  let c=await Campaign.findById(r.body.data.campaignId);assert.deepEqual(c.location,location);assert.match(c.targetArea,/Bhopal/);
  await service.approveCampaign(c._id,owner._id);c=await Campaign.findById(c._id).select('+submissionPayload');
  buildRequests.length=0;allowMetaBuild=true;
  try{await controller.buildApprovedCampaign(c._id,c.submissionPayload)}finally{allowMetaBuild=false}
  assert.deepEqual(JSON.parse(JSON.stringify(buildRequests.find(x=>x.url.endsWith('/adsets')).payload.targeting.geo_locations)),location);
});
