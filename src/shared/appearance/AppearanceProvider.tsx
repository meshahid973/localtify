import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppearanceContext, type GlassControls, type GlassKit } from "./appearance";

export function AppearanceProvider({ enabled, tone, reducedMotion, backgrounded, children }: {
  enabled: boolean;
  tone: "light" | "dark";
  reducedMotion: boolean;
  backgrounded: boolean;
  children: ReactNode;
}) {
  const [kit, setKit] = useState<GlassKit | null>(null);
  const [controls, setControls] = useState<GlassControls | null>(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [nativeVisible, setNativeVisible] = useState(true);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (!enabled) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { setVisible(!document.hidden); setSystemReduced(preference.matches); };
    sync();
    document.addEventListener("visibilitychange", sync);
    preference.addEventListener("change", sync);
    const unsubscribe = window.localitfy?.onWindowVisibility?.(setNativeVisible);
    return () => {
      unsubscribe?.();
      document.removeEventListener("visibilitychange", sync);
      preference.removeEventListener("change", sync);
    };
  }, [enabled]);
  const renderGlass = enabled && visible && nativeVisible && !backgrounded && !reducedMotion && !systemReduced;
  useEffect(() => {
    if (!renderGlass || kit) return;
    let active = true;
    void import("./glassKit").then(module => { if (active) setKit(module); }).catch(error => console.warn("Liquid Glass controls could not load", error));
    return () => { active = false; };
  }, [renderGlass, kit]);
  useEffect(() => {
    if (!renderGlass || !kit?.getGlassEngine() || controls) return;
    let active = true;
    void import("./glassControls").then(async module => {
      if (!active) return;
      await module.prepareGlassControls();
      if (active) setControls(module);
    }).catch(error => console.warn("Liquid Glass range controls could not load", error));
    return () => { active = false; };
  }, [renderGlass, kit, controls]);
  const value = useMemo(() => ({ enabled, tone, kit: renderGlass ? kit : null, controls: renderGlass ? controls : null }), [enabled, tone, renderGlass, kit, controls]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
