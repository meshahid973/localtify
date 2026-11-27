import { useAppearance } from "../../shared/appearance/appearance";
import type { View } from "./view.types";

const sections = [
  { value: "library", label: "Songs" }, { value: "albums", label: "Albums" },
  { value: "artists", label: "Artists" }, { value: "genres", label: "Genres" },
  { value: "playlists", label: "Playlists" }, { value: "liked", label: "Liked" },
] as const;

export function LibrarySectionNavigation({ view, go }: { view: View; go: (view: View) => void }) {
  const { kit } = useAppearance();
  const selected = sections.find(section => section.value === view)?.value ?? null;
  return <nav className="librarySectionNav" aria-label="Library sections">
    {kit ? <kit.GlassTabs aria-label="Library view" value={selected} options={sections} onValueChange={go} size="sm"
      itemProps={value => ({ "data-library-section": value, "aria-current": view === value ? "page" : undefined })}
      className="ltOpticalTabs" highlightClassName="ltOpticalTabSelection" /> :
      sections.map(({ value, label }) => <button key={value} type="button" data-library-section={value}
        aria-current={view === value ? "page" : undefined} onClick={() => go(value)}>{label}</button>)}
  </nav>;
}
