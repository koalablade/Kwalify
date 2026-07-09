/**
 * Opening Curator v2 benchmark runner — live and offline evaluation paths.
 */

import { evaluateBlindPairwise } from "../playlist-quality-benchmark/blind-pairwise-evaluator";
import {
  loadNegativeExamples,
  resolveReferenceTracks,
  toPatternTrack,
} from "../playlist-quality-benchmark/hall-of-fame-loader";
import { detectNegativeFailure } from "../playlist-quality-benchmark/negative-example-detector";
import { evaluateOpeningFive } from "../playlist-quality-benchmark/opening-five-evaluator";
import { simulatePlaylistReplay } from "../playlist-quality-benchmark/replay-simulator";
import type { PatternScoringTrack } from "../../core/editorial/human-playlist-patterns";
import {
  analyzePromptResult,
  feelsHumanFirstFive,
  formatFirstFiveLines,
} from "./analyzer";
import { loadOpeningCuratorV2BenchmarkPrompts } from "./loader";
import { buildOpeningCuratorV2Report } from "./report";
import type {
  LiveGenerationPayload,
  OpeningCuratorDiagnostics,
  OpeningCuratorV2Prompt,
  OpeningCuratorV2PromptResult,
  OpeningTrackSummary,
  RetrievalDiagnostics,
} from "./types";

