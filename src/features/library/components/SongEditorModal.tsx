import { useRef, useState, type FormEvent } from "react";
import { Heart, Save, Trash2, X } from "lucide-react";
import Button from "../../../shared/ui/Button";
import Dialog from "../../../shared/ui/Dialog";
import { IconButton } from "../../../shared/ui/IconButton";
import { Cover } from "../../covers/Cover";
import { formatTime } from "../../../shared/utils/format";
import type { Playlist } from "../../playlists/playlist.types";
import type { Song } from "../song.types";
import "./song-editor.css";

export type SongEditorModalProps = {
  song: Song | null;
  onClose: () => void;
  editTitle: string;
  setEditTitle: (value: string) => void;
  editArtist: string;
  setEditArtist: (value: string) => void;
  editAlbum: string;
  setEditAlbum: (value: string) => void;
  playlists: Playlist[];
  toggleSongPlaylist: (playlistId: string, songId: string) => unknown;
  toggleLike: (songId: string) => unknown;
  askRemoveSong: (songId: string) => unknown;
  saveEditor: () => Promise<boolean>;
};

export default function SongEditorModal({
  song, onClose, editTitle, setEditTitle, editArtist, setEditArtist, editAlbum, setEditAlbum,
  playlists, toggleSongPlaylist, toggleLike, askRemoveSong, saveEditor
}: SongEditorModalProps) {
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const busy = useRef(false);
  if (!song) return null;

  const editablePlaylists = playlists.filter(playlist => !playlist.rules);
  const membershipCount = editablePlaylists.filter(playlist => playlist.songIds.includes(song.id)).length;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      if (!await saveEditor()) setSaveFailed(true);
    } catch {
      setSaveFailed(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} dismissible={!saving} portal={false} glassTint={.84} glassBlur={6}
      backdropClassName="songEditorBackdrop" className="songEditor" labelledBy="song-editor-dialog-title">
      <header className="songEditorHeader">
        <h2 id="song-editor-dialog-title">Edit track</h2>
        <IconButton onClick={onClose} disabled={saving} aria-label="Close edit track dialog"><X size={18} aria-hidden="true" /></IconButton>
      </header>
      <form onSubmit={handleSave} aria-busy={saving}>
        <div className="songEditorBody">
          <aside className="songEditorArtwork" aria-label="Artwork and track stats">
            <Cover song={song} className="songEditorCover" priority="high" />
            <dl className="songEditorStats">
              <div><dt>Duration</dt><dd>{formatTime(song.duration || 0)}</dd></div>
              <div><dt>Plays</dt><dd>{song.playCount || 0}</dd></div>
            </dl>
          </aside>
          <div className="songEditorFields">
            <label>Title<input value={editTitle} readOnly={saving} onChange={event => setEditTitle(event.currentTarget.value)} /></label>
            <label>Artist<input value={editArtist} readOnly={saving} onChange={event => setEditArtist(event.currentTarget.value)} /></label>
            <label>Album<input value={editAlbum} readOnly={saving} onChange={event => setEditAlbum(event.currentTarget.value)} /></label>
            <details className="songEditorPlaylists">
              <summary><span>Playlists</span><span>{membershipCount ? `${membershipCount} selected` : "None selected"}</span></summary>
              {editablePlaylists.length ? <>
                <p>Playlist changes apply immediately.</p>
                <div className="songEditorPlaylistList">
                  {editablePlaylists.map(playlist => (
                    <label key={playlist.id}>
                      <input type="checkbox" checked={playlist.songIds.includes(song.id)} disabled={saving}
                        onChange={() => void toggleSongPlaylist(playlist.id, song.id)} />
                      <span>{playlist.name}</span>
                    </label>
                  ))}
                </div>
              </> : <p>No editable playlists yet.</p>}
            </details>
          </div>
        </div>
        {saveFailed ? <p className="songEditorError" role="alert">Couldn’t save changes. Try again.</p> : null}
        <footer className="songEditorActions">
          <Button variant="ghost" className="songEditorRemove" onClick={() => askRemoveSong(song.id)} disabled={saving}>
            <Trash2 size={15} aria-hidden="true" /> Remove track
          </Button>
          <Button variant="secondary" aria-pressed={Boolean(song.liked)} disabled={saving} onClick={() => toggleLike(song.id)}>
            <Heart size={15} fill={song.liked ? "currentColor" : "none"} aria-hidden="true" /> Like
          </Button>
          <Button type="submit" disabled={saving}><Save size={15} aria-hidden="true" /> {saving ? "Saving…" : "Save changes"}</Button>
        </footer>
      </form>
    </Dialog>
  );
}
