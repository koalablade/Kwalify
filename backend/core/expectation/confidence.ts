/**
 * Human Expectation Layer — confidence calibration (Phase 3, Priority 3).
 *
 * The pipeline already produces per-stage signals (interpretation salience,
 * retrieval pool adequacy, candidate admissibility, critic fit, repair outcome)
 * but they were scattered and never combined into a single *honest* confidence.
 *
 * This module composes them into a calibrated per-stage + overall confidence and
 * recommends what a cautious system should do when it is uncertain (broaden
 * retrieval, soften constraints, reduce heuristic strength) — the guidance the
 * pipeline needs to "never fake certainty".
 *
 * It is a PURE function over normalised inputs so it is trivially testable and
 * can be reused wherever the signals are available. It emits DATA + advice; it
 * does not itself change generation behaviour (kept conservative).
 */

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

export type ConfidenceStage =
  | "interpretation"
  | "retrieval"
  | "candidateQuality"
  | "critic"
  | "repair"
  | "overall";

export interface ConfidenceInputs {
  /** Interpretation grounding. */
  peakSalience: number; // 0..1, from interpretMoment
  novelPrompt: boolean;

  /** Retrieval adequacy. */
  candidatePoolSize: number;
  targetLength: number;
  /** Optional pool diversity in 0..1 (e.g. distinct-artist ratio / entropy). */
  poolDiversity?: number;

  /** Candidate quality: average admissibility fit of the pool/selection, 0..1. */
  avgCandidateFit?: number;

  /** Critic overall fit on the assembled playlist, 0..100. */
  criticFit?: number;

  /** Repair outcome. */
  repairApplied?: boolean;
  /** High-severity risks still present AFTER any repair. */
  unresolvedHighRisks?: number;
}

export interface ConfidenceAssessment {
  stages: Record<Exclude<ConfidenceStage, "overall">, number>;
  overall: number;
  weakestStage: Exclude<ConfidenceStage, "overall">;
  lowConfidence: boolean;
  recommendedActions: string[];
}

/** Confidence below this reads as "genuinely uncertain". */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** Adequate retrieval pool ~= this many candidates per delivered slot. */
const POOL_PER_SLOT_TARGET = 3;

function interpretationConfidence(inp: ConfidenceInputs): number {
  // peakSalience ~0.7 is a strong grounding; scale to 1 there. Novel prompts are
  // capped so an unrecognised moment can never masquerade as certain.
  const grounded = clamp01(inp.peakSalience / 0.7);
  return inp.novelPrompt ? grounded * 0.7 : grounded;
}

function retrievalConfidence(inp: ConfidenceInputs): number {
  const need = Math.max(1, inp.targetLength) * POOL_PER_SLOT_TARGET;
  const coverage = clamp01(inp.candidatePoolSize / need);
  const diversity = inp.poolDiversity === undefined ? coverage : clamp01(inp.poolDiversity);
  // Both matter: a big-but-monotonous pool is not a confident pool.
  return clamp01(coverage * 0.65 + diversity * 0.35);
}

function candidateQualityConfidence(inp: ConfidenceInputs): number {
  return inp.avgCandidateFit === undefined ? 0.5 : clamp01(inp.avgCandidateFit);
}

function criticConfidence(inp: ConfidenceInputs): number {
  return inp.criticFit === undefined ? 0.5 : clamp01(inp.criticFit / 100);
}

function repairConfidence(inp: ConfidenceInputs): number {
  // No repair needed → the playlist stood on its own (confident).
  if (!inp.repairApplied) return inp.unresolvedHighRisks ? clamp01(1 - inp.unresolvedHighRisks * 0.25) : 0.9;
  // Repair ran: confidence falls with each risk it could NOT resolve.
  return clamp01(0.7 - (inp.unresolvedHighRisks ?? 0) * 0.2);
}

/**
 * Compose calibrated confidence. `overall` blends the mean with the MINIMUM so a
 * single weak stage honestly drags the whole assessment down — the system should
 * be only as confident as its weakest link.
 */
export function assessConfidence(inp: ConfidenceInputs): ConfidenceAssessment {
  const stages = {
    interpretation: interpretationConfidence(inp),
    retrieval: retrievalConfidence(inp),
    candidateQuality: candidateQualityConfidence(inp),
    critic: criticConfidence(inp),
    repair: repairConfidence(inp),
  };

  const values = Object.values(stages);
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  const min = Math.min(...values);
  const overall = clamp01(mean * 0.5 + min * 0.5);

  const entries = Object.entries(stages) as Array<[Exclude<ConfidenceStage, "overall">, number]>;
  const weakestStage = entries.reduce((a, b) => (b[1] < a[1] ? b : a))[0];

  const recommendedActions: string[] = [];
  if (overall < LOW_CONFIDENCE_THRESHOLD) {
    recommendedActions.push("present as soft expectation constraints, not hard filters");
    recommendedActions.push("never surface this as high-confidence to the user");
  }
  if (stages.retrieval < LOW_CONFIDENCE_THRESHOLD) {
    recommendedActions.push("broaden retrieval: relax filters and try alternative semantic queries");
  }
  if (stages.interpretation < LOW_CONFIDENCE_THRESHOLD) {
    recommendedActions.push("widen tolerance and reduce heuristic strength (treat moment as novel)");
  }
  if (stages.candidateQuality < LOW_CONFIDENCE_THRESHOLD) {
    recommendedActions.push("expand the candidate pool before reranking");
  }
  if (stages.critic < LOW_CONFIDENCE_THRESHOLD) {
    recommendedActions.push("prefer repair/regeneration over publishing as-is");
  }

  return {
    stages,
    overall,
    weakestStage,
    lowConfidence: overall < LOW_CONFIDENCE_THRESHOLD,
    recommendedActions,
  };
}
