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

const surfaceOptics = { cursorLight: false, mirror: 0, rim: .7, shadow: .45 };

export function GlassDecoration({ surface = false, tinted = false, backdrop }: { surface?: boolean; tinted?: boolean; backdrop?: string }) {
  const { kit } = useAppearance();
  return kit ? <kit.GlassLayer material={tinted ? "tinted" : "clear"} pull={false}
    swell={!surface} tint={surface ? .76 : .38} blur={surface ? 3 : undefined}
    optics={surface ? surfaceOptics : undefined} backdrop={backdrop} /> : null;
}
