/**
 * Reliable fetch + parse for human-saveability benchmark runs.
 */

import {
  finalizePlaylistExecutionTrace,
  type PlaylistExecutionTrace,
} from "../core/observability/playlist-execution-trace";
import { isHtmlResponseBody } from "../core/observability/execution-state";
import {
  parseHumanSaveabilityFromGenerateResponse,
  type ParsedHumanSaveabilityRun,
} from "./human-saveability-benchmark-parse";

export type BenchmarkFetchResult = {
  httpStatus: number;
  rawText: string;
  parsed: ParsedHumanSaveabilityRun;
  fetchError: string | null;
  htmlResponse: boolean;
  attempts: number;
};

const HTML_RETRY_DELAYS_MS = [2000, 4000];
const MAX_ATTEMPTS = 1 + HTML_RETRY_DELAYS_MS.length;

function buildHtmlFailureParsed(
  httpStatus: number,
  meta: { prompt: string; seed: number; requestId: string },
): ParsedHumanSaveabilityRun {
  const trace = finalizePlaylistExecutionTrace({
    requestId: meta.requestId,
    prompt: meta.prompt,
    seed: meta.seed,
    executionPath: "invalid_html_response",
    humanSaveable: false,
    rejectionReasons: ["api_returned_html"],
    debugFlags: { gateExecuted: false, gateBypassed: true, timeoutOccurred: false },
    trackCounts: { retrieved: 0, after_world: 0, after_sampler: 0, final: 0 },
  });
  return traceToParsed(httpStatus, {}, trace, ["api_returned_html:html_body_not_json"]);
}

function buildJsonParseFailureParsed(
  httpStatus: number,
  meta: { prompt: string; seed: number; requestId: string },
  detail: string,
): ParsedHumanSaveabilityRun {
  const trace = finalizePlaylistExecutionTrace({
    requestId: meta.requestId,
    prompt: meta.prompt,
    seed: meta.seed,
    executionPath: "unknown_exit",
    humanSaveable: false,
    rejectionReasons: [`benchmark_parse_error:${detail}`],
    debugFlags: { gateExecuted: false, gateBypassed: true, timeoutOccurred: false },
    trackCounts: { retrieved: 0, after_world: 0, after_sampler: 0, final: 0 },
  });
  return traceToParsed(httpStatus, {}, trace, [`json_parse_error:${detail}`]);
}

function traceToParsed(
  httpStatus: number,
  data: Record<string, unknown>,
  trace: PlaylistExecutionTrace,
  parseWarnings: string[],
): ParsedHumanSaveabilityRun {
  const tracks = Array.isArray(data.tracks) ? data.tracks as Array<Record<string, unknown>> : [];
  const firstTen = tracks.slice(0, 10).map((t) =>
    `${t.trackName ?? t.name} — ${t.artistName ?? t.artist}`,
  );
  let responseKind: ParsedHumanSaveabilityRun["responseKind"] = "audit_200";
  if (trace.executionPath === "invalid_html_response") responseKind = "error";
  else if (httpStatus === 422) responseKind = "gate_422";
  else if (httpStatus < 200 || httpStatus >= 300) responseKind = "error";

  const failingStage = Object.entries(trace.stageAttribution).find(([, v]) => v.status === "failed")?.[0] ?? null;

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
    pipelineStageResponsible: failingStage,
    suggestedFix: null,
    offendingTracks: [],
    openingClusterViolations: [],
    openingFailureOrigin: null,
    gateSource: "playlistExecutionTrace",
    trackCount: trace.trackCounts.final || tracks.length,
    firstTen,
    parseWarnings,
    gateBypassed: trace.debugFlags.gateBypassed,
    bypassReason: trace.debugFlags.gateBypassed ? trace.executionPath : null,
    executionPath: trace.executionPath,
    funnelCollapseStage: trace.funnelCollapseStage,
    tracePresent: true,
  };
}

export async function fetchAndParseBenchmarkGenerate(opts: {
  baseUrl: string;
  token: string;
  spotifyUserId: string;
  prompt: string;
  seed: number;
  requestId: string;
}): Promise<BenchmarkFetchResult> {
  const url = `${opts.baseUrl}/api/generate?audit=1`;
  const body = JSON.stringify({
    vibe: opts.prompt,
    mode: "balanced",
    length: 25,
    varietyBoost: true,
    auditMode: true,
    spotifyUserId: opts.spotifyUserId,
    requestId: opts.requestId,
    seed: opts.seed,
  });

  let lastRaw = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, HTML_RETRY_DELAYS_MS[attempt - 1] ?? 2000));
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": opts.token,
      },
      body,
    });
    lastStatus = res.status;
    lastRaw = await res.text();

    if (isHtmlResponseBody(lastRaw)) {
      if (attempt < MAX_ATTEMPTS - 1) continue;
      return {
        httpStatus: lastStatus,
        rawText: lastRaw.slice(0, 200),
        parsed: buildHtmlFailureParsed(lastStatus, {
          prompt: opts.prompt,
          seed: opts.seed,
          requestId: opts.requestId,
        }),
        fetchError: "api_returned_html",
        htmlResponse: true,
        attempts: attempt + 1,
      };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(lastRaw) as Record<string, unknown>;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS - 1 && detail.includes("<")) continue;
      return {
        httpStatus: lastStatus,
        rawText: lastRaw.slice(0, 200),
        parsed: buildJsonParseFailureParsed(lastStatus, {
          prompt: opts.prompt,
          seed: opts.seed,
          requestId: opts.requestId,
        }, detail),
        fetchError: detail,
        htmlResponse: false,
        attempts: attempt + 1,
      };
    }

    const parsed = parseHumanSaveabilityFromGenerateResponse(lastStatus, data);
    return {
      httpStatus: lastStatus,
      rawText: lastRaw.slice(0, 200),
      parsed,
      fetchError: null,
      htmlResponse: false,
      attempts: attempt + 1,
    };
  }

  return {
    httpStatus: lastStatus,
    rawText: lastRaw.slice(0, 200),
    parsed: buildHtmlFailureParsed(lastStatus, {
      prompt: opts.prompt,
      seed: opts.seed,
      requestId: opts.requestId,
    }),
    fetchError: "api_returned_html",
    htmlResponse: true,
    attempts: MAX_ATTEMPTS,
  };
}
