import { useEffect, useMemo, useRef, useState } from "react";
import PlaylistComposer, { ComposerButton } from "./PlaylistComposer";
import FadeContent from "../../../vendor/react-bits/FadeContent";
import { Play, RefreshCw, Save, WandSparkles, ArrowUpRight } from "lucide-react";
import { Cover } from "../../covers/Cover";
import type { Song } from "../../library/song.types";
import { prettyMeta, prettyTitle } from "../../search";
import { formatTime } from "../../../shared/utils/format";
import { artistKey, songArtistKeys } from "../playlistRecommendations";
import { buildPromptPlaylist, describePrompt, parsePrompt, planHasLibraryTerms, promptVocabulary, type PromptPlan } from "../promptPlaylist";

export type PromptPlaylistDialogProps = {
  songs: Song[];
  currentId: string;
  hidden: (song: Song) => boolean;
  playSongs: (ids: string[], label: string) => unknown;
  selectSong: (id: string, autoplay?: boolean) => unknown;
  savePlaylist: (name: string, ids: string[]) => Promise<string | null>;
  openAnalysisSettings: () => void;
  onClose: () => void;
};

const EXAMPLES = ["chill songs for studying", "upbeat songs for a party, 1 hour", "liked songs I haven't played in a while", "my most played hip hop"];
type SoundState = "used" | "model-missing" | "no-profiles" | "error" | null;
type Result = { plan: PromptPlan; ids: string[]; sound: SoundState };

