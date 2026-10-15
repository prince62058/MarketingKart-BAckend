const { signupOptions } = require('../services/whatsappSignupFlow');
exports.getSignupHtml = ({appId,configId,version,nonce}) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect WhatsApp · MarketingKart</title><style nonce="${nonce}">body{font:16px system-ui;background:#f0fdf4;color:#123;max-width:480px;margin:40px auto;padding:24px}button,input{font:inherit;padding:14px;box-sizing:border-box;width:100%;margin:10px 0;border-radius:12px;border:1px solid #ccc}button{background:#087d55;color:white}button:disabled{opacity:.5}#status{white-space:pre-wrap}small{display:block;color:#456}a{color:#087d55}.pin-field{position:relative;margin:10px 0}.pin-field input{margin:0;padding-right:64px}.pin-toggle{position:absolute;right:4px;top:4px;width:48px;height:44px;margin:0;padding:10px;background:transparent;border:0;color:#087d55;display:grid;place-items:center}.pin-toggle svg{width:24px;height:24px}.pin-toggle:focus-visible,summary:focus-visible{outline:2px solid #087d55;outline-offset:2px}label{display:block;margin-top:20px;font-weight:600}details{margin:16px 0;padding:14px;border:1px solid #b8d9c9;border-radius:12px;background:#fff}summary{cursor:pointer;color:#087d55;font-weight:600;min-height:24px}details p{font-size:14px;line-height:1.5}details a{display:block;margin-top:12px;font-weight:600;line-height:1.5}</style></head><body><h1>New / Migrate Number</h1><p>Choose your business portfolio, create or select a WhatsApp Business Account, then add your number and verify it by SMS or phone call in Meta.</p><small>For a new number, it must not already be registered in WhatsApp Messenger or the WhatsApp Business mobile app. If you want to keep using the Business app, return and choose Connect WhatsApp Business App. An existing API number needs a supported provider migration. Do not delete or disconnect an existing account to try this flow.</small><label for="pin">WhatsApp two-step verification PIN</label><div class="pin-field"><input id="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="Enter 6 digits" aria-describedby="pin-hint"><button id="pin-toggle" class="pin-toggle" type="button" aria-label="Show PIN" aria-pressed="false" aria-controls="pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path id="eye-slash" d="m3 3 18 18" visibility="hidden"/></svg></button></div><small id="pin-hint">This is not your SMS OTP. For first-time Cloud API registration, choose a new 6-digit PIN and keep it safe. If this number already has a PIN, use that PIN.</small><details id="pin-help"><summary>Forgot PIN? Reset help</summary><p><strong>First-time registration?</strong> Choose a new 6-digit PIN above. There is no existing PIN to reset unless one was already set for this number.</p><p><strong>Existing WhatsApp API number?</strong> Open WhatsApp Manager with the admin account that owns your number. Select the correct business and phone number, then find its Two-step verification settings and follow Meta’s PIN recovery instructions. If another provider manages the number, ask that provider for help.</p><a href="https://business.facebook.com/wa/manage/phone-numbers/" target="_blank" rel="noopener noreferrer">Open WhatsApp Manager to reset PIN ↗</a><p><strong>PIN belongs to the WhatsApp mobile app?</strong> Use the recovery option shown in WhatsApp. Return to MarketingKart and choose the appropriate number type before connecting.</p><a href="https://faq.whatsapp.com/2183055648554771/?locale=en_US" target="_blank" rel="noopener noreferrer">WhatsApp account recovery help ↗</a><p>Opening these links does not reset your PIN. Complete recovery on Meta or WhatsApp, then return and enter the new PIN. If signup expires while you recover it, start Connect WhatsApp again.</p></details><button id="connect" disabled>Continue with Meta</button><p id="status">Loading Meta…</p><a href="myapp://whatsapp-connected">Return to MarketingKart</a><script nonce="${nonce}">
const state = location.hash.slice(1);
history.replaceState(null,'',location.pathname);
let code, selection, sending=false;
const statusEl=document.getElementById('status'), button=document.getElementById('connect');
function status(text){statusEl.textContent=text;}
const pinInput=document.getElementById('pin'), pinToggle=document.getElementById('pin-toggle'), eyeSlash=document.getElementById('eye-slash');
function setPinVisible(visible){
 pinInput.type=visible?'text':'password';
 pinToggle.setAttribute('aria-label',visible?'Hide PIN':'Show PIN');
 pinToggle.setAttribute('aria-pressed',String(visible));
 eyeSlash.setAttribute('visibility',visible?'visible':'hidden');
}
pinToggle.onclick=()=>setPinVisible(pinInput.type==='password');
window.addEventListener('blur',()=>setPinVisible(false));
async function finish(){
 if(!code || !selection || sending)return;
 setPinVisible(false);sending=true;button.disabled=true;status('Verifying your selected number…');
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
 setPinVisible(false);code=null;selection=null;sending=false;button.disabled=true;status('Complete the steps in the Meta window.');
 FB.login(response=>{
  if(response.authResponse?.code){code=response.authResponse.code;finish();}
  else{status('Signup cancelled. You can try again.');button.disabled=false;}
 },${JSON.stringify(signupOptions(configId, 'NEW_OR_MIGRATE'))});
};
setTimeout(()=>{if(typeof FB==='undefined')status('Meta could not load. Check your connection and reopen signup from the app.');},15000);
</script><script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script></body></html>`;
