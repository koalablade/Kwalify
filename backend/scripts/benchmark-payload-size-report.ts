/**
 * Analyze evaluation-results.jsonl for request/response payload stats.
 * Usage: npx tsx backend/scripts/benchmark-payload-size-report.ts --from <jsonl-path>
 */
import { readFileSync } from "node:fs";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";
import {
  buildEvaluationSessionMemoryPayload,
  DEFAULT_EXPRESS_JSON_BODY_LIMIT_BYTES,
  jsonUtf8ByteLength,
  type EvaluationSessionMemoryInput,
} from "../lib/evaluation-session-memory-payload";
import { winningTrackIds } from "../lib/contextual-uniqueness";

type Args = { from?: string; mode: "simulate" | "analyze" };

function parseArgs(): Args {
  const fromIndex = process.argv.indexOf("--from");
  if (fromIndex >= 0) {
    return { from: process.argv[fromIndex + 1], mode: "analyze" };
  }
  return { mode: "simulate" };
}

function simulate250(): void {
  const prompts = PLAYLIST_BENCHMARK_PROMPTS.slice(0, 250);
  const runMemory = {
    previousTrackLists: [] as string[][],
    previousPlaylistContexts: [] as Array<{ trackIds: string[]; context: Record<string, string> }>,
  };
  const stats = {
    maxRequestBytes: 0,
    minRequestBytes: Number.POSITIVE_INFINITY,
    totalRequestBytes: 0,
    maxPromptLength: 0,
    overLimitCount: 0,
  };

  for (let index = 0; index < prompts.length; index += 1) {
    const benchmark = prompts[index]!;
    const baseBody: Record<string, unknown> = {
      vibe: benchmark.prompt,
      mode: benchmark.mode,
      length: benchmark.length,
      varietyBoost: true,
      auditMode: true,
      evaluationCategory: benchmark.category,
    };
    if (runMemory.previousTrackLists.length > 0) {
      const memory = buildEvaluationSessionMemoryPayload(runMemory as unknown as EvaluationSessionMemoryInput, { baseBody });
      if (memory) baseBody.evaluationSessionMemory = memory;
    }
    const bytes = jsonUtf8ByteLength(baseBody);
    stats.totalRequestBytes += bytes;
    stats.maxRequestBytes = Math.max(stats.maxRequestBytes, bytes);
    stats.minRequestBytes = Math.min(stats.minRequestBytes, bytes);
    stats.maxPromptLength = Math.max(stats.maxPromptLength, benchmark.prompt.length);
    if (bytes > DEFAULT_EXPRESS_JSON_BODY_LIMIT_BYTES) stats.overLimitCount += 1;

    const trackIds = Array.from({ length: benchmark.length }, (_, trackIndex) =>
      `spotify:track:${String(index * 100 + trackIndex).padStart(22, "0")}`,
    );
    runMemory.previousTrackLists.push(trackIds);
    runMemory.previousPlaylistContexts.push({
      trackIds: winningTrackIds(trackIds),
      context: {
        category: benchmark.category,
        curatorType: "balanced_curator",
        primaryGenreFamily: benchmark.expectedGenres?.[0] ?? "unknown",
        activity: benchmark.category,
        energyBand: "medium-energy",
      },
    });
  }

  console.log(JSON.stringify({
    mode: "simulate-fixed",
    promptCount: prompts.length,
    expressJsonLimitBytes: DEFAULT_EXPRESS_JSON_BODY_LIMIT_BYTES,
    maxRequestBytes: stats.maxRequestBytes,
    minRequestBytes: stats.minRequestBytes,
    avgRequestBytes: Math.round(stats.totalRequestBytes / prompts.length),
    maxPromptLength: stats.maxPromptLength,
    requestsOverLimit: stats.overLimitCount,
  }, null, 2));
}

