import { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import Dialog from "../../../shared/ui/Dialog";
import Button from "../../../shared/ui/Button";
import { MascotStateArt } from "../../../shared/ui/LocaltifyViewUi";
import { displaySongPickerSublineV444, displaySongTitleV444 } from "../../library/trackDisplay";
import type { Song } from "../../library/song.types";
import type { Playlist } from "../playlist.types";
import PlaylistCoverCollage from "./PlaylistCoverCollage";
import "./playlist-picker.css";

type MembershipProps = {
  label: string;
  title: string;
  subtitle: string;
  songIds: readonly string[];
  name: string;
  setName: (value: string) => void;
  onClose: () => void;
  playlists: readonly Playlist[];
  songsById: Map<string, Song>;
  onAdd: (playlistId: string) => Promise<boolean>;
  onCreate: (name: string) => Promise<boolean>;
};

const PAGE_SIZE = 60;

export function PlaylistMembershipDialog({label, title, subtitle, songIds, name, setName, onClose, playlists, songsById, onAdd, onCreate}: MembershipProps) {
  const [query,setQuery] = useState("");
  const [visibleCount,setVisibleCount] = useState(PAGE_SIZE);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const lock = useRef(false);
  const retryAction = useRef<(() => Promise<boolean>) | null>(null);
  const manualPlaylists = useMemo(() => playlists.filter((playlist) => !playlist.rules), [playlists]);
  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? manualPlaylists.filter(item => item.name.toLocaleLowerCase().includes(needle)) : manualPlaylists;
  }, [manualPlaylists,query]);
  const requestedIds = useMemo(() => new Set(songIds), [songIds]);
  const visible = useMemo(() => matching.slice(0, visibleCount).map(playlist => {
    let addedCount = 0;
    if (requestedIds.size === 1) addedCount = playlist.songIds.includes(requestedIds.values().next().value!) ? 1 : 0;
    else if (requestedIds.size) {
      for (const id of playlist.songIds) if (requestedIds.has(id) && ++addedCount === requestedIds.size) break;
    }
    const previewSongs = playlist.songIds.slice(0, 4).map(id=>songsById.get(id)).filter((song): song is Song=>Boolean(song));
    return {playlist, addedCount, previewSongs};
  }), [matching, visibleCount, requestedIds, songsById]);
  const collision = playlists.some(item => item.rules && item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  async function save(action: () => Promise<boolean>) {
    if (lock.current || !songIds.length) return;
    retryAction.current = action;
    lock.current = true; setBusy(true); setError("");
    try {
      if (await action()) { retryAction.current = null; onClose(); }
      else setError("Could not confirm the playlist save. Your changes may still be pending. Retry.");
    } catch { setError("Could not save playlist. Retry."); }
    finally { lock.current = false; setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} dismissible={!busy} portal={false} animated={false} backdropClassName="modalWrap playlistPickerWrap"
      className="playlistPickerModal" label={label}>
        <div className="modalHead playlistPickerHead">
          <div><p className="eyebrow">add to playlist</p><h3>{title}</h3><span className="editorHeadSub">{subtitle}</span></div>
          <button className="closeModalButton" type="button" disabled={busy} onClick={onClose} aria-label="close"><X size={18} strokeWidth={2.4} /></button>
        </div>
        <label className="playlistPickerSearch"><Search size={15} aria-hidden="true"/><input type="search" aria-label="Search playlists" placeholder="Find a playlist" disabled={busy}
          value={query} onChange={event=>{setQuery(event.currentTarget.value);setVisibleCount(PAGE_SIZE);}} autoFocus /></label>
        <div className="playlistPickerList" aria-busy={busy}>
          {matching.length ? visible.map(({playlist, addedCount, previewSongs}) => {
            const added = requestedIds.size > 0 && addedCount === requestedIds.size;
            return <button key={playlist.id} className={`playlistPickerItem ${added ? "active" : ""}`} type="button" disabled={busy || !songIds.length || added}
              onClick={()=>void save(()=>onAdd(playlist.id))}>
              <PlaylistCoverCollage songs={previewSongs} coverArtwork={playlist.coverArtwork} className="playlistPickerCollage playlistCoverCollage"/>
              <span><strong>{playlist.name}</strong><small>{added ? "already added" : addedCount ? `${addedCount} of ${songIds.length} already added` : `${playlist.songIds.length} song${playlist.songIds.length === 1 ? "" : "s"}`}</small></span>
              <em>{added ? "added" : "add"}</em>
            </button>;
          }) : <div className="playlistEmptyState playlistMascotEmptyV496">
            <MascotStateArt state="question" className="playlistEmptyMascotV496"/>
            <span className="mascotEmptyCopyV496"><strong>{query.trim() ? "No matching playlists" : "No manual playlists yet"}</strong><p>{query.trim() ? "Try a different name." : "Create one below to add these tracks."}</p></span>
          </div>}
          {matching.length > visibleCount && <Button type="button" variant="secondary" disabled={busy} onClick={()=>setVisibleCount(count=>count+PAGE_SIZE)}>Show more playlists ({matching.length-visibleCount} remaining)</Button>}
        </div>
        {error || collision || !songIds.length ? <p className="playlistPickerStatus" role="alert">{error || (collision ? "That name belongs to a smart playlist. Choose another name." : "No tracks are available to add.")}</p> : null}
        {error && <Button type="button" variant="secondary" disabled={busy} onClick={()=>{if(retryAction.current)void save(retryAction.current);}}>Retry save</Button>}
        <form className="playlistPickerCreate" onSubmit={event=>{event.preventDefault();if(name.trim()&&!collision)void save(()=>onCreate(name));}}>
          <input value={name} disabled={busy} maxLength={120} onChange={event=>setName(event.currentTarget.value)} placeholder="new playlist name" aria-label="New playlist name"/>
          <Button className="mainAction" type="submit" disabled={busy||!name.trim()||collision||!songIds.length}>{busy ? "Saving…" : "create and add"}</Button>
        </form>
    </Dialog>
  );
}

export type PlaylistPickerModalProps = {
  song: Song | null;
  name: string;
  setName: (value: string) => void;
  onClose: () => void;
  playlists: Playlist[];
  songsById: Map<string, Song>;
  addSongToPlaylist: (playlistId: string, songId: string) => Promise<boolean>;
  createPlaylistWithSong: (songId: string, name: string) => Promise<boolean>;
};

export default function PlaylistPickerModal({song,addSongToPlaylist,createPlaylistWithSong,...props}: PlaylistPickerModalProps) {
  const songIds = useMemo(() => song ? [song.id] : [], [song?.id]);
  if (!song) return null;
  return <PlaylistMembershipDialog key={song.id} {...props} label="Add song to playlist" title={displaySongTitleV444(song,9)} subtitle={displaySongPickerSublineV444(song)} songIds={songIds}
    onAdd={id=>addSongToPlaylist(id,song.id)} onCreate={name=>createPlaylistWithSong(song.id,name)}/>;
}
