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
  let uniqueName = base, suffix = 2;
  for (;;) {
    const existing = byName.get(uniqueName.toLowerCase());
    if (!existing) return {name:uniqueName,songIds,existingId:undefined};
    if (!existing.rules && existing.songIds.length === songIds.length && existing.songIds.every((id,index)=>id===songIds[index])) return {name:existing.name,songIds,existingId:existing.id};
    uniqueName = `${base} (${suffix++})`;
  }
}
