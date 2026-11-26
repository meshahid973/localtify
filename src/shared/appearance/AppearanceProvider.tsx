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
  const controlModule = useRef<GlassControls | null>(null);
  useEffect(() => {
    if (!renderControls || !kit?.getGlassEngine()) return;
    let active = true, attempts = 0, generation = 0;
    let retry: number | undefined;
    let unsubscribe: (() => void) | undefined;
    const start = async () => {
      const attempt = ++generation;
      try {
        const module = await import("./glassControls");
        if (!active || attempt !== generation) return;
        controlModule.current = module;
        unsubscribe ??= module.onGlassControlsLoss(failed);
        const runtime = await module.prepareGlassControls();
        if (!active || attempt !== generation) { runtime.trim(); return; }
        trimControls.current = runtime.trim;
        setControls(module);
      } catch (error) {
        if (active && attempt === generation) { console.warn("Liquid Glass range controls could not load", error); failed(); }
      }
    };
    function failed() {
      if (!active) return;
      generation++;
      setControls(null);
      trimControls.current = null;
      if (attempts++ === 0) retry = window.setTimeout(() => void start(), 250);
    }
    void start();
    return () => {
      active = false;
      unsubscribe?.();
      window.clearTimeout(retry);
      trimControls.current?.();
    };
  }, [renderControls, kit]);
  useEffect(() => {
    if (!renderGlass) kit?.trimGlassEngine();
    if (!renderControls) trimControls.current?.();
    if (!enabled) {
      controlModule.current?.disposeGlassRuntime();
      trimControls.current = null;
      setControls(null);
      kit?.disposeGlassEngine();
    }
  }, [enabled, kit, renderGlass, renderControls]);
  const value = useMemo(() => ({ enabled, tone, kit: renderGlass ? kit : null, controls: renderControls ? controls : null }), [enabled, tone, renderGlass, renderControls, kit, controls]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
