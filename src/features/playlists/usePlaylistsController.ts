import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppToastKind, View } from "../shell/view.types";
import type { LibraryDropSide, Song } from "../library/song.types";
import { insertIdNearTarget, reorderIdList } from "../library/library.utils";
import { prettyTitle } from "../search/search.utils";
import { readRecoveryJournal } from "../../shared/storage/recoveryJournal";
import { makeLocalId } from "../../shared/storage/localStorage";
import { PLAYLIST_RECOVERY_KEY } from "./playlist.constants";
import type { Playlist } from "./playlist.types";
import { prepareGeneratedPlaylist } from "./generatedPlaylist";
import { cleanPlaylistArtwork, cleanPlaylistList } from "./playlist.utils";
import { createPlaylistPersistence, samePlaylists } from "./playlistPersistence";
import { useStableCallback } from "../../shared/hooks/useStableCallback";
import { cleanSmartRules, evaluateSmartRules, needsListeningCounts, type SmartRules } from "./smartPlaylist";
import { useSmartPlaylistView } from "./useSmartPlaylistView";

function isPlaylistRecoverySnapshot(value: unknown): value is Playlist[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
      typeof item.name !== "string" || !Number.isFinite(item.createdAt) ||
      !Array.isArray(item.songIds) || !item.songIds.every((id: unknown) => typeof id === "string") ||
      (item.coverArtwork !== undefined && typeof item.coverArtwork !== "string") ||
      (item.rules != null && !cleanSmartRules(item.rules))) return false;
    ids.add(item.id);
    return true;
  });
}

export type PlaylistsControllerOptions = {
  songs: Song[];
  songsById: Map<string, Song>;
  changeView: (view: View, source?: "nav" | "onboarding" | "settings" | "unknown") => void;
  setStatusText: Dispatch<SetStateAction<string>>;
  showAppToast: (message: string, kind?: AppToastKind) => void;
};

