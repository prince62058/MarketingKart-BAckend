// App-wide protections: security headers, CORS allowlist (when configured), removal of MongoDB
// operator keys from input, and the global /api rate limit.
const cors = require("cors");
const { limits } = require("./rateLimit");

// Pages the admin panel shows inside an iframe (another origin), so they may be framed.
const FRAMEABLE = [/^\/api\/getInvoiceHTML/, /^\/api\/invoice-template-preview/];
// Callbacks from Meta, payment providers and stores: high volume, signed, never rate limited here.
const NO_GLOBAL_LIMIT = [/^\/api\/whatsapp\/webhook/, /^\/api\/webhook\//, /^\/api\/webhooks\//, /payment-events$/, /\/webhooks\/razorpay$/, /^\/api\/v1\//];

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (!FRAMEABLE.some((re) => re.test(req.path))) res.setHeader("X-Frame-Options", "DENY");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
}

// CORS_ORIGINS="https://admin.example.com,https://wa.example.com" limits browsers to those sites.
// Without it every origin is allowed (bearer tokens, no cookies), as before.
function corsPolicy() {
  const list = String(process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return cors();
  return cors({
    origin(origin, done) {
      if (!origin) return done(null, true); // mobile app, server-to-server, curl
      const ok = list.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      return done(null, ok);
    },
  });
}

// Drops keys that start with "$" anywhere in the input, so a request cannot turn a field into a
// MongoDB operator (e.g. {"email": {"$ne": null}} or ?mobile[$gt]=).
function stripOperators(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 20) return value;
  if (Array.isArray(value)) { value.forEach((v) => stripOperators(v, depth + 1)); return value; }
  for (const key of Object.keys(value)) {
    if (key.startsWith("$")) delete value[key];
    else stripOperators(value[key], depth + 1);
  }
  return value;
}

// Page sizes above this would let one request read a whole collection.
const MAX_PAGE_SIZE = 1000;
const PAGE_KEYS = ["limit", "pageSize", "perPage", "page_size"];
const SEARCH_KEYS = ["search", "q", "keyword", "query"];

function sanitizeInput(req, _res, next) {
  stripOperators(req.body);
  stripOperators(req.query);
  stripOperators(req.params);
  const q = req.query || {};
  for (const k of PAGE_KEYS) {
    if (q[k] === undefined) continue;
    const n = parseInt(Array.isArray(q[k]) ? q[k][0] : q[k], 10);
    if (!Number.isFinite(n) || n < 1) delete q[k];
    else if (n > MAX_PAGE_SIZE) q[k] = String(MAX_PAGE_SIZE);
  }
  for (const k of SEARCH_KEYS) {
    if (q[k] === undefined) continue;
    const v = Array.isArray(q[k]) ? q[k][0] : q[k];
    q[k] = typeof v === "string" ? v.slice(0, 200) : "";
  }
  next();
}

function globalLimit(req, res, next) {
  if (!req.path.startsWith("/api/") || NO_GLOBAL_LIMIT.some((re) => re.test(req.path))) return next();
  return limits.api(req, res, next);
}

module.exports = { securityHeaders, corsPolicy, sanitizeInput, globalLimit, stripOperators };
