const { signupOptions } = require('../services/whatsappSignupFlow');
exports.getSignupHtml = ({appId,configId,version,nonce}) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect WhatsApp · MarketingKart</title><style nonce="${nonce}">body{font:16px system-ui;background:#f0fdf4;color:#123;max-width:480px;margin:40px auto;padding:24px}button{font:inherit;padding:14px;box-sizing:border-box;width:100%;margin:10px 0;border-radius:12px;border:1px solid #ccc}button{background:#087d55;color:white}button:disabled{opacity:.5}#status{white-space:pre-wrap}small{display:block;color:#456}a{color:#087d55}</style></head><body><h1>New / Migrate Number</h1><p>Choose your business portfolio, create or select a WhatsApp Business Account, then add your number and verify it by SMS or phone call in Meta.</p><small>For a new number, it must not already be registered in WhatsApp Messenger or the WhatsApp Business mobile app. If you want to keep using the Business app, return and choose Connect WhatsApp Business App. An existing API number needs a supported provider migration. Do not delete or disconnect an existing account to try this flow.</small><button id="connect" disabled>Continue with Meta</button><p id="status">Loading Meta…</p><a href="myapp://whatsapp-connected">Return to MarketingKart</a><script nonce="${nonce}">
const state = location.hash.slice(1);
history.replaceState(null,'',location.pathname);
let code, selection, sending=false;
const statusEl=document.getElementById('status'), button=document.getElementById('connect');
function status(text){statusEl.textContent=text;}
async function finish(){
 if(!code || !selection || sending)return;
 sending=true;button.disabled=true;status('Verifying your selected number…');
 try{
  const response=await fetch('/api/whatsapp/meta/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,code,wabaId:selection.waba_id,phoneNumberId:selection.phone_number_id})});
  const result=await response.json();code=null;
  if(!response.ok || !result.success)throw new Error(result.message || 'Connection failed. Return to the app and retry.');
  status('Your WhatsApp number is connected. Return to MarketingKart.');
  location.href='myapp://whatsapp-connected';
 }catch(error){status(error.message+' Return to the app and start a new connection.');}
}
window.addEventListener('message',event=>{
 if(!['https://www.facebook.com','https://web.facebook.com'].includes(event.origin))return;
 let data;try{data=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
 if(data?.type!=='WA_EMBEDDED_SIGNUP')return;
 if(data.event==='FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'){
  code=null;selection=null;status('This number uses the WhatsApp Business app. Return to MarketingKart and choose Connect WhatsApp Business App.');return;
 }
 if(data.event==='FINISH'){
  selection=data.data;finish();
 }else if(data.event==='CANCEL' || data.event==='ERROR'){status('Signup was not completed. You can try again.');button.disabled=false;}
});
window.fbAsyncInit=function(){
 FB.init({appId:${JSON.stringify(appId)},version:${JSON.stringify(version)},cookie:true,xfbml:false});
 if(!/^[a-f0-9]{64}$/.test(state)){status('Open this page using Connect WhatsApp inside MarketingKart.');return;}
 button.disabled=false;status('Ready. Your Facebook password and SMS OTP are entered only on Meta.');
};
button.onclick=function(){
 code=null;selection=null;sending=false;button.disabled=true;status('Complete the steps in the Meta window.');
 FB.login(response=>{
  if(response.authResponse?.code){code=response.authResponse.code;finish();}
  else{status('Signup cancelled. You can try again.');button.disabled=false;}
 },${JSON.stringify(signupOptions(configId, 'NEW_OR_MIGRATE'))});
};
setTimeout(()=>{if(typeof FB==='undefined')status('Meta could not load. Check your connection and reopen signup from the app.');},15000);
</script><script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script></body></html>`;