function analyzeJsonl(path: string): void {
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  const runMemory = {
    previousTrackLists: [] as string[][],
    previousPlaylistContexts: [] as Array<{ trackIds: string[]; context: Record<string, string> }>,
  };

  let maxRequest = 0;
  let totalRequest = 0;
  let maxResponse = 0;
  let totalResponse = 0;
  let http413 = 0;
  let httpOk = 0;
  let firstOverLimitIndex: number | null = null;
  let first413Index: number | null = null;
  let maxPromptLen = 0;
  let maxAuditBytes = 0;
  let maxDiagnosticsBytes = 0;

  lines.forEach((line, index) => {
    const row = JSON.parse(line) as Record<string, unknown>;
    const benchmark = row["benchmark"] as Record<string, unknown>;
    const prompt = String(benchmark?.["prompt"] ?? "");
    maxPromptLen = Math.max(maxPromptLen, prompt.length);

    const baseBody: Record<string, unknown> = {
      vibe: prompt,
      mode: benchmark?.["mode"] ?? "balanced",
      length: benchmark?.["length"] ?? 30,
      varietyBoost: true,
      auditMode: true,
      evaluationCategory: benchmark?.["category"] ?? "mixed",
      evaluationSessionMemory: runMemory.previousTrackLists.length > 0
        ? {
            previousTrackIds: [...runMemory.previousTrackLists].reverse().slice(0, 50),
            previousPlaylistContexts: [...runMemory.previousPlaylistContexts].reverse().slice(0, 50),
          }
        : undefined,
    };
    if (!baseBody.evaluationSessionMemory) delete baseBody.evaluationSessionMemory;
    const reqBytes = jsonUtf8ByteLength(baseBody);
    totalRequest += reqBytes;
    maxRequest = Math.max(maxRequest, reqBytes);
    if (reqBytes > DEFAULT_EXPRESS_JSON_BODY_LIMIT_BYTES && firstOverLimitIndex === null) {
      firstOverLimitIndex = index + 1;
    }

    const response = row["response"] as Record<string, unknown> | undefined;
    const resBytes = jsonUtf8ByteLength(response ?? {});
    totalResponse += resBytes;
    maxResponse = Math.max(maxResponse, resBytes);
    maxDiagnosticsBytes = Math.max(maxDiagnosticsBytes, jsonUtf8ByteLength(response?.["generationDiagnostics"] ?? {}));
    maxAuditBytes = Math.max(maxAuditBytes, jsonUtf8ByteLength(response?.["pipelineAuthority"] ?? {}));

    const status = row["status"];
    const ok = row["ok"] === true;
    if (status === 413) {
      http413 += 1;
      if (first413Index === null) first413Index = index + 1;
    }
    if (ok) httpOk += 1;

    const tracks = row["tracks"] as Array<Record<string, unknown>> | undefined;
    const trackIds = (tracks ?? [])
      .map((track) => String(track["trackId"] ?? track["id"] ?? "").trim())
      .filter(Boolean);
    if (trackIds.length > 0) {
      runMemory.previousTrackLists.push(trackIds);
      runMemory.previousPlaylistContexts.push({
        trackIds: winningTrackIds(trackIds),
        context: {
          category: String(benchmark?.["category"] ?? "mixed"),
          curatorType: "balanced_curator",
          primaryGenreFamily: "unknown",
          activity: String(benchmark?.["category"] ?? "none"),
          energyBand: "unknown-energy",
        },
      });
    }
  });

  console.log(JSON.stringify({
    mode: "analyze-legacy-harness",
    path,
    promptCount: lines.length,
    expressJsonLimitBytes: DEFAULT_EXPRESS_JSON_BODY_LIMIT_BYTES,
    maxRequestBytes: maxRequest,
    avgRequestBytes: Math.round(totalRequest / lines.length),
    maxResponseBytes: maxResponse,
    avgResponseBytes: Math.round(totalResponse / lines.length),
    maxPromptLength: maxPromptLen,
    maxDiagnosticsBytes,
    maxAuditBytes,
    firstRequestOverLimitIndex: firstOverLimitIndex,
    firstHttp413Index: first413Index,
    http413Count: http413,
    httpOkCount: httpOk,
  }, null, 2));
}

const args = parseArgs();
if (args.mode === "analyze" && args.from) {
  analyzeJsonl(args.from);
} else {
  simulate250();
}
