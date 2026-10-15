const crypto=require('crypto');
const axios=require('axios');
const Account=require('../models/whatsappAccountModel');
const Event=require('../models/whatsappCoexistenceEventModel');
const Conversation=require('../models/whatsappConversationModel');
const Message=require('../models/whatsappMessageModel');
const Business=require('../models/businessModel');
const fields=['history','smb_app_state_sync','smb_message_echoes','account_update'];
const digits=x=>String(x||'').replace(/\D/g,'');
const date=x=>{const n=Number(x);return n>0&&Number.isFinite(n)?new Date(n*1000):new Date(0);};
const base=()=>`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION||'v22.0'}`;
async function assertConfigured(api=axios){
 const response=await api.get(`${base()}/${process.env.clientId}/subscriptions`,{headers:{Authorization:`Bearer ${process.env.clientId}|${process.env.clientSecret}`},timeout:15000});
 const sub=response.data?.data?.find(s=>s.object==='whatsapp_business_account'&&s.active&&s.callback_url==='https://api.marketingkart.in/api/whatsapp/webhook');
 if(!sub||fields.some(f=>!sub.fields?.some(x=>x.name===f)))throw new Error('WhatsApp Business App synchronization setup is pending. Please contact support.');
}
// Persist signed payloads before acknowledging. A process restart must not lose history.
async function capture(req,res,next){
 const changes=(req.body?.entry||[]).flatMap(e=>(e.changes||[]).filter(c=>fields.includes(c.field)).map(c=>({wabaId:String(e.id),field:c.field,value:c.value})));
 if(!changes.length)return next();
 const signature=req.get('x-hub-signature-256')||'';
 if(!req.rawBody||!process.env.clientSecret)return res.sendStatus(403);
 const expected='sha256='+crypto.createHmac('sha256',process.env.clientSecret).update(req.rawBody).digest('hex');
 if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.sendStatus(403);
 try{
  for(const item of changes){const id=crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex');await Event.updateOne({_id:id},{$setOnInsert:item},{upsert:true});}
  // History media uses value.messages too; never let the regular inbound handler misroute it.
  req.body={...req.body,entry:req.body.entry.map(e=>({...e,changes:(e.changes||[]).filter(c=>!fields.includes(c.field))}))};
  void drain();next();
 }catch{return res.sendStatus(503);}
}
function messageData(msg,customerPhone,businessPhone){
 const media=['image','video','audio','document','sticker'].includes(msg.type);
 const state={READ:'READ',PLAYED:'READ',DELIVERED:'DELIVERED',SENT:'SENT',ERROR:'FAILED',PENDING:'QUEUED'}[msg.history_context?.status]||'SENT';
 return {to:customerPhone,direction:digits(msg.from)===digits(businessPhone)?'OUTBOUND':'INBOUND',
  type:msg.type==='text'?'TEXT':media?'MEDIA':'UNKNOWN',
  textBody:msg.text?.body||msg[msg.type]?.caption||`[${String(msg.type||'unknown').toUpperCase()}]`,
  mediaType:media?msg.type:null,mediaId:media?msg[msg.type]?.id||null:null,
  status:state,sentAt:date(msg.timestamp),createdAt:date(msg.timestamp),source:'BUSINESS_APP'};
}
async function processEvent(job){
 const value=job.value||{};
 const query={wabaId:job.wabaId};
 if(value.metadata?.phone_number_id)query.phoneNumberId=String(value.metadata.phone_number_id);
 const accounts=await Account.find(query).limit(2);
 if(accounts.length!==1)throw new Error('Waiting for a unique account mapping');
 const account=accounts[0];
 if(job.field==='account_update'){
  if(['PARTNER_REMOVED','ACCOUNT_OFFBOARDED'].includes(value.event))await Account.updateOne({_id:account._id},{$set:{status:'DISCONNECTED',disconnectionReason:value.disconnection_info?.reason||value.event}});
  // Reconnection requires a fresh grant; never reactivate using a stale token.
  return;
 }
 if(account.status!=='CONNECTED'||account.onboardingMode!=='BUSINESS_APP')throw new Error('Waiting for active Business App onboarding');
 const businesses=await Business.find({userId:account.userId}).select('_id').sort({_id:1});
 if(!businesses.length)throw new Error('Account has no business for its inbox');
 const ownerIds=businesses.map(b=>b._id);
 async function conversation(phone,name){
  const q={phoneNumberId:account.phoneNumberId,customerPhone:phone};
  let row=await Conversation.findOne(q);
  if(row&&!ownerIds.some(id=>String(id)===String(row.businessId)))throw new Error('Conversation owner mismatch');
  if(!row)row=await Conversation.findOneAndUpdate(q,{$setOnInsert:{...q,wabaId:account.wabaId,businessId:ownerIds[0],customerName:name||'Unknown',lastMessageAt:new Date(0),unreadCount:0}},{upsert:true,new:true});
  return row;
 }
 async function saveMessage(msg,phone){
  if(!msg.id||!phone)return;
  const conv=await conversation(phone);
  const data=messageData(msg,phone,value.metadata?.display_phone_number||account.phoneNumber);
  const q={phoneNumberId:account.phoneNumberId,metaMessageId:msg.id};
  const existing=await Message.findOne(q);
  if(!existing)await Message.updateOne({_id:crypto.createHash('sha256').update(account.phoneNumberId+':'+msg.id).digest('hex').slice(0,24)},{$setOnInsert:{...data,...q,conversationId:conv._id,businessId:conv.businessId}},{upsert:true});
  else if(existing.source==='BUSINESS_APP'&&existing.type==='UNKNOWN'&&data.type==='MEDIA')await Message.updateOne({_id:existing._id},{$set:{type:data.type,textBody:data.textBody,mediaId:data.mediaId,mediaType:data.mediaType}});
  await Conversation.updateOne({_id:conv._id,lastMessageAt:{$lte:data.sentAt}},{$set:{lastMessage:data.textBody.slice(0,100),lastMessageAt:data.sentAt}});
 }
 if(job.field==='smb_app_state_sync'){
  for(const item of value.state_sync||[]){
   if(item.type!=='contact')continue;
   const phone=digits(item.contact?.phone_number);if(!phone)continue;
   const conv=await conversation(phone,item.contact.full_name||item.contact.first_name);
   const timestamp=date(item.metadata?.timestamp);
   await Conversation.updateOne({_id:conv._id,$or:[{contactSyncedAt:{$exists:false}},{contactSyncedAt:{$lte:timestamp}}]},{$set:{contactSyncedAt:timestamp,customerName:item.action==='remove'?'Unknown':item.contact.full_name||item.contact.first_name||'Unknown'}});
  }
 }
 if(job.field==='smb_message_echoes')for(const msg of value.message_echoes||[])await saveMessage(msg,digits(msg.to));
 if(job.field==='history'){
  for(const part of value.history||[]){
   if(part.errors?.some(e=>Number(e.code)===2593109))await Account.updateOne({_id:account._id},{$set:{'coexistenceSync.historyStatus':'DECLINED'}});
   else if(part.errors?.length)throw new Error('Meta history synchronization failed');
   for(const thread of part.threads||[])for(const msg of thread.messages||[])await saveMessage(msg,digits(thread.id));
   if(Number.isFinite(part.metadata?.progress))await Account.updateOne({_id:account._id},{$max:{'coexistenceSync.historyProgress':part.metadata.progress},...(part.metadata.progress===100?{$set:{'coexistenceSync.historyStatus':'COMPLETE'}}:{})});
  }
  // Supplemental media enriches the original message; it must not invent a new conversation.
  for(const msg of value.messages||[]){const existing=await Message.findOne({phoneNumberId:account.phoneNumberId,metaMessageId:msg.id});if(!existing)throw new Error('Waiting for history media placeholder');await saveMessage(msg,existing.to);}
 }
}
let running=false;
async function drain(){
 if(running||Event.db.readyState!==1)return;
 running=true;
 try{for(let i=0;i<25;i++){
  const job=await Event.findOneAndUpdate({status:{$in:['PENDING','PROCESSING']},availableAt:{$lte:new Date()}},{$set:{status:'PROCESSING',availableAt:new Date(Date.now()+300000)},$inc:{attempts:1}},{new:true,sort:{createdAt:1}});
  if(!job)break;
  try{await processEvent(job);await Event.updateOne({_id:job._id},{$set:{status:'DONE',completedAt:new Date()},$unset:{value:1,error:1}});}
  catch(error){await Event.updateOne({_id:job._id},{$set:{status:'PENDING',availableAt:new Date(Date.now()+Math.min(300000,job.attempts*10000)),error:error.message}});}
 }}catch{console.warn('[WhatsApp] Business App sync queue temporarily unavailable');}finally{running=false;}
}
const timer=setInterval(()=>void drain(),10000);timer.unref();
module.exports={capture,assertConfigured,fields,messageData,processEvent};