export default function PromptPlaylistDialog({ songs, currentId, hidden, playSongs, selectSong, savePlaylist, openAnalysisSettings, onClose }: PromptPlaylistDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [name, setName] = useState("");
  const seed = useRef(1);
  const request = useRef<string | null>(null);
  const savingRef = useRef(false);
  const cancel = () => {
    const id = request.current;
    request.current = null;
    if (id) void window.localitfy.cancelRecommendation?.(id).catch(() => undefined);
  };
  useEffect(() => () => {
    const id = request.current;
    request.current = null;
    if (id) void window.localitfy.cancelRecommendation?.(id).catch(() => undefined);
  }, []);
  function changePrompt(value: string) {
    cancel();
    setPrompt(value);
    setResult(null);
    setSelected(new Set());
    setLoading(false);
  }
  const vocabulary = useMemo(() => promptVocabulary(songs), [songs]);
  const songsById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);

  async function generate(text: string, again = false) {
    if (!text.trim() || savingRef.current) return;
    cancel();
    const token = crypto.randomUUID();
    request.current = token;
    seed.current = again ? seed.current + 1 : 1;
    setLoading(true);
    setResult(null);
    const plan = parsePrompt(text, vocabulary);
    let sound: Map<string, number> | undefined;
    let soundState: SoundState = null;
    if (plan.sound) {
      try {
        const scored = await window.localitfy.scorePromptSound({ text: plan.sound, requestId: token });
        if (scored.status === "ready") { sound = new Map(scored.scores); soundState = "used"; }
        else soundState = scored.status;
      } catch { soundState = "error"; }
    }
    if (token !== request.current) return;
    let similar: Map<string, number> | undefined;
    if (plan.similarTo.length) {
      const names = new Set(plan.similarTo.map(artistKey));
      const seeds = songs.filter((song) => song.fileExists !== false && songArtistKeys(song).some((key) => names.has(key)));
      try {
        const found = seeds.length ? await window.localitfy.findSimilarSongs({ songIds: seeds.slice(0, 2000).map((song) => song.id), seedKey: "prompt", limit: 50, requestId: token }) : null;
        if (found?.status === "ready") similar = new Map(found.matches.map((match) => [match.songId, match.score]));
      } catch { /* Falls back to shared artists and genres. */ }
    }
    if (token !== request.current) return;
    // A description alone can't be matched without the prompt model; don't pass off random songs as a result.
    const ids = sound || planHasLibraryTerms(plan) ? buildPromptPlaylist(plan, songs, { sound, similar, hidden, seed: seed.current }) : [];
    setResult({ plan, ids, sound: plan.sound ? soundState : null });
    setSelected(new Set(ids));
    if (!again) setName(plan.name);
    request.current = null;
    setLoading(false);
  }

  const picked = result ? result.ids.filter(id => selected.has(id) && songsById.get(id) && songsById.get(id)?.fileExists !== false) : [];
  const seconds = picked.reduce((total, id) => total + (Number(songsById.get(id)?.duration) || 0), 0);
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const notice = !result ? null : result.sound === "model-missing" ? (
    result.ids.length ? `Matching by sound is off, so “${result.plan.sound}” was only used for names and genres.`
      : "Sound matching needs the prompt model. Try an artist or genre."
  ) : result.sound === "no-profiles" ? "Analyze your library for sound matching."
    : result.sound === "error" ? "Couldn't compare the description with your music. Try again."
    : !result.ids.length ? "Nothing in your library matches that. Try fewer or different words." : null;

  return (
    <PlaylistComposer kind="prompt" title="Describe a playlist" description="Find songs in your library that fit your idea." onClose={onClose} busy={saving}>
      <div className="playlistComposerBody" inert={saving}>
        <form className="playlistPromptBox" onSubmit={event => { event.preventDefault(); void generate(prompt); }}>
          <textarea autoFocus aria-label="Prompt" value={prompt} onChange={event => changePrompt(event.currentTarget.value)}
            maxLength={300} rows={3} placeholder="Late-night music, songs like my favourites, or a 30-minute mix…" />
          <div className="playlistPromptBar">
            <span className="playlistComposerHint">{prompt.length}/300</span>
            <ComposerButton variant="primary" type="submit" disabled={!prompt.trim() || loading}>
              <WandSparkles size={16}/>{loading ? "Finding songs…" : "Generate playlist"}
            </ComposerButton>
          </div>
        </form>
        {!result ? <div className="playlistComposerExamples">
          <span className="playlistComposerHint">Try an idea</span>
          <div className="playlistComposerChips">{EXAMPLES.map(example =>
            <ComposerButton key={example} variant="ghost" size="sm" disabled={loading} onClick={() => { changePrompt(example); void generate(example); }}>
              {example}<ArrowUpRight size={12}/>
            </ComposerButton>)}</div>
        </div> : <div className="playlistComposerResults">
          <FadeContent trigger="mount" effect="fade" duration={180} initialOpacity={0}>
            <ul className="promptPlaylistUnderstood" aria-label="Understood as">
              {describePrompt(result.plan, result.sound === "used").map(label => <li key={label}>{label}</li>)}
            </ul>
          </FadeContent>
          {notice ? <p className="promptPlaylistNotice" role="status">{notice}
            {result.sound === "model-missing" || result.sound === "no-profiles" ?
              <ComposerButton size="sm" variant="ghost" onClick={openAnalysisSettings}>Open analysis settings</ComposerButton> : null}
          </p> : null}
          {result.ids.length > 0 ? <>
            <div className="playlistComposerLine">
              <strong>{picked.length} of {result.ids.length} songs · {formatTime(seconds)}</strong>
              <ComposerButton size="sm" variant="ghost" onClick={() => setSelected(new Set(picked.length === result.ids.length ? [] : result.ids))}>
                {picked.length === result.ids.length ? "Select none" : "Select all"}
              </ComposerButton>
            </div>
            <ol className="promptPlaylistList">
              {result.ids.map(id => {
                const song = songsById.get(id);
                if (!song) return null;
                return <li key={id} className="promptPlaylistRow" data-current={currentId === id}>
                  <label><input type="checkbox" disabled={song.fileExists === false} checked={selected.has(id) && song.fileExists !== false} onChange={() => toggle(id)}/>
                    <Cover song={song} className="playlistRecommendationCover" preferThumbnail/>
                    <span className="playlistTrackText"><strong>{prettyTitle(song.title)}</strong><small>{prettyMeta(song.artist)}</small></span>
                  </label>
                  <span className="playlistTrackDuration">{formatTime(song.duration)}</span>
                  <ComposerButton variant="ghost" size="icon" aria-label={`Play ${song.title}`} disabled={song.fileExists === false} onClick={() => void selectSong(id,true)}><Play size={14}/></ComposerButton>
                </li>;
              })}
            </ol>
          </> : null}
        </div>}
      </div>
      {result?.ids.length ? <footer className="playlistComposerFooter">
        <label className="playlistComposerField"><span>Playlist name</span><input disabled={saving} value={name} onChange={event => setName(event.currentTarget.value)} maxLength={120} placeholder="Playlist name"/></label>
        <div className="playlistComposerActions">
          <ComposerButton variant="ghost" disabled={loading || saving} onClick={() => void generate(prompt,true)}><RefreshCw size={15}/> Regenerate</ComposerButton>
          <ComposerButton disabled={!picked.length || saving || loading} onClick={() => playSongs(picked,name || result.plan.name)}><Play size={15}/> Play</ComposerButton>
          <ComposerButton variant="primary" disabled={!picked.length || loading || saving} onClick={async () => { if (savingRef.current) return; savingRef.current = true; setSaving(true); try { if (await savePlaylist(name || result.plan.name,picked)) onClose(); } finally { savingRef.current = false; setSaving(false); } }}><Save size={15}/> {saving ? "Saving…" : "Save playlist"}</ComposerButton>
        </div>
      </footer> : null}
    </PlaylistComposer>
  );
}
