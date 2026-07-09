import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS, type PlaylistBenchmarkPrompt } from "../lib/playlist-evaluation/benchmark-prompts";
import {
  computeCrossPlaylistOverlap,
  computePlaylistMetrics,
  type GenerationEvaluationResult,
} from "../lib/playlist-evaluation/metrics";
import { evaluateOpeningCuratorV2Prompt } from "../tests/opening-curator-v2-benchmark/runner";
import { toPatternTrack } from "../tests/playlist-quality-benchmark/hall-of-fame-loader";
import type { OpeningCuratorV2Prompt } from "../tests/opening-curator-v2-benchmark/types";

const TARGET_IDS = ["party-70s-disco", "mixed-2", "party-latin-summer", "gaming-4"] as const;
const ROOT = path.resolve(__dirname, "..", "..", "..");

type LiveRunRow = {
  prompt: PlaylistBenchmarkPrompt;
  status: number;
  response: Record<string, unknown>;
  elapsedMs: number;
  ok: boolean;
};

type StageCounts = Record<string, number | null>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function txt(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value * 1000) / 10}%`;
}

function fmt(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value * 1000) / 1000}`;
}

function pickPrompt(id: string): PlaylistBenchmarkPrompt {
  const found = PLAYLIST_BENCHMARK_PROMPTS.find((row) => row.id === id);
  if (!found) throw new Error(`Missing benchmark prompt ${id}`);
  return found;
}

function responseTracks(response: Record<string, unknown>): Array<Record<string, unknown>> {
  return asArray<Record<string, unknown>>(response["tracks"]).filter((row) => !!asRecord(row));
}

function toEvaluationResult(row: LiveRunRow): GenerationEvaluationResult {
  return {
    benchmark: row.prompt,
    ok: row.ok,
    status: row.status,
    response: row.response,
    tracks: responseTracks(row.response).map((track) => ({
      id: txt(track["id"]) ?? undefined,
      trackId: txt(track["trackId"]) ?? undefined,
      name: txt(track["name"]) ?? txt(track["trackName"]) ?? undefined,
      trackName: txt(track["trackName"]) ?? txt(track["name"]) ?? undefined,
      artist: txt(track["artist"]) ?? txt(track["artistName"]) ?? undefined,
      artistName: txt(track["artistName"]) ?? txt(track["artist"]) ?? undefined,
      genrePrimary: txt(track["genrePrimary"]),
      genreFamily: txt(track["genreFamily"]),
      genres: asArray<string>(track["genres"]),
      releaseYear: num(track["releaseYear"]),
      energy: num(track["energy"]),
      valence: num(track["valence"]),
      clusterId: txt(track["clusterId"]),
      clusterIds: asArray<string>(track["clusterIds"]),
      laneId: txt(track["laneId"]),
    })),
    elapsedMs: row.elapsedMs,
  };
}

function majorStageCounts(response: Record<string, unknown>): StageCounts {
  const gd = asRecord(response["generationDiagnostics"]);
  if (!gd) return {};
  const keys = [
    "initialLibrarySize",
    "candidatesSampled",
    "candidatesClassified",
    "candidatesAfterIntent",
    "candidatesAfterEra",
    "candidatesAfterMood",
    "candidatesAfterConstraints",
    "candidatesAfterRanking",
    "candidatesAfterDiversity",
    "candidatesAfterRepair",
    "candidatesAfterCoherence",
    "candidatesFinal",
  ];
  const out: StageCounts = {};
  for (const key of keys) out[key] = num(gd[key]);
  return out;
}

function firstFive(tracks: Array<Record<string, unknown>>): string[] {
  return tracks.slice(0, 5).map((track, idx) => {
    const artist = txt(track["artist"]) ?? txt(track["artistName"]) ?? "?";
    const name = txt(track["name"]) ?? txt(track["trackName"]) ?? "?";
    return `${idx + 1}. ${artist} — ${name}`;
  });
}

