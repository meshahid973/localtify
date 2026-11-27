"use strict";
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = value => typeof value === "string" && MBID.test(value);
const norm = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const credit = item => (Array.isArray(item?.["artist-credit"]) ? item["artist-credit"] : []).map(c => (c?.name || c?.artist?.name || "") + (c?.joinphrase || "")).join("");
const url = (kind, id) => validId(id) ? "https://coverartarchive.org/" + kind + "/" + id + "/front-250" : undefined;
function catalogArtwork(kind, item) {
  if (kind === "album") return {coverUrl:url("release-group",item.id)};
  if (kind !== "recording") return {};
  const releases = (Array.isArray(item?.releases) ? item.releases : []).filter(r => validId(r?.id) && (!r.status || r.status === "Official") && r["cover-art-archive"]?.front !== false);
  releases.sort((a,b) => Number(b["cover-art-archive"]?.front === true) - Number(a["cover-art-archive"]?.front === true) || String(a.date || "9999").localeCompare(String(b.date || "9999")));
  const release = releases[0];
  const alternatives = [...new Set(releases.flatMap(r => [url("release",r.id),url("release-group",r["release-group"]?.id)]).filter(Boolean))].slice(0,6);
  return {...(release ? {coverUrl:url("release",release.id),fallbackCoverUrl:url("release-group",release["release-group"]?.id),coverAlternatives:alternatives} : {}), ...(Number.isFinite(item.length) && item.length > 0 ? {durationMs:item.length} : {})};
}
function findRecording(items,title,artist,recordingId) {
  const matches=(Array.isArray(items)?items:[]).filter(item=>norm(item?.title)===norm(title)&&norm(credit(item))===norm(artist));
  const identified=validId(recordingId)?matches.find(item=>item.id===recordingId):undefined;
  return validId(recordingId) ? identified : (matches.length===1?matches[0]:undefined);
}
function lastfmArtwork(track,title,artist) {
  if (norm(track?.name)!==norm(title) || norm(track?.artist?.name)!==norm(artist)) return {};
  const images = Array.isArray(track?.album?.image) ? track.album.image : [];
  const coverUrl = images.slice().reverse().map(i=>i?.["#text"]).find(value=>typeof value==="string" && /^https:\/\/(?:lastfm\.freetls\.fastly\.net|lastfm-img2\.akamaized\.net)\/i\/u\/(?:[0-9]+x[0-9]+|[0-9]+s)\/[a-f0-9]{32}\.(?:png|jpe?g|webp)$/i.test(value) && !/2a96cbd8b46e442fc41c2b86b821562f|4128a6eb29f94943c9d206c08e625904/i.test(value));
  return coverUrl ? {coverUrl} : {};
}
// Reuse the catalog's actual artwork, accounting for formatting differences
// without stripping version markers (live, remix, slowed, etc.).
const {sameVersion}=require("./version-tags.cjs");
const {evaluateRecording,canonicalIdentity}=require("./track-identity.cjs");
const musicKey = value => norm(value).replace(/[^\p{L}\p{N}\p{M}]+/gu," ").trim();
const titleKey = value => musicKey(norm(value).replace(/\s*[([]\s*(?:official\s+(?:music\s+)?video|official\s+audio|lyric\s+video|official\s+lyric\s+video)\s*[)\]]\s*$/i,""));
const artistKey = value => musicKey(norm(value).replace(/\s+[-–—]\s+topic$/i,""));
// Keep every credited artist; normalize joiners without accepting substring matches.
const creditKey=value=>musicKey(norm(value).replace(/\s+[-–—]\s+topic$/i,"").replace(/\s+(?:feat\.?|ft\.?|and)\s+|\s*[,＆&]\s*/gi," "));
const equivalentArtist=(a,b)=>Boolean(artistKey(b))&&(artistKey(a)===artistKey(b)||creditKey(a)===creditKey(b));
function equivalentTitle(a,b,artist){
  if(!sameVersion(norm(a),norm(b)))return false;
  const keys=value=>{
    const full=norm(value),parts=full.split(/\s+[-–—]\s+/);
    return [titleKey(full),...(parts.length>1&&equivalentArtist(parts[0],artist)?[titleKey(parts.slice(1).join(" - "))]:[])];
  };
  return keys(a).some(key=>key&&keys(b).includes(key));
}
function matchMusicArtwork(items,title,artist,identity = {}) {
  const {safeThumbnail}=require("./youtube-music.cjs");
  const wantedArtist=artistKey(artist);
  const wantedTitle=titleKey(title);
  const source={title,artist,...identity};
  const identified=(Array.isArray(items)?items:[]).filter(item=>/^ytmusic:[A-Za-z0-9_-]{11}$/.test(item?.id||""));
  const decision=identified.length?evaluateRecording(source,identified,{requireKnownDuration:false}):null;
  if(decision?.status==="ambiguous"){
    const rows=decision.candidates,release=rows[0]?.albumId,cover=safeThumbnail(rows[0]?.coverUrl);
    return release&&cover&&rows.every(row=>row.albumId===release&&safeThumbnail(row.coverUrl)===cover)?{coverUrl:cover}:{};
  }
  if(decision?.status==="unresolved")return {};
  const pool=decision?.status==="matched"?[decision.candidate]:Array.isArray(items)?items:[];
  const matches=pool.filter(item=>(decision?.status==="matched"||equivalentTitle(item?.title,title,artist)&&equivalentArtist(item?.artist,artist)) &&
    (!identity.providerId || item.id === identity.providerId) &&
    (!identity.album || !item.album || norm(item.album) === norm(identity.album)) &&
    (!identity.durationMs || !Number.isFinite(item.durationMs) || Math.abs(item.durationMs-identity.durationMs) <= 5000))
    .map(item=>({...item,coverUrl:safeThumbnail(item.coverUrl)})).filter(item=>item.coverUrl);
  if(!wantedArtist||!wantedTitle||!matches.length)return {};
  // Different releases of the same exact song can have valid alternate art.
  // Reject conflicting known lengths rather than attaching an unrelated version.
  const lengths=matches.map(item=>item.durationMs).filter(v=>Number.isFinite(v)&&v>0);
  if(lengths.length>1&&Math.max(...lengths)-Math.min(...lengths)>5000)return {};
  const ranked=matches.slice().sort((a,b)=>Number(b.coverUrl.includes("googleusercontent"))-Number(a.coverUrl.includes("googleusercontent")));
  const item=ranked[0];
  const covers=[...new Set(ranked.flatMap(candidate=>{
    const id=/^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/.exec(candidate.url||"")?.[1];
    return [candidate.coverUrl,id?"https://i.ytimg.com/vi/"+id+"/hqdefault.jpg":undefined].filter(Boolean);
  }))].slice(0,6);
  return {coverUrl:item.coverUrl,...(covers.length>1?{coverAlternatives:covers}:{}),...(Number.isFinite(item.durationMs)&&item.durationMs>0?{durationMs:item.durationMs}:{})};
}
function enrichCatalogTrack(track, items, trace=()=>{}) {
  if (track.identity && track.coverUrl && require("../runtime/remote-cover.cjs").safeDisplayCover(track.coverUrl)) return track;
  const identity={album:track.album||"",durationMs:track.durationMs||0,providerId:track.providerId||"",recordingId:validId(track.recordingId)?track.recordingId:""};
  // Rank whole identities before selecting artwork. Do not discard a competing
  // candidate merely because it lacks a cover URL.
  const catalog=(Array.isArray(items)?items:[]).filter(item=>/^ytmusic:[A-Za-z0-9_-]{11}$/.test(item?.id||""));
  const wanted={...track,...identity};
  const decision=evaluateRecording(wanted,catalog);
  trace("recording-match",{state:decision.status,count:catalog.length});
  for(const [state,count] of Object.entries(decision.rejected||{}))trace("recording-rejection",{state,count});
  if(decision.status==="matched"){
    const item=decision.candidate,art=matchMusicArtwork([item],item.title,item.artist,{providerId:item.id});
    return {...track,...art,providerId:item.id,album:track.album||item.album||undefined,durationMs:track.durationMs||item.durationMs,
      ...(item.artistIds?.length?{catalogArtistIds:item.artistIds}:{}),...(item.albumId?{catalogAlbumId:item.albumId}:{}),
      identity:canonicalIdentity(item,{confidence:decision.score})};
  }
  if(decision.status==="ambiguous"){
    const rows=decision.candidates;
    const releaseId=rows[0]?.albumId,cover=rows[0]?.coverUrl;
    if(releaseId&&cover&&rows.every(item=>item.albumId===releaseId&&item.coverUrl===cover)&&require("../runtime/remote-cover.cjs").safeDisplayCover(cover))
      return {...track,coverUrl:cover};
    return track;
  }
  if(identity.providerId&&!validId(identity.providerId))return track;
  const recordings=(Array.isArray(items)?items:[]).filter(item=>validId(item?.id)).map(item=>Array.isArray(item["artist-credit"])?{...item,artist:credit(item),durationMs:item.length,album:identity.album&&item.releases?.some(r=>norm(r.title)===norm(identity.album))?identity.album:undefined}:item);
  const matched=evaluateRecording(wanted,recordings);
  if(matched.status!=="matched")return track;
  const recording=matched.candidate;
  // A previously normalized provider record retains its validated identity.
  if(!Array.isArray(recording.releases)){
    const safe=require("../runtime/remote-cover.cjs").safeDisplayCover;
    const coverUrl=safe(recording.coverUrl)?recording.coverUrl:undefined;
    return {...track,...(coverUrl?{coverUrl}:{}),recordingId:recording.id,album:track.album||recording.album,
      durationMs:track.durationMs||recording.durationMs,identity:canonicalIdentity(recording,{confidence:matched.score})};
  }
  // Recording search omits the front-art flag. An exact recording may supply
  // a release-based CAA candidate, just as ordinary catalog search does.
  // Never treat the candidate as proof the image exists, or use explicitly
  // unavailable releases or compilations in place of a known album.
  const all=(Array.isArray(recording.releases)?recording.releases:[]).filter(release=>validId(release?.id)&&(!release.status||release.status==="Official")&&
    release["cover-art-archive"]?.front!==false&&(!identity.album||norm(release.title)===norm(identity.album)));
  const normal=all.filter(release=>!(release["release-group"]?.["secondary-types"]||[]).includes("Compilation"));
  const releases=normal.length?normal:all;
  const art=catalogArtwork("recording",{...recording,releases});
  if(!art.coverUrl)return track;
  const albumNames=[...new Set(releases.map(r=>r.title).filter(Boolean))];
  const confirmed=releases.some(release=>release["cover-art-archive"]?.front===true);
  // Prefer the representative release-group image when availability is unknown.
  // Leave the existing name-based fallback available if this provisional image fails.
  const covers=[...new Set([...(confirmed?[art.coverUrl,art.fallbackCoverUrl]:[art.fallbackCoverUrl,art.coverUrl]),...(art.coverAlternatives||[])].filter(Boolean))].slice(0,confirmed?6:2);
  return {...track,...art,coverUrl:covers[0],fallbackCoverUrl:covers[1],coverAlternatives:covers,
    ...(confirmed?{providerId:recording.id}:{}),recordingId:recording.id,
    artistIds:[...new Set((recording["artist-credit"]||[]).map(c=>c.artist?.id).filter(validId))],
    album:track.album||(albumNames.length===1?albumNames[0]:undefined),durationMs:track.durationMs||art.durationMs,
    identity:canonicalIdentity({...recording,artist:credit(recording),album:albumNames.length===1?albumNames[0]:undefined,durationMs:art.durationMs,releaseDate:recording["first-release-date"],releaseId:releases.length===1?releases[0].id:undefined,releaseGroupId:releases.length===1?releases[0]["release-group"]?.id:undefined,coverUrl:covers[0],coverAlternatives:covers,url:"https://musicbrainz.org/recording/"+recording.id},{confidence:matched.score})};
}
function matchArtistArtwork(items,name,providerId = "") {
  const {safeThumbnail}=require("./youtube-music.cjs");
  const exact=(Array.isArray(items)?items:[]).filter(item=>artistKey(item?.title)===artistKey(name)&&(!providerId||item.id===providerId)&&/^ytmusic:UC[A-Za-z0-9_-]{22}$/.test(item.id||"")&&safeThumbnail(item.coverUrl));
  const unique=[...new Map(exact.map(item=>[item.id,item])).values()];
  return unique.length===1?{coverUrl:safeThumbnail(unique[0].coverUrl)}:{};
}
// Race verified candidates, with a short head start for the preferred source.
// Stop unstarted hedges and follow-up searches, not shared provider HTTP requests.
const { validArtworkResult } = require("../runtime/remote-cover.cjs");
const { unavailable, capacity } = require("./provider-health.cjs");
const { createResourceCache } = require("../runtime/resource-cache.cjs");
const { createHash } = require("node:crypto");
const artworkDigest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validCacheEntry = value => validArtworkResult(value) || (value && Object.keys(value).length === 1 && ["missing","unavailable"].includes(value.outcome));
function withoutFailedArtwork(value, excluded = []) {
  if (!validArtworkResult(value)) return {};
  if (!excluded.length && value.coverUrl) return value;
  const covers=[...new Set([value.coverUrl,value.fallbackCoverUrl,...(value.coverAlternatives||[])].filter(url=>url&&!excluded.includes(url)))];
  if(!covers.length)return {};
  return {coverUrl:covers[0],...(covers[1]?{fallbackCoverUrl:covers[1],coverAlternatives:covers.slice(0,6)}:{}),...(value.durationMs?{durationMs:value.durationMs}:{})};
}
function firstArtwork(jobs, { active = () => true, staggerMs = 350, excluded = [], timeoutMs = 0 } = {}) {
  const providers = jobs.filter(Boolean);
  if (!providers.length) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, failed = false, busy = false, settled = false, timer, deadline;
    const controller = new AbortController();
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      controller.abort();
      if (error) reject(error); else resolve(value);
    };
    const advance = () => {
      clearTimeout(timer);
      if (settled) return;
      if (!active()) { finish({}); return; }
      if (next === providers.length) {
        if (!running) finish({}, busy ? capacity() : failed ? unavailable() : undefined);
        return;
      }
      const work = providers[next++];
      running++;
      Promise.resolve().then(() => active()&&!controller.signal.aborted ? work(controller.signal) : {}).then(value => {
        if (settled) return;
        if (!active()) { finish({}); return; }
        const candidate=withoutFailedArtwork(value,excluded);
        if (candidate.coverUrl || candidate.fallbackCoverUrl) finish(candidate);
      }, error => { if(error?.code === "ARTWORK_CAPACITY") busy = true; else failed = true; }).finally(() => {
        running--;
        if (!settled) advance();
      });
      if (next < providers.length) timer = setTimeout(advance, staggerMs);
    };
    if(timeoutMs>0)deadline=setTimeout(()=>finish({},active()?unavailable():undefined),timeoutMs);
    advance();
  });
}
// Capacity is charged until the provider operation actually settles, even
// if a different source wins the race.
function boundedProvider(work, limit) {
  if (!work) return undefined;
  let running = 0;
  return async (...args) => {
    if (running >= limit) throw capacity();
    running++;
    try { return await work(...args); } finally { running--; }
  };
}
function createArtworkLookup(client,now=Date.now,trackInfo,lookupAudioDb,lookupMusic,lookupDeezer,lookupFanart,{file="",trace=()=>{}}={}) {
  const cache=createResourceCache({file,now,validate:validCacheEntry}), pending=new Map();
  const music = boundedProvider(lookupMusic, 4);
  const lastfm = boundedProvider(trackInfo, 4);
  const deezer = boundedProvider(lookupDeezer, 4);
  const audioDb = boundedProvider(lookupAudioDb, 2);
  const brainz = boundedProvider(client?.searchRecordings && (async (title,artist,recordingId) => validId(recordingId)&&client.getRecording ? [await client.getRecording(recordingId,{background:true})] : client.searchRecordings(title,artist,{background:true})), 2);
  const fanart = boundedProvider(lookupFanart, 2);
  let primaryRunning=0, fallbackRunning=0;
  // The single owner handles every entity and stage, including IPC catalog lookups.
  async function resolve(key,{fallback=false,primaryOnly=false,active=()=>true,excluded=[],retryPrimary=false,configuration=""}={},work) {
    if(!active())return {};
    if(key.length>1024)key="identity:"+artworkDigest(key);
    // Version negative entries independently: old false negatives must not suppress a repaired resolver.
    const requestKey="failure:v2:"+artworkDigest([key,primaryOnly,retryPrimary,excluded,configuration]);
    await cache.hydrate();
    if(!active())return {};
    let candidate=withoutFailedArtwork(cache.get(key),excluded);
    // A successfully resolved alternate is reusable on the next primary lookup.
    // Explicit fallback requests still select independent candidates.
    if(!candidate.coverUrl&&!fallback&&!excluded.length&&key.endsWith(",false]")){
      const alternateKey=key.slice(0,-6)+"true]";
      candidate=withoutFailedArtwork(cache.get(alternateKey),excluded);
    }
    if(candidate.coverUrl){trace("artwork-cache",{state:"hit"});return candidate;}
    if(pending.has(requestKey)){trace("artwork-cache",{state:"shared"});return pending.get(requestKey);}
    const negative=cache.get(requestKey);
    if(negative?.outcome==="missing"){trace("artwork-cache",{state:"negative-missing"});return {};}
    if(negative?.outcome==="unavailable"){trace("artwork-cache",{state:"negative-unavailable"});throw unavailable();}
    trace("artwork-cache",{state:"miss"});
    if(fallback ? fallbackRunning>=2 : primaryRunning>=4) throw capacity();
    if(fallback)fallbackRunning++;else primaryRunning++;
    const task=Promise.resolve().then(()=>active()?work():{}).then(value=>{
      if(!active())return {};
      const result=withoutFailedArtwork(value,excluded);
      if(result.coverUrl){cache.set(key,result,86400000);trace("artwork-resolved",{state:result.coverUrl.includes("coverartarchive.org")?"musicbrainz":result.coverUrl.includes("dzcdn.net")?"deezer":result.coverUrl.includes("lastfm")?"lastfm":"other"});}
      else {cache.set(requestKey,{outcome:"missing"},30000);trace("artwork-resolution",{state:"missing"});}
      return result;
    },error=>{
      if(active() && error?.code !== "ARTWORK_CAPACITY")cache.set(requestKey,{outcome:"unavailable"},15000);
      trace("artwork-resolution",{state:error?.code==="ARTWORK_CAPACITY"?"busy":"unavailable"});
      throw error;
    }).finally(()=>{pending.delete(requestKey);if(fallback)fallbackRunning--;else primaryRunning--;});
    pending.set(requestKey,task);
    return task;
  }
  const lookup = (title,artist,options={}) => {
    const {fallback=false,primaryOnly=false,active=()=>true,excluded=[],retryPrimary=false}=options;
    const key=options.cacheKey||JSON.stringify(["recording",norm(title),norm(artist),"","",0,fallback]);
    return resolve(key,options,async()=>{
      let track, knownRelease, failed=false, busy=false;
      const run = async jobs => {
        try { return await firstArtwork(jobs,{active,excluded,timeoutMs:primaryOnly?5000:9000}); }
        catch(error) { if(error?.code === "ARTWORK_CAPACITY") busy=true; else failed=true; return {}; }
      };
      const lastfmJob = lastfm && (async () => {
        track = await lastfm(title,artist);
        let primary = lastfmArtwork(track,title,artist);
        const verified = norm(track?.name)===norm(title)&&norm(track?.artist?.name)===norm(artist);
        const albumId=verified&&validId(track?.album?.mbid)?track.album.mbid.toLowerCase():"";
        knownRelease = albumId ? url("release",albumId) : undefined;
        if(albumId&&norm(track.album.title)&&norm(track.album.artist)&&active()){
          const albumKey="album:lastfm:"+artworkDigest([albumId,norm(track.album.title),norm(track.album.artist)]);
          if(primary.coverUrl)cache.set(albumKey,primary,86400000);
          else primary=withoutFailedArtwork(cache.get(albumKey),excluded);
        }
        return primary.coverUrl ? {...primary,...(knownRelease?{fallbackCoverUrl:knownRelease}:{})} : {};
      });
      const musicJob = music && (async signal => matchMusicArtwork(await music(title,artist,{},signal,excluded),title,artist));
      const deezerJob = deezer && (() => deezer("recording",title,artist));
      if (!fallback) {
        const primary = await run([musicJob,deezerJob,...(!musicJob&&!deezerJob?[lastfmJob]:[])]);
        if (primary.coverUrl || !active()) return primary;
        if (primaryOnly) {
          const known=withoutFailedArtwork(knownRelease?{coverUrl:knownRelease}:{},excluded);
          if(known.coverUrl)return known;
          if (busy) throw capacity();
          if (failed) throw unavailable();
          return {};
        }
      }
      // A broken primary image gets an independent catalog/album fallback.
      const catalog = brainz && (async signal => {
        const verified=norm(track?.name)===norm(title)&&norm(track?.artist?.name)===norm(artist);
        const items=await brainz(title,artist,verified?track?.mbid:undefined);
        if(signal.aborted||!active())return {};
        const matched=findRecording(items,title,artist,verified?track?.mbid:undefined);
        if(!matched)return {};
        const result=catalogArtwork("recording",matched);
        const groups=[...new Set((Array.isArray(matched.releases)?matched.releases:[]).filter(r=>!r.status||r.status==="Official").map(r=>r?.["release-group"]?.id).filter(validId))];
        const candidate=withoutFailedArtwork(result,excluded);
        if(fanart && groups.length===1 && (!candidate.coverUrl || (fallback&&!excluded.length))){
          try {
            const supplemental=await fanart("album",groups[0]);
            if(supplemental.coverUrl){
              const covers=[...new Set([supplemental.coverUrl,...(supplemental.coverAlternatives||[]),result.coverUrl,result.fallbackCoverUrl,...(result.coverAlternatives||[])].filter(Boolean))].slice(0,6);
              return {...result,coverUrl:covers[0],...(covers[1]?{fallbackCoverUrl:covers[1]}:{}),coverAlternatives:covers};
            }
          } catch (error) { if(!candidate.coverUrl)throw error; }
        }
        return result;
      });
      const alternate = await run(fallback
        ? [catalog,lastfmJob,audioDb&&(signal=>audioDb(title,artist,signal,cache,excluded)),...((excluded.length||retryPrimary)?[deezerJob,musicJob]:[])]
        : [catalog,...(musicJob||deezerJob?[lastfmJob]:[]),audioDb&&(signal=>audioDb(title,artist,signal,cache,excluded))]);
      if(alternate.coverUrl)return alternate;
      const known=withoutFailedArtwork(knownRelease?{coverUrl:knownRelease}:{},excluded);
      if(known.coverUrl)return known;
      if (busy && active()) throw capacity();
      if (failed && active()) throw unavailable();
      return {};
    });
  };
  lookup.cached=async(title,artist,identity={})=>{
    await cache.hydrate();
    const providerId=identity.providerId||"",album=norm(identity.album),durationMs=identity.durationMs||0;
    for(const fallback of [false,true]){
      const raw=JSON.stringify(["recording",norm(title),norm(artist),providerId,providerId?album:"",providerId?durationMs:0,fallback]);
      const value=withoutFailedArtwork(cache.get(raw.length>1024?"identity:"+artworkDigest(raw):raw));
      if(value.coverUrl&&(!durationMs||(value.durationMs&&Math.abs(value.durationMs-durationMs)<=5000)))return value;
    }
    return {};
  };
  lookup.resolve=resolve;
  lookup.flush=cache.flush;
  lookup.close=cache.close;
  return lookup;
}
module.exports={catalogArtwork,createArtworkLookup,lastfmArtwork,matchMusicArtwork,matchArtistArtwork,firstArtwork,withoutFailedArtwork,enrichCatalogTrack};
