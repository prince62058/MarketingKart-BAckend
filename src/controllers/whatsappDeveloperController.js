const portfolio = require("../services/developerPortfolio");
const contract = require("../services/developerContract");
const developer = require("../services/whatsappDeveloperService");

function sendError(res, error) {
  const status = error.status || 500;
  return res.status(status).json({ success: false, message: error.message || "Request failed" });
}

exports.createKey = async (req, res) => {
  try {
    const data = await developer.createKey(req.user, req.body?.name, req.body?.userId, req.body?.access, req.body?.service);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.listKeys = async (req, res) => {
  try {
    const data = await developer.listKeys(req.user, req.query.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.revokeKey = async (req, res) => {
  try {
    const data = await developer.revokeKey(req.user, req.params.keyId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.desk = async (req, res) => {
  try {
    const data = await developer.desk(req.user, req.query.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.calls = async (req, res) => {
  try {
    const data = await developer.listCalls(req.user, req.query.userId, req.query.page);
    return res.json({ success: true, ...data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.directory = async (req, res) => {
  try {
    if (!developer.isAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Only the desk owner can see every line" });
    }
    const data = await developer.directory();
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.overview = async (req, res) => {
  try {
    if (!developer.isAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Only the desk owner can see every line" });
    }
    const series = await developer.seriesFor(null);
    const today = series[series.length - 1] || { calls: 0, delivered: 0, failed: 0, spentPaise: 0 };
    const month = series.reduce(
      (sum, day) => {
        sum.calls += day.calls;
        sum.delivered += day.delivered;
        sum.failed += day.failed;
        sum.spentPaise += day.spentPaise;
        return sum;
      },
      { calls: 0, delivered: 0, failed: 0, spentPaise: 0 }
    );
    return res.json({ success: true, data: { series, today, month, portfolio:await portfolio.summary() } });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getWebhook = async (req, res) => {
  try {
    const data = await developer.getWebhook(req.user._id);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.saveWebhook = async (req, res) => {
  try {
    const data = await developer.saveWebhook(req.user._id, req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.rotateWebhook = async (req, res) => {
  try {
    const data = await developer.rotateWebhookSecret(req.user._id);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const data = await developer.sendForProject({
      user: req.user,
      key: req.apiKey,
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
    });
    return res.status(data.replayed ? 200 : 202).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.apiAccount = async (req, res) => {
  try {
    const data = await developer.accountView(req.user);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.apiTemplates = async (req, res) => {
  try {
    const data = await developer.templateView(req.user);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.apiMessage = async (req, res) => {
  try {
    const data = await developer.messageDetail(req.user, req.params.id);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.apiMessages = async (req, res) => {
  try {
    const data = await developer.listCalls(req.user, null, req.query.page);
    return res.json({ success: true, ...data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.saveContract = async (req, res) => {
  try {
    const data = await contract.save(req.user, req.params.userId, req.body || {});
    return res.json({ success: true, data });
  } catch (error) { return sendError(res, error); }
};

exports.chat = async (req, res) => {
  try {
    const message = req.body?.message;
    if (typeof message !== "string" || !message.trim() || message.length > 4000) throw developer.fail(400, "Send a message of 1 to 4000 characters");
    if (!process.env.OPENAI_API_KEY || !process.env.DEVELOPER_CHAT_MODEL) throw developer.fail(503, "Chat provider is not configured");
    const config = await contract.profile(req.user._id);
    await contract.authorize(req.user._id, "chatbot", true);
    const OpenAI = require("openai");
    const client = new OpenAI({apiKey:process.env.OPENAI_API_KEY, maxRetries:0, timeout:30000});
    let result;
    try {
      result = await client.chat.completions.create({
        model:process.env.DEVELOPER_CHAT_MODEL, max_completion_tokens:500,
        messages:[{role:"system",content:("You are a business support assistant. Answer using the business configuration: " + JSON.stringify(config || {}))}, {role:"user",content:message}],
      });
    } catch { throw developer.fail(502, "Chat provider failed to return a reply"); }
    const reply = result.choices?.[0]?.message?.content;
    if (!reply) throw developer.fail(502, "Chat provider returned an empty reply");
    return res.json({success:true,data:{reply,usage:result.usage}});
  } catch (error) { return sendError(res,error); }
};

exports.botProfile = async (req,res) => {
  try {
    const data = await contract.profile(req.user._id, req.method === "PUT" ? req.body || {} : undefined);
    return res.json({success:true,data});
  } catch (error) { return sendError(res,error); }
};

const invoices = require("../services/developerInvoices");
exports.invoices = async (req,res) => {
  try {
    const userId = req.params.userId || req.user._id;
    if (req.params.userId && !developer.isAdmin(req.user)) return res.status(403).json({success:false,message:"Super admin access required"});
    const data = req.method === "POST" ? await invoices.issue(req.user,userId,req.body?.reference) : await invoices.list(userId);
    return res.json({success:true,data});
  } catch (error) { return sendError(res,error); }
};
exports.checkoutInvoice = async (req,res) => {
  try {
    const data = await invoices.checkout(req.user._id,req.params.id);
    return res.json({success:true,data});
  } catch (error) {
    return sendError(res,error.status ? error : developer.fail(502,"Payment provider is unavailable"));
  }
};

exports.customers = async (req,res) => {
  if (!developer.isAdmin(req.user)) return res.status(403).json({success:false,message:"Super admin access required"});
  try {
    const data = req.method === "POST" ? await portfolio.lookup(req.body?.mobile) : await portfolio.customers(req.query.page,req.query.search);
    return res.json({success:true,data});
  } catch(error) {return sendError(res,error);}
};

exports.panelSend = async (req,res) => {
  try {
    const Key = require("../models/whatsappApiKeyModel");
    const id = req.body?.keyId;
    if (!require("mongoose").isObjectIdOrHexString(id)) throw developer.fail(400,"Select a project key");
    const key = await Key.findOne({_id:id,userId:req.user._id,revokedAt:null});
    if (!key || key.access === "read" || key.service === "chatbot") throw developer.fail(403,"A WhatsApp send key is required");
    await contract.rateLimit(req.user._id);
    await contract.authorize(req.user._id,"whatsapp");
    const data = await developer.sendForProject({user:req.user,key,body:req.body.message,idempotencyKey:req.get("Idempotency-Key")});
    return res.status(data.replayed ? 200 : 202).json({success:true,data});
  } catch(error) { return sendError(res,error); }
};
