"use strict";

// Minimal Last.fm client for Discover: similar artists, an artist's top tracks and biography. Only artist names
// and song titles are sent. Responses are cached on disk for a week and requests are spaced to stay under 5 per second.
const { createResourceCache } = require("../runtime/resource-cache.cjs");
const { createHash } = require("node:crypto");
const { retryAfterMs, providerCooldown } = require("./provider-health.cjs");

const API_URL = "https://ws.audioscrobbler.com/2.0/";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;
const REQUEST_SPACING_MS = 220;
const TIMEOUT_MS = 12_000;

class LastfmError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function errorFor(code, message) {
  if (code === 10 || code === 26) return new LastfmError("Last.fm rejected the API key. Check it in Discover settings.", "bad-key");
  if (code === 29) return new LastfmError("Last.fm is rate limiting requests. Please try again in a minute.", "rate-limited");
  return new LastfmError(message || "Last.fm returned an error.", "lastfm");
}

const ENTITIES = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " " };

/** Last.fm biographies are HTML ending in a "Read more" link and a license line; the page shows its own attribution. */
/** Extract display text without depending on HTML-tag regular expressions. */
function stripHtmlTags(value) {
  let output = "";
  let inTag = false;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (!inTag) {
      if (char === "<" && /[A-Za-z!?\/]/.test(value[index + 1] || "")) {
        inTag = true;
      } else {
        output += char;
      }
    } else if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      inTag = false;
    }
  }
  return output;
}

