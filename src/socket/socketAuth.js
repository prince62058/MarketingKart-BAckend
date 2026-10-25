// Socket.IO access control: who may connect, and which rooms they may listen in.
//
// The server pushes WhatsApp messages, lead alerts and campaign stats into rooms named after a
// business, a user, a campaign or a conversation. A room name is not a secret, so joining has to be
// checked against the account that is connected, never trusted from the client.
const mongoose = require("mongoose");
const { decodeAuthToken } = require("../middlewares/authMidd");
const userModel = require("../models/userModel");
const whatsappCampaignModel = require("../models/whatsappCampaignModel");
const whatsappConversationModel = require("../models/whatsappConversationModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const { canAccessBusiness } = require("../helpers/businessAccess");

const isAdmin = (user) => user?.userType === "ADMIN";
const same = (a, b) => Boolean(a) && Boolean(b) && String(a) === String(b);

// Each room kind: the client events that join/leave it, and the rule for who may be in it.
const ROOMS = {
  campaign: {
    join: "joinCampaignRoom",
    leave: "leaveCampaignRoom",
    allowed: async (user, id) => {
      const campaign = await whatsappCampaignModel.findById(id).select("createdBy businessId").lean();
      if (!campaign) return false;
      return same(campaign.createdBy, user._id) || canAccessBusiness(user, campaign.businessId);
    },
  },
  business: {
    join: "joinBusinessRoom",
    leave: "leaveBusinessRoom",
    allowed: (user, id) => canAccessBusiness(user, id),
  },
  user: {
    join: "joinUserRoom",
    leave: "leaveUserRoom",
    allowed: async (user, id) => same(id, user._id),
  },
  conversation: {
    join: "joinConversationRoom",
    leave: "leaveConversationRoom",
    allowed: async (user, id) => {
      const conversation = await whatsappConversationModel.findById(id).select("businessId wabaId phoneNumberId").lean();
      if (!conversation) return false;
      if (await canAccessBusiness(user, conversation.businessId)) return true;
      // A conversation for a number that is not mapped to a business belongs to whoever owns the number.
      return Boolean(
        await whatsappAccountModel.exists({
          userId: user._id,
          $or: [{ wabaId: conversation.wabaId }, { phoneNumberId: conversation.phoneNumberId }],
        }),
      );
    },
  },
};

const handshakeToken = (socket) => {
  const fromAuth = socket.handshake?.auth?.token;
  if (typeof fromAuth === "string" && fromAuth.trim()) return fromAuth.replace(/^Bearer\s+/i, "").trim();
  const header = socket.handshake?.headers?.authorization;
  if (typeof header === "string" && header.trim()) return header.replace(/^Bearer\s+/i, "").trim();
  return null;
};

/** io.use() middleware: only a signed-in, enabled account gets a connection. */
async function authenticateSocket(socket, next) {
  try {
    const { userId } = decodeAuthToken(handshakeToken(socket));
    if (!userId || !mongoose.isValidObjectId(userId)) return next(new Error("unauthorized"));
    const user = await userModel.findById(userId);
    if (!user || user.disable) return next(new Error("unauthorized"));
    socket.data.user = user;
    return next();
  } catch (_) {
    return next(new Error("unauthorized"));
  }
}

/** Joins `socket` to `kind:id` if its account is allowed there. Resolves to whether it joined. */
async function joinIfAllowed(socket, kind, id) {
  const user = socket.data?.user;
  if (!user || typeof id !== "string" || !mongoose.isValidObjectId(id)) return false;
  try {
    if (!isAdmin(user) && !(await ROOMS[kind].allowed(user, id))) return false;
  } catch (_) {
    return false;
  }
  socket.join(`${kind}:${id}`);
  return true;
}

/** Wires the room events for one authenticated connection. */
function registerSocketHandlers(io, socket) {
  console.log("A user connected:", socket.id);

  for (const [kind, room] of Object.entries(ROOMS)) {
    socket.on(room.join, async (id, ack) => {
      const joined = await joinIfAllowed(socket, kind, id);
      if (typeof ack === "function") ack({ ok: joined });
    });
    socket.on(room.leave, (id) => {
      if (typeof id === "string") socket.leave(`${kind}:${id}`);
    });
  }

  // Chat relay for client-to-client use. Only a socket that is already inside a room may speak into it.
  socket.on("sendMessage", (data) => {
    if (!data || typeof data !== "object") return;
    for (const kind of ["conversation", "business"]) {
      const id = data[`${kind}Id`];
      if (id && socket.rooms.has(`${kind}:${id}`)) {
        io.to(`${kind}:${id}`).emit("newWhatsAppMessage", data);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
}

module.exports = { authenticateSocket, registerSocketHandlers, handshakeToken };
