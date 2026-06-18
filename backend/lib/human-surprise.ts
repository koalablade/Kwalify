/**
 * Human Surprise Layer — comfort / discovery / nostalgia / novelty balance.
 */

import type { EmotionProfile } from "./emotion";
import type { RediscoveryMode } from "./forgotten-favourites";
import type { ArchaeologyIntent } from "./library-archaeology";
import type { JourneyArc } from "./emotion-destination";
import type { FamiliarityMode } from "./familiarity-controller";
import { familiarityDiscoveryRatio } from "./familiarity-controller";

export interface SurpriseMix {
  comfort: number;
  discovery: number;
  nostalgia: number;
  novelty: number;
  /** Share of slots for emotional wildcards (0–0.15) */
  wildcardRatio: number;
  /** Share biased toward rediscovery pool */
  rediscoveryRatio: number;
}

export function computeSurpriseMix(opts: {
  profile: EmotionProfile;
  vibe: string;
  rediscoveryMode: RediscoveryMode;
  archaeology: ArchaeologyIntent | null;
  journeyArc: JourneyArc;
  mode: "strict" | "balanced" | "chaotic";
  familiarityMode?: FamiliarityMode;
}): SurpriseMix {
  const { profile, vibe, rediscoveryMode, archaeology, journeyArc, mode, familiarityMode } = opts;
  const lower = vibe.toLowerCase();

  let comfort = mode === "strict" ? 0.68 : 0.55;
  let discovery = mode === "chaotic" ? 0.32 : mode === "balanced" ? 0.24 : 0.16;
  let nostalgia = profile.nostalgia > 0.4 ? 0.45 : 0.2;
  let novelty = mode === "chaotic" ? 0.38 : mode === "balanced" ? 0.2 : 0.08;

  if (archaeology?.active) {
    discovery = 0.42;
    nostalgia = 0.5;
    comfort = 0.38;
    novelty = 0.28;
  }

  if (rediscoveryMode !== "balanced") {
    discovery += 0.12;
    comfort -= 0.08;
  }

  if (/\bheartbreak|breakup|grieving|mourning\b/i.test(lower)) {
    comfort = 0.72;
    discovery = 0.12;
    novelty = 0.08;
  }

  if (/\broad trip|party|gym|workout|hype\b/i.test(lower)) {
    discovery = 0.38;
    comfort = 0.45;
    novelty = 0.2;
  }

  if (/\bgym\b|\bworkout\b|\bpr\b/i.test(lower)) {
    novelty = 0.1;
    comfort = 0.5;
  }

  if (profile.timeOfDay === "late_night" || profile.calm > 0.55) {
    novelty = Math.min(0.25, novelty + 0.06);
    nostalgia += 0.1;
  }

  if (journeyArc === "recovery") comfort += 0.1;

  if (familiarityMode) {
    const discoveryTarget = familiarityDiscoveryRatio(familiarityMode);
    discovery = discovery * 0.55 + discoveryTarget * 0.45;
    comfort = comfort * 0.7 + (1 - discoveryTarget) * 0.3;
    novelty = novelty * 0.65 + discoveryTarget * 0.35;
  }

  const sum = comfort + discovery + nostalgia + novelty;
  comfort /= sum;
  discovery /= sum;
  nostalgia /= sum;
  novelty /= sum;

  const wildcardRatio = Math.min(
    0.18,
    novelty * 0.45 + (mode === "chaotic" ? 0.06 : mode === "strict" ? 0 : 0.02)
  );
  const rediscoveryRatio = Math.min(0.35, discovery * 0.5 + (archaeology ? 0.12 : 0));

  return {
    comfort: Math.round(comfort * 100) / 100,
    discovery: Math.round(discovery * 100) / 100,
    nostalgia: Math.round(nostalgia * 100) / 100,
    novelty: Math.round(novelty * 100) / 100,
    wildcardRatio: Math.round(wildcardRatio * 1000) / 1000,
    rediscoveryRatio: Math.round(rediscoveryRatio * 1000) / 1000,
  };
}
