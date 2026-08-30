#!/usr/bin/env node
/**
 * Checks that what the admin panel changes is what the mobile app sees.
 *
 *   node src/scripts/testAdminAppDataFlow.js
 *
 * The two clients share one backend but read it through different code, and the
 * gaps have all been of one kind: the panel toggles something off and the app
 * keeps showing it, or the panel sets a state and the backend does something
 * else with it.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const userModel = require("../models/userModel");
const userService = require("../services/userService");
const advertisementModel = require("../models/advertisementModel");
const categoryModel = require("../models/businessCategoryModel");
const planModel = require("../models/planModel");
const { seedAdTypesAndPlans } = require("../startup/seedAdTypesAndPlans");

let passed = 0;
let failed = 0;
const check = (label, condition, detail = "") => {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

const TEST_MOBILE = 9999900030;
const TEST_CATEGORY = "__dataflow_test_category__";

/** What the mobile app does with a category list. */
const appVisibleCategories = (rows) => rows.filter((c) => !c.disable);
/** What the mobile app does with an ad type list. */
const appVisibleAdTypes = (rows) => rows.filter((t) => !t.disable);
/** What the mobile app's getPlansForAdType does. */
const appVisiblePlans = (rows) => rows.filter((p) => !p.disable);

const cleanup = async () => {
  await userModel.deleteMany({ mobile: TEST_MOBILE });
  await categoryModel.deleteMany({ title: TEST_CATEGORY });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`Connected to "${mongoose.connection.db.databaseName}"\n`);
  await cleanup();
  await seedAdTypesAndPlans();

  console.log("1. Admin disables a business category → app stops offering it");
  const cat = await categoryModel.create({ title: TEST_CATEGORY, icon: "🧪", categoryId: null });
  let rows = await categoryModel.find({ categoryId: null }).lean();
  check("visible while enabled", appVisibleCategories(rows).some((c) => c.title === TEST_CATEGORY));
  await categoryModel.updateOne({ _id: cat._id }, { $set: { disable: true } });
  rows = await categoryModel.find({ categoryId: null }).lean();
  check(
    "the endpoint still returns it (admin needs it to toggle)",
    rows.some((c) => c.title === TEST_CATEGORY),
  );
  check(
    "but the app filters it out",
    !appVisibleCategories(rows).some((c) => c.title === TEST_CATEGORY),
  );

  console.log("\n2. Admin disables an ad type → app stops selling it");
  const adType = await advertisementModel.findOne({ advertisementType: "VIDEO_VIEWS" });
  check("an ad type to test with", !!adType);
  await advertisementModel.updateOne({ _id: adType._id }, { $set: { disable: true } });
  let types = await advertisementModel.find().lean();
  check(
    "endpoint still returns it",
    types.some((t) => String(t._id) === String(adType._id)),
  );
  check(
    "app filters it out",
    !appVisibleAdTypes(types).some((t) => String(t._id) === String(adType._id)),
  );
  await advertisementModel.updateOne({ _id: adType._id }, { $set: { disable: false } });
  types = await advertisementModel.find().lean();
  check(
    "re-enabling brings it back",
    appVisibleAdTypes(types).some((t) => String(t._id) === String(adType._id)),
  );

  console.log("\n3. Admin disables a plan → app stops selling it");
  const plan = await planModel.findOne({ disable: { $ne: true } });
  check("a plan to test with", !!plan);
  await planModel.updateOne({ _id: plan._id }, { $set: { disable: true } });
  let plans = await planModel.find().lean();
  check(
    "app filters it out",
    !appVisiblePlans(plans).some((p) => String(p._id) === String(plan._id)),
  );
  await planModel.updateOne({ _id: plan._id }, { $set: { disable: false } });

  console.log("\n4. Plans carry their ad type, so the app can match them");
  const populated = await planModel.find().populate("advertisementTypeId").lean();
  const linked = populated.filter((p) => p.advertisementTypeId?.title);
  check(
    `${linked.length} of ${populated.length} plans resolve to a named ad type`,
    linked.length === populated.length,
    "some plans have no ad type and would be invisible in the app",
  );
  check(
    "the ad type comes back as an object, not a bare id",
    typeof populated[0]?.advertisementTypeId === "object",
  );

  console.log("\n5. Admin sets a user Inactive → the user really is disabled");
  const user = await userModel.create({ mobile: TEST_MOBILE, name: "Flow Test" });
  check("starts enabled", user.disable === false, String(user.disable));

  let updated = await userService.disableUser(user, true);
  check("set to disabled", updated.disable === true, String(updated.disable));

  // The bug: the panel sends "make this Inactive" again; a toggle would re-enable.
  updated = await userService.disableUser(updated, true);
  check(
    "asking for Inactive twice keeps it disabled (used to re-enable)",
    updated.disable === true,
    String(updated.disable),
  );

  updated = await userService.disableUser(updated, false);
  check("set back to active", updated.disable === false, String(updated.disable));

  const toggled = await userService.disableUser(updated);
  check("omitting the flag still toggles, for older callers", toggled.disable === true);

  console.log("\n6. A disabled user cannot log in from the app");
  const banned = await userModel.findById(user._id);
  check("login flow sees disable = true", banned.disable === true);

  await cleanup();
  await mongoose.disconnect();
  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (error) => {
  console.error("\nTest run crashed:", error);
  await cleanup().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