/** Convert Last.fm's HTML biography into plain text for React text-node rendering. */
function bioText(html) {
  const cleaned = String(html || "")
    .replace(/<a\b[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, "")
    .replace(/User-contributed text is available under the Creative Commons By-SA License;?\s*additional terms may apply\.?/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n");
  const plain = stripHtmlTags(cleaned);
  const decoded = plain.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? match;
    const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  });
  // Encoded markup is treated as text, never as a tag or executable HTML.
  return stripHtmlTags(decoded)
    .replace(/\r\n?/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createLastfmResponseCache({file="",now=Date.now}={}) {
  const valid=value=>value&&typeof value==="object"&&!Array.isArray(value)&&!value.error;
  return createResourceCache({file,now,maxEntries:CACHE_MAX_ENTRIES,maxBytes:8*1024*1024,validate:valid,
    migrate:decoded=>decoded&&typeof decoded==="object"?Object.entries(decoded)
      .filter(([,row])=>Number.isFinite(row?.at)&&row.at<=now()&&valid(row.data)&&Object.keys(row.data).length)
      .sort((a,b)=>a[1].at-b[1].at).map(([key,row])=>[key,{value:row.data,expiresAt:row.at+CACHE_TTL_MS}]):[]});
}
function createLastfmClient({ apiKey, cacheFile, fetch = globalThis.fetch, now = Date.now, responseCache=createLastfmResponseCache({file:cacheFile,now}), artwork = false, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const pending=new Map();
  const scope=createHash("sha256").update(String(apiKey||"")).digest("hex");
  let nextSlot = 0, blockedUntil = 0, blockedError = null;

  async function call(method,params) {
    const key=method+"?"+new URLSearchParams(params);
    const missing="miss:"+createHash("sha256").update(key+scope).digest("hex");
    if(cacheFile)await responseCache.hydrate();
    const cached=responseCache.get(key)??responseCache.get(missing);
    if(cached!==undefined)return cached;
    if(pending.has(key))return pending.get(key);
    if(pending.size>=64)throw new LastfmError("Last.fm is temporarily busy.","rate-limited");
    const task=request(method,params).then(body=>{
      const field={"track.getinfo":"track","track.search":"results","artist.getinfo":"artist","artist.getsimilar":"similarartists","artist.gettoptracks":"toptracks"}[method];
      const found=field?Boolean(body[field]):Object.keys(body).length>0;
      const value=found?body:{};
      responseCache.set(found?key:missing,value,found?CACHE_TTL_MS:300000);
      return value;
    }).finally(()=>pending.delete(key));
    pending.set(key,task);
    return task;
  }
  async function request(method, params) {
    if (artwork && now() < blockedUntil) throw blockedError;
    const slot = Math.max(now(), nextSlot);
    nextSlot = slot + REQUEST_SPACING_MS;
    if (slot > now()) await wait(slot - now());
    if (artwork && now() < blockedUntil) throw blockedError;
    const url = `${API_URL}?${new URLSearchParams({ method, ...params, api_key: apiKey, format: "json", autocorrect: params.autocorrect ?? "1" })}`;
    let response;
    try {
      response = await fetch(url, { headers: { "User-Agent": "localtify" }, redirect: "error", credentials: "omit", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      blockedError = new LastfmError("Couldn't reach Last.fm. Check your connection and try again.", "network");
      blockedUntil = Math.max(blockedUntil, now()+15000);
      throw blockedError;
    }
    let body = null;
    try {
      const max = 2 * 1024 * 1024;
      if(Number(response.headers?.get?.("content-length")) > max) {
        await response.body?.cancel?.();
        throw Error("Oversized Last.fm response");
      }
      const reader=response.body?.getReader?.();
      if(reader){
        let size=0;const chunks=[];
        try {
          for(;;){
            const {done,value}=await reader.read();if(done)break;
            size+=value.byteLength;
            if(size>max){await reader.cancel();throw Error("Oversized Last.fm response");}
            chunks.push(Buffer.from(value));
          }
          body=JSON.parse(Buffer.concat(chunks,size).toString("utf8"));
        }finally{reader.releaseLock();}
      } else body = await response.json();
    } catch { /* handled below */ }
    if (body?.error) {
      // "Not found" is a normal answer for obscure artists and songs, so it's cached as empty.
      if (body.error !== 6) {
        const error=errorFor(body.error, body.message);
        if (["bad-key","rate-limited"].includes(error.code) || [11,16].includes(body.error)) {
          blockedError=error;
          blockedUntil=error.code==="bad-key"?Infinity:Math.max(blockedUntil,now()+providerCooldown({code:error.code,retryAfterMs:retryAfterMs(response.headers,now())}));
        }
        throw error;
      }
      body = {};
    } else if (!response.ok || !body) {
      const error = new LastfmError(`Last.fm answered with HTTP ${response.status}.`, "http");
      if (response.status === 429 || response.status >= 500 || response.status === 403) {
        blockedError=error;
        blockedUntil=Math.max(blockedUntil,now()+providerCooldown({status:response.status,retryAfterMs:retryAfterMs(response.headers,now())}));
      }
      throw error;
    }
    if(!body || typeof body!=="object" || Array.isArray(body))throw new LastfmError("Invalid Last.fm response.","http");
    return body;
  }

  const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const artistName = (item) => String(item?.artist?.name ?? item?.artist ?? "").trim();
  const mbid=value=>typeof value==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)?value.toLowerCase():undefined;
  return {
    async similarArtists(artist, limit = 30) {
      const body = await call("artist.getsimilar", { artist, limit: String(limit) });
      return list(body?.similarartists?.artist).map((item) => ({ name: String(item?.name || "").trim(), match: Number(item?.match) || 0, url: item?.url || "" }))
        .filter((item) => item.name);
    },
    async topTracks(artist, limit = 3) {
      const body = await call("artist.gettoptracks", { artist, limit: String(limit) });
      return list(body?.toptracks?.track).map((item) => ({ title: String(item?.name || "").trim(), artist: artistName(item) || artist, url: item?.url || "", ...(mbid(item?.mbid)?{recordingId:mbid(item.mbid)}:{}), ...(mbid(item?.artist?.mbid)?{artistIds:[mbid(item.artist.mbid)]}:{}), ...(Number(item?.duration)>0 && Number.isFinite(Number(item.duration)) ? {durationMs:Number(item.duration)*1000} : {}) }))
        .filter((item) => item.title).slice(0, limit);
    },
    async searchTracks(title, limit = 35) {
      const body = await call("track.search", { track: title, limit: String(limit), autocorrect:"0" });
      return list(body?.results?.trackmatches?.track).flatMap(item => {
        const title=String(item?.name||"").trim(), artist=artistName(item);
        let url; try { url=new URL(item.url); } catch { return []; }
        if(!title||!artist||!["www.last.fm","last.fm"].includes(url.hostname)||!["http:","https:"].includes(url.protocol)) return [];
        url.protocol="https:";
        return [{id:"lastfm:"+encodeURIComponent(artist)+":"+encodeURIComponent(title),title,artist,subtitle:artist,url:url.href,listeners:Number(item.listeners)||0}];
      }).slice(0,limit);
    },
    async trackInfo(title, artist) {
      return (await call("track.getinfo", { track: title, artist, autocorrect: "0" }))?.track || null;
    },
    async artistInfo(artist) {
      const info = (await call("artist.getinfo", { artist }))?.artist;
      const summary = bioText(info?.bio?.summary);
      const content = bioText(info?.bio?.content) || summary;
      if (!content) return null;
      return { name: String(info?.name || artist).trim(), url: String(info?.url || ""), summary: summary || content, content };
    },
    flush: responseCache.flush
  };
}

module.exports = { createLastfmClient, createLastfmResponseCache, LastfmError, API_URL, errorFor, bioText };
