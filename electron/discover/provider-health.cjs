"use strict";

function retryAfterMs(headers, now = Date.now()) {
  const value = headers?.get?.("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}
function providerCooldown(error) {
  const status = error?.status;
  const base = status === 401 || status === 403 || error?.code === "bad-key" ? 300000 :
    status === 429 || error?.code === "rate-limited" ? 60000 : 15000;
  return Math.max(base, error?.retryAfterMs || 0);
}
function unavailable() {
  const error = new Error("Artwork provider temporarily unavailable");
  error.code = "ARTWORK_UNAVAILABLE";
  return error;
}
module.exports = { retryAfterMs, providerCooldown, unavailable };
