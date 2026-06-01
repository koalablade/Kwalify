/**
 * Tri-score core — scene×0.45 + library×0.35 + genre×0.20 (genre lock enforced).
 * Implementation lives in lib/hybrid-scoring.ts until a full file move is validated.
 */

export {
  buildHybridScoringContext,
  scoreLibraryHybrid,
  buildScoringDiagnostics,
  combineTriScore,
  computeTriScores,
  type HybridScoringContext,
  type HybridScoreResult,
  type TrackScoringDebug,
} from "../../lib/hybrid-scoring";
