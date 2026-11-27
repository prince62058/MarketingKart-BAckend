// Turns user text into a literal regex source, capped in length, so a search box cannot run a
// slow or wildcard pattern against the database.
module.exports = (text, max = 100) => String(text ?? "").slice(0, max).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
