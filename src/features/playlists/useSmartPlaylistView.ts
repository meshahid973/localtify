import { useEffect, useMemo, useState } from "react";
import type { Song } from "../library/song.types";
import type { Playlist } from "./playlist.types";
import { materializeSmartPlaylists, needsListeningCounts, usesClock, type ListeningCounts } from "./smartPlaylist";

export function useSmartPlaylistView(stored: Playlist[], songs: Song[]) {
  const [listeningCounts, setListeningCounts] = useState<ListeningCounts | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const requiresCounts = previewOpen || stored.some(item => item.rules && needsListeningCounts(item.rules));
  const requiresClock = previewOpen || stored.some(item => item.rules && usesClock(item.rules));
  useEffect(() => {
    if (!requiresCounts) return;
    let active = true, busy = false;
    setListeningCounts(null);
    async function refresh() {
      if (!active || busy || document.hidden) return;
      busy = true;
      try {
        const rows = await window.localitfy.getListeningCounts?.();
        if (!active) return;
        if (!Array.isArray(rows)) { setListeningCounts(null); return; }
        const next = new Map(rows.map(([id, finishes, skips]) => [id, { finishes, skips }]));
        setListeningCounts(previous => previous && previous.size === next.size &&
          [...next].every(([id, row]) => previous.get(id)?.finishes === row.finishes && previous.get(id)?.skips === row.skips) ? previous : next);
      } catch { /* Keep the last successful counts until the next refresh. */ }
      finally { busy = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [requiresCounts]);
  useEffect(() => {
    if (!requiresClock) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [requiresClock]);
  const playlists = useMemo(() => materializeSmartPlaylists(stored, songs, listeningCounts, requiresClock ? now : Date.now()), [stored, songs, listeningCounts, requiresClock, now]);
  return {playlists, listeningCounts, smartNow: now, setSmartPreviewOpen: setPreviewOpen};
}
