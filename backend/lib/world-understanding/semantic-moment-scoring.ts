/**
 * Additive fingerprint-based dimension scoring for playlist tri-score.
 * Supplements scene ID scoring — does not replace it.
 */

import type { TrackGenreClassification } from "../genre-taxonomy";
import type { SemanticMomentFingerprint } from "./moment-representation";

const FINGERPRINT_SCENE_BLEND = 0.08;
const FINGERPRINT_SEMANTIC_BLEND = 0.06;

export interface FingerprintScoreBreakdown {
  affinity: number;
  energyFit: number;
  genreFit: number;
  emotionFit: number;
  appliedSceneBoost: number;
  appliedSemanticBoost: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function emotionTextMatch(trackValence: number | null, fingerprint: SemanticMomentFingerprint): number {
  const desired = [
    ...fingerprint.emotion.desired,
    ...fingerprint.emotion.primary,
    ...fingerprint.emotion.secondary,
  ];
  if (!desired.length || trackValence == null) return 0.5;

  let target = 0.5;
  const text = desired.join(" ").toLowerCase();
  if (/sad|grief|melanchol|lonely|exhaust/i.test(text)) target = 0.35;
  else if (/hope|joy|relief|calm|peace|content/i.test(text)) target = 0.62;
  else if (/anger|tension|stress/i.test(text)) target = 0.4;

  return 1 - Math.abs(trackValence - target);
}

function genreFitScore(
  classification: TrackGenreClassification,
  fingerprint: SemanticMomentFingerprint,
): number {
  const primary = classification.genrePrimary?.toLowerCase() ?? "";
  const family = classification.genreFamily?.toLowerCase() ?? "";
  const preferred = fingerprint.playlistBehaviour.preferredGenres.map((g) => g.toLowerCase());
  const avoid = fingerprint.playlistBehaviour.avoidGenres.map((g) => g.toLowerCase());

  if (avoid.some((g) => primary.includes(g) || family.includes(g))) return 0.15;
  if (preferred.some((g) => primary.includes(g) || family.includes(g))) return 0.88;
  if (preferred.length === 0) return 0.55;
  return 0.45;
}

export function computeMomentFingerprintAffinity(
  track: {
    energy: number | null;
    valence: number | null;
  },
  classification: TrackGenreClassification,
  fingerprint: SemanticMomentFingerprint | null | undefined,
): FingerprintScoreBreakdown {
  if (!fingerprint || fingerprint.confidence < 0.25) {
    return {
      affinity: 0,
      energyFit: 0,
      genreFit: 0,
      emotionFit: 0,
      appliedSceneBoost: 0,
      appliedSemanticBoost: 0,
    };
  }

  const targetEnergy = fingerprint.playlistBehaviour.energy;
  const energyFit =
    track.energy == null ? 0.5 : 1 - Math.min(1, Math.abs(track.energy - targetEnergy) / 0.55);
  const genreFit = genreFitScore(classification, fingerprint);
  const emotionFit = emotionTextMatch(track.valence, fingerprint);

  const affinity = clamp01(energyFit * 0.35 + genreFit * 0.35 + emotionFit * 0.3);
  const weight = clamp01(fingerprint.confidence);

  return {
    affinity,
    energyFit: clamp01(energyFit),
    genreFit: clamp01(genreFit),
    emotionFit: clamp01(emotionFit),
    appliedSceneBoost: affinity * FINGERPRINT_SCENE_BLEND * weight,
    appliedSemanticBoost: affinity * FINGERPRINT_SEMANTIC_BLEND * weight,
  };
}

/** Apply additive boosts to scene and semantic ecosystem channels */
export function applyFingerprintScoringBoosts(
  sceneScore: number,
  semanticEcosystemScore: number,
  breakdown: FingerprintScoreBreakdown,
): { sceneScore: number; semanticEcosystemScore: number } {
  if (breakdown.affinity <= 0) {
    return { sceneScore, semanticEcosystemScore };
  }
  return {
    sceneScore: Math.min(1, sceneScore + breakdown.appliedSceneBoost),
    semanticEcosystemScore: Math.min(1, semanticEcosystemScore + breakdown.appliedSemanticBoost),
  };
}
