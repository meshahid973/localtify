import type { ComponentPropsWithRef } from "react";
import { controlOptics, useAppearance } from "./appearance";

export function OpticalButton({ primary, ...props }: ComponentPropsWithRef<"button"> & { primary?: boolean }) {
  const { kit } = useAppearance();
  const button = <button {...props} />;
  return kit ? <kit.GlassButton asChild material={primary ? "tinted" : "clear"} tint={.36} pull={false}
    optics={controlOptics} backdrop=".ltOpticalCard, .pageTransition, .playerBar, .immersivePlayer, .phonePlayerSheet, .app"
    className="ltOpticalButton">{button}</kit.GlassButton> : button;
}
