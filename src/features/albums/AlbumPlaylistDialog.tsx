import { useMemo, useState } from "react";
import type { LocalAlbumEntry } from "./album.types";
import type { Playlist } from "../playlists/playlist.types";
import type { Song } from "../library/song.types";
import { PlaylistMembershipDialog } from "../playlists/components/PlaylistPickerModal";

type Props = {
  album: LocalAlbumEntry;
  playlists: readonly Playlist[];
  songsById: Map<string, Song>;
  onAdd: (playlistId: string, songIds: string[]) => Promise<boolean>;
  onCreate: (name: string, songIds: string[]) => Promise<boolean>;
  onClose: () => void;
};
export default function AlbumPlaylistDialog({album,playlists,songsById,onAdd,onCreate,onClose}: Props) {
  const [name,setName] = useState("");
  const ids = useMemo(()=>album.songs.filter(song=>song.fileExists !== false).map(song=>song.id),[album]);
  return <PlaylistMembershipDialog title={album.title} subtitle={`${ids.length} tracks · ${album.artist}`} songIds={ids}
    name={name} setName={setName} onClose={onClose} playlists={playlists} songsById={songsById}
    onAdd={id=>onAdd(id,ids)} onCreate={name=>onCreate(name,ids)}/>;
}
