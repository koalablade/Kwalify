/**
 * Scene intelligence — canonical scenes, validation, prototypes (no genre graph).
 */

export { analyzeMomentPipeline } from "../../lib/moment-pipeline";
export {
  resolveCanonicalScene,
  resolveCanonicalSceneFull,
  type CanonicalSceneResult,
} from "../../lib/scene-canonicalizer";
export { resolveSceneContext, sceneMatchScore } from "../../lib/scene-validation";
export { getPrototype, type ScenePrototype } from "../../lib/scene-prototypes";
export { matchExperienceScene, applyExperienceScene } from "../../lib/scene-intelligence";
export { GENRE_SCENE_PRIORITY } from "../../lib/genre-scene-priority";
export {
  resolveSceneConflicts,
  trackViolatesSceneConflict,
  type SceneConflictContext,
} from "./scene-conflict-rules";
export {
  resolveSceneGenreRouting,
  scenePoolMultiplier,
  type SceneGenreRouting,
} from "./scene-genre-routing";
export {
  resolveContradiction,
  contradictionBridgeFit,
  type ContradictionProfile,
} from "./contradiction-handler";
