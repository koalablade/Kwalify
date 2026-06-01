/**
 * Assembles per-track traces + conflict reports after scoring pipeline completes.
 */

import type { TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { HybridScoreResult, TrackScoringDebug } from "../../lib/hybrid-scoring";
import type { PreScoreContext } from "../genre-intelligence/pre-score-bias";
import { computePreScoreBiasBreakdown } from "../genre-intelligence/pre-score-bias";
import type { TruthAnchorStore } from "../genre-intelligence/genre-truth-anchor";
import { applyTruthAnchorGuard, truthAnchorDriftScore } from "../genre-intelligence/genre-truth-anchor";
import {
  buildTrackDecisionTrace,
  type TrackDecisionTrace,
} from "./decision-trace";
import {
  detectBiasConflicts,
  collectGenreSignalsFromPreScore,
  type BiasConflictReport,
} from "./bias-conflict-detector";
import type { SceneGenreRouting } from "../scene-intelligence/scene-genre-routing";
import type { GenreForecast } from "../genre-intelligence/genre-forecast";
import { preScoreBoostForTrack } from "../genre-intelligence/genre-forecast";
import { TRACE_MAX_TOTAL, TRACE_SAMPLE_SIZE } from "../../lib/production-limits";

export interface TraceAssemblyInput<TTrack extends { trackId: string }> {
  hybridResults: HybridScoreResult<TTrack>[];
  hybridExcluded: TrackScoringDebug[];
  finalSorted: Array<TTrack & { score: number }>;
  classifications: Map<string, TrackGenreClassification>;
  preScore: PreScoreContext;
  truthAnchors: TruthAnchorStore;
  sceneRouting: SceneGenreRouting;
  genreForecast: GenreForecast;
  scoreBeforePost: Map<string, number>;
  traceSampleSize?: number;
}

export function assemblePipelineTraces<TTrack extends { trackId: string }>(
  input: TraceAssemblyInput<TTrack>
): {
  traces: TrackDecisionTrace[];
  conflictReports: BiasConflictReport[];
  truthAnchorDriftScore: number;
} {
  const genreSignals = new Map<string, ReturnType<typeof collectGenreSignalsFromPreScore>>();

  for (const adj of input.genreForecast.preScoreAdjustments) {
    const list = genreSignals.get(adj.genre) ?? [];
    if (adj.boost > 0) {
      list.push({ layer: "forecast", signal: "boost", magnitude: adj.boost });
    } else if (adj.boost < 0) {
      list.push({ layer: "forecast", signal: "suppress", magnitude: Math.abs(adj.boost) });
    }
    genreSignals.set(adj.genre, list);
  }

  for (const g of input.sceneRouting.suppressedGenres) {
    const list = genreSignals.get(g) ?? [];
    list.push({ layer: "scene_routing", signal: "suppress", magnitude: 0.12 });
    genreSignals.set(g, list);
  }
  for (const g of input.sceneRouting.boostedGenres) {
    const list = genreSignals.get(g) ?? [];
    list.push({ layer: "scene_routing", signal: "boost", magnitude: 0.1 });
    genreSignals.set(g, list);
  }

  const traces: TrackDecisionTrace[] = [];
  const sampleN = Math.min(
    TRACE_SAMPLE_SIZE,
    input.traceSampleSize ?? TRACE_SAMPLE_SIZE
  );
  const sampleIds = new Set(
    input.finalSorted.slice(0, sampleN).map((t) => t.trackId)
  );

  const maxTraces = TRACE_MAX_TOTAL;

  for (const ex of input.hybridExcluded) {
    if (!sampleIds.has(ex.trackId)) continue;
    if (traces.length >= maxTraces) break;
    const c = input.classifications.get(ex.trackId);
    traces.push(
      buildTrackDecisionTrace({
        trackId: ex.trackId,
        classification: c ?? {
          genrePrimary: "unknown",
          genreFamily: "unknown",
          genreSecondary: null,
          primarySubgenre: "unknown",
          secondarySubgenre: null,
          subGenres: [],
          microStyle: null,
          confidenceScore: 0,
          holidayBound: false,
        },
        hybridDebug: ex,
        finalScore: 0,
        rejected: ex.excludedBy,
      })
    );
  }

  for (const { track, score, debug } of input.hybridResults) {
    if (!sampleIds.has(track.trackId)) continue;
    if (traces.length >= maxTraces) break;

    let classification =
      input.classifications.get(track.trackId) ??
      ({
        genrePrimary: debug.genrePrimary as TrackGenreClassification["genrePrimary"],
        genreFamily: debug.genrePrimary as TrackGenreClassification["genreFamily"],
        genreSecondary: null,
        primarySubgenre: debug.genrePrimary,
        secondarySubgenre: null,
        subGenres: [],
        microStyle: null,
        confidenceScore: debug.genreConfidence,
        holidayBound: false,
      } as TrackGenreClassification);

    const anchor = input.truthAnchors.anchors.get(track.trackId);
    const guarded = applyTruthAnchorGuard(classification, anchor);
    classification = guarded.classification;

    const preBreakdown = input.preScore
      ? computePreScoreBiasBreakdown(classification, input.preScore)
      : undefined;

    const fam = classification.genreFamily;
    const existing = genreSignals.get(fam) ?? [];
    genreSignals.set(
      fam,
      [
        ...existing,
        ...collectGenreSignalsFromPreScore({
          genre: fam,
          forecastBoost: preBreakdown?.forecastComponent ?? 0,
          memoryBoost: preBreakdown?.memoryComponent ?? 0,
          graphBoost: preBreakdown?.graphComponent ?? 0,
          sceneRoutingMult: preBreakdown?.sceneRoutingMultiplier ?? 1,
          forecastSuppress:
            preScoreBoostForTrack(fam, input.genreForecast) < 0
              ? Math.abs(preScoreBoostForTrack(fam, input.genreForecast))
              : 0,
        }),
      ]
    );

    const hybridBase = input.scoreBeforePost.get(track.trackId) ?? score;
    const discoveryBoost = score - hybridBase;

    traces.push(
      buildTrackDecisionTrace({
        trackId: track.trackId,
        classification,
        hybridDebug: debug,
        triRaw: {
          sceneScore: debug.sceneScore,
          libraryFitScore: debug.libraryFitScore,
          genreBalanceScore: debug.genreMatch,
          emotionMatch: debug.emotionMatch,
        },
        preScore: preBreakdown,
        postScore: {
          rediscoveryDelta: discoveryBoost,
          referenceDelta: 0,
          freshnessMult: 1,
          confidenceMult: 1,
        },
        truthAnchorDrift: guarded.drift,
        finalScore: score,
      })
    );
  }

  const conflictReports = detectBiasConflicts(genreSignals);
  const drift = truthAnchorDriftScore(input.truthAnchors, input.classifications);

  return { traces, conflictReports, truthAnchorDriftScore: drift };
}
