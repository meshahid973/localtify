import type { Playlist as SyncPlaylist } from "./playlist.types";

function sameRules(a: SyncPlaylist, b: SyncPlaylist) {
  return JSON.stringify(a.rules ?? null) === JSON.stringify(b.rules ?? null);
}

function samePlaylist(a: SyncPlaylist, b: SyncPlaylist) {
  return a.name === b.name && (a.coverArtwork || "") === (b.coverArtwork || "") &&
    sameRules(a, b) && (!!a.rules || (a.songIds.length === b.songIds.length && a.songIds.every((id, index) => id === b.songIds[index])));
}

// Keep unchanged relative order from the receiving device. Apply the incoming device's
// moved tracks and additions at their incoming anchors; removals win on either side.
export function mergeSongIds(base: string[], mac: string[], phone: string[]) {
  const baseSet = new Set(base);
  const phoneSet = new Set(phone);
  const result = [...new Set(mac.filter(id => !baseSet.has(id) || phoneSet.has(id)))];
  const remoteSet = new Set(result);
  const basePositions = new Map(base.map((id, index) => [id, index]));
  const common = [...new Set(phone.filter(id => baseSet.has(id) && remoteSet.has(id)))];
  // The longest increasing subsequence identifies tracks the incoming device did not move.
  const tails: number[] = [], previous: number[] = [];
  for (let i = 0; i < common.length; i++) {
    const position = basePositions.get(common[i])!;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (basePositions.get(common[tails[mid]])! < position) lo = mid + 1;
      else hi = mid;
    }
    previous[i] = lo ? tails[lo - 1] : -1;
    tails[lo] = i;
  }
  const stationary = new Set<string>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = previous[i]) stationary.add(common[i]);
  const moved = new Set(common.filter(id => !stationary.has(id)));

  type Link = { id: string; next: Link | null };
  const head: Link = { id: "", next: null };
  const links = new Map<string, Link>();
  let last = head;
  for (const id of result) {
    if (moved.has(id)) continue;
    const link: Link = { id, next: null };
    last.next = link;
    last = link;
    links.set(id, link);
  }
  let anchor = head;
  for (const id of phone) {
    const present = links.get(id);
    if (present) { anchor = present; continue; }
    if (baseSet.has(id) && !moved.has(id)) continue;
    const link: Link = { id, next: anchor.next };
    anchor.next = link;
    links.set(id, link);
    anchor = link;
  }
  const merged: string[] = [];
  for (let link = head.next; link; link = link.next) merged.push(link.id);
  return merged;
}

export function phonePlaylistChanges(base: SyncPlaylist[], mac: SyncPlaylist[], phone: SyncPlaylist[]) {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const macById = new Map(mac.map((item) => [item.id, item]));
  const phoneById = new Map(phone.map((item) => [item.id, item]));
  const put: SyncPlaylist[] = [];
  const remove: string[] = [];
  for (const id of new Set([...baseById.keys(), ...macById.keys(), ...phoneById.keys()])) {
    const b = baseById.get(id);
    const m = macById.get(id);
    const p = phoneById.get(id);
    if (!p) {
      // Deleted on the phone: delete on the Mac too, unless the Mac edited it since.
      if (b && m && samePlaylist(m, b)) remove.push(id);
      continue;
    }
    if (!b) {
      if (!m) put.push(p);
      else if (!samePlaylist(m, p)) put.push(p.rules || m.rules ? (p.rules ? p : m) : {...m, songIds: mergeSongIds([], m.songIds, p.songIds)});
      continue;
    }
    if (samePlaylist(p, b)) continue;
    // Edited on the phone. If the Mac deleted it meanwhile, the phone's edits bring it back.
    if (!m || samePlaylist(m, b)) {
      put.push(p);
      continue;
    }
    const rulesChanged = !sameRules(b, p);
    const rules = rulesChanged ? p.rules : m.rules;
    put.push({
      ...m,
      ...(rulesChanged ? { rules } : {}),
      name: p.name !== b.name ? p.name : m.name,
      ...((p.coverArtwork || "") !== (b.coverArtwork || "") ? { coverArtwork: p.coverArtwork } : {}),
      songIds: rules ? (rulesChanged ? p.songIds : m.songIds) : mergeSongIds(b.songIds, m.songIds, p.songIds)
    });
  }
  return { put, delete: remove };
}

export function rebasePlaylists(sent: SyncPlaylist[], current: SyncPlaylist[], received: SyncPlaylist[]) {
  const later = phonePlaylistChanges(sent, received, current);
  const put = new Map(later.put.map((playlist) => [playlist.id, playlist]));
  const removed = new Set(later.delete);
  const known = new Set(received.map((playlist) => playlist.id));
  return {
    playlists: [
      ...later.put.filter((playlist) => !known.has(playlist.id)),
      ...received.filter((playlist) => !removed.has(playlist.id)).map((playlist) => put.get(playlist.id) || playlist)
    ],
    changed: Boolean(later.put.length || later.delete.length)
  };
}
