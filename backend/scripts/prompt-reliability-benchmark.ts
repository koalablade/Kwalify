import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type PromptGroup = "Electronic" | "Alternative" | "Hip Hop" | "Lifestyle";
type BenchmarkMode = "strict" | "balanced" | "chaotic";

type BenchmarkPrompt = {
  id: string;
  group: PromptGroup;
  prompt: string;
  mode: BenchmarkMode;
  requestedLength: number;
};

type BenchmarkConfig = {
  baseUrl: string;
  outDir: string;
  spotifyUserId: string;
  token: string;
  requestedLength: number;
  timeoutMs: number;
  delayMs: number;
  limit: number | null;
  group: PromptGroup | null;
  dryRun: boolean;
};

type PromptBenchmarkRow = {
  input: {
    id: string;
    group: PromptGroup;
    prompt: string;
    mode: BenchmarkMode;
    requestedLength: number;
  };
  ok: boolean;
  status: number | null;
  error: string | null;
  elapsedMs: number;
  retrieval: {
    retrievalCount: number | null;
    structuredRetrievalCount: number | null;
    fallbackLevelUsed: string | null;
    firstCollapseReason: string | null;
  };
  intent: {
    contractSurvivalPercent: number;
    emotionSurvivalPercent: number;
    subgenreSurvivalPercent: number;
    overallSurvivalPercent: number;
  };
  generation: {
    finalTrackCount: number;
    artistDiversity: number | null;
    genreDiversity: number | null;
    repairCount: number;
    recoveryCount: number;
  };
  finalization: {
    finalizationSurvivalPercent: number;
    eraRelaxationUsed: boolean;
    emergencyFillUsed: boolean;
  };
  quality: {
    leakCount: number;
    majorGenreLeak: boolean;
    majorEraLeak: boolean;
    convergenceRisk: string | null;
    confidenceScore: number;
  };
  success: boolean;
  promptReliabilityScore: number;
  failureReasons: string[];
  riskScores: {
    fail: number;
    drift: number;
    underfill: number;
    genreLeak: number;
  };
};

type BenchmarkReport = {
  generatedAt: string;
  commit: string;
  run: {
    mode: "audit";
    baseUrl: string;
    promptCount: number;
    requestedLength: number;
    durationMs: number;
  };
  summary: {
    promptReliabilityScore: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    averageSurvivalPercent: number;
    averageConfidenceScore: number;
    underfilledCount: number;
    genreLeakCount: number;
    eraLeakCount: number;
  };
  rankings: {
    mostLikelyToFail: PromptBenchmarkRow[];
    mostLikelyToDrift: PromptBenchmarkRow[];
    mostLikelyToUnderfill: PromptBenchmarkRow[];
    mostLikelyToLeakGenres: PromptBenchmarkRow[];
  };
  prompts: PromptBenchmarkRow[];
};

const DEFAULT_REQUESTED_LENGTH = 30;

