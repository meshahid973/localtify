"use strict";
const { boundedJson } = require("./extra-artwork.cjs");
const { setTimeout: wait } = require("node:timers/promises");
const { createResourceCache } = require("../runtime/resource-cache.cjs");
const { createHash } = require("node:crypto");
const { providerCooldown, unavailable, capacity } = require("./provider-health.cjs");
const norm = value => String(value||"").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
const albumImage = value => typeof value==="string" && /^https:\/\/(?:www\.|r2\.)?theaudiodb\.com\/images\/media\/album\/thumb\/[a-z0-9_-]+\.(?:jpg|jpeg|png)(?:\/(?:small|medium))?$/i.test(value) ? value : "";
function createAudioDbArtwork({apiKey, fetchImpl=globalThis.fetch, now=Date.now}) {
  if(typeof apiKey!=="string"||!/^[a-z0-9_-]{1,128}$/i.test(apiKey))return undefined;
  let nextSlot=0, blockedUntil=0;
  const request=async(endpoint,params,signal)=>{
    if(signal?.aborted)throw unavailable();
    if(now()<blockedUntil)throw unavailable();
    const slot=Math.max(now(),nextSlot);
    if(slot-now()>7000)throw capacity(); // avoid accumulating unbounded delayed work
    nextSlot=slot+2100;
    if(slot>now())await wait(slot-now(),undefined,signal?{signal}:undefined);
    if(signal?.aborted||now()<blockedUntil)throw unavailable();
    const url=new URL("https://www.theaudiodb.com/api/v1/json/"+apiKey+"/"+endpoint);
    url.search=new URLSearchParams(params).toString();
    // Reuse the bounded, redirect-free JSON reader used by other artwork
    // providers. Do not forward the operator's API key to a redirect target.
    try {
      return await boundedJson(fetchImpl, url.href, {}, signal);
    } catch (error) {
      if(!signal?.aborted&&(error.status || ["TypeError","TimeoutError","AbortError"].includes(error.name))) blockedUntil=Math.max(blockedUntil,now()+providerCooldown(error));
      throw error;
    }
  };
  const localAlbums=createResourceCache({now,maxEntries:128,validate:value=>!!albumImage(value?.coverUrl)}), pendingAlbums=new Map();
  const resolve=async(title,artist,signal,albumCache=localAlbums,excluded=[])=>{
    const tracks=await request("searchtrack.php",{s:artist,t:title},signal);
    const exact=(Array.isArray(tracks?.track)?tracks.track:[]).filter(track=>track && norm(track.strTrack)===norm(title)&&(norm(track.strArtist)===norm(artist)||norm(track.strArtistAlternate)===norm(artist)));
    if(!exact.length)return {};
    const ids=[...new Set(exact.map(track=>String(track.idAlbum||"")))];
    if(ids.length!==1 || !/^\d+$/.test(ids[0]) || new Set(exact.map(track=>norm(track.strAlbum))).size!==1)return {};
    if(signal?.aborted)throw unavailable();
    const key="album:audiodb:"+createHash("sha256").update(JSON.stringify([ids[0],norm(exact[0].strAlbum),norm(artist)])).digest("hex");
    const cached=albumCache.get(key);
    if(albumImage(cached?.coverUrl)&&!excluded.includes(cached.coverUrl))return cached;
    // Shared album work is cancelled only when no requesting consumer remains.
    let entry=pendingAlbums.get(key);
    if(!entry){
      if(pendingAlbums.size>=4)throw capacity();
      const controller=new AbortController();
      entry={controller,users:0,promise:null};
      const job=entry;
      entry.promise=request("album.php",{m:ids[0]},controller.signal).then(album=>{
        const match=(Array.isArray(album?.album)?album.album:[]).find(item=>item && String(item.idAlbum)===ids[0]&&norm(item.strAlbum)===norm(exact[0].strAlbum)&&(norm(item.strArtist)===norm(artist)||norm(item.strArtistAlternate)===norm(artist)));
        const coverUrl=albumImage(match?.strAlbumThumb);
        return coverUrl?{coverUrl}:{};
      }).finally(()=>{if(pendingAlbums.get(key)===job)pendingAlbums.delete(key);});
      pendingAlbums.set(key,entry);
    }
    entry.users++;
    let abort;
    try{
      const result=signal?await Promise.race([entry.promise,new Promise((_,reject)=>{
        abort=()=>reject(unavailable());
        if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});
      })]):await entry.promise;
      if(signal?.aborted)throw unavailable();
      if(result.coverUrl&&!excluded.includes(result.coverUrl)){albumCache.set(key,result,86400000);return result;}
      return {};
    }finally{
      if(abort)signal.removeEventListener("abort",abort);
      if(--entry.users===0&&pendingAlbums.get(key)===entry){
        pendingAlbums.delete(key);entry.controller.abort();
      }
    }
  };
  const lookup=(...args)=>resolve(...args).catch(()=>({}));
  lookup.resolve=resolve;
  return lookup;
}
module.exports={createAudioDbArtwork,albumImage};
