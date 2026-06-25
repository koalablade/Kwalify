/**
 * Benchmark parser — consumes ONLY playlistExecutionTrace from /api/generate responses.
 */

import {
  assertExecutionTraceInvariants,
  extractPlaylistExecutionTrace,
  type PlaylistExecutionTrace,
} from "../core/observability/playlist-execution-trace";

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
  executionPath: PlaylistExecutionTrace["executionPath"] | null;
  funnelCollapseStage: string | null;
  tracePresent: boolean;
};

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
  if (httpStatus === 422) responseKind = "gate_422";
  else if (httpStatus < 200 || httpStatus >= 300) responseKind = "error";

  return {
    httpStatus,
    responseKind,
    humanSaveable: trace.humanSaveable,
    curatorScore: trace.curatorScore,
    rejectionReasons: trace.rejectionReasons,
    retriesUsed: null,
    dominantCluster: trace.dominantCluster,
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

  const trace = extractPlaylistExecutionTrace(data);
  if (!trace) {
    return {
      httpStatus,
      responseKind: "trace_missing",
      humanSaveable: false,
      curatorScore: null,
      rejectionReasons: ["benchmark_hard_failure:missing_playlist_execution_trace"],
      retriesUsed: null,
      dominantCluster: null,
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
  if (row.error) return row.error;
  return "benchmark_hard_failure:missing_rejection_reason";
}
