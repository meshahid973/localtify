"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { createLastfmClient, createLastfmResponseCache } = require("../discover/lastfm.cjs");
const { discover, withoutOwned } = require("../discover/recommend.cjs");
const { catalogArtwork, createArtworkLookup, matchArtistArtwork, matchMusicArtwork, firstArtwork, withoutFailedArtwork } = require("../discover/artwork.cjs");
const { rankCatalog, searchTerms } = require("../discover/catalog.cjs");
const { safeDisplayCover } = require("../runtime/remote-cover.cjs");

const RESULT_TTL_MS = 12 * 60 * 60 * 1000;
// Biographies rarely change. Old ones are still shown while offline or when Last.fm fails.
const BIO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BIO_MAX_ENTRIES = 3000;
// A build can ship a key through the environment; one entered in Discover settings always wins.
const apiKeyFor = (settings) => {
  const override = String(settings.lastfmApiKey || "").trim();
  if (/^[0-9a-f]{32}$/i.test(override)) return override;
  return String(process.env.LOCALTIFY_LASTFM_API_KEY || "").trim();
};

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanText = (value) => typeof value === "string" ? value.trim().slice(0, 300) : "";
function normalizeCatalog(kind, items) {
  const endpoint = kind;
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items.slice(0, 100) : []) {
    if (!item || typeof item.id !== "string" || !MBID.test(item.id) || seen.has(item.id.toLowerCase())) continue;
    const title = cleanText(kind === "artist" ? item.name : item.title);
    if (!title) continue;
    const artist = Array.isArray(item["artist-credit"]) ? item["artist-credit"].slice(0, 12)
      .map(credit => cleanText(credit?.name || credit?.artist?.name)).filter(Boolean).join(", ").slice(0, 300) : "";
    const subtitle = kind === "artist"
      ? [cleanText(item.disambiguation), cleanText(item.country)].filter(Boolean).join(" · ")
      : [artist, cleanText(item["first-release-date"])].filter(Boolean).join(" · ");
    seen.add(item.id.toLowerCase());
    result.push({ id: item.id, title, artist, subtitle, url: "https://musicbrainz.org/" + endpoint + "/" + item.id, ...catalogArtwork(kind, item) });
  }
  return result;
}

