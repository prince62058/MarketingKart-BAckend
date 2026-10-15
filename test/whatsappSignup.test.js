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
test('coexistence cannot fall through to standard registration', async () => {
 const deps=mocks();
 await assert.rejects(connectSignup({...input,mode:'BUSINESS_APP'},deps),/coexistence/);
 assert.equal(deps.calls.length,0);
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
  const elements={status:{},connect:{},pin:{value:'123456'}};
  const calls=[];let receive,login;
  const context={location:{hash:'#'+'ab'.repeat(32),pathname:'/api/whatsapp/meta/signup'},history:{replaceState(){}},document:{getElementById:id=>elements[id]},window:{addEventListener:(_name,fn)=>{receive=fn;}},FB:{init(){},login:fn=>{login=fn;}},setTimeout(){},fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({success:true})};}};
  vm.runInNewContext(source,context);context.window.fbAsyncInit();elements.connect.onclick();
  const event={origin:'https://www.facebook.com',data:{type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'123456',phone_number_id:'987654'}}};
  receive({...event,origin:'https://untrusted.example'});assert.equal(calls.length,0);
  if(eventFirst){receive(event);login({authResponse:{code:'code'}});}else{login({authResponse:{code:'code'}});receive(event);}
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);assert.equal(calls[0].phoneNumberId,'987654');assert.equal(elements.pin.value,'');
 }
});
function mocks(overrides={}){
 const calls=[];
 const phone={id:'987654',display_phone_number:'+910000000000',status:'CONNECTED',code_verification_status:'VERIFIED',...overrides.phone};
 return {calls,api:{get:async(url,opts)=>{
  calls.push(['get',url,opts]);
  if(url.endsWith('/oauth/access_token'))return {data:{access_token:'customer-token'}};
  if(url.endsWith('/debug_token'))return {data:{data:overrides.grant || grant}};
  return {data:{data:overrides.phones || [phone]}};
 },post:async(url,body,opts)=>{calls.push(['post',url,body,opts]);return {data:{success:!overrides.postFailure}};}},
 Account:{findOne:async()=>overrides.existing || null,findOneAndUpdate:async(query,update)=>{calls.push(['save',query,update]);return update.$set;}},
 Claim:{findOneAndUpdate:async()=>({userId:overrides.claimUser || 'tenant-a'})}};
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
test('OTP verified is not connected: registration requires explicit PIN',async()=>{
 const deps=mocks({phone:{status:'PENDING'}});await assert.rejects(connectSignup(input,deps),/PIN/);
 assert.equal(deps.calls.filter(c=>c[0]==='post').length,0);
 const ready=mocks({phone:{status:'PENDING'}});await connectSignup({...input,pin:'123456'},ready);
 assert.ok(ready.calls.find(c=>c[0]==='post')[1].endsWith('/987654/register'));
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