function buildOpeningEval(prompt: PlaylistBenchmarkPrompt, response: Record<string, unknown>) {
  const tracks = responseTracks(response).map((row) =>
    toPatternTrack({
      trackName: txt(row["name"]) ?? txt(row["trackName"]) ?? "?",
      artistName: txt(row["artist"]) ?? txt(row["artistName"]) ?? "?",
      energy: num(row["energy"]),
      valence: num(row["valence"]),
      danceability: num(row["danceability"]),
      acousticness: num(row["acousticness"]),
    }),
  );
  const ocPrompt: OpeningCuratorV2Prompt = {
    id: prompt.id,
    prompt: prompt.prompt,
    category: "adversarial",
    expectedBand: "mixed",
    difficulty: "hard",
    expectedIntent: prompt.prompt,
  };
  return evaluateOpeningCuratorV2Prompt({
    prompt: ocPrompt,
    tracks,
    mode: "live",
    generationSuccess: bool(response["success"]) === true && tracks.length > 0,
    libraryInsufficient: txt(response["code"]) === "LIBRARY_INSUFFICIENT_FOR_PROMPT",
    audit: response,
  });
}

async function callGenerate(baseUrl: string, token: string, spotifyUserId: string, prompt: PlaylistBenchmarkPrompt): Promise<LiveRunRow> {
  const payload = {
    vibe: prompt.prompt,
    mode: prompt.mode,
    length: prompt.length,
    auditMode: true,
    debug: true,
    debugPipeline: true,
    debugPerformance: true,
    spotifyUserId,
  };
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180_000),
  });
  const elapsedMs = Date.now() - started;
  const data = await res.json().catch(() => ({}));
  const response = asRecord(data) ?? {};
  const success = bool(response["success"]) === true;
  const trackCount = asArray(response["tracks"]).length;
  return {
    prompt,
    status: res.status,
    response,
    elapsedMs,
    ok: success && trackCount > 0,
  };
}

function previousRowById(previous: Record<string, GenerationEvaluationResult>, id: string) {
  return previous[id] ?? null;
}

async function loadPreviousLiveResults(): Promise<Record<string, GenerationEvaluationResult>> {
  const reportPath = path.join(ROOT, "reports", "playlist-evaluation", "live-6h", "evaluation-report.json");
  const raw = JSON.parse(await readFile(reportPath, "utf8")) as { rawResults?: Array<Record<string, unknown>> };
  const out: Record<string, GenerationEvaluationResult> = {};
  for (const row of raw.rawResults ?? []) {
    const benchmark = asRecord(row["benchmark"]);
    const id = txt(benchmark?.["id"]);
    if (!id || !TARGET_IDS.includes(id as (typeof TARGET_IDS)[number])) continue;
    const prompt = pickPrompt(id);
    const response = asRecord(row["response"]) ?? {};
    const liveRow: LiveRunRow = {
      prompt,
      status: num(row["status"]) ?? 0,
      response,
      elapsedMs: num(row["elapsedMs"]) ?? 0,
      ok: bool(row["ok"]) === true,
    };
    out[id] = toEvaluationResult(liveRow);
  }
  return out;
}

