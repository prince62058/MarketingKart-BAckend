exports.getSignupHtml = ({appId,configId,version,nonce}) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect WhatsApp · MarketingKart</title><style nonce="${nonce}">body{font:16px system-ui;background:#f0fdf4;color:#123;max-width:480px;margin:40px auto;padding:24px}button,input{font:inherit;padding:14px;box-sizing:border-box;width:100%;margin:10px 0;border-radius:12px;border:1px solid #ccc}button{background:#087d55;color:white}button:disabled{opacity:.5}#status{white-space:pre-wrap}small{display:block;color:#456}a{color:#087d55}</style></head><body><h1>Connect your WhatsApp Business number</h1><p>Choose your own business and phone number in Meta. Meta may ask you to verify the number by SMS or call.</p><small>Your existing WhatsApp Business app can stay active only if Meta offers the compatible onboarding option for your number. Do not delete your WhatsApp account to continue.</small><label for="pin">Two-step verification PIN (only for a number that needs Cloud API registration)</label><input id="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="6 digits — not the SMS OTP"><small>If registration is needed, use your existing PIN or choose six digits and keep them safe.</small><button id="connect" disabled>Continue with Meta</button><p id="status">Loading Meta…</p><a href="myapp://whatsapp-connected">Return to MarketingKart</a><script nonce="${nonce}">
const state = location.hash.slice(1);
history.replaceState(null,'',location.pathname);
let code, selection, sending=false;
const statusEl=document.getElementById('status'), button=document.getElementById('connect');
function status(text){statusEl.textContent=text;}
async function finish(){
 if(!code || !selection || sending)return;
 sending=true;button.disabled=true;status('Verifying your selected number…');
 try{
  const response=await fetch('/api/whatsapp/meta/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,code,wabaId:selection.waba_id,phoneNumberId:selection.phone_number_id,pin:document.getElementById('pin').value})});
  const result=await response.json();code=null;document.getElementById('pin').value='';
  if(!response.ok || !result.success)throw new Error(result.message || 'Connection failed. Return to the app and retry.');
  status('Your WhatsApp number is connected. Return to MarketingKart.');
  location.href='myapp://whatsapp-connected';
 }catch(error){status(error.message+' Return to the app and start a new connection.');}
}
window.addEventListener('message',event=>{
 if(!['https://www.facebook.com','https://web.facebook.com'].includes(event.origin))return;
 let data;try{data=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
 if(data?.type!=='WA_EMBEDDED_SIGNUP')return;
 if(['FINISH','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(data.event)){
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
 },{config_id:${JSON.stringify(configId)},response_type:'code',override_default_response_type:true,extras:{setup:{}}});
};
setTimeout(()=>{if(typeof FB==='undefined')status('Meta could not load. Check your connection and reopen signup from the app.');},15000);
</script><script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script></body></html>`;
