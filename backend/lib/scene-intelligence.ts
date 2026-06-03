import type { EmotionProfile } from "./emotion";
import type { JourneyArc } from "./emotion-destination";
import { SCENE_LIBRARY } from "./scene-library";
import type { SceneEntry, SceneMatch } from "./scene-types";

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Find the best human-experience scene for this text. */
export function matchExperienceScene(text: string): SceneMatch | null {
  const lower = text.toLowerCase().trim();
  let best: SceneMatch | null = null;

  for (const scene of SCENE_LIBRARY) {
    for (const term of scene.terms) {
      if (!lower.includes(term)) continue;
      const score = term.length + (scene.memoryWeight ?? 0) * 20;
      if (!best || score > best.score) {
        best = { scene, matchedTerm: term, score };
      }
    }
  }

  return best;
}

/** Blend a matched scene's emotional targets into the profile (experience > raw keywords). */
export function applyExperienceScene(
  profile: EmotionProfile,
  match: SceneMatch,
  blendWeight = 0.58
): EmotionProfile {
  const s = match.scene;
  const w = blendWeight;
  const p: EmotionProfile = {
    energy: clamp(lerp(profile.energy, s.energy, w)),
    valence: clamp(lerp(profile.valence, s.valence, w)),
    tension: clamp(lerp(profile.tension, s.tension, w)),
    nostalgia: clamp(lerp(profile.nostalgia, s.nostalgia, w)),
    calm: clamp(lerp(profile.calm, s.calm, w)),
    environment: s.environment ?? profile.environment,
    timeOfDay: s.time ?? profile.timeOfDay,
    motionState: s.motion ?? profile.motionState,
  };

  if (s.memoryWeight && s.memoryWeight > 0.5) {
    p.nostalgia = clamp(p.nostalgia + s.memoryWeight * 0.08);
  }

  return p;
}

export function getSceneJourneyArc(text: string, match: SceneMatch | null): JourneyArc | null {
  if (match?.scene.journeyArc) return match.scene.journeyArc;
  return null;
}

/** Summary for API/debug consumers. */
export function describeSceneMatch(match: SceneMatch | null): {
  sceneId: string;
  label: string;
  matchedTerm: string;
  qualities: string[];
  lifeSituation?: string;
} | null {
  if (!match) return null;
  return {
    sceneId: match.scene.id,
    label: match.scene.id.replace(/_/g, " "),
    matchedTerm: match.matchedTerm,
    qualities: match.scene.qualities ?? [],
    lifeSituation: match.scene.lifeSituation,
  };
}

export function getSceneLibrarySize(): number {
  return SCENE_LIBRARY.length;
}
