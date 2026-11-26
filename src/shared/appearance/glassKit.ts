export * from "../../vendor/liquid-glass";
export * from "../../vendor/liquid-glass/glass-select";
export * from "../../vendor/liquid-glass/glass-menu";
export * from "../../vendor/liquid-glass/glass-popover";
export * from "../../vendor/liquid-glass/glass-dropdown-menu";
import { disposeGlassEngine as disposeEngine } from "../../vendor/liquid-glass/engine";
import { releaseGlassSnapshots } from "../../vendor/liquid-glass/dom-snapshot";
export { getGlassEngine, onGlassContextLoss, trimGlassEngine } from "../../vendor/liquid-glass/engine";
export function disposeGlassEngine() {
  disposeEngine();
  releaseGlassSnapshots();
}
