// Login security, run against the real app and a throwaway mongod (never the .env database):
// OTPs are random, texted, never returned, expire, are single use and can only be guessed a few times;
// the Play Store test numbers are off unless configured; the admin e-mail OTP is a real check;
// disabled accounts lose their tokens.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
let h;
let User;
let Staff;
let CryptoJS;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  User = require("../src/models/userModel");
  Staff = require("../src/models/staffModel");
  CryptoJS = require(path.join(__dirname, "..", "node_modules", "crypto-js"));
});

after(async () => {
  if (h) await h.close();
});

const lastSms = mobile => [...h.sent.sms].reverse().find(entry => entry.mobile === String(mobile));
const lastMail = email => [...h.sent.mail].reverse().find(entry => entry.email === email);
const wrongOtpFor = otp => (otp === "1234" ? "4321" : "1234");

test("mobile OTP: texted to the number, random, and never in the response", { skip }, async () => {
  const mobile = 9100000001;
  const res = await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data, undefined, "the OTP must not come back in the response");
  assert.ok(!/\b\d{4}\b/.test(res.text.replace(/\d{10,}/g, "")), "no 4-digit code anywhere in the body");

  const sms = lastSms(mobile);
  assert.match(sms.otp, /^\d{4}$/);

  const doc = await User.findOne({ mobile }).lean();
  assert.ok(doc.otp.startsWith("v2$"), "stored as a salted hash");
  assert.ok(!doc.otp.includes(sms.otp));
  assert.equal(doc.otp2, undefined, "the readable copy of the OTP is gone");
  assert.ok(doc.otpExpiresAt > new Date());
});

test("mobile OTP: the old fixed 1234 does not log anyone in", { skip }, async () => {
  const mobile = 9100000002;
  await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
  const real = lastSms(mobile).otp;
  const res = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp: wrongOtpFor(real) } });
  assert.equal(res.status, 400);
  assert.equal(res.body.message, "Please provide valid OTP");
  assert.equal(res.body.data, undefined);
});

test("mobile OTP: the right code logs in once, returns a working token and no secrets", { skip }, async () => {
  const mobile = 9100000003;
  await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
  const { otp } = lastSms(mobile);

  const ok = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp } });
  assert.equal(ok.status, 200);
  const user = ok.body.data;
  assert.ok(user.token);
  for (const field of ["otp", "otp2", "otpExpiresAt", "otpAttempts", "password"]) assert.equal(user[field], undefined, field);

  const me = await h.call("GET", `/api/user/getByIdUser/${user._id}`, { token: user.token });
  assert.equal(me.status, 200, "the token works");

  const replay = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp } });
  assert.equal(replay.status, 400, "an OTP can be used only once");
});

test("mobile OTP: three wrong tries kill the OTP, even for the right code", { skip }, async () => {
  const mobile = 9100000004;
  await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
  const { otp } = lastSms(mobile);
  const wrong = wrongOtpFor(otp);
  for (let i = 0; i < 3; i += 1) {
    const res = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp: wrong } });
    assert.equal(res.status, 400);
  }
  const late = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp } });
  assert.equal(late.status, 400);
  assert.match(late.body.message, /new OTP/);

  // A fresh OTP works again.
  await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
  const fresh = lastSms(mobile).otp;
  const ok = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp: fresh } });
  assert.equal(ok.status, 200);
});

test("mobile OTP: expires", { skip }, async () => {
  const mobile = 9100000005;
  await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
  const { otp } = lastSms(mobile);
  await User.updateOne({ mobile }, { $set: { otpExpiresAt: new Date(Date.now() - 1000) } });
  const res = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp } });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /expired/);
});

test("mobile OTP: at most five requests per hour per number", { skip }, async () => {
  const mobile = 9100000006;
  for (let i = 0; i < 5; i += 1) {
    const res = await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
    assert.equal(res.status, 201, `request ${i + 1}`);
  }
  const sixth = await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
  assert.equal(sixth.status, 429);
  assert.equal(h.sent.sms.filter(entry => entry.mobile === String(mobile)).length, 5, "no SMS for the refused request");
});

