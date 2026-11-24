const { randomUUID } = require("node:crypto");

function createSettingsFlushRuntime({ timeoutMs = 5000 } = {}) {
  const ready = new WeakSet();
  const requests = new WeakMap();
  function settle(contents, id, saved) {
    const pending = requests.get(contents);
    if (!pending || pending.id !== id) return false;
    requests.delete(contents);
    clearTimeout(pending.timer);
    pending.resolve(saved === true);
    return true;
  }
  return {
    ready(contents) { ready.add(contents); },
    hasReady(contents) { return Boolean(contents && ready.has(contents) && !contents.isDestroyed()); },
    forget(contents) {
      ready.delete(contents);
      const pending = requests.get(contents);
      if (pending) settle(contents, pending.id, false);
    },
    request(contents) {
      if (!this.hasReady(contents)) return Promise.resolve(true);
      const existing = requests.get(contents);
      if (existing) return existing.promise;
      const id = randomUUID();
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const timer = setTimeout(() => settle(contents, id, false), timeoutMs);
      requests.set(contents, { id, promise, resolve, timer });
      try { contents.send("settings:flush-request", id); }
      catch { settle(contents, id, false); }
      return promise;
    },
    complete(contents, id, saved) { return settle(contents, id, saved); }
  };
}
module.exports = { createSettingsFlushRuntime };
