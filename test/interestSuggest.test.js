const { test } = require("node:test");
const assert = require("node:assert/strict");
const { suggestInterests, parseNames } = require("../src/services/interestSuggestService");

function meta(id, name) {
  return { id, name, audience_size_lower_bound: 1000, audience_size_upper_bound: 5000, path: ["Business", name] };
}

function provider(interests) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ interests }) } }],
        }),
      },
    },
  };
}

test("interest names are read from the AI JSON and extra words are dropped", () => {
  const names = parseNames(JSON.stringify({
    interests: ["Online shopping", "online shopping", "A", "x".repeat(80), "Small business"],
  }));
  assert.deepEqual(names, ["Online shopping", "Small business"]);
});

test("AI interest names are matched to real Meta ids and the typed word stays first", async () => {
  const seen = [];
  const result = await suggestInterests({
    userId: "interest-ai-user",
    query: "shoes",
    searchMeta: async term => {
      seen.push(term);
      if (term === "shoes") return [meta("11", "Shoes")];
      if (term === "Footwear") return [meta("22", "Footwear"), meta("11", "Shoes")];
      return [meta("33", term)];
    },
    api: provider(["Footwear", "Sneakers"]),
  });

  assert.equal(result.ai, true);
  assert.deepEqual(result.interests.map(item => item.name), ["Shoes", "Footwear", "Sneakers"]);
  assert.deepEqual(seen, ["shoes", "Footwear", "Sneakers"]);
  assert.equal(result.interests[0].topic, "Shoes");
});

test("without an AI client the typed search is used on its own", async () => {
  const result = await suggestInterests({
    userId: "interest-plain-user",
    query: "marketing",
    searchMeta: async () => [meta("44", "Digital marketing")],
    api: null,
  });
  assert.equal(result.ai, false);
  assert.equal(result.interests[0].id, "44");
});
