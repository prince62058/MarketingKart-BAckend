const axios = require('axios');
const { randomInt } = require('crypto');
const { encryptText, decryptText } = require('../utils/cryptoUtils');
const Account = require('../models/whatsappAccountModel');
const Claim = require('../models/whatsappPhoneClaimModel');
const version = () => process.env.META_GRAPH_API_VERSION || 'v22.0';
const requiredScopes = ['whatsapp_business_management','whatsapp_business_messaging'];
function validateGrant(grant, appId, wabaId, now = Date.now()) {
  if (!grant?.is_valid || String(grant.app_id) !== String(appId)) throw new Error('Invalid WhatsApp authorization. Connect again.');
  if (requiredScopes.some(scope => !grant.scopes?.includes(scope))) throw new Error('Approve WhatsApp management and messaging permissions.');
  if (grant.expires_at && grant.expires_at * 1000 <= now) throw new Error('WhatsApp authorization expired. Connect again.');
  const assetGrant = grant.granular_scopes?.find(s => s.scope === 'whatsapp_business_management');
  if (!assetGrant?.target_ids?.map(String).includes(String(wabaId))) throw new Error('This WhatsApp account was not shared in signup.');
}
async function connectSignup({userId, code, wabaId, phoneNumberId, mode = 'NEW_OR_MIGRATE'}, deps = {}) {
  if (!['NEW_OR_MIGRATE','BUSINESS_APP'].includes(mode)) throw new Error('Invalid signup mode.');
  const coexistence = mode === 'BUSINESS_APP';
  const api = deps.api || axios;
  const Accounts = deps.Account || Account;
  const Claims = deps.Claim || Claim;
  const appId = process.env.clientId;
  const secret = process.env.clientSecret;
  if (!appId || !secret || !process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY) throw new Error('WhatsApp onboarding is not configured. Contact support.');
  if (typeof code !== 'string' || !code || code.length > 8192 || !/^\d{5,30}$/.test(wabaId || '') || ((!coexistence || phoneNumberId) && !/^\d{5,30}$/.test(phoneNumberId || ''))) throw new Error('Complete Meta signup and select a WhatsApp number.');
  const base = `https://graph.facebook.com/${version()}`;
  const exchanged = await api.get(`${base}/oauth/access_token`, {params:{client_id:appId,client_secret:secret,code},timeout:15000});
  const token = exchanged.data?.access_token;
  if (!token) throw new Error('Meta did not authorize the connection. Try again.');
  const debug = await api.get(`${base}/debug_token`, {params:{input_token:token},headers:{Authorization:`Bearer ${appId}|${secret}`},timeout:15000});
  validateGrant(debug.data?.data, appId, wabaId);
  const headers = {Authorization:`Bearer ${token}`};
  // Read the selected phone through this customer's WABA, never through our system token.
  let cursor;
  let phone;
  const eligible=[];
  for (let page=0; page<100; page++) {
    const response = await api.get(`${base}/${wabaId}/phone_numbers`, {headers,params:{fields:'id,display_phone_number,verified_name,quality_rating,status,code_verification_status,is_on_biz_app,platform_type',limit:100,...(cursor ? {after:cursor}: {})},timeout:15000});
    eligible.push(...(response.data?.data||[]).filter(p=>p.is_on_biz_app===true&&p.platform_type==='CLOUD_API'));
    phone = response.data?.data?.find(p => String(p.id) === phoneNumberId);
    if (phone) break;
    cursor = response.data?.paging?.cursors?.after;
    if (!response.data?.paging?.next || !cursor) break;
  }
  if(coexistence&&!phoneNumberId&&eligible.length===1){phone=eligible[0];phoneNumberId=String(phone.id);}
  if (!phone) throw new Error('Selected number does not belong to the authorized WhatsApp account.');
  if (!coexistence && phone.is_on_biz_app === true) throw new Error('This number is registered in WhatsApp Business App. Use Connect WhatsApp Business App instead; do not delete your account.');
  if(coexistence&&(phone.is_on_biz_app!==true||phone.platform_type!=='CLOUD_API'))throw new Error('Complete the connection approval inside WhatsApp Business first.');
  const existing = await Accounts.findOne({phoneNumberId,userId:{$ne:userId}});
  if (existing) throw new Error('This number is already linked to another MarketingKart account. Contact support.');
  let claim;
  try { claim = await Claims.findOneAndUpdate({_id:phoneNumberId},{$setOnInsert:{userId}},{upsert:true,new:true}); }
  catch (error) { if (error.code !== 11000) throw error; claim = await Claims.findById(phoneNumberId); }
  if (String(claim?.userId) !== String(userId)) throw new Error('This number is already linked to another MarketingKart account.');
  if (!coexistence && phone.status !== 'CONNECTED') {
    if (phone.code_verification_status !== 'VERIFIED') throw new Error('Verify your number with the Meta OTP step first.');
    // Persist once before calling Meta so a timed-out registration can reuse its PIN.
    // The atomic predicate prevents concurrent attempts from choosing different PINs.
    await Claims.updateOne({_id:phoneNumberId,userId,registrationPinEncrypted:{$exists:false}},
      {$set:{registrationPinEncrypted:encryptText(String(randomInt(0,1000000)).padStart(6,'0'))}});
    const pinClaim = await Claims.findOne({_id:phoneNumberId,userId}).select('+registrationPinEncrypted');
    const pin = decryptText(pinClaim?.registrationPinEncrypted);
    if (!/^\d{6}$/.test(pin || '')) throw new Error('Could not prepare number registration. Please contact support.');
    let registered;
    try {
      registered = await api.post(`${base}/${phoneNumberId}/register`, {messaging_product:'whatsapp',pin}, {headers,timeout:20000});
    } catch (error) {
      if (Number(error.response?.data?.error?.code) === 133005) {
        throw new Error('Meta requires recovery of the existing two-step verification on this number. Complete recovery in WhatsApp Manager or contact your current API provider, then connect again.');
      }
      throw error;
    }
    if (!registered.data?.success) throw new Error('Meta has not completed phone registration. Retry signup.');
    phone.status = 'CONNECTED';
  }
  const subscribed = await api.post(`${base}/${wabaId}/subscribed_apps`, {}, {headers,timeout:15000});
  if (!subscribed.data?.success) throw new Error('WhatsApp webhook subscription failed. Retry signup.');
  const grant = debug.data.data;
  const account = await Accounts.findOneAndUpdate({userId}, {$set:{
    wabaId,phoneNumberId,accessToken:token,phoneNumber:phone.display_phone_number,
    verifiedName:phone.verified_name || null,qualityRating:phone.quality_rating || null,
    onboardingMode:mode,phoneStatus:coexistence?'CONNECTED':phone.status,codeVerificationStatus:phone.code_verification_status,
    connectedVia:'EMBEDDED_SIGNUP',status:'CONNECTED',
    tokenExpiresAt:grant.expires_at ? new Date(grant.expires_at*1000) : null,
  }}, {upsert:true,new:true,runValidators:true});
  if(coexistence){
    // These are one-shot requests. Persist intent before sending so a timeout is not blindly replayed.
    for(const [syncType,key] of [['smb_app_state_sync','contacts'],['history','history']]){
      const at=`coexistenceSync.${key}RequestedAt`, id=`coexistenceSync.${key}RequestId`;
      const reserved=await Accounts.findOneAndUpdate({_id:account._id,[at]:{$exists:false}},{$set:{[at]:new Date(),...(key==='history'?{'coexistenceSync.historyStatus':'REQUESTED'}:{})}},{new:true});
      if(!reserved){
        const current=await Accounts.findOne({_id:account._id});
        if(!current?.coexistenceSync?.[`${key}RequestId`])throw new Error('Business App synchronization request is awaiting confirmation. Contact support; do not disconnect your account.');
        continue;
      }
      const result=await api.post(`${base}/${phoneNumberId}/smb_app_data`,{messaging_product:'whatsapp',sync_type:syncType},{headers,timeout:20000});
      if(!result.data?.request_id)throw new Error('Meta did not confirm Business App synchronization. Contact support before retrying.');
      await Accounts.updateOne({_id:account._id},{$set:{[id]:result.data.request_id}});
    }
  }
  return account;
}
module.exports = {connectSignup,validateGrant};
