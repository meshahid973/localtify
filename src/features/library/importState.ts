import type { ImportAnimationState } from "./song.types";
export function createImportAnimationState(patch: Partial<ImportAnimationState> = {}): ImportAnimationState {
  return { active:false, phase:"idle", message:"", count:0, preview:[], ...patch };
}
