"use strict";

// Opt-in live-provider verification on integrated CI. No music playback,
// credentials, private library contents or destructive actions are involved.
const {createDeezerArtwork,createFanartArtwork} = require("../electron/discover/extra-artwork.cjs");
const {createLastfmClient} = require("../electron/discover/lastfm.cjs");
const {lastfmArtwork,createArtworkLookup,matchMusicArtwork} = require("../electron/discover/artwork.cjs");
const {createAudioDbArtwork} = require("../electron/discover/audiodb.cjs");
const {createMusicBrainzClient,coverThumbUrl} = require("../electron/musicbrainz/client.cjs");
const {createYouTubeMusicSearch} = require("../electron/discover/youtube-music.cjs");
const {createStoreSearch} = require("../electron/discover/catalog.cjs");
const {createLyricsService} = require("../electron/lyrics/service.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const now = () => Date.now();
const checks = [];
const expectedTitle = "One More Time", expectedArtist = "Daft Punk";
const {parseEnv}=require("node:util");
// The diagnostic runs outside Electron; load only its relevant local keys.
try {
  const local=parseEnv(fs.readFileSync(path.join(__dirname,"..",".env"),"utf8"));
  for(const key of ["LOCALTIFY_LASTFM_API_KEY","LOCALTIFY_AUDIODB_API_KEY","LOCALTIFY_FANART_API_KEY"]) if(!process.env[key]&&local[key])process.env[key]=local[key];
}catch{}
const norm = s => String(s||"").normalize("NFKC").trim().toLowerCase();
const imageHeaders = { "User-Agent":"Localtify artwork validation (https://github.com/meshahid973/localtify)" };

async function imageAvailable(url) {
  if (!/^https:\/\//.test(url||"")) return false;
  const response = await fetch(url,{
    method:"GET",redirect:"follow",headers:{...imageHeaders,Range:"bytes=0-1023"},
    signal:AbortSignal.timeout(6000)
  });
  if (!response.ok || !/^image\//i.test(response.headers.get("content-type")||"")) {
    await response.body?.cancel().catch(()=>{});
    return false;
  }
  const reader = response.body?.getReader();
  if (!reader) return false;
  try {
    const first = await reader.read();
    if (first.done || !first.value || first.value.byteLength < 4) return false;
    const bytes = Buffer.from(first.value);
    return bytes.subarray(0,3).equals(Buffer.from("ffd8ff","hex")) ||
      bytes.subarray(0,4).equals(Buffer.from("89504e47","hex")) ||
      bytes.toString("ascii",0,4)==="RIFF" ||
      bytes.toString("ascii",0,3)==="GIF";
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
async function check(provider,work) {
  const start=now();
  try {
    const outcome=await work();
    checks.push({provider,status:outcome?.status||"unavailable",metadata:outcome?.metadata||false,
      image:outcome?.image||false,elapsedMs:now()-start,
      detail:String(outcome?.detail||"").slice(0,120),
      ...(outcome?.candidates?{candidates:outcome.candidates}:{})});
  } catch(error) {
    checks.push({provider,status:"error",metadata:false,image:false,elapsedMs:now()-start,
      detail:String(error?.message||error).slice(0,120)});
  }
}


const samples=[
  ["One More Time","Daft Punk"],
  ["夜に駆ける","YOASOBI"],
  ["Liar Dancer","masarada"],
  ["Around the World (Live)","Daft Punk"],
  ["Get Lucky","Daft Punk feat. Pharrell Williams & Nile Rodgers"]
];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Compare the actual resolver revisions with the same deterministic responses.
async function controlledResolution(implementation) {
  const cases=[];
  const cover="https://e-cdns-images.dzcdn.net/images/cover/0123456789abcdef0123456789abcdef/250x250-000000-80-0-0.jpg";
  const youtube="https://lh3.googleusercontent.com/fixture=w256-h256-l90-rj";
  for(let i=0;i<samples.length;i++){
    const [title,artist]=samples[i],counts={},pending=[];
    const fake=(name,ms,result,fail=false)=>()=>{
      counts[name]=(counts[name]||0)+1;
      const job=delay(ms).then(()=>{if(fail)throw Error("Fixture provider unavailable");return result;});
      pending.push(job.catch(()=>{}));return job;
    };
    const lookup=implementation({searchRecordings:fake("MusicBrainz",80,[])},Date.now,
      fake("Last.fm",40,null),fake("TheAudioDB",180,{}),
      fake("YouTube Music",i===0?60:1000,i===0?[{title,artist,coverUrl:youtube}]:i===3?[{title:title+" (remix)",artist,coverUrl:youtube}]:[],i===2),
      fake("Deezer",60,i===4?{}:{coverUrl:cover}));
    const started=performance.now();
    const [a,b]=await Promise.all([lookup(title,artist),lookup(title,artist)]);
    const firstMs=Math.round(performance.now()-started);
    if(JSON.stringify(a)!==JSON.stringify(b))throw Error("Concurrent fixture requests diverged");
    const warmStart=performance.now();
    if(a.coverUrl)await lookup(title,artist);
    const warmMs=a.coverUrl?Number((performance.now()-warmStart).toFixed(3)):null;
    await Promise.all(pending);
    cases.push({title,artist,firstMs,warmMs,resolved:Boolean(a.coverUrl),expected:i!==4,counts});
  }
  return cases;
}
// Compare the real IPC and album cache paths, not a synthetic cache implementation.
async function controlledCache(root){
  const {registerDiscoverIpc}=require(path.resolve(root,"electron/ipc/discover.cjs"));
  const {createAudioDbArtwork}=require(path.resolve(root,"electron/discover/audiodb.cjs"));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"localtify-artwork-benchmark-"));
  try{
    let calls=0;
    const coverUrl="https://lh3.googleusercontent.com/fixture=w256-h256-l90-rj";
    const setup=()=>{
      const handlers=new Map();
      const lifecycle=registerDiscoverIpc({handle:(name,handler)=>handlers.set(name,handler)},{
        cacheFile:path.join(dir,"metadata.json"),getSongs:()=>[],getSettings:()=>({discoverEnabled:true}),fetch:async()=>({ok:true,json:async()=>({error:6})}),
        searchYouTubeArtwork:async(kind,query)=>{calls++;await delay(40);return query==="One More Time Daft Punk"&&kind==="recording"?[{title:"One More Time",artist:"Daft Punk",coverUrl}]:[];}
      });
      return {get:(title)=>handlers.get("discover:get")({},{artwork:{title,artist:"Daft Punk"}}),close:()=>lifecycle.close()};
    };
    let app=setup();
    const measure=async work=>{const before=calls,start=performance.now();const result=await work();return {ms:Number((performance.now()-start).toFixed(3)),requests:calls-before,resolved:Boolean(result?.coverUrl)};};
    const cold=await measure(async()=>{const [one,two]=await Promise.all([app.get("One More Time"),app.get("One More Time")]);if(one.coverUrl!==two.coverUrl)throw Error("cache coalescing diverged");return one;});
    const warm=await measure(()=>app.get("One More Time"));
    const missing=await measure(()=>app.get("Unknown fixture"));
    const repeatMissing=await measure(()=>app.get("Unknown fixture"));
    app.close();app=setup();
    const restart=await measure(()=>app.get("One More Time"));
    const restartMissing=await measure(()=>app.get("Unknown fixture"));
    app.close();
    let tracks=0,albums=0,clock=1000;
    const audio=createAudioDbArtwork({apiKey:"123",now:()=>{clock+=3000;return clock;},fetchImpl:async address=>{
      const u=new URL(address);
      if(u.pathname.endsWith("searchtrack.php")){tracks++;return new Response(JSON.stringify({track:[{strTrack:u.searchParams.get("t"),strArtist:"Artist",strAlbum:"Album",idAlbum:"42"}]}));}
      albums++;return new Response(JSON.stringify({album:[{idAlbum:"42",strArtist:"Artist",strAlbum:"Album",strAlbumThumb:"https://www.theaudiodb.com/images/media/album/thumb/example.jpg"}]}));
    }});
    const first=await audio("First","Artist"),second=await audio("Second","Artist");
    if(!first.coverUrl||first.coverUrl!==second.coverUrl||!cold.resolved||!warm.resolved||!restart.resolved||missing.resolved||repeatMissing.resolved||restartMissing.resolved)throw Error("cache fixture returned invalid identity");
    const {createRemoteArtworkCache}=require(path.resolve(root,"electron/runtime/remote-artwork-cache.cjs"));
    const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/zGQAAAAASUVORK5CYII=","base64");
    let imageCalls=0;
    const imageOptions={dir:path.join(dir,"images"),fetchImpl:async()=>{imageCalls++;await delay(40);return new Response(bytes,{headers:{"content-type":"image/png","cache-control":"public,max-age=3600"}});}};
    let images=createRemoteArtworkCache(imageOptions);
    const measureImage=async work=>{const before=imageCalls,start=performance.now();const result=await work();if(!result)throw Error("image fixture did not decode");return {ms:Number((performance.now()-start).toFixed(3)),requests:imageCalls-before};};
    const imageCold=await measureImage(async()=>{const [a,b]=await Promise.all([images.resolve(coverUrl),images.resolve(coverUrl)]);if(a!==b)throw Error("image coalescing diverged");return a;});
    const imageWarm=await measureImage(()=>images.resolve(coverUrl));
    await images.close();images=createRemoteArtworkCache(imageOptions);
    const imageRestart=await measureImage(()=>images.resolve(coverUrl));await images.close();
    return {cold,warm,missing,repeatMissing,restart,restartMissing,album:{tracks,albums},image:{cold:imageCold,warm:imageWarm,restart:imageRestart}};
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
async function liveResolution(){
  const counts={}, pending=new Set();
  const instrument=provider=>async(address,options)=>{
    const stat=counts[provider]??={requests:0,metadataMs:0,failures:0,timeouts:0};
    stat.requests++;
    const started=performance.now();
    try {
      const job=fetch(address,options);
      pending.add(job);
      let response;
      try{response=await job;}finally{pending.delete(job);}
      if(!response.ok)stat.failures++;
      return response;
    }catch(error){stat.failures++;if(error?.name==="TimeoutError"||error?.name==="AbortError")stat.timeouts++;throw error;}
    finally{stat.metadataMs+=Math.round(performance.now()-started);}
  };
  const youtube=createYouTubeMusicSearch(instrument("YouTube Music"),Date.now,4);
  const deezer=createDeezerArtwork({fetchImpl:instrument("Deezer")});
  const audio=createAudioDbArtwork({apiKey:process.env.LOCALTIFY_AUDIODB_API_KEY||"123",fetchImpl:instrument("TheAudioDB")});
  const lastfm=/^[a-f0-9]{32}$/i.test(process.env.LOCALTIFY_LASTFM_API_KEY||"")?createLastfmClient({apiKey:process.env.LOCALTIFY_LASTFM_API_KEY,fetch:instrument("Last.fm"),artwork:true}):null;
  const brainz=createMusicBrainzClient({userAgent:"Localtify artwork validation (https://github.com/meshahid973/localtify)",fetchImpl:instrument("MusicBrainz"),timeoutMs:9000});
  const fanart=createFanartArtwork({apiKey:process.env.LOCALTIFY_FANART_API_KEY,fetchImpl:instrument("Fanart.tv")});
  const lookup=createArtworkLookup(brainz,Date.now,lastfm?lastfm.trackInfo:undefined,audio?.resolve,
    async(title,artist,identity,signal)=>{
      const query=(title+" "+artist).slice(0,160);
      const songs=await youtube("recording",query,{artwork:true});
      if(matchMusicArtwork(songs,title,artist).coverUrl||signal?.aborted)return songs;
      return [...songs,...await youtube("video",query,{artwork:true})];
    },deezer.resolve,fanart?.resolve);
  const cases=[];
  for(const [title,artist] of samples){
    const start=performance.now();
    try {
      const result=await lookup(title,artist);
      const metadataMs=Math.round(performance.now()-start),imageStart=performance.now();
      const image=result.coverUrl?await imageAvailable(result.coverUrl).catch(()=>false):false;
      cases.push({title,artist,metadataMs,imageMs:result.coverUrl?Math.round(performance.now()-imageStart):null,status:result.coverUrl?(image?"ok":"image-unavailable"):"missing"});
    }catch{cases.push({title,artist,metadataMs:Math.round(performance.now()-start),imageMs:null,status:"temporarily-unavailable"});}
  }
  await Promise.allSettled([...pending]);
  return {cases,providers:counts,note:"Network metadata timing is time to response headers; per-track metadataMs includes parsing, scheduling and matching. No user library data."};
}

async function controlledRecommendation(root,batch){
  const {discover}=require(path.resolve(root,"electron/discover/recommend.cjs"));
  const {matchMusicArtwork}=require(path.resolve(root,"electron/discover/artwork.cjs"));
  const artists=["Public Artist A","Public Artist B","Public Artist C"];
  const tracks=artist=>["First","Second","Third"].map((title,index)=>({title,artist,url:"https://last.fm/music/"+encodeURIComponent(artist)+"/"+title,index}));
  const rows=artist=>tracks(artist).map(({index,...track})=>({...track,id:"ytmusic:abcdefghi"+artists.indexOf(artist)+index,coverUrl:"https://lh3.googleusercontent.com/fixture"+artists.indexOf(artist)+index+"=w256-h256-l90-rj"}));
  let requests=0,firstShelfMs=null;
  const start=performance.now();
  const client={similarArtists:async()=>artists.map((name,index)=>({name,match:1-index*.1,url:"https://last.fm/music/"+encodeURIComponent(name)})),
    topTracks:async artist=>{await delay(artist===artists[2]?500:30);return artists.includes(artist)?tracks(artist):[];}};
  const result=await discover({songs:[{title:"Owned",artist:"Public Seed",playCount:10}],client,
    ...(batch?{catalog:async artist=>{requests++;await delay(40);return rows(artist);},onProgress:partial=>{
      if(partial.artists.flatMap(artist=>artist.topTracks).filter(track=>track.coverUrl).length>=3)firstShelfMs=Math.round(performance.now()-start);
    }}:{})});
  const all=result.artists.flatMap(artist=>artist.topTracks);
  if(!batch){
    for(let i=0;i<all.length;i+=4){
      await Promise.all(all.slice(i,i+4).map(async track=>{requests++;await delay(40);Object.assign(track,matchMusicArtwork(rows(track.artist),track.title,track.artist));}));
      if(firstShelfMs===null)firstShelfMs=Math.round(performance.now()-start);
    }
  }
  return {firstShelfMs,totalMs:Math.round(performance.now()-start),artworkRequests:requests,tracks:all.length,attached:all.filter(track=>track.coverUrl).length};
}
async function liveCatalogBatch(){
  const {enrichCatalogTrack}=require("../electron/discover/artwork.cjs");
  const artist="Daft Punk",tracks=["One More Time","Digital Love","Harder, Better, Faster, Stronger"].map(title=>({title,artist}));
  let requests=0;
  const client=createMusicBrainzClient({userAgent:"Localtify/0.5.1 (https://github.com/meshahid973/localtify)",timeoutMs:9000,
    fetchImpl:async(url,options)=>{requests++;return fetch(url,options);}});
  const start=performance.now();
  try{
    const records=await client.searchRecordingBatch(artist,tracks.map(t=>t.title),{background:true});
    const catalogMs=Math.round(performance.now()-start);
    const results=await Promise.all(tracks.map(async track=>{
      const row=enrichCatalogTrack(track,records);
      const imageStart=performance.now();
      const image=row.coverUrl?await imageAvailable(row.coverUrl).catch(()=>false):false;
      return {title:track.title,exactRecordingCount:records.filter(record=>norm(record.title)===norm(track.title)&&norm((record["artist-credit"]||[]).map(c=>(c.name||c.artist?.name||"")+(c.joinphrase||"")).join(""))===norm(artist)).length,attached:Boolean(row.coverUrl),image,imageMs:row.coverUrl?Math.round(performance.now()-imageStart):null};
    }));
    return {artist,requests,catalogMs,records:records.length,frontMarked:records.filter(row=>row.releases?.some(release=>release["cover-art-archive"]?.front===true)).length,results};
  }catch{return {artist,requests,catalogMs:Math.round(performance.now()-start),status:"unavailable"};}
}
async function main() {
  const jobs=[];
  jobs.push(check("Deezer",async()=>{
    let httpStatus=0, responseType="", candidates=[];
    const lookup=createDeezerArtwork({fetchImpl:async(url,options)=>{
      const response=await fetch(url,options);
      httpStatus=response.status;
      responseType=String(response.headers.get("content-type")||"").slice(0,50);
      if(response.ok && Number(response.headers.get("content-length")||0)<512*1024) {
        const json=await response.clone().json().catch(()=>null);
        candidates=Array.isArray(json?.data)?json.data.slice(0,8).map(row=>({
          title:String(row.title||"").slice(0,70),artist:String(row.artist?.name||"").slice(0,70),
          duration:Number(row.duration||0),albumId:row.album?.id||null,
          coverMedium:Boolean(row.album?.cover_medium)
        })):[];
      }
      return response;
    }});
    const result=await lookup("recording",expectedTitle,expectedArtist);
    if(!result?.coverUrl) return {status:httpStatus && httpStatus!==200?"http-"+httpStatus:"no-exact-match",
      detail:httpStatus?"HTTP "+httpStatus+"; "+responseType:"No response or network error",candidates};
    const image=await imageAvailable(result.coverUrl).catch(()=>false);
    return {status:image?"ok":"image-unavailable",metadata:true,image};
  }));
  jobs.push(check("Apple music catalog",async()=>{
    const items=await createStoreSearch()(expectedArtist+" "+expectedTitle);
    const found=items.some(item=>norm(item.title)===norm(expectedTitle)&&norm(item.artist)===norm(expectedArtist));
    return {status:found?"ok":"no-exact-match",metadata:found,image:false,
      detail:"Catalog metadata only; artwork and previews intentionally omitted"};
  }));
  jobs.push(check("LRCLIB",async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"localtify-live-lyrics-"));
    try {
      const service=createLyricsService({cacheDir:dir,
        userAgent:"Localtify/0.5.1 (https://github.com/meshahid973/localtify)",
        readEmbedded:async()=>null,requestSpacingMs:0,retryDelayMs:600});
      const result=await service.get({title:expectedTitle,artist:expectedArtist,
        album:"Discovery",duration:320,filePath:""},{online:true});
      return {status:result.status==="error"?"error":
        ["synced","plain","instrumental"].includes(result.status)?"ok":"no-exact-match",
        metadata:["synced","plain","instrumental"].includes(result.status),image:false,
        detail:result.error||result.status};
    }finally {fs.rmSync(dir,{recursive:true,force:true});}
  }));
  jobs.push(check("MusicBrainz and Cover Art Archive",async()=>{
    const client=createMusicBrainzClient({
      userAgent:"Localtify/0.5.1 (https://github.com/meshahid973/localtify)",
      timeoutMs:9000
    });
    const matches=await client.searchRecordings(expectedTitle,expectedArtist,{background:true});
    const found=matches.find(row=>norm(row?.title)===norm(expectedTitle) &&
      (row?.["artist-credit"]||[]).some(credit=>norm(credit?.artist?.name)===norm(expectedArtist)));
    if(!found)return {status:"no-exact-match",detail:"MusicBrainz identity search yielded no exact match"};
    const release=(found.releases||[]).find(row=>/^[0-9a-f-]{36}$/i.test(row?.id||""));
    if(!release)return {status:"catalog-only",metadata:true,detail:"No release URL for CAA validation"};
    const image=await imageAvailable(coverThumbUrl(release.id)).catch(()=>false);
    return {status:image?"ok":"image-unavailable",metadata:true,image};
  }));
  jobs.push(check("YouTube Music",async()=>{
    const items=await createYouTubeMusicSearch()("recording",expectedArtist+" "+expectedTitle,{artwork:true});
    const found=items.find(row=>norm(row.title)===norm(expectedTitle)&&norm(row.artist)===norm(expectedArtist));
    if(!found?.coverUrl)return {status:"no-exact-match",detail:"No unambiguous exact recording with artwork"};
    const image=await imageAvailable(found.coverUrl).catch(()=>false);
    return {status:image?"ok":"image-unavailable",metadata:true,image};
  }));
  jobs.push(check("TheAudioDB",async()=>{
    // 123 is TheAudioDB's documented public demo key. An operator-provided
    // key can override it, but is never serialized into this report.
    const key=process.env.LOCALTIFY_AUDIODB_API_KEY||"123";
    const lookup=createAudioDbArtwork({apiKey:key});
    if(!lookup)return {status:"skipped",detail:"Invalid provider key"};
    const result=await lookup(expectedTitle,expectedArtist);
    if(!result?.coverUrl)return {status:"no-exact-match",detail:"No exact track and album identity"};
    const image=await imageAvailable(result.coverUrl).catch(()=>false);
    return {status:image?"ok":"image-unavailable",metadata:true,image};
  }));
  checks.push({provider:"Spotify",status:"skipped-auth-required",
    metadata:false,image:false,detail:"Personal OAuth or authorized session is required"});
  checks.push({provider:"Discord RPC",status:"skipped-local-runtime",
    metadata:false,image:false,detail:"Requires a running local Discord client"});
  if(!process.env.LOCALTIFY_LASTFM_API_KEY)checks.push({
    provider:"Last.fm",status:"skipped-key-required",metadata:false,image:false,detail:"Operator API key not configured"
  });
  else jobs.push(check("Last.fm",async()=>{
    const key=process.env.LOCALTIFY_LASTFM_API_KEY;
    if(!/^[a-f0-9]{32}$/i.test(key))return {status:"invalid-key-format",detail:"Expected a 32-character API key"};
    const client=createLastfmClient({apiKey:key});
    const track=await client.trackInfo(expectedTitle,expectedArtist);
    if(norm(track?.name)!==norm(expectedTitle)||norm(track?.artist?.name)!==norm(expectedArtist))
      return {status:"no-exact-match",detail:"Authenticated query did not resolve the expected recording"};
    const result=lastfmArtwork(track,expectedTitle,expectedArtist);
    const image=result.coverUrl?await imageAvailable(result.coverUrl).catch(()=>false):false;
    return {status:!result.coverUrl?"metadata-only":image?"ok":"image-unavailable",metadata:true,image};
  }));
  if(!process.env.LOCALTIFY_FANART_API_KEY)checks.push({
    provider:"Fanart.tv",status:"skipped-key-required",metadata:false,image:false,detail:"Operator API key not configured"
  });
  else jobs.push(check("Fanart.tv",async()=>{
    let httpStatus=0;
    const lookup=createFanartArtwork({apiKey:process.env.LOCALTIFY_FANART_API_KEY,fetchImpl:async(url,options)=>{
      const response=await fetch(url,options);httpStatus=response.status;return response;
    }});
    if(!lookup)return {status:"invalid-key-format",detail:"Invalid Fanart.tv key format"};
    const client=createMusicBrainzClient({userAgent:"Localtify/0.5.1 (https://github.com/meshahid973/localtify)",timeoutMs:9000});
    const artists=await client.searchCatalog("artist",expectedArtist,{background:true});
    const exact=artists.filter(item=>norm(item.name)===norm(expectedArtist));
    if(exact.length!==1)return {status:"catalog-ambiguous",detail:"Cannot identify the artist MBID safely"};
    const result=await lookup("artist",exact[0].id);
    if(!result.coverUrl)return {status:httpStatus>=400?"http-"+httpStatus:"no-artwork",metadata:httpStatus===200,detail:httpStatus?"Fanart.tv HTTP "+httpStatus:"No provider response"};
    const image=await imageAvailable(result.coverUrl).catch(()=>false);
    return {status:image?"ok":"image-unavailable",metadata:true,image};
  }));
  await Promise.all(jobs);
  const sorted=checks.sort((a,b)=>a.provider.localeCompare(b.provider));
  const baselineArg=process.argv.indexOf("--baseline-root");
  const baselineRoot=baselineArg>=0?process.argv[baselineArg+1]:"";
  const resolution=process.argv.includes("--resolution")||baselineRoot?await liveResolution():undefined;
  const comparison=baselineRoot?{
    baseline:await controlledResolution(require(path.resolve(baselineRoot,"electron/discover/artwork.cjs")).createArtworkLookup),
    candidate:await controlledResolution(createArtworkLookup)
  }:undefined;
  if(comparison&&[...comparison.baseline,...comparison.candidate].some(row=>row.resolved!==row.expected))throw Error("Controlled artwork identity resolution diverged");
  const cacheComparison=baselineRoot?{baseline:await controlledCache(baselineRoot),candidate:await controlledCache(path.resolve(__dirname,".."))}:undefined;
  const catalogBatch=process.argv.includes("--resolution")||baselineRoot?await liveCatalogBatch():undefined;
  const recommendationComparison=baselineRoot?{baseline:await controlledRecommendation(baselineRoot,false),candidate:await controlledRecommendation(path.resolve(__dirname,".."),true)}:undefined;
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),sample:{title:expectedTitle,artist:expectedArtist},
    checks:sorted,resolution,comparison,cacheComparison,catalogBatch,recommendationComparison,note:"Advisory network observation, not a guarantee of future provider availability"},null,2));
  // Manual release acceptance must not silently pass without configured keys
  // or when either keyed integration is unable to retrieve usable artwork.
  if(process.argv.includes("--require-keyed")) {
    const failed=["Last.fm","Fanart.tv"].filter(name=>sorted.find(row=>row.provider===name)?.status!=="ok");
    if(failed.length) {
      console.error("Keyed artwork acceptance failed (keys omitted from output): "+failed.join(", "));
      process.exitCode=1;
    }
  }
}
main().catch(error=>{console.error("Provider audit failed:",error);process.exitCode=1});
