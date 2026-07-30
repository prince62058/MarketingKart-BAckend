const Redis = require("ioredis");

/**
 * Creates a new dedicated Redis connection for BullMQ.
 * BullMQ requires separate connection instances for Queue and Worker.
 * maxRetriesPerRequest: null and enableReadyCheck: false are mandatory for BullMQ v5.
 */
const createRedisConnection = () => {
  const options = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };

  const connection = process.env.REDIS_URL 
    ? new Redis(process.env.REDIS_URL, options)
    : new Redis({
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: parseInt(process.env.REDIS_PORT) || 6379,
        ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
        ...options
      });

  connection.on("error", (err) => {
    if (err.message.includes("NOAUTH")) {
      console.error("❌ [Redis] Authentication required but no password provided. Please check REDIS_PASSWORD in your .env file.");
    } else {
      console.error("[Redis] Connection error:", err.message);
    }
  });

  connection.on("connect", () => {
    console.log("[Redis] Connected successfully");
  });

  return connection;
};

module.exports = { createRedisConnection };
