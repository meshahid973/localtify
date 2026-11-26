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

export const controlOptics = { cursorLight: false, mirror: 0, light: .52, rim: .26, inner: .4, reflection: .25, shadow: .28 };
