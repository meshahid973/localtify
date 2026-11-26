import type { Song } from "../library/song.types";
import { normalizeSearchText } from "../search/search.utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RULES = 12;
const MAX_LIMIT = 5000;

export type SmartFieldKind = "text" | "flag" | "count" | "days";
export const SMART_FIELDS = {
  genre: { label: "genre", kind: "text" },
  artist: { label: "artist", kind: "text" },
  album: { label: "album", kind: "text" },
  title: { label: "title", kind: "text" },
  liked: { label: "liked", kind: "flag" },
  plays: { label: "plays", kind: "count" },
  finishes: { label: "times finished", kind: "count" },
  skips: { label: "times skipped", kind: "count" },
  lastPlayed: { label: "last played", kind: "days" },
  added: { label: "added", kind: "days" }
} as const satisfies Record<string, { label: string; kind: SmartFieldKind }>;
export type SmartField = keyof typeof SMART_FIELDS;

export const SMART_OPS = {
  text: { contains: "contains", excludes: "doesn't contain" },
  flag: { is: "yes", isNot: "no" },
  count: { atLeast: "at least", atMost: "at most" },
  days: { within: "in the last", notWithin: "not in the last" }
} as const;
type OpsOf<K extends SmartFieldKind> = keyof (typeof SMART_OPS)[K];
export type SmartOp = OpsOf<"text"> | OpsOf<"flag"> | OpsOf<"count"> | OpsOf<"days">;

export const SMART_SORTS = {
  library: "library order",
  mostPlayed: "most played",
  leastPlayed: "least played",
  recentlyAdded: "recently added",
  recentlyPlayed: "recently played",
  random: "shuffled daily"
} as const;
export type SmartSort = keyof typeof SMART_SORTS;

/** `value` is text for text fields and a number (count or days) otherwise. */
export type SmartRule = { field: SmartField; op: SmartOp; value: string | number };
export type SmartRules = { match: "all" | "any"; rules: SmartRule[]; sort: SmartSort; limit: number | null };
export type ListeningCounts = ReadonlyMap<string, { finishes: number; skips: number }>;

export function defaultSmartRule(field: SmartField = "genre"): SmartRule {
  const kind = SMART_FIELDS[field].kind;
  return { field, op: Object.keys(SMART_OPS[kind])[0] as SmartOp, value: kind === "text" ? "" : kind === "days" ? 30 : kind === "count" ? 1 : "" };
}

export const SMART_PRESETS: { name: string; rules: SmartRules }[] = [
  { name: "Forgotten favourites", rules: { match: "all", sort: "random", limit: 50,
    rules: [{ field: "liked", op: "is", value: "" }, { field: "lastPlayed", op: "notWithin", value: 60 }] } },
  { name: "On repeat", rules: { match: "all", sort: "mostPlayed", limit: 50, rules: [{ field: "finishes", op: "atLeast", value: 3 }] } },
  { name: "Fresh imports", rules: { match: "all", sort: "recentlyAdded", limit: null, rules: [{ field: "added", op: "within", value: 30 }] } },
  { name: "Never played", rules: { match: "all", sort: "random", limit: 100, rules: [{ field: "plays", op: "atMost", value: 0 }] } }
];

/** Reject invalid conditions as a unit rather than broadening the playlist silently. */
export function cleanSmartRules(value: unknown): SmartRules | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Partial<SmartRules>;
  if ((source.match !== "all" && source.match !== "any") ||
      typeof source.sort !== "string" || !Object.hasOwn(SMART_SORTS, source.sort) ||
      !Array.isArray(source.rules) || source.rules.length > MAX_RULES ||
      (source.limit !== null && (typeof source.limit !== "number" || !Number.isInteger(source.limit) || source.limit < 1 || source.limit > MAX_LIMIT))) return undefined;
  const rules: SmartRule[] = [];
  for (const item of source.rules) {
    if (!item || typeof item.field !== "string" || !Object.hasOwn(SMART_FIELDS, item.field)) return undefined;
    const field = item.field;
    const kind = SMART_FIELDS[field].kind;
    if (typeof item.op !== "string" || !Object.hasOwn(SMART_OPS[kind], item.op)) return undefined;
    if (kind === "text") {
      if (typeof item.value !== "string" || !item.value.trim() || item.value.trim().length > 100) return undefined;
      rules.push({ field, op: item.op, value: item.value.trim() });
    } else if (kind === "flag") {
      if (item.value !== "") return undefined;
      rules.push({ field, op: item.op, value: "" });
    } else {
      if (typeof item.value !== "number" || !Number.isInteger(item.value) || item.value < 0 || item.value > 100_000) return undefined;
      rules.push({ field, op: item.op, value: item.value });
    }
  }
  return { match: source.match, rules, sort: source.sort, limit: source.limit };
}