export function usePlaylistsController({
  songs,
  songsById,
  changeView,
  setStatusText,
  showAppToast
}: PlaylistsControllerOptions) {
  const recoveryBlocked = useRef(false);
  const [storedPlaylists, publishPlaylists] = useState<Playlist[]>([]);
  const { playlists, listeningCounts, smartNow, setSmartPreviewOpen } = useSmartPlaylistView(storedPlaylists, songs);
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
      if (recoveryBlocked.current) {
        if (!samePlaylists(base, draft)) throw new Error("Unreadable recovery journal");
        return;
      }
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
    type Recovery = {base: Playlist[]; draft: Playlist[]};
    const recovery = readRecoveryJournal(() => window.localStorage, PLAYLIST_RECOVERY_KEY, (value): value is Recovery => {
      const item = value as Partial<Recovery> | null;
      return !!item && isPlaylistRecoverySnapshot(item.base) && isPlaylistRecoverySnapshot(item.draft);
    });
    recoveryBlocked.current = recovery.blocked;
    persistence.initialize(remote, recovery.value ?? undefined);
    if (recovery.archived || recovery.blocked) {
      const message = recovery.blocked
        ? "Playlist recovery is unreadable. Edits are disabled; restart or copy recovery data in Advanced settings."
        : "Invalid playlist recovery data was preserved. Copy it from Advanced settings if needed.";
      setStatusText(message);
      showAppToast(message, "error");
    }
    void persistence.flush();
  }, [persistence, setStatusText, showAppToast]);
  const setPlaylists = useCallback<Dispatch<SetStateAction<Playlist[]>>>(update => {
    if (recoveryBlocked.current) { showAppToast("Playlist edits are disabled until recovery storage is available. Restart Localtify.", "error"); return; }
    const previous = persistence.current();
    persistence.set(cleanPlaylistList(typeof update === "function" ? update(previous) : update));
  }, [persistence, showAppToast]);
  const confirmSaved = useCallback(async (message: string, matches: (items: Playlist[]) => boolean) => {
    if (!await flushPlaylists()) return false;
    if (!matches(persistence.committed())) {
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
  const smartPlaylistLocked = useCallback((playlist: Playlist) => {
    if (!playlist.rules) return false;
    showAppToast("Edit the rules to change a smart playlist", "info");
    return true;
  }, [showAppToast]);

  const upsertSpotifyPlaylistFromImport = useStableCallback((sourceName: string, importedSongs: Song[], sourceId: string) => {
    const songIds = [...new Set(importedSongs.map(song => song.id).filter(Boolean))];
    if (!songIds.length) return null;
    const name = normalizePlaylistName(sourceName, `Spotify import ${new Date().toLocaleDateString()}`);
    const current = persistence.current();
    const providerId = /^spotify:(album|playlist):[A-Za-z0-9]{22}$/.test(sourceId) ? sourceId : "";
    const id = providerId ? providerId.replaceAll(":", "_") : makeLocalId("playlist");
    const previous = current.find(item => item.id === id);
    if (previous && smartPlaylistLocked(previous)) return null;
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
    const playlist = persistence.current().find((item) => item.id === playlistId);
    if (!song || !playlist || smartPlaylistLocked(playlist)) return;

    if (playlist.songIds.includes(songId)) {
      void confirmSaved("song is already in that playlist", items => items.some(item => item.id === playlistId && item.songIds.includes(songId)));
      return;
    }

    setPlaylists((items) => items.map((item) =>
      item.id === playlistId && !item.rules && !item.songIds.includes(songId) ? { ...item, songIds: [...item.songIds, songId] } : item
    ));
    setSelectedPlaylistId(playlistId);
    void confirmSaved(`added ${prettyTitle(song.title, 4)} to ${playlist.name}`, items => items.some(item => item.id === playlistId && item.songIds.includes(songId)));

    if (playlistPickerSong?.id === songId) {
      setPlaylistPickerSong(null);
      setPlaylistPickerName("");
    }
  }, [confirmSaved, playlistPickerSong?.id, persistence, setStatusText, showAppToast, songsById, smartPlaylistLocked]);

  const createPlaylistFromSongs = useCallback((name: string, ids: string[]) => {
    const prepared = prepareGeneratedPlaylist(name, ids, songsById, persistence.current());
    if (!prepared) return null;
    const id = prepared.existingId || makeLocalId("playlist");
    if (!prepared.existingId) setPlaylists((items) => [{ id, name: prepared.name, songIds: prepared.songIds, createdAt: Date.now() }, ...items]);
    setSelectedPlaylistId(id);
    void confirmSaved(prepared.existingId ? "playlist already saved" : "mix saved to playlists", items => items.some(item => item.id === id && prepared.songIds.every(songId => item.songIds.includes(songId))));
    return id;
  }, [confirmSaved, persistence, songsById, showAppToast]);

  const savePromptPlaylist = useCallback(async (name: string, ids: string[]) => {
    const id = createPlaylistFromSongs(name, ids);
    if (!id || !await flushPlaylists()) return null;
    return persistence.committed().some(item => item.id === id && ids.every(songId => item.songIds.includes(songId))) ? id : null;
  }, [createPlaylistFromSongs, flushPlaylists, persistence]);

  const createPlaylist = useCallback((forcedName?: string) => {
    const sourceName = typeof forcedName === "string" ? forcedName : newPlaylistName;
    const name = normalizePlaylistName(sourceName, `playlist ${persistence.current().length + 1}`);
    const existingPlaylist = persistence.current().find(
      (playlist) => playlist.name.trim().toLowerCase() === name.toLowerCase()
    );

    if (existingPlaylist) {
      setSelectedPlaylistId(existingPlaylist.id);
      void confirmSaved("playlist already exists", items => items.some(item => item.id === existingPlaylist.id));
      return existingPlaylist.id;
    }

    const playlist: Playlist = { id: makeLocalId("playlist"), name, songIds: [], createdAt: Date.now() };
    setPlaylists((items) => [playlist, ...items]);
    setSelectedPlaylistId(playlist.id);
    if (typeof forcedName === "string") setPlaylistPickerName("");
    else setNewPlaylistName("");
    void confirmSaved(`created playlist: ${name}`, items => items.some(item => item.id === playlist.id));
    return playlist.id;
  }, [confirmSaved, newPlaylistName, normalizePlaylistName, persistence, setStatusText, showAppToast]);

  const saveSmartPlaylist = useCallback(async (playlistId: string | null, sourceName: string, sourceRules: SmartRules, creationId?: string) => {
    const rules = cleanSmartRules(sourceRules);
    if (!rules) { showAppToast("Complete all smart playlist rules before saving", "error"); return null; }
    const name = normalizePlaylistName(sourceName, "smart playlist");
    const current = persistence.current();
    const id = playlistId || creationId || makeLocalId("playlist");
    const existing = current.find(item => item.id === id);
    if (playlistId && !existing?.rules) { showAppToast("This smart playlist no longer exists", "error"); return null; }
    if (existing && !existing.rules) return null;
    if (current.some(item => item.id !== id && item.name.trim().toLowerCase() === name.toLowerCase())) {
      showAppToast("Playlist name already exists", "info"); return null;
    }
    if (listeningCounts === null && needsListeningCounts(rules)) {
      showAppToast("Listening counts are unavailable. Sync or retry before saving these rules.", "error"); return null;
    }
    const songIds = evaluateSmartRules(rules, songs, listeningCounts ?? new Map());
    setPlaylists(items => existing
      ? items.map(item => item.id === id ? { ...item, name, rules, songIds } : item)
      : [{id, name, rules, songIds, createdAt: Date.now()}, ...items]);
    const saved = await confirmSaved(playlistId ? "Smart playlist updated" : "Smart playlist created",
      items => items.some(item => item.id === id && item.name === name && JSON.stringify(item.rules) === JSON.stringify(rules)));
    if (!saved) return null;
    setSelectedPlaylistId(id);
    return id;
  }, [confirmSaved, listeningCounts, normalizePlaylistName, persistence, setPlaylists, showAppToast, songs]);

  const createPlaylistWithSong = useCallback((songId: string, forcedName: string) => {
    const sourceName = forcedName.trim();
    if (!sourceName || !songsById.has(songId)) return;

    const name = normalizePlaylistName(sourceName, `playlist ${persistence.current().length + 1}`);
    const existingPlaylist = persistence.current().find(
      (playlist) => playlist.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (existingPlaylist) {
      if (smartPlaylistLocked(existingPlaylist)) return;
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
  }, [confirmSaved, addSongToPlaylist, normalizePlaylistName, persistence, setStatusText, showAppToast, songsById, smartPlaylistLocked]);

  const removePlaylist = useCallback((playlistId: string) => {
    const playlist = persistence.current().find((item) => item.id === playlistId);
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
  }, [confirmSaved, persistence, renamingPlaylistId, setStatusText, showAppToast]);

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
    const current = persistence.current().find((playlist) => playlist.id === playlistId);
    if (!current) return;
    const nextName = renamingPlaylistName.trim().slice(0, 120) || current.name;
    const duplicate = persistence.current().some(
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
  }, [confirmSaved, persistence, renamingPlaylistName, setStatusText, showAppToast]);

  const setPlaylistArtwork = useCallback((id: string, value: string | null) => {
    const coverArtwork = cleanPlaylistArtwork(value);
    if (value && !coverArtwork) return;
    setPlaylists(items => items.map(item => item.id === id ? { ...item, coverArtwork: coverArtwork || undefined } : item));
    void confirmSaved(coverArtwork ? "playlist artwork saved" : "playlist artwork removed", items => items.some(item => item.id === id && (item.coverArtwork || null) === coverArtwork));
  }, [confirmSaved, setPlaylists]);

  const duplicatePlaylist = useCallback((playlistId: string) => {
    const source = persistence.current().find((playlist) => playlist.id === playlistId);
    if (!source) return;
    const existingNames = new Set(persistence.current().map((playlist) => playlist.name.trim().toLowerCase()));
    const baseName = `${source.name.slice(0, 110)} copy`.trim();
    let name = baseName;
    let index = 2;
    while (existingNames.has(name.toLowerCase())) {
      name = `${baseName} ${index}`;
      index += 1;
    }

    const copy: Playlist = { id: makeLocalId("playlist"), name, songIds: [...source.songIds], createdAt: Date.now(), ...(source.rules ? { rules: source.rules } : {}), ...(source.coverArtwork ? { coverArtwork: source.coverArtwork } : {}) };
    setPlaylists((items) => [copy, ...items]);
    setSelectedPlaylistId(copy.id);
    void confirmSaved(`duplicated ${source.name}`, items => items.some(item => item.id === copy.id));
  }, [confirmSaved, persistence, setStatusText, showAppToast]);

  const openPlaylist = useCallback((playlistId: string) => {
    setSelectedPlaylistId(playlistId);
    changeView("playlists", "unknown");
  }, [changeView]);

  const openPlaylistPicker = useCallback((song: Song) => {
    setPlaylistPickerName("");
    setPlaylistPickerSong(song);
  }, []);

  const removeSongFromPlaylist = useCallback((playlistId: string, songId: string) => {
    const playlist = persistence.current().find((item) => item.id === playlistId);
    if (!playlist || smartPlaylistLocked(playlist)) return;
    setPlaylists((items) => items.map((item) =>
      item.id === playlistId && !item.rules ? { ...item, songIds: item.songIds.filter((id) => id !== songId) } : item
    ));
    void confirmSaved(`removed from ${playlist.name}`, items => items.some(item => item.id === playlistId && !item.songIds.includes(songId)));
  }, [confirmSaved, persistence, setStatusText, showAppToast, smartPlaylistLocked]);

  const toggleSongPlaylist = useCallback((playlistId: string, songId: string) => {
    const playlist = persistence.current().find((item) => item.id === playlistId);
    if (!playlist) return;
    if (playlist.songIds.includes(songId)) removeSongFromPlaylist(playlistId, songId);
    else addSongToPlaylist(playlistId, songId);
  }, [addSongToPlaylist, persistence, removeSongFromPlaylist]);

  const handlePlaylistSongDrop = useCallback((
    playlistId: string,
    songId: string,
    targetSongId: string,
    side: LibraryDropSide
  ) => {
    if (!playlistId || !songId || !targetSongId || !songsById.has(songId) || songId === targetSongId) return;
    const playlist = persistence.current().find((item) => item.id === playlistId);
    if (!playlist || smartPlaylistLocked(playlist) || !playlist.songIds.includes(targetSongId)) return;
    const nextIds = playlist.songIds.includes(songId)
      ? reorderIdList(playlist.songIds, songId, targetSongId, side)
      : insertIdNearTarget(playlist.songIds, songId, targetSongId, side);
    if (nextIds.length === playlist.songIds.length && nextIds.every((id, index) => id === playlist.songIds[index])) return;

    setPlaylists((items) => items.map((item) =>
      item.id === playlistId && !item.rules && item.songIds.includes(targetSongId) ? { ...item, songIds: item.songIds.includes(songId) ? reorderIdList(item.songIds, songId, targetSongId, side) : insertIdNearTarget(item.songIds, songId, targetSongId, side) } : item
    ));
    setSelectedPlaylistId(playlistId);
    const reordering = playlist.songIds.includes(songId);
    void confirmSaved(reordering ? "playlist order updated" : `added to ${playlist.name}`, items => {
      const ids = items.find(item => item.id === playlistId)?.songIds ?? [];
      const from = ids.indexOf(songId), to = ids.indexOf(targetSongId);
      return from >= 0 && to >= 0 && (side === "before" ? from < to : from > to);
    });
  }, [confirmSaved, persistence, setStatusText, showAppToast, songsById, smartPlaylistLocked]);

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
    saveSmartPlaylist, listeningCounts, smartNow, setSmartPreviewOpen, savePromptPlaylist,
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
