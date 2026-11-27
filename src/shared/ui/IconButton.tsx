import type { ComponentPropsWithRef } from "react";
import "./icon-button.css";
import { OpticalButton } from "../appearance/OpticalButton";

type IconButtonProps = ComponentPropsWithRef<"button"> & { "aria-label": string };

/** Shared keyboard, touch and tooltip treatment; feature classes own geometry. */
export function IconButton({ className = "", type = "button", title, children, ...props }: IconButtonProps) {
  return <OpticalButton {...props} type={type} className={`ltIconButton ${className}`} title={title ?? props["aria-label"]}>
    {children}
  </OpticalButton>;
}
