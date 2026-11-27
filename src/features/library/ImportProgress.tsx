import type { ImportAnimationState } from "./song.types";
import { Cover } from "../covers/Cover";
import { MascotStateArt } from "../../shared/ui/LocaltifyViewUi";
import { OpticalCard } from "../../shared/appearance/OpticalCard";
import "./import-progress.css";

export function ImportProgress({ state }: { state: ImportAnimationState }) {
  const importing = state.phase === "scanning";
  const failed = state.phase === "error";
  const added = state.count > 0;
  const title = importing ? "Import music" : failed ? "Couldn’t import music" : added ? "Import complete" : "No tracks added";
  return (
    <div className="importOverlay" data-active={state.active} role="status">
      {state.active ? <OpticalCard className="importPanel">
        <MascotStateArt className="importMascot" state={importing ? "loading" : failed ? "error" : added ? "happy" : "empty"} />
        <div className="importMessage">
          <h2>{title}</h2>
          {state.message ? <p>{state.message}</p> : null}
          {importing ? <progress className="importProgressBar" aria-label="Importing music" /> : null}
          {added && state.preview.length ? <ul className="importPreview" aria-label="New tracks">
            {state.preview.map(song => <li key={song.id} title={song.title}>
              <Cover song={song} className="importPreviewCover" priority="high" preferThumbnail />
              <span>{song.title}</span>
            </li>)}
          </ul> : null}
        </div>
      </OpticalCard> : null}
    </div>
  );
}
