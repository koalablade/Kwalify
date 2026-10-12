import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlaylistEvaluationReport } from "../../core/evaluation/playlist-evaluator";

export const HARD_PROMPTS = [
  "Driving home after a long day, sunset, windows down, indie rock and alternative music with a hopeful feeling",
  "Music for finally getting over someone you thought you'd never move on from. Starts sad, ends confident",
  "Make me feel like the protagonist in a 1990s road movie driving through small American towns at night",
  "A playlist that feels like discovering old photographs in an attic",
  "Music for wandering through London alone at 2am after life-changing news",
  "A playlist that is both sad and hopeful at the same time",
  "Start with burnout and frustration, end with motivation and confidence",
  "Music that sounds like emotional healing after something difficult",
];

type Config = {
  baseUrl: string;
  spotifyUserId: string;
  token: string;
  outDir: string;
  timeoutMs: number;
  length: number;
  mode: string;
};

type PromptResult = {
  prompt: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  trackCount: number;
  error: string | null;
  evaluation: PlaylistEvaluationReport | null;
  performance: Record<string, unknown> | null;
  preV3Performance: Record<string, unknown> | null;
  biggestMismatchType: string;
};

type HardPromptReport = {
  generatedAt: string;
  commit: string;
  baseUrl: string;
  promptCount: number;
  results: PromptResult[];
  globalStats: {
    averageHumanScore: number;
    averageOverallScore: number;
    worstPrompt: string | null;
    bestPrompt: string | null;
    mostCommonFailureType: string | null;
    successCount: number;
    failureCount: number;
  };
};

function usage(): never {
  process.stderr.write([
    "Usage:",
    "  node backend/dist/scripts/evaluation/hard-prompt-suite.js --base-url URL --spotify-user-id USER_ID --token TOKEN",
    "",
    "Options:",
    "  --out DIR              Output directory (default reports/evaluation)",
    "  --timeout-ms N         Per-prompt timeout (default 120000)",
    "  --length N             Playlist length (default 30)",
    "  --mode MODE            Generation mode (default balanced)",
  ].join("\n") + "\n");
  process.exit(2);
}

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function parseConfig(args: string[]): Config {
  if (args.includes("--help") || args.includes("-h")) usage();
  const baseUrl = argValue(args, "--base-url") ?? process.env["API_BASE_URL"] ?? process.env["PLAYLIST_EVAL_BASE_URL"] ?? "";
  const spotifyUserId = argValue(args, "--spotify-user-id") ?? process.env["SPOTIFY_USER_ID"] ?? process.env["PLAYLIST_EVAL_SPOTIFY_USER_ID"] ?? "";
  const token = argValue(args, "--token") ?? process.env["PLAYLIST_EVAL_TOKEN"] ?? "";
  if (!baseUrl) throw new Error("API base URL is required.");
  if (!spotifyUserId) throw new Error("Spotify user id is required.");
  if (!token) throw new Error("Evaluation token is required.");
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    spotifyUserId,
    token,
    outDir: argValue(args, "--out") ?? "reports/evaluation",
    timeoutMs: Number(argValue(args, "--timeout-ms") ?? 120_000),
    length: Number(argValue(args, "--length") ?? 30),
    mode: argValue(args, "--mode") ?? "balanced",
  };
}

function localGitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function isEvaluationReport(value: unknown): value is PlaylistEvaluationReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<PlaylistEvaluationReport>;
  return typeof report.overallScore === "number" &&
    typeof report.humanLikelihoodScore === "number" &&
    Array.isArray(report.failureClassification);
}

function biggestMismatchType(evaluation: PlaylistEvaluationReport | null, error: string | null): string {
  if (!evaluation) return error ? "generation failure" : "missing evaluation report";
  if (evaluation.failureClassification.length > 0) return evaluation.failureClassification[0]!;
  const scores = [
    { type: "emotional arc failure", score: evaluation.emotionalCoherence },
    { type: "genre incoherence", score: evaluation.genreConsistency },
    { type: "era mismatch", score: evaluation.eraConsistency },
    { type: "retrieval mismatch", score: evaluation.intentMatch },
    { type: "sequencing unnaturalness", score: evaluation.playlistFlow },
    { type: "over-algorithmic behaviour", score: evaluation.humanLikelihoodScore },
  ].sort((a, b) => a.score - b.score);
  return scores[0]?.score !== undefined && scores[0].score < 72 ? scores[0].type : "none";
}

