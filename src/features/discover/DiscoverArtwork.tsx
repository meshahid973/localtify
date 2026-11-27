import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { observeArtwork, observeVisibleArtwork, getResolvedRemoteArtwork, invalidateResolvedRemoteArtwork, resolveRemoteArtwork } from "../covers/thumbnailResource";
import { Disc3, UserRound } from "lucide-react";
import type { DiscoverArtwork, DiscoverResult, DiscoverTrack } from "./discover.types";
import { buildDiscoverShelves } from "./discoverShelves";
import { discoverTrace, discoverImageTrace } from "./discoverDiagnostics";
const cache = new Map<string, {at:number; value:DiscoverArtwork}>();
type ArtworkJob = { priority: number; queuedAt: number; person: boolean; users: number; started: boolean; promise: Promise<DiscoverResult | null>; run: () => Promise<void>; cancel: () => void };
const primaryQueue: ArtworkJob[] = [], fallbackQueue: ArtworkJob[] = [];
const sharedLookups = new Map<string, ArtworkJob>();
let primaryRunning = 0, fallbackRunning = 0, portraitsRunning = 0;
function takeArtwork(queue: ArtworkJob[]) {
  const now=performance.now();
  const rank=(job:ArtworkJob)=>job.priority-Math.floor((now-job.queuedAt)/5000);
  let best=-1;
  for(let i=0;i<queue.length;i++) {
    if(queue[i].person&&portraitsRunning>=1)continue;
    if(best<0||rank(queue[i])<rank(queue[best]))best=i;
  }
  return best<0?undefined:queue.splice(best,1)[0];
}
function pumpArtwork() {
  while (primaryRunning < 4 && primaryQueue.length) {
    const job = takeArtwork(primaryQueue);
    if(!job)break;
    primaryRunning++;if(job.person)portraitsRunning++;
    void job.run().catch(() => undefined).finally(() => { primaryRunning--;if(job.person)portraitsRunning--; pumpArtwork(); });
  }
  while (fallbackRunning < 2 && fallbackQueue.length) {
    const job = takeArtwork(fallbackQueue);
    if(!job)break;
    fallbackRunning++;if(job.person)portraitsRunning++;
    void job.run().catch(() => undefined).finally(() => { fallbackRunning--;if(job.person)portraitsRunning--; pumpArtwork(); });
  }
}
function enqueueArtwork(key: string, fallback: boolean, priority: number, person: boolean, work: () => Promise<DiscoverResult>) {
  let job=sharedLookups.get(key);
  if(!job){
    if (primaryQueue.length + fallbackQueue.length >= 128) return undefined;
    let settle: (value: DiscoverResult | null) => void = () => {};
    const promise=new Promise<DiscoverResult | null>(resolve=>{settle=resolve;});
    const waiting=fallback?fallbackQueue:primaryQueue;
    const entry: ArtworkJob = {
      priority,person,queuedAt:performance.now(),users:0,started:false,promise,
      run:async()=>{
        entry.started=true;
        const start=performance.now();
        discoverTrace("artwork-queue",{ms:Math.round(start-entry.queuedAt),state:entry.person?"portrait":"song"});
        try { const value=await work();discoverTrace("artwork-ipc",{ms:Math.round(performance.now()-start),state:value.status==="artwork"?(value.outcome||(value.coverUrl?"attached":"missing")):value.status});settle(value); }
        catch { settle(null); }
        finally { sharedLookups.delete(key); }
      },
      cancel:()=>{
        const index=waiting.indexOf(entry);
        if(index<0)return;
        waiting.splice(index,1);
        sharedLookups.delete(key);
        settle(null);
      }
    };
    job=entry;sharedLookups.set(key,entry);
    waiting.push(entry);
  }
  job.priority=Math.min(job.priority,priority);
  job.users++;
  const entry=job;
  let released=false;
  pumpArtwork();
  return {promise:entry.promise,release:()=>{
    if(released)return;
    released=true;
    if(--entry.users===0&&!entry.started)entry.cancel();
  }};
}
function rememberArtwork(key: string, value: DiscoverArtwork) {
  cache.set(key,{at:Date.now(),value});
  while(cache.size>512)cache.delete(cache.keys().next().value!);
}
function cachedArtwork(key: string) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at >= 86400000) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}
const normalizeKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const artworkKey = (title: string, artist: string, person = false, providerId = "", album = "", durationMs = 0) =>
  JSON.stringify([person ? "artist" : "recording", normalizeKey(title), normalizeKey(artist), providerId, normalizeKey(album), durationMs]);
