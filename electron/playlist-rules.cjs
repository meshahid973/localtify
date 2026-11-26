"use strict";

const fields = {
  genre: "text", artist: "text", album: "text", title: "text", liked: "flag",
  plays: "count", finishes: "count", skips: "count", lastPlayed: "days", added: "days"
};
const operators = { text: ["contains", "excludes"], flag: ["is", "isNot"], count: ["atLeast", "atMost"], days: ["within", "notWithin"] };
const sorts = new Set(["library", "mostPlayed", "leastPlayed", "recentlyAdded", "recentlyPlayed", "random"]);

function cleanSmartRules(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !["all", "any"].includes(value.match) || !sorts.has(value.sort) ||
      !Array.isArray(value.rules) || value.rules.length > 12 ||
      (value.limit !== null && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 5000))) return undefined;
  const rules = [];
  for (const item of value.rules) {
    if (!item || typeof item.field !== "string" || !Object.hasOwn(fields, item.field)) return undefined;
    const kind = fields[item.field];
    if (!operators[kind].includes(item.op)) return undefined;
    let val = item.value;
    if (kind === "text") {
      if (typeof val !== "string" || !val.trim() || val.trim().length > 100) return undefined;
      val = val.trim();
    } else if (kind === "flag") {
      if (val !== "") return undefined;
    } else if (!Number.isInteger(val) || val < 0 || val > 100000) return undefined;
    rules.push({field: item.field, op: item.op, value: val});
  }
  return {match: value.match, rules, sort: value.sort, limit: value.limit};
}

function requireSmartRules(value) {
  if (value == null) return undefined;
  const rules = cleanSmartRules(value);
  if (!rules) throw new TypeError("Invalid smart playlist rules");
  return rules;
}

module.exports = {cleanSmartRules, requireSmartRules};