async function runPrompt(config: Config, prompt: string): Promise<PromptResult> {
  const started = Date.now();
  try {
    const result = await fetchJson(`${config.baseUrl}/api/generate?audit=1&debugEvaluation=1&debugPerformance=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": config.token,
      },
      body: JSON.stringify({
        vibe: prompt,
        mode: config.mode,
        length: config.length,
        spotifyUserId: config.spotifyUserId,
        debugEvaluation: true,
        debugPerformance: true,
      }),
    }, config.timeoutMs);
    const latencyMs = Date.now() - started;
    const evaluationRaw = result.body["playlistQualityReport"];
    const evaluation = isEvaluationReport(evaluationRaw) ? evaluationRaw : null;
    const performanceRaw = result.body["pipelinePerformanceReport"];
    const performance = performanceRaw && typeof performanceRaw === "object" && !Array.isArray(performanceRaw)
      ? performanceRaw as Record<string, unknown>
      : null;
    const preV3PerformanceRaw = result.body["preV3PerformanceReport"];
    const preV3Performance = preV3PerformanceRaw && typeof preV3PerformanceRaw === "object" && !Array.isArray(preV3PerformanceRaw)
      ? preV3PerformanceRaw as Record<string, unknown>
      : null;
    const error = typeof result.body["error"] === "string"
      ? result.body["error"]
      : evaluation ? null : "Missing playlistQualityReport";
    return {
      prompt,
      ok: result.status >= 200 && result.status < 300 && result.body["success"] === true && !!evaluation,
      status: result.status,
      latencyMs,
      trackCount: typeof result.body["count"] === "number" ? result.body["count"] : 0,
      error,
      evaluation,
      performance,
      preV3Performance,
      biggestMismatchType: biggestMismatchType(evaluation, error),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      prompt,
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      trackCount: 0,
      error,
      evaluation: null,
      performance: null,
      preV3Performance: null,
      biggestMismatchType: biggestMismatchType(null, error),
    };
  }
}

function average(values: number[]): number {
  return values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
    : 0;
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function buildReport(config: Config, results: PromptResult[]): HardPromptReport {
  const evaluated = results.filter((result) => result.evaluation);
  const best = [...evaluated].sort((a, b) => (b.evaluation?.humanLikelihoodScore ?? 0) - (a.evaluation?.humanLikelihoodScore ?? 0))[0] ?? null;
  const worst = [...evaluated].sort((a, b) => (a.evaluation?.humanLikelihoodScore ?? 0) - (b.evaluation?.humanLikelihoodScore ?? 0))[0] ?? null;
  return {
    generatedAt: new Date().toISOString(),
    commit: localGitHead(),
    baseUrl: config.baseUrl,
    promptCount: HARD_PROMPTS.length,
    results,
    globalStats: {
      averageHumanScore: average(evaluated.map((result) => result.evaluation!.humanLikelihoodScore)),
      averageOverallScore: average(evaluated.map((result) => result.evaluation!.overallScore)),
      worstPrompt: worst?.prompt ?? null,
      bestPrompt: best?.prompt ?? null,
      mostCommonFailureType: mostCommon(results.map((result) => result.biggestMismatchType).filter((type) => type !== "none")),
      successCount: results.filter((result) => result.ok).length,
      failureCount: results.filter((result) => !result.ok).length,
    },
  };
}

function markdownReport(report: HardPromptReport): string {
  const rows = report.results.map((result, index) => {
    const evaluation = result.evaluation;
    return [
      `### ${index + 1}. ${result.prompt}`,
      "",
      `- Status: ${result.ok ? "PASS" : "FAIL"}${result.status ? ` (${result.status})` : ""}`,
      `- Latency: ${result.latencyMs}ms`,
      `- Tracks: ${result.trackCount}`,
      `- Overall score: ${evaluation?.overallScore ?? "n/a"}`,
      `- Human likelihood score: ${evaluation?.humanLikelihoodScore ?? "n/a"}`,
      `- Intent match: ${evaluation?.intentMatch ?? "n/a"}`,
      `- Biggest mismatch type: ${result.biggestMismatchType}`,
      result.preV3Performance ? `- Pre-V3 bottleneck: ${String(result.preV3Performance["bottleneckStage"] ?? "n/a")}` : null,
      result.performance ? `- Bottleneck stage: ${String(result.performance["bottleneckStage"] ?? "n/a")}` : null,
      result.error ? `- Error: ${result.error}` : null,
      evaluation?.critique.summary ? `- Summary: ${evaluation.critique.summary}` : null,
    ].filter((line): line is string => line !== null).join("\n");
  });
  return [
    "# Hard Prompt Evaluation Summary",
    "",
    `Generated: ${report.generatedAt}`,
    `Commit: ${report.commit}`,
    `Base URL: ${report.baseUrl}`,
    "",
    "## Global Stats",
    "",
    `- Average human score: ${report.globalStats.averageHumanScore}`,
    `- Average overall score: ${report.globalStats.averageOverallScore}`,
    `- Best prompt: ${report.globalStats.bestPrompt ?? "n/a"}`,
    `- Worst prompt: ${report.globalStats.worstPrompt ?? "n/a"}`,
    `- Most common failure type: ${report.globalStats.mostCommonFailureType ?? "none"}`,
    `- Success count: ${report.globalStats.successCount}/${report.promptCount}`,
    `- Failure count: ${report.globalStats.failureCount}/${report.promptCount}`,
    "",
    "## Prompt Results",
    "",
    ...rows,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const results: PromptResult[] = [];
  for (const prompt of HARD_PROMPTS) {
    process.stderr.write(`[hard-prompt-suite] generating: ${prompt}\n`);
    results.push(await runPrompt(config, prompt));
  }
  const report = buildReport(config, results);
  await mkdir(config.outDir, { recursive: true });
  const jsonPath = path.join(config.outDir, "hard-prompt-report.json");
  const mdPath = path.join(config.outDir, "hard-prompt-summary.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdPath, markdownReport(report), "utf8");
  process.stdout.write(JSON.stringify({
    jsonPath,
    mdPath,
    averageHumanScore: report.globalStats.averageHumanScore,
    successCount: report.globalStats.successCount,
    failureCount: report.globalStats.failureCount,
    mostCommonFailureType: report.globalStats.mostCommonFailureType,
  }, null, 2) + "\n");
}

main().catch((err) => {
  process.stderr.write(`[hard-prompt-suite] failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
