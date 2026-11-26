import { forwardRef } from "react";
import { Button as BeuiButton, type ButtonProps } from "../../vendor/beui/button";
import { GlassButton } from "../../vendor/liquid-glass/glass-button";
import { controlOptics, useAppearance } from "./appearance";

export type { ButtonProps };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function AppearanceBeuiButton(props, ref) {
  const { kit } = useAppearance();
  return <GlassButton asChild optical={!!kit} material={props.variant === "primary" || !props.variant ? "tinted" : "clear"} tint={.34} pull={false}
    optics={controlOptics} className={kit ? "ltOpticalButton" : undefined}>
    <BeuiButton {...props} ref={ref} {...(kit ? { pressScale: 1, ripple: false, whileHover: undefined } : {})}/>
  </GlassButton>;
});