export function needsListeningCounts(rules: SmartRules) {
  return rules.rules.some(rule => rule.field === "finishes" || rule.field === "skips");
}

export function usesClock(rules: SmartRules) {
  return rules.sort === "random" || rules.rules.some(rule => rule.field === "added" || rule.field === "lastPlayed");
}

function timeOf(value: string | null | undefined) { const time = Date.parse(value || ""); return Number.isFinite(time) ? time : null; }

function compileRules(rules: SmartRules, counts: ListeningCounts, now: number) {
  const checks = rules.rules.map(rule => {
    const kind = SMART_FIELDS[rule.field].kind;
    if (kind === "text") {
      const field = rule.field as "genre" | "artist" | "album" | "title";
      const needle = String(rule.value);
      const query = normalizeSearchText(needle);
      const fallback = needle.toLowerCase();
      return (song: Song) => {
        const found = query ? normalizeSearchText(song[field]).includes(query) : String(song[field] || "").toLowerCase().includes(fallback);
        return rule.op === "contains" ? found : !found;
      };
    }
    if (kind === "flag") return (song: Song) => rule.op === "is" ? song.liked : !song.liked;
    const limit = Number(rule.value);
    if (kind === "count") return (song: Song) => {
      const count = rule.field === "plays" ? Number(song.playCount) || 0 :
        rule.field === "finishes" ? counts.get(song.id)?.finishes || 0 : counts.get(song.id)?.skips || 0;
      return rule.op === "atLeast" ? count >= limit : count <= limit;
    };
    const windowMs = limit * DAY_MS;
    return (song: Song) => {
      const time = timeOf(rule.field === "added" ? song.dateAdded : song.lastPlayed);
      const recent = time !== null && time <= now && now - time <= windowMs;
      return rule.op === "within" ? recent : !recent;
    };
  });
  return (song: Song) => song.fileExists !== false &&
    (rules.match === "all" ? checks.every(check => check(song)) : !checks.length || checks.some(check => check(song)));
}

/** A preview needs only the capped count, never sorted IDs or a full result array. */
export function countSmartMatches(rules: SmartRules, songs: readonly Song[], counts: ListeningCounts = new Map(), now = Date.now()) {
  const matches = compileRules(rules, counts, now);
  let count = 0;
  for (const song of songs) {
    if (matches(song) && ++count === rules.limit) break;
  }
  return count;
}

