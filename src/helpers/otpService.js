// One place for every login OTP (mobile SMS and email): generate, store, rate-limit, verify.
//
// What an OTP is allowed to be:
//   - random (crypto), never returned in an API response and never logged
//   - stored only as a salted HMAC, with an expiry
//   - single use: a correct entry consumes it
//   - guessable only a few times: wrong entries are counted and the OTP dies after MAX_VERIFY_ATTEMPTS
//   - requestable only a few times per hour per account (kept in the database, so it holds across
//     restarts and across server instances)
//
// Test numbers (Play Store review, demos) are off unless OTP_TEST_ACCOUNTS is set on the server:
//   OTP_TEST_ACCOUNTS="9876543210=1234,9123456789=4321"
// A listed number gets that fixed OTP and no SMS. It still goes through expiry and attempt limits.
//
// TEMPORARY BRIDGE, off by default: ALLOW_FIXED_DEV_OTP=true makes every MOBILE login use the fixed OTP
// 1234 with no SMS, exactly as the app behaved before OTPs were real. It exists only so real users are not
// locked out while SMS (DLT) approval is pending. Anyone who knows a phone number can log in as it while
// this is on, so remove the variable the moment SMS works. It never applies to e-mail / admin OTPs.
const crypto = require("crypto");
const userModel = require("../models/userModel");
const generateOtp = require("./otpHelper");

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 3;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const FORMAT = "v2";

const hashSecret = () => process.env.OTP_HASH_SECRET || process.env.JWT_SECRET || process.env.TOKEN_KEY || "";

const digest = (salt, identity, otp) =>
  crypto.createHmac("sha256", hashSecret()).update(`${salt}:${identity}:${otp}`).digest("hex");

const hashOtp = (identity, otp) => {
  const salt = crypto.randomBytes(8).toString("hex");
  return `${FORMAT}$${salt}$${digest(salt, identity, String(otp))}`;
};

const matchesHash = (stored, identity, otp) => {
  const [format, salt, expected] = String(stored).split("$");
  if (format !== FORMAT || !salt || !expected) return false;
  const actual = Buffer.from(digest(salt, identity, String(otp)));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
};

const randomOtp = () => String(generateOtp());

const FIXED_DEV_OTP = "1234";
const fixedDevOtpEnabled = () => process.env.ALLOW_FIXED_DEV_OTP === "true";

const warnBridge = message => console.warn(`\n[SECURITY WARNING] ALLOW_FIXED_DEV_OTP=true: ${message}\n`);
if (fixedDevOtpEnabled()) {
  warnBridge("every mobile login uses the fixed OTP 1234 and no SMS is sent. Anyone can log in as any phone number. Temporary: remove this variable once SMS is live.");
}

/** Parses OTP_TEST_ACCOUNTS into { "9876543210": "1234" }. Anything malformed is ignored. */
const testAccounts = () => {
  const out = {};
  for (const pair of String(process.env.OTP_TEST_ACCOUNTS || "").split(",")) {
    const [mobile, otp] = pair.split("=").map(part => part && part.trim());
    if (/^\d{10}$/.test(mobile || "") && /^\d{4}$/.test(otp || "")) out[mobile] = otp;
  }
  return out;
};

/**
 * Stores a new OTP for `user` and returns it so the caller can send it.
 * `identity` is the mobile number or email the OTP is for (it is part of the hash).
 * Resolves to { ok: true, otp, isTestAccount } or { ok: false, reason: "rate_limited" }.
 */
