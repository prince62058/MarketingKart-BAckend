// Accounts and tokens for the security tests. Call after bootSecurityHarness(), which sets the JWT secret
// and loads nothing from the real environment.
const path = require("node:path");
const CryptoJS = require(path.join(__dirname, "..", "..", "node_modules", "crypto-js"));
const jwt = require(path.join(__dirname, "..", "..", "node_modules", "jsonwebtoken"));

const models = () => ({
  User: require("../../src/models/userModel"),
  Business: require("../../src/models/businessModel"),
});

let counter = 0;
const nextMobile = () => 9000000000 + (counter += 1);

const tokenFor = (user, expiresIn = "1d") => jwt.sign({ User: user._id, userId: user._id }, process.env.JWT_SECRET, { expiresIn });

async function makeUser(overrides = {}) {
  const { User } = models();
  return User.create({ name: "Customer", mobile: nextMobile(), userType: "USER", phoneVerified: true, ...overrides });
}

async function makeAdmin(overrides = {}) {
  const { User } = models();
  counter += 1;
  return User.create({
    name: "Admin",
    email: `admin${counter}@example.test`,
    mobile: nextMobile(),
    userType: "ADMIN",
    password: CryptoJS.AES.encrypt("Admin@123", "CRYPTOKEY").toString(),
    ...overrides,
  });
}

async function makeBusiness(owner, overrides = {}) {
  const { Business } = models();
  return Business.create({ businessName: "Shop", userId: owner._id, ...overrides });
}

module.exports = { makeUser, makeAdmin, makeBusiness, tokenFor, nextMobile };