export function getCachedDiscoverArtwork(title: string, artist: string) {
  const key = artworkKey(title, artist);
  return cachedArtwork(key + ":fallback") || cachedArtwork(key);
}
const audioDbCover = /^https:\/\/(?:www\.|r2\.)?theaudiodb\.com\/images\/media\/album\/thumb\/[a-z0-9_-]+\.(?:jpg|jpeg|png)(?:\/(?:small|medium))?$/i;
const youtubeCover = /^https:\/\/(?:lh[0-9]+\.googleusercontent\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com)\/[A-Za-z0-9_-]+=w256-h256-l90-rj$|^https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\/(?:hqdefault|mqdefault|default|sddefault|maxresdefault)\.jpg$/;
const deezerCover = /^https:\/\/(?:e-cdns-images|cdns-images|cdn-images)\.dzcdn\.net\/images\/(?:cover|artist)\/[a-f0-9]{32}\/250x250-000000-80-0-0\.jpg$/i;
const fanartCover = /^https:\/\/assets\.fanart\.tv\/fanart\/music\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\/(?:albumcover|artistthumb)\/[-a-z0-9_.%]+\.(?:jpg|jpeg|png)\/preview$/i;
export const isDisplayOnlyCover = (value?: string) => Boolean(value && (deezerCover.test(value) || fanartCover.test(value)));
const safeCover = (value?: string) => value && (deezerCover.test(value) || fanartCover.test(value) || youtubeCover.test(value) || audioDbCover.test(value) || /^https:\/\/coverartarchive\.org\/(release|release-group)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/front-250$/i.test(value) || (/^https:\/\/(?:lastfm\.freetls\.fastly\.net|lastfm-img2\.akamaized\.net)\/i\/u\/(?:[0-9]+x[0-9]+|[0-9]+s)\/[a-f0-9]{32}\.(?:png|jpe?g|webp)$/i.test(value) && !/2a96cbd8b46e442fc41c2b86b821562f|4128a6eb29f94943c9d206c08e625904/i.test(value))) ? value : undefined;
// Headless, bounded startup warmup. Use the same lookup keys, queue and
// cache as mounted cards; never mount a second hidden Discover interface.
let warmGeneration = -1;
const warmedTracks = new Set<string>();
const warmedImages = new Set<string>();
const attemptedImages = new Set<string>();
const warmingImages = new Map<string, Promise<void>>();
function warmImage(url: string, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  const pending = warmingImages.get(url);
  if (pending) return pending;
  if (attemptedImages.has(url)) return Promise.resolve();
  attemptedImages.add(url);
  const generation = warmGeneration;
  // Let an already-issued browser transfer settle instead of abandoning it and
  // starting another on navigation. The outer loop stops issuing new work.
  const task = new Promise<void>(resolve => {
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "low";
    image.referrerPolicy = "no-referrer";
    const finish = () => {
      window.clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve();
    };
    const timer = window.setTimeout(finish, 5000);
    image.onload = () => {
      if (warmGeneration === generation && image.naturalWidth > 0) warmedImages.add(url);
      finish();
    };
    image.onerror = finish;
    image.src = url;
  }).finally(() => warmingImages.delete(url));
  warmingImages.set(url,task);
  return task;
}
function firstCover(value?: DiscoverArtwork) {
  return [value?.coverUrl,value?.fallbackCoverUrl,...(value?.coverAlternatives||[]).slice(0,6)].map(safeCover).find(Boolean);
}
async function warmTrack(track: DiscoverTrack, signal: AbortSignal, allowLookup: boolean) {
  const providerId=track.providerId||"", album=providerId?track.album||"":"", durationMs=providerId?track.durationMs||0:0;
  const key=artworkKey(track.title,track.artist,false,providerId,album,durationMs);
  let src=firstCover(track)||firstCover(cachedArtwork(key+":fallback"))||firstCover(cachedArtwork(key));
  if(!src && allowLookup && !warmedTracks.has(key) && !signal.aborted){
    warmedTracks.add(key);
    // One primary and, if appropriate, one fallback attempt, no background retry loop.
    for(const fallback of [false,true]){
      if(signal.aborted)break;
      const requestKey=key+(fallback?":fallback":"");
      const request=enqueueArtwork(requestKey+"[]false",fallback,8,false,async()=>{
        const answer=await window.localitfy.getDiscoveries({artwork:{title:track.title,artist:track.artist,kind:"recording",fallback,primaryOnly:!fallback&&!providerId,providerId,album,durationMs,failedUrls:[],retryPrimary:false}});
        if(answer.status==="artwork"&&firstCover(answer))rememberArtwork(requestKey,answer);
        return answer;
      });
      if(!request)break;
      signal.addEventListener("abort",request.release,{once:true});
      const answer=await request.promise.finally(()=>{signal.removeEventListener("abort",request.release);request.release();});
      if(answer?.status!=="artwork"||answer.outcome==="busy"||answer.outcome==="unavailable")break;
      src=firstCover(answer);if(src)break;
    }
  }
  if(src&&!signal.aborted){
    const local=!isDisplayOnlyCover(src)&&!src.startsWith("https://coverartarchive.org/")?await resolveRemoteArtwork(src):"";
    if(!signal.aborted)await warmImage(local||src,signal);
  }
}
export async function preloadDiscover(signal: AbortSignal) {
  if(signal.aborted)return;
  const started=performance.now();
  // The backend already coalesces recommendation generation and retains the
  // completed result; opening Discover joins that operation without refreshing.
  discoverTrace("background-discover-start");
  const result=await window.localitfy.getDiscoveries();
  if(signal.aborted||result.status!=="ready")return;
  if(warmGeneration!==result.generatedAt){
    warmGeneration=result.generatedAt;warmedTracks.clear();warmedImages.clear();attemptedImages.clear();
  }
  const shelves=buildDiscoverShelves(result.artists,result.tracks);
  const tracks=[...shelves.recommended.slice(0,10),...shelves.popular.slice(0,6)];
  // Warm attached covers first, then spend at most six lookups on missing
  // songs. No artist portraits, polling, forced refresh or separate queue.
  let lookups=0;
  for(const track of tracks){
    if(signal.aborted)return;
    if(firstCover(track))await warmTrack(track,signal,false);
  }
  for(const track of tracks){
    if(signal.aborted)return;
    if(firstCover(track))continue;
    const providerId=track.providerId||"";
    const key=artworkKey(track.title,track.artist,false,providerId,providerId?track.album||"":"",providerId?track.durationMs||0:0);
    const allow=!warmedTracks.has(key)&&warmedTracks.size<6&&lookups<6;
    if(allow)lookups++;
    await warmTrack(track,signal,allow);
  }
  discoverTrace("background-discover-ready",{ms:Math.round(performance.now()-started),count:warmedImages.size,total:tracks.length});
}
export function DiscoverCover({ title, artist, artwork, lookup = false, person = false, providerId = "", priority = false, lookupPriority = person ? 3 : 2, retryEpoch = 0 }: {
  title: string; artist: string; artwork?: DiscoverArtwork & { album?: string }; lookup?: boolean; person?: boolean; providerId?: string; priority?: boolean; lookupPriority?: number; retryEpoch?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [visible,setVisible]=useState(false);
  const visibleRef=useRef(false);
  useEffect(() => {
    if (!ref.current) return;
    const stopNear=observeArtwork(ref.current,setNear);
    const stopVisible=observeVisibleArtwork(ref.current,value=>{visibleRef.current=value;setVisible(value);});
    return ()=>{stopNear();stopVisible();};
  }, []);
  const album = providerId ? artwork?.album || "" : "";
  const durationMs = providerId ? artwork?.durationMs || 0 : 0;
  const key = artworkKey(title, artist, person, providerId, album, durationMs);
  const [resolved, setResolved] = useState<{ key: string; value: DiscoverArtwork; fallback: boolean; epoch: number; unavailable?: boolean }>();
  const [loaded, setLoaded] = useState<{key:string; url:string}>();
  const [local, setLocal] = useState<{source:string; url:string}>();
  const [badLocal, setBadLocal] = useState("");
  const [failure, setFailure] = useState<{key:string; urls:string[]}>({key:"",urls:[]});
  const cachedFallback=cachedArtwork(key + ":fallback");
  const cover = resolved?.key === key && (resolved.value.coverUrl||resolved.value.fallbackCoverUrl||resolved.value.coverAlternatives?.length) ? resolved.value : cachedFallback || cachedArtwork(key);
  const failed = failure.key === key ? failure.urls : [];
  const directUrls = [artwork?.coverUrl, artwork?.fallbackCoverUrl, ...(artwork?.coverAlternatives ?? []).slice(0,6)].map(safeCover).filter(Boolean);
  const resolvedUrls = [safeCover(cover?.coverUrl), safeCover(cover?.fallbackCoverUrl), ...(cover?.coverAlternatives ?? []).slice(0,6).map(safeCover)];
  const candidates = failed.length ? [...resolvedUrls, ...directUrls] : [...directUrls, ...resolvedUrls];
  const selectedSource=loaded?.key===key&&local?.url===loaded.url?local.source:loaded?.key===key?loaded.url:undefined;
  const selected = selectedSource && candidates.includes(selectedSource) && !failed.includes(selectedSource) ? selectedSource : undefined;
  const src = selected || candidates.find(url => url && !failed.includes(url));
  const needsLookup = lookup && !src;
  // The cache returns a display URL only; the provider URL remains the lookup/download identity.
  const remembered = src ? getResolvedRemoteArtwork(src) : undefined;
  // Cover Art Archive is display-only for this cache, independently of download handling.
  const eligibleLocal = Boolean(src && !isDisplayOnlyCover(src) && !src.startsWith("https://coverartarchive.org/") && window.localitfy?.resolveRemoteArtwork);
  const pendingLocal = Boolean(near && eligibleLocal && remembered === undefined && local?.source !== src);
  useEffect(() => {
    if (!near || !src || !eligibleLocal) return;
    let active = true;
    void resolveRemoteArtwork(src).then(url => {
      if (active) setLocal({source: src, url});
    });
    return () => { active = false; };
  }, [src, near, eligibleLocal]);
  // Once selected, keep the same display source. A later cache lease must not
  // swap out a decoded image or duplicate an in-flight browser download.
  const localCandidate = eligibleLocal ? (local && local.source === src ? local.url : remembered ?? "") : "";
  const localSrc = localCandidate !== badLocal ? localCandidate : "";
  const displaySrc = pendingLocal ? "" : localSrc || src;
  const imageReady = Boolean(displaySrc && loaded?.url === displaySrc);
  const imageRef = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (displaySrc && imageRef.current?.complete && imageRef.current.naturalWidth > 0) setLoaded({key,url:displaySrc});
  }, [key, displaySrc]);
  useLayoutEffect(()=>{if(imageReady&&visible)discoverTrace("visible-cover-ready");},[imageReady,visible]);
  const rejectLocal = () => { if (src) invalidateResolvedRemoteArtwork(src); setBadLocal(localSrc); };
  const exhausted = resolved?.key === key && (resolved.epoch===retryEpoch||Boolean(src)) ? Boolean(resolved.fallback || !src) : Boolean(cachedFallback);
  const requestKey = exhausted ? key + ":fallback" : key;
  const excludedKey=JSON.stringify(failed.slice(-8).sort());
  const retryPrimary=exhausted && resolved?.key===key && resolved.unavailable===true && !resolved.fallback;
  useEffect(()=>{
    if(!near||!needsLookup)return;
    const job=sharedLookups.get(requestKey+excludedKey+String(retryPrimary));
    if(job&&!job.started){job.priority=Math.min(job.priority,lookupPriority+(visible?0:4));pumpArtwork();}
  },[near,needsLookup,requestKey,excludedKey,retryPrimary,lookupPriority,visible]);
  const tooManyFailures=!src&&failed.length>=8;
  const finishedMissing=resolved?.key===key&&resolved.epoch===retryEpoch&&resolved.fallback&&!resolved.value.coverUrl&&!resolved.value.fallbackCoverUrl&&!resolved.value.coverAlternatives?.length;
  useEffect(() => {
    if (!near || !src || !displaySrc || imageReady) return;
    const timer = window.setTimeout(() => {
      if (localSrc) { invalidateResolvedRemoteArtwork(src); setBadLocal(localSrc); }
      else setFailure(current => ({key,urls:[...new Set([...(current.key === key ? current.urls : []),src])]}));
    }, localSrc ? 2000 : 5000);
    return () => window.clearTimeout(timer);
  }, [src, displaySrc, localSrc, key, imageReady, near]);
  useEffect(() => {
    if (!needsLookup || (!person && !artist) || !title || !near) return;
    if(finishedMissing||tooManyFailures)return;
    let live = true;
    let releaseRequest: (()=>void) | undefined;
    let retryTimer: number | undefined;
    let attempts = 0;
    const excluded: string[]=JSON.parse(excludedKey);
    const hasCandidate=(value: DiscoverArtwork) => [value.coverUrl,value.fallbackCoverUrl,...(value.coverAlternatives||[])].some(url=>url&&!excluded.includes(url));
    const start = () => {
      if (!live) return;
      const cached = cachedArtwork(requestKey);
      if (cached && hasCandidate(cached)) { setResolved({ key, value: cached, fallback: exhausted, epoch:retryEpoch }); return; }
      const request=enqueueArtwork(requestKey+excludedKey+String(retryPrimary),exhausted,lookupPriority+(visibleRef.current?0:4),person,async()=>{
        const answer=await window.localitfy.getDiscoveries({
          artwork: {title,artist,kind:person?"artist":"recording",fallback:exhausted,primaryOnly:!exhausted&&!providerId,providerId,album,durationMs,failedUrls:excluded,retryPrimary}
        });
        if(answer.status==="artwork"&&hasCandidate(answer))rememberArtwork(requestKey,answer);
        return answer;
      });
      attempts++;
      if(attempts>1)discoverTrace("artwork-retry",{count:attempts-1});
      if(!request){
        if(attempts<4)retryTimer=window.setTimeout(start,attempts*900);
        return;
      }
      releaseRequest=request.release;
      void request.promise.then(answer=>{
        request.release();
        if(!live)return;
        if(answer?.status!=="artwork"){
          // A temporary provider failure is already subject to a shared backend cooldown.
          // A bounded number of delayed retries per visible consumer, never continuous polling.
          if(attempts<4&&answer?.status!=="off")retryTimer=window.setTimeout(start,answer?.status==="error"?15000*attempts:900*attempts);
          else if(!exhausted&&answer?.status!=="off")setResolved({key,value:{},fallback:false,epoch:retryEpoch,unavailable:true});
          return;
        }
        if(answer.outcome==="busy" || (exhausted&&answer.outcome==="unavailable")){
          if(attempts<4)retryTimer=window.setTimeout(start,answer.outcome==="busy"?750*attempts:15000*attempts);
          else if(!exhausted)setResolved({key,value:{},fallback:false,epoch:retryEpoch,unavailable:true});
          return;
        }
        setResolved({key,value:answer,fallback:exhausted,epoch:retryEpoch,unavailable:answer.outcome==="unavailable"});
      });
    };
    start();
    return () => { live = false; releaseRequest?.(); if (retryTimer !== undefined) window.clearTimeout(retryTimer); };
  }, [key, title, artist, needsLookup, near, person, exhausted, requestKey, providerId, album, durationMs, excludedKey, retryPrimary, finishedMissing, tooManyFailures, lookupPriority, retryEpoch]);
  return <span ref={ref} className="discoverCover" aria-hidden="true">
    {!imageReady ? (person ? <UserRound size={24} /> : <Disc3 size={24} />) : null}
    {(near || imageReady) && src && displaySrc ? <img key={displaySrc} ref={imageRef} src={displaySrc} alt="" loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : "auto"} referrerPolicy="no-referrer" data-ready={imageReady}
      onLoad={event => {discoverImageTrace(event.currentTarget);setLoaded({key,url:displaySrc});}}
      onError={() => { discoverTrace("image-error",{state:localSrc?"local":"remote"});if (localSrc) rejectLocal(); else setFailure(current => ({key,urls:[...new Set([...(current.key === key ? current.urls : []),src])]})); }} /> : null}
  </span>;
}
