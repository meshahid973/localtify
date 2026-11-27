import { createContext, useContext } from "react";

export type GlassKit = typeof import("./glassKit");
export type GlassControls = typeof import("./glassControls");
export const AppearanceContext = createContext<{
  enabled: boolean;
  tone: "light" | "dark";
  kit: GlassKit | null;
  controls: GlassControls | null;
}>({ enabled: false, tone: "dark", kit: null, controls: null });

export const useAppearance = () => useContext(AppearanceContext);

export { localtifyOptics as controlOptics } from "../../vendor/liquid-glass/localtify-optics";
