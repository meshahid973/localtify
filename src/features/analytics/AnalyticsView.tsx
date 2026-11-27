import "./analytics.css";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import { isAndroidApp } from "../../app/platform";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Cover } from "../covers/Cover";
import { splitArtistCredits } from "../artists/artistCredits";
import { artistTarget, useAppActions } from "../shell/appActions";
import { formatAnalyticsDuration } from "./formatters";
import { isListeningCalendarSummary, type ListeningCalendarRange, type ListeningCalendarSummary } from "./listeningSummary";
import type { Song } from "../library/song.types";
import { LineChart, LineChartPlot, LineChartTooltip, type LineChartSeries } from "../../vendor/charts/line-chart";
import SegmentedControl from "../../vendor/arc/segmented-control/segmented-control";
import { AppearanceMenu } from "../../shared/appearance/AppearanceMenu";
import { OpticalButton } from "../../shared/appearance/OpticalButton";
import { useAppearance, controlOptics } from "../../shared/appearance/appearance";
import { GlassButtonGroup, GlassButtonGroupItem } from "../../vendor/liquid-glass/glass-button-group";

export type AnalyticsViewProps = {
  importSongs: () => unknown;
  songs: Song[];
  onSelectSong?: (id: string) => unknown;
  onRecapCopied: () => void;
};

const RANGE_OPTIONS = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" }
];
const monthLabel = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const readableDuration = (ms: number) => formatAnalyticsDuration(ms / 1000);
const calendarDate = (utc: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(new Date(utc));

function listeningPeriodName(summary: ListeningCalendarSummary) {
  if (summary.range === "year") return calendarDate(summary.startAt, { year: "numeric" });
  if (summary.range === "month") return calendarDate(summary.startAt, { month: "long", year: "numeric" });
  return calendarDate(summary.startAt, { month: "short", day: "numeric", year: "numeric" }) +
    " – " + calendarDate(summary.endAt - 1, { month: "short", day: "numeric" });
}

function breakdown(songs: Song[], summary: ListeningCalendarSummary | null) {
  if (!summary) return { topSongs: [], topArtists: [] };
  const byId = new Map(songs.map(song => [song.id, song]));
  const topSongs = (summary?.bySong || []).slice(0, 5).map(({ id, ms }) => ({ song: byId.get(id) || null, id, ms }));
  const artists = new Map<string, { name: string; ms: number; song: Song | null }>();
  for (const entry of summary?.bySong || []) {
    const song = byId.get(entry.id);
    if (!song) continue;
    const credits = splitArtistCredits(song.artist);
    // Split an event's duration between credited artists so the rankings never invent extra time.
    let allocated = 0;
    credits.forEach((name, i) => {
      const amount = i === credits.length - 1 ? entry.ms - allocated : Math.floor(entry.ms / credits.length);
      allocated += amount;
      const key = name.toLocaleLowerCase();
      const existing = artists.get(key);
      artists.set(key, { name: existing?.name || name, ms: (existing?.ms || 0) + amount, song: existing?.song || song });
    });
  }
  const topArtists = [...artists.values()].sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name)).slice(0, 5);
  return { topSongs, topArtists };
}

