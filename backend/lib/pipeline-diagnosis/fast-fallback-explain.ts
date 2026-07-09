/**
 * Diagnosis-only explainer for fast-fallback / timeout-fallback / intent-pool-collapse paths.
 * Does not change generation behaviour.
 */

export type FallbackStageTiming = {
  stage: string;
  ms: number;
  invocations: number;
};

export type FastFallbackExplanation = {
  promptId: string;
  prompt: string;
  success: boolean;
  executionPath?: string;
  fastFallbackFlag: boolean;
  recoveryTriggered: boolean;
  fallbackLevel?: string;
  failureReason?: string;
  totalElapsedMs?: number;
  latencyBudgetExceeded: boolean;
  blockingProductionStage?: string;
  classification: string;
  classificationDetail: string;
  wasSpotifyApi: boolean;
  wasRetrievalTimeout: boolean;
  wasScoringTimeout: boolean;
  wasCandidateExplosion: boolean;
  wasIntentPoolCollapse: boolean;
  was42sFastFallback: boolean;
  stageTimings: FallbackStageTiming[];
  productionTimeline?: Record<string, unknown>;
  executionTrace?: Record<string, unknown>;
  rejectionReasons: string[];
  funnel: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function extractStageTimings(requestStageTiming: Record<string, unknown>): FallbackStageTiming[] {
  const stages = asRecord(requestStageTiming.stages);
  const out: FallbackStageTiming[] = [];
  for (const [stage, raw] of Object.entries(stages)) {
    if (stage === "total") continue;
    const row = asRecord(raw);
    out.push({
      stage,
      ms: num(row.ms) ?? 0,
      invocations: num(row.invocations) ?? 0,
    });
  }
  return out.sort((a, b) => b.ms - a.ms);
}

export function explainFastFallback(input: {
  promptId: string;
  prompt: string;
  response: Record<string, unknown>;
  elapsedMs?: number;
}): FastFallbackExplanation {
  const gen = asRecord(input.response.generationDiagnostics);
  const exec = asRecord(input.response.playlistExecutionTrace);
  const latency = asRecord(gen.latencyBudget);
  const timeline = asRecord(gen.productionTimeline);
  const stageDurations = asRecord(timeline.stageDurationsMs);
  const requestStageTiming = asRecord(gen.requestStageTiming);

  const failureReason = String(gen.failureReason ?? "");
  const fallbackLevel = String(gen.fallbackLevel ?? "");
  const executionPath = String(exec.executionPath ?? input.response.executionPath ?? "");
  const fastFallbackFlag = input.response.fastFallback === true || exec.fastFallbackUsed === true;
  const recoveryTriggered = gen.recoveryTriggered === true;
  const totalElapsedMs = num(input.elapsedMs) ?? num(gen.elapsedMs) ?? num(requestStageTiming.totalMs);
  const latencyBudgetExceeded = gen.latencyBudgetExceeded === true || latency.latencyBudgetExceeded === true;

  const stageTimings = extractStageTimings(requestStageTiming);
  const blockingProductionStage = String(timeline.blocking_stage ?? "");

  const wasIntentPoolCollapse =
    failureReason.includes("intent_pool_collapse") ||
    fallbackLevel === "intent_pool_collapse";
  const was42sFastFallback =
    fastFallbackFlag &&
    !wasIntentPoolCollapse &&
    (totalElapsedMs ?? 0) >= 35_000;
  const candidateFetchMs = num(stageDurations.candidate_fetch) ?? stageTimings.find((s) => s.stage === "candidate_generation")?.ms ?? 0;
  const candidateShapeMs = num(stageDurations.candidate_shape) ?? 0;
  const v3Ms = num(stageDurations.v3_pipeline) ?? stageTimings.find((s) => s.stage === "v3_pipeline")?.ms ?? 0;

  const wasSpotifyApi = candidateFetchMs > 5_000;
  const wasRetrievalTimeout = candidateShapeMs > 10_000 && !wasIntentPoolCollapse;
  const wasScoringTimeout = v3Ms > 15_000 || (was42sFastFallback && blockingProductionStage.includes("v3"));
  const wasCandidateExplosion = candidateShapeMs > 8_000 && candidateFetchMs < 2_000;

  let classification = "unknown";
  let classificationDetail = "Could not classify fallback trigger from stored diagnostics.";

  if (wasIntentPoolCollapse) {
    classification = "intent_pool_collapse";
    classificationDetail =
      `V3 intent pool collapsed after candidate_shape (${candidateShapeMs}ms). ` +
      `Not a latency-budget timeout (elapsed ${totalElapsedMs ?? "?"}ms, budgetExceeded=${latencyBudgetExceeded}). ` +
      `Recovery ${recoveryTriggered ? "ran" : "did not run"} to fill playlist.`;
  } else if (was42sFastFallback) {
    classification = "request_budget_fast_fallback";
    classificationDetail =
      `Pre-V3 work exceeded REQUEST_FAST_FALLBACK_MS (~42s) before pipelineReady. ` +
      `Slowest pre-V3 stage: ${blockingProductionStage || "unknown"}.`;
  } else if (latencyBudgetExceeded) {
    classification = "latency_budget_delivery";
    classificationDetail = "Latency budget forced delivery before V3/scoring completed.";
  } else if (wasSpotifyApi) {
    classification = "spotify_api_slow";
    classificationDetail = `candidate_fetch took ${candidateFetchMs}ms — likely Spotify/API bound.`;
  } else if (wasRetrievalTimeout) {
    classification = "retrieval_or_shape_slow";
    classificationDetail = `candidate_shape took ${candidateShapeMs}ms — retrieval/shape bound.`;
  } else if (wasScoringTimeout) {
    classification = "scoring_timeout";
    classificationDetail = `v3_pipeline took ${v3Ms}ms — scoring bound.`;
  } else if (fastFallbackFlag || executionPath.includes("fallback")) {
    classification = "early_fallback_recovery";
    classificationDetail =
      `Fallback/recovery path in ${totalElapsedMs ?? "?"}ms. ` +
      `executionPath=${executionPath || "n/a"}, fallbackLevel=${fallbackLevel || "n/a"}.`;
  }

  const rejectionReasons = [
    ...asArray<string>(exec.rejectionReasons),
    ...asArray<string>(gen.rejectionReasons),
  ];

  const funnel: string[] = [];
  const trackCounts = asRecord(exec.trackCounts);
  if (Object.keys(trackCounts).length > 0) {
    funnel.push(
      `retrieved=${trackCounts.retrieved ?? 0} → after_world=${trackCounts.after_world ?? 0} → after_sampler=${trackCounts.after_sampler ?? 0} → final=${trackCounts.final ?? 0}`,
    );
  }
  for (const stage of ["retrieval", "scene_world", "sampler", "interleaver", "editorial_audit"]) {
    const attr = asRecord(asRecord(exec.stageAttribution)[stage]);
    if (attr.status) funnel.push(`${stage}: ${attr.status}`);
  }

  return {
    promptId: input.promptId,
    prompt: input.prompt,
    success: input.response.success === true,
    executionPath: executionPath || undefined,
    fastFallbackFlag,
    recoveryTriggered,
    fallbackLevel: fallbackLevel || undefined,
    failureReason: failureReason || undefined,
    totalElapsedMs,
    latencyBudgetExceeded,
    blockingProductionStage: blockingProductionStage || undefined,
    classification,
    classificationDetail,
    wasSpotifyApi,
    wasRetrievalTimeout,
    wasScoringTimeout,
    wasCandidateExplosion,
    wasIntentPoolCollapse,
    was42sFastFallback,
    stageTimings,
    productionTimeline: Object.keys(timeline).length > 0 ? timeline : undefined,
    executionTrace: Object.keys(exec).length > 0 ? exec : undefined,
    rejectionReasons,
    funnel,
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function renderFastFallbackMarkdown(explanation: FastFallbackExplanation): string {
  const lines: string[] = [
    `### ${explanation.promptId}`,
    `**Prompt:** ${explanation.prompt}`,
    `**Success:** ${explanation.success}`,
    `**Classification:** \`${explanation.classification}\``,
    `**Detail:** ${explanation.classificationDetail}`,
    "",
    "| Signal | Value |",
    "| --- | --- |",
    `| executionPath | ${explanation.executionPath ?? "—"} |`,
    `| fallbackLevel | ${explanation.fallbackLevel ?? "—"} |`,
    `| failureReason | ${explanation.failureReason ?? "—"} |`,
    `| totalElapsedMs | ${explanation.totalElapsedMs ?? "—"} |`,
    `| latencyBudgetExceeded | ${explanation.latencyBudgetExceeded} |`,
    `| blockingProductionStage | ${explanation.blockingProductionStage ?? "—"} |`,
    `| recoveryTriggered | ${explanation.recoveryTriggered} |`,
    `| 42s fast fallback | ${explanation.was42sFastFallback} |`,
    `| Spotify API slow | ${explanation.wasSpotifyApi} |`,
    `| retrieval/shape slow | ${explanation.wasRetrievalTimeout} |`,
    `| scoring timeout | ${explanation.wasScoringTimeout} |`,
    `| intent pool collapse | ${explanation.wasIntentPoolCollapse} |`,
    "",
  ];

  if (explanation.stageTimings.length > 0) {
    lines.push("#### Request stage timings (top)");
    lines.push("| Stage | ms | invocations |");
    lines.push("| --- | ---: | ---: |");
    for (const row of explanation.stageTimings.slice(0, 10)) {
      lines.push(`| ${row.stage} | ${row.ms} | ${row.invocations} |`);
    }
    lines.push("");
  }

  if (explanation.funnel.length > 0) {
    lines.push("#### Pipeline funnel");
    for (const row of explanation.funnel) lines.push(`- ${row}`);
    lines.push("");
  }

  if (explanation.rejectionReasons.length > 0) {
    lines.push("#### Rejection reasons");
    for (const reason of explanation.rejectionReasons) lines.push(`- ${reason}`);
    lines.push("");
  }

  return lines.join("\n");
}
