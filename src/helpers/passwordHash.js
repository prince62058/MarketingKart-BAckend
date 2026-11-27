// Password storage: scrypt with a random salt ("scrypt$<salt>$<hash>"), compared in constant time.
// Older accounts still hold AES ciphertext made with a fixed key; those are accepted once and
// upgraded to scrypt on that successful login, so nobody has to reset their password.
const crypto = require("crypto");
const CryptoJS = require("crypto-js");

const PREFIX = "scrypt$";
const KEYLEN = 64;
const LEGACY_AES_KEY = "CRYPTOKEY"; // only to read passwords saved before scrypt; never used to write

function hashPassword(plain) {
  const text = String(plain ?? "");
  if (text.length < 8) throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(text, salt, KEYLEN).toString("hex");
  return `${PREFIX}${salt}$${hash}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** { ok, upgrade }: upgrade is true when the stored value is the old format and should be re-saved. */
function verifyPassword(plain, stored) {
  if (!stored || plain === undefined || plain === null) return { ok: false, upgrade: false };
  const text = String(plain);
  const value = String(stored);
  if (value.startsWith(PREFIX)) {
    const [, salt, hash] = value.split("$");
    if (!salt || !hash) return { ok: false, upgrade: false };
    const actual = crypto.scryptSync(text, salt, KEYLEN).toString("hex");
    return { ok: safeEqual(actual, hash), upgrade: false };
  }
  try {
    const legacy = CryptoJS.AES.decrypt(value, LEGACY_AES_KEY).toString(CryptoJS.enc.Utf8);
    return { ok: Boolean(legacy) && safeEqual(legacy, text), upgrade: true };
  } catch (_) {
    return { ok: false, upgrade: false };
  }
}

module.exports = { hashPassword, verifyPassword };
