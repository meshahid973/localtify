import type { ComponentPropsWithRef } from "react";
import { GlassButton } from "../../vendor/liquid-glass/glass-button";
import { controlOptics, useAppearance } from "./appearance";

export function OpticalButton({ primary, ...props }: ComponentPropsWithRef<"button"> & { primary?: boolean }) {
  const { kit } = useAppearance();
  return <GlassButton asChild optical={!!kit} material={primary ? "tinted" : "clear"} tint={.36} pull={false}
    optics={controlOptics} backdrop=".ltOpticalCard, .pageTransition, .playerBar, .immersivePlayer, .phonePlayerSheet, .app"
    className={kit ? "ltOpticalButton" : undefined}><button {...props} /></GlassButton>;
}
