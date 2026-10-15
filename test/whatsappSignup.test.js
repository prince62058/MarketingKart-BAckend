const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.clientId='app-test';process.env.clientSecret='secret-test';process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY='ab'.repeat(32);
const {connectSignup,validateGrant}=require('../src/services/whatsappSignupService');
const grant={is_valid:true,app_id:'app-test',scopes:['whatsapp_business_management','whatsapp_business_messaging'],granular_scopes:[{scope:'whatsapp_business_management',target_ids:['123456']}]};
const input={userId:'tenant-a',code:'one-time-code',wabaId:'123456',phoneNumberId:'987654'};
test('new-number signup never registers a Business App number', async () => {
 const deps=mocks({phone:{status:'PENDING',is_on_biz_app:true}});
 await assert.rejects(connectSignup({...input,pin:'123456'},deps),/Business App/);
 assert.equal(deps.calls.filter(c=>c[0]==='post'||c[0]==='save').length,0);
});
test('coexistence requires a verified Business App Cloud API number', async () => {
 const deps=mocks();
 await assert.rejects(connectSignup({...input,mode:'BUSINESS_APP'},deps),/WhatsApp Business/);
 assert.equal(deps.calls.filter(c=>c[0]==='post').length,0);
});
test('number types are explicit and use distinct Meta options', () => {
 const {parseSignupMode,signupOptions}=require('../src/services/whatsappSignupFlow');
 assert.equal(parseSignupMode(),'NEW_OR_MIGRATE');
 assert.throws(()=>parseSignupMode('UNKNOWN'));
 assert.deepEqual(signupOptions('config','NEW_OR_MIGRATE').extras,{setup:{}});
 assert.equal(signupOptions('config','BUSINESS_APP').extras.featureType,'whatsapp_business_app_onboarding');
});
test('hosted signup handles either callback order and ignores foreign origins', async () => {
 const vm=require('node:vm');
 const {getSignupHtml}=require('../src/views/whatsappSignupPage');
 for(const eventFirst of [true,false]) {
  const html=getSignupHtml({appId:'app-test',configId:'config-test',version:'v22.0',nonce:'nonce'});
  const source=html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)[1];
  const elements={status:{},connect:{}};
  assert.doesNotMatch(html, /id="pin"|pin-toggle|pin-help/);
  const calls=[];let receive,login;
  const context={location:{hash:'#'+'ab'.repeat(32),pathname:'/api/whatsapp/meta/signup'},history:{replaceState(){}},document:{getElementById:id=>elements[id]},window:{addEventListener:(name,fn)=>{if(name==='message')receive=fn;}},FB:{init(){},login:fn=>{login=fn;}},setTimeout(){},fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({success:true})};}};
  vm.runInNewContext(source,context);context.window.fbAsyncInit();elements.connect.onclick();
  const event={origin:'https://www.facebook.com',data:{type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'123456',phone_number_id:'987654'}}};
  receive({...event,origin:'https://untrusted.example'});assert.equal(calls.length,0);
  if(eventFirst){receive(event);login({authResponse:{code:'code'}});}else{login({authResponse:{code:'code'}});receive(event);}
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);assert.equal(calls[0].phoneNumberId,'987654');assert.equal(calls[0].pin,undefined);
 }
});
function mocks(overrides={}){
 const calls=[];let registrationPinEncrypted;
 const phone={id:'987654',display_phone_number:'+910000000000',status:'CONNECTED',code_verification_status:'VERIFIED',...overrides.phone};
 return {calls,api:{get:async(url,opts)=>{
  calls.push(['get',url,opts]);
  if(url.endsWith('/oauth/access_token'))return {data:{access_token:'customer-token'}};
  if(url.endsWith('/debug_token'))return {data:{data:overrides.grant || grant}};
  return {data:{data:overrides.phones || [phone]}};
 },post:async(url,body,opts)=>{calls.push(['post',url,body,opts]);return {data:{success:!overrides.postFailure}};}},
 Account:{findOne:async()=>overrides.existing || null,findOneAndUpdate:async(query,update)=>{calls.push(['save',query,update]);return update.$set;}},
 Claim:{findOneAndUpdate:async()=>({userId:overrides.claimUser || 'tenant-a'}),
 updateOne:async(query,update)=>{calls.push(['storePin',query,update]);registrationPinEncrypted ??= update.$set.registrationPinEncrypted;},
 findOne:()=>({select:async()=>({registrationPinEncrypted})})}};
}
test('rejects foreign app, unshared WABA, missing permissions and expired grants',()=>{
 for(const data of [{...grant,app_id:'other'},{...grant,granular_scopes:[]},{...grant,scopes:[]},{...grant,expires_at:1}])assert.throws(()=>validateGrant(data,'app-test','123456'));
});
test('connects only the explicitly chosen number using the customer token and subscribes before saving',async()=>{
 const deps=mocks();await connectSignup(input,deps);
 const writes=deps.calls.filter(c=>['post','save'].includes(c[0]));
 assert.ok(writes[0][1].endsWith('/123456/subscribed_apps'));
 assert.equal(writes[0][3].headers.Authorization,'Bearer customer-token');
 assert.equal(writes[1][2].$set.phoneNumberId,'987654');
 assert.equal(writes[1][2].$set.accessToken,'customer-token');
});
test('wrong phone, existing tenant and concurrent claim cannot connect or mutate Meta',async()=>{
 for(const opts of [{phones:[{id:'111111'}]},{existing:{userId:'tenant-b'}},{claimUser:'tenant-b'}]){
  const deps=mocks(opts);await assert.rejects(connectSignup(input,deps));
  assert.equal(deps.calls.filter(c=>c[0]==='post'||c[0]==='save').length,0);
 }
});
test('registration requires verified OTP and generates its PIN on the server',async()=>{
 const deps=mocks({phone:{status:'PENDING',code_verification_status:'NOT_VERIFIED'}});
 await assert.rejects(connectSignup(input,deps),/OTP/);
 assert.equal(deps.calls.filter(c=>['post','storePin'].includes(c[0])).length,0);
 const ready=mocks({phone:{status:'PENDING'}});await connectSignup(input,ready);
 const registration=ready.calls.find(c=>c[0]==='post');
 assert.ok(registration[1].endsWith('/987654/register'));
 assert.match(registration[2].pin,/^\d{6}$/);
 const stored=ready.calls.find(c=>c[0]==='storePin');
 assert.equal(stored[1].userId,'tenant-a');
 assert.deepEqual(stored[1].registrationPinEncrypted,{$exists:false});
 assert.match(stored[2].$set.registrationPinEncrypted,/^gcm1:/);
 assert.equal(require('../src/utils/cryptoUtils').decryptText(stored[2].$set.registrationPinEncrypted),registration[2].pin);
 const saved=ready.calls.find(c=>c[0]==='save')[2].$set;
 assert.equal(saved.pin,undefined);assert.equal(saved.registrationPinEncrypted,undefined);
});
test('registration retries reuse the encrypted PIN and never reset existing Meta protection',async()=>{
 const deps=mocks({phone:{status:'PENDING'}});const post=deps.api.post;let first=true;
 deps.api.post=async(...args)=>{const result=await post(...args);if(first){first=false;throw new Error('request timed out');}return result;};
 await assert.rejects(connectSignup(input,deps),/timed out/);
 await connectSignup(input,deps);
 const registrations=deps.calls.filter(c=>c[0]==='post'&&c[1].endsWith('/register'));
 assert.equal(registrations.length,2);assert.equal(registrations[0][2].pin,registrations[1][2].pin);
 const protectedNumber=mocks({phone:{status:'PENDING'}});
 protectedNumber.api.post=async()=>{throw {response:{data:{error:{code:133005}}}};};
 await assert.rejects(connectSignup(input,protectedNumber),/recovery.*WhatsApp Manager/);
 assert.equal(protectedNumber.calls.some(c=>c[0]==='save'),false);
 const Claim=require('../src/models/whatsappPhoneClaimModel');
 const row=new Claim({_id:'987654',userId:'507f1f77bcf86cd799439011',registrationPinEncrypted:'gcm1:test'});
 assert.equal(row.toJSON().registrationPinEncrypted,undefined);
 assert.equal(row.toObject().registrationPinEncrypted,undefined);
 assert.equal(Claim.schema.path('registrationPinEncrypted').options.select,false);
});
test('failed subscription does not save a falsely connected account',async()=>{
 const deps=mocks({postFailure:true});await assert.rejects(connectSignup(input,deps),/subscription/);
 assert.equal(deps.calls.filter(c=>c[0]==='save').length,0);
});
test('new tokens use authenticated encryption and are never serialized to JSON',()=>{
 const {encryptText,decryptText}=require('../src/utils/cryptoUtils');
 const encrypted=encryptText('sensitive-customer-token');assert.match(encrypted,/^gcm1:/);assert.equal(decryptText(encrypted),'sensitive-customer-token');
 const parts=encrypted.split(':');parts[3]=(parts[3].startsWith('00')?'01':'00')+parts[3].slice(2);assert.throws(()=>decryptText(parts.join(':')));
 const Account=require('../src/models/whatsappAccountModel');
 const account=new Account({userId:'507f1f77bcf86cd799439011',wabaId:'123456',phoneNumberId:'987654',accessToken:'sensitive-customer-token'});
 assert.equal(account.accessToken,'sensitive-customer-token');assert.equal(account.toJSON().accessToken,undefined);
});

