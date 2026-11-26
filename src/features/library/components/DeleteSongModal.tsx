import { prettyTitle } from "../../search";
import { useAppearance } from "../../../shared/appearance/appearance";
import { OpticalButton } from "../../../shared/appearance/OpticalButton";
import Dialog from "../../../shared/ui/Dialog";
import type { Song } from "../song.types";

export type DeleteSongModalProps = {
  song: Song | null;
  busy: boolean;
  onClose: () => void;
  removeSong: (songId: string) => unknown;
};

export default function DeleteSongModal({ song, busy, onClose, removeSong }: DeleteSongModalProps) {
  const { kit } = useAppearance();
  if (!song) return null;
  return (
    <Dialog open onClose={onClose} dismissible={!busy} portal={false} animated={false}
      backdropClassName="modalWrap deleteModalWrap" className="deleteModal cartoonPop"
      role="alertdialog" labelledBy="delete-song-dialog-title" describedBy="delete-song-dialog-description">
        <div className="deleteFace">:(</div>
        <p className="deleteTiny">remove from localtify</p>
        <h3 id="delete-song-dialog-title">remove <span>"{prettyTitle(song.title, 8)}"</span> from localtify?</h3>
        <p className="deleteSub" id="delete-song-dialog-description">this only removes it from your localtify library.<br />your real music file stays safe on your pc.</p>
        <div className="deleteActions">
          <OpticalButton type="button" className="heroGhost" onClick={onClose} disabled={busy}>no keep it</OpticalButton>
          <OpticalButton type="button" primary className="dangerButton bigDanger" onClick={() => removeSong(song.id)} disabled={busy}>{busy ? "removing..." : "yes remove it"}</OpticalButton>
        </div>
        {kit && <kit.GlassSlideToConfirm disabled={busy} size="sm" onConfirm={() => removeSong(song.id)}
          pendingLabel="Removing track" successLabel="Removed" className="ltOpticalConfirm">Slide to remove track</kit.GlassSlideToConfirm>}
    </Dialog>
  );
}