function dailyShuffleKey(id: string, day: number) {
  let hash = 2166136261 ^ day;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Song IDs for a smart playlist, in its chosen order. Songs whose files are missing are left out. */
export function evaluateSmartRules(rules: SmartRules, songs: readonly Song[], counts: ListeningCounts = new Map(), now = Date.now()) {
  const matches = compileRules(rules, counts, now);
  if (rules.sort === "library") {
    const ids: string[] = [];
    for (const song of songs) {
      if (matches(song)) {
        ids.push(song.id);
        if (ids.length === rules.limit) break;
      }
    }
    return ids;
  }
  const day = Math.floor(now / DAY_MS);
  const key = (song: Song) => {
    switch (rules.sort) {
      case "mostPlayed": return -(Number(song.playCount) || 0);
      case "leastPlayed": return Number(song.playCount) || 0;
      case "recentlyAdded": return -(timeOf(song.dateAdded) || 0);
      case "recentlyPlayed": return -(timeOf(song.lastPlayed) || 0);
      case "random": return dailyShuffleKey(song.id, day);
      default: return 0;
    }
  };
  const picked: {id: string; key: number}[] = [];
  for (const song of songs) if (matches(song)) picked.push({id: song.id, key: key(song)});
  picked.sort((a,b) => a.key - b.key || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return (rules.limit ? picked.slice(0, rules.limit) : picked).map(song => song.id);
}

/** "liked · last played not in the last 60 days · shuffled daily · up to 50" */
export function describeSmartRules(rules: SmartRules) {
  const parts = rules.rules.map((rule) => {
    const meta = SMART_FIELDS[rule.field];
    const op = (SMART_OPS[meta.kind] as Record<string, string>)[rule.op];
    if (meta.kind === "flag") return rule.op === "is" ? meta.label : `not ${meta.label}`;
    if (meta.kind === "text") return `${meta.label} ${op} "${rule.value}"`;
    return `${meta.label} ${op} ${rule.value}${meta.kind === "days" ? ` day${rule.value === 1 ? "" : "s"}` : ""}`;
  });
  const conditions = parts.length ? parts.join(rules.match === "all" ? " · " : " or ") : "every song";
  return [conditions, rules.sort === "library" ? "" : SMART_SORTS[rules.sort], rules.limit ? `up to ${rules.limit}` : ""].filter(Boolean).join(" · ");
}

type Playlist = import("./playlist.types").Playlist;
type SmartMaterialization = {rules: string; songs: readonly Song[]; counts: ListeningCounts | null; clock: number; ids: string[]; input: Playlist; result: Playlist};
export type SmartMaterializationCache = Map<string, SmartMaterialization>;
export function materializeSmartPlaylists(playlists: import("./playlist.types").Playlist[], songs: readonly Song[], counts: ListeningCounts | null, now: number, cache?: SmartMaterializationCache) {
  if(cache){const ids=new Set(playlists.filter(item=>item.rules).map(item=>item.id));for(const id of cache.keys())if(!ids.has(id))cache.delete(id);}
  if (!playlists.some(playlist => playlist.rules)) return playlists;
  return playlists.map(playlist => {
    if (!playlist.rules || (counts === null && needsListeningCounts(playlist.rules))) return playlist;
    const rules = JSON.stringify(playlist.rules);
    const relevantCounts = needsListeningCounts(playlist.rules) ? counts : null;
    const clock = playlist.rules.rules.some(rule=>SMART_FIELDS[rule.field].kind==="days") ? now : playlist.rules.sort === "random" ? Math.floor(now / DAY_MS) : 0;
    const prior = cache?.get(playlist.id);
    const songIds = prior && prior.rules===rules && prior.songs===songs && prior.counts===relevantCounts && prior.clock===clock ? prior.ids : evaluateSmartRules(playlist.rules, songs, counts ?? new Map(), now);
    const result = prior && prior.input === playlist && prior.ids === songIds ? prior.result :
      songIds.length === playlist.songIds.length && songIds.every((id, index) => id === playlist.songIds[index]) ? playlist : { ...playlist, songIds };
    cache?.set(playlist.id,{rules,songs,counts:relevantCounts,clock,ids:songIds,input:playlist,result});
    return result;
  });
}

export type ListeningCountRows = Array<[string, number, number]>;

export function addPendingListeningCounts(rows: ListeningCountRows | null,
  events: readonly import("../player/listeningHistory").PlayEvent[],
  durationFor: (songId: string) => number | null): ListeningCountRows | null {
  if (rows === null) return null;
  const counts = new Map(rows.map(([id, finishes, skips]) => [id, { finishes, skips }]));
  for (const event of events) {
    if (event.outcome === "active") continue;
    const duration = durationFor(event.songId);
    if (duration === null) continue;
    const early = duration > 0 ? Math.min(30_000, duration * .5) : 30_000;
    const finished = event.outcome === "ended" || event.outcome === "transition" || (duration > 0 && event.msListened >= duration * .8);
    const skipped = !finished && event.outcome === "replaced" && event.msListened < early;
    if (!finished && !skipped) continue;
    const current = counts.get(event.songId) ?? { finishes: 0, skips: 0 };
    if (finished) current.finishes += 1; else current.skips += 1;
    counts.set(event.songId, current);
  }
  return [...counts].map(([id, {finishes, skips}]) => [id, finishes, skips]);
}
