const Contract = require("../models/developerContractModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");

const fields = "whatsapp chatbot expiresAt whatsappLimit chatbotLimit whatsappUsed chatbotUsed requestsPerMinute packageFeeRupees billingReference";
const fail = (status, message) => Object.assign(new Error(message), { status });

async function read(userId) {
  return Contract.findOne({ userId }).select(fields).lean();
}

async function save(actor, userId, body) {
  if (actor.userType !== "ADMIN" && actor.role !== "ADMIN") throw fail(403, "Super admin access required");
  if (!mongoose.isObjectIdOrHexString(userId) || !await User.exists({ _id: userId })) throw fail(404, "Customer not found");
  const requestsPerMinute = body.requestsPerMinute ?? 60;
  if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 10000) throw fail(400,"Requests per minute must be between 1 and 10000");
  const { whatsapp, chatbot, whatsappLimit, chatbotLimit, packageFeeRupees, billingReference, expiresAt } = body;
  if (typeof whatsapp !== "boolean" || typeof chatbot !== "boolean" ||
      ![whatsappLimit, chatbotLimit].every(n => Number.isSafeInteger(n) && n >= 0) ||
      !Number.isFinite(packageFeeRupees) || packageFeeRupees < 0 ||
      typeof billingReference !== "string" || billingReference.length > 100 ||
      typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) throw fail(400, "Invalid API package settings");
  return Contract.findOneAndUpdate({ userId }, { $set: {
    requestsPerMinute, whatsapp, chatbot, whatsappLimit, chatbotLimit, packageFeeRupees, billingReference, expiresAt, updatedBy: actor._id,
  } }, { upsert: true, new: true, runValidators: true }).select(fields).lean();
}

async function authorize(userId, service, consume = false) {
  const used = service + "Used";
  const filter = { userId, [service]: true, expiresAt: { $gt: new Date() } };
  if (!consume) {
    if (!await Contract.exists(filter)) throw fail(403, "API access is inactive or expired");
    return;
  }
  const updated = await Contract.updateOne({ ...filter, $expr: { $lt: ["$" + used, "$" + service + "Limit"] } }, { $inc: { [used]: 1 } });
  if (!updated.modifiedCount) {
    if (!await Contract.exists(filter)) throw fail(403, "API access is inactive or expired");
    throw fail(429, "API request allowance exhausted");
  }
}

async function profile(userId, input) {
  const filter = {userId, chatbot:true, expiresAt:{$gt:new Date()}};
  let query;
  if (input === undefined) {
    query = Contract.findOne(filter);
  } else {
    const { businessName, systemPrompt, faqs } = input || {};
    const valid = (text, limit) => typeof text === "string" && text.length <= limit;
    if (!valid(businessName,120) || !valid(systemPrompt,4000) || !Array.isArray(faqs) ||
        faqs.length > 20 || faqs.some(f => !f || !valid(f.question,300) || !valid(f.answer,1000) || !f.question.trim() || !f.answer.trim())) {
      throw fail(400,"Enter a business name, instructions and up to 20 complete FAQs within the field limits");
    }
    query = Contract.findOneAndUpdate(filter, {$set:{botProfile:{businessName,systemPrompt,faqs:faqs.map(({question,answer})=>({question,answer}))}}}, {new:true,runValidators:true});
  }
  const row = await query.select("botProfile").lean();
  if (!row) throw fail(403,"An active chatbot API package is required");
  return row.botProfile || {businessName:"",systemPrompt:"",faqs:[]};
}

async function rateLimit(userId) {
  const Window = require("../models/developerRequestWindowModel");
  const plan = await Contract.findOne({userId}).select("requestsPerMinute").lean();
  const limit = plan?.requestsPerMinute ?? 60;
  const minute = Math.floor(Date.now()/60000);
  const window = await Window.findByIdAndUpdate(String(userId)+":"+minute,
    {$inc:{requests:1},$setOnInsert:{expiresAt:new Date((minute+2)*60000)}},
    {new:true,upsert:true}).lean();
  if (window.requests > limit) throw fail(429,"Account request rate exceeded. Retry next minute.");
}
module.exports = { read, save, authorize, profile, rateLimit };
