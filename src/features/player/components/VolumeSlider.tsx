import { memo, useEffect, useRef } from "react";
import { useAppearance } from "../../../shared/appearance/appearance";
import { Slider } from "../../../shared/ui/Slider";
import type { PlayerBarProps } from "./PlayerBar";

type VolumeState = Pick<PlayerBarProps,
  "commitVolume" | "previewVolume" | "volumeDraft" | "volumeDraftRef" |
  "volumeRangeStyle" | "setIsVolumeDragging" | "isVolumeDragging">;

type VolumeSliderProps = {
  player: VolumeState;
  label: string;
  optical?: boolean;
};

export function VolumeSlider({ player, label, optical = true }: VolumeSliderProps) {
  const { controls } = useAppearance();
  const { volumeDraft, volumeRangeStyle, previewVolume, commitVolume, setIsVolumeDragging, isVolumeDragging, volumeDraftRef } = player;
  if (controls && optical) return <OpticalVolumeSlider label={label} volumeDraft={volumeDraft}
    volumeDraftRef={volumeDraftRef} previewVolume={previewVolume}
    commitVolume={commitVolume} setIsVolumeDragging={setIsVolumeDragging} />;
  return <Slider min="0" max="100" step="1" value={volumeDraft} style={volumeRangeStyle} aria-label={label}
    onPointerDown={event => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setIsVolumeDragging(true);
      previewVolume(event.currentTarget.value, event.currentTarget);
    }}
    onInput={event => previewVolume(event.currentTarget.value, event.currentTarget)}
    onChange={event => previewVolume(event.currentTarget.value, event.currentTarget)}
    onPointerUp={event => {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      commitVolume(event.currentTarget.value);
    }}
    onPointerCancel={event => commitVolume(event.currentTarget.value)}
    onKeyUp={event => commitVolume(event.currentTarget.value)}
    onBlur={event => { if (isVolumeDragging) commitVolume(event.currentTarget.value); }} />;
}

type OpticalVolumeProps = Omit<VolumeState, "volumeRangeStyle" | "isVolumeDragging"> & { label: string };

const OpticalVolumeSlider = memo(function OpticalVolumeSlider({
  label, volumeDraft, volumeDraftRef, previewVolume, commitVolume, setIsVolumeDragging,
}: OpticalVolumeProps) {
  const { controls, tone } = useAppearance();
  const dragging = useRef(false);

  useEffect(() => () => {
    if (dragging.current) commitVolume(String(volumeDraftRef.current));
  }, [commitVolume, volumeDraftRef]);

  function finishDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    commitVolume(String(volumeDraftRef.current));
  }

  if (!controls) return null;
  return <div className="ltOpticalVolume" onPointerDownCapture={event => {
    if (!event.isPrimary || event.button !== 0 || !(event.target as Element).closest('[data-slot="slider-track"]')) return;
    dragging.current = true;
    volumeDraftRef.current = volumeDraft;
    setIsVolumeDragging(true);
  }} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
    <controls.RangeSlider label={label} value={volumeDraft} min={0} max={100} step={1}
      size="sm" theme={tone} showValue={false} color={tone === "light" ? "#303037" : "#777782"}
      onChange={next => {
        if (dragging.current) previewVolume(String(next));
        else commitVolume(String(next));
      }} />
  </div>;
});
