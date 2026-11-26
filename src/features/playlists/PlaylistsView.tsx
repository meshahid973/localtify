import "../../shared/ui/collection-layout.css";
import "./playlists.css";
import "./playlist-oled.css";
import { isAndroidApp } from "../../app/platform";
import DailyMixesShelf, { type DailyMixesShelfProps } from "../analysis/DailyMixesShelf";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from "react";
import { Check, Copy, ImagePlus, Pencil, Plus, Radio, SlidersHorizontal, Sparkles, Trash2, WandSparkles, X } from "lucide-react";
import type { SimilarSeedRequest } from "../analysis/similarSeed";
import { notForMeTest, type NotForMeMarks } from "../analysis/notForMe";
import PlaylistRecommendations from "./components/PlaylistRecommendations";
import { ActionLabel } from "../../shared/ui/ActionLabel";
import { Button } from "../../vendor/beui/button";
import { PageHeader } from "../../shared/ui/PageHeader";
import { LocaltifyStateCard, MetaDividerDot } from "../../shared/ui/LocaltifyViewUi";
import { VirtualPlaylistTrackList } from "./components/VirtualPlaylistTrackList";
import PlaylistCoverCollage from "./components/PlaylistCoverCollage";
import { preparePlaylistArtwork } from "./playlistArtwork";
import { formatTime } from "../../shared/utils/format";
import type { usePlaylistsController } from "./usePlaylistsController";
import type { Playlist, PlaylistSummary } from "./playlist.types";
import type { Song, LibraryDropSide } from "../library/song.types";
import { filterCollectionSongs, sortLibrarySongs, type LibrarySortMode } from "../library/librarySort";
import { describeSmartRules, type ListeningCounts, type SmartRules } from "./smartPlaylist";
import { MediaCard } from "../../shared/ui/MediaCard";
import { playlistTarget, playableIds, useAppActions } from "../shell/appActions";
import { PageAtmosphere } from "../covers/pageAtmosphere";
import CollectionHero from "../pages/CollectionHero";

const SmartPlaylistDialog = lazy(() => import("./components/SmartPlaylistDialog"));
const PromptPlaylistDialog = lazy(() => import("./components/PromptPlaylistDialog"));

type Controller = ReturnType<typeof usePlaylistsController>;
export type PlaylistsViewProps = {
  dailyMixes: DailyMixesShelfProps;
  playSongs: (ids: string[], label: string) => unknown;
  selectSong: (id: string, autoplay?: boolean) => unknown;
  activePlaylistId: string | null;
  appendPlaylistSongAction: (playlistId: string, songId: string) => void;
  cancelRenamePlaylist: Controller["cancelRenamePlaylist"];
  createPlaylist: Controller["createPlaylist"];
  currentId: string | null;
  draggedSongId: string;
  dropPlaylistSongAction: (playlistId: string, songId: string, targetSongId: string, side: LibraryDropSide) => void;
  duplicatePlaylist: Controller["duplicatePlaylist"];
  endPlaylistSongDragAction: () => void;
  handlePlaylistShelfDragLeave: (event: DragEvent<HTMLElement>, playlistId: string) => void;
  handlePlaylistShelfDragOver: (event: DragEvent<HTMLElement>, playlistId: string) => void;
  handlePlaylistShelfDrop: (event: DragEvent<HTMLElement>, playlistId: string) => void;
  importSongs: () => unknown;
  isPlaying: boolean;
  newPlaylistName: string;
  openPlaylistSongContextMenuAction: (event: MouseEvent<HTMLElement>, song: Song) => void;
  playPlaylist: (playlist: Playlist, shuffled?: boolean) => unknown;
  openSimilarSongs: (request: SimilarSeedRequest) => unknown;
  playlistDragOverPlaylistId: string;
  playlistSummaries: PlaylistSummary[];
  removePlaylist: Controller["removePlaylist"];
  removePlaylistSongAction: (playlistId: string, songId: string) => void;
  renamingPlaylistId: string | null;
  renamingPlaylistName: string;
  savePlaylistRename: Controller["savePlaylistRename"];
  setPlaylistArtwork: Controller["setPlaylistArtwork"];
  selectPlaylistSongAction: (songId: string, playlistId?: string, songOrder?: string[]) => void;
  selectedPlaylist: Playlist | null;
  songsById: Map<string, Song>;
  setNewPlaylistName: Controller["setNewPlaylistName"];
  setRenamingPlaylistName: Controller["setRenamingPlaylistName"];
  setSelectedPlaylistId: Controller["setSelectedPlaylistId"];
  songs: Song[];
  startPlaylistSongDragAction: (event: DragEvent<HTMLElement>, songId: string) => void;
  startRenamePlaylist: Controller["startRenamePlaylist"];
  saveSmartPlaylist: (playlistId: string | null, name: string, rules: SmartRules, creationId?: string) => Promise<string | null>;
  listeningCounts: ListeningCounts | null;
  smartNow: number;
  savePromptPlaylist: (name: string, ids: string[]) => Promise<string | null>;
  setSmartPreviewOpen: (open: boolean) => void;
  /** The playlist page being shown; null shows every playlist. */
  detailPlaylistId?: string | null;
  addSongToPlaylist: (playlistId: string, songId: string) => unknown;
  notForMe: { marks: NotForMeMarks };
};

