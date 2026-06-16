import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  qualityScore,
  summarizeEvaluation,
  type EvaluationSummaryMetrics,
  type GenerationEvaluationResult,
  type PlaylistMetrics,
} from "./metrics";

export type EvaluationReportPayload = {
  generatedAt: string;
  run: {
    mode: "audit" | "live-api";
    baseUrl: string;
    promptCount: number;
    concurrency: number;
    delayMs: number;
    allowSpotifyCreate: boolean;
    allowDbWrites: boolean;
    durationMs: number;
  };
  rawResults: GenerationEvaluationResult[];
  summary: EvaluationSummaryMetrics;
  spotifyApiMetrics: SpotifyBenchmarkMetrics;
  benchmarkSizeReports: SpotifyBenchmarkMetrics[];
  offlineAuditModeDesign: OfflineAuditModeDesign;
  bestPlaylists: Array<PlaylistMetrics & { qualityScore: number }>;
  worstPlaylists: Array<PlaylistMetrics & { qualityScore: number }>;
  architecturalWeaknesses: Array<{ weakness: string; evidence: string; severity: number }>;
};

export type SpotifyBenchmarkMetrics = {
  benchmarkSize: number;
  runtimeMs: number;
  averageGenerationTimeMs: number;
  p95GenerationTimeMs: number;
  totalSpotifyRequests: number;
  requestsPerPlaylist: number;
  requestsByEndpoint: Array<{
    endpoint: string;
    requests: number;
    retries: number;
    rateLimitResponses: number;
    failures: number;
  }>;
  cacheHitPercent: number;
  cacheMissPercent: number;
  failures: number;
  retries: number;
  rateLimitEvents: number;
};

export type OfflineAuditModeDesign = {
  shouldBuild: boolean;
  reason: string;
  triggerThreshold: string;
  design: string[];
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function rowScore(row: PlaylistMetrics): PlaylistMetrics & { qualityScore: number } {
  return { ...row, qualityScore: qualityScore(row) };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index] ?? 0);
}

function cacheStatus(result: GenerationEvaluationResult): string {
  const cache = obj(result.response?.["cacheDiagnostics"]);
  return typeof cache["status"] === "string" ? cache["status"] : "miss";
}

function computeSpotifyBenchmarkMetrics(results: GenerationEvaluationResult[], benchmarkSize: number): SpotifyBenchmarkMetrics {
  const rows = results.slice(0, benchmarkSize);
  const endpointMap = new Map<string, { endpoint: string; requests: number; retries: number; rateLimitResponses: number; failures: number }>();
  let totalSpotifyRequests = 0;
  let retries = 0;
  let rateLimitEvents = 0;
  for (const result of rows) {
    const audit = obj(result.response?.["spotifyApiAudit"]);
    totalSpotifyRequests += num(audit["totalRequests"]);
    retries += num(audit["retries"]);
    rateLimitEvents += num(audit["rateLimitResponses"]);
    const endpoints = Array.isArray(audit["byEndpoint"]) ? audit["byEndpoint"] as Array<Record<string, unknown>> : [];
    for (const endpoint of endpoints) {
      const key = typeof endpoint["endpoint"] === "string" ? endpoint["endpoint"] : "unknown";
      const row = endpointMap.get(key) ?? { endpoint: key, requests: 0, retries: 0, rateLimitResponses: 0, failures: 0 };
      row.requests += num(endpoint["requests"]);
      row.retries += num(endpoint["retries"]);
      row.rateLimitResponses += num(endpoint["rateLimitResponses"]);
      row.failures += num(endpoint["failures"]);
      endpointMap.set(key, row);
    }
  }
  const cacheHits = rows.filter((result) => cacheStatus(result) === "fresh").length;
  const cacheMisses = rows.length - cacheHits;
  const generationTimes = rows.map((result) => result.elapsedMs);
  return {
    benchmarkSize: rows.length,
    runtimeMs: Math.round(generationTimes.reduce((sum, value) => sum + value, 0)),
    averageGenerationTimeMs: rows.length ? Math.round(generationTimes.reduce((sum, value) => sum + value, 0) / rows.length) : 0,
    p95GenerationTimeMs: percentile(generationTimes, 95),
    totalSpotifyRequests,
    requestsPerPlaylist: rows.length ? Math.round((totalSpotifyRequests / rows.length) * 1000) / 1000 : 0,
    requestsByEndpoint: [...endpointMap.values()].sort((a, b) => b.requests - a.requests || a.endpoint.localeCompare(b.endpoint)),
    cacheHitPercent: rows.length ? Math.round((cacheHits / rows.length) * 1000) / 10 : 0,
    cacheMissPercent: rows.length ? Math.round((cacheMisses / rows.length) * 1000) / 10 : 0,
    failures: rows.filter((result) => !result.ok).length,
    retries,
    rateLimitEvents,
  };
}

