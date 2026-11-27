"use strict";
const {boundedJson}=require("./extra-artwork.cjs");
const {providerCooldown,unavailable}=require("./provider-health.cjs");
const normalize=v=>String(v||"").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
const clean=v=>typeof v==="string"?v.trim().slice(0,300):"";
const list=v=>Array.isArray(v)?v:[];
const id=v=>Number.isSafeInteger(v)&&v>0;
const suitableVocaDbQuery=term=>/(?:vocaloid|utau|synthesizer\s*v|hatsune\s*miku|kasane\s*teto|初音ミク|重音テト|ボカロ|[\p{Script=Hiragana}\p{Script=Katakana}])/iu.test(term);
function vocaDbItems(kind,body,term){
  const query=normalize(term),seen=new Set();
  return list(body?.items).slice(0,25).flatMap(row=>{
    if(!id(row?.id)||seen.has(row.id))return [];
    const aliases=[...new Set([row.name,row.defaultName,...list(row.names).map(n=>n?.value),...String(row.additionalNames||"").split(",")].map(clean).filter(Boolean))].slice(0,20);
    const title=aliases.find(a=>normalize(a)===query)||clean(row.name)||aliases[0];
    const artist=kind==="artist"?"":clean(row.artistString);
    if(!title||(!artist&&kind==="recording"))return [];
    // Keep each provider identity distinct, including covers and remixes.
    seen.add(row.id);
    const duration=Number(row.lengthSeconds);
    return [{id:"vocadb:"+row.id,title,artist,aliases,subtitle:[artist,clean(row.songType||row.artistType),"VocaDB"].filter(Boolean).join(" · "),
      url:"https://vocadb.net/"+(kind==="artist"?"Ar/":"S/")+row.id,
      ...(kind==="recording"?{songType:clean(row.songType),artistIds:list(row.artists).map(a=>a?.artist?.id).filter(id).slice(0,12).map(a=>"vocadb:"+a)}:{}),
      ...(Number.isFinite(duration)&&duration>0&&duration<=86400?{durationMs:duration*1000}:{})}];
  });
}
function createVocaDbSearch({fetchImpl=globalThis.fetch,now=Date.now,spacingMs=1100}={}){
  const cache=new Map(),pending=new Map();let nextSlot=0,blockedUntil=0;
  return async(kind,term)=>{
    if(!["recording","artist"].includes(kind)||typeof term!=="string"||term.trim().length<2||term.length>160)return [];
    const key=JSON.stringify([kind,normalize(term)]),hit=cache.get(key);
    if(hit&&now()-hit.at<(hit.items.length?86400000:300000)){cache.delete(key);cache.set(key,hit);return hit.items;}
    if(pending.has(key))return pending.get(key);
    if(pending.size>=2||now()<blockedUntil)throw unavailable();
    const slot=Math.max(now(),nextSlot);nextSlot=slot+spacingMs;
    const job=(async()=>{
      if(slot>now())await new Promise(resolve=>setTimeout(resolve,slot-now()));
      if(now()<blockedUntil)throw unavailable();
      const url=new URL("https://vocadb.net/api/"+(kind==="artist"?"artists":"songs"));
      url.search=new URLSearchParams({query:term.trim(),lang:"English",maxEntries:"12",getTotalCount:"false",nameMatchMode:"Auto",fields:kind==="artist"?"Names":"Names,Artists"}).toString();
      const items=vocaDbItems(kind,await boundedJson(fetchImpl,url.href,{"User-Agent":"Localtify (https://github.com/meshahid973/localtify)"}),term);
      cache.set(key,{at:now(),items});while(cache.size>128)cache.delete(cache.keys().next().value);
      return items;
    })().catch(error=>{blockedUntil=Math.max(blockedUntil,now()+providerCooldown(error));throw error;}).finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  };
}
module.exports={createVocaDbSearch,vocaDbItems,suitableVocaDbQuery};