/** Public catalog needs only opt-in; Last.fm personalized results require a valid key. */
function registerDiscoverIpc(router, { getSongs, getSettings, cacheFile, bioFile, fetch, musicBrainzClient, searchStore, lookupAudioDb, searchYouTubeMusic, searchYouTubeMusicRadio, searchYouTubeArtwork, lookupDeezer, lookupFanart, now = Date.now }) {
  let saved = null;
  let running = null;
  let catalogRunning = null;
  let artworkClient = null, artworkKey = "", closed = false;
  const active = () => !closed && getSettings().discoverEnabled === true;
  const strict = (provider,...args) => active() ? (provider.resolve || provider)(...args) : Promise.resolve({});
  // Shared response stores have one writer per file, including credential changes.
  const artworkResponses=createLastfmResponseCache({file:cacheFile?cacheFile+".artwork":"",now});
  const catalogResponses=createLastfmResponseCache({file:cacheFile||"",now});
  const configuration=()=>createHash("sha256").update(JSON.stringify([
    apiKeyFor(getSettings()),process.env.LOCALTIFY_AUDIODB_API_KEY||"",process.env.LOCALTIFY_FANART_API_KEY||"",
    !!lookupAudioDb,!!lookupFanart,!!lookupDeezer,!!searchYouTubeArtwork,!!musicBrainzClient
  ])).digest("hex");
  async function lookupMusicArtwork(title,artist,identity = {},signal,excluded=[]) {
    const cleanedArtist=artist.replace(/\s+[-–—]\s+Topic$/i,"").trim();
    const query=(title+" "+cleanedArtist).trim().slice(0,160);
    if(!active()||signal?.aborted)return [];
    const songs=await searchYouTubeArtwork("recording",query,{artwork:true});
    if(withoutFailedArtwork(matchMusicArtwork(songs,title,artist,identity),excluded).coverUrl)return songs;
    if(!active()||signal?.aborted)return [];
    const videos=await searchYouTubeArtwork("video",query,{artwork:true});
    return [...songs,...videos];
  }
  const lookupArtwork = createArtworkLookup(musicBrainzClient, now, async (title, artist) => {
    const settings = getSettings();
    const apiKey = apiKeyFor(settings);
    if (!active() || !/^[0-9a-f]{32}$/i.test(apiKey)) return null;
    if (!artworkClient || artworkKey !== apiKey) {
      artworkKey = apiKey;
      artworkClient = createLastfmClient({ apiKey, responseCache:artworkResponses, cacheFile:cacheFile ? cacheFile + ".artwork" : "", fetch, now, artwork:true });
    }
    return artworkClient.trackInfo(title,artist);
  }, lookupAudioDb ? (...args) => strict(lookupAudioDb,...args) : undefined, searchYouTubeArtwork ? lookupMusicArtwork : undefined,
    lookupDeezer ? (...args) => strict(lookupDeezer,...args) : undefined,
    lookupFanart ? (...args) => strict(lookupFanart,...args) : undefined,{file:cacheFile?cacheFile+".resolved-artwork-v1":""});
  // The resolver owns retention and coalescing for both entity types.
  async function lookupArtistArtwork(name,fallback=false,primaryOnly=false,excluded=[],retryPrimary=false) {
    const cleaned=name.replace(/\s+[-–—]\s+Topic$/i,"").trim();
    let failed=false;
    const primary=[
      searchYouTubeArtwork&& (async()=>matchArtistArtwork(await searchYouTubeArtwork("artist",cleaned.slice(0,160),{artwork:true}),name)),
      lookupDeezer&& (()=>strict(lookupDeezer,"artist",cleaned))
    ];
    if(!fallback) {
      try {
        const result=await firstArtwork(primary,{active,excluded,timeoutMs:primaryOnly?5000:0});
        if(result.coverUrl||primaryOnly||!active())return result;
      } catch(error) { if(primaryOnly)throw error; failed=true; }
    }
    const fanart=lookupFanart&&musicBrainzClient?.searchCatalog&&(async signal=>{
      const items=await musicBrainzClient.searchCatalog("artist",cleaned,{background:true});
      if(signal.aborted||!active())return {};
      const exact=(Array.isArray(items)?items:[]).filter(i=>MBID.test(i?.id||"")&&cleanText(i.name).normalize("NFKC").toLowerCase()===cleaned.normalize("NFKC").toLowerCase());
      const ids=[...new Set(exact.map(i=>i.id))];
      return ids.length===1 ? strict(lookupFanart,"artist",ids[0]) : {};
    });
    const result=await firstArtwork([fanart,...(fallback&&(excluded.length||retryPrimary)?primary:[])],{active,excluded});
    if(!result.coverUrl&&failed)throw Error("Artwork unavailable");
    return result;
  }
  // Explicit catalog IDs are authoritative. Never borrow another recording's
  // artwork just because its name and artist happen to match.
  async function lookupIdentifiedArtwork(kind, title, artist, identity, excluded) {
    const id = identity.providerId;
    if (id.startsWith("ytmusic:")) {
      if (!searchYouTubeArtwork) return {};
      return kind === "artist"
        ? matchArtistArtwork(await searchYouTubeArtwork("artist",title.slice(0,160),{artwork:true}),title,id)
        : matchMusicArtwork(await lookupMusicArtwork(title,artist,identity,undefined,excluded),title,artist,identity);
    }
    if (!musicBrainzClient) return {};
    const normalize = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
    if (kind === "artist") {
      if (!lookupFanart || !musicBrainzClient.searchCatalog) return {};
      const items = await musicBrainzClient.searchCatalog("artist",title,{background:true});
      if (!items.some(item=>item?.id===id && normalize(item.name)===normalize(title))) return {};
      return strict(lookupFanart,"artist",id);
    }
    const items = musicBrainzClient.getRecording ? [await musicBrainzClient.getRecording(id,{background:true})] : await musicBrainzClient.searchRecordings(title,artist,{background:true});
    const match = items.find(item=>item?.id===id &&
      normalize(item.title)===normalize(title) &&
      normalize((item["artist-credit"]||[]).map(credit=>(credit.name||credit.artist?.name||"")+(credit.joinphrase||"")).join(""))===normalize(artist) &&
      (!identity.durationMs || !Number.isFinite(item.length) || Math.abs(item.length-identity.durationMs)<=5000));
    if (!match) return {};
    const releases = Array.isArray(match.releases) ? match.releases : [];
    const selected = identity.album ? releases.filter(release=>normalize(release.title)===normalize(identity.album)) : releases;
    const primary = catalogArtwork("recording",{...match,releases:selected});
    const groups = [...new Set(selected.map(release=>release["release-group"]?.id).filter(value=>MBID.test(value||"")))];
    if (lookupFanart && groups.length===1 && active() && !withoutFailedArtwork(primary,excluded).coverUrl) {
      const alternate = withoutFailedArtwork(await strict(lookupFanart,"album",groups[0]),excluded);
      if(alternate.coverUrl)return {...alternate,...(primary.durationMs?{durationMs:primary.durationMs}:{})};
    }
    return primary;
  }
  router.handle("discover:get", async (_event, payload = {}) => {
    const settings = getSettings();
    // Expose only configuration presence; never return the application key to
    // the renderer, phone bridge, IPC logs, or saved settings.
    if (payload?.configuration === true) {
      const override = /^[0-9a-f]{32}$/i.test(String(settings.lastfmApiKey || "").trim());
      const defaultKey = /^[0-9a-f]{32}$/i.test(String(process.env.LOCALTIFY_LASTFM_API_KEY || "").trim());
      const configuration = { status: "configuration", lastfmSource: override ? "override" : defaultKey ? "default" : "missing" };
      if (payload.verify !== true || configuration.lastfmSource === "missing") return configuration;
      try {
        const client = createLastfmClient({ apiKey: apiKeyFor(settings), fetch, now });
        const track = await client.trackInfo("One More Time", "Daft Punk");
        return { ...configuration, lastfmCheck: track ? "ok" : "no-match" };
      } catch (error) {
        const code = error?.code;
        const lastfmCheck = ["bad-key", "rate-limited", "network", "http"].includes(code) ? code : "error";
        return { ...configuration, lastfmCheck };
      }
    }
    if (!active()) return { status: "off" };
    if (payload?.artwork !== undefined) {
      const { title, artist, kind = "recording", fallback = false, primaryOnly = false, providerId = "", album = "", durationMs = 0, failedUrls = [], retryPrimary = false } = payload.artwork || {};
      if (!["artist","recording"].includes(kind) || typeof title !== "string" || typeof artist !== "string" || !title.trim() || (kind === "recording" && !artist.trim()) || title.length > 300 || artist.length > 300)
        return { status: "error", error: "Invalid artwork lookup." };
      if (typeof providerId !== "string" || (providerId && !MBID.test(providerId) && !(kind === "artist" ? /^ytmusic:UC[A-Za-z0-9_-]{22}$/ : /^ytmusic:[A-Za-z0-9_-]{11}$/).test(providerId)) ||
          typeof album !== "string" || album.length > 300 || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86400000)
        return { status: "error", error: "Invalid artwork identity." };
      if(!Array.isArray(failedUrls)||failedUrls.length>8||!failedUrls.every(safeDisplayCover)) return {status:"error",error:"Invalid artwork candidates."};
      const excluded=[...new Set(failedUrls)].sort();
      const scope=configuration();
      const requestActive=()=>active()&&configuration()===scope;
      try {
        const normalizeKey = value => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
        const identity = { providerId, album: normalizeKey(album), durationMs };
        const key = JSON.stringify([kind, normalizeKey(title), normalizeKey(artist), providerId, identity.album, durationMs, fallback === true]);
        const options={cacheKey:key,fallback:fallback===true,primaryOnly:primaryOnly===true&&!providerId,active:requestActive,excluded,retryPrimary:retryPrimary===true,configuration:scope};
        const artwork=providerId||kind==="artist"
          ? await lookupArtwork.resolve(key,options,()=>providerId
            ? lookupIdentifiedArtwork(kind,title.trim(),artist.trim(),identity,excluded)
            : lookupArtistArtwork(title.trim(),options.fallback,options.primaryOnly,excluded,options.retryPrimary))
          : await lookupArtwork(title.trim(),artist.trim(),options);
        return requestActive() ? {status:"artwork",...artwork} : {status:"off"};
      } catch { return !requestActive() ? {status:"off"} : primaryOnly === true && !providerId ? {status:"artwork",outcome:"unavailable"} : { status: "error", error: "Artwork unavailable." }; }
    }
    if (payload?.catalog !== undefined) {
      const query = payload.catalog;
      const kind = query?.kind;
      const term = typeof query?.term === "string" ? query.term.trim() : "";
      if (!["recording", "artist"].includes(kind) || term.length < 2 || term.length > 160)
        return { status: "error", error: "Enter a search of 2–160 characters." };
      if (!musicBrainzClient) return { status: "error", error: "Public catalog is unavailable. Update the desktop application." };
      const radioSeed = query?.radioSeed;
      if (radioSeed !== undefined && (kind !== "recording" || typeof radioSeed !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(radioSeed) || !searchYouTubeMusicRadio)) return { status: "error", error: "Related songs unavailable." };
      const key = JSON.stringify([kind, term.toLowerCase(), radioSeed || ""]);
      if (catalogRunning && catalogRunning.key !== key)
        return { status: "error", error: "Another catalog search is in progress. Try again when it finishes." };
      if (!catalogRunning) {
        const promise = Promise.resolve().then(async () => {
          if (getSettings().discoverEnabled !== true) return [];
          if (radioSeed) return searchYouTubeMusicRadio(radioSeed);
          // Search YouTube Music only for explicit user queries, never library seeds.
          if (searchYouTubeMusic) {
            const direct = await searchYouTubeMusic(kind, term).catch(() => []);
            if (getSettings().discoverEnabled !== true) return [];
            if (Array.isArray(direct) && direct.length) {
              const normalize = value => String(value || "").normalize("NFKC").toLowerCase()
                .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
              const query = normalize(term);
              const relevant = kind === "recording"
                ? rankCatalog(term, direct)
                : direct.filter(item => normalize(item.title) === query || normalize(item.title).startsWith(query + " "));
              if (relevant.length) return relevant;
            }
          }
          // Artist searches retain the structured catalog; song searches combine
          // exact-title MusicBrainz matches, store metadata and listening popularity.
          if (kind !== "recording" || !searchStore) return normalizeCatalog(kind, await musicBrainzClient.searchCatalog(kind, term));
          const terms = searchTerms(term);
          const title = terms.at(-1);
          const settings = getSettings();
          const apiKey = apiKeyFor(settings);
          const lastfm = /^[0-9a-f]{32}$/i.test(apiKey) ? createLastfmClient({ apiKey, cacheFile, responseCache:catalogResponses, fetch, now }) : null;
          const jobs = [musicBrainzClient.searchCatalog(kind, title), searchStore(terms[0]), lastfm ? lastfm.searchTracks(title) : Promise.resolve([])];
          if (terms.length > 1) jobs.push(searchStore(title));
          const settled = await Promise.allSettled(jobs);
          if (settled.slice(0,2).every(result=>result.status==="rejected") && settled.slice(2).every(result=>result.status==="rejected"||!result.value?.length)) throw Error("Catalog unavailable");
          const items = index => settled[index]?.status === "fulfilled" ? settled[index].value : [];
          return rankCatalog(term, normalizeCatalog(kind, items(0)), [...items(1), ...items(3)], items(2));
        })
          .finally(() => { if (catalogRunning?.promise === promise) catalogRunning = null; });
        catalogRunning = { key, promise };
      }
      try {
        const items = await catalogRunning.promise;
        return getSettings().discoverEnabled === true ? { status: "catalog", kind, items } : { status: "off" };
      } catch {
        return getSettings().discoverEnabled === true
          ? { status: "error", error: "Could not search the music catalog. Check your connection and try again." }
          : { status: "off" };
      }
    }
    const apiKey = apiKeyFor(settings);
    if (!/^[0-9a-f]{32}$/i.test(apiKey)) return { status: "needs-key" };
    const current = { songs: getSongs(), hiddenArtists: Array.isArray(settings.notForMeArtists) ? settings.notForMeArtists : [] };
    if (payload?.refresh !== true && saved?.apiKey === apiKey && now() - saved.result.generatedAt < RESULT_TTL_MS) return withoutOwned(saved.result, current);
    if (running?.apiKey === apiKey) return running.promise.then((result) => withoutOwned(result, current));
    const client = createLastfmClient({ apiKey, cacheFile, ...(cacheFile?{responseCache:catalogResponses}:{}), fetch, now });
    const promise = (async () => {
      try {
        const result = await discover({ ...current, client, now: now() });
        // Requests from a previous API key must never overwrite the latest cached result.
        if (running?.apiKey === apiKey) saved = { apiKey, result };
        return result;
      } catch (error) {
        return { status: "error", error: error?.message || "Discover failed. Please try again." };
      } finally {
        if (running?.promise === promise) running = null;
      }
    })();
    running = { apiKey, promise };
    return promise.then((result) => withoutOwned(result, current));
  });

  // Biographies use Discover's existing opt-in. Only validated records enter the disk cache.
  let bios = null;
  let bioClient = null;
  const bioRequests = new Map();

  const readBios = () => {
    if (bios) return bios;
    let decoded;
    try { decoded = JSON.parse(fs.readFileSync(bioFile, "utf8")); } catch { decoded = null; }
    // Null-prototype dictionaries safely handle unusual artist names, including "__proto__".
    bios = Object.create(null);
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      for (const [artist, entry] of Object.entries(decoded)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const bio = entry.bio;
        if (bio !== null && (!bio || typeof bio !== "object" || Array.isArray(bio) ||
            !["name", "url", "summary", "content"].every((field) => typeof bio[field] === "string"))) continue;
        // Retain valid biographies with invalid timestamps for offline fallback.
        bios[artist] = entry;
      }
    }
    return bios;
  };

  /** Atomically replace the cache file so an interrupted write cannot truncate older biographies. */
  const writeBios = () => {
    if (!bioFile) return;
    const entries = Object.entries(readBios())
      .sort((a, b) => (Number(b[1].at) || 0) - (Number(a[1].at) || 0))
      .slice(0, BIO_MAX_ENTRIES);
    const snapshot = Object.fromEntries(entries);
    let tempFile = "";
    try {
      fs.mkdirSync(path.dirname(bioFile), { recursive: true });
      tempFile = path.join(path.dirname(bioFile), "." + path.basename(bioFile) + "." + process.pid + "." + randomUUID() + ".tmp");
      fs.writeFileSync(tempFile, JSON.stringify(snapshot), { flag: "wx" });
      fs.renameSync(tempFile, bioFile);
      bios = Object.assign(Object.create(null), snapshot);
    } catch {
      if (tempFile) {
        try { fs.rmSync(tempFile, { force: true }); } catch { /* Ignore cleanup errors. */ }
      }
      // Cache persistence failures should not prevent playback or biography display.
    }
  };
  const bioAnswer = (entry) => (entry?.bio ? { status: "ready", ...entry.bio } : { status: "none" });

  router.handle("discover:artist-bio", async (_event, payload = {}) => {
    const artist = String(payload?.artist || "").trim().slice(0, 300);
    if (!artist) return { status: "none" };
    const settings = getSettings();
    if (settings.discoverEnabled !== true) return { status: "off" };

    const key = artist.toLocaleLowerCase();
    const stored = readBios()[key];
    const storedAt = Number(stored?.at);
    if (stored && Number.isFinite(storedAt) && now() - storedAt >= 0 && now() - storedAt < BIO_TTL_MS) return bioAnswer(stored);

    const apiKey = apiKeyFor(settings);
    if (!/^[0-9a-f]{32}$/i.test(apiKey)) return stored ? bioAnswer(stored) : { status: "needs-key" };
    if (bioClient?.apiKey !== apiKey) bioClient = { apiKey, client: createLastfmClient({ apiKey, cacheFile: "", fetch }) };

    // Pending requests must be keyed by both API key and artist, not by artist alone.
    const requestKey = apiKey + ":" + key;
    let request = bioRequests.get(requestKey);
    if (!request) {
      request = bioClient.client.artistInfo(artist).finally(() => bioRequests.delete(requestKey));
      bioRequests.set(requestKey, request);
    }
    const obsoleteOrDisabled = () => {
      const latest = getSettings();
      if (latest.discoverEnabled !== true) return { status: "off" };
      return apiKeyFor(latest) === apiKey ? null : { status: "needs-key" };
    };
    try {
      const answer = await request;
      const blocked = obsoleteOrDisabled();
      if (blocked) return blocked;
      const entry = { at: now(), bio: answer };
      readBios()[key] = entry;
      writeBios();
      return bioAnswer(entry);
    } catch (error) {
      const blocked = obsoleteOrDisabled();
      if (blocked) return blocked;
      return stored ? bioAnswer(stored) : { status: "error", error: error?.message || "Couldn't load the biography." };
    }
  });
  const flush=()=>{lookupArtwork.flush();artworkResponses.flush();catalogResponses.flush();};
  return {flush,close(){closed=true;flush();}};
}

module.exports = { registerDiscoverIpc };
