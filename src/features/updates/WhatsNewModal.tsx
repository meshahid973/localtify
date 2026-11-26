import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ExternalLink, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import Dialog from "../../shared/ui/Dialog";
import Button from "../../shared/ui/Button";
import { APP_VERSION } from "./update.constants";
import { releaseHistory, loadReleaseHistory, type ReleaseEntry } from "./releaseHistory";
import "./release-notes.css";

export type WhatsNewModalProps = {
  open: boolean;
  onClose: () => void;
  initialVersion?: string;
  availableReleaseNotes?: string;
};

export default function WhatsNewModal({ open, onClose, initialVersion, availableReleaseNotes }: WhatsNewModalProps) {
  const requestedVersion = initialVersion?.trim().replace(/^v/i, "") || APP_VERSION;
  const [version, setVersion] = useState(requestedVersion);
  const [history, setHistory] = useState(releaseHistory);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadReleaseHistory().then(items => { if (active) setHistory(items); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (open) setVersion(requestedVersion);
  }, [open, requestedVersion]);

  const releases = useMemo(() => {
    const entries = [...history];
    const index = entries.findIndex(entry => entry.version === requestedVersion);
    if (requestedVersion !== APP_VERSION) {
      const known = entries[index];
      const entry: ReleaseEntry = {
        ...known,
        version: requestedVersion,
        date: known?.date ?? null,
        notes: availableReleaseNotes?.trim() || known?.notes || "",
        published: true
      };
      if (index < 0) entries.unshift(entry);
      else entries[index] = entry;
    }
    return entries;
  }, [history, requestedVersion, availableReleaseNotes]);

  const release = releases.find(entry => entry.version === version);
  const installed = version === APP_VERSION;
  const available = !installed && version === requestedVersion;
  const date = release?.date;

  if (!open) return null;

  return (
    <Dialog open onClose={onClose} portal={false}
      backdropClassName="releaseNotesOverlay" className="releaseNotesDialog" labelledBy="releaseNotesTitle">
      <header className="releaseNotesHead">
        <span className="releaseNotesLabel">What's new</span>
        <div className="releaseNotesActions">
          <label className="releaseNotesVersionPicker">
            <select aria-label="Release version" value={version} onChange={event => setVersion(event.currentTarget.value)}>
              {releases.map(entry => (
                <option key={entry.version} value={entry.version}>
                  v{entry.version}{entry.version === APP_VERSION ? " · Installed" : entry.version === requestedVersion ? " · Available" : ""}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          <Button variant="ghost" size="icon" className="releaseNotesClose" aria-label="Close release notes" title="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <article className="releaseNotesContent" key={version} tabIndex={0} aria-labelledby="releaseNotesTitle">
        <div className="releaseNotesIntro">
          <div className="releaseNotesMeta">
            {installed ? <span><Check size={14} aria-hidden="true" /> Installed</span> : available ? <span>Available update</span> : <span>Release archive</span>}
            {date && <time dateTime={date}>{date}</time>}
          </div>
          <h2 id="releaseNotesTitle">Localtify <span>{version}</span></h2>
        </div>
        {release?.notes.trim() ? (
          <div className="releaseNotesMarkdown">
            <ReactMarkdown skipHtml urlTransform={url => /^https:\/\//i.test(url) ? url : ""}>{release.notes}</ReactMarkdown>
          </div>
        ) : (
          <p className="releaseNotesMissing">Release notes for this version aren't available yet.</p>
        )}
      </article>
      <footer className="releaseNotesFooter">
        {release?.sourceUrl && (
          <a href={release.sourceUrl} target="_blank" rel="noopener noreferrer">View on GitHub <ExternalLink size={13} aria-hidden="true" /></a>
        )}
        <Button onClick={onClose}>Done</Button>
      </footer>
    </Dialog>
  );
}
