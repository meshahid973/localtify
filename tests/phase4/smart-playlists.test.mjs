import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runInNewContext } from "node:vm";

const source = fs.readFileSync("src/features/playlists/smartPlaylist.ts", "utf8");
const controller = fs.readFileSync("src/features/playlists/usePlaylistsController.ts", "utf8");
const picker = fs.readFileSync("src/features/playlists/components/PlaylistPickerModal.tsx", "utf8");
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-22T12:00:00Z");

function loadSmart() {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const normalizeSearchText = (value) => String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9\s]+/g, " ").toLowerCase().replace(/\s+/g, " ").trim();
  runInNewContext(compiled, { exports, require: () => ({ normalizeSearchText }) });
  return exports;
}

const iso = (daysAgo) => daysAgo === null ? null : new Date(NOW - daysAgo * DAY).toISOString();
const song = (id, { genre = "", artist = "Artist", liked = false, plays = 0, added = 400, played = null, exists = true } = {}) =>
  ({ id, title: id, artist, album: "Album", genre, liked, playCount: plays, dateAdded: iso(added), lastPlayed: iso(played), fileExists: exists });

const library = [
  song("old-fave", { liked: true, plays: 9, played: 120, genre: "Hip Hop; Rap" }),
  song("recent-fave", { liked: true, plays: 4, played: 2, genre: "dance-pop" }),
  song("never", { added: 5, genre: "K-Pop" }),
  song("gone", { liked: true, played: 300, exists: false }),
  song("korean", { artist: "아이유", plays: 1, played: 40 })
];

test("rules filter by likes, plays, dates, listening counts and text", () => {
  const { evaluateSmartRules } = loadSmart();
  const run = (rules, counts) => [...evaluateSmartRules({ match: "all", sort: "library", limit: null, ...rules }, library, counts, NOW)];
  assert.deepEqual(run({ rules: [{ field: "liked", op: "is", value: "" }, { field: "lastPlayed", op: "notWithin", value: 60 }] }), ["old-fave"],
    "forgotten favourites; missing files are left out");
  assert.deepEqual(run({ rules: [{ field: "lastPlayed", op: "notWithin", value: 60 }, { field: "liked", op: "isNot", value: "" }] }), ["never"],
    "never played counts as not played lately");
  assert.deepEqual(run({ rules: [{ field: "added", op: "within", value: 30 }] }), ["never"]);
  assert.deepEqual(run({ rules: [{ field: "plays", op: "atLeast", value: 4 }] }), ["old-fave", "recent-fave"]);
  assert.deepEqual(run({ rules: [{ field: "genre", op: "contains", value: "hip-hop" }] }), ["old-fave"], "genre text is normalized like search");
  assert.deepEqual(run({ rules: [{ field: "genre", op: "excludes", value: "pop" }] }), ["old-fave", "korean"]);
  assert.deepEqual(run({ rules: [{ field: "artist", op: "contains", value: "아이유" }] }), ["korean"], "non-Latin text still matches");
  const counts = new Map([["recent-fave", { finishes: 3, skips: 0 }], ["never", { finishes: 0, skips: 4 }]]);
  assert.deepEqual(run({ rules: [{ field: "finishes", op: "atLeast", value: 3 }] }, counts), ["recent-fave"]);
  assert.deepEqual(run({ rules: [{ field: "skips", op: "atLeast", value: 2 }] }, counts), ["never"]);
  assert.deepEqual(run({ match: "any", rules: [{ field: "added", op: "within", value: 30 }, { field: "plays", op: "atLeast", value: 9 }] }), ["old-fave", "never"]);
  assert.equal(run({ rules: [] }).length, 4, "no rules is every playable song");
});

test("order and limit, with a shuffle that stays the same all day", () => {
  const { evaluateSmartRules } = loadSmart();
  const run = (sort, limit = null, now = NOW) => [...evaluateSmartRules({ match: "all", rules: [], sort, limit }, library, new Map(), now)];
  assert.deepEqual(run("mostPlayed", 2), ["old-fave", "recent-fave"]);
  assert.deepEqual(run("recentlyPlayed", 1), ["recent-fave"]);
  assert.deepEqual(run("recentlyAdded", 1), ["never"]);
  assert.deepEqual(run("random"), run("random", null, NOW + 3 * 60 * 60 * 1000));
  assert.deepEqual([...run("random")].sort(), [...run("library")].sort());
});

test("saved rules are cleaned and described", () => {
  const { cleanSmartRules, describeSmartRules, SMART_PRESETS } = loadSmart();
  assert.equal(cleanSmartRules(null), undefined);
  assert.equal(cleanSmartRules({ rules: "nope" }), undefined);
  const cleaned = cleanSmartRules({ match: "sometimes", sort: "loudest", limit: 0, rules: [
    { field: "genre", op: "contains", value: "  " }, { field: "plays", op: "atLeast", value: "7.9" }, { field: "mood", op: "is", value: 1 },
    { field: "liked", op: "contains", value: "x" }, { field: "added", op: "within", value: -4 }
  ] });
  assert.equal(cleaned, undefined);
  assert.equal(describeSmartRules(SMART_PRESETS[0].rules), "liked · last played not in the last 60 days · shuffled daily · up to 50");
  for (const preset of SMART_PRESETS) assert.deepEqual(cleanSmartRules(preset.rules), preset.rules, preset.name);
});

