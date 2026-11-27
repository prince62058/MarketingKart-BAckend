// The key every login token is signed with. There is no fallback: a server without JWT_SECRET (or
// the older TOKEN_KEY) must not issue tokens signed with a value anyone can read in the source.
module.exports = function jwtSecret() {
  const key = process.env.JWT_SECRET || process.env.TOKEN_KEY;
  if (!key) throw Object.assign(new Error("JWT_SECRET is not set on this server"), { status: 503 });
  return key;
};
