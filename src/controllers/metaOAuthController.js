const crypto = require('crypto');
const Sessions = require('../models/whatsappSignupSessionModel');
const Accounts = require('../models/whatsappAccountModel');
const {connectSignup} = require('../services/whatsappSignupService');
const {getSignupHtml} = require('../views/whatsappSignupPage');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ready = () => process.env.clientId && process.env.clientSecret && process.env.META_WHATSAPP_CONFIG_ID && /^[a-f0-9]{64}$/i.test(process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || '');
const publicBase = () => process.env.PUBLIC_API_URL || 'https://api.marketingkart.in';
exports.startOAuth = async (req,res) => {
 try {
  if(!ready())return res.status(503).json({success:false,message:'WhatsApp onboarding setup is being completed. Please contact support.'});
  const state=crypto.randomBytes(32).toString('hex');
  await Sessions.findOneAndUpdate({_id:req.user._id,status:{$ne:'PROCESSING'}},{$set:{stateHash:hash(state),userId:req.user._id,status:'WAITING',message:null,expiresAt:new Date(Date.now()+600000)}},{upsert:true,new:true});
  res.set('Cache-Control','no-store').json({success:true,data:{state,oauthUrl:publicBase()+'/api/whatsapp/meta/signup#'+state}});
 }catch{res.status(500).json({success:false,message:'Could not start WhatsApp signup. Please retry.'});}
};
exports.signupPage = (req,res) => {
 if(!ready())return res.status(503).send('WhatsApp signup configuration is pending. Return to MarketingKart.');
 const nonce=crypto.randomBytes(18).toString('base64');
 res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':`default-src 'self'; script-src 'self' 'nonce-${nonce}' https://connect.facebook.net; style-src 'nonce-${nonce}'; frame-src https://www.facebook.com https://web.facebook.com; connect-src 'self' https://www.facebook.com https://graph.facebook.com; img-src 'self' data: https://*.facebook.com https://*.fbcdn.net; base-uri 'none'; form-action 'self' https://www.facebook.com`});
 res.type('html').send(getSignupHtml({appId:process.env.clientId,configId:process.env.META_WHATSAPP_CONFIG_ID,version:process.env.META_GRAPH_API_VERSION || 'v22.0',nonce}));
};
exports.completeSignup = async (req,res) => {
 if (req.get('origin') !== new URL(publicBase()).origin) return res.status(403).json({success:false,message:'Open signup from MarketingKart.'});
 const {state,code,wabaId,phoneNumberId,pin}=req.body || {};
 if(!/^[a-f0-9]{64}$/.test(state || ''))return res.status(400).json({success:false,message:'Invalid signup session.'});
 let session;
 try {
  session=await Sessions.findOneAndUpdate({stateHash:hash(state),status:'WAITING',expiresAt:{$gt:new Date()}},{$set:{status:'PROCESSING'}},{new:true});
  if(!session)return res.status(409).json({success:false,message:'Signup session expired or already used. Start again from the app.'});
  await connectSignup({userId:session.userId,code,wabaId,phoneNumberId,pin});
  await Sessions.updateOne({_id:session._id},{$set:{status:'CONNECTED'}});
  res.json({success:true});
 }catch(error){
  const message=error.response ? `Meta could not complete signup (code ${error.response.data?.error?.code || 'unknown'}). Check your business permissions and number verification, then retry.` : error.message;
  if(session)await Sessions.updateOne({_id:session._id},{$set:{status:'FAILED',message}}).catch(()=>{});
  res.status(400).json({success:false,message:message || 'Connection failed. Please retry signup.'});
 }
};
exports.handleCallback = (_req,res) => res.status(410).send('This login flow has been replaced. Start Connect WhatsApp in the latest MarketingKart app.');
exports.checkStatus = async (req,res) => {
 try {
  const state=req.query.state;
  if(!/^[a-f0-9]{64}$/.test(state || ''))return res.status(400).json({success:false,message:'Signup session is required.'});
  const session=await Sessions.findOne({stateHash:hash(state),userId:req.user._id,expiresAt:{$gt:new Date()}});
  if(!session)return res.json({success:true,data:{connected:false,status:'EXPIRED'}});
  const account=session.status==='CONNECTED' ? await Accounts.findOne({userId:req.user._id,status:'CONNECTED'}) : null;
  res.set('Cache-Control','no-store').json({success:true,data:{connected:!!account,status:session.status,message:session.message}});
 }catch{res.status(500).json({success:false,message:'Could not check WhatsApp signup.'});}
};
