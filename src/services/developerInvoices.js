const Razorpay = require("razorpay");
const mongoose = require("mongoose");
const Invoice = require("../models/developerInvoiceModel");
const contract = require("./developerContract");
const fail = (status,message) => Object.assign(new Error(message),{status});

function provider() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) throw fail(503,"Online payment is not configured");
  return new Razorpay({key_id,key_secret});
}

async function issue(actor,userId,reference) {
  if (actor.userType !== "ADMIN" && actor.role !== "ADMIN") throw fail(403,"Super admin access required");
  if (!mongoose.isObjectIdOrHexString(userId) || typeof reference !== "string" || !reference.trim() || reference.length > 80) throw fail(400,"Enter a unique invoice reference");
  const plan = await contract.read(userId);
  const amountPaise = Math.round((plan?.packageFeeRupees || 0)*100);
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) throw fail(400,"Set an API package fee of at least one rupee");
  const filter = {userId,reference:reference.trim()};
  return Invoice.findOneAndUpdate(filter,{$setOnInsert:{...filter,issuedBy:actor._id,amountPaise,status:"open"}},{new:true,upsert:true}).lean();
}

function fullyPaid(invoice, link) {
  return link.id === invoice.providerId && link.reference_id === String(invoice._id) &&
    link.status === "paid" && link.currency === "INR" &&
    link.amount === invoice.amountPaise && link.amount_paid === invoice.amountPaise;
}

async function checkout(userId,id) {
  if (!mongoose.isObjectIdOrHexString(id)) throw fail(404,"Invoice not found");
  const invoice = await Invoice.findOne({_id:id,userId}).lean();
  if (!invoice) throw fail(404,"Invoice not found");
  if (invoice.status === "paid") return invoice;
  const client = provider();
  if (invoice.providerId) {
    const link = await client.paymentLink.fetch(invoice.providerId);
    if (fullyPaid(invoice,link)) return Invoice.findOneAndUpdate({_id:id,userId},{$set:{status:"paid",paidAt:new Date()}},{new:true}).lean();
    if (link.status !== "created") throw fail(409,"This payment link cannot accept payment. Contact the agency.");
    return invoice;
  }
  const reference_id = String(invoice._id);
  let link;
  try {
    link = await client.paymentLink.create({amount:invoice.amountPaise,currency:"INR",reference_id,description:"API package invoice " + invoice.reference,accept_partial:false});
  } catch {
    const existing = await client.paymentLink.all({reference_id});
    link = existing.payment_links?.find(item => item.reference_id === reference_id);
    if (!link) throw fail(502,"Payment provider could not create the checkout. Retry this invoice.");
  }
  if (link.reference_id !== reference_id || link.amount !== invoice.amountPaise || link.currency !== "INR" || !link.short_url?.startsWith("https://")) throw fail(502,"Payment provider returned an inconsistent invoice");
  return Invoice.findOneAndUpdate({_id:id,userId},{$set:{providerId:link.id,checkoutUrl:link.short_url}},{new:true}).lean();
}

async function receivePayment(raw,signature,event) {
  const secret = process.env.DEVELOPER_BILLING_WEBHOOK_SECRET;
  if (!secret) throw fail(503,"Billing webhook has not been configured");
  const crypto = require("crypto");
  if (!Buffer.isBuffer(raw) || !/^[a-f0-9]{64}$/i.test(signature || "")) throw fail(401,"Invalid payment signature");
  const digest = crypto.createHmac("sha256",secret).update(raw).digest();
  if (!crypto.timingSafeEqual(digest,Buffer.from(signature,"hex"))) throw fail(401,"Invalid payment signature");
  if (event?.event !== "payment_link.paid") return;
  const link = event.payload?.payment_link?.entity;
  if (!mongoose.isObjectIdOrHexString(link?.reference_id)) return;
  const invoice = await Invoice.findById(link.reference_id).lean();
  if (!invoice || invoice.status === "paid") return;
  if (!invoice.providerId) throw fail(503,"Checkout is still being recorded");
  if (!fullyPaid(invoice,link)) throw fail(409,"Payment does not match the issued invoice");
  await Invoice.updateOne({_id:invoice._id,status:"open"},{$set:{status:"paid",paidAt:new Date()}});
}

module.exports = { receivePayment, issue, checkout, fullyPaid, list:userId => Invoice.find({userId}).sort({_id:-1}).limit(100).lean() };
