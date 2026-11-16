// Facebook SDK login for people who already have an active WhatsApp Business API number.
const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.clientId='app-test';process.env.clientSecret='secret-test';process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY='ab'.repeat(32);
const {discoverFacebookAccounts,connectFacebookAccount,allowConversionEvents}=require('../src/services/whatsappSignupService');
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
 Account:(()=>{
  const row=()=>overrides.previous||overrides.existing||null;
  const chain=()=>{const c={select(){return c;},lean:async()=>row(),then(resolve,reject){return Promise.resolve(row()).then(resolve,reject);}};return c;};
  return {findOne:()=>chain(),findOneAndUpdate:async(query,update)=>{calls.push(['save',query,update]);return overrides.saveMiss?null:update.$set;}};
 })(),
 Claim:{findOneAndUpdate:async()=>({userId:overrides.claimUser||'tenant-a'})}};
}
const writes=deps=>deps.calls.filter(c=>c[0]==='post'||c[0]==='save');

test('discovery lists only the accounts the token was granted, and marks which numbers can be used',async()=>{
 const deps=mocks({phones:[
  {id:'1',display_phone_number:'+911',status:'CONNECTED',platform_type:'CLOUD_API'},
  {id:'2',display_phone_number:'+912',status:'PENDING',platform_type:'CLOUD_API'},
  // Coexistence Cloud API number — reconnect via Existing API (do not force Add-number).
  {id:'3',display_phone_number:'+913',status:'CONNECTED',platform_type:'CLOUD_API',is_on_biz_app:true},
  {id:'4',display_phone_number:'+914',status:'CONNECTED',platform_type:'ON_PREMISE',is_on_biz_app:true},
 ]});
 const accounts=await discoverFacebookAccounts({accessToken:sdkToken},deps);
 assert.equal(accounts.length,1);
 assert.equal(accounts[0].wabaId,'123456');
 assert.deepEqual(accounts[0].phones.map(p=>p.eligible),[true,false,true,false]);
 assert.match(accounts[0].phones[1].reason,/not active/);
 assert.match(accounts[0].phones[3].reason,/Cloud API|Business app/);
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

test('numbers that are not active, not on Cloud API, or someone else\'s cannot be connected',async()=>{
 const bad=[
  [{phone:{status:'PENDING'}},/not active/],
  [{phone:{is_on_biz_app:true,platform_type:'ON_PREMISE'}},/Cloud API|Business app/],
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

test('coexistence Cloud API numbers reconnect via Existing API without re-registering',async()=>{
 const deps=mocks({phone:{is_on_biz_app:true,platform_type:'CLOUD_API',status:'CONNECTED'}});
 const account=await connectFacebookAccount(input,deps);
 assert.equal(account.status,'CONNECTED');
 assert.equal(account.onboardingMode,'BUSINESS_APP');
 assert.ok(!writes(deps).some(c=>c[1]&&String(c[1]).endsWith('/register')));
});

// "Allow" step for ad lead/sale events (whatsapp_business_manage_events) on an Existing API number.
const eventsGrant={...grant,scopes:[...grant.scopes,'whatsapp_business_manage_events']};
const sdkAccount={_id:'account-1',userId:'tenant-a',wabaId:'123456',connectedVia:'FACEBOOK',status:'CONNECTED'};
const allow=deps=>allowConversionEvents({userId:'tenant-a',accessToken:sdkToken},deps);
const saves=deps=>deps.calls.filter(c=>c[0]==='save');

test('allowing ad events swaps the stored token of an Existing API number for a long-lived one with the permission',async()=>{
 const deps=mocks({grant:{...eventsGrant,expires_at:Math.floor(Date.now()/1000)+86400},existing:sdkAccount});
 const result=await allow(deps);
 assert.equal(saves(deps).length,1);
 const [,filter,update]=saves(deps)[0];
 assert.deepEqual(filter,{_id:'account-1',userId:'tenant-a',status:'CONNECTED',connectedVia:'FACEBOOK',wabaId:'123456'});
 assert.deepEqual(Object.keys(update.$set).sort(),['accessToken','tokenExpiresAt'],'only the token changes');
 assert.equal(update.$set.accessToken,longToken);
 assert.ok(update.$set.tokenExpiresAt instanceof Date);
 assert.ok(deps.calls.some(c=>c[1].endsWith('/oauth/access_token')&&c[2].params.fb_exchange_token===sdkToken));
 assert.equal(result.wabaId,'123456');
 assert.ok(!JSON.stringify(result).includes(longToken),'the token never goes back to the app');
 assert.equal(deps.calls.filter(c=>c[0]==='post').length,0,'the number is not re-subscribed or re-registered');
});

test('allowing ad events is refused without the permission, for another account, or for an Embedded Signup number',async()=>{
 const otherWaba={...eventsGrant,granular_scopes:[...grant.granular_scopes,{scope:'whatsapp_business_manage_events',target_ids:['999999']}]};
 const cases=[
  [{grant,existing:sdkAccount},'EVENTS_PERMISSION_DECLINED',400],
  [{grant:otherWaba,existing:sdkAccount},'EVENTS_PERMISSION_DECLINED',400],
  [{grant:eventsGrant,existing:{...sdkAccount,connectedVia:'EMBEDDED_SIGNUP'}},'RECONNECT_REQUIRED',409],
  [{grant:eventsGrant},'WHATSAPP_NOT_CONNECTED',404],
 ];
 for(const [opts,reason,status] of cases){
  const deps=mocks(opts);
  await assert.rejects(allow(deps),error=>error.reason===reason&&error.httpStatus===status,reason);
  assert.equal(saves(deps).length,0,`nothing is saved for ${reason}`);
 }
 // A token that cannot manage the connected WABA is refused like any other foreign grant.
 const foreign=mocks({grant:{...eventsGrant,granular_scopes:[{scope:'whatsapp_business_management',target_ids:['555555']}]},existing:sdkAccount});
 await assert.rejects(allow(foreign),/not shared/);
 assert.equal(saves(foreign).length,0);
 // A reconnect between the lookup and the save wins: the update matches nothing and the caller is told.
 await assert.rejects(allow(mocks({grant:eventsGrant,existing:sdkAccount,saveMiss:true})),error=>error.reason==='WHATSAPP_CHANGED');
});
