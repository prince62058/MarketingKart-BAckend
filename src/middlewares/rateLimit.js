// Small in-memory rate limiter (fixed window per key). Enough to stop password guessing, OTP
// pumping and form spam on one server; with several servers each one counts on its own.
// Needs app.set("trust proxy", 1) so req.ip is the visitor, not the proxy.
const buckets = new Map();

function sweep(now) {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) if (b.reset <= now) buckets.delete(key);
}

/**
 * rateLimit({ name, windowMs, max, key }) → middleware.
 * key(req) adds to the IP (e.g. the email being tried); the IP is always part of the key.
 */
function rateLimit({ name, windowMs, max, key, message }) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === "test" && !process.env.RATE_LIMIT_IN_TESTS) return next();
    const now = Date.now();
    sweep(now);
    let extra = "";
    try { extra = key ? String(key(req) ?? "").toLowerCase().slice(0, 120) : ""; } catch (_) { extra = ""; }
    const id = `${name}|${req.ip}|${extra}`;
    let b = buckets.get(id);
    if (!b || b.reset <= now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(id, b);
    }
    b.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - b.count)));
    if (b.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ success: false, message: message || "Too many attempts. Please wait and try again." });
    }
    return next();
  };
}

function resetRateLimits() { buckets.clear(); }

const MIN = 60 * 1000;
const limits = {
  // Password logins: per IP + email, and per IP overall.
  passwordLogin: [
    rateLimit({ name: "pw-email", windowMs: 15 * MIN, max: 5, key: (req) => req.body?.email, message: "Too many sign-in attempts. Try again in 15 minutes." }),
    rateLimit({ name: "pw-ip", windowMs: 15 * MIN, max: 30, message: "Too many sign-in attempts. Try again in 15 minutes." }),
  ],
  // OTP sends and checks per IP (the OTP service also limits per number).
  otp: rateLimit({ name: "otp-ip", windowMs: 60 * MIN, max: 20, message: "Too many code requests. Try again later." }),
  publicForm: rateLimit({ name: "form-ip", windowMs: 60 * MIN, max: 10, message: "Too many submissions. Try again later." }),
  invoiceLink: rateLimit({ name: "invoice-ip", windowMs: 10 * MIN, max: 60 }),
  // A ceiling for everything under /api, high enough for real use.
  api: rateLimit({ name: "api-ip", windowMs: MIN, max: 1200, message: "Too many requests. Slow down." }),
};

module.exports = { rateLimit, limits, resetRateLimits };