test('ambiguous, disconnected and expired number mappings cannot send messages', async () => {
  const { assertUniquePhone } = require('../src/services/whatsappAccountIsolation');
  const model = rows => ({ find: () => ({ limit: async () => rows }) });
  await assert.rejects(assertUniquePhone('12345', model([])), /ambiguous/);
  await assert.rejects(assertUniquePhone('12345', model([{status:'CONNECTED'}, {status:'CONNECTED'}])), /ambiguous/);
  await assert.rejects(assertUniquePhone('12345', model([{status:'DISCONNECTED'}])), /disconnected/);
  await assert.rejects(assertUniquePhone('12345', model([{status:'CONNECTED',tokenExpiresAt:new Date(0)}])), /expired/);
  const account = {status:'CONNECTED',userId:'customer'};
  assert.equal(await assertUniquePhone('12345', model([account])), account);
});

test('Business App completion resolves the unique phone, skips register and starts contacts then history',async()=>{
 const deps=mocks({phone:{is_on_biz_app:true,platform_type:'CLOUD_API'}});
 const saves=[];
 deps.Account.findOneAndUpdate=async(q,u)=>{saves.push([q,u]);return {_id:'account',...u.$set};};
 deps.Account.updateOne=async()=>{};
 const original=deps.api.post;
 deps.api.post=async(...args)=>{const r=await original(...args);return args[0].endsWith('/smb_app_data')?{data:{request_id:'sync-'+args[1].sync_type}}:r;};
 await connectSignup({...input,phoneNumberId:undefined,mode:'BUSINESS_APP'},deps);
 assert.equal(deps.calls.some(c=>c[0]==='storePin'||c[1]?.endsWith('/register')),false);
 assert.deepEqual(deps.calls.filter(c=>c[1]?.endsWith('/smb_app_data')).map(c=>c[2].sync_type),['smb_app_state_sync','history']);
 assert.equal(saves[0][1].$set.onboardingMode,'BUSINESS_APP');
 assert.equal(saves[0][1].$set.phoneNumberId,'987654');
});
test('Business App phone discovery rejects ambiguous WABA numbers',async()=>{
 const deps=mocks({phones:[{id:'987654',is_on_biz_app:true,platform_type:'CLOUD_API'},{id:'987655',is_on_biz_app:true,platform_type:'CLOUD_API'}]});
 await assert.rejects(connectSignup({...input,phoneNumberId:undefined,mode:'BUSINESS_APP'},deps),/Selected number/);
 assert.equal(deps.calls.some(c=>c[0]==='post'),false);
});
test('Business App message mapping preserves historical time, direction and media placeholders',()=>{
 const {messageData}=require('../src/services/whatsappCoexistenceService');
 const out=messageData({from:'+919999999999',id:'a',timestamp:'1700000000',type:'text',text:{body:'hello'},history_context:{status:'READ'}},'918888888888','919999999999');
 assert.equal(out.direction,'OUTBOUND');assert.equal(out.status,'READ');assert.equal(out.createdAt.getTime(),1700000000000);
 const incoming=messageData({from:'918888888888',timestamp:'1700000000',type:'media_placeholder'},'918888888888','919999999999');
 assert.equal(incoming.direction,'INBOUND');assert.equal(incoming.type,'UNKNOWN');
});
test('Business App event accepts waba-only completion in either callback order',async()=>{
 const vm=require('node:vm'); const {getSignupHtml}=require('../src/views/whatsappSignupPage');
 for(const eventFirst of [true,false]){
  const source=getSignupHtml({appId:'app',configId:'config',version:'v22.0',nonce:'nonce'}).match(/<script nonce="nonce">([\s\S]*?)<\/script>/)[1];
  const elements={status:{},connect:{}};const calls=[];let receive,login,options;
  const context={location:{hash:'#'+'ab'.repeat(32)+'&mode=BUSINESS_APP',pathname:'/api/whatsapp/meta/signup'},history:{replaceState(){}},document:{getElementById:id=>elements[id],querySelector:()=>({})},window:{addEventListener:(_,fn)=>receive=fn},FB:{init(){},login:(fn,opts)=>{login=fn;options=opts;}},setTimeout(){},fetch:async(_,opts)=>{calls.push(JSON.parse(opts.body));return {ok:true,json:async()=>({success:true})};}};
  vm.runInNewContext(source,context);context.window.fbAsyncInit();elements.connect.onclick();
  const event={origin:'https://www.facebook.com',data:{type:'WA_EMBEDDED_SIGNUP',event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'123456'}}};
  if(eventFirst){receive(event);login({authResponse:{code:'code'}});}else{login({authResponse:{code:'code'}});receive(event);}
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.equal(calls[0].wabaId,'123456');
  assert.equal(options.extras.featureType,'whatsapp_business_app_onboarding');assert.equal(options.extras.sessionInfoVersion,undefined);
 }
});
test('signed coexistence events are persisted before acknowledgement and excluded from inbound processing',async()=>{
 const {capture}=require('../src/services/whatsappCoexistenceService');const Event=require('../src/models/whatsappCoexistenceEventModel');const original=Event.updateOne;
 const body={object:'whatsapp_business_account',entry:[{id:'123456',changes:[{field:'history',value:{messages:[{id:'media'}]}},{field:'messages',value:{messages:[{id:'incoming'}]}}]}]};
 const rawBody=Buffer.from(JSON.stringify(body));const signature='sha256='+require('crypto').createHmac('sha256',process.env.clientSecret).update(rawBody).digest('hex');
 let persisted=0,next=0,status;
 const req=()=>({body:JSON.parse(rawBody),rawBody,get:()=>signature});const res={sendStatus:n=>status=n};
 try{
  Event.updateOne=async()=>{persisted++;};const request=req();await capture(request,res,()=>{assert.equal(persisted,1);next++;});
  assert.equal(next,1);assert.equal(request.body.entry[0].changes.length,1);assert.equal(request.body.entry[0].changes[0].field,'messages');
  Event.updateOne=async()=>{throw new Error('database unavailable');};await capture(req(),res,()=>next++);assert.equal(status,503);assert.equal(next,1);
  await capture({...req(),get:()=> 'sha256=invalid'},res,()=>next++);assert.equal(status,403);assert.equal(next,1);
 }finally{Event.updateOne=original;}
});
