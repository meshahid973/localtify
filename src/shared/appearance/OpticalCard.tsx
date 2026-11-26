import type { ComponentPropsWithRef } from "react";
import { GlassCard } from "../../vendor/liquid-glass/glass-card";
import { useAppearance } from "./appearance";

export const panelOptics = { borderAlpha: 0, borderWidth: 0, frostMix: .55, rim: .18, dark: { borderAlpha: 0, borderWidth: 0 } };

export function OpticalCard(props: ComponentPropsWithRef<"div">) {
  const { kit } = useAppearance();
  return <GlassCard {...props} optical={!!kit} className={kit ? `${props.className ?? ""} ltOpticalCard rounded-[inherit]` : props.className}
    tint={.52} blur={2} optics={panelOptics} />;
}
