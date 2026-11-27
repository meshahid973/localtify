"use strict";

// Discover: music from outside your library, picked from what Last.fm says is similar to what you own and play.
// Artists you already have and artists marked "not for me" are left out; songs you already have are left out.
const { artistCredits, notForMeTest } = require("../analysis/listening-signals.cjs");
const { enrichCatalogTrack } = require("./artwork.cjs");
const { safeDisplayCover } = require("../runtime/remote-cover.cjs");

const DAY_MS = 24 * 60 * 60 * 1000;
const SEED_ARTISTS = 15;
const MISSING_SONG_ARTISTS = 8;
const MISSING_SONGS_PER_ARTIST = 4;
const RESULT_ARTISTS = 24;
const TOP_TRACK_ARTISTS = 12;
const MAX_REASONS = 3;
// Each further pick led by the same artist you play counts for less, so one favourite can't fill the page.
const REPEAT_LEAD_PENALTY = .6;

const key = (text) => String(text || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
// "Song (feat. X) - 2011 Remaster" and "song" are the same song for "do I already have it".
function titleKey(title) {
  return key(title).replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const trackKey = (artist, title) => `${key(artistCredits(artist)[0])}|${titleKey(title)}`;

/** Who you listen to most (plays, likes, recent listening), and which artists and songs you already have. */
function libraryTaste(songs, hidden, now = Date.now()) {
  const artists = new Map();
  const ownedArtists = new Set();
  const ownedTracks = new Set();
  for (const song of songs) {
    const credits = artistCredits(song.artist);
    if (!credits.length) continue;
    ownedTracks.add(trackKey(song.artist, song.title));
    const recent = now - (Date.parse(song.lastPlayed || "") || 0) < 30 * DAY_MS;
    const weight = .1 + Math.log1p(Number(song.playCount) || 0) + (song.liked ? 1.5 : 0) + (recent ? .5 : 0);
    credits.forEach((name, index) => {
      ownedArtists.add(key(name));
      if (key(name) === "unknown artist" || hidden({ artist: name })) return;
      const entry = artists.get(key(name)) || { name, weight: 0 };
      // The lead artist carries the song; featured artists count for less.
      entry.weight += index === 0 ? weight : weight / 2;
      artists.set(key(name), entry);
    });
  }
  const seeds = [...artists.values()].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, SEED_ARTISTS);
  const top = seeds[0]?.weight || 1;
  // Square-rooted so a favourite with ten times the plays leads, but doesn't drown out everyone else.
  seeds.forEach((seed) => { seed.weight = Math.sqrt(seed.weight / top); });
  return { seeds, ownedArtists, ownedTracks };
}

// Every lookup is tried; one artist Last.fm doesn't know shouldn't sink the rest. A rejected key stops everything.
async function settleAll(items, lookup) {
  const results = await Promise.allSettled(items.map(lookup));
  const failure = results.find((result) => result.status === "rejected");
  if (failure && (failure.reason?.code === "bad-key" || results.every((result) => result.status === "rejected"))) throw failure.reason;
  return results.map((result) => (result.status === "fulfilled" ? result.value : []));
}

function addReason(entry, reason, amount) {
  entry.score += amount;
  const existing = entry.reasons.find((item) => item.name === reason);
  if (existing) existing.amount += amount; else entry.reasons.push({ name: reason, amount });
}
const because = (entry) => entry.reasons.sort((a, b) => b.amount - a.amount).slice(0, MAX_REASONS).map((item) => item.name);

function diversify(entries, limit) {
  const pool = [...entries].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const leads = new Map();
  const picked = [];
  while (picked.length < limit && pool.length) {
    let best = 0; let bestScore = -Infinity;
    pool.forEach((entry, index) => {
      const score = entry.score / (1 + REPEAT_LEAD_PENALTY * (leads.get(because(entry)[0]) || 0));
      if (score > bestScore) { bestScore = score; best = index; }
    });
    const [entry] = pool.splice(best, 1);
    picked.push(entry);
    const lead = because(entry)[0];
    leads.set(lead, (leads.get(lead) || 0) + 1);
  }
  return picked;
}

async function discover({ songs, hiddenArtists = [], client, now = Date.now(), catalog, cachedArtwork, active = () => true, onProgress = () => {}, trace = () => {} }) {
  const hidden = notForMeTest([], hiddenArtists);
  const taste = libraryTaste(songs, hidden, now);
  if (!taste.seeds.length) return { status: "no-taste", generatedAt: now, seeds: [], artists: [], tracks: [] };

  const similarStart=performance.now();
  const similar = await settleAll(taste.seeds, (seed) => client.similarArtists(seed.name));
  trace("similar-artists",{ms:Math.round(performance.now()-similarStart),count:taste.seeds.length});
  const artists = new Map();
  taste.seeds.forEach((seed, index) => {
    for (const candidate of similar[index]) {
      const id = key(candidate.name);
      if (taste.ownedArtists.has(id) || hidden({ artist: candidate.name })) continue;
      const entry = artists.get(id) || { name: candidate.name, url: candidate.url, score: 0, reasons: [] };
      addReason(entry, seed.name, seed.weight * candidate.match);
      artists.set(id, entry);
    }
  });
  const rankedArtists = diversify(artists.values(), RESULT_ARTISTS);
  const favourites=taste.seeds.slice(0,MISSING_SONG_ARTISTS);
  const topTracks=new Array(Math.min(rankedArtists.length,TOP_TRACK_ARTISTS));
  const favouriteTracks=new Array(favourites.length);
  const completedArtists=new Set(),enrichedArtists=new Set();
  const filter=(list,name)=>list.filter(track=>!hidden({artist:track.artist||name})&&!taste.ownedTracks.has(trackKey(track.artist||name,track.title))).map(track=>({...track,artist:track.artist||name}));
  const snapshot=(partial=false,raw=false)=>({
    status:"ready",generatedAt:now,seeds:taste.seeds.map(seed=>seed.name),
    artists:rankedArtists.flatMap((artist,index)=>partial&&!(raw?completedArtists:enrichedArtists).has(index)?[]:[{
      name:artist.name,url:artist.url,because:because(artist),seedCount:artist.reasons.length,topTracks:topTracks[index]||[]
    }]),
    tracks:favouriteTracks.flatMap(list=>list||[]),...(partial?{partial:true}:{})
  });
  // One bounded artist-level search supplies all matching recommended tracks.
  // Only already-selected public recommendations reach the artwork catalog, not library contents.
  const batches=new Map(), waiting=[];
  let catalogRunning=0;
  function pump(){
    while(catalogRunning<2&&waiting.length){
      const priority=waiting.findIndex(job=>job.source==="recommended");
      const {name,tracks,source,finish}=waiting.splice(priority<0?0:priority,1)[0];
      if(!active()){finish([]);continue;}
      catalogRunning++;
      Promise.resolve().then(()=>catalog(name,tracks,source)).then(items=>finish(Array.isArray(items)?items:[]),()=>finish([]))
        .finally(()=>{catalogRunning--;pump();});
    }
  }
  async function enrich(name,tracks,source){
    if(cachedArtwork&&active())tracks=await Promise.all(tracks.map(async track=>{
      if(safeDisplayCover(track.coverUrl)||!active())return track;
      try{const art=await cachedArtwork(track);return {...track,...art,durationMs:track.durationMs||art.durationMs};}catch{return track;}
    }));
    if(!catalog||!active()||!tracks.length||tracks.every(track=>safeDisplayCover(track.coverUrl)))return tracks;
    const id=key(name);
    let batch=batches.get(id);
    if(!batch){
      batch=new Promise(finish=>waiting.push({name,tracks,source,finish}));
      batches.set(id,batch);pump();
    }
    const items=await batch;
    if(!active())return tracks;
    const began=performance.now();
    const enriched=tracks.map(track=>enrichCatalogTrack(track,items,trace));
    trace("identity-match",{ms:Math.round(performance.now()-began),total:tracks.length,attached:enriched.filter(t=>t.coverUrl).length});
    return enriched;
  }
  let published=false,firstDeadline;
  function publish(force=false){
    if(published||!active())return;
    const count=topTracks.reduce((n,list,index)=>n+((force||enrichedArtists.has(index))?list?.length||0:0),0);
    const fallbackCount=favouriteTracks.reduce((n,list)=>n+(list?.length||0),0);
    if((force&&count+fallbackCount>0)||count>=3||(completedArtists.size===topTracks.length&&(count||fallbackCount))){
      published=true;clearTimeout(firstDeadline);onProgress(snapshot(true,force));
    }
  }
  function armFirstDeadline(){if(!published&&firstDeadline===undefined)firstDeadline=setTimeout(()=>{firstDeadline=undefined;publish(true);},450);}
  const rankedJobs=settleAll(rankedArtists.slice(0,TOP_TRACK_ARTISTS),async(artist)=>{
    if(!active())return [];
    const index=rankedArtists.indexOf(artist);
    const tracks=filter(await client.topTracks(artist.name),artist.name);
    topTracks[index]=tracks;
    completedArtists.add(index);armFirstDeadline();
    topTracks[index]=await enrich(artist.name,tracks,"recommended");
    enrichedArtists.add(index);publish();
    return topTracks[index];
  });
  const favouriteJobs=settleAll(favourites,async seed=>{
    if(!active())return [];
    const index=favourites.indexOf(seed);
    const tracks=filter(await client.topTracks(seed.name,15),seed.name).slice(0,MISSING_SONGS_PER_ARTIST);
    favouriteTracks[index]=tracks;armFirstDeadline();
    favouriteTracks[index]=await enrich(seed.name,tracks,"popular");
    publish();return favouriteTracks[index];
  });
  try{await Promise.all([rankedJobs,favouriteJobs]);return snapshot();}finally{clearTimeout(firstDeadline);}
}

/** A saved result without anything you've since added to your library or marked "not for me". */
function withoutOwned(result, { songs, hiddenArtists = [] }) {
  if (result?.status !== "ready") return result;
  const hidden = notForMeTest([], hiddenArtists);
  const { ownedArtists, ownedTracks } = libraryTaste(songs, hidden);
  const keep = (artist) => !ownedArtists.has(key(artist)) && !hidden({ artist });
  return { ...result,
    artists: result.artists.filter((artist) => keep(artist.name))
      .map((artist) => ({ ...artist, topTracks: artist.topTracks.filter((track) => !hidden({ artist: track.artist || artist.name }) && !ownedTracks.has(trackKey(track.artist, track.title))) })),
    tracks: result.tracks.filter((track) => !ownedTracks.has(trackKey(track.artist, track.title)) && !hidden({ artist: track.artist })) };
}

// Refresh may leave the same exact recommendation without a catalog match.
// Retain its previous validated artwork only when identity has not changed.
function reuseRecommendationArtwork(result,previous){
  if(result?.status!=="ready"||previous?.status!=="ready")return result;
  const identity=track=>JSON.stringify([key(track.title),key(track.artist),track.url]);
  const old=new Map([...previous.tracks,...previous.artists.flatMap(artist=>artist.topTracks)].map(track=>[identity(track),track]));
  const reuse=track=>{
    if(safeDisplayCover(track.coverUrl))return track;
    const before=old.get(identity(track));
    if(!before||!safeDisplayCover(before.coverUrl)||
      (track.providerId&&before.providerId!==track.providerId)||
      (track.recordingId&&before.recordingId!==track.recordingId)||
      (track.album&&key(track.album)!==key(before.album))||
      (track.durationMs&&(!before.durationMs||Math.abs(track.durationMs-before.durationMs)>5000)))return track;
    const alternatives=(before.coverAlternatives||[]).filter(safeDisplayCover).slice(0,6);
    return {...track,coverUrl:before.coverUrl,providerId:track.providerId||before.providerId,
      album:track.album||before.album,durationMs:track.durationMs||before.durationMs,
      identity:track.identity||before.identity,recordingId:track.recordingId||before.recordingId,artistIds:track.artistIds||before.artistIds,catalogArtistIds:track.catalogArtistIds||before.catalogArtistIds,catalogAlbumId:track.catalogAlbumId||before.catalogAlbumId,
      ...(safeDisplayCover(before.fallbackCoverUrl)?{fallbackCoverUrl:before.fallbackCoverUrl}:{}),...(alternatives.length?{coverAlternatives:alternatives}:{})};
  };
  return {...result,artists:result.artists.map(artist=>({...artist,topTracks:artist.topTracks.map(reuse)})),tracks:result.tracks.map(reuse)};
}
module.exports = { discover, withoutOwned, libraryTaste, titleKey, reuseRecommendationArtwork };