function offlineAuditModeDesign(metrics: SpotifyBenchmarkMetrics): OfflineAuditModeDesign {
  const heavy = metrics.requestsPerPlaylist >= 1 || metrics.rateLimitEvents > 0;
  return {
    shouldBuild: heavy,
    reason: heavy
      ? "Evaluation still depends on Spotify during generation, which can distort benchmark reliability and create rate-limit risk."
      : "Current audit runs are not heavily dependent on Spotify per playlist; offline mode is optional but still useful for reproducible CI.",
    triggerThreshold: "Build Offline Audit Mode if requestsPerPlaylist >= 1, rateLimitEvents > 0, or p95GenerationTimeMs is dominated by Spotify latency.",
    design: [
      "Hydrate a local evaluation snapshot from the synced liked_songs table, genre/profile caches, and any persisted audio metadata before the benchmark starts.",
      "Run generation against that immutable snapshot using the same production scoring/finalization/coherence code, with network clients replaced by read-only snapshot adapters.",
      "Disable no-library Spotify search and reference-playlist hydration unless a reference snapshot has been pre-hydrated.",
      "Record snapshot version, user id, track count, metadata coverage, and cache timestamps in every evaluation report.",
      "Fail fast when required metadata coverage is below a configured threshold instead of silently calling Spotify.",
      "Keep Live API Mode only for periodic parity checks against Spotify behavior, not for routine benchmark iteration.",
    ],
  };
}

function rankWorst(rows: PlaylistMetrics[]): Array<PlaylistMetrics & { qualityScore: number }> {
  return rows
    .map(rowScore)
    .sort((a, b) =>
      a.qualityScore - b.qualityScore ||
      b.failureModes.length - a.failureModes.length ||
      b.crossPlaylistOverlap - a.crossPlaylistOverlap,
    );
}

function rankBest(rows: PlaylistMetrics[]): Array<PlaylistMetrics & { qualityScore: number }> {
  return rows
    .map(rowScore)
    .sort((a, b) =>
      b.qualityScore - a.qualityScore ||
      a.failureModes.length - b.failureModes.length ||
      b.humanCoherenceScore - a.humanCoherenceScore,
    );
}

function inferArchitecturalWeaknesses(summary: EvaluationSummaryMetrics): Array<{ weakness: string; evidence: string; severity: number }> {
  const total = Math.max(1, summary.playlists.length);
  const failureCount = (mode: string) => summary.failureModes.find((row) => row.mode === mode)?.count ?? 0;
  const repeatedArtists = summary.mostRepeatedArtists.filter((row) => row.playlists >= Math.max(4, total * 0.08));
  const weakCategories = summary.categorySummaries.filter((row) => row.averageQuality < 0.58);
  const fallbackHeavy = summary.categorySummaries.filter((row) => row.fallbackRate >= 0.25);
  const highOverlap = summary.playlists.filter((row) => row.crossPlaylistOverlap >= 0.35).length;
  const weaknesses = [
    failureCount("high_cross_playlist_overlap") || highOverlap
      ? {
          weakness: "Cross-playlist uniqueness is weak",
          evidence: `${highOverlap} playlists have at least 35% overlap with another benchmark result.`,
          severity: highOverlap / total,
        }
      : null,
    repeatedArtists.length
      ? {
          weakness: "Upstream artist gravity still dominates some results",
          evidence: `${repeatedArtists.slice(0, 8).map((row) => `${row.artist} (${row.playlists} playlists)`).join(", ")} appear across many unrelated prompts.`,
          severity: repeatedArtists.length / Math.max(1, summary.mostRepeatedArtists.length),
        }
      : null,
    failureCount("genre_drift")
      ? {
          weakness: "Genre intent can drift after selection or recovery",
          evidence: `${failureCount("genre_drift")} playlists breached the genre drift threshold.`,
          severity: failureCount("genre_drift") / total,
        }
      : null,
    failureCount("era_drift")
      ? {
          weakness: "Era evidence remains fragile",
          evidence: `${failureCount("era_drift")} era-specific playlists missed their requested era window.`,
          severity: failureCount("era_drift") / total,
        }
      : null,
    failureCount("weak_persona_adherence")
      ? {
          weakness: "Playlist identity/persona adherence is inconsistent",
          evidence: `${failureCount("weak_persona_adherence")} playlists scored below persona adherence threshold.`,
          severity: failureCount("weak_persona_adherence") / total,
        }
      : null,
    failureCount("low_cluster_purity")
      ? {
          weakness: "Cluster discipline is weak for some prompts",
          evidence: `${failureCount("low_cluster_purity")} playlists spread across too many clusters to feel curated.`,
          severity: failureCount("low_cluster_purity") / total,
        }
      : null,
    fallbackHeavy.length
      ? {
          weakness: "Recovery/fallback is overused in specific categories",
          evidence: `${fallbackHeavy.map((row) => `${row.category} (${pct(row.fallbackRate)})`).join(", ")} are fallback-heavy.`,
          severity: fallbackHeavy.length / Math.max(1, summary.categorySummaries.length),
        }
      : null,
    weakCategories.length
      ? {
          weakness: "Certain prompt categories are structurally weaker",
          evidence: `${weakCategories.map((row) => `${row.category} (${pct(row.averageQuality)})`).join(", ")} have low average quality.`,
          severity: weakCategories.length / Math.max(1, summary.categorySummaries.length),
        }
      : null,
  ];
  return weaknesses
    .filter((value): value is { weakness: string; evidence: string; severity: number } => !!value)
    .sort((a, b) => b.severity - a.severity)
    .map((row) => ({ ...row, severity: Math.round(row.severity * 1000) / 1000 }));
}