function mean(nums: Array<number | null | undefined>): number | null {
  const vals = nums.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function toFirstFive(tracks: PatternScoringTrack[]): OpeningTrackSummary[] {
  return tracks.slice(0, 5).map((track, index) => ({
    position: index + 1,
    trackId: track.trackId,
    artistName: track.artistName ?? "?",
    trackName: track.trackId,
    energy: track.energy ?? null,
    genreFamily: null,
  }));
}

function resolveReferenceId(prompt: OpeningCuratorV2Prompt): string | null {
  if (prompt.referenceId) return prompt.referenceId;
  return null;
}

function loadOfflineTracks(prompt: OpeningCuratorV2Prompt): {
  tracks: PatternScoringTrack[];
  mode: "offline_reference" | "offline_negative_sim";
} {
  if (prompt.offlineSimulatedPlaylist) {
    const neg = loadNegativeExamples().find((n) => n.id === prompt.offlineSimulatedPlaylist);
    if (neg) {
      return {
        tracks: neg.tracks.map((raw) => {
          const t = raw as PatternScoringTrack & { trackName?: string };
          return toPatternTrack({
            trackName: t.trackName ?? t.trackId,
            artistName: t.artistName ?? "?",
            energy: t.energy ?? null,
            valence: t.valence ?? null,
            danceability: t.danceability ?? null,
            acousticness: t.acousticness ?? null,
          });
        }),
        mode: "offline_negative_sim",
      };
    }
  }
  const refId = resolveReferenceId(prompt);
  if (refId) {
    const entry = { referenceId: refId, id: prompt.id, prompt: prompt.prompt } as Parameters<
      typeof resolveReferenceTracks
    >[0];
    const tracks = resolveReferenceTracks(entry).map(toPatternTrack);
    return { tracks, mode: "offline_reference" };
  }
  return { tracks: [], mode: "offline_reference" };
}

function extractAuditDiagnostics(audit?: Record<string, unknown>): {
  openingCurator: OpeningCuratorDiagnostics | null;
  retrieval: RetrievalDiagnostics | null;
} {
  if (!audit) return { openingCurator: null, retrieval: null };
  const finalization = audit.finalization as Record<string, unknown> | undefined;
  const snapshot = audit.generationAuditSnapshot as Record<string, unknown> | undefined;
  const fin = (finalization ?? snapshot?.finalization) as Record<string, unknown> | undefined;
  const oc = fin?.openingCuratorV2 as Record<string, unknown> | undefined;
  const retrievalRaw =
    (audit.candidateRetrieval as Record<string, unknown> | undefined)?.orchestrator ??
    (audit.generationDiagnostics as Record<string, unknown> | undefined)?.candidateRetrieval;

  const orchestrator = (typeof retrievalRaw === "object" && retrievalRaw
    ? (retrievalRaw as Record<string, unknown>).orchestrator ?? retrievalRaw
    : null) as Record<string, unknown> | null;

  return {
    openingCurator: oc
      ? {
          openerTrackId: (oc.openerTrackId as string) ?? null,
          openingReason: (oc.openingReason as string) ?? null,
          identityStrength: (oc.identityStrength as number) ?? null,
          continuityScore: (oc.continuityScore as number) ?? null,
          swaps: (oc.swaps as number) ?? null,
          rejectedOpeningCandidates: Array.isArray(oc.rejectedOpeningCandidates)
            ? (oc.rejectedOpeningCandidates as string[])
            : [],
          openingLockApplied: fin?.openingLockApplied as boolean | undefined,
          openingFinalOrderPreserved: fin?.openingFinalOrderPreserved as boolean | undefined,
          openingLockViolations: Array.isArray(fin?.openingLockViolations)
            ? (fin!.openingLockViolations as OpeningCuratorDiagnostics["openingLockViolations"])
            : [],
        }
      : null,
    retrieval: orchestrator
      ? {
          strategy: (orchestrator.strategy as string) ?? null,
          librarySufficient: (orchestrator.librarySufficient as boolean) ?? null,
          combinedConfidence: (orchestrator.combinedConfidence as number) ?? null,
          libraryCapability: String(orchestrator.libraryCapability ?? "") || null,
          suggestDiscoveryMode: audit.canUseDiscoveryMode === true,
        }
      : null,
  };
}

export function evaluateOpeningCuratorV2Prompt(opts: {
  prompt: OpeningCuratorV2Prompt;
  tracks: PatternScoringTrack[];
  mode: "live" | "offline_reference" | "offline_negative_sim";
  generationSuccess: boolean;
  libraryInsufficient: boolean;
  audit?: Record<string, unknown>;
  index?: number;
}): OpeningCuratorV2PromptResult {
  const { prompt, tracks, mode } = opts;
  const index = opts.index ?? 0;
  const firstFive = toFirstFive(tracks);
  const openingFive = tracks.length >= 5 ? evaluateOpeningFive({ prompt: prompt.prompt, tracks }) : null;
  const replaySimulation = tracks.length >= 5
    ? simulatePlaylistReplay({ prompt: prompt.prompt, tracks })
    : null;
  const negativeDetection = tracks.length >= 5
    ? detectNegativeFailure({ prompt: prompt.prompt, tracks })
    : { detected: false, matchedExamples: [], failureTypes: [], similarityScore: 0 };

  const refId = resolveReferenceId(prompt);
  let blindPairwise = null;
  if (refId && tracks.length >= 5) {
    const humanTracks = resolveReferenceTracks({
      referenceId: refId,
      id: prompt.id,
      prompt: prompt.prompt,
    } as Parameters<typeof resolveReferenceTracks>[0]).map(toPatternTrack);
    blindPairwise = humanTracks.length >= 5
      ? evaluateBlindPairwise({
          prompt: prompt.prompt,
          humanTracks,
          kwalifyTracks: tracks,
          seed: index + 11,
        })
      : null;
  }

  const { openingCurator, retrieval } = extractAuditDiagnostics(opts.audit);
  const openingPass = openingFive?.pass ?? false;
  const feelsHuman = feelsHumanFirstFive({
    openingPass,
    replay: replaySimulation,
    negativeDetected: negativeDetection.detected,
  });
  const humanPreferenceProxy = blindPairwise?.winner ?? null;

  const analysis = analyzePromptResult({
    prompt,
    firstFive,
    openingFive,
    replay: replaySimulation,
    openingPass,
    feelsHuman,
    generationSuccess: opts.generationSuccess,
    libraryInsufficient: opts.libraryInsufficient,
    retrieval,
    openingCurator,
    negativeDetected: negativeDetection.detected,
    humanPreferenceProxy,
  });

  return {
    id: prompt.id,
    prompt: prompt.prompt,
    category: prompt.category,
    expectedBand: prompt.expectedBand,
    difficulty: prompt.difficulty,
    mode,
    generationSuccess: opts.generationSuccess,
    libraryInsufficient: opts.libraryInsufficient,
    firstFive,
    openingPass,
    feelsHumanFirstFive: feelsHuman,
    openingFive,
    replaySimulation,
    blindPairwise,
    humanPreferenceProxy,
    openingCurator,
    retrieval,
    analysis,
  };
}

export function runOpeningCuratorV2BenchmarkOffline(): OpeningCuratorV2PromptResult[] {
  return loadOpeningCuratorV2BenchmarkPrompts().map((prompt, index) => {
    const { tracks, mode } = loadOfflineTracks(prompt);
    return evaluateOpeningCuratorV2Prompt({
      prompt,
      tracks,
      mode,
      generationSuccess: tracks.length >= 5,
      libraryInsufficient: false,
      index,
    });
  });
}

export function runOpeningCuratorV2BenchmarkLive(
  liveRows: LiveGenerationPayload[],
): OpeningCuratorV2PromptResult[] {
  const byId = new Map(liveRows.map((row) => [row.entryId, row]));
  return loadOpeningCuratorV2BenchmarkPrompts().map((prompt, index) => {
    const live = byId.get(prompt.id);
    if (!live) {
      return evaluateOpeningCuratorV2Prompt({
        prompt,
        tracks: [],
        mode: "live",
        generationSuccess: false,
        libraryInsufficient: false,
        index,
      });
    }
    return evaluateOpeningCuratorV2Prompt({
      prompt,
      tracks: live.tracks,
      mode: "live",
      generationSuccess: live.success,
      libraryInsufficient: live.libraryInsufficient,
      audit: live.audit,
      index,
    });
  });
}

export function runOpeningCuratorV2Benchmark(opts?: {
  mode?: "live" | "offline";
  liveRows?: LiveGenerationPayload[];
}) {
  const mode = opts?.mode ?? "offline";
  const results = mode === "live" && opts?.liveRows
    ? runOpeningCuratorV2BenchmarkLive(opts.liveRows)
    : runOpeningCuratorV2BenchmarkOffline();
  return buildOpeningCuratorV2Report(results, mode);
}

export function summarizeFirstFiveForLog(result: OpeningCuratorV2PromptResult): string {
  const lines = formatFirstFiveLines(result.firstFive);
  return lines.join(" | ");
}

export { mean };