test("smart playlists fill themselves and can't be edited by hand", () => {
  const view = fs.readFileSync("src/features/playlists/useSmartPlaylistView.ts", "utf8");
  assert.match(view, /materializeSmartPlaylists\(stored, songs, listeningCounts/);
  assert.doesNotMatch(view, /setPlaylists\(|savePlaylists\(/);
  for (const action of ["addSongToPlaylist", "removeSongFromPlaylist", "handlePlaylistSongDrop"]) {
    const body = controller.slice(controller.indexOf(`const ${action} = useCallback`));
    assert.match(body.slice(0, 600), /smartPlaylistLocked\(playlist\)/, action);
  }
  assert.match(picker, /playlists\.filter\(\(playlist\) => !playlist\.rules\)/);
});

test("strict rules validation matches the Electron boundary", async () => {
  const { createRequire } = await import("node:module");
  const { cleanSmartRules: backend } = createRequire(import.meta.url)("../../electron/playlist-rules.cjs");
  const { cleanSmartRules, SMART_PRESETS } = loadSmart();
  const base = SMART_PRESETS[0].rules;
  for (const value of [base, ...SMART_PRESETS.map(item => item.rules), {...base,limit:0}, {...base,limit:5001}, {...base,match:"bad"}, {...base,sort:"bad"}, {...base,rules:[{field:"plays",op:"atLeast",value:""}]}, {...base,rules:[{field:"genre",op:"contains",value:" "}]}, {...base,rules:Array(13).fill(base.rules[0])}, {...base,rules:[{field:"__proto__",op:"is",value:""}]}, null]) {
    assert.equal(JSON.stringify(cleanSmartRules(value)), JSON.stringify(backend(value)));
  }
});
test("smart membership is derived without changing the stored rules or cache", () => {
  const { materializeSmartPlaylists, SMART_PRESETS } = loadSmart();
  const source = [{id:"smart",name:"smart",createdAt:1,songIds:["cached"],rules:SMART_PRESETS[1].rules}];
  assert.equal(materializeSmartPlaylists(source, library, null, NOW)[0], source[0]);
  assert.deepEqual([...materializeSmartPlaylists(source, library, new Map([["recent-fave",{finishes:3,skips:0}]]), NOW)[0].songIds], ["recent-fave"]);
  assert.deepEqual(source[0].songIds, ["cached"]);
});

test("offline finished and skipped events extend the last synced counts without altering it", () => {
  const {addPendingListeningCounts} = loadSmart();
  const rows = [["a",2,1]];
  const events = [
    {songId:"a",outcome:"ended",msListened:5000},
    {songId:"a",outcome:"active",msListened:1000},
    {songId:"a",outcome:"replaced",msListened:1000},
    {songId:"b",outcome:"replaced",msListened:90000}
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(addPendingListeningCounts(rows,events,()=>100000))), [["a",3,2],["b",1,0]]);
  assert.deepEqual(rows,[["a",2,1]]);
  assert.equal(addPendingListeningCounts(null,events,()=>100000),null);
});
test("date rules and daily shuffle refresh from time rather than persisted membership", () => {
  const {materializeSmartPlaylists,SMART_PRESETS} = loadSmart();
  const fresh = [{id:"p",name:"fresh",createdAt:1,songIds:["never"],rules:SMART_PRESETS[2].rules}];
  assert.deepEqual([...materializeSmartPlaylists(fresh,library,new Map(),NOW)[0].songIds],["never"]);
  assert.deepEqual([...materializeSmartPlaylists(fresh,library,new Map(),NOW+31*DAY)[0].songIds],[]);
  const shuffled = [{...fresh[0],rules:{match:"all",rules:[],sort:"random",limit:null}}];
  const all = Array.from({length:50},(_,i)=>song("s"+i));
  assert.notDeepEqual([...materializeSmartPlaylists(shuffled,all,new Map(),NOW)[0].songIds],[...materializeSmartPlaylists(shuffled,all,new Map(),NOW+DAY)[0].songIds]);
});

test("materialization reuses unaffected results and clears deleted playlist cache entries",()=>{
  const {materializeSmartPlaylists}=loadSmart();
  const playlist={id:"a",name:"likes",createdAt:1,songIds:[],rules:{match:"all",rules:[{field:"liked",op:"is",value:""}],sort:"library",limit:null}};
  const cache=new Map();
  const first=materializeSmartPlaylists([playlist],library,new Map(),NOW,cache)[0];
  const second=materializeSmartPlaylists([playlist],library,new Map(),NOW+DAY,cache)[0];
  assert.equal(first.songIds,second.songIds);
  const updated=materializeSmartPlaylists([playlist],library.map(song=>({...song,liked:false})),new Map(),NOW,cache)[0];
  assert.deepEqual([...updated.songIds],[]);
  materializeSmartPlaylists([],library,null,NOW,cache);
  assert.equal(cache.size,0);
});

test("generated playlist retry finds its previously assigned suffixed name",()=>{
  const exports={};
  runInNewContext(ts.transpileModule(fs.readFileSync("src/features/playlists/generatedPlaylist.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
  const byId=new Map(library.map(song=>[song.id,song]));
  const existing=[{id:"original",name:"Mix",songIds:["never"]},{id:"retry",name:"Mix (2)",songIds:["recent-fave"]}];
  const result=exports.prepareGeneratedPlaylist("Mix",["recent-fave"],byId,existing);
  assert.equal(result.existingId,"retry");assert.equal(result.name,"Mix (2)");
});

test("sorted playback retains membership changes without rewriting saved order",()=>{
  const exports={};
  const js=ts.transpileModule(fs.readFileSync("src/features/player/playbackSource.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(js,{exports,require:()=>({isPlayableSong:song=>Boolean(song)})});
  const playlist={id:"a",songIds:["a","b","c"]};
  assert.deepEqual([...exports.resolvePlaylistPlaybackIds(playlist,{id:"a",songIds:["c","removed","a"]})],["c","a","b"]);
  assert.equal(exports.resolvePlaylistPlaybackIds(playlist,{id:"other",songIds:[]}),playlist.songIds);
  assert.deepEqual(playlist.songIds,["a","b","c"]);
});