function playlistBlock(row: PlaylistMetrics & { qualityScore: number }, rank: number): string {
  return [
    `## ${rank}. ${row.promptId}`,
    `- Prompt: ${row.prompt}`,
    `- Playlist title: ${row.playlistTitle}`,
    `- Quality score: ${pct(row.qualityScore)}`,
    `- Coherence score: ${pct(row.humanCoherenceScore)}`,
    `- Persona: ${row.persona ?? "unknown"}`,
    `- Dominant cluster: ${row.dominantCluster ?? "unknown"} (${pct(row.clusterPurity)} purity)`,
    `- Overlap metrics: cross-playlist ${pct(row.crossPlaylistOverlap)}, uniqueness ${pct(row.playlistUniqueness)}`,
    `- Drift: genre ${pct(row.genreDrift)}, era ${pct(row.eraDrift)}`,
    `- Repetition: artist ${pct(row.artistRepetition)}, track ${pct(row.trackRepetition)}`,
    `- Likely cause: ${row.likelyCause}`,
    `- Failure modes: ${row.failureModes.length ? row.failureModes.join(", ") : "none"}`,
    "",
  ].join("\n");
}

function summaryMarkdown(report: EvaluationReportPayload): string {
  const summary = report.summary;
  const bestCategories = [...summary.categorySummaries].sort((a, b) => b.averageQuality - a.averageQuality).slice(0, 8);
  const worstCategories = [...summary.categorySummaries].sort((a, b) => a.averageQuality - b.averageQuality).slice(0, 8);
  const empty = summary.playlists.filter((row) => row.trackCount === 0);
  const fallback = summary.playlists.filter((row) => row.fallbackUsed);
  const weakIdentity = summary.playlists.filter((row) => row.personaAdherence < 0.5);
  return [
    "# Playlist Evaluation Summary",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.run.mode}`,
    `Prompts: ${report.run.promptCount}`,
    `Spotify writes enabled: ${report.run.allowSpotifyCreate}`,
    `DB writes enabled: ${report.run.allowDbWrites}`,
    `Duration: ${Math.round(report.run.durationMs / 1000)}s`,
    `Spotify requests: ${report.spotifyApiMetrics.totalSpotifyRequests} (${report.spotifyApiMetrics.requestsPerPlaylist} per playlist)`,
    `Cache: ${report.spotifyApiMetrics.cacheHitPercent}% hit, ${report.spotifyApiMetrics.cacheMissPercent}% miss`,
    `Generation time: avg ${report.spotifyApiMetrics.averageGenerationTimeMs}ms, p95 ${report.spotifyApiMetrics.p95GenerationTimeMs}ms`,
    "",
    "## Production Stability Lock",
    `- Regression risk level: ${summary.stabilityStatus.regressionRiskLevel}`,
    `- Safe to tune further: ${summary.stabilityStatus.safeToTuneFurther}`,
    `- Active risks: ${summary.stabilityStatus.activeRisks.length}`,
    ...summary.stabilityStatus.activeRisks.map((risk) => `- ${risk.severity.toUpperCase()} ${risk.rule}: ${risk.evidence}`),
    "",
    "## Locked Behaviour Contract",
    ...summary.stabilityStatus.lockedBehaviours.map((behaviour) => `- ${behaviour}`),
    "",
    "## Launch Readiness Score",
    `- Overall quality: ${pct(summary.launchReadiness.overallQualityScore)}`,
    `- Prompt coverage: ${pct(summary.launchReadiness.promptCoverageScore)}`,
    `- Human realism: ${pct(summary.launchReadiness.humanRealismScore)}`,
    `- Scene accuracy: ${pct(summary.launchReadiness.sceneAccuracyScore)}`,
    `- Era accuracy: ${pct(summary.launchReadiness.eraAccuracyScore)}`,
    `- Emotional accuracy: ${pct(summary.launchReadiness.emotionalAccuracyScore)}`,
    `- Transition quality: ${pct(summary.launchReadiness.transitionQualityScore)}`,
    `- Launch readiness: ${pct(summary.launchReadiness.launchReadinessScore)}`,
    "",
    "## Quality Failure Dataset",
    ...summary.qualityFailureDataset.map((row) => `- ${row.category}: ${row.frequency} examples, severity ${pct(row.severity)}${row.examples[0] ? `; example ${row.examples[0].promptId} — ${row.examples[0].evidence}` : ""}`),
    "",
    "## Quality Calibration Contributions",
    ...summary.qualityCalibration.map((row) => `- ${row.system}: contribution ${pct(row.measurableContribution)}; ${row.positiveEvidence.join(" ") || "No positive evidence."}${row.negativeEvidence.length ? ` Risk: ${row.negativeEvidence.join(" ")}` : ""}`),
    "",
    "## Worst Transition Quality",
    ...summary.transitionQualityReports.slice(0, 20).map((row) => `- ${row.promptId}: ${pct(row.transitionQuality)} transition quality, ${row.harshTransitionCount} harsh transitions, avg energy jump ${row.averageEnergyJump}, avg valence jump ${row.averageValenceJump}`),
    "",
    "## Prompt Confidence Collapses",
    ...summary.promptUnderstandingConfidence
      .filter((row) => row.collapsedDimensions.length > 0)
      .slice(0, 30)
      .map((row) => `- ${row.promptId}: ${row.collapsedDimensions.join(", ")} collapsed; intent ${pct(row.intentConfidence)}, scene ${pct(row.sceneConfidence)}, emotion ${pct(row.emotionConfidence)}, era ${pct(row.eraConfidence)}, activity ${pct(row.activityConfidence)}`),
    "",
    "## Top Remaining Improvements",
    ...summary.topRemainingImprovements.map((row) => `${row.rank}. ${row.improvement}: ROI ${row.estimatedROI}, frequency ${row.frequency}. Evidence: ${row.evidence}`),
    "",
    "## Benchmark Size Reports",
    ...report.benchmarkSizeReports.map((row) => `- ${row.benchmarkSize} playlists: runtime ${Math.round(row.runtimeMs / 1000)}s, Spotify requests ${row.totalSpotifyRequests}, ${row.requestsPerPlaylist}/playlist, cache ${row.cacheHitPercent}% hit, failures ${row.failures}, retries ${row.retries}, rate limits ${row.rateLimitEvents}`),
    "",
    "## Spotify Requests By Endpoint",
    ...report.spotifyApiMetrics.requestsByEndpoint.slice(0, 20).map((row) => `- ${row.endpoint}: ${row.requests} requests, ${row.retries} retries, ${row.rateLimitResponses} rate limits, ${row.failures} failures`),
    "",
    "## Offline Audit Mode Design",
    `Recommendation: ${report.offlineAuditModeDesign.shouldBuild ? "Design is warranted before large repeated benchmark runs." : "Design is documented; implementation can wait unless request volume rises."}`,
    `Reason: ${report.offlineAuditModeDesign.reason}`,
    ...report.offlineAuditModeDesign.design.map((item) => `- ${item}`),
    "",
    "## Best Performing Prompt Categories",
    ...bestCategories.map((row) => `- ${row.category}: ${pct(row.averageQuality)} quality, ${pct(row.fallbackRate)} fallback, ${pct(row.averageCoherence)} coherence`),
    "",
    "## Worst Performing Prompt Categories",
    ...worstCategories.map((row) => `- ${row.category}: ${pct(row.averageQuality)} quality, ${pct(row.fallbackRate)} fallback, ${row.emptyCount} empty, ${pct(row.averageOverlap)} overlap`),
    "",
    "## Most Common Failure Modes",
    ...summary.failureModes.slice(0, 15).map((row) => `- ${row.mode}: ${row.count} prompts`),
    "",
    "## Most Repeated Artists",
    ...summary.mostRepeatedArtists.slice(0, 20).map((row) => `- ${row.artist}: ${row.appearances} tracks across ${row.playlists} playlists`),
    "",
    "## Fallback-Heavy Playlists",
    ...fallback.slice(0, 30).map((row) => `- ${row.promptId}: ${row.prompt} (${row.likelyCause})`),
    "",
    "## Prompts Producing Weak Identity",
    ...weakIdentity.slice(0, 30).map((row) => `- ${row.promptId}: ${pct(row.personaAdherence)} persona adherence, ${row.persona ?? "unknown"} persona`),
    "",
    "## Prompts Producing Empty Results",
    ...(empty.length ? empty.map((row) => `- ${row.promptId}: ${row.prompt}`) : ["- None"]),
    "",
    "## Ranked Architectural Weaknesses",
    ...report.architecturalWeaknesses.map((row, index) => `${index + 1}. ${row.weakness}: ${row.evidence}`),
    "",
  ].join("\n");
}

export async function writeEvaluationReports(input: {
  outDir: string;
  generatedAt: string;
  run: EvaluationReportPayload["run"];
  results: GenerationEvaluationResult[];
}): Promise<EvaluationReportPayload> {
  const summary = summarizeEvaluation(input.results);
  const benchmarkSizeReports = [10, 50, 100, 250]
    .filter((size) => input.results.length >= size)
    .map((size) => computeSpotifyBenchmarkMetrics(input.results, size));
  const spotifyApiMetrics = computeSpotifyBenchmarkMetrics(input.results, input.results.length);
  const bestPlaylists = rankBest(summary.playlists).slice(0, 50);
  const worstPlaylists = rankWorst(summary.playlists).slice(0, 50);
  const architecturalWeaknesses = inferArchitecturalWeaknesses(summary);
  const report: EvaluationReportPayload = {
    generatedAt: input.generatedAt,
    run: input.run,
    rawResults: input.results,
    summary,
    spotifyApiMetrics,
    benchmarkSizeReports,
    offlineAuditModeDesign: offlineAuditModeDesign(spotifyApiMetrics),
    bestPlaylists,
    worstPlaylists,
    architecturalWeaknesses,
  };
  await mkdir(input.outDir, { recursive: true });
  await writeFile(path.join(input.outDir, "evaluation-report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(input.outDir, "failure-modes.json"), JSON.stringify(summary.failureModes, null, 2));
  await writeFile(path.join(input.outDir, "quality-failure-dataset.json"), JSON.stringify(summary.qualityFailureDataset, null, 2));
  await writeFile(path.join(input.outDir, "prompt-confidence.json"), JSON.stringify(summary.promptUnderstandingConfidence, null, 2));
  await writeFile(path.join(input.outDir, "transition-quality.json"), JSON.stringify(summary.transitionQualityReports, null, 2));
  await writeFile(path.join(input.outDir, "launch-readiness.json"), JSON.stringify(summary.launchReadiness, null, 2));
  await writeFile(path.join(input.outDir, "stability-status.json"), JSON.stringify(summary.stabilityStatus, null, 2));
  await writeFile(path.join(input.outDir, "quality-calibration.json"), JSON.stringify(summary.qualityCalibration, null, 2));
  await writeFile(path.join(input.outDir, "top-remaining-improvements.json"), JSON.stringify(summary.topRemainingImprovements, null, 2));
  await writeFile(path.join(input.outDir, "top-50-best-playlists.md"), [
    "# Top 50 Best Playlists",
    "",
    ...bestPlaylists.map((row, index) => playlistBlock(row, index + 1)),
  ].join("\n"));
  await writeFile(path.join(input.outDir, "top-50-worst-playlists.md"), [
    "# Top 50 Worst Playlists",
    "",
    ...worstPlaylists.map((row, index) => playlistBlock(row, index + 1)),
  ].join("\n"));
  await writeFile(path.join(input.outDir, "evaluation-summary.md"), summaryMarkdown(report));
  return report;
}

