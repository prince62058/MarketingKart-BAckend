const CHANNEL_ID = "mk_alerts_3";
const DEFAULT_NOTIFICATION_IMAGE =
  "https://sgp1.digitaloceanspaces.com/marketingkart.aii/MarketingKart/Notifications/app-logo.png";

function notificationImage(uploaded) {
  const value = typeof uploaded === "string" ? uploaded.trim() : "";
  return value || DEFAULT_NOTIFICATION_IMAGE;
}

function stringData(data = {}) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value == null ? "" : String(value)]),
  );
}

function buildFcmMessage({ token, tokens, title, body, image, data = {} }) {
  const picture = notificationImage(image);
  const payload = {
    notification: {
      title: String(title || "MarketingKart"),
      body: String(body || ""),
      image: picture,
    },
    data: stringData({ ...data, image: picture, title, body }),
    android: {
      priority: "high",
      notification: {
        channelId: CHANNEL_ID,
        sound: "mk_notify",
        priority: "max",
        visibility: "public",
        defaultSound: false,
        defaultVibrateTimings: false,
        vibrateTimingsMillis: [0, 280, 120, 280],
        imageUrl: picture,
        ticker: String(title || "MarketingKart"),
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
          "mutable-content": 1,
        },
      },
      fcmOptions: { imageUrl: picture },
    },
  };
  if (token) payload.token = token;
  if (tokens) payload.tokens = tokens;
  return payload;
}

module.exports = { CHANNEL_ID, DEFAULT_NOTIFICATION_IMAGE, notificationImage, buildFcmMessage };
