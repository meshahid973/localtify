"use strict";

// Adapted with the requester-reported permission from tryliner/desktop:
// src/shared/youtube/innertube/{innertubeClient,innertubeTrackMapper,
// innertubeThumbnail,innertubeSearchRanking}.ts. Localtify adaptation:
// catalog metadata only; no accounts, tokens, playback endpoints or Liner services.
const { retryAfterMs, providerCooldown, unavailable, capacity } = require("./provider-health.cjs");
const {createResourceCache}=require("../runtime/resource-cache.cjs");
const {createHash}=require("node:crypto");
const origin = "https://music.youtube.com/youtubei/v1/";
const clientVersion = "1.20260911.08.00";
const filters = { video: "EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D", recording: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D", artist: "EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D" };
const videoId = /^[A-Za-z0-9_-]{11}$/;
const artistId = /^UC[A-Za-z0-9_-]{22}$/;
const albumIdPattern=/^MPREb_[A-Za-z0-9_-]{1,80}$/;
const clean = v => typeof v === "string" ? v.trim().slice(0,300) : "";
const norm = v => clean(v).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const arr = v => Array.isArray(v) ? v : [];
const runs = v => arr(v?.runs);
const text = v => clean(runs(v).map(r=>r?.text || "").join("") || v?.simpleText);
const browse = r => r?.navigationEndpoint?.browseEndpoint;
const kindOf = r => browse(r)?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
const duration = v => {
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(v)) return undefined;
  const parts = v.split(":").map(Number);
  if (parts.at(-1)>59 || (parts.length===3 && parts[1]>59)) return undefined;
  const ms=parts.reduce((n,p)=>n*60+p,0)*1000;
  return ms>0 ? ms : undefined;
};
const junk = ["reaction","reacts","reacting","first time hearing","tutorial","how to play","guitar lesson","piano tutorial","sheet music","guitar cover","drum cover","dance cover","dance practice","podcast","interview","unboxing","1 hour loop","10 hours","full album","album stream","greatest hits","nightcore","slowed","reverb","sped up","bass boosted","8d audio","реакция","кавер","подкаст"];
const containsPhrase=(s,p)=>(" "+s+" ").includes(" "+p+" ");
function isJunkVideo(title,query) {
  const t=norm(title),q=norm(query);
  return junk.some(p=>containsPhrase(t,p)&&!containsPhrase(q,p));
}
function matchesQuery(query,title,artist) {
  const tokens=norm(query).split(" ").filter(Boolean).filter(t=>!["the","a","an","of","in","on","to","and","or","feat","ft","official","audio","video","music","lyrics","opening","ending","ost","theme","op","ed"].includes(t));
  if(!tokens.length)return false;
  const combined=norm(title+" "+artist);
  const matched=tokens.filter(t=>combined.includes(t)).length;
  return matched >= (tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length*.75));
}
function safeThumbnail(raw) {
  try {
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.username||u.password||u.port||u.search||u.hash)return undefined;
    if (/^(?:lh[0-9]+\.googleusercontent\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com)$/.test(u.hostname) && /^\/[A-Za-z0-9_-]+(?:=[A-Za-z0-9_-]+)?$/.test(u.pathname)) {
      return u.origin+u.pathname.split("=")[0]+"=w256-h256-l90-rj";
    }
    if (u.hostname==="i.ytimg.com" && /^\/vi\/[A-Za-z0-9_-]{11}\/(?:hqdefault|mqdefault|default|sddefault|maxresdefault)\.jpg$/.test(u.pathname))return u.href;
  } catch {}
  return undefined;
}
function coverFor(row,id) {
  const thumbs=arr(row?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? row?.thumbnail?.thumbnails);
  const candidates=thumbs.map(t=>({url:safeThumbnail(t?.url),width:Number(t?.width)||0,height:Number(t?.height)||0})).filter(t=>t.url);
  candidates.sort((a,b)=>Number(b.width===b.height)-Number(a.width===a.height)||b.width-a.width);
  return candidates[0]?.url || (videoId.test(id)?"https://i.ytimg.com/vi/"+id+"/hqdefault.jpg":undefined);
}
function column(row,index) {return row?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer?.text;}
function mapRow(row,kind,context={}) {
  const title=text(column(row,0) ?? row.title);
  if(!title)return null;
  const titleRun=runs(column(row,0) ?? row.title)[0];
  // Adapted from Liner innertubeTrackMapper: metadata can span flex columns.
  const byline=column(row,1) ?? row.subtitle;
  const metadata=[...runs(byline),...arr(row.flexColumns).slice(2).flatMap((_,i)=>runs(column(row,i+2)))];
  const endpoints=[row.onTap,titleRun?.navigationEndpoint,row.navigationEndpoint,row.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint,...arr(row.buttons).flatMap(button=>[button?.buttonRenderer?.command,button?.buttonRenderer?.navigationEndpoint])];
  if(kind==="artist"){
    const endpoint=endpoints.map(e=>e?.browseEndpoint).find(e=>e?.browseId&&e?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType==="MUSIC_PAGE_TYPE_ARTIST");
    const id=endpoint?.browseId;
    const page=endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if(page!=="MUSIC_PAGE_TYPE_ARTIST"||!artistId.test(id||""))return null;
    return {id:"ytmusic:"+id,title,artist:"",subtitle:"YouTube Music",url:"https://music.youtube.com/channel/"+id,coverUrl:coverFor(row,id)};
  }
  const id=row?.playlistItemData?.videoId||titleRun?.navigationEndpoint?.watchEndpoint?.videoId||row?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId||endpoints.map(e=>e?.watchEndpoint?.videoId).find(id=>videoId.test(id||""));
  if(!videoId.test(id||""))return null;
  const artistRuns=metadata.filter(r=>["MUSIC_PAGE_TYPE_ARTIST","MUSIC_PAGE_TYPE_USER_CHANNEL"].includes(kindOf(r)));
  const artists=[...new Set(artistRuns.map(r=>clean(r.text)).filter(Boolean))];
  const artistIds=[...new Set(artistRuns.map(r=>browse(r)?.browseId).filter(id=>artistId.test(id||"")))].map(id=>"ytmusic:"+id);
  const segments=text(byline).split("•").map(clean).filter(Boolean);
  if(["song","video"].includes(segments[0]?.toLowerCase()))segments.shift();
  const bylineArtist=segments.find(v=>!duration(v)&&!/^\d[\d,.]*\s*(?:views|plays)$/i.test(v)&&artistKey(v)!==artistKey(context.album));
  const fallback=!artists.length&&context.credits?.length&&(!bylineArtist||context.credits.some(c=>artistKey(c.name)===artistKey(bylineArtist)))?context.credits:[];
  const artist=artists.join(", ")||fallback.map(c=>c.name).join(", ")||bylineArtist||"";
  if(!artist)return null;
  const albumRun=metadata.find(r=>kindOf(r)==="MUSIC_PAGE_TYPE_ALBUM");
  const album=clean(albumRun?.text)||context.album||"",albumId=browse(albumRun)?.browseId||context.albumId;
  const fixed=arr(row.fixedColumns).flatMap(c=>runs(c?.musicResponsiveListItemFixedColumnRenderer?.text));
  const durationMs=[...metadata,...fixed].map(r=>duration(clean(r?.text))).find(Boolean);
  return {id:"ytmusic:"+id,title,artist,album,subtitle:[artist,album].filter(Boolean).join(" · "),url:"https://www.youtube.com/watch?v="+id,durationMs,coverUrl:coverFor(row,id),artistCredits:artistRuns.length?artistRuns.flatMap(r=>{const name=clean(r.text),id=browse(r)?.browseId;return name?[{name,...(artistId.test(id||"")?{id:"ytmusic:"+id}:{})}]:[];}):fallback.length?fallback:[{name:artist}],...((artistIds.length||fallback.some(c=>c.id))?{artistIds:artistIds.length?artistIds:fallback.map(c=>c.id).filter(Boolean)}:{}),...(/^MPREb_[A-Za-z0-9_-]{1,80}$/.test(albumId||"")?{albumId:"ytmusic:"+albumId}:{})};
}
function mapSearchResponse(body,kind,query,strictQuery=true,limit=25,filterJunk=true) {
  const tabs=arr(body?.contents?.tabbedSearchResultsRenderer?.tabs);
  const sections=tabs.flatMap(t=>arr(t?.tabRenderer?.content?.sectionListRenderer?.contents));
  const items=sections.flatMap(s=>arr(s?.musicShelfRenderer?.contents).concat(s?.musicCardShelfRenderer?[{musicCardShelfRenderer:s.musicCardShelfRenderer},...arr(s.musicCardShelfRenderer.contents)]:[],arr(s?.itemSectionRenderer?.contents)));
  const seen=new Set(), result=[];
  for(const item of items.slice(0,150)){
    const row=item?.musicResponsiveListItemRenderer ?? item?.musicCardShelfRenderer;
    if(!row)continue;
    const mapped=mapRow(row,kind);
    if(!mapped||seen.has(mapped.id)||(filterJunk&&kind!=="artist"&&isJunkVideo(mapped.title,query)))continue;
    seen.add(mapped.id);result.push(mapped);
  }
  return result.filter(v=>!strictQuery||matchesQuery(query,v.title,v.artist)).slice(0,limit);
}
// Adapted from tryliner/desktop innertubeArtistMapper and innertubeCollectionMapper.
// Only bounded, recognized artist shelves are used; unrelated recommendations
// and artist portraits are never assigned as recording artwork.
function walkRecords(root,visit){
  const stack=[root];let visited=0;
  while(stack.length&&visited++<30000){
    const node=stack.pop();if(!node||typeof node!=="object")continue;
    if(visit(node)===true)continue;
    const children=Array.isArray(node)?node:Object.values(node);
    for(let i=children.length-1;i>=0;i--)if(children[i]&&typeof children[i]==="object")stack.push(children[i]);
  }
}
function validBrowse(endpoint){return typeof endpoint?.browseId==="string"&&/^[A-Za-z0-9_-]{1,120}$/.test(endpoint.browseId)&&(endpoint.params===undefined||typeof endpoint.params==="string"&&endpoint.params.length<=512);}
function mapArtistPage(body,id){
  if(!artistId.test(id))return null;
  let header,topSongs;
  walkRecords(body,node=>{header ||= node.musicImmersiveHeaderRenderer||node.musicVisualHeaderRenderer||node.musicHeaderRenderer||node.musicResponsiveHeaderRenderer;return !!header;});
  const headerName=text(header?.title);
  const context=headerName?{credits:[{id:"ytmusic:"+id,name:headerName}]}:{};
  const discography=[];
  const tracks=new Map(),releases=new Map();
  walkRecords(body,node=>{
    header ||= node.musicImmersiveHeaderRenderer||node.musicVisualHeaderRenderer||node.musicHeaderRenderer||node.musicResponsiveHeaderRenderer;
    const shelf=node.musicShelfRenderer;
    if(shelf&&/^(?:songs|top songs|popular songs)$/i.test(text(shelf.title))){
      for(const item of arr(shelf.contents).slice(0,100)){
        const track=mapRow(item?.musicResponsiveListItemRenderer||{},"recording",context);
        if(track&&track.artistIds?.includes("ytmusic:"+id))tracks.set(track.id,track);
      }
      const endpoint=browse(runs(shelf.title)[0])||shelf.bottomEndpoint?.browseEndpoint;
      if(validBrowse(endpoint))topSongs={browseId:endpoint.browseId,...(endpoint.params?{params:endpoint.params}:{})};
      return true;
    }
    const carousel=node.musicCarouselShelfRenderer;
    if(carousel){
      const label=text(carousel.header?.musicCarouselShelfBasicHeaderRenderer?.title);
      if(/^(albums|singles & eps)$/i.test(label)){
        const h=carousel.header?.musicCarouselShelfBasicHeaderRenderer;
        const endpoint=browse(runs(h?.title)[0])||h?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint;
        if(endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType==="MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY"&&validBrowse(endpoint))discography.push({browseId:endpoint.browseId,params:endpoint.params,kind:/^albums$/i.test(label)?"album":"single"});
        for(const raw of arr(carousel.contents).slice(0,80)){
          const item=raw?.musicTwoRowItemRenderer,endpoint=browse(runs(item?.title)[0])||item?.navigationEndpoint?.browseEndpoint;
          const title=text(item?.title),releaseId=endpoint?.browseId;
          if(!title||!albumIdPattern.test(releaseId||""))continue;
          const coverUrl=coverFor({thumbnail:item.thumbnailRenderer},undefined);
          const year=runs(item.subtitle).map(r=>clean(r.text)).find(v=>/^\d{4}$/.test(v));
          releases.set(releaseId,{id:"ytmusic:"+releaseId,title,coverUrl,releaseDate:year,releaseType:/^albums$/i.test(label)?"album":/^ep$/i.test(clean(runs(item.subtitle)[0]?.text))?"ep":"single"});
        }
      }
      return true;
    }
    return false;
  });
  const name=text(header?.title);
  if(!name)return null;
  return {id:"ytmusic:"+id,name,coverUrl:coverFor(header,undefined),tracks:[...tracks.values()].slice(0,100),releases:[...releases.values()].slice(0,100),topSongs,discography:discography.slice(0,2)};
}
function mapArtistSongs(body,id,name){
  const rows=new Map();
  walkRecords(body,node=>{
    if(!node.musicResponsiveListItemRenderer)return false;
    const item=mapRow(node.musicResponsiveListItemRenderer,"recording",name?{credits:[{id:"ytmusic:"+id,name}]}:{});
    if(item&&item.artistIds?.includes("ytmusic:"+id))rows.set(item.id,item);
    return true;
  });
  return [...rows.values()].slice(0,100);
}
function mapDiscography(body,kind){
  const releases=new Map();
  walkRecords(body,node=>{
    const item=node.musicTwoRowItemRenderer;if(!item)return false;
    const endpoint=browse(runs(item.title)[0])||item.navigationEndpoint?.browseEndpoint;
    const id=endpoint?.browseId,title=text(item.title);if(!albumIdPattern.test(id||"")||!title)return true;
    const releaseDate=runs(item.subtitle).map(r=>clean(r.text)).find(v=>/^\d{4}$/.test(v));
    releases.set(id,{id:"ytmusic:"+id,title,coverUrl:coverFor({thumbnail:item.thumbnailRenderer}),releaseDate,releaseType:kind==="album"?"album":/^ep$/i.test(clean(runs(item.subtitle)[0]?.text))?"ep":"single"});return true;
  });return [...releases.values()].slice(0,100);
}
const artistKey=value=>clean(value).normalize("NFKC").trim().replace(/\s+[-–—]\s+Topic$/i,"").replace(/\s+/g," ").toLowerCase();
const diskKey=(type,value)=>type+":"+createHash("sha256").update(value).digest("hex");
const isTrack=row=>row&&/^ytmusic:[A-Za-z0-9_-]{11}$/.test(row.id||"")&&typeof row.title==="string"&&typeof row.artist==="string"&&row.url==="https://www.youtube.com/watch?v="+row.id.slice(8)&&(!row.coverUrl||safeThumbnail(row.coverUrl)===row.coverUrl)&&(!row.artistCredits||Array.isArray(row.artistCredits)&&row.artistCredits.length<=32&&row.artistCredits.every(c=>c&&typeof c.name==="string"&&(!c.id||/^ytmusic:UC[A-Za-z0-9_-]{22}$/.test(c.id))))&&(!row.artistIds||Array.isArray(row.artistIds)&&row.artistIds.every(id=>/^ytmusic:UC[A-Za-z0-9_-]{22}$/.test(id)))&&(!row.albumId||/^ytmusic:MPREb_[A-Za-z0-9_-]{1,80}$/.test(row.albumId));
const isRelease=row=>row&&/^ytmusic:MPREb_[A-Za-z0-9_-]{1,80}$/.test(row.id||"")&&typeof row.title==="string"&&(!row.coverUrl||safeThumbnail(row.coverUrl)===row.coverUrl);
function mapAlbumPage(body,id){
  if(!albumIdPattern.test(id))return null;
  let header;
  walkRecords(body,node=>{header ||= node.musicResponsiveHeaderRenderer;return !!header;});
  const title=text(header?.title),credits=runs(header?.straplineTextOne).filter(r=>kindOf(r)==="MUSIC_PAGE_TYPE_ARTIST"&&artistId.test(browse(r)?.browseId||"")).map(r=>({name:clean(r.text),id:"ytmusic:"+browse(r).browseId})).filter(c=>c.name);
  if(!title||!credits.length)return null;
  const coverUrl=coverFor(header),releaseDate=runs(header.subtitle).map(r=>clean(r.text)).find(v=>/^\d{4}$/.test(v));
  const tracks=new Map();
  walkRecords(body,node=>{
    const shelf=node.musicShelfRenderer||node.musicPlaylistShelfRenderer;if(!shelf)return false;
    for(const row of arr(shelf.contents).slice(0,100)){
      const track=mapRow(row?.musicResponsiveListItemRenderer||{},"recording",{album:title,albumId:id,credits:credits.some(c=>/^various artists$/i.test(c.name))?[]:credits});
      if(track&&track.albumId==="ytmusic:"+id)tracks.set(track.id,{...track,coverUrl:coverUrl||track.coverUrl,releaseDate});
    }return true;
  });
  return {id:"ytmusic:"+id,title,coverUrl,releaseDate,artistCredits:credits,tracks:[...tracks.values()].slice(0,100)};
}
const isPage=page=>page&&/^ytmusic:UC[A-Za-z0-9_-]{22}$/.test(page.id||"")&&typeof page.name==="string"&&(!page.coverUrl||safeThumbnail(page.coverUrl)===page.coverUrl)&&Array.isArray(page.releases)&&page.releases.length<=100&&page.releases.every(isRelease);
async function requestCatalog(fetchImpl,endpoint,payload) {
  const response=await fetchImpl(origin+endpoint+"?prettyPrint=false",{method:"POST",redirect:"error",credentials:"omit",headers:{"content-type":"application/json",accept:"application/json","x-youtube-client-name":"67","x-youtube-client-version":clientVersion,"x-origin":"https://music.youtube.com"},body:JSON.stringify({...payload,context:{client:{clientName:"WEB_REMIX",clientVersion,hl:"en",gl:"US"}}}),signal:AbortSignal.timeout(6500)});
  if(!response.ok){
    await response.body?.cancel?.().catch(()=>{});
    const error=Error("YouTube Music catalog unavailable");
    error.status=response.status; error.retryAfterMs=retryAfterMs(response.headers); throw error;
  }
  // Bound decoded response size, even when content-length is absent.
  const max=2*1024*1024;
  if(Number(response.headers?.get("content-length"))>max){await response.body?.cancel?.();throw Error("Oversized music catalog");}
  const reader=response.body?.getReader?.();
  let raw;
  if(reader){const chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error("Oversized music catalog");}chunks.push(Buffer.from(value));}raw=Buffer.concat(chunks,size).toString("utf8");}finally{reader.releaseLock();}}
  else {raw=await response.text();if(Buffer.byteLength(raw)>max)throw Error("Oversized music catalog");}
  return JSON.parse(raw);
}
function createYouTubeMusicSearch(fetchImpl=globalThis.fetch,now=Date.now,maxPending=2,{file=""}={}) {
  const cache=new Map(),pending=new Map(),waiting=[];
  const persistent=createResourceCache({file,now,maxEntries:512,maxBytes:12*1024*1024,validate:value=>value&&typeof value==="object"&&Array.isArray(value.items)&&value.items.length<=100&&value.items.every(isTrack)&&(!value.page||isPage(value.page))&&(!value.album||isRelease(value.album))});
  let trace=()=>{};
  const limit=Math.max(1,Math.min(6,maxPending));
  const backgroundLimit=Math.max(1,limit-2);
  let blockedUntil=0,hardBlockedUntil=0,running=0,backgroundRunning=0;
  function pump(){
    while(running<limit&&waiting.length){
      const foreground=waiting.findIndex(job=>!job.background);
      const index=foreground>=0?foreground:backgroundRunning<backgroundLimit?0:-1;
      if(index<0)return;
      const [job]=waiting.splice(index,1);
      clearTimeout(job.timer);job.detach?.();
      if(job.signal?.aborted){job.reject(capacity());continue;}
      if(now()<hardBlockedUntil||(job.background&&now()<blockedUntil)){job.reject(unavailable());continue;}
      trace("catalog-queue",{ms:Math.round(performance.now()-job.queuedAt)});
      running++;const wasBackground=job.background;if(wasBackground)backgroundRunning++;
      void job.run().then(job.resolve,job.reject).finally(()=>{
        running--;if(wasBackground)backgroundRunning--;pump();
      });
    }
  }
  async function scheduled(key,options,work,select=items=>items){
    if(options.signal?.aborted)throw capacity();
    const background=options.artwork===true;
    const hit=cache.get(key);
    if(hit&&now()-hit.at<300000){cache.delete(key);cache.set(key,hit);trace("catalog-cache",{state:"hit"});return select(hit.items);}
    trace("catalog-cache",{state:"miss"});
    const prior=pending.get(key);
    if(prior){
      if(!background){prior.background=false;prior.detach?.();prior.signal=undefined;pump();}
      else if(prior.signal!==options.signal){prior.detach?.();prior.signal=undefined;}
      return prior.promise.then(select);
    }
    if(now()<hardBlockedUntil||(background&&now()<blockedUntil))throw unavailable();
    if((waiting.length>=32&&background)||waiting.length>=48)throw capacity();
    let resolve,reject;
    const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const job={background,queuedAt:performance.now(),signal:options.signal,resolve,reject,timer:null,promise:null,run:async()=>{
      try{
        const started=performance.now();trace("catalog-network",{count:1});
        const items=await work();trace("catalog-response",{ms:Math.round(performance.now()-started),count:Array.isArray(items)?items.length:items?.tracks?.length||0});
        if(Array.isArray(items)?items.length:items)cache.set(key,{at:now(),items});
        while(cache.size>128)cache.delete(cache.keys().next().value);
        return items;
      }catch(error){
        if([401,403,429].includes(error?.status))hardBlockedUntil=Math.max(hardBlockedUntil,now()+providerCooldown(error));
        if(job.background)blockedUntil=Math.max(blockedUntil,now()+providerCooldown(error));
        throw error;
      }
    }};
    const cancelQueued=()=>{
      const index=waiting.indexOf(job);
      if(index>=0){waiting.splice(index,1);clearTimeout(job.timer);job.detach?.();reject(capacity());pump();}
    };
    job.detach=()=>options.signal?.removeEventListener("abort",cancelQueued);
    job.promise=result.finally(()=>{pending.delete(key);clearTimeout(job.timer);job.detach();});
    job.timer=setTimeout(cancelQueued,background?3500:8000);
    pending.set(key,job);waiting.push(job);
    if(options.signal){options.signal.addEventListener("abort",cancelQueued,{once:true});if(options.signal.aborted)cancelQueued();}
    pump();
    return job.promise.then(select);
  };
  function remember(items){
    const byArtist=new Map();
    for(const item of items.filter(isTrack)){
      for(const name of [item.artist,...(item.artistCredits||[]).map(c=>c.name)]){
        const key=artistKey(name);if(!key)continue;
        const group=byArtist.get(key)||new Map();group.set(item.id,item);byArtist.set(key,group);
      }
    }
    for(const [name,group] of byArtist){
      const key=diskKey("artist-tracks",name);
      const old=persistent.get(key)?.items||[];
      const merged=new Map(old.map(item=>[item.id,item]));
      for(const item of group.values()){merged.delete(item.id);merged.set(item.id,item);}
      persistent.set(key,{items:[...merged.values()].slice(-100)},14*86400000);
    }
  }
  const search=async(kind,query,options={})=>{
    if(!Object.hasOwn(filters,kind)||typeof query!=="string"||query.trim().length<2||query.length>160)return [];
    const key=JSON.stringify([kind,query.normalize("NFKC").trim().toLowerCase()]);
    const select=items=>items.filter(v=>(kind==="artist"||options.artistCatalog===true||!isJunkVideo(v.title,query))&&(options.artwork||matchesQuery(query,v.title,v.artist))).slice(0,options.artistCatalog===true?100:25);
    await persistent.hydrate();
    return scheduled(key,options,async()=>{
      const body=await requestCatalog(fetchImpl,"search",{query:query.trim(),params:filters[kind]});
      const items=mapSearchResponse(body,kind,query,false,100,false);
      if(kind!=="artist")remember(items);
      return items;
    },select);
  };
  search.cachedArtist=name=>{
    const wanted=artistKey(name);if(!wanted)return [];
    const items=persistent.get(diskKey("artist-tracks",wanted))?.items||[];
    trace("recording-cache",{state:items.length?"hit":"miss",count:items.length});
    return items;
  };
  search.hydrate=()=>persistent.hydrate();
  search.close=()=>persistent.close();
  search.flush=()=>persistent.flush();
  search.setTrace=fn=>{trace=typeof fn==="function"?fn:()=>{};};
  search.artistCatalog=async(name,wanted,options={})=>{
    await persistent.hydrate();
    const {enrichCatalogTrack,matchMusicArtwork}=require("./artwork.cjs");
    const matches=items=>wanted.filter(track=>{const match=enrichCatalogTrack({...track,coverUrl:undefined},items);return !!match.coverUrl&&items.some(item=>item.id===match.providerId);});
    let known=search.cachedArtist(name);
    if((wanted.length===1||options.allowNameSearch===false)&&!matches(known).length&&!options.signal?.aborted){
      const query=(wanted[0].title+" "+wanted[0].artist).slice(0,160);
      const candidates=await search("recording",query,{...options,artwork:true}).catch(()=>[]);
      known=[...new Map([...known,...candidates].map(row=>[row.id,row])).values()].slice(0,100);
      if(matches(known).length===wanted.length)return known;
    }
    const matchedIds=new Set(wanted.map(track=>enrichCatalogTrack({...track,coverUrl:undefined},known)).filter(track=>track.coverUrl).map(track=>track.providerId));
    const ids=new Set(known.filter(item=>matchedIds.has(item.id)).flatMap(item=>(item.artistCredits||[]).filter(c=>artistKey(c.name)===artistKey(name)).map(c=>c.id)).filter(id=>/^ytmusic:UC[A-Za-z0-9_-]{22}$/.test(id||"")));
    trace("artist-identity-cache",{state:ids.size?"hit":"miss",count:ids.size});
    if(ids.size!==1&&options.allowNameSearch!==false){
      const artists=await search("artist",name.replace(/\s+[-–—]\s+Topic$/i,""),{...options,artwork:true}).catch(()=>[]);
      const exact=artists.filter(item=>artistKey(item.title)===artistKey(name));
      if(exact.length>2&&!ids.size){trace("artist-catalog-match",{state:"ambiguous",count:0,total:wanted.length});return known;}
      for(const artist of exact.slice(0,2))ids.add(artist.id);
    }
    const collected=new Map(known.map(item=>[item.id,item]));
    const verified=[],individualCandidates=new Map();
    for(const candidate of [...ids].slice(0,2)){
      if(options.signal?.aborted)break;
      const id=candidate.slice(8);if(!artistId.test(id))continue;
      const key=diskKey("artist-page",candidate);
      const stored=persistent.get(key);
      let items=stored?.items, page=stored?.page;
      trace("artist-catalog-cache",{state:items?"hit":"miss"});
      if(!items){
        const started=performance.now();
        page=await scheduled("browse:"+id,{...options,artwork:true},async()=>mapArtistPage(await requestCatalog(fetchImpl,"browse",{browseId:id}),id)).catch(()=>null);
        if(!page||artistKey(page.name)!==artistKey(name))continue;
        items=page.tracks;
        if(page.topSongs&&matches(items).length<wanted.length&&!options.signal?.aborted){
          try{
            const more=await scheduled("songs:"+JSON.stringify(page.topSongs),{...options,artwork:true},async()=>mapArtistSongs(await requestCatalog(fetchImpl,"browse",page.topSongs),id,page.name));
            items=[...new Map([...items,...more].map(item=>[item.id,item])).values()].slice(0,100);
          }catch{/* keep initial page when expansion fails */}
        }
        trace("artist-catalog",{ms:Math.round(performance.now()-started),count:items.length});
      }
      if(!page||artistKey(page.name)!==artistKey(name))continue;
      const releases=new Map(page.releases.map(release=>[release.id,release]));
      items=items.map(item=>{
        const release=releases.get(item.albumId);
        return release?{...item,coverUrl:release.coverUrl||item.coverUrl,releaseDate:release.releaseDate}:item;
      });
      // Keep plausible individual rows in memory even if the page association is not verified.
      // The final matcher sees all plausible alternatives and still rejects ambiguity.
      for(const item of items)if(wanted.some(track=>matchMusicArtwork([item],track.title,track.artist,track).coverUrl))individualCandidates.set(item.id,item);
      const corroborated=matches(items);
      // Two distinct matching recommendations, or an already independently matched
      // provider artist ID, are required before persisting an artist page association.
      const trusted=known.some(item=>matchedIds.has(item.id)&&item.artistCredits?.some(c=>c.id===candidate&&artistKey(c.name)===artistKey(name)));
      if(trusted||new Set(corroborated.map(t=>norm(t.title))).size>=2)verified.push({key,items,candidate,page});
    }
    if(verified.length===1){
      const entry=verified[0];
      const {tracks:_,topSongs:__,discography:___,...metadata}=entry.page;
      if(entry.items.length){persistent.set(entry.key,{items:entry.items,page:metadata},7*86400000);remember(entry.items);}
      const page=entry;
      for(const item of page.items)collected.set(item.id,item);
      trace("artist-catalog-match",{count:matches(page.items).length,total:wanted.length});
    }else trace("artist-catalog-match",{state:verified.length?"ambiguous":"unverified",count:0,total:wanted.length});
    for(const row of individualCandidates.values())collected.set(row.id,row);
    const resolved=new Set(matches([...collected.values()]));
    // At most two selected public recommendations receive direct catalog fallbacks;
    // other unresolved items remain eligible for the existing visible artwork pipeline.
    const missing=wanted.filter(track=>!resolved.has(track)).slice(0,2);
    if(!options.signal?.aborted&&missing.length){
      const more=await Promise.all(missing.map(track=>search("recording",(track.title+" "+track.artist).slice(0,160),{...options,artwork:true}).catch(()=>[])));
      for(const rows of more)for(const row of rows)collected.set(row.id,row);
    }
    const all=[...collected.values()];
    const relevant=all.filter(item=>wanted.some(track=>matchMusicArtwork([item],track.title,track.artist,track).coverUrl));
    return [...new Map([...relevant,...all].map(row=>[row.id,row])).values()].slice(0,100);
  };
  // Explicit artist detail retrieval uses the very same queue and parsed page.
  // Discography expansion is requested only by an explicit caller, not every
  // Discover refresh. No artist association is inferred from a text query.
  search.getArtist=async(providerId,options={})=>{
    const id=String(providerId||"").replace(/^ytmusic:/,"");if(!artistId.test(id))return null;
    await persistent.hydrate();
    const cached=persistent.get(diskKey("artist-details","ytmusic:"+id));
    if(cached?.page){trace("artist-catalog-cache",{state:"hit"});return {...cached.page,tracks:cached.items};}
    const page=await scheduled("browse:"+id,options,async()=>mapArtistPage(await requestCatalog(fetchImpl,"browse",{browseId:id}),id));
    if(!page)return null;
    const tracks=new Map(page.tracks.map(track=>[track.id,track])),releases=new Map(page.releases.map(release=>[release.id,release]));
    const jobs=[];
    if(page.topSongs)jobs.push(scheduled("songs:"+JSON.stringify(page.topSongs),options,async()=>mapArtistSongs(await requestCatalog(fetchImpl,"browse",page.topSongs),id,page.name)).then(rows=>{for(const row of rows)tracks.set(row.id,row);}));
    for(const {kind,...endpoint} of page.discography)jobs.push(scheduled("discography:"+JSON.stringify(endpoint),options,async()=>mapDiscography(await requestCatalog(fetchImpl,"browse",endpoint),kind)).then(rows=>{for(const row of rows)releases.set(row.id,row);}));
    const settled=await Promise.allSettled(jobs);
    const items=[...tracks.values()].slice(0,100),{tracks:_,topSongs:__,discography:___,...metadata}=page;
    metadata.releases=[...releases.values()].slice(0,100);
    remember(items);persistent.set(diskKey("artist-page","ytmusic:"+id),{items,page:metadata},7*86400000);
    if(settled.every(job=>job.status==="fulfilled"))persistent.set(diskKey("artist-details","ytmusic:"+id),{items,page:metadata},7*86400000);
    return {...metadata,tracks:items};
  };
  search.getAlbum=async(providerId,options={})=>{
    const id=String(providerId||"").replace(/^ytmusic:/,"");if(!albumIdPattern.test(id))return null;
    await persistent.hydrate();
    const key=diskKey("album","ytmusic:"+id),cached=persistent.get(key);
    if(cached?.album){trace("release-cache",{state:"hit"});return {...cached.album,tracks:cached.items};}
    const page=await scheduled("album:"+id,options,async()=>mapAlbumPage(await requestCatalog(fetchImpl,"browse",{browseId:id}),id));
    if(!page)return null;
    const {tracks:items,...album}=page;remember(items);
    if(items.length)persistent.set(key,{items,album},7*86400000);
    return page;
  };
  return search;
}
// Queue mapping adapted from Liner's innertubeQueueMapper/innertubeCatalog.
// Send only the explicitly selected video ID, not Localtify history or library paths.
function mapRadioResponse(body,seed) {
  const single=body?.contents?.singleColumnMusicWatchNextResultsRenderer;
  const tabs=arr(single?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs);
  const panels=tabs.map(t=>arr(t?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents));
  const queue=panels.find(p=>p.length)||arr(single?.playlistPanelRenderer?.contents);
  const items=queue.length?queue:arr(body?.contents?.twoColumnWatchNextResults?.playlist?.playlist?.contents);
  const seen=new Set([seed]), result=[];
  for(const item of items.slice(0,150)){
    const row=item?.playlistPanelVideoRenderer;
    const id=row?.videoId, title=text(row?.title);
    if(!videoId.test(id||"")||!title||seen.has(id)||isJunkVideo(title,""))continue;
    const byline=row.longBylineText??row.shortBylineText??row.bylineText;
    const metadata=runs(byline);
    const artist=metadata.filter(r=>["MUSIC_PAGE_TYPE_ARTIST","MUSIC_PAGE_TYPE_USER_CHANNEL"].includes(kindOf(r))).map(r=>clean(r.text)).filter(Boolean).join(", ")||text(byline).split("•")[0].trim();
    if(!artist)continue;
    const album=clean(metadata.find(r=>kindOf(r)==="MUSIC_PAGE_TYPE_ALBUM")?.text);
    const durationMs=duration(text(row.lengthText??row.duration));
    seen.add(id);
    result.push({id:"ytmusic:"+id,title,artist,album,subtitle:[artist,album].filter(Boolean).join(" · "),url:"https://www.youtube.com/watch?v="+id,durationMs,coverUrl:coverFor(row,id)});
    if(result.length>=25)break;
  }
  return result;
}
function createYouTubeMusicRadio(fetchImpl=globalThis.fetch,now=Date.now) {
  const cache=new Map(),pending=new Map();
  return async seed=>{
    if(typeof seed!=="string"||!videoId.test(seed))throw Error("Invalid radio seed");
    const hit=cache.get(seed);
    if(hit&&now()-hit.at<300000){cache.delete(seed);cache.set(seed,hit);return hit.items;}
    if(pending.has(seed))return pending.get(seed);
    if(pending.size>=2)throw Error("Music discovery busy");
    const task=requestCatalog(fetchImpl,"next",{videoId:seed,playlistId:"RDAMVM"+seed})
      .then(body=>mapRadioResponse(body,seed)).then(items=>{cache.set(seed,{at:now(),items});while(cache.size>64)cache.delete(cache.keys().next().value);return items;})
      .finally(()=>pending.delete(seed));
    pending.set(seed,task);return task;
  };
}
// Only skip secondary matching if catalog title, artist and known duration agree.
function exactMusicCandidate(wanted, items) {
  const title=norm(wanted?.title || wanted?.name), artist=norm(wanted?.artist || wanted?.artists);
  const durationMs=Number(wanted?.durationMs) || Number(wanted?.duration)*1000 || 0;
  if(!title||!artist||!Number.isFinite(durationMs)||durationMs<=0)return null;
  const exact=arr(items).filter(item=>norm(item.title)===title&&norm(item.artist)===artist&&Number.isFinite(item.durationMs)&&Math.abs(item.durationMs-durationMs)<=3000&&/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(item.url||""));
  // Different video IDs may refer to different recordings; ambiguity falls back.
  const unique=[...new Map(exact.map(item=>[item.url,item])).values()];
  return unique.length===1?unique[0]:null;
}
module.exports={mapArtistPage,mapArtistSongs,mapDiscography,mapAlbumPage,createYouTubeMusicSearch,createYouTubeMusicRadio,mapSearchResponse,mapRadioResponse,safeThumbnail,isJunkVideo,matchesQuery,exactMusicCandidate};
