export type DiscoverArtwork = { coverUrl?: string; fallbackCoverUrl?: string; coverAlternatives?: string[]; durationMs?: number };
export type DiscoverTrack = { title: string; artist: string; url: string; album?: string; providerId?: string; recordingId?: string; artistIds?: string[]; catalogArtistIds?: string[]; catalogAlbumId?: string } & DiscoverArtwork;
export type DiscoverArtist = { name: string; url: string; because: string[]; seedCount: number; topTracks: DiscoverTrack[] };
export type CatalogKind = "recording" | "artist";
export type CatalogArtistCredit = { name: string; id?: string };
export type CatalogItem = { id: string; title: string; artist: string; album?: string; subtitle: string; url: string; artistIds?: string[]; albumId?: string; artistCredits?: CatalogArtistCredit[]; releaseDate?: string; aliases?: string[]; songType?: string } & DiscoverArtwork;
export type DiscoverDiagnosticEvent = { at: number; stage: string; ms?: number; count?: number; total?: number; state?: string; attached?: number };
export type DiscoverResult =
  | { status: "diagnostics"; events: DiscoverDiagnosticEvent[] }
  | { status: "configuration"; lastfmSource: "default" | "override" | "missing"; lastfmCheck?: "ok" | "no-match" | "bad-key" | "rate-limited" | "network" | "http" | "error" }
  | ({ status: "artwork"; outcome?: "unavailable" | "busy" } & DiscoverArtwork)
  | { status: "catalog"; kind: CatalogKind; items: CatalogItem[] }
  | { status: "ready" | "no-taste"; generatedAt: number; partial?: boolean; seeds: string[]; artists: DiscoverArtist[]; tracks: DiscoverTrack[] }
  | { status: "off" | "needs-key" }
  | { status: "error"; error: string };
/** Plain text from Last.fm; paragraphs are separated by blank lines. */
export type ArtistBio =
  | { status: "ready"; name: string; url: string; summary: string; content: string }
  | { status: "none" | "off" | "needs-key" }
  | { status: "error"; error: string };
