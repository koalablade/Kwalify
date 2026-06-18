/**
 * Intent Loss Report — observability layer for what was understood vs dropped.
 */

import type { IntentState } from "../core/intent-state-engine";

export type IntentLossReport = {
  recognized: string[];
  ignored: string[];
  inferred: string[];
  confidence: number;
  scenePrediction?: Record<string, number>;
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function buildIntentLossReport(
  intentState: IntentState,
  extras?: {
    scenePrediction?: Record<string, number>;
    assumptions?: string[];
  },
): IntentLossReport {
  const recognized = unique([
    intentState.activity ?? "",
    intentState.emotion ?? "",
    intentState.energy ?? "",
    intentState.era ?? "",
    ...(intentState.scene ?? []),
    ...(intentState.constraints?.excludedGenres?.map((g) => `exclude:${g}`) ?? []),
    ...(intentState.constraints?.excludedArtists?.map((a) => `exclude artist:${a}`) ?? []),
  ]);

  const ignored = unique(intentState.unknownTokens ?? []);
  const inferred = unique(extras?.assumptions ?? []);

  if (intentState.activity && !recognized.includes(intentState.activity)) {
    inferred.push(`${intentState.activity} -> activity cluster`);
  }
  if (intentState.emotion && intentState.confidence < 0.55) {
    inferred.push(`${intentState.emotion} -> mood inference (low confidence)`);
  }
  if ((intentState.scene ?? []).length > 0 && intentState.confidence < 0.6) {
    inferred.push(`scene guess -> ${(intentState.scene ?? []).slice(0, 2).join(" + ")}`);
  }

  return {
    recognized,
    ignored,
    inferred: unique(inferred).slice(0, 12),
    confidence: intentState.confidence,
    ...(extras?.scenePrediction ? { scenePrediction: extras.scenePrediction } : {}),
  };
}
