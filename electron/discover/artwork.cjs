"use strict";
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = value => typeof value === "string" && MBID.test(value);
const norm = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const credit = item => (Array.isArray(item?.["artist-credit"]) ? item["artist-credit"] : []).map(c => (c?.name || c?.artist?.name || "") + (c?.joinphrase || "")).join("");
const url = (kind, id) => validId(id) ? "https://coverartarchive.org/" + kind + "/" + id + "/front-250" : undefined;
function catalogArtwork(kind, item) {
  if (kind === "album") return {coverUrl:url("release-group",item.id)};
  if (kind !== "recording") return {};
  const releases = (Array.isArray(item?.releases) ? item.releases : []).filter(r => validId(r?.id) && (!r.status || r.status === "Official"));
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
const musicKey = value => norm(value).replace(/[^\p{L}\p{N}\p{M}]+/gu," ").trim();
const titleKey = value => musicKey(norm(value).replace(/\s*[([]\s*(?:official\s+(?:music\s+)?video|official\s+audio|lyric\s+video|official\s+lyric\s+video)\s*[)\]]\s*$/i,""));
const artistKey = value => musicKey(norm(value).replace(/\s+[-–—]\s+topic$/i,""));
const equivalentArtist=(a,b)=>artistKey(a)===artistKey(b) && Boolean(artistKey(b));
function matchMusicArtwork(items,title,artist,identity = {}) {
  const {safeThumbnail}=require("./youtube-music.cjs");
  const wantedArtist=artistKey(artist);
  const wantedTitle=titleKey(title);
  const artistPrefix=norm(title).split(/\s+-\s+/);
  const titleKeys=new Set([wantedTitle]);
  if(artistPrefix.length>1 && artistKey(artistPrefix[0])===wantedArtist) titleKeys.add(titleKey(artistPrefix.slice(1).join(" - ")));
  const matches=(Array.isArray(items)?items:[]).filter(item=>titleKeys.has(titleKey(item?.title))&&equivalentArtist(item?.artist,artist) &&
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
function matchArtistArtwork(items,name,providerId = "") {
  const {safeThumbnail}=require("./youtube-music.cjs");
  const exact=(Array.isArray(items)?items:[]).filter(item=>artistKey(item?.title)===artistKey(name)&&(!providerId||item.id===providerId)&&/^ytmusic:UC[A-Za-z0-9_-]{22}$/.test(item.id||"")&&safeThumbnail(item.coverUrl));
  const unique=[...new Map(exact.map(item=>[item.id,item])).values()];
  return unique.length===1?{coverUrl:safeThumbnail(unique[0].coverUrl)}:{};
}
// Race verified candidates, with a short head start for the preferred source.
// Stop unstarted hedges and follow-up searches, not shared provider HTTP requests.
const { validArtworkResult } = require("../runtime/remote-cover.cjs");
const { unavailable } = require("./provider-health.cjs");
function withoutFailedArtwork(value, excluded = []) {
  if (!validArtworkResult(value)) return {};
  if (!excluded.length) return value;
  const covers=[...new Set([value.coverUrl,value.fallbackCoverUrl,...(value.coverAlternatives||[])].filter(url=>url&&!excluded.includes(url)))];
  if(!covers.length)return {};
  return {coverUrl:covers[0],...(covers[1]?{fallbackCoverUrl:covers[1],coverAlternatives:covers.slice(0,6)}:{}),...(value.durationMs?{durationMs:value.durationMs}:{})};
}
function firstArtwork(jobs, { active = () => true, staggerMs = 350, excluded = [], timeoutMs = 0 } = {}) {
  const providers = jobs.filter(Boolean);
  if (!providers.length) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, failed = false, settled = false, timer, deadline;
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
        if (!running) finish({}, failed ? unavailable() : undefined);
        return;
      }
      const work = providers[next++];
      running++;
      Promise.resolve().then(() => active()&&!controller.signal.aborted ? work(controller.signal) : {}).then(value => {
        if (settled) return;
        if (!active()) { finish({}); return; }
        const candidate=withoutFailedArtwork(value,excluded);
        if (candidate.coverUrl || candidate.fallbackCoverUrl) finish(candidate);
      }, () => { failed = true; }).finally(() => {
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
    if (running >= limit) throw unavailable();
    running++;
    try { return await work(...args); } finally { running--; }
  };
}
function createArtworkLookup(client,now=Date.now,trackInfo,lookupAudioDb,lookupMusic,lookupDeezer,lookupFanart) {
  const cache=new Map(), pending=new Map();
  const music = boundedProvider(lookupMusic, 4);
  const lastfm = boundedProvider(trackInfo, 4);
  const deezer = boundedProvider(lookupDeezer, 4);
  const audioDb = boundedProvider(lookupAudioDb, 2);
  const brainz = boundedProvider(client?.searchRecordings && (async (title,artist,recordingId) => validId(recordingId)&&client.getRecording ? [await client.getRecording(recordingId,{background:true})] : client.searchRecordings(title,artist,{background:true})), 2);
  const fanart = boundedProvider(lookupFanart, 2);
  let primaryRunning=0, fallbackRunning=0;
  return async (title,artist,{fallback=false,primaryOnly=false,active=()=>true,excluded=[],retryPrimary=false}={}) => {
    const key=JSON.stringify([norm(title),norm(artist),fallback]), hit=cache.get(key);
    const requestKey=JSON.stringify([key,primaryOnly,retryPrimary,excluded]);
    if(hit && now()-hit.at<86400000) {
      cache.delete(key); cache.set(key,hit);
      const candidate=withoutFailedArtwork(hit.value,excluded);
      if(candidate.coverUrl||candidate.fallbackCoverUrl)return candidate;
    } else cache.delete(key);
    if(pending.has(requestKey)) return pending.get(requestKey);
    if(fallback ? fallbackRunning>=2 : primaryRunning>=4) throw unavailable();
    if(fallback)fallbackRunning++;else primaryRunning++;
    const task=Promise.resolve().then(async()=>{
      let track, failed=false;
      const run = async jobs => {
        try { return await firstArtwork(jobs,{active,excluded,timeoutMs:primaryOnly?5000:0}); }
        catch { failed=true; return {}; }
      };
      const lastfmJob = lastfm && (async () => {
        track = await lastfm(title,artist);
        const primary = lastfmArtwork(track,title,artist);
        const verified = norm(track?.name)===norm(title)&&norm(track?.artist?.name)===norm(artist);
        const release = verified && validId(track?.album?.mbid) ? url("release",track.album.mbid) : undefined;
        return primary.coverUrl ? {...primary,...(release?{fallbackCoverUrl:release}:{})} :
          (release ? {coverUrl:release} : {});
      });
      const musicJob = music && (async signal => matchMusicArtwork(await music(title,artist,{},signal,excluded),title,artist));
      const deezerJob = deezer && (() => deezer("recording",title,artist));
      if (!fallback) {
        const primary = await run([musicJob,lastfmJob,deezerJob]);
        if (primary.coverUrl || !active()) return primary;
        if (primaryOnly) {
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
          } catch (error) { if(!result.coverUrl)throw error; }
        }
        return result;
      });
      const alternate = await run(fallback
        ? [catalog,lastfmJob,audioDb&&(signal=>audioDb(title,artist,signal)),...((excluded.length||retryPrimary)?[deezerJob,musicJob]:[])]
        : [audioDb&&(signal=>audioDb(title,artist,signal)),catalog]);
      if (!alternate.coverUrl && failed && active()) throw unavailable();
      return alternate;
    }).then(value=>{
      if(active() && validArtworkResult(value)) cache.set(key,{at:now(),value});
      while(cache.size>512) cache.delete(cache.keys().next().value);
      return value;
    }).finally(()=>{pending.delete(requestKey);if(fallback)fallbackRunning--;else primaryRunning--;});
    pending.set(requestKey,task);
    return task;
  };
}
module.exports={catalogArtwork,createArtworkLookup,lastfmArtwork,matchMusicArtwork,matchArtistArtwork,firstArtwork,withoutFailedArtwork};
