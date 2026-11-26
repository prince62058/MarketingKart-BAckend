const Contract = require("../models/developerContractModel");
const Invoice = require("../models/developerInvoiceModel");
const User = require("../models/userModel");

async function summary() {
  const now = new Date();
  const [customers, active, expiring, billing] = await Promise.all([
    Contract.countDocuments(),
    Contract.countDocuments({expiresAt:{$gt:now},$or:[{whatsapp:true},{chatbot:true}]}),
    Contract.countDocuments({expiresAt:{$gt:now,$lte:new Date(+now+7*86400000)},$or:[{whatsapp:true},{chatbot:true}]}),
    Invoice.aggregate([{$group:{_id:"$status",paise:{$sum:"$amountPaise"},count:{$sum:1}}}]),
  ]);
  const amount = status => billing.find(row=>row._id===status)?.paise || 0;
  return {customers,active,expiring,paidPaise:amount("paid"),openPaise:amount("open")};
}

async function customers(rawPage,rawSearch) {
  const page = Math.max(1,Math.min(100000,Number.parseInt(rawPage,10)||1));
  const search = String(rawSearch || "").trim().slice(0,100);
  const pipeline = [
    {$lookup:{from:User.collection.name,localField:"userId",foreignField:"_id",as:"owner"}},
    {$unwind:"$owner"},
  ];
  if (search) {
    const literal = [...search].map(char=>"\\^$.*+?()[]{}|".includes(char) ? "\\"+char : char).join("");
    const match = [{"owner.name":{$regex:literal,$options:"i"}},{"owner.email":{$regex:literal,$options:"i"}}];
    if (/^\d{10}$/.test(search)) match.push({"owner.mobile":Number(search)});
    pipeline.push({$match:{$or:match}});
  }
  pipeline.push({$sort:{updatedAt:-1,_id:1}},{$skip:(page-1)*20},{$limit:21},{$project:{
    userId:1,name:"$owner.name",mobile:"$owner.mobile",email:"$owner.email",expiresAt:1,whatsapp:1,chatbot:1,
    whatsappUsed:1,whatsappLimit:1,chatbotUsed:1,chatbotLimit:1,
  }});
  const rows = await Contract.aggregate(pipeline);
  return {rows:rows.slice(0,20),hasNext:rows.length>20};
}

async function lookup(mobile) {
  if (!/^\d{10}$/.test(String(mobile || ""))) throw Object.assign(new Error("Enter the registered 10-digit mobile number"),{status:400});
  const row = await User.findOne({mobile:Number(mobile),userType:"USER",disable:{$ne:true}}).select("_id").lean();
  if (!row) throw Object.assign(new Error("Ask the customer to sign in with this number first"),{status:404});
  return {userId:row._id};
}
module.exports = {summary,customers,lookup};
