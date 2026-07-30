const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '../.env') });
const http = require("http");
const dbConfig = require("./config/dbConfig");
const { defaultResponseMessage } = require("./Message/defaultMessage");

const PORT = process.env.PORT || 9898;

(async () => {
    let server;
    try {
        // 1. Connect to the database first
        await dbConfig.connect();
        
        // 2. Load app and tasks only AFTER DB is ready to prevent premature queries
        const app = require("./app");
        const { initializeBackgroundTasks } = require("./startup/tasks");

        // 3. Initialize background tasks
        initializeBackgroundTasks();

        // 4. Create and start HTTP server
        server = http.createServer(app);

        // 5. Initialize Socket.io
        const { Server } = require("socket.io");
        const io = new Server(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST", "PUT"]
            }
        });

        // Make io accessible globally or via app
        // Make io accessible globally for use in controllers (e.g., WhatsApp webhooks)
        global.io = io;

        io.on("connection", (socket) => {
            console.log("A user connected:", socket.id);

            // WhatsApp campaign real-time room
            socket.on("joinCampaignRoom", (campaignId) => {
                socket.join(`campaign:${campaignId}`);
                console.log(`Socket ${socket.id} joined campaign:${campaignId}`);
            });

            socket.on("leaveCampaignRoom", (campaignId) => {
                socket.leave(`campaign:${campaignId}`);
            });

            // WhatsApp business real-time room (for Inbox updates)
            socket.on("joinBusinessRoom", (businessId) => {
                socket.join(`business:${businessId}`);
                console.log(`Socket ${socket.id} joined business:${businessId}`);
            });

            socket.on("leaveBusinessRoom", (businessId) => {
                socket.leave(`business:${businessId}`);
            });

            // Help & Support real-time room (per user)
            socket.on("joinUserRoom", (userId) => {
                socket.join(`user:${userId}`);
                console.log(`Socket ${socket.id} joined user:${userId}`);
            });

            socket.on("leaveUserRoom", (userId) => {
                socket.leave(`user:${userId}`);
            });

            socket.on("disconnect", () => {
                console.log("User disconnected:", socket.id);
            });
        });

        server.listen(PORT, '0.0.0.0', () => {
            console.log(defaultResponseMessage?.PORT, PORT);
        });

        server.setTimeout(10 * 60 * 1000);

        // Server error handling (e.g., EADDRINUSE)
        server.on("error", (error) => {
            if (error.code === "EADDRINUSE") {
                console.error(`❌ Port ${PORT} is already in use. Please kill the process or use a different port.`);
            } else {
                console.error("❌ Server error:", error);
            }
            process.exit(1);
        });

    } catch (error) {
        console.error("❌ Failed to start server:", error);
        process.exit(1);
    }

    // Graceful shutdown handlers
    const shutdown = async (signal) => {
        console.log(`\n shadowing Received ${signal}. Shutting down gracefully...`);
        if (server) {
            server.close(() => {
                console.log("HTTP server closed.");
            });
        }
        const mongoose = require("mongoose");
        await mongoose.connection.close();
        console.log("MongoDB connection closed.");
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Global error handlers to prevent silent crashes and provide logs
    process.on("unhandledRejection", (reason, promise) => {
        console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
    });

    process.on("uncaughtException", (error) => {
        console.error("❌ Uncaught Exception:", error);
        shutdown("uncaughtException");
    });
})();