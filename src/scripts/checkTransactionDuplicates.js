// Read-only. Run this against the production database BEFORE deploying the unique indexes on
// transaction ids (src/models/transtionModel.js): if it prints anything, the index build will fail
// until those rows are sorted out. It changes nothing.
//
//   MONGO_URI="mongodb+srv://..." node src/scripts/checkTransactionDuplicates.js
const mongoose = require("mongoose");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGO_URI to the database to check.");
  process.exit(1);
}

(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const collection = mongoose.connection.db.collection("transtionmodels");

  for (const field of ["transactionId", "razorpayOrderId"]) {
    const duplicates = await collection
      .aggregate([
        { $match: { [field]: { $type: "string" } } },
        { $group: { _id: `$${field}`, count: { $sum: 1 }, ids: { $push: "$_id" }, types: { $push: "$type" } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 100 },
      ])
      .toArray();
    console.log(`${field}: ${duplicates.length} duplicated value(s)`);
    for (const row of duplicates) console.log(`  ${row._id} x${row.count} types=${row.types.join(",")} docs=${row.ids.join(",")}`);
  }
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