async function issueOtp(user, identity, { allowFixedDev = false } = {}) {
  const listed = testAccounts()[String(identity)];
  // The bridge is only reachable from the mobile login endpoints, which pass allowFixedDev.
  const bridge = !listed && allowFixedDev && fixedDevOtpEnabled();
  const testOtp = listed || (bridge ? FIXED_DEV_OTP : undefined);
  const otp = testOtp || randomOtp();
  if (bridge) warnBridge(`fixed OTP issued for ******${String(identity).slice(-4)}; no SMS sent.`);

  // Compare-and-swap on the window counters: two parallel requests cannot both take the last slot.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await userModel.findById(user._id).select("otpWindowStart otpWindowCount").lean();
    if (!current) return { ok: false, reason: "not_found" };
    const now = Date.now();
    const started = current.otpWindowStart ? new Date(current.otpWindowStart).getTime() : 0;
    const inWindow = started && now - started < SEND_WINDOW_MS;
    const count = inWindow ? current.otpWindowCount || 0 : 0;
    if (!testOtp && count >= MAX_SENDS_PER_WINDOW) return { ok: false, reason: "rate_limited" };

    const result = await userModel.updateOne(
      {
        _id: user._id,
        otpWindowStart: current.otpWindowStart ?? null,
        otpWindowCount: current.otpWindowCount ?? null,
      },
      {
        $set: {
          otp: hashOtp(identity, otp),
          otpExpiresAt: new Date(now + OTP_TTL_MS),
          otpAttempts: 0,
          otpWindowStart: inWindow ? current.otpWindowStart : new Date(now),
          otpWindowCount: count + 1,
        },
        // Older code kept the OTP readable in this field.
        $unset: { otp2: "" },
      },
    );
    if (result.matchedCount === 1) return { ok: true, otp, isTestAccount: Boolean(testOtp) };
  }
  return { ok: false, reason: "rate_limited" };
}

/**
 * Checks `entered` against the OTP stored on `user`. A correct entry is consumed.
 * Resolves to { ok: true } or { ok: false, reason: "none" | "expired" | "locked" | "wrong" }.
 */
async function verifyOtp(user, identity, entered) {
  const stored = user.otp;
  // An OTP that does not carry the current format came from before this service existed. Those
  // never expired and (for the dev login) were the same for every account, so they are not honoured.
  if (!stored || !String(stored).startsWith(`${FORMAT}$`)) return { ok: false, reason: "none" };
  if (!user.otpExpiresAt || new Date(user.otpExpiresAt).getTime() < Date.now()) return { ok: false, reason: "expired" };

  // Count the try before looking at it, so parallel guesses cannot all slip under the limit.
  const counted = await userModel.findOneAndUpdate(
    { _id: user._id, otp: stored, otpAttempts: { $lt: MAX_VERIFY_ATTEMPTS } },
    { $inc: { otpAttempts: 1 } },
    { new: true },
  );
  if (!counted) return { ok: false, reason: "locked" };

  if (!matchesHash(stored, identity, String(entered ?? "").trim())) {
    if (counted.otpAttempts >= MAX_VERIFY_ATTEMPTS) {
      await userModel.updateOne({ _id: user._id, otp: stored }, { $set: { otp: null, otpExpiresAt: null } });
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "wrong" };
  }

  // Consume it. Of two parallel correct entries only one gets here first.
  const consumed = await userModel.updateOne(
    { _id: user._id, otp: stored },
    { $set: { otp: null, otpExpiresAt: null, otpAttempts: 0 } },
  );
  return consumed.modifiedCount === 1 ? { ok: true } : { ok: false, reason: "none" };
}

/** The message a client gets for a failed verify. Wrong stays the old wording the apps already show. */
const verifyFailureMessage = reason => {
  if (reason === "locked") return "Too many wrong attempts. Please request a new OTP.";
  if (reason === "wrong") return "Please provide valid OTP";
  if (reason === "expired") return "This OTP has expired. Please request a new OTP.";
  return "No OTP was requested for this number. Please request a new OTP.";
};

module.exports = {
  issueOtp,
  verifyOtp,
  verifyFailureMessage,
  testAccounts,
  fixedDevOtpEnabled,
  OTP_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
  MAX_SENDS_PER_WINDOW,
};
