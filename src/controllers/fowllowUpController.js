const leadModel = require("../models/leadModel");
const {
  sendNotificationToMultipleToken,
  sendNotificationToMultipleTokens,
} = require("../controllers/notificationController");

const notifiedBeforeSet = new Set();
const notifiedAtTimeSet = new Set();

const startFollowUpScheduler = () => {
    setInterval(async () => {
        try {
            const now = new Date();
            const day = now.getDate();
            const month = now.toLocaleString("default", { month: "short" }).toUpperCase();
            const year = now.getFullYear();
            const todayStr = `${day} ${month} ${year}`;

            // Find only leads for today
            const leads = await leadModel.find({
                followUpDate: todayStr
            }).lean();

            for (const lead of leads) {
                const rawTimeStr = lead.followUpTime?.trim();
                if (!rawTimeStr) continue;

                // Normalize time (e.g., 01:10pm -> 01:10 PM)
                const timeStr = rawTimeStr
                    .replace(/([0-9])([aApP][mM])$/, "$1 $2")
                    .toUpperCase();
                const parts = timeStr.split(/[: ]/);
                if (parts.length < 3) continue;

                let [hour, minute, ampm] = parts;
                hour = parseInt(hour);
                minute = parseInt(minute);
                if (isNaN(hour) || isNaN(minute)) continue;

                if (ampm === "PM" && hour !== 12) hour += 12;
                if (ampm === "AM" && hour === 12) hour = 0;

                const targetTime = new Date(year, now.getMonth(), day, hour, minute);
                const diff = Math.round((targetTime - now) / 60000); // difference in minutes

                const id = lead._id.toString();

                // Optimization: Skip if not within notification windows
                if (diff !== 10 && diff !== 0) continue;
                if (diff === 10 && notifiedBeforeSet.has(id)) continue;
                if (diff === 0 && notifiedAtTimeSet.has(id)) continue;

                // Only populate if we are actually going to send a notification
                const populated = await leadModel.findById(lead._id)
                    .populate({
                        path: "businessId",
                        populate: { path: "userId" },
                    })
                    .lean();

                const token = populated?.businessId?.userId?.fcm;
                if (!token) continue;

                if (diff === 10) {
                    let notificationPayload = {
                        customKey: "default",
                        type: "FollowUp",
                        title: "Follow Up Reminder",
                        description: "You have a pending follow-up reminder In 10 min",
                    };
                    console.log("Sending 10-minute reminder to:", token);
                    sendNotificationToMultipleToken([token], notificationPayload);
                    notifiedBeforeSet.add(id);
                }

                if (diff === 0) {
                    console.log("Sending ON-TIME reminder to:", token);
                    let notificationPayload = {
                        customKey: "default",
                        type: "FollowUp",
                        title: "Follow Up Reminder",
                        description: "🔔 It's time for your follow-up!",
                    };
                    sendNotificationToMultipleToken([token], notificationPayload);
                    notifiedAtTimeSet.add(id);
                }
            }
        } catch (err) {
            console.error("Follow-up interval error:", err);
        }
    }, 60000); // Every minute
    console.log("🚀 Follow-up reminder scheduler started (Every 1 min)");
};

module.exports = { startFollowUpScheduler };