export default function PlaylistsView(props: PlaylistsViewProps) {
  const {
    activePlaylistId,
    appendPlaylistSongAction,
    cancelRenamePlaylist,
    createPlaylist,
    currentId,
    draggedSongId,
    dropPlaylistSongAction,
    duplicatePlaylist,
    endPlaylistSongDragAction,
    handlePlaylistShelfDragLeave,
    handlePlaylistShelfDragOver,
    handlePlaylistShelfDrop,
    importSongs,
    isPlaying,
    newPlaylistName,
    openPlaylistSongContextMenuAction,
    playPlaylist,
    playlistDragOverPlaylistId,
    playlistSummaries,
    removePlaylist,
    removePlaylistSongAction,
    renamingPlaylistId,
    renamingPlaylistName,
    savePlaylistRename,
    selectPlaylistSongAction,
    selectedPlaylist,
    setNewPlaylistName,
    setRenamingPlaylistName,
    setSelectedPlaylistId,
    songs,
    startPlaylistSongDragAction,
    startRenamePlaylist
  } = props;
  // undefined: closed; null: creating a new smart playlist.
  const [smartEditing, setSmartEditing] = useState<Playlist | null | undefined>(undefined);
  const [prompting, setPrompting] = useState(false);
  const previewOpen = smartEditing !== undefined;
  const setSmartPreviewOpen = props.setSmartPreviewOpen;
  useEffect(() => { setSmartPreviewOpen(previewOpen); return () => setSmartPreviewOpen(false); }, [previewOpen, setSmartPreviewOpen]);
  const [playlistQuery, setPlaylistQuery] = useState("");
  const [trackQuery, setTrackQuery] = useState("");
  const [trackSort,setTrackSort]=useState<LibrarySortMode>("library");
  const [creating, setCreating] = useState(false);
  const createLock = useRef(false);
  const [removing, setRemoving] = useState(false);
  const removalLock = useRef(false);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [renamingBusy, setRenamingBusy] = useState(false);
  const renameLock = useRef(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState("");
  const coverInput = useRef<HTMLInputElement>(null);
  const visiblePlaylists = useMemo(() => playlistSummaries.filter((summary: { playlist: Playlist }) =>
    summary.playlist.name.toLocaleLowerCase().includes(playlistQuery.trim().toLocaleLowerCase())), [playlistSummaries, playlistQuery]);
  const hidden = useMemo(() => notForMeTest(props.notForMe.marks), [props.notForMe.marks]);
  const playlists = useMemo(() => playlistSummaries.map((summary: { playlist: Playlist }) => summary.playlist), [playlistSummaries]);
  const actions = useAppActions();
  const songsById = props.songsById;
  const detailId = props.detailPlaylistId || null;
  // Adding a song to another playlist selects that one; the page keeps the selection on its own playlist,
  // which the track list's play, drop and remove actions act on.
  useEffect(() => { if (detailId && selectedPlaylist?.id !== detailId) setSelectedPlaylistId(detailId); }, [detailId, selectedPlaylist?.id, setSelectedPlaylistId]);
  const detailPlaylist: Playlist | null = detailId ? playlistSummaries.find((summary: { playlist: Playlist }) => summary.playlist.id === detailId)?.playlist ?? null : null;
  const detailSongs = useMemo(() => detailPlaylist?.songIds.flatMap((id) => songsById.get(id) ?? []) ?? [], [detailPlaylist, songsById]);
  useEffect(() => { setTrackQuery(""); setTrackSort("library"); setCoverError(""); }, [detailId]);
  const sortedDetailSongs = useMemo(()=>sortLibrarySongs(detailSongs,trackSort),[detailSongs,trackSort]);
  const filteredDetailSongs = useMemo(()=>filterCollectionSongs(sortedDetailSongs,trackQuery),[sortedDetailSongs,trackQuery]);
  const smartDialog = smartEditing !== undefined ? (
    <Suspense fallback={null}>
      <SmartPlaylistDialog playlist={smartEditing} songs={songs} listeningCounts={props.listeningCounts} now={props.smartNow}
        onSave={async (playlistId, name, rules, creationId) => {
          const id = await props.saveSmartPlaylist(playlistId, name, rules, creationId);
          if (id && !playlistId) actions.nav.open({ kind: "playlist", id });
          return id;
        }} onClose={() => setSmartEditing(undefined)} />
    </Suspense>
  ) : null;

  const promptDialog = prompting ? (
    <Suspense fallback={null}>
      <PromptPlaylistDialog songs={songs} currentId={currentId} hidden={hidden} playSongs={props.playSongs}
        selectSong={props.selectSong} savePlaylist={props.savePromptPlaylist}
        openAnalysisSettings={() => { setPrompting(false); props.dailyMixes.openAnalysisSettings(); }} onClose={() => setPrompting(false)} />
    </Suspense>
  ) : null;

  if (detailId) {
    if (!detailPlaylist) {
      return (
        <section data-page-section="playlists" className="playlistsPage playlistPageV029">
          <LocaltifyStateCard centered tone="info" eyebrow="playlist" title={pendingRemovalId === detailId ? "Playlist removal" : "This playlist is gone"} message={pendingRemovalId === detailId ? removing ? "Saving removal…" : "Could not confirm removal. Retry saving." : "It was removed since you opened it."}
            actions={<><button className="softButton" type="button" onClick={() => actions.nav.go("playlists")}>all playlists</button>{pendingRemovalId === detailId && <button className="softButton" type="button" disabled={removing} onClick={async()=>{setRemoving(true);try{if(await removePlaylist(detailId)){setPendingRemovalId(null);actions.nav.go("playlists");}}finally{setRemoving(false);}}}>Retry save</button>}</>} />
        </section>
      );
    }
    const target = playlistTarget(detailPlaylist, detailSongs);
    const playbackPlaylist = trackSort === "library" ? detailPlaylist : {...detailPlaylist,songIds:sortedDetailSongs.map(song=>song.id)};
    const playbackTarget = playlistTarget(playbackPlaylist, sortedDetailSongs);
    return (
      <section data-page-section="playlists" className="playlistsPage playlistPageV029 playlistDetailPage">
      <PageAtmosphere songs={detailSongs} custom={detailPlaylist.coverArtwork} />
        <CollectionHero
          typeLabel={detailPlaylist.rules ? "smart playlist" : "playlist"}
          title={detailPlaylist.name}
          cover={<PlaylistCoverCollage songs={detailSongs} coverArtwork={detailPlaylist.coverArtwork} className="collectionHeroCover playlistCoverCollage" />}
          coverSong={target.coverSong}
          byline={detailPlaylist.rules ? <span className="smartPlaylistSummary">{describeSmartRules(detailPlaylist.rules)}</span> : undefined}
          stats={`${detailSongs.length} song${detailSongs.length === 1 ? "" : "s"} · ${formatTime(detailSongs.reduce((total, song) => total + (Number(song.duration) || 0), 0))}`}
          playable={playableIds(detailSongs).length}
          onPlay={() => void playPlaylist(playbackPlaylist, false)}
          onShuffle={() => void playPlaylist(playbackPlaylist, true)}
          onQueue={() => actions.queueCollection(playbackTarget)}
          onMore={(event) => actions.openCollectionMenu(event, playbackTarget)}
          sort={{value:trackSort,onChange:setTrackSort,defaultLabel:"Playlist order"}}
          search={<input type="search" className="pageHeaderSearch" aria-label="Search playlist tracks" placeholder="Search tracks" value={trackQuery} onChange={event => setTrackQuery(event.currentTarget.value)} />}
        >
          <button className="collectionIconButton" type="button" onClick={() => props.openSimilarSongs({ kind: "playlist", playlistId: detailPlaylist.id })}
            disabled={detailSongs.length === 0} aria-label="more like this playlist" title="Find songs in your library that sound like this playlist">
            <Radio size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setCoverError(""); setCoverBusy(true);
            try { if(!await props.setPlaylistArtwork(detailPlaylist.id, await preparePlaylistArtwork(file))) setCoverError("Could not confirm artwork save. Retry."); }
            catch { setCoverError("Could not load that image. Choose a JPG, PNG or WebP under 12 MB."); }
            finally { setCoverBusy(false); }
          }} />
          <button className="collectionIconButton" type="button" disabled={coverBusy} aria-label="Upload playlist artwork" title="Upload playlist artwork" onClick={() => coverInput.current?.click()}><ImagePlus size={16} /></button>
          {detailPlaylist.coverArtwork ? <button className="collectionIconButton" type="button" disabled={coverBusy} aria-label="Reset playlist artwork" title="Reset playlist artwork" onClick={async () => {setCoverBusy(true);setCoverError("");try{if(!await props.setPlaylistArtwork(detailPlaylist.id,null))setCoverError("Could not confirm artwork removal. Retry.");}finally{setCoverBusy(false);}}}><X size={16} /></button> : null}
          {detailPlaylist.rules ? (
            <button className="collectionIconButton" type="button" onClick={() => setSmartEditing(detailPlaylist)} aria-label="edit rules" title="Edit rules">
              <SlidersHorizontal size={16} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </CollectionHero>
        {coverError ? <p role="alert">{coverError}</p> : null}

        <section className="playlistTracksPanel">
          <div className="panelHead playlistTracksHead">
            <div className="playlistTracksTitleBlock">
              {renamingPlaylistId === detailPlaylist.id ? (
                <form
                  className="playlistRenameForm"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if(renameLock.current)return;
                    renameLock.current=true;setRenamingBusy(true);
                    try{await savePlaylistRename(detailPlaylist.id);}finally{renameLock.current=false;setRenamingBusy(false);}
                  }}
                >
                  <input
                    value={renamingPlaylistName} disabled={renamingBusy}
                    onChange={(event) => setRenamingPlaylistName(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !renamingBusy) cancelRenamePlaylist();
                    }}
                    aria-label="Playlist name"
                    placeholder="playlist name"
                    autoFocus
                  />
                  <button className="settingsTinyButton" type="submit" disabled={renamingBusy}><ActionLabel icon={Check}>{renamingBusy ? "Saving…" : "save"}</ActionLabel></button>
                  <button className="settingsTinyButton" type="button" disabled={renamingBusy} onClick={cancelRenamePlaylist}><ActionLabel icon={X}>cancel</ActionLabel></button>
                </form>
              ) : (
                <h3>Tracks</h3>
              )}
            </div>

            <div className="playlistManageActions">
              <button className="settingsTinyButton" type="button" disabled={renamingBusy} onClick={() => startRenamePlaylist(detailPlaylist)}><ActionLabel icon={Pencil}>rename</ActionLabel></button>
              <button className="settingsTinyButton" type="button" onClick={() => duplicatePlaylist(detailPlaylist.id)}><ActionLabel icon={Copy}>duplicate</ActionLabel></button>
              <button className="settingsTinyButton danger" type="button" disabled={removing} onClick={async () => { if(removalLock.current)return;removalLock.current=true;setRemoving(true);setPendingRemovalId(detailPlaylist.id);try{if(await removePlaylist(detailPlaylist.id)){setPendingRemovalId(null);actions.nav.go("playlists");}}finally{removalLock.current=false;setRemoving(false);} }}><ActionLabel icon={Trash2}>remove</ActionLabel></button>
            </div>
          </div>

          {trackQuery.trim() && !filteredDetailSongs.length ? <p role="status">No matching tracks.</p> : <VirtualPlaylistTrackList
            selectedPlaylistId={detailPlaylist.id}
            list={filteredDetailSongs}
            editable={!detailPlaylist.rules}
            reorderable={!detailPlaylist.rules && !trackQuery.trim() && trackSort==="library"}
            currentId={currentId}
            isPlaying={isPlaying}
            draggedSongId={draggedSongId}
            onSelectSong={(id) => selectPlaylistSongAction(id, detailPlaylist.id, trackSort === "library" ? undefined : playbackPlaylist.songIds)}
            onStartSongDrag={startPlaylistSongDragAction}
            onDropSong={dropPlaylistSongAction}
            onAppendSong={appendPlaylistSongAction}
            onDragEnd={endPlaylistSongDragAction}
            onOpenContextMenu={openPlaylistSongContextMenuAction}
            onRemoveSong={removePlaylistSongAction}
          />}
          {!detailPlaylist.rules && detailSongs.length > 0 ? (
            <PlaylistRecommendations playlist={detailPlaylist} songs={songs} playlists={playlists} currentId={currentId} hidden={hidden}
              addSongToPlaylist={props.addSongToPlaylist} selectSong={props.selectSong} />
          ) : null}
        </section>
        {smartDialog}
        {promptDialog}
      </section>
    );
  }

  return (
    <section data-page-section="playlists" className="playlistsPage playlistPageV029 collectionBrowsePage">
      <PageHeader title="Playlists">
        <input className="pageHeaderSearch" type="search" value={playlistQuery} onChange={event => setPlaylistQuery(event.currentTarget.value)} placeholder="Search playlists" aria-label="Search playlists" />
        <span className="pageHeaderCount"><strong>{visiblePlaylists.length}</strong> playlist{visiblePlaylists.length === 1 ? "" : "s"}</span>
      </PageHeader>
      <div className="playlistToolbar" aria-label="Playlist actions">
        <form
          className="playlistCreateForm"
          onSubmit={async (event) => {
            event.preventDefault();
            if(createLock.current)return;createLock.current=true;setCreating(true);
            try {const id = await createPlaylist();if(id) actions.nav.open({kind:"playlist",id});}
            finally{createLock.current=false;setCreating(false);}
          }}
        >
          <input
            className="pageHeaderSearch playlistNameInput"
            value={newPlaylistName} disabled={creating}
            onChange={(event) => setNewPlaylistName(event.currentTarget.value)}
            placeholder="Name your playlist"
            aria-label="New playlist name"
            maxLength={120}
          />
          <Button className="playlistAction playlistActionPrimary" type="submit" disabled={creating}><ActionLabel icon={Plus}>{creating ? "Saving…" : "Create playlist"}</ActionLabel></Button>
        </form>
        <div className="playlistSecondaryActions">
          <Button variant="secondary" className="playlistAction playlistActionSecondary" type="button" onClick={() => setSmartEditing(null)} disabled={!songs.length}
            title="A playlist that fills itself from rules and your listening history">
            <ActionLabel icon={Sparkles}>Smart playlist</ActionLabel>
          </Button>
          <Button variant="secondary" className="playlistAction playlistActionSecondary" type="button" onClick={() => setPrompting(true)} disabled={!songs.length}
            title="Describe a playlist, then choose the songs to keep">
            <ActionLabel icon={WandSparkles}>From a prompt</ActionLabel>
          </Button>
        </div>
      </div>

      <div className="playlistContentGrid isEmpty">
        <section className="playlistShelfPanel">
          <div className="panelHead">
            <div>
              <h3>Your playlists</h3>
            </div>
          </div>

          <div className="collectionBrowseGrid">
            {visiblePlaylists.length ? visiblePlaylists.map(({ playlist, previewSongs, songCount, duration }, index) => (
              <MediaCard
                key={playlist.id}
                className={`collectionBrowseCard playlistShelfCard ${activePlaylistId === playlist.id ? "playing" : ""} ${playlistDragOverPlaylistId === playlist.id ? "dropTarget" : ""}`}
                style={{ "--playlist-stagger": Math.min(index, 12) } as CSSProperties}
                openLabel={`open ${playlist.name}`}
                playLabel={`play ${playlist.name}`}
                onOpen={() => actions.openCollection(playlistTarget(playlist, previewSongs))}
                onPlay={songCount ? () => void playPlaylist(playlist, false) : undefined}
                onContextMenu={(event) => actions.openCollectionMenu(event, playlistTarget(playlist, playlist.songIds.flatMap((id: string) => songsById.get(id) ?? [])))}
                onDragOver={(event) => handlePlaylistShelfDragOver(event, playlist.id)}
                onDragLeave={(event) => handlePlaylistShelfDragLeave(event, playlist.id)}
                onDrop={(event) => handlePlaylistShelfDrop(event, playlist.id)}
                title={playlist.rules ? "Open smart playlist" : "Drop a song here to add it"}
                cover={<PlaylistCoverCollage songs={previewSongs} coverArtwork={playlist.coverArtwork} className="collectionBrowseCardCover playlistCoverCollage" />}
              >
                <span >
                  <strong>{playlist.name}</strong>
                  <small>{playlist.rules ? <>smart<MetaDividerDot /></> : null}{songCount} song{songCount === 1 ? "" : "s"}<MetaDividerDot />{formatTime(duration)}</small>
                </span>
                {playlistDragOverPlaylistId === playlist.id ? <span className="playlistShelfDropHint">Drop to add</span> : null}
              </MediaCard>
            )) : (
              <LocaltifyStateCard
                centered
                cute
                tone={songs.length ? "info" : "warning"}
                eyebrow="playlists"
                title={playlistQuery ? "No matching playlists" : "No playlists yet"}
                message={playlistQuery ? "Try another playlist name." : songs.length ? "Name a playlist above to get started." : "Import songs to start your collection."}
                actions={songs.length ? (
                  <button className="mainAction" type="button" onClick={() => { if (playlistQuery) setPlaylistQuery(""); else document.querySelector<HTMLInputElement>(".playlistNameInput")?.focus(); }}>
                    {playlistQuery ? "Clear search" : "Name a playlist"}
                  </button>
                ) : isAndroidApp() ? null : (
                  <button className="mainAction" type="button" onClick={importSongs}>import songs</button>
                )}
              />
            )}
          </div>
        </section>

      </div>
      <DailyMixesShelf {...props.dailyMixes} />
      {smartDialog}
      {promptDialog}
    </section>
  );
}
