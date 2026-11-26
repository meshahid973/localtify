import type { ComponentPropsWithRef } from "react";
import "./icon-button.css";
import { GlassDecoration, useAppearance } from "../appearance/appearance";

type IconButtonProps = ComponentPropsWithRef<"button"> & { "aria-label": string };

/** Shared keyboard, touch and tooltip treatment; feature classes own geometry. */
export function IconButton({ className = "", type = "button", title, children, ...props }: IconButtonProps) {
  const { kit } = useAppearance();
  return <button {...props} type={type} className={`ltIconButton ${className}`} title={title ?? props["aria-label"]} data-glass-host={kit ? "" : undefined}>
    <GlassDecoration />{children}
  </button>;
}