function markdownForResult(opts: {
  row: LiveRunRow;
  metric: ReturnType<typeof computePlaylistMetrics>;
  overlap: number | null;
  opening: ReturnType<typeof evaluateOpeningCuratorV2Prompt>;
  previousMetric: ReturnType<typeof computePlaylistMetrics> | null;
  previousStatus: number | null;
}): string {
  const { row, metric, overlap, opening, previousMetric, previousStatus } = opts;
  const response = row.response;
  const gd = asRecord(response["generationDiagnostics"]);
  const trace = asRecord(response["playlistExecutionTrace"]);
  const retrieval = asRecord(gd?.["candidateRetrieval"]);
  const orchestrator = asRecord(retrieval?.["orchestrator"]);
  const blended = asRecord(orchestrator?.["blendedIntentPool"]);
  const recovery = asRecord(gd?.["recoveryDiagnostics"]);
  const first = firstFive(responseTracks(response));
  const counts = majorStageCounts(response);
  const fallbackLevel = txt(gd?.["fallbackLevel"]) ?? txt(response["status"]) ?? txt(response["code"]) ?? "none";
  const v3Executed = num(asRecord(gd?.["v3InvocationDecomposition"])?.["invocationCount"]) != null
    ? (num(asRecord(gd?.["v3InvocationDecomposition"])?.["invocationCount"]) ?? 0) > 0
    : asRecord(response["v3Diagnostics"]) != null;
  const oc2Executed = opening.openingCurator != null || opening.openingFive != null;
  const executionPath = txt(trace?.["executionPath"]) ?? (row.status >= 400 ? "failure_before_full_pipeline" : "unknown");
  const retrievalPath = [
    txt(retrieval?.["pipeline"]),
    txt(orchestrator?.["strategy"]),
  ].filter(Boolean).join(" -> ") || "unknown";
  const genericFallback = fallbackLevel.includes("hardSafe") || fallbackLevel.includes("fallback");
  const regressionNotes: string[] = [];
  if (previousStatus != null && row.status < previousStatus) regressionNotes.push(`Improved HTTP status ${previousStatus} -> ${row.status}`);
  if (previousStatus != null && row.status > previousStatus) regressionNotes.push(`Regressed HTTP status ${previousStatus} -> ${row.status}`);
  if (previousMetric) {
    if (metric.trackCount < previousMetric.trackCount) regressionNotes.push(`Shorter playlist ${previousMetric.trackCount} -> ${metric.trackCount}`);
    if (metric.fallbackUsed && !previousMetric.fallbackUsed) regressionNotes.push("New fallback usage");
    if (!metric.fallbackUsed && previousMetric.fallbackUsed) regressionNotes.push("Fallback removed");
  }

  return [
    `### ${row.prompt.id}`,
    `- Prompt: \`${row.prompt.prompt}\` (\`${row.prompt.mode}\`, len=${row.prompt.length})`,
    `- HTTP status: **${row.status}**`,
    `- Execution path: \`${executionPath}\``,
    `- Retrieval path: \`${retrievalPath}\``,
    `- Blended intent pool activated: **${blended ? "yes" : "no"}**${blended ? ` (${txt(blended["relaxationStep"]) ?? "lane blend"})` : ""}`,
    `- Candidate counts: ${Object.entries(counts).map(([k, v]) => `${k}=${v ?? "n/a"}`).join(", ")}`,
    `- V3 scoring executed: **${v3Executed ? "yes" : "no"}**`,
    `- Opening Curator v2 executed: **${oc2Executed ? "yes" : "no"}**`,
    `- Recovery tier: \`${txt(recovery?.["tier"]) ?? "none"}\``,
    `- Fallback type: \`${fallbackLevel}\`${genericFallback ? " (generic-like)" : ""}`,
    `- Final playlist length: **${metric.trackCount}**`,
    `- First five tracks: ${first.length ? first.join(" | ") : "none"}`,
    `- Opening diagnostics: openingPass=${opening.openingPass}, feelsHuman=${opening.feelsHumanFirstFive}, openingIssues=${opening.analysis.openingIssues.join(", ") || "none"}`,
    `- Replay proxy: **${fmt(opening.replaySimulation?.replayProxyScore ?? null)}**`,
    `- Skip risk: **${fmt(opening.replaySimulation?.skipRiskScore ?? null)}**`,
    `- Save proxy: **${fmt(opening.replaySimulation?.saveProxyScore ?? null)}**`,
    `- Identity diagnostics: persona=${metric.persona ?? "n/a"}, personaAdherence=${fmt(metric.personaAdherence)}, sceneFit=${fmt(metric.sceneFit)}, emotionalConsistency=${fmt(metric.emotionalConsistency)}, clusterPurity=${fmt(metric.clusterPurity)}`,
    `- Cross-overlap (within 4 prompts): ${fmt(overlap)}`,
    `- Failure reason: ${metric.likelyCause || txt(response["error"]) || "none"}`,
    `- Regression check vs previous benchmark: ${regressionNotes.length ? regressionNotes.join("; ") : "no regression observed for this prompt"}`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });
  const prompts = TARGET_IDS.map((id) => pickPrompt(id));
  const previousById = await loadPreviousLiveResults();
  const rows: LiveRunRow[] = [];
  for (const prompt of prompts) {
    process.stderr.write(`[compound-validation] ${prompt.id}...\n`);
    rows.push(await callGenerate(creds.baseUrl, creds.token, creds.spotifyUserId, prompt));
  }

  const evalResults = rows.map(toEvaluationResult);
  const overlapMap = computeCrossPlaylistOverlap(evalResults);
  const metrics = evalResults.map((result) =>
    computePlaylistMetrics(result, overlapMap.get(result.benchmark.id) ?? 0),
  );
  const openings = rows.map((row) => buildOpeningEval(row.prompt, row.response));

  const byIdMetric = new Map(metrics.map((m) => [m.promptId, m]));
  const prevMetrics = Object.values(previousById).map((result) =>
    computePlaylistMetrics(result, 0),
  );
  const prevMetricById = new Map(prevMetrics.map((m) => [m.promptId, m]));

  const promptBlocks = rows.map((row, idx) => {
    const metric = byIdMetric.get(row.prompt.id)!;
    const previous = previousRowById(previousById, row.prompt.id);
    return markdownForResult({
      row,
      metric,
      overlap: overlapMap.get(row.prompt.id) ?? null,
      opening: openings[idx]!,
      previousMetric: prevMetricById.get(row.prompt.id) ?? null,
      previousStatus: previous?.status ?? null,
    });
  });

  const answers = (() => {
    const q1 = rows.every((row) => {
      const orch = asRecord(asRecord(asRecord(row.response["generationDiagnostics"])?.["candidateRetrieval"])?.["orchestrator"]);
      const blended = asRecord(orch?.["blendedIntentPool"]);
      return row.status < 500 && (row.ok || blended != null);
    });
    const q2 = rows.every((row) => {
      const gd = asRecord(row.response["generationDiagnostics"]);
      const trace = asRecord(row.response["playlistExecutionTrace"]);
      const v3Inv = num(asRecord(gd?.["v3InvocationDecomposition"])?.["invocationCount"]);
      return row.status < 500 && ((v3Inv ?? 0) > 0 || txt(trace?.["executionPath"]) === "full_pipeline");
    });
    const q3 = rows.every((row) => row.ok);
    const q4 = rows.some((row) => {
      const gd = asRecord(row.response["generationDiagnostics"]);
      const level = txt(gd?.["fallbackLevel"]) ?? "";
      return level.includes("hardSafe") || level.includes("fallback");
    });
    const q5 = rows.some((row) => {
      const prev = previousById[row.prompt.id];
      if (!prev) return false;
      if ((prev.status ?? 0) < row.status) return true;
      if (prev.ok && !row.ok) return true;
      const prevLen = prev.tracks.length;
      const nowLen = responseTracks(row.response).length;
      if (prev.ok && row.ok && nowLen < prevLen) return true;
      return false;
    });
    return { q1, q2, q3, q4, q5 };
  })();

  const overallPass = answers.q1 && answers.q2 && answers.q3 && !answers.q4 && !answers.q5;
  const summaryTable = rows.map((row) => {
    const metric = byIdMetric.get(row.prompt.id)!;
    const orch = asRecord(asRecord(asRecord(row.response["generationDiagnostics"])?.["candidateRetrieval"])?.["orchestrator"]);
    const blended = asRecord(orch?.["blendedIntentPool"]);
    return `| ${row.prompt.id} | ${row.status} | ${metric.trackCount} | ${blended ? "yes" : "no"} | ${metric.fallbackUsed ? "yes" : "no"} | ${metric.likelyCause || "none"} |`;
  }).join("\n");

  const report = [
    "# Compound Starvation Validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Base URL: ${creds.baseUrl}`,
    "",
    "## Pass/Fail Summary",
    "",
    `Overall: **${overallPass ? "PASS" : "FAIL"}**`,
    "",
    "| Prompt | HTTP | Final length | Blended pool | Fallback used | Failure reason |",
    "|--------|------|--------------|--------------|---------------|----------------|",
    summaryTable,
    "",
    "## Direct Answers",
    "",
    `1. Blended intent pool rescued starvation: **${answers.q1 ? "YES" : "NO"}**`,
    `2. Strict scoring continued instead of stopping: **${answers.q2 ? "YES" : "NO"}**`,
    `3. Playlist completed normally: **${answers.q3 ? "YES" : "NO"}**`,
    `4. Generic fallback still present: **${answers.q4 ? "YES" : "NO"}**`,
    `5. Regressions vs previous benchmark: **${answers.q5 ? "YES" : "NO"}**`,
    "",
    "## Per-Prompt Diagnostics",
    "",
    ...promptBlocks,
  ].join("\n");

  const outPath = path.join(ROOT, "reports", "playlist-evaluation", "compound-starvation-validation.md");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${report}\n`, "utf8");

  const jsonOut = path.join(ROOT, "reports", "playlist-evaluation", "compound-starvation-validation.json");
  await writeFile(jsonOut, JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl: creds.baseUrl,
    overallPass,
    answers,
    rows: rows.map((row) => ({
      id: row.prompt.id,
      status: row.status,
      ok: row.ok,
      elapsedMs: row.elapsedMs,
    })),
  }, null, 2), "utf8");

  process.stdout.write(`[compound-validation] wrote ${outPath}\n`);
  process.stdout.write(`[compound-validation] wrote ${jsonOut}\n`);
  process.stdout.write(`[compound-validation] overallPass=${overallPass}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
