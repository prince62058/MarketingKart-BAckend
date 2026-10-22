// Facebook SDK login for people who already have an active WhatsApp Business API number.
const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.clientId='app-test';process.env.clientSecret='secret-test';process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY='ab'.repeat(32);
const {discoverFacebookAccounts,connectFacebookAccount}=require('../src/services/whatsappSignupService');
const grant={is_valid:true,app_id:'app-test',scopes:['whatsapp_business_management','whatsapp_business_messaging'],granular_scopes:[{scope:'whatsapp_business_management',target_ids:['123456']}]};
const sdkToken='sdk-token-'.repeat(4);
const longToken='long-lived-token-'.repeat(3);
const input={userId:'tenant-a',accessToken:sdkToken,wabaId:'123456',phoneNumberId:'987654'};
function mocks(overrides={}){
 const calls=[];
 const phone={id:'987654',display_phone_number:'+910000000000',verified_name:'Shop',status:'CONNECTED',platform_type:'CLOUD_API',is_on_biz_app:false,code_verification_status:'VERIFIED',...overrides.phone};
 return {calls,api:{get:async(url,opts)=>{
  calls.push(['get',url,opts]);
  if(url.endsWith('/oauth/access_token')){if(overrides.noExchange)return {data:{}};return {data:{access_token:longToken}};}
  if(url.endsWith('/debug_token'))return {data:{data:overrides.grant||grant}};
  if(url.endsWith('/phone_numbers'))return {data:{data:overrides.phones||[phone]}};
  return {data:{id:'123456',name:'Shop WABA'}};
 },post:async(url,body,opts)=>{calls.push(['post',url,body,opts]);return {data:{success:!overrides.postFailure}};}},
 Account:{findOne:async()=>overrides.existing||null,findOneAndUpdate:async(query,update)=>{calls.push(['save',query,update]);return update.$set;}},
 Claim:{findOneAndUpdate:async()=>({userId:overrides.claimUser||'tenant-a'})}};
}
const writes=deps=>deps.calls.filter(c=>c[0]==='post'||c[0]==='save');

test('discovery lists only the accounts the token was granted, and marks which numbers can be used',async()=>{
 const deps=mocks({phones:[
  {id:'1',display_phone_number:'+911',status:'CONNECTED'},
  {id:'2',display_phone_number:'+912',status:'PENDING'},
  {id:'3',display_phone_number:'+913',status:'CONNECTED',is_on_biz_app:true},
 ]});
 const accounts=await discoverFacebookAccounts({accessToken:sdkToken},deps);
 assert.equal(accounts.length,1);
 assert.equal(accounts[0].wabaId,'123456');
 assert.deepEqual(accounts[0].phones.map(p=>p.eligible),[true,false,false]);
 assert.match(accounts[0].phones[1].reason,/not active/);
 assert.match(accounts[0].phones[2].reason,/Business app/);
 assert.equal(writes(deps).length,0,'discovery never writes anything');
 assert.ok(deps.calls.filter(c=>c[1].endsWith('/phone_numbers')).every(c=>c[2].headers.Authorization===`Bearer ${sdkToken}`));
});

test('a foreign app, missing permission or expired token is refused before any account is read',async()=>{
 for(const data of [{...grant,app_id:'other'},{...grant,is_valid:false},{...grant,scopes:['whatsapp_business_messaging']},{...grant,expires_at:1}]){
  const deps=mocks({grant:data});
  await assert.rejects(discoverFacebookAccounts({accessToken:sdkToken},deps));
  assert.equal(deps.calls.filter(c=>c[1].endsWith('/phone_numbers')).length,0);
 }
 await assert.rejects(discoverFacebookAccounts({accessToken:'short'},mocks()),/Sign in with Facebook again/);
});

test('connecting stores a long-lived token for the chosen number and subscribes before saving',async()=>{
 const deps=mocks();
 const account=await connectFacebookAccount(input,deps);
 const done=writes(deps);
 assert.ok(done[0][1].endsWith('/123456/subscribed_apps'));
 assert.equal(done[0][3].headers.Authorization,`Bearer ${longToken}`);
 assert.equal(done[1][2].$set.accessToken,longToken);
 assert.equal(done[1][2].$set.phoneNumberId,'987654');
 assert.equal(done[1][2].$set.connectedVia,'FACEBOOK');
 assert.equal(account.status,'CONNECTED');
 assert.ok(!done.some(c=>c[1]&&String(c[1]).endsWith('/register')),'an existing number is never re-registered');
});

test('numbers that are not active, in the Business app, or someone else\'s cannot be connected',async()=>{
 const bad=[
  [{phone:{status:'PENDING'}},/not active/],
  [{phone:{is_on_biz_app:true}},/Business app/],
  [{phones:[{id:'111111'}]},/does not belong/],
  [{existing:{userId:'tenant-b'}},/already linked/],
  [{claimUser:'tenant-b'}],
  [{noExchange:true},/did not authorize/],
  [{grant:{...grant,granular_scopes:[]}},/not shared/],
 ];
 for(const [opts,message] of bad){
  const deps=mocks(opts);
  await assert.rejects(connectFacebookAccount(input,deps),message||/./,JSON.stringify(opts));
  assert.equal(writes(deps).length,0,`no Meta or database writes for ${JSON.stringify(opts)}`);
 }
 await assert.rejects(connectFacebookAccount({...input,phoneNumberId:'abc'},mocks()),/Select a WhatsApp number/);
});