test("mobile OTP: parallel requests cannot take more than the limit", { skip }, async () => {
  const mobile = 9100000007;
  const results = await Promise.all(Array.from({ length: 12 }, () => h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } })));
  const accepted = results.filter(r => r.status === 201).length;
  assert.ok(accepted <= 5, `accepted ${accepted}`);
});

test("mobile OTP: an OTP left over from before this fix (including the fixed 1234) is not honoured", { skip }, async () => {
  const mobile = 9100000008;
  await User.create({ mobile, otp: CryptoJS.AES.encrypt("1234", "CRYPTOKEY").toString(), otp2: "1234" });
  const res = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp: "1234" } });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /No OTP was requested/);
});

test("mobile OTP: all three login pairs use the same safe flow", { skip }, async () => {
  const pairs = [
    ["/api/user/mobileLogIn", "/api/user/verifyOtp", 9100000009],
    ["/api/user/sendOtpForMobile", "/api/user/verifyMobileOtp", 9100000010],
    ["/api/user/V2/mobileLogInV2", "/api/user/V2/verifyMobileOtpV2", 9100000011],
  ];
  for (const [send, verify, mobile] of pairs) {
    const sent = await h.call("POST", send, { body: { mobile } });
    assert.ok([200, 201].includes(sent.status), send);
    assert.equal(sent.body.data, undefined, `${send} leaked data`);
    const { otp } = lastSms(mobile);
    const bad = await h.call("POST", verify, { body: { mobile, otp: wrongOtpFor(otp) } });
    assert.equal(bad.status, 400, verify);
    const good = await h.call("POST", verify, { body: { mobile, otp } });
    assert.equal(good.status, 200, verify);
    assert.ok(good.body.data.token);
    assert.equal(good.body.data.password, undefined);
  }
});

test("test numbers: off by default, and only the listed number gets a fixed OTP with no SMS", { skip }, async () => {
  const reviewer = 9100000012;
  const customer = 9100000013;

  // Off: nothing is special about any number.
  await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile: reviewer } });
  assert.ok(lastSms(reviewer), "a real SMS goes out");

  process.env.OTP_TEST_ACCOUNTS = `${reviewer + 100}=4321, junk, 123=1111`;
  try {
    const listed = reviewer + 100;
    const smsBefore = h.sent.sms.length;
    const sent = await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile: listed } });
    assert.equal(sent.status, 201);
    assert.equal(h.sent.sms.length, smsBefore, "no SMS for a test number");
    const login = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile: listed, otp: "4321" } });
    assert.equal(login.status, 200);

    // A number that is not on the list is unaffected, even with the same code.
    await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile: customer } });
    const real = lastSms(customer).otp;
    if (real !== "4321") {
      const res = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile: customer, otp: "4321" } });
      assert.equal(res.status, 400);
    }

    // The fixed OTP still obeys the attempt limit.
    await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile: listed } });
    for (let i = 0; i < 3; i += 1) await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile: listed, otp: "0000" } });
    const locked = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile: listed, otp: "4321" } });
    assert.equal(locked.status, 400);
  } finally {
    delete process.env.OTP_TEST_ACCOUNTS;
  }

  const after = await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile: reviewer + 100 } });
  assert.equal(after.status, 201);
  const attempt = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile: reviewer + 100, otp: "4321" } });
  assert.equal(attempt.status, 400, "with the setting removed the number is a normal number again");
});

