// What reaches Meta's template API: private keys stripped, media links swapped for upload handles.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepareComponentsForMeta } = require("../src/services/whatsappCloudApiService");

test("components for Meta lose private keys and get upload handles for media links", async () => {
  const uploads = [];
  const fakeUpload = async ({ sourceUrl, accessToken }) => { uploads.push([sourceUrl, accessToken]); return `4::${uploads.length}`; };
  const stored = [
    { type: "HEADER", format: "LOCATION", _location: { latitude: 1, longitude: 2 } },
    { type: "BODY", text: "Hi" },
    { type: "carousel", cards: [{ components: [{ type: "header", format: "IMAGE", example: { header_handle: ["https://cdn.example/a.jpg"] }, _mediaUrl: "https://cdn.example/a.jpg" }] }] },
    { type: "HEADER", format: "IMAGE", example: { header_handle: ["4::already"] } },
  ];
  const out = await prepareComponentsForMeta(stored, "tok", fakeUpload);
  assert.deepEqual(out[0], { type: "HEADER", format: "LOCATION" });
  assert.deepEqual(out[2].cards[0].components[0], { type: "header", format: "IMAGE", example: { header_handle: ["4::1"] } });
  assert.deepEqual(out[3].example.header_handle, ["4::already"]);
  assert.deepEqual(uploads, [["https://cdn.example/a.jpg", "tok"]]);
  // Our stored copy is untouched, so sends can still read the media link.
  assert.equal(stored[2].cards[0].components[0]._mediaUrl, "https://cdn.example/a.jpg");
  assert.equal(stored[2].cards[0].components[0].example.header_handle[0], "https://cdn.example/a.jpg");
});