const PROMPTS: BenchmarkPrompt[] = [
  { id: "electronic-industrial-techno-warehouse-rave", group: "Electronic", prompt: "industrial techno warehouse rave", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "electronic-hard-techno-gym", group: "Electronic", prompt: "hard techno gym", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "electronic-progressive-trance-journey", group: "Electronic", prompt: "progressive trance journey", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "electronic-90s-trance-drive", group: "Electronic", prompt: "90s trance drive", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "electronic-liquid-drum-and-bass", group: "Electronic", prompt: "liquid drum and bass", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "electronic-dark-jungle", group: "Electronic", prompt: "dark jungle", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "electronic-old-school-dubstep", group: "Electronic", prompt: "old school dubstep", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "electronic-euphoric-summer-house", group: "Electronic", prompt: "euphoric summer house", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "alternative-shoegaze-dreamscape", group: "Alternative", prompt: "shoegaze dreamscape", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "alternative-melancholic-indie-night-drive", group: "Alternative", prompt: "melancholic indie night drive", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "alternative-rainy-night-walk", group: "Alternative", prompt: "rainy night walk", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "alternative-late-night-city-pop", group: "Alternative", prompt: "late night city pop", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "hip-hop-underground-hip-hop", group: "Hip Hop", prompt: "underground hip hop", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "hip-hop-conscious-rap-classics", group: "Hip Hop", prompt: "conscious rap classics", mode: "strict", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "hip-hop-dark-trap-night-drive", group: "Hip Hop", prompt: "dark trap night drive", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "lifestyle-deep-focus-coding", group: "Lifestyle", prompt: "deep focus coding", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "lifestyle-sunset-beach-reggae", group: "Lifestyle", prompt: "sunset beach reggae", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "lifestyle-sunday-morning-coffee", group: "Lifestyle", prompt: "sunday morning coffee", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "lifestyle-late-night-studying", group: "Lifestyle", prompt: "late night studying", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
  { id: "lifestyle-road-trip-classics", group: "Lifestyle", prompt: "road trip classics", mode: "balanced", requestedLength: DEFAULT_REQUESTED_LENGTH },
];

function usage(): never {
  console.error([
    "Usage:",
    "  npm run benchmark:prompt-reliability -- --base-url URL --spotify-user-id USER_ID --token TOKEN",
    "",
    "Options:",
    "  --base-url URL          API base URL (or API_BASE_URL / PLAYLIST_EVAL_BASE_URL)",
    "  --spotify-user-id ID    Synced Spotify user id for audit mode",
    "  --token TOKEN           PLAYLIST_EVAL_TOKEN value",
    "  --out DIR               Output directory (default reports/prompt-reliability/latest)",
    "  --length N              Requested playlist length for all prompts (default 30)",
    "  --timeout-ms N          Per-request timeout (default 120000)",
    "  --delay-ms N            Delay between requests (default 1000)",
    "  --limit N               Run only first N selected prompts",
    "  --group NAME            Run one group: Electronic, Alternative, Hip Hop, Lifestyle",
    "  --dry-run               Write prompt list without calling /api/generate",
  ].join("\n"));
  process.exit(2);
}

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function intArg(args: string[], name: string, fallback: number): number {
  const raw = argValue(args, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function parseGroup(value: string | null): PromptGroup | null {
  if (!value) return null;
  const match = ["Electronic", "Alternative", "Hip Hop", "Lifestyle"].find((group) => group.toLowerCase() === value.toLowerCase());
  if (!match) throw new Error("--group must be one of: Electronic, Alternative, Hip Hop, Lifestyle");
  return match as PromptGroup;
}

function parseConfig(args: string[]): BenchmarkConfig {
  if (args.includes("--help") || args.includes("-h")) usage();
  const baseUrl = argValue(args, "--base-url") ?? process.env["API_BASE_URL"] ?? process.env["PLAYLIST_EVAL_BASE_URL"] ?? "";
  const spotifyUserId = argValue(args, "--spotify-user-id") ?? process.env["SPOTIFY_USER_ID"] ?? process.env["PLAYLIST_EVAL_SPOTIFY_USER_ID"] ?? "";
  const token = argValue(args, "--token") ?? process.env["PLAYLIST_EVAL_TOKEN"] ?? "";
  if (!baseUrl) throw new Error("API base URL is required. Pass --base-url or set API_BASE_URL.");
  if (!spotifyUserId) throw new Error("Spotify user id is required. Pass --spotify-user-id or set SPOTIFY_USER_ID.");
  if (!token) throw new Error("Evaluation token is required. Pass --token or set PLAYLIST_EVAL_TOKEN.");
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    outDir: argValue(args, "--out") ?? "reports/prompt-reliability/latest",
    spotifyUserId,
    token,
    requestedLength: intArg(args, "--length", DEFAULT_REQUESTED_LENGTH),
    timeoutMs: intArg(args, "--timeout-ms", 120_000),
    delayMs: intArg(args, "--delay-ms", 1_000),
    limit: argValue(args, "--limit") ? intArg(args, "--limit", 0) : null,
    group: parseGroup(argValue(args, "--group")),
    dryRun: args.includes("--dry-run"),
  };
}

function localGitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function selectPrompts(config: BenchmarkConfig): BenchmarkPrompt[] {
  let prompts = PROMPTS.map((prompt) => ({ ...prompt, requestedLength: config.requestedLength }));
  if (config.group) prompts = prompts.filter((prompt) => prompt.group === config.group);
  if (config.limit !== null) prompts = prompts.slice(0, config.limit);
  if (prompts.length === 0) throw new Error("No prompts selected.");
  return prompts;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function percentValue(value: unknown): number | null {
  const numeric = numberValue(value);
  if (numeric === null) return null;
  return numeric <= 1 ? Math.round(numeric * 1000) / 10 : Math.round(numeric * 10) / 10;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function riskWeight(value: string | null): number {
  if (value === "critical") return 100;
  if (value === "high") return 75;
  if (value === "medium") return 45;
  if (value === "low") return 15;
  return 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function confidencePercent(response: Record<string, unknown>): number {
  const confidence = record(response["playlistConfidence"]);
  return percentValue(confidence["score"]) ?? percentValue(confidence["percent"]) ?? 0;
}

function diversityRatio(uniqueCount: number | null, total: number): number | null {
  if (uniqueCount === null || total <= 0) return null;
  return Math.round((uniqueCount / total) * 1000) / 1000;
}

async function postGenerate(config: BenchmarkConfig, prompt: BenchmarkPrompt): Promise<{ status: number | null; data: Record<string, unknown>; elapsedMs: number; error: string | null }> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/api/generate?audit=1&debug=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": config.token,
      },
      body: JSON.stringify({
        vibe: prompt.prompt,
        mode: prompt.mode,
        length: prompt.requestedLength,
        auditMode: true,
        spotifyUserId: config.spotifyUserId,
        varietyBoost: true,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      status: response.status,
      data,
      elapsedMs: Date.now() - started,
      error: response.ok ? null : String(data["message"] ?? data["error"] ?? response.statusText),
    };
  } catch (err) {
    return {
      status: null,
      data: {},
      elapsedMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractRow(prompt: BenchmarkPrompt, result: { status: number | null; data: Record<string, unknown>; elapsedMs: number; error: string | null }): PromptBenchmarkRow {
  const response = result.data;
  const generationDiagnostics = record(response["generationDiagnostics"]);
  const promptSurvivability = record(generationDiagnostics["promptSurvivability"]);
  const v3Diagnostics = record(response["v3Diagnostics"]);
  const intentContractGuard = record(v3Diagnostics["intentContractGuard"]);
  const intentSurvival = record(response["intentSurvival"] ?? v3Diagnostics["intentSurvival"]);
  const survivalScores = record(intentSurvival["scores"]);
  const emotionSurvival = record(intentSurvival["emotionSurvival"]);
  const convergence = record(intentSurvival["convergence"]);
  const finalization = record(response["finalization"]);
  const strictEraEvidence = record(response["strictEraEvidence"]);
  const strictGenreEvidence = record(response["strictGenreEvidence"]);
  const artistDiversity = record(response["artistDiversity"]);
  const finalGenreDistribution = record(response["finalGenreDistribution"]);
  const tracks = arrayValue(response["tracks"]);
  const finalTrackCount = numberValue(response["totalTracks"]) ?? numberValue(response["count"]) ?? tracks.length;
  const requestedLength = prompt.requestedLength;
  const retrievalCount =
    numberValue(promptSurvivability["preFilterPoolSize"]) ??
    numberValue(generationDiagnostics["candidatesSampled"]) ??
    numberValue(intentContractGuard["candidateCountPerStage"] && record(intentContractGuard["candidateCountPerStage"])["retrieval"]);
  const structuredRetrievalCount =
    numberValue(promptSurvivability["postStructuredRetrievalSize"]) ??
    numberValue(intentContractGuard["subgenreEvidencePoolCount"]) ??
    numberValue(intentContractGuard["subgenreRelatedCount"]) ??
    numberValue(intentContractGuard["subgenrePrimaryCount"]);
  const fallbackLevelUsed =
    stringValue(intentContractGuard["fallbackLevelUsed"]) ??
    stringValue(generationDiagnostics["fallbackLevel"]);
  const leakDetections = arrayValue(intentSurvival["leakDetections"]).filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>>;
  const majorGenreLeak = boolValue(strictGenreEvidence["relaxed"]) ||
    leakDetections.some((leak) => {
      const dimensions = arrayValue(leak["affectedDimensions"]).map(String);
      const severity = stringValue(leak["severity"]);
      return dimensions.some((dimension) => dimension === "genre" || dimension === "subgenre") &&
        (severity === "critical" || severity === "high");
    });
  const majorEraLeak = boolValue(strictEraEvidence["relaxed"]) ||
    leakDetections.some((leak) => {
      const dimensions = arrayValue(leak["affectedDimensions"]).map(String);
      const severity = stringValue(leak["severity"]);
      return dimensions.includes("era") && (severity === "critical" || severity === "high");
    });
  const overallSurvivalPercent = percentValue(survivalScores["overallIntentSurvival"]) ?? 0;
  const contractSurvivalPercent = overallSurvivalPercent;
  const emotionSurvivalPercent = percentValue(emotionSurvival["survivalPercent"]) ?? percentValue(survivalScores["emotionSurvival"]) ?? 100;
  const subgenreSurvivalPercent = percentValue(survivalScores["subgenreSurvival"]) ?? 100;
  const finalizationSurvivalPercent = Math.round((finalTrackCount / Math.max(1, requestedLength)) * 1000) / 10;
  const confidence = confidencePercent(response);
  const repairCount =
    numberValue(record(v3Diagnostics["waterfall"])["repairCount"]) ??
    numberValue(record(v3Diagnostics["explicitIntentRepair"])["repairedCount"]) ??
    numberValue(finalization["repairedCount"]) ??
    0;
  const recoveryRelaxations = arrayValue(generationDiagnostics["recoveryRelaxations"]);
  const recoveryCount = (boolValue(generationDiagnostics["recoveryTriggered"]) ? 1 : 0) + recoveryRelaxations.length;
  const emergencyFillUsed = boolValue(finalization["hardSafeFillUsed"]) ||
    !!stringValue(finalization["fallbackMode"]) ||
    recoveryRelaxations.some((entry) => String(entry).includes("emergency"));
  const leakCount = leakDetections.length +
    (boolValue(strictGenreEvidence["relaxed"]) ? 1 : 0) +
    (boolValue(strictEraEvidence["relaxed"]) ? 1 : 0);
  const successCriteria = {
    length: finalTrackCount >= Math.ceil(requestedLength * 0.9),
    genre: !majorGenreLeak,
    era: !majorEraLeak,
    survival: overallSurvivalPercent >= 70,
    confidence: confidence >= 70,
  };
  const failureReasons = [
    result.error ? `request_failed:${result.error}` : null,
    !successCriteria.length ? "requested_length_below_90_percent" : null,
    !successCriteria.genre ? "major_genre_leak" : null,
    !successCriteria.era ? "major_era_leak" : null,
    !successCriteria.survival ? "survival_below_70_percent" : null,
    !successCriteria.confidence ? "confidence_below_70_percent" : null,
  ].filter((item): item is string => !!item);
  const success = result.status !== null && result.status >= 200 && result.status < 300 &&
    boolValue(response["success"]) &&
    failureReasons.length === 0;
  const underfillPenalty = Math.max(0, requestedLength - finalTrackCount) / Math.max(1, requestedLength);
  const driftRisk = Math.max(
    100 - overallSurvivalPercent,
    riskWeight(stringValue(convergence["convergenceRisk"])),
    leakCount * 12,
  );
  const genreLeakRisk = majorGenreLeak ? 100 : leakDetections.filter((leak) => arrayValue(leak["affectedDimensions"]).map(String).some((dimension) => dimension === "genre" || dimension === "subgenre")).length * 25;
  const failRisk = Math.max(
    success ? 0 : 70,
    underfillPenalty * 100,
    70 - Math.min(overallSurvivalPercent, confidence),
    majorGenreLeak || majorEraLeak ? 85 : 0,
  );
  const reliabilityScore = clampScore(
    finalizationSurvivalPercent * 0.22 +
    overallSurvivalPercent * 0.30 +
    confidence * 0.22 +
    (majorGenreLeak ? 0 : 12) +
    (majorEraLeak ? 0 : 8) -
    leakCount * 4 -
    recoveryCount * 2,
  );
  return {
    input: {
      id: prompt.id,
      group: prompt.group,
      prompt: prompt.prompt,
      mode: prompt.mode,
      requestedLength,
    },
    ok: result.status !== null && result.status >= 200 && result.status < 300 && boolValue(response["success"]),
    status: result.status,
    error: result.error,
    elapsedMs: result.elapsedMs,
    retrieval: {
      retrievalCount,
      structuredRetrievalCount,
      fallbackLevelUsed,
      firstCollapseReason: stringValue(promptSurvivability["firstCollapseReason"]),
    },
    intent: {
      contractSurvivalPercent,
      emotionSurvivalPercent,
      subgenreSurvivalPercent,
      overallSurvivalPercent,
    },
    generation: {
      finalTrackCount,
      artistDiversity: diversityRatio(numberValue(artistDiversity["uniqueArtists"]), finalTrackCount),
      genreDiversity: diversityRatio(Object.keys(finalGenreDistribution).length, finalTrackCount),
      repairCount,
      recoveryCount,
    },
    finalization: {
      finalizationSurvivalPercent,
      eraRelaxationUsed: boolValue(strictEraEvidence["relaxed"]),
      emergencyFillUsed,
    },
    quality: {
      leakCount,
      majorGenreLeak,
      majorEraLeak,
      convergenceRisk: stringValue(convergence["convergenceRisk"]),
      confidenceScore: confidence,
    },
    success,
    promptReliabilityScore: reliabilityScore,
    failureReasons,
    riskScores: {
      fail: clampScore(failRisk),
      drift: clampScore(driftRisk),
      underfill: clampScore(underfillPenalty * 100),
      genreLeak: clampScore(genreLeakRisk),
    },
  };
}

function buildReport(config: BenchmarkConfig, rows: PromptBenchmarkRow[], startedAt: number): BenchmarkReport {
  const successCount = rows.filter((row) => row.success).length;
  const promptReliabilityScore = clampScore(average(rows.map((row) => row.promptReliabilityScore)));
  const sortedBy = (key: keyof PromptBenchmarkRow["riskScores"]): PromptBenchmarkRow[] =>
    [...rows].sort((a, b) =>
      b.riskScores[key] - a.riskScores[key] ||
      a.promptReliabilityScore - b.promptReliabilityScore ||
      a.input.id.localeCompare(b.input.id)
    );
  return {
    generatedAt: new Date().toISOString(),
    commit: localGitHead(),
    run: {
      mode: "audit",
      baseUrl: config.baseUrl,
      promptCount: rows.length,
      requestedLength: config.requestedLength,
      durationMs: Date.now() - startedAt,
    },
    summary: {
      promptReliabilityScore,
      successCount,
      failureCount: rows.length - successCount,
      successRate: rows.length ? Math.round((successCount / rows.length) * 1000) / 10 : 0,
      averageSurvivalPercent: Math.round(average(rows.map((row) => row.intent.overallSurvivalPercent)) * 10) / 10,
      averageConfidenceScore: Math.round(average(rows.map((row) => row.quality.confidenceScore)) * 10) / 10,
      underfilledCount: rows.filter((row) => row.generation.finalTrackCount < Math.ceil(row.input.requestedLength * 0.9)).length,
      genreLeakCount: rows.filter((row) => row.quality.majorGenreLeak).length,
      eraLeakCount: rows.filter((row) => row.quality.majorEraLeak).length,
    },
    rankings: {
      mostLikelyToFail: sortedBy("fail"),
      mostLikelyToDrift: sortedBy("drift"),
      mostLikelyToUnderfill: sortedBy("underfill"),
      mostLikelyToLeakGenres: sortedBy("genreLeak"),
    },
    prompts: rows,
  };
}

function table(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" |")} |`,
    ...rows.map((row) => `| ${row.map((cell) => cell.replace(/\|/g, "\\|")).join(" |")} |`),
  ];
}

function markdownReport(report: BenchmarkReport): string {
  const rows = report.prompts.map((row) => [
    row.input.group,
    row.input.prompt,
    row.success ? "PASS" : "FAIL",
    String(row.promptReliabilityScore),
    `${row.generation.finalTrackCount}/${row.input.requestedLength}`,
    String(row.intent.overallSurvivalPercent),
    String(row.quality.confidenceScore),
    row.failureReasons.join(", ") || "none",
  ]);
  return [
    "# Prompt Reliability Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.run.mode}`,
    `Prompts: ${report.run.promptCount}`,
    `Prompt Reliability Score: ${report.summary.promptReliabilityScore}/100`,
    `Success rate: ${report.summary.successCount}/${report.run.promptCount} (${report.summary.successRate}%)`,
    `Average survival: ${report.summary.averageSurvivalPercent}%`,
    `Average confidence: ${report.summary.averageConfidenceScore}%`,
    "",
    "## Prompt Results",
    ...table(
      ["Group", "Prompt", "Status", "Score", "Tracks", "Survival", "Confidence", "Failure reasons"],
      rows,
    ),
    "",
    "## Acceptance Criteria",
    "- Requested length achieved, or at least 90%",
    "- No major genre leak",
    "- No major era leak",
    "- Survival score at least 70%",
    "- Confidence at least 70%",
    "",
  ].join("\n");
}

function rankingBlock(title: string, rows: PromptBenchmarkRow[], key: keyof PromptBenchmarkRow["riskScores"]): string[] {
  return [
    `## ${title}`,
    "",
    ...table(
      ["Rank", "Prompt", "Group", "Risk", "Score", "Tracks", "Collapse", "Failure reasons"],
      rows.slice(0, 20).map((row, index) => [
        String(index + 1),
        row.input.prompt,
        row.input.group,
        String(row.riskScores[key]),
        String(row.promptReliabilityScore),
        `${row.generation.finalTrackCount}/${row.input.requestedLength}`,
        row.retrieval.firstCollapseReason ?? "none",
        row.failureReasons.join(", ") || "none",
      ]),
    ),
    "",
  ];
}

function rankedFailureMarkdown(report: BenchmarkReport): string {
  return [
    "# Prompt Reliability Ranked Failure Report",
    "",
    `Prompt Reliability Score: ${report.summary.promptReliabilityScore}/100`,
    `Failures: ${report.summary.failureCount}`,
    `Underfilled prompts: ${report.summary.underfilledCount}`,
    `Genre leak prompts: ${report.summary.genreLeakCount}`,
    `Era leak prompts: ${report.summary.eraLeakCount}`,
    "",
    ...rankingBlock("Most Likely To Fail", report.rankings.mostLikelyToFail, "fail"),
    ...rankingBlock("Most Likely To Drift", report.rankings.mostLikelyToDrift, "drift"),
    ...rankingBlock("Most Likely To Underfill", report.rankings.mostLikelyToUnderfill, "underfill"),
    ...rankingBlock("Most Likely To Leak Genres", report.rankings.mostLikelyToLeakGenres, "genreLeak"),
  ].join("\n");
}

async function writeReports(config: BenchmarkConfig, report: BenchmarkReport): Promise<void> {
  await mkdir(config.outDir, { recursive: true });
  await writeFile(path.join(config.outDir, "prompt-reliability-report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(config.outDir, "prompt-reliability-report.md"), markdownReport(report));
  await writeFile(path.join(config.outDir, "prompt-reliability-ranked-failures.md"), rankedFailureMarkdown(report));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const prompts = selectPrompts(config);
  const startedAt = Date.now();
  const rows: PromptBenchmarkRow[] = [];
  if (config.dryRun) {
    const dryRows = prompts.map((prompt): PromptBenchmarkRow => extractRow(prompt, {
      status: null,
      data: {},
      elapsedMs: 0,
      error: "dry_run",
    }));
    const report = buildReport(config, dryRows, startedAt);
    await writeReports(config, report);
    console.log(JSON.stringify({ dryRun: true, outDir: config.outDir, prompts: prompts.length }, null, 2));
    return;
  }
  for (let index = 0; index < prompts.length; index++) {
    const prompt = prompts[index]!;
    console.error(`[${index + 1}/${prompts.length}] ${prompt.prompt}`);
    const result = await postGenerate(config, prompt);
    const row = extractRow(prompt, result);
    rows.push(row);
    console.error(`  ${row.success ? "PASS" : "FAIL"} score=${row.promptReliabilityScore} tracks=${row.generation.finalTrackCount}/${row.input.requestedLength}`);
    if (index < prompts.length - 1 && config.delayMs > 0) await sleep(config.delayMs);
  }
  const report = buildReport(config, rows, startedAt);
  await writeReports(config, report);
  console.log(JSON.stringify({
    outDir: config.outDir,
    promptReliabilityScore: report.summary.promptReliabilityScore,
    successCount: report.summary.successCount,
    failureCount: report.summary.failureCount,
    reports: [
      "prompt-reliability-report.json",
      "prompt-reliability-report.md",
      "prompt-reliability-ranked-failures.md",
    ],
  }, null, 2));
  if (report.summary.failureCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
