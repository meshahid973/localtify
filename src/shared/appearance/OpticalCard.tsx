import type { ComponentPropsWithRef } from "react";
import { useAppearance } from "./appearance";

export const panelOptics = { borderAlpha: 0, frostMix: .55, rim: .28 };

export function OpticalCard(props: ComponentPropsWithRef<"div">) {
  const { kit } = useAppearance();
  return kit ? <kit.GlassCard {...props} className={`${props.className ?? ""} ltOpticalCard rounded-[inherit]`}
    tint={.52} blur={2} optics={panelOptics} /> : <div {...props} />;
}
