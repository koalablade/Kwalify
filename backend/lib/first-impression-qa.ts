import type { UxSignals } from "./ux-signals";

/** QA helper — simulates default first-render UI state (no expanded details). */
export function simulateFirstImpressionRender(uxSignals: UxSignals): {
  primaryNarrative: UxSignals["primaryNarrative"];
  consistencyBadge: {
    label: string;
    score: number;
  };
  clarityBadge: {
    label: string;
    score: number;
  };
  hasExpandedDetails: false;
  elementCount: number;
} {
  const elementCount =
    (uxSignals.primaryNarrative.momentLabel ? 1 : 0) +
    (uxSignals.primaryNarrative.summary ? 1 : 0) +
    (uxSignals.primaryNarrative.arcSummary ? 1 : 0) +
    2;

  return {
    primaryNarrative: uxSignals.primaryNarrative,
    consistencyBadge: {
      label: uxSignals.emotionalConsistencyLabel,
      score: uxSignals.emotionalConsistencyScore,
    },
    clarityBadge: {
      label: uxSignals.emotionalClarityLabel,
      score: uxSignals.emotionalClarityScore,
    },
    hasExpandedDetails: false,
    elementCount,
  };
}

/**
 * Strict first-impression purity check — momentLabel, summary, clarity badge only.
 * QA tool; not used in production render paths.
 */
export function simulateFirstImpressionStrict(uxSignals: UxSignals): {
  momentLabel: string;
  summary: string;
  clarityBadge: {
    label: string;
    score: number;
  };
} {
  return {
    momentLabel: uxSignals.primaryNarrative.momentLabel,
    summary: uxSignals.primaryNarrative.summary,
    clarityBadge: {
      label: uxSignals.emotionalClarityLabel,
      score: uxSignals.emotionalClarityScore,
    },
  };
}
