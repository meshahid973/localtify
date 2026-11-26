import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppToastKind, View } from "../shell/view.types";
import type { LibraryDropSide, Song } from "../library/song.types";
import { insertIdNearTarget, reorderIdList } from "../library/library.utils";
import { prettyTitle } from "../search/search.utils";
import { makeLocalId } from "../../shared/storage/localStorage";
import { PLAYLIST_RECOVERY_KEY } from "./playlist.constants";
import type { Playlist } from "./playlist.types";
import { prepareGeneratedPlaylist } from "./generatedPlaylist";
import { cleanPlaylistArtwork, cleanPlaylistList } from "./playlist.utils";
import { createPlaylistPersistence, samePlaylists } from "./playlistPersistence";
import { useStableCallback } from "../../shared/hooks/useStableCallback";

export type PlaylistsControllerOptions = {
  songsById: Map<string, Song>;
  changeView: (view: View, source?: "nav" | "onboarding" | "settings" | "unknown") => void;
  setStatusText: Dispatch<SetStateAction<string>>;
  showAppToast: (message: string, kind?: AppToastKind) => void;
};

export function usePlaylistsController({
  songsById,
  changeView,
  setStatusText,
  showAppToast
}: PlaylistsControllerOptions) {
  const [playlists, publishPlaylists] = useState<Playlist[]>([]);
  const [persistence] = useState(() => createPlaylistPersistence({
    read: async () => {
      if (!window.localitfy.getPlaylists) throw new Error("Playlist storage unavailable");
      const result = await window.localitfy.getPlaylists();
      if (!Array.isArray(result)) throw new Error("Invalid playlist storage response");
      return cleanPlaylistList(result);
    },
    save: async (next, expected) => {
      if (!window.localitfy.savePlaylists) throw new Error("Playlist saving is unavailable");
      const result = await window.localitfy.savePlaylists(next, expected);
      if (!Array.isArray(result)) throw new Error("Invalid playlist save response");
      return cleanPlaylistList(result);
    },
    publish: publishPlaylists,
    journal: (base, draft) => {
      if (samePlaylists(base, draft)) window.localStorage.removeItem(PLAYLIST_RECOVERY_KEY);
      else window.localStorage.setItem(PLAYLIST_RECOVERY_KEY, JSON.stringify({base, draft}));
    },
    failed: (_error, recoveryDurable, databaseSaved) => {
      const message = databaseSaved ? "Playlists saved, but recovery cleanup failed. Retry before closing."
        : recoveryDurable ? "Could not save playlists. Recovery copy saved; retry or reopen Localtify."
        : "Could not save playlists or recovery copy. Changes are in memory only; retry before closing.";
      setStatusText(message);
      showAppToast(message, "error");
    }
  }));
  const flushPlaylists = persistence.flush;
  const initializePlaylists = useCallback((remote: Playlist[]) => {
    const raw = window.localStorage.getItem(PLAYLIST_RECOVERY_KEY);
    const recovery = raw === null ? null : JSON.parse(raw);
    if (recovery !== null && (!Array.isArray(recovery.base) || !Array.isArray(recovery.draft))) {
      throw new Error("Invalid playlist recovery copy. Existing recovery data was preserved.");
    }
    persistence.initialize(remote, recovery ?? undefined);
    void persistence.flush();
  }, [persistence]);
  const setPlaylists = useCallback<Dispatch<SetStateAction<Playlist[]>>>(update => {
    const previous = persistence.current();
    persistence.set(cleanPlaylistList(typeof update === "function" ? update(previous) : update));
  }, [persistence]);
  const confirmSaved = useCallback(async (message: string, matches: (items: Playlist[]) => boolean) => {
    if (!await flushPlaylists()) return false;
    if (!matches(persistence.current())) {
      const notice = "Playlist changed concurrently. The latest library was kept.";
      setStatusText(notice);
      showAppToast(notice, "info");
      return false;
    }
    setStatusText(message);
    showAppToast(message, "success");
    return true;
  }, [flushPlaylists, persistence, setStatusText, showAppToast]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [playlistPickerName, setPlaylistPickerName] = useState("");
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playlistPickerSong, setPlaylistPickerSong] = useState<Song | null>(null);
  const [playlistDragOverPlaylistId, setPlaylistDragOverPlaylistId] = useState("");
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<string | null>(null);
  const [renamingPlaylistName, setRenamingPlaylistName] = useState("");
  useEffect(() => window.localitfy.onPlaylistsChanged?.(next => persistence.remote(cleanPlaylistList(next))), [persistence]);

  const normalizePlaylistName = useCallback((sourceName: string, fallbackName: string) => {
    return (sourceName.trim() || fallbackName).slice(0, 120);
  }, []);

  // React state updaters must not publish selection or toasts.
  const upsertSpotifyPlaylistFromImport = useStableCallback((sourceName: string, importedSongs: Song[], sourceId: string) => {
    const songIds = [...new Set(importedSongs.map(song => song.id).filter(Boolean))];
    if (!songIds.length) return null;
    const name = normalizePlaylistName(sourceName, `Spotify import ${new Date().toLocaleDateString()}`);
    const current = persistence.current();
    const providerId = /^spotify:(album|playlist):[A-Za-z0-9]{22}$/.test(sourceId) ? sourceId : "";
    const id = providerId ? providerId.replaceAll(":", "_") : makeLocalId("playlist");
    const previous = current.find(item => item.id === id);
    let safeName = previous?.name || name;
    let suffix = 1;
    while (!previous && current.some(item => item.name.trim().toLowerCase() === safeName.toLowerCase())) {
      safeName = normalizePlaylistName(name.slice(0, 100) + (suffix === 1 ? " (Spotify)" : ` (Spotify ${suffix})`), name);
      suffix++;
    }
    const createdAt = Date.now();
    setPlaylists(items => previous
      ? items.map(item => item.id === id ? {...item,songIds: [...new Set([...item.songIds, ...songIds])]} : item)
      : [{id,name:safeName,songIds,createdAt},...items]);
    setSelectedPlaylistId(id);
    setActivePlaylistId(id);
    void confirmSaved(`${previous?"updated":"created"} playlist: ${safeName}`, items => items.some(item => item.id === id && songIds.every(songId => item.songIds.includes(songId))));
    return id;
  });

  const addSongToPlaylist = useCallback((playlistId: string, songId: string) => {
    const song = songsById.get(songId);
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!song || !playlist) return;

    if (playlist.songIds.includes(songId)) {
      setStatusText("song is already in that playlist");
      return;
    }

    setPlaylists((items) => items.map((item) =>
      item.id === playlistId && !item.songIds.includes(songId) ? { ...item, songIds: [...item.songIds, songId] } : item
    ));
    setSelectedPlaylistId(playlistId);
    void confirmSaved(`added ${prettyTitle(song.title, 4)} to ${playlist.name}`, items => items.some(item => item.id === playlistId && item.songIds.includes(songId)));

    if (playlistPickerSong?.id === songId) {
      setPlaylistPickerSong(null);
      setPlaylistPickerName("");
    }
  }, [confirmSaved, playlistPickerSong?.id, playlists, setStatusText, showAppToast, songsById]);

  const createPlaylistFromSongs = useCallback((name: string, ids: string[]) => {
    const prepared = prepareGeneratedPlaylist(name, ids, songsById, playlists);
    if (!prepared) return null;
    const id = prepared.existingId || makeLocalId("playlist");
    if (!prepared.existingId) setPlaylists((items) => [{ id, name: prepared.name, songIds: prepared.songIds, createdAt: Date.now() }, ...items]);
    setSelectedPlaylistId(id);
    void confirmSaved(prepared.existingId ? "playlist already saved" : "mix saved to playlists", items => items.some(item => item.id === id && prepared.songIds.every(songId => item.songIds.includes(songId))));
    return id;
  }, [confirmSaved, playlists, songsById, showAppToast]);

  const createPlaylist = useCallback((forcedName?: string) => {
    const sourceName = typeof forcedName === "string" ? forcedName : newPlaylistName;
    const name = normalizePlaylistName(sourceName, `playlist ${playlists.length + 1}`);
    const existingPlaylist = playlists.find(
      (playlist) => playlist.name.trim().toLowerCase() === name.toLowerCase()
    );

    if (existingPlaylist) {
      setSelectedPlaylistId(existingPlaylist.id);
      setStatusText("playlist already exists");
      showAppToast("playlist already exists", "info");
      return existingPlaylist.id;
    }

    const playlist: Playlist = { id: makeLocalId("playlist"), name, songIds: [], createdAt: Date.now() };
    setPlaylists((items) => [playlist, ...items]);
    setSelectedPlaylistId(playlist.id);
    if (typeof forcedName === "string") setPlaylistPickerName("");
    else setNewPlaylistName("");
    void confirmSaved(`created playlist: ${name}`, items => items.some(item => item.id === playlist.id));
    return playlist.id;
  }, [confirmSaved, newPlaylistName, normalizePlaylistName, playlists, setStatusText, showAppToast]);

  const createPlaylistWithSong = useCallback((songId: string, forcedName: string) => {
    const sourceName = forcedName.trim();
    if (!sourceName || !songsById.has(songId)) return;

    const name = normalizePlaylistName(sourceName, `playlist ${playlists.length + 1}`);
    const existingPlaylist = playlists.find(
      (playlist) => playlist.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (existingPlaylist) {
      addSongToPlaylist(existingPlaylist.id, songId);
      setSelectedPlaylistId(existingPlaylist.id);
      setPlaylistPickerSong(null);
      setPlaylistPickerName("");
      return existingPlaylist.id;
    }

    const playlist: Playlist = { id: makeLocalId("playlist"), name, songIds: [songId], createdAt: Date.now() };
    setPlaylists((items) => [playlist, ...items]);
    setSelectedPlaylistId(playlist.id);
    setPlaylistPickerSong(null);
    setPlaylistPickerName("");
    void confirmSaved(`added to ${name}`, items => items.some(item => item.id === playlist.id && item.songIds.includes(songId)));
    return playlist.id;
  }, [confirmSaved, addSongToPlaylist, normalizePlaylistName, playlists, setStatusText, showAppToast, songsById]);

  const removePlaylist = useCallback((playlistId: string) => {
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    if (!window.confirm(`Delete "${playlist.name}"? Songs stay in your library.`)) return;

    setPlaylists((items) => items.filter((item) => item.id !== playlistId));
    setSelectedPlaylistId((id) => (id === playlistId ? null : id));
    setActivePlaylistId((id) => (id === playlistId ? null : id));
    if (renamingPlaylistId === playlistId) {
      setRenamingPlaylistId(null);
      setRenamingPlaylistName("");
    }
    void confirmSaved(`removed ${playlist.name}`, items => !items.some(item => item.id === playlistId));
  }, [confirmSaved, playlists, renamingPlaylistId, setStatusText, showAppToast]);

  const startRenamePlaylist = useCallback((playlist: Playlist) => {
    setRenamingPlaylistId(playlist.id);
    setRenamingPlaylistName(playlist.name);
    setSelectedPlaylistId(playlist.id);
  }, []);

  const cancelRenamePlaylist = useCallback(() => {
    setRenamingPlaylistId(null);
    setRenamingPlaylistName("");
  }, []);

  const savePlaylistRename = useCallback((playlistId: string) => {
    const current = playlists.find((playlist) => playlist.id === playlistId);
    if (!current) return;
    const nextName = renamingPlaylistName.trim().slice(0, 120) || current.name;
    const duplicate = playlists.some(
      (playlist) => playlist.id !== playlistId && playlist.name.trim().toLowerCase() === nextName.toLowerCase()
    );
    if (duplicate) {
      setStatusText("playlist name already exists");
      showAppToast("playlist name already exists", "info");
      return;
    }

    setPlaylists((items) => items.map((playlist) =>
      playlist.id === playlistId ? { ...playlist, name: nextName } : playlist
    ));
    setRenamingPlaylistId(null);
    setRenamingPlaylistName("");
    void confirmSaved(`renamed playlist to ${nextName}`, items => items.some(item => item.id === playlistId && item.name === nextName));
  }, [confirmSaved, playlists, renamingPlaylistName, setStatusText, showAppToast]);

  const setPlaylistArtwork = useCallback((id: string, value: string | null) => {
    const coverArtwork = cleanPlaylistArtwork(value);
    if (value && !coverArtwork) return;
    setPlaylists(items => items.map(item => item.id === id ? { ...item, coverArtwork: coverArtwork || undefined } : item));
  }, []);

  const duplicatePlaylist = useCallback((playlistId: string) => {
    const source = playlists.find((playlist) => playlist.id === playlistId);
    if (!source) return;
    const existingNames = new Set(playlists.map((playlist) => playlist.name.trim().toLowerCase()));
    const baseName = `${source.name} copy`.trim();
    let name = baseName;
    let index = 2;
    while (existingNames.has(name.toLowerCase())) {
      name = `${baseName} ${index}`;
      index += 1;
    }

    const copy: Playlist = { id: makeLocalId("playlist"), name, songIds: [...source.songIds], createdAt: Date.now(), ...(source.coverArtwork ? { coverArtwork: source.coverArtwork } : {}) };
    setPlaylists((items) => [copy, ...items]);
    setSelectedPlaylistId(copy.id);
    void confirmSaved(`duplicated ${source.name}`, items => items.some(item => item.id === copy.id));
  }, [confirmSaved, playlists, setStatusText, showAppToast]);

  const openPlaylist = useCallback((playlistId: string) => {
    setSelectedPlaylistId(playlistId);
    changeView("playlists", "unknown");
  }, [changeView]);

  const openPlaylistPicker = useCallback((song: Song) => {
    setPlaylistPickerName("");
    setPlaylistPickerSong(song);
  }, []);

  const removeSongFromPlaylist = useCallback((playlistId: string, songId: string) => {
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    setPlaylists((items) => items.map((item) =>
      item.id === playlistId ? { ...item, songIds: item.songIds.filter((id) => id !== songId) } : item
    ));
    void confirmSaved(`removed from ${playlist.name}`, items => items.some(item => item.id === playlistId && !item.songIds.includes(songId)));
  }, [confirmSaved, playlists, setStatusText, showAppToast]);

  const toggleSongPlaylist = useCallback((playlistId: string, songId: string) => {
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    if (playlist.songIds.includes(songId)) removeSongFromPlaylist(playlistId, songId);
    else addSongToPlaylist(playlistId, songId);
  }, [addSongToPlaylist, playlists, removeSongFromPlaylist]);

  const handlePlaylistSongDrop = useCallback((
    playlistId: string,
    songId: string,
    targetSongId: string,
    side: LibraryDropSide
  ) => {
    if (!playlistId || !songId || !targetSongId || !songsById.has(songId) || songId === targetSongId) return;
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    const nextIds = playlist.songIds.includes(songId)
      ? reorderIdList(playlist.songIds, songId, targetSongId, side)
      : insertIdNearTarget(playlist.songIds, songId, targetSongId, side);
    if (nextIds.length === playlist.songIds.length && nextIds.every((id, index) => id === playlist.songIds[index])) return;

    setPlaylists((items) => items.map((item) =>
      item.id === playlistId && item.songIds.includes(targetSongId) ? { ...item, songIds: item.songIds.includes(songId) ? reorderIdList(item.songIds, songId, targetSongId, side) : insertIdNearTarget(item.songIds, songId, targetSongId, side) } : item
    ));
    setSelectedPlaylistId(playlistId);
    const reordering = playlist.songIds.includes(songId);
    void confirmSaved(reordering ? "playlist order updated" : `added to ${playlist.name}`, items => {
      const ids = items.find(item => item.id === playlistId)?.songIds ?? [];
      const from = ids.indexOf(songId), to = ids.indexOf(targetSongId);
      return from >= 0 && to >= 0 && (side === "before" ? from < to : from > to);
    });
  }, [confirmSaved, playlists, setStatusText, showAppToast, songsById]);

  const handlePlaylistSongAppend = useCallback((playlistId: string, songId: string) => {
    if (!playlistId || !songId || !songsById.has(songId)) return;
    addSongToPlaylist(playlistId, songId);
  }, [addSongToPlaylist, songsById]);

  return {
    playlists,
    setPlaylists, initializePlaylists, flushPlaylists, confirmSaved,
    newPlaylistName,
    setNewPlaylistName,
    playlistPickerName,
    setPlaylistPickerName,
    activePlaylistId,
    setActivePlaylistId,
    selectedPlaylistId,
    setSelectedPlaylistId,
    playlistPickerSong,
    setPlaylistPickerSong,
    playlistDragOverPlaylistId,
    setPlaylistDragOverPlaylistId,
    renamingPlaylistId,
    renamingPlaylistName,
    setRenamingPlaylistName,
    createPlaylist,
    createPlaylistWithSong,
    createPlaylistFromSongs,
    removePlaylist,
    startRenamePlaylist,
    cancelRenamePlaylist,
    savePlaylistRename,
    duplicatePlaylist,
    setPlaylistArtwork,
    openPlaylist,
    openPlaylistPicker,
    addSongToPlaylist,
    removeSongFromPlaylist,
    toggleSongPlaylist,
    handlePlaylistSongDrop,
    handlePlaylistSongAppend,
    normalizePlaylistName,
    upsertSpotifyPlaylistFromImport
  };
}
