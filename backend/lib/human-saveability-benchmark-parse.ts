/**
 * Benchmark parser — consumes ONLY top-level playlistExecutionTrace from /api/generate.
 */

import {
  assertExecutionTraceInvariants,
  extractFinalPlaylistExecutionTrace,
  type PlaylistExecutionTrace,
} from "../core/observability/playlist-execution-trace";
import type { ExecutionPath } from "../core/observability/execution-state";

export type ParsedHumanSaveabilityRun = {
  httpStatus: number;
  responseKind: "gate_422" | "audit_200" | "error" | "unparsed" | "trace_missing";
  humanSaveable: boolean;
  curatorScore: number | null;
  rejectionReasons: string[];
  retriesUsed: number | null;
  dominantCluster: string | null;
  archetype: Record<string, unknown> | null;
  openingTenDominantCluster: Record<string, unknown> | null;
  openingTenTrace: Array<Record<string, unknown>>;
  pipelineStageResponsible: string | null;
  suggestedFix: string | null;
  offendingTracks: Array<{ trackId: string; artist: string; reason: string }>;
  openingClusterViolations: Array<{ trackId: string; artist: string; rank: number }>;
  openingFailureOrigin: "before interleaving" | "after interleaving" | null;
  gateSource: string | null;
  trackCount: number;
  firstTen: string[];
  parseWarnings: string[];
  gateBypassed: boolean;
  bypassReason: string | null;
  executionPath: ExecutionPath | null;
  funnelCollapseStage: string | null;
  tracePresent: boolean;
};

function normalizeCuratorScoreForBenchmark(
  trace: PlaylistExecutionTrace,
): number | null {
  if (trace.humanSaveable) {
    return typeof trace.curatorScore === "number" && Number.isFinite(trace.curatorScore)
      ? trace.curatorScore
      : null;
  }
  if (typeof trace.curatorScore === "number" && Number.isFinite(trace.curatorScore)) {
    return trace.curatorScore;
  }
  if (trace.rejectionReasons.some((r) => r.includes("curator_score") || r.includes("evaluation_metadata_incomplete"))) {
    return 0;
  }
  return 0;
}

function firstFailingStage(trace: PlaylistExecutionTrace): string | null {
  const entries = Object.entries(trace.stageAttribution) as Array<[string, { status: string }]>;
  for (const [stage, entry] of entries) {
    if (entry.status === "failed") return stage;
  }
  return null;
}

function mapTraceToRun(
  httpStatus: number,
  data: Record<string, unknown>,
  trace: PlaylistExecutionTrace,
): ParsedHumanSaveabilityRun {
  const tracks = Array.isArray(data.tracks) ? data.tracks as Array<Record<string, unknown>> : [];
  const firstTen = tracks.slice(0, 10).map((t) =>
    `${t.trackName ?? t.name} — ${t.artistName ?? t.artist}`,
  );
  const interleaverDiff = trace.stageAttribution.interleaver.diff;
  const interleaverDetail = trace.stageAttribution.interleaver.detail;
  const openingFailureOrigin =
    interleaverDetail === "after interleaving" || interleaverDetail === "before interleaving"
      ? interleaverDetail
      : interleaverDiff?.failureOrigin === "after interleaving" || interleaverDiff?.failureOrigin === "before interleaving"
        ? interleaverDiff.failureOrigin as "before interleaving" | "after interleaving"
        : null;

  let responseKind: ParsedHumanSaveabilityRun["responseKind"] = "audit_200";
  if (trace.executionPath === "invalid_html_response") responseKind = "error";
  else if (httpStatus === 422) responseKind = "gate_422";
  else if (httpStatus < 200 || httpStatus >= 300) responseKind = "error";

  return {
    httpStatus,
    responseKind,
    humanSaveable: trace.humanSaveable,
    curatorScore: normalizeCuratorScoreForBenchmark(trace),
    rejectionReasons: trace.rejectionReasons,
    retriesUsed: null,
    dominantCluster: trace.dominantCluster ?? (trace.humanSaveable ? null : "dominant_cluster:not_computed"),
    archetype: null,
    openingTenDominantCluster: trace.openingTenClusterTrace.length > 0
      ? { trace: trace.openingTenClusterTrace }
      : null,
    openingTenTrace: trace.openingTenClusterTrace,
    pipelineStageResponsible: firstFailingStage(trace),
    suggestedFix: null,
    offendingTracks: [],
    openingClusterViolations: [],
    openingFailureOrigin,
    gateSource: "playlistExecutionTrace",
    trackCount: trace.trackCounts.final || tracks.length,
    firstTen,
    parseWarnings: [],
    gateBypassed: trace.debugFlags.gateBypassed,
    bypassReason: trace.debugFlags.gateBypassed ? trace.executionPath : null,
    executionPath: trace.executionPath,
    funnelCollapseStage: trace.funnelCollapseStage,
    tracePresent: true,
  };
}

export function parseHumanSaveabilityFromGenerateResponse(
  httpStatus: number,
  data: Record<string, unknown>,
): ParsedHumanSaveabilityRun {
  const tracks = Array.isArray(data.tracks) ? data.tracks as Array<Record<string, unknown>> : [];
  const firstTen = tracks.slice(0, 10).map((t) =>
    `${t.trackName ?? t.name} — ${t.artistName ?? t.artist}`,
  );

  const trace = extractFinalPlaylistExecutionTrace(data);
  if (!trace) {
    return {
      httpStatus,
      responseKind: "trace_missing",
      humanSaveable: false,
      curatorScore: 0,
      rejectionReasons: ["missing_final_trace"],
      retriesUsed: null,
      dominantCluster: "dominant_cluster:not_computed",
      archetype: null,
      openingTenDominantCluster: null,
      openingTenTrace: [],
      pipelineStageResponsible: null,
      suggestedFix: null,
      offendingTracks: [],
      openingClusterViolations: [],
      openingFailureOrigin: null,
      gateSource: null,
      trackCount: tracks.length,
      firstTen,
      parseWarnings: ["playlistExecutionTrace missing from API response"],
      gateBypassed: false,
      bypassReason: null,
      executionPath: null,
      funnelCollapseStage: null,
      tracePresent: false,
    };
  }

  assertExecutionTraceInvariants(trace);
  return mapTraceToRun(httpStatus, data, trace);
}

export function primaryRejectionReasonFromParsed(row: {
  rejectionReasons: string[];
  parseWarnings: string[];
  error: string | null;
}): string {
  if (row.rejectionReasons.length > 0) return row.rejectionReasons[0]!;
  if (row.parseWarnings.length > 0) return row.parseWarnings[0]!;
  if (row.error) return `benchmark_error:${row.error}`;
  return "benchmark_hard_failure:missing_rejection_reason";
}