test("disabled accounts: cannot ask for an OTP, and a token they already hold stops working", { skip }, async () => {
  const user = await fixtures.makeUser();
  const token = fixtures.tokenFor(user);
  assert.equal((await h.call("GET", `/api/user/getByIdUser/${user._id}`, { token })).status, 200);

  await User.updateOne({ _id: user._id }, { $set: { disable: true } });
  const after = await h.call("GET", `/api/user/getByIdUser/${user._id}`, { token });
  assert.equal(after.status, 403);
  assert.equal(after.body.success, false);

  const login = await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile: user.mobile } });
  assert.equal(login.status, 400);
  assert.equal(h.sent.sms.filter(entry => entry.mobile === String(user.mobile)).length, 0);
});

test("admin e-mail OTP: the constant 1234 is no longer accepted", { skip }, async () => {
  const admin = await fixtures.makeAdmin();
  const asked = await h.call("POST", "/api/user/sendOtpForEmail", { body: { email: admin.email } });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.data, undefined, "the OTP is e-mailed, not returned");
  const { otp } = lastMail(admin.email);

  const bad = await h.call("POST", "/api/user/verifyAdminEmailOtp", { body: { email: admin.email, otp: wrongOtpFor(otp) } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.data, undefined);
});

test("admin e-mail OTP: the real OTP gives an admin token with that account's own permissions", { skip }, async () => {
  const admin = await fixtures.makeAdmin();
  await Staff.create({ userId: admin._id, role: "BDE", permissions: ["USERS"] });
  await h.call("POST", "/api/user/sendOtpForEmail", { body: { email: admin.email } });
  const { otp } = lastMail(admin.email);

  const ok = await h.call("POST", "/api/user/verifyAdminEmailOtp", { body: { email: admin.email, otp } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data.permission, ["USERS"], "not a blanket ALL");
  assert.equal(ok.body.data.password, undefined);
  assert.equal(ok.body.data.otp, undefined);

  const replay = await h.call("POST", "/api/user/verifyAdminEmailOtp", { body: { email: admin.email, otp } });
  assert.equal(replay.status, 400);
});

test("admin e-mail OTP: an ordinary customer cannot get an admin-signed token", { skip }, async () => {
  const customer = await fixtures.makeUser({ email: "customer.otp@example.test" });
  await h.call("POST", "/api/user/sendOtpForEmail", { body: { email: customer.email } });
  const { otp } = lastMail(customer.email);
  for (const guess of [otp, "1234"]) {
    const res = await h.call("POST", "/api/user/verifyAdminEmailOtp", { body: { email: customer.email, otp: guess } });
    assert.equal(res.status, 400);
    assert.equal(res.body.data, undefined);
  }
});

test("e-mail OTP: an admin account cannot be retyped to SUBUSER through the customer flow", { skip }, async () => {
  const admin = await fixtures.makeAdmin();
  await h.call("POST", "/api/user/sendOtpForEmail", { body: { email: admin.email } });
  const { otp } = lastMail(admin.email);
  const res = await h.call("POST", "/api/user/verifyEmailOtp", { body: { email: admin.email, otp } });
  assert.equal(res.status, 400);
  assert.equal((await User.findById(admin._id)).userType, "ADMIN");
});

test("password logins no longer hand the stored password back", { skip }, async () => {
  const admin = await fixtures.makeAdmin();
  const res = await h.call("POST", "/api/user/adminLogIn", { body: { email: admin.email, password: "Admin@123" } });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.token);
  assert.equal(res.body.data.password, undefined);
  assert.deepEqual(res.body.data.permission, ["ALL"]);
  const bad = await h.call("POST", "/api/user/adminLogIn", { body: { email: admin.email, password: "nope" } });
  assert.equal(bad.status, 400);
});

test("fixed-OTP bridge: only the exact value true switches it on; anything else stays secure", { skip }, async () => {
  const mobile = 9100000020;
  for (const value of ["false", "1", "TRUE", "yes", ""]) {
    process.env.ALLOW_FIXED_DEV_OTP = value;
    try {
      await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
      const real = lastSms(mobile).otp;
      if (real !== "1234") {
        const res = await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp: "1234" } });
        assert.equal(res.status, 400, `ALLOW_FIXED_DEV_OTP=${JSON.stringify(value)} must not enable the bridge`);
      }
    } finally {
      delete process.env.ALLOW_FIXED_DEV_OTP;
    }
  }
});

