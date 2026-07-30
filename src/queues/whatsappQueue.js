const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redisConfig");

const whatsappQueue = new Queue("whatsapp-messages", {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

whatsappQueue.on("error", (err) => {
  console.error("[WhatsApp Queue] Error:", err.message);
});

module.exports = whatsappQueue;
