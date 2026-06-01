/**
 * Scene vs genre priority — genre is HARD; scene modulates energy/context only.
 */

import type { TrackGenreClassification } from "./genre-taxonomy";
import { isGenreLocked } from "./genre-taxonomy";

/** Strict processing order for playlist generation */
export const GENRE_SCENE_PRIORITY = [
  "genre_family",
  "subgenre",
  "scene_context",
  "emotion",
  "surprise_discovery",
] as const;

/**
 * Scene may adjust energy/valence/narrative — never primary genre family.
 */
export function sceneMayModifyEnergy(
  classification: TrackGenreClassification,
  sceneStrength: number
): boolean {
  if (isGenreLocked(classification)) return sceneStrength < 0.4;
  return sceneStrength < 0.85;
}

export function sceneCannotChangeGenreFamily(): true {
  return true;
}