export default function AnalyticsView({
  songs, importSongs, onSelectSong, onRecapCopied
}: AnalyticsViewProps) {
  const actions = useAppActions();
  const { kit } = useAppearance();
  const [range, setRange] = useState<ListeningCalendarRange>("month");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState<ListeningCalendarSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [uncopiedRecap, setUncopiedRecap] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setSummary(null);
    window.localitfy.getListeningCalendarSummary({ range, offset })
      .then(value => {
        if (!active) return;
        if (isListeningCalendarSummary(value, { range, offset })) setSummary(value);
        else setFailed(true);
      })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, offset, revision]);

  const insight = useMemo(() => breakdown(songs, summary), [songs, summary]);
  // Calendar months can differ in length; never discard previous-month dates or invent zero-valued days.
  const categories = useMemo(() => {
    if (!summary) return [];
    const length = Math.max(summary.byBucket.length, summary.comparison.byBucket.length);
    return Array.from({length}, (_, index) =>
      summary.range === "year"
        ? monthLabel.format(new Date(Date.UTC(2024,index,1)))
        : summary.range === "week" ? ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][index]
          : "Day " + (index + 1));
  }, [summary]);
  const series = useMemo<LineChartSeries[]>(() => {
    if (!summary) return [];
    return [
      { id:"current",name:"This period",color:"var(--lt-accent)",
        values:categories.map((_,index)=>summary.byBucket[index] ? summary.byBucket[index].ms/60000 : null) },
      { id:"previous",name:"Previous period",color:"var(--lt-muted)",
        values:categories.map((_,index)=>summary.comparison.byBucket[index] ? summary.comparison.byBucket[index].ms/60000 : null) }
    ];
  }, [summary,categories]);

  function selectRange(value: string) {
    if (value === "week" || value === "month" || value === "year") {
      setRange(value);
      setOffset(0);
    }
  }
  async function copyRecap() {
    if (!summary) return;
    const lines = [
      "Localtify listening recap — " + listeningPeriodName(summary),
      "Recorded listening: " + readableDuration(summary.totalMs),
      "Sessions: " + summary.sessions.toLocaleString(),
      "Active days: " + summary.activeDays.toLocaleString(),
      ...insight.topSongs.slice(0, 3).map((entry, i) => (i + 1) + ". " + (entry.song?.title || "Unavailable track") + " — " + readableDuration(entry.ms))
    ];
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setUncopiedRecap("");
      onRecapCopied();
    } catch {
      setUncopiedRecap(text);
    }
  }

  return <section data-page-section="analytics" className="analyticsExperienceV4" aria-label="Listening analytics">
    <PageHeader title="Analytics" />
      <div className="analyticsV4Controls">
        {kit ? <kit.GlassTabs size="sm" options={RANGE_OPTIONS} value={range} onValueChange={selectRange} aria-label="Listening period"
          className="ltOpticalTabs" highlightClassName="ltOpticalTabSelection" /> :
          <SegmentedControl options={RANGE_OPTIONS} value={range} onValueChange={selectRange} label="Listening period" />}
        <GlassButtonGroup optical={!!kit} size="sm" material="clear" tint={.48} optics={controlOptics} backdrop=".app"
          className={kit ? "analyticsV4PeriodNav ltOpticalHistory" : "analyticsV4PeriodNav"} aria-label="Navigate listening periods">
          <GlassButtonGroupItem aria-label="Previous period" onClick={() => setOffset(value => Math.min(120, value + 1))} disabled={offset === 120}><ChevronLeft size={18} aria-hidden="true" /></GlassButtonGroupItem>
          <span>{summary ? listeningPeriodName(summary) : "Selected period"}</span>
          <GlassButtonGroupItem aria-label="Next period" onClick={() => setOffset(value => Math.max(0, value - 1))} disabled={offset === 0}><ChevronRight size={18} aria-hidden="true" /></GlassButtonGroupItem>
        </GlassButtonGroup>
        <AppearanceMenu icon={<Ellipsis size={18}/>} iconOnly label="Analytics options" items={[
          { label: "Refresh listening history", onSelect: () => setRevision(value => value + 1) },
          { label: "Copy listening recap", onSelect: copyRecap, disabled: !summary },
          { label: "Open library", onSelect: () => actions.nav.go("library") }
        ]} />
      </div>
    {uncopiedRecap ? <div className="analyticsV4Recap">
      <p role="status">Couldn’t copy the listening recap. You can select and copy it below.</p>
      <textarea aria-label="Listening recap" readOnly value={uncopiedRecap} rows={6}
        onFocus={event => event.currentTarget.select()} />
      <OpticalButton type="button" onClick={() => setUncopiedRecap("")}>Dismiss</OpticalButton>
    </div> : null}
    {!songs.length ? <div className="analyticsV4EmptyLibrary" role="status">
      <span>{isAndroidApp() ? "Sync your music library." : "Import music to get started."}</span>
      {!isAndroidApp() ? <OpticalButton type="button" onClick={importSongs}>Import music</OpticalButton> : null}
    </div> : null}

    {loading ? <div className="analyticsV4Loading" role="status">Loading…</div> :
      failed || !summary ? <div className="analyticsV4Notice" role="status">
        <p>Listening history unavailable.</p>
        <OpticalButton type="button" onClick={() => setRevision(value => value + 1)}>Try again</OpticalButton>
      </div> : <>
        <div className="analyticsV4Overview">
          <div className="analyticsV4Total">
            <span>Listening time</span>
            <strong>{readableDuration(summary.totalMs)}</strong>
            <small>{listeningPeriodName(summary)}{summary.partial ? " · period in progress" : ""}</small>
          </div>
          <div className="analyticsV4Metrics">
            <div><strong>{summary.sessions.toLocaleString()}</strong><span>Listening events</span></div>
            <div><strong>{summary.activeDays.toLocaleString()}</strong><span>Active days</span></div>
            <div>
              <strong>{summary.comparison.changePercent === null ? "—" : (summary.comparison.changePercent > 0 ? "+" : "") + summary.comparison.changePercent.toFixed(1) + "%"}</strong>
              <span>{summary.comparison.changePercent === null ? "No previous baseline" : summary.partial ? "Vs previous period to date" : "Vs previous period"}</span>
            </div>
          </div>
        </div>

        <section className="analyticsV4History" aria-label="Listening history">
          <div className="analyticsV4SectionHeading"><h2>Listening history</h2><p>Minutes · UTC</p></div>
          {summary.totalMs || summary.comparison.totalMs ? (
            <div className="analyticsV4Chart">
              <LineChart
                series={series}
                categories={categories}
                variant="area"
                label={"Recorded listening time for " + listeningPeriodName(summary)}
                formatValue={value => formatAnalyticsDuration(value * 60)}
                formatTick={value => formatAnalyticsDuration(value * 60)}
              >
                <LineChartPlot height={218} />
                <LineChartTooltip />
              </LineChart>
              <div className="analyticsV4ChartLegend" aria-label="Chart series"><span>This period</span><span>Previous period</span></div>
            </div>
          ) : <p className="analyticsV4Empty">No listening history.</p>}
        </section>

        <div className="analyticsV4Rankings">
          <section className="analyticsV4Ranking" aria-label="Top tracks">
            <h2>Top tracks</h2>
            {insight.topSongs.length ? <ol>{insight.topSongs.map(({id,song,ms},index) => <li key={id}>
              <span className="analyticsV4Rank">{index+1}</span>
              <Cover song={song} className="analyticsV4Artwork" preferThumbnail />
              <div className="analyticsV4TrackName">
                {song && onSelectSong ? <button type="button" onClick={() => onSelectSong(song.id)} title={"Play " + song.title}>{song.title}</button> : <strong>{song?.title || "Unavailable track"}</strong>}
                <span>{song?.artist || "No longer in the library"}</span>
              </div>
              <span className="analyticsV4Duration">{readableDuration(ms)}</span>
            </li>)}</ol> : <p className="analyticsV4Empty">No tracks yet.</p>}
          </section>
          <section className="analyticsV4Ranking" aria-label="Top artists">
            <h2>Top artists</h2>
            {insight.topArtists.length ? <ol>{insight.topArtists.map(({name,ms,song},index) => <li key={name}>
              <span className="analyticsV4Rank">{index+1}</span>
              <Cover song={song} className="analyticsV4Artwork analyticsV4ArtistArtwork" preferThumbnail />
              <div className="analyticsV4TrackName">
                <button type="button" title={"Open " + name} onClick={() => actions.openCollection(artistTarget(name, songs.filter(track => splitArtistCredits(track.artist).some(credit => credit.toLocaleLowerCase() === name.toLocaleLowerCase()))))}>{name}</button>
                <span>Artist</span>
              </div>
              <span className="analyticsV4Duration">{readableDuration(ms)}</span>
            </li>)}</ol> : <p className="analyticsV4Empty">No artists yet.</p>}
          </section>
        </div>
      </>}

  </section>;
}
