"use strict";
// Preserve the selected catalog identity through the existing metadata-download journal.
const selectedYouTubeId = value => /^ytmusic-([A-Za-z0-9_-]{11})$/.exec(String(value || ""))?.[1] || "";
const selectedYouTubeUrl = value => {
  const id = selectedYouTubeId(value);
  return id ? "https://www.youtube.com/watch?v=" + id : "";
};
const validTrackIdentity = value => /^[a-zA-Z0-9]{1,64}$/.test(String(value || "")) || /^lastfm-[a-z0-9]{1,7}$/.test(String(value || "")) || Boolean(selectedYouTubeId(value));
const musicBrainzRecordingUrl = value => {
  const compact = /^mb([a-f0-9]{32})$/i.exec(String(value || ""))?.[1];
  if (!compact) return "";
  const id = [compact.slice(0,8),compact.slice(8,12),compact.slice(12,16),compact.slice(16,20),compact.slice(20)].join("-");
  return "https://musicbrainz.org/recording/" + id.toLowerCase();
};

// Catalog identity matching follows the source-profile / candidate-ranking /
// ambiguity evaluation structure of tryliner/desktop src/shared/media/matching.
// Adapted for Localtify: full credits and all version tags must agree; a fuzzy
// title alone is never sufficient to identify a recording.
const {getVersionTags}=require("./version-tags.cjs");
const mbid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const clean=value=>typeof value==="string"?value.normalize("NFKC").trim().slice(0,300):"";
const normalized=value=>clean(value).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu," ").trim();
const artistText=value=>clean(value).replace(/\s+[-–—]\s+topic$/i,"").replace(/\s+(?:feat\.?|ft\.?|and)\s+|\s*[,＆&]\s*/gi," ");
const artistKey=value=>normalized(artistText(value));
const titleNoise=/\s*[([]\s*(?:official\s+(?:music\s+)?video|official\s+audio|lyric\s+video|official\s+lyric\s+video|official\s+visuali[sz]er)\s*[)\]]\s*$/i;
const feature=/\s*[([]\s*(?:feat\.?|ft\.?)\s+([^()[\]]+)\s*[)\]]\s*$/i;
const validDuration=value=>Number.isFinite(value)&&value>0&&value<=86400000;
const isrc=value=>typeof value==="string"&&/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(value)?value.toUpperCase():undefined;
const list=value=>Array.isArray(value)?value:[];
const recordingKey=value=>{
  const id=String(value||"");
  if(mbid.test(id))return "musicbrainz:recording:"+id.toLowerCase();
  if(/^musicbrainz:recording:[a-f0-9-]{36}$/i.test(id)&&mbid.test(id.slice(22)))return id.toLowerCase();
  if(/^ytmusic:[A-Za-z0-9_-]{11}$/.test(id))return "ytmusic:recording:"+id.slice(8);
  if(/^ytmusic:recording:[A-Za-z0-9_-]{11}$/.test(id))return id;
  if(/^(?:vocadb|itunes|deezer):[1-9]\d{0,19}$/.test(id))return id.replace(":",":recording:");
  if(/^(?:vocadb|itunes|deezer):recording:[1-9]\d{0,19}$/.test(id))return id;
  return "";
};
function getCredits(item){
  const raw=list(item?.["artist-credit"]);
  if(raw.length)return raw.slice(0,16).flatMap(c=>{
    const name=clean(c?.name||c?.artist?.name),id=c?.artist?.id;
    const aliases=list(c?.artist?.aliases).map(a=>clean(a?.name)).filter(Boolean).slice(0,12);
    return name?[{name,...(mbid.test(id||"")?{id:"musicbrainz:artist:"+id.toLowerCase()}:{}),...(aliases.length?{aliases}:{})}]:[];
  });
  return list(item?.artistCredits).slice(0,16).flatMap(c=>{
    const name=clean(c?.name),id=typeof c?.id==="string"&&/^(?:ytmusic:UC[A-Za-z0-9_-]{22}|musicbrainz:artist:[a-f0-9-]{36}|vocadb:\d+|deezer:\d+)$/.test(c.id)?c.id:undefined;
    return name?[{name,...(id?{id}:{}),...(id&&list(c.aliases).length?{aliases:list(c.aliases).map(clean).filter(Boolean).slice(0,12)}:{})}]:[];
  });
}
function profile(item){
  const raw=clean(item?.title||item?.name);
  const credits=getCredits(item);
  const artist=clean(item?.artist||item?.artists||credits.map(c=>c.name).join(", "));
  const base=raw.replace(titleNoise,"");
  const featured=feature.exec(base)?.[1];
  const stripped=featured?base.replace(feature,""):base;
  const withFeature=value=>featured&&artistKey(value)!==artistKey(featured)&&!artistKey(value).endsWith(" "+artistKey(featured))?value+" "+featured:value;
  const artistWithFeature=withFeature(artist);
  const titleForms=value=>{
    const parts=value.split(/\s+[-–—]\s+/);
    return [normalized(value),...(parts.length>1&&artistKey(parts[0])===artistKey(artist)?[normalized(parts.slice(1).join(" - "))]:[])].filter(Boolean);
  };
  const titles=new Set(titleForms(stripped));
  // Only provider-supplied aliases for this recording are accepted.
  const aliases=recordingKey(item?.id)&&String(item.id).startsWith("vocadb:")?list(item.aliases):[];
  for(const alias of aliases.slice(0,20))if(sameTags(raw,alias))for(const value of titleForms(clean(alias).replace(titleNoise,"").replace(feature,"")))titles.add(value);
  const versions=getVersionTags(raw);
  const songType=String(item?.songType||"").toLowerCase();
  if(["remix","cover","instrumental","live"].includes(songType))versions.add(songType);
  const durationMs=validDuration(item?.durationMs)?item.durationMs:validDuration(item?.length)?item.length:undefined;
  const ids=new Set([item?.providerId,item?.recordingId,item?.id].map(recordingKey).filter(Boolean));
  const album=clean(item?.album||item?.albumName);
  return {raw,artist,artistKey:artistKey(artistWithFeature),creditKey:artistKey(withFeature(credits.map(c=>c.name).join(" ")||artist)),featureKey:artistKey(featured),credits,titles,versions,durationMs,album,ids,isrc:isrc(item?.isrc||list(item?.isrcs)[0])};
}
function sameTags(a,b){const x=getVersionTags(clean(a)),y=getVersionTags(clean(b));return x.size===y.size&&[...x].every(tag=>y.has(tag));}
function sameSet(a,b){return a.size===b.size&&[...a].every(v=>b.has(v));}
function dice(a,b){
  if(a===b)return 1;if(a.length<2||b.length<2)return 0;
  const pairs=new Map();for(let i=0;i<a.length-1;i++){const s=a.slice(i,i+2);pairs.set(s,(pairs.get(s)||0)+1);}
  let hits=0;for(let i=0;i<b.length-1;i++){const s=b.slice(i,i+2),n=pairs.get(s)||0;if(n){hits++;pairs.set(s,n-1);}}
  return 2*hits/(a.length+b.length-2);
}
function rankRecording(source,item,{requireKnownDuration=true}={}){
  const candidate=profile(item),id=recordingKey(item?.id),reject=reason=>({item,id,reason,score:0});
  if(!source.raw||!source.artist||!candidate.raw||!candidate.artist)return reject("incomplete");
  if(!sameSet(source.versions,candidate.versions))return reject("version-mismatch");
  // An explicit identity is authoritative within the same provider only.
  const selected=[...source.ids].filter(v=>v.split(":")[0]===id.split(":")[0]);
  if(id&&selected.length&&!selected.includes(id))return reject("provider-id-mismatch");
  const sameId=id&&source.ids.has(id);
  const sourceCreditIds=new Set(source.credits.map(c=>c.id).filter(Boolean));
  const candidateCreditIds=new Set(candidate.credits.map(c=>c.id).filter(Boolean));
  const sameCreditIds=sourceCreditIds.size>0&&sourceCreditIds.size===source.credits.length&&candidateCreditIds.size===candidate.credits.length&&sameSet(sourceCreditIds,candidateCreditIds)&&source.featureKey===candidate.featureKey;
  const artistExact=source.artistKey===candidate.artistKey||source.artistKey===candidate.creditKey||source.creditKey===candidate.artistKey;
  const aliasMatch=source.credits.length<=1&&candidate.credits.length===1&&candidate.credits[0].id&&list(candidate.credits[0].aliases).some(a=>artistKey(a)===source.artistKey);
  if(!artistExact&&!sameCreditIds&&!aliasMatch)return reject("artist-mismatch");
  const exact=[...source.titles].some(t=>candidate.titles.has(t));
  const delta=source.durationMs&&candidate.durationMs?Math.abs(source.durationMs-candidate.durationMs):undefined;
  if(delta!==undefined&&delta>5000)return reject("duration-mismatch");
  if(requireKnownDuration&&source.durationMs&&!candidate.durationMs&&!sameId)return reject("duration-missing");
  if(source.album&&candidate.album&&normalized(source.album)!==normalized(candidate.album)&&!sameId)return reject("release-mismatch");
  if(source.isrc&&candidate.isrc&&source.isrc!==candidate.isrc)return reject("isrc-mismatch");
  const sameIsrc=source.isrc&&source.isrc===candidate.isrc;
  const fuzzy=!exact&&delta!==undefined&&delta<=2000&&(artistExact||sameCreditIds)&&[...source.titles].some(a=>a.length>=6&&[...candidate.titles].some(b=>b.length>=6&&dice(a,b)>=.93));
  if(!exact&&!fuzzy)return reject("title-mismatch");
  const score=(exact?50:42)+(artistExact||sameCreditIds?30:25)+10+(delta===undefined?0:delta<=2000?10:delta<=3000?5:1)+(source.album&&candidate.album?8:0)+(sameId?100:0)+(sameIsrc?30:0);
  return {item,id,score,reason:sameId?"provider-id":sameIsrc?"isrc":exact?"metadata":"duration-supported-title"};
}
function evaluateRecording(source,items,options={}){
  const wanted=profile(source),ranked=[],rejected={};
  const seen=new Map();
  for(const item of list(items).slice(0,200)){
    const key=recordingKey(item?.id);
    if(key){if(!seen.has(key))seen.set(key,item);}
    else ranked.push(rankRecording(wanted,item,options));
  }
  for(const item of seen.values())ranked.push(rankRecording(wanted,item,options));
  for(const row of ranked)if(!row.score)rejected[row.reason]=(rejected[row.reason]||0)+1;
  const valid=ranked.filter(row=>row.score>=85).sort((a,b)=>b.score-a.score);
  const best=valid[0],second=valid[1];
  if(!best)return {status:"unresolved",reason:ranked.length?"no-confident-match":"no-candidates",rejected};
  if(second&&best.id!==second.id&&best.score-second.score<10)return {status:"ambiguous",reason:"multiple-recordings",candidates:valid.filter(row=>best.score-row.score<10).map(row=>row.item),rejected};
  return {status:"matched",candidate:best.item,score:Math.min(100,best.score),reason:best.reason,rejected};
}
function canonicalIdentity(item,{confidence=100,now=Date.now()}={}){
  const id=[item?.id,item?.providerId,item?.recordingId].map(recordingKey).find(Boolean);
  if(!id)return undefined;
  const credits=getCredits(item),provider=id.split(":")[0];
  const safe=require("../runtime/remote-cover.cjs").safeDisplayCover;
  const artwork=[...new Set([item.coverUrl,item.fallbackCoverUrl,...list(item.coverAlternatives)].filter(safe))].slice(0,6);
  const releaseId=mbid.test(item.releaseId||"")?"musicbrainz:release:"+item.releaseId.toLowerCase():undefined;
  const releaseGroupId=mbid.test(item.releaseGroupId||"")?"musicbrainz:release-group:"+item.releaseGroupId.toLowerCase():undefined;
  const albumId=/^ytmusic:MPREb_[A-Za-z0-9_-]{1,80}$/.test(item.albumId||"")?item.albumId:undefined;
  const publicUrl=typeof item.url==="string"&&/^(?:https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}|https:\/\/musicbrainz\.org\/recording\/[a-f0-9-]{36}|https:\/\/vocadb\.net\/S\/\d+|https:\/\/www\.deezer\.com\/track\/\d+)$/.test(item.url)?item.url:undefined;
  return {title:clean(item.title||item.name),providerIds:[id],artistCredits:credits.length?credits:[{name:clean(item.artist)}].filter(c=>c.name),
    ...(albumId?{albumId}:{}),...(releaseId?{releaseId}:{}),...(releaseGroupId?{releaseGroupId}:{}),
    ...(clean(item.album)?{album:clean(item.album)}:{}),...(clean(item.releaseDate)?{releaseDate:clean(item.releaseDate)}:{}),
    ...(validDuration(item.durationMs)?{durationMs:item.durationMs}:{}),...(isrc(item.isrc||list(item.isrcs)[0])?{isrc:isrc(item.isrc||list(item.isrcs)[0])}:{}),
    ...(publicUrl?{publicUrl}:{}),...(artwork.length?{artwork}:{}),
    ...(provider==="vocadb"&&list(item.aliases).length?{titleAliases:list(item.aliases).map(clean).filter(Boolean).slice(0,20)}:{}),
    versions:[...profile(item).versions],provenance:provider,confidence:Math.max(0,Math.min(100,confidence)),verifiedAt:now};
}
module.exports = { selectedYouTubeId, selectedYouTubeUrl, validTrackIdentity, musicBrainzRecordingUrl, recordingKey, evaluateRecording, canonicalIdentity };
