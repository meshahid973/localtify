"use strict";

const { retryAfterMs, providerCooldown, unavailable, capacity } = require("../discover/provider-health.cjs");
const API = "https://musicbrainz.org/ws/2/";
const COVER_ART = "https://coverartarchive.org/";

/** Network failures are reported as such, so callers never mistake them for "no match". */
function unreachable(cause) {
  const error = new Error("Couldn't reach MusicBrainz. Check your internet connection and try again.");
  error.code = "MUSICBRAINZ_UNREACHABLE";
  error.cause = cause;
  return error;
}

/** Lucene phrase for MusicBrainz search queries. */
const phrase = (value) => `"${String(value || "").replace(/[\\"]/g, "\\$&")}"`;

/**
 * MusicBrainz asks clients to identify themselves and stay at one request per second.
 * Requests are queued, so concurrent callers share the limit.
 */
function createMusicBrainzClient({ userAgent, fetchImpl = fetch, minIntervalMs = 1100, timeoutMs = 15000, maxCacheEntries = 256, cacheTtlMs = 24 * 60 * 60 * 1000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let active = false;
  let lastAt = 0, backgroundBlockedUntil = 0;
  let foregroundStreak = 0;
  const cache = new Map();
  const inFlight = new Map();
  const waiting = [];

  function pump() {
    if (active || !waiting.length) return;
    const preferred = waiting.findIndex(job => !job.background);
    const background = waiting.findIndex(job => job.background);
    const index = foregroundStreak >= 8 && background >= 0 ? background : Math.max(0, preferred);
    const [job] = waiting.splice(index, 1);
    foregroundStreak = job.background ? 0 : foregroundStreak + 1;
    active = true;
    void job.run().then(job.resolve, job.reject).finally(() => {
      active = false;
      pump();
    });
  }

  function request(pathname, params = {}, { background = false, deadlineAt = 0 } = {}) {
    const url = new URL(pathname, API);
    for (const [key, value] of Object.entries({ ...params, fmt: "json" })) url.searchParams.set(key, value);
    const key = url.href;
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.promise;
    }
    cache.delete(key);
    const existing = inFlight.get(key);
    if (existing) {
      if (!background) existing.background = false;
      return existing.promise;
    }
    if (deadlineAt&&Date.now()>=deadlineAt) return Promise.reject(capacity());
    if (background && Date.now() < backgroundBlockedUntil) return Promise.reject(unavailable());
    if (waiting.length >= 128 || (background && waiting.filter(job => job.background).length >= 16)) {
      return Promise.reject(capacity());
    }
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const run = async () => {
      for (let attempt = 0; ; attempt += 1) {
        if (deadlineAt&&Date.now()>=deadlineAt) throw capacity();
        if (background && Date.now() < backgroundBlockedUntil) throw unavailable();
        const wait = lastAt + minIntervalMs - Date.now();
        if(deadlineAt&&Date.now()+Math.max(0,wait)>=deadlineAt)throw capacity();
        if (wait > 0) await sleep(wait);
        if (deadlineAt&&Date.now()>=deadlineAt) throw capacity();
        if (background && Date.now() < backgroundBlockedUntil) throw unavailable();
        lastAt = Date.now();
        const response = await fetchImpl(key, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(deadlineAt?Math.max(1,Math.min(timeoutMs,deadlineAt-Date.now())):timeoutMs) }).catch((error) => { if(background&&!deadlineAt)backgroundBlockedUntil=Date.now()+15000; throw unreachable(error); });
        if(response.status===429||response.status>=500)backgroundBlockedUntil=Math.max(backgroundBlockedUntil,Date.now()+providerCooldown({status:response.status,retryAfterMs:retryAfterMs(response.headers)}));
        // 503 means the rate limit was hit; back off and retry a couple of times.
        const retryDelay=retryAfterMs(response.headers);
        if (response.status === 503 && attempt < 2 && !background && retryDelay<=15000) { await sleep(Math.max(2000 * (attempt + 1), retryDelay)); continue; }
        if (!response.ok) throw response.status >= 500 ? unreachable(new Error(String(response.status))) : new Error(`MusicBrainz request failed (${response.status})`);
        return response.json();
      }
    };
    const entry = { promise, run, resolve, reject, background };
    // Remove an expired batch from the queue immediately, even if an earlier
    // unrelated request is still running. A started request has its own timeout.
    const deadlineTimer=deadlineAt?setTimeout(()=>{
      const index=waiting.indexOf(entry);
      if(index>=0){waiting.splice(index,1);reject(capacity());}
    },Math.max(1,deadlineAt-Date.now())):null;
    inFlight.set(key, entry);
    promise.then(() => {
      if(deadlineTimer!==null)clearTimeout(deadlineTimer);
      inFlight.delete(key);
      cache.set(key, { promise, expiresAt: Date.now() + Math.max(0, cacheTtlMs) });
      while (cache.size > Math.max(1, maxCacheEntries)) cache.delete(cache.keys().next().value);
    }, () => { if(deadlineTimer!==null)clearTimeout(deadlineTimer);inFlight.delete(key); });
    waiting.push(entry);
    pump();
    return promise;
  }

  return {
    searchCatalog: (kind, text, options) => {
      const fields = { recording: "recording", artist: "artist", album: "releasegroup" };
      const field = Object.hasOwn(fields, kind) ? fields[kind] : null;
      if (!field) throw new Error("Unsupported catalog search.");
      const endpoint = kind === "album" ? "release-group" : kind;
      const query = kind === "artist" ? "artist:" + phrase(text) : field + ":" + phrase(text);
      return request(endpoint, { query, limit: kind === "recording" ? "100" : "25" }, options).then(body => {
        const items = body[endpoint + "s"];
        return Array.isArray(items) ? items : [];
      });
    },
    searchRecordingBatch: (artist,tracks,options) => {
      const selected=(Array.isArray(tracks)?tracks:[]).slice(0,4);
      const unique=[...new Set(selected.flatMap(track=>{
        const id=track?.recordingId,title=typeof track==="string"?track:track?.title;
        if(typeof id==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))return ["rid:"+phrase(id)];
        return typeof title==="string"&&title.trim()&&title.length<=300?["recording:"+phrase(title)]:[];
      }))].sort();
      if(typeof artist!=="string"||!artist.trim()||artist.length>300||!unique.length)return Promise.resolve([]);
      const ids=unique.filter(term=>term.startsWith("rid:"));
      const titles=unique.filter(term=>!term.startsWith("rid:"));
      const artistIds=[...new Set(selected.flatMap(track=>Array.isArray(track?.artistIds)?track.artistIds:[]).filter(id=>typeof id==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)))];
      const artistQuery=artistIds.length===1?"arid:"+phrase(artistIds[0]):"artist:"+phrase(artist);
      const clauses=[...ids,...(titles.length?[`(${artistQuery} AND (${titles.join(" OR ")}))`]:[])];
      const query=ids.length?`(${clauses.join(" OR ")})`:`${artistQuery} AND (${titles.join(" OR ")})`;
      return request("recording",{query,limit:titles.length?"100":"10"},options).then(body=>Array.isArray(body.recordings)?body.recordings:[]);
    },
    searchRecordings: (title, artist, options) => request("recording", { query: `recording:${phrase(title)}${artist ? ` AND artist:${phrase(artist)}` : ""}`, limit: "25" }, options).then((body) => body.recordings || []),
    getRecording: (id, options) => request(`recording/${encodeURIComponent(id)}`, { inc: "artist-credits+releases+release-groups" }, options),
    searchReleases: (album, artist) => request("release", { query: `release:${phrase(album)}${artist ? ` AND artist:${phrase(artist)}` : ""}`, limit: "15" }).then((body) => body.releases || []),
    // Every edition of an album (standard, deluxe, regional…), with track counts.
    getReleaseGroupReleases: (id) => request("release", { "release-group": id, inc: "media", limit: "50" }).then((body) => body.releases || []),
    getRelease: (id) => request(`release/${encodeURIComponent(id)}`, { inc: "recordings artist-credits release-groups isrcs" }),
    getReleaseGroupGenres: (id) => request(`release-group/${encodeURIComponent(id)}`, { inc: "genres" }).then((body) => body.genres || []),
    getArtistGenres: (id) => request(`artist/${encodeURIComponent(id)}`, { inc: "genres" }).then((body) => body.genres || [])
  };
}

