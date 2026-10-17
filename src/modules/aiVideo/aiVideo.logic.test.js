const assert = require("assert");
const logic = require("./aiVideo.logic");
const { clean } = require("./aiVideo.script");

const script = logic.buildScript({ topic: "festive sale", tone: "urgent", language: "hinglish" });
assert.ok(script.includes("festive sale"));
assert.strictEqual(logic.estimateDuration("one two three four five"), "00:10");
assert.strictEqual(logic.formatClock(75), "01:15");

// Progress is an estimate: it moves, but never claims 100 before the provider finishes.
const started = Date.now();
const rendering = { status: "Rendering", renderStartedAt: new Date(started - 30000), script: "one two three" };
const mid = logic.estimateProgress(rendering, started);
assert.ok(mid > 3 && mid < 95, `mid-render progress was ${mid}`);
assert.strictEqual(logic.estimateProgress({ ...rendering, renderStartedAt: new Date(started - 3600000) }, started), 95);
assert.strictEqual(logic.estimateProgress({ ...rendering, renderStartedAt: new Date(started) }, started), 3);
assert.strictEqual(logic.estimateProgress({ status: "Completed" }), 100);
assert.strictEqual(logic.estimateProgress({ status: "Draft" }), 0);
assert.strictEqual(logic.estimateProgress({ status: "Failed" }), 0);

assert.strictEqual(logic.isRenderTimedOut({ status: "Rendering", renderStartedAt: new Date(started - 60 * 60 * 1000) }, started), true);
assert.strictEqual(logic.isRenderTimedOut({ status: "Rendering", renderStartedAt: new Date(started - 60 * 1000) }, started), false);
assert.strictEqual(logic.isRenderTimedOut({ status: "Completed", renderStartedAt: new Date(started - 3600000) }, started), false);

// A failed render reaches old clients as a Draft carrying an error.
const failed = logic.presentProject({ id: "a", status: "Failed", error: "boom", format: "9:16", createdAt: new Date() });
assert.strictEqual(failed.status, "Draft");
assert.strictEqual(failed.failed, true);
assert.strictEqual(failed.error, "boom");
assert.strictEqual(failed.videoUrl, null);

// A video url is only exposed once the render is complete.
const done = logic.presentProject({ id: "b", status: "Completed", videoUrl: "https://cdn/x.mp4", createdAt: new Date() });
assert.strictEqual(done.videoUrl, "https://cdn/x.mp4");
assert.strictEqual(logic.presentProject({ id: "c", status: "Rendering", videoUrl: "https://cdn/x.mp4", createdAt: new Date() }).videoUrl, null);

// New studios start with no invented projects and two stock presenters.
assert.strictEqual(typeof logic.seedProjects, "undefined");
assert.deepStrictEqual(logic.seedAvatars().map(item => item.id), ["priya", "raj"]);

// Provider avatar status never leaks through the client shape.
const avatar = logic.presentAvatar({ id: "p", name: "Me", status: "Failed", kind: "photo", heygenLookId: "secret-look" });
assert.ok(!("heygenLookId" in avatar));
assert.strictEqual(avatar.error, "Avatar could not be created.");

// Script cleaning: spoken words only, within the limit.
assert.strictEqual(clean('"Hello **world**! 🎉"', 100), "Hello world!");
assert.strictEqual(
  clean("Sentence one is quite long here. Sentence two is a lot longer than allowed.", 40),
  "Sentence one is quite long here.",
);
// No usable sentence boundary in the first half: hard cut at the limit instead of dropping most of the text.
assert.strictEqual(clean("Short. Then a very long run on sentence without any stop at all", 30).length, 30);

console.log("ai video logic ok");
