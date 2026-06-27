/**
 * Learned dimension weights for pairwise playlist judgement.
 * Fit from human A/B labels: npm run fit:pairwise-preferences
 * Override path: PAIRWISE_PREFERENCE_WEIGHTS_PATH
 */

import fs from "node:fs";
import bundledWeights from "../../data/pairwise-preference-weights.json";
import type { PairwiseDimension } from "./pairwise-playlist-judge";

export type PairwisePreferenceWeights = Record<PairwiseDimension, number>;

const DEFAULT_WEIGHTS: PairwisePreferenceWeights = {
  human_saveable: 1.35,
  opening_intention: 1.15,
  full_playlist_shape: 1.25,
  cringe_resistance: 1.05,
  prompt_alignment: 0.95,
  transition_flow: 1.2,
  discovery_pacing: 1.1,
  ending_satisfaction: 1.15,
};

let cachedWeights: PairwisePreferenceWeights | null = null;

export function loadPairwisePreferenceWeights(): PairwisePreferenceWeights {
  if (cachedWeights) return cachedWeights;
  const envPath = process.env.PAIRWISE_PREFERENCE_WEIGHTS_PATH;
  if (envPath && fs.existsSync(envPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(envPath, "utf8")) as Partial<PairwisePreferenceWeights>;
      cachedWeights = { ...DEFAULT_WEIGHTS, ...raw };
      return cachedWeights;
    } catch {
      // fall through
    }
  }
  cachedWeights = { ...DEFAULT_WEIGHTS, ...bundledWeights };
  return cachedWeights;
}

export function dimensionVoteWeight(dimension: PairwiseDimension): number {
  return loadPairwisePreferenceWeights()[dimension] ?? 1;
}
