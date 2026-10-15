const axios = require('axios');
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
async function connectSignup({userId, code, wabaId, phoneNumberId, pin, mode = 'NEW_OR_MIGRATE'}, deps = {}) {
  if (mode !== 'NEW_OR_MIGRATE') throw new Error('WhatsApp Business App connection requires the coexistence setup.');
  const api = deps.api || axios;
  const Accounts = deps.Account || Account;
  const Claims = deps.Claim || Claim;
  const appId = process.env.clientId;
  const secret = process.env.clientSecret;
  if (!appId || !secret || !process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY) throw new Error('WhatsApp onboarding is not configured. Contact support.');
  if (typeof code !== 'string' || !code || code.length > 8192 || !/^\d{5,30}$/.test(wabaId || '') || !/^\d{5,30}$/.test(phoneNumberId || '')) throw new Error('Complete Meta signup and select a WhatsApp number.');
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
  for (let page=0; page<100; page++) {
    const response = await api.get(`${base}/${wabaId}/phone_numbers`, {headers,params:{fields:'id,display_phone_number,verified_name,quality_rating,status,code_verification_status,is_on_biz_app',limit:100,...(cursor ? {after:cursor}: {})},timeout:15000});
    phone = response.data?.data?.find(p => String(p.id) === phoneNumberId);
    if (phone) break;
    cursor = response.data?.paging?.cursors?.after;
    if (!response.data?.paging?.next || !cursor) break;
  }
  if (!phone) throw new Error('Selected number does not belong to the authorized WhatsApp account.');
  if (phone.is_on_biz_app === true) throw new Error('This number is registered in WhatsApp Business App. Use Connect WhatsApp Business App instead; do not delete your account.');
  const existing = await Accounts.findOne({phoneNumberId,userId:{$ne:userId}});
  if (existing) throw new Error('This number is already linked to another MarketingKart account. Contact support.');
  let claim;
  try { claim = await Claims.findOneAndUpdate({_id:phoneNumberId},{$setOnInsert:{userId}},{upsert:true,new:true}); }
  catch (error) { if (error.code !== 11000) throw error; claim = await Claims.findById(phoneNumberId); }
  if (String(claim?.userId) !== String(userId)) throw new Error('This number is already linked to another MarketingKart account.');
  if (phone.status !== 'CONNECTED') {
    if (phone.code_verification_status !== 'VERIFIED') throw new Error('Verify your number with the Meta OTP step first.');
    if (!/^\d{6}$/.test(pin || '')) throw new Error('Enter your six-digit WhatsApp two-step verification PIN to register this number.');
    const registered = await api.post(`${base}/${phoneNumberId}/register`, {messaging_product:'whatsapp',pin}, {headers,timeout:20000});
    if (!registered.data?.success) throw new Error('Meta has not completed phone registration. Retry signup.');
    phone.status = 'CONNECTED';
  }
  const subscribed = await api.post(`${base}/${wabaId}/subscribed_apps`, {}, {headers,timeout:15000});
  if (!subscribed.data?.success) throw new Error('WhatsApp webhook subscription failed. Retry signup.');
  const grant = debug.data.data;
  const account = await Accounts.findOneAndUpdate({userId}, {$set:{
    wabaId,phoneNumberId,accessToken:token,phoneNumber:phone.display_phone_number,
    verifiedName:phone.verified_name || null,qualityRating:phone.quality_rating || null,
    phoneStatus:phone.status,codeVerificationStatus:phone.code_verification_status,
    connectedVia:'EMBEDDED_SIGNUP',status:'CONNECTED',
    tokenExpiresAt:grant.expires_at ? new Date(grant.expires_at*1000) : null,
  }}, {upsert:true,new:true,runValidators:true});
  return account;
}
module.exports = {connectSignup,validateGrant};
