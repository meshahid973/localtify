import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAudioDbArtwork,albumImage}=require("../../electron/discover/audiodb.cjs");
test("AudioDB only uses album art linked to the exact song and artist",async()=>{
 const image="https://www.theaudiodb.com/images/media/album/thumb/abc123.jpg";
 let now=1000;
 const lookup=createAudioDbArtwork({apiKey:"123",now:()=>{now+=3000;return now;},fetchImpl:async (url,options)=>{assert.equal(options.redirect,"error");assert.equal(options.credentials,"omit");return new Response(JSON.stringify(url.includes("searchtrack")?{track:[{strTrack:"Song",strArtist:"Artist",strAlbum:"Album",idAlbum:"42"}]}:{album:[{idAlbum:"42",strAlbum:"Album",strArtist:"Artist",strAlbumThumb:image}]}));}});
 assert.equal((await lookup("song","artist")).coverUrl,image);
 assert.deepEqual(await lookup("other","artist"),{});
 assert.equal(albumImage("https://example.org/images/media/album/thumb/a.jpg"),"");
});

test("AudioDB rejects oversized metadata and ambiguous unlinked tracks without fetching album art", async () => {
  let clock=1000, calls=0;
  const lookup=createAudioDbArtwork({apiKey:"123",now:()=>{clock+=3000;return clock;},fetchImpl:async()=>{
    calls++;
    return calls===1 ? new Response("x".repeat(513*1024)) : new Response(JSON.stringify({track:[
      {strTrack:"Song",strArtist:"Artist",strAlbum:"Album",idAlbum:"42"},
      {strTrack:"Song",strArtist:"Artist",strAlbum:"Other",idAlbum:""}
    ]}));
  }});
  assert.deepEqual(await lookup("song","artist"),{});
  assert.deepEqual(await lookup("song","artist"),{});
  assert.equal(calls,2);
});

 test("tracks with the same verified AudioDB album ID reuse album artwork, different editions do not",async()=>{
  let clock=1000,tracks=0,albums=0;
  const image="https://www.theaudiodb.com/images/media/album/thumb/abc123.jpg";
  const lookup=createAudioDbArtwork({apiKey:"123",now:()=>{clock+=3000;return clock;},fetchImpl:async url=>{
    const u=new URL(url);
    if(u.pathname.endsWith("searchtrack.php")){tracks++;const title=u.searchParams.get("t");return new Response(JSON.stringify({track:[{strTrack:title,strArtist:"Artist",strAlbum:"Album",idAlbum:title==="Live"?"43":"42"}]}));}
    albums++;return new Response(JSON.stringify({album:[{idAlbum:u.searchParams.get("m"),strArtist:"Artist",strAlbum:"Album",strAlbumThumb:image}]}));
  }});
  assert.equal((await lookup("First","Artist")).coverUrl,image);
  assert.equal((await lookup("Second","Artist")).coverUrl,image);
  assert.equal(albums,1);
  assert.equal((await lookup("Live","Artist")).coverUrl,image);
  assert.equal(albums,2);assert.equal(tracks,3);
 });
