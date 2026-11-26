import type { Playlist } from "./playlist.types";
import type { Song } from "../library/song.types";

export function prepareGeneratedPlaylist(name: string, ids: string[], songsById: Map<string, Song>, playlists: Playlist[]) {
  const songIds = [...new Set(ids)].filter((id) => {
    const song = songsById.get(id);
    return song && song.fileExists !== false;
  });
  if (!songIds.length) return null;
  const base = (name.trim() || "Daily mix").slice(0, 110);
  const byName = new Map(playlists.map(playlist => [playlist.name.toLowerCase(), playlist]));
  const matches = (playlist: Playlist) => !playlist.rules && playlist.songIds.length === songIds.length && playlist.songIds.every((id,index)=>id===songIds[index]);
  const exact = playlists.find(item=>item.name.toLowerCase()===base.toLowerCase() && matches(item));
  if (exact) return {name:exact.name,songIds,existingId:exact.id};
  // A failed save can leave a suffixed name even if another playlist was removed since then.
  const prefix = base.toLowerCase() + " (";
  const retry = playlists.find(item=>item.name.toLowerCase().startsWith(prefix) && /^[2-9]\\d*\\)$|^1\\d+\\)$/.test(item.name.slice(prefix.length)) && matches(item));
  if (retry) return {name:retry.name,songIds,existingId:retry.id};
  let uniqueName = base, suffix = 2;
  for (;;) {
    const existing = byName.get(uniqueName.toLowerCase());
    if (!existing) return {name:uniqueName,songIds,existingId:undefined};
    if (matches(existing)) return {name:existing.name,songIds,existingId:existing.id};
    uniqueName = `${base} (${suffix++})`;
  }
}