test("fixed-OTP bridge (ALLOW_FIXED_DEV_OTP=true): today's 1234 login keeps working, loudly, with no SMS and no OTP in the response", { skip }, async () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  process.env.ALLOW_FIXED_DEV_OTP = "true";
  try {
    const pairs = [
      ["/api/user/mobileLogIn", "/api/user/verifyOtp", 9100000021],
      ["/api/user/sendOtpForMobile", "/api/user/verifyMobileOtp", 9100000022],
      ["/api/user/V2/mobileLogInV2", "/api/user/V2/verifyMobileOtpV2", 9100000023],
    ];
    for (const [send, verify, mobile] of pairs) {
      const smsBefore = h.sent.sms.length;
      const sent = await h.call("POST", send, { body: { mobile } });
      assert.ok([200, 201].includes(sent.status), send);
      assert.equal(sent.body.data, undefined, "the OTP is still never in a response");
      assert.equal(h.sent.sms.length, smsBefore, "no SMS while the bridge is on");

      const doc = await User.findOne({ mobile }).lean();
      assert.ok(doc.otp.startsWith("v2$"), "still stored hashed");

      const login = await h.call("POST", verify, { body: { mobile, otp: "1234" } });
      assert.equal(login.status, 200, verify);
      assert.ok(login.body.data.token);
      assert.equal(login.body.data.password, undefined);
    }
    assert.ok(warnings.some(line => /SECURITY WARNING/.test(line) && /ALLOW_FIXED_DEV_OTP/.test(line)), "every use is logged loudly");
    assert.ok(!warnings.some(line => /910000002[123]\b/.test(line)), "the full phone number is not logged");

    // The bridge keeps the safety nets that do not get in a real user's way.
    const mobile = 9100000024;
    await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
    for (let i = 0; i < 3; i += 1) await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp: "0000" } });
    assert.equal((await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp: "1234" } })).status, 400, "still three tries per OTP");
    assert.equal((await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } })).status, 201, "re-requesting is never refused for hitting the hourly SMS limit");

    // Banned accounts are still banned.
    const banned = await fixtures.makeUser({ disable: true });
    assert.equal((await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile: banned.mobile } })).status, 400);

    // E-mail and admin OTPs are not part of the bridge.
    const admin = await fixtures.makeAdmin();
    await h.call("POST", "/api/user/sendOtpForEmail", { body: { email: admin.email } });
    const real = lastMail(admin.email).otp;
    if (real !== "1234") {
      const res = await h.call("POST", "/api/user/verifyAdminEmailOtp", { body: { email: admin.email, otp: "1234" } });
      assert.equal(res.status, 400);
    }

    // A listed test number keeps its own OTP.
    process.env.OTP_TEST_ACCOUNTS = "9100000025=4321";
    await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile: 9100000025 } });
    assert.equal((await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile: 9100000025, otp: "1234" } })).status, 400);
    assert.equal((await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile: 9100000025, otp: "4321" } })).status, 200);
  } finally {
    console.warn = realWarn;
    delete process.env.ALLOW_FIXED_DEV_OTP;
    delete process.env.OTP_TEST_ACCOUNTS;
  }

  // Switched off again: back to real OTPs immediately.
  const mobile = 9100000026;
  await h.call("POST", "/api/user/V2/mobileLogInV2", { body: { mobile } });
  const real = lastSms(mobile);
  assert.ok(real, "an SMS goes out again");
  if (real.otp !== "1234") assert.equal((await h.call("POST", "/api/user/V2/verifyMobileOtpV2", { body: { mobile, otp: "1234" } })).status, 400);
});