/** Front cover from the Cover Art Archive, falling back to the release group's cover. */
async function fetchCoverArt({ releaseId, releaseGroupId, userAgent, fetchImpl = fetch, maxBytes = 8 * 1024 * 1024 }) {
  const targets = [releaseId && `release/${releaseId}/front-500`, releaseGroupId && `release-group/${releaseGroupId}/front-500`].filter(Boolean);
  for (const target of targets) {
    const response = await fetchImpl(COVER_ART + target, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!response?.ok) continue;
    const type = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png"].includes(type)) { await response.body?.cancel?.().catch(() => undefined); continue; }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > maxBytes) { await response.body?.cancel?.().catch(() => undefined); continue; }
    let data;
    const reader = response.body?.getReader?.();
    if (reader) {
      const chunks = [];
      let total = 0;
      let exceeded = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) { exceeded = true; await reader.cancel(); break; }
          chunks.push(Buffer.from(value));
        }
      } catch { exceeded = true; }
      finally { reader.releaseLock?.(); }
      if (exceeded) continue;
      data = Buffer.concat(chunks, total);
    } else {
      // Older test doubles do not expose a stream; real fetch responses do.
      try { data = Buffer.from(await response.arrayBuffer()); } catch { continue; }
    }
    if (!data.length || data.length > maxBytes) continue;
    const png = type === "image/png";
    const signature = png ? Buffer.from("89504e470d0a1a0a", "hex") : Buffer.from("ffd8ff", "hex");
    if (!data.subarray(0, signature.length).equals(signature)) continue;
    return { data, ext: png ? ".png" : ".jpg" };
  }
  return null;
}

const coverThumbUrl = (releaseId) => releaseId ? `${COVER_ART}release/${releaseId}/front-250` : "";

module.exports = { createMusicBrainzClient, fetchCoverArt, coverThumbUrl, phrase };
