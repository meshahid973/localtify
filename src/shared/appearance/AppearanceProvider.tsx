import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppearanceContext, type GlassControls, type GlassKit } from "./appearance";

export function AppearanceProvider({ enabled, tone, reducedMotion, backgrounded, controlsNeeded = true, children }: {
  enabled: boolean;
  tone: "light" | "dark";
  reducedMotion: boolean;
  backgrounded: boolean;
  controlsNeeded?: boolean;
  children: ReactNode;
}) {
  const [kit, setKit] = useState<GlassKit | null>(null);
  const [controls, setControls] = useState<GlassControls | null>(null);
  const trimControls = useRef<(() => void) | null>(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [nativeVisible, setNativeVisible] = useState(true);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [contextLost, setContextLost] = useState(false);
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
  useEffect(() => {
    setContextLost(false);
    if (!enabled || !kit) return;
    let retried = false;
    let retry: number | undefined;
    const unsubscribe = kit.onGlassContextLoss(() => {
      setContextLost(true);
      if (retried) return;
      retried = true;
      retry = window.setTimeout(() => setContextLost(false), 250);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(retry);
    };
  }, [enabled, kit]);
  const renderGlass = enabled && visible && nativeVisible && !backgrounded && !reducedMotion && !systemReduced && !contextLost;
  const renderControls = renderGlass && controlsNeeded;
  useEffect(() => {
    if (!renderGlass || kit) return;
    let active = true;
    void import("./glassKit").then(module => { if (active) setKit(module); }).catch(error => console.warn("Liquid Glass controls could not load", error));
    return () => { active = false; };
  }, [renderGlass, kit]);
  useEffect(() => {
    if (!renderControls || !kit?.getGlassEngine() || controls) return;
    let active = true;
    void import("./glassControls").then(async module => {
      if (!active) return;
      const runtime = await module.prepareGlassControls();
      trimControls.current = runtime.trim;
      if (!active) runtime.trim();
      if (active) setControls(module);
    }).catch(error => console.warn("Liquid Glass range controls could not load", error));
    return () => { active = false; };
  }, [renderControls, kit, controls]);
  useEffect(() => {
    if (!renderGlass) kit?.trimGlassEngine();
    if (!renderControls) trimControls.current?.();
  }, [kit, renderGlass, renderControls]);
  const value = useMemo(() => ({ enabled, tone, kit: renderGlass ? kit : null, controls: renderControls ? controls : null }), [enabled, tone, renderGlass, renderControls, kit, controls]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
