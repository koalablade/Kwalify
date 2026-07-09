/**
 * Extract stage-by-stage pipeline traces from audit / debug generate responses.
 * Diagnosis only — no generation behaviour changes.
 */

export type TrackRef = {
  trackId: string;
  artistName?: string;
  trackName?: string;
  score?: number;
  rank?: number;
  source?: string;
};

export type FilterStageCount = {
  stage: string;
  beforeCount?: number;
  afterCount?: number;
  removedCount?: number;
  metadata?: Record<string, unknown>;
};

export type RejectionRecord = {
  reason: string;
  trackId?: string;
  artistName?: string;
  trackName?: string;
  source?: string;
  count?: number;
};

export type ScoreDistribution = {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  histogram: Array<{ bucket: string; count: number }>;
};

export type PipelineStageSnapshot = {
  stageId: string;
  label: string;
  trackIds: string[];
  orderedTrackIds?: string[];
  candidateCount?: number;
  metadata?: Record<string, unknown>;
};

export type ExtractedPipelineTrace = {
  promptId: string;
  source: "stored" | "live";
  success: boolean;
  failureCode?: string;
  fastFallback: boolean;
  recoveryTriggered: boolean;
  elapsedMs?: number;
  retrieval: {
    applied: boolean;
    strategy?: string;
    inputCount?: number;
    outputCount?: number;
    bySource: Record<string, number>;
    sourceQuotaPct: Record<string, number>;
    topRejected: RejectionRecord[];
    orchestrator?: Record<string, unknown>;
    validCandidateSupply?: Record<string, unknown>;
    libraryCapability?: Record<string, unknown>;
    combinedConfidence?: number;
    retrievalAttempts?: number;
  };
  filterStages: FilterStageCount[];
  scoreDistributionBeforeHybrid: ScoreDistribution | null;
  top20EnteringScoring: TrackRef[];
  top20AfterScoring: TrackRef[];
  finalPlaylist: TrackRef[];
  rejectionReasons: RejectionRecord[];
  intentStageCounts: Array<{ stage: string; evidence: Record<string, unknown> }>;
  executionPath?: string;
  rawCaps?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function trackIdFromUnknown(track: unknown): string | null {
  const row = asRecord(track);
  const id = text(row.trackId) ?? text(row.id) ?? text(row.spotifyTrackId);
  return id ?? null;
}

function mapTrackRefs(
  items: unknown[],
  scoreKey = "score",
  limit = 20,
): TrackRef[] {
  const out: TrackRef[] = [];
  for (let i = 0; i < items.length && out.length < limit; i += 1) {
    const row = asRecord(items[i]);
    const trackId = trackIdFromUnknown(row);
    if (!trackId) continue;
    out.push({
      trackId,
      artistName: text(row.artistName) ?? text(row.artist),
      trackName: text(row.trackName) ?? text(row.name) ?? text(row.title),
      score: num(row[scoreKey]) ?? num(row.finalScore) ?? num(row.hybridScore) ?? num(row.totalScore),
      rank: out.length + 1,
      source: text(row.source) ?? text(row.retrievalSource),
    });
  }
  return out;
}

function resolveCandidateRetrieval(response: Record<string, unknown>): Record<string, unknown> {
  const top = response["candidateRetrieval"];
  if (top) return asRecord(top);
  const gen = asRecord(response["generationDiagnostics"]);
  return asRecord(gen["candidateRetrieval"]);
}

function resolveOrchestrator(
  response: Record<string, unknown>,
  retrieval: Record<string, unknown>,
): Record<string, unknown> {
  const top = asRecord(response["retrievalOrchestrator"]);
  if (Object.keys(top).length > 0) return top;
  return asRecord(retrieval["orchestrator"]);
}

function resolveV3(response: Record<string, unknown>): Record<string, unknown> {
  return asRecord(response["v3Diagnostics"]);
}

function resolveDebug(response: Record<string, unknown>): Record<string, unknown> {
  return asRecord(response["debug"]) || asRecord(response["_debug"]);
}

function distributionFromScores(scores: number[]): ScoreDistribution | null {
  if (scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] ?? 0;
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const buckets = new Map<string, number>();
  for (const score of scores) {
    const bucket = `${Math.floor(score * 10) / 10}-${Math.floor(score * 10) / 10 + 0.1}`;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return {
    count: scores.length,
    min,
    max,
    mean: Math.round(mean * 1000) / 1000,
    median: pick(0.5),
    p10: pick(0.1),
    p90: pick(0.9),
    histogram: [...buckets.entries()].map(([bucket, count]) => ({ bucket, count })),
  };
}

function extractScoreDistribution(
  v3: Record<string, unknown>,
  debug: Record<string, unknown>,
  preV3: TrackRef[],
): ScoreDistribution | null {
  const scoringPool = asRecord(v3["scoringPool"]);
  const laneScores = asArray<unknown>(scoringPool["laneScores"] ?? scoringPool["preHybridScores"]);
  const scoresFromPool = laneScores
    .map((row) => num(asRecord(row).score ?? asRecord(row).hybridScore))
    .filter((n): n is number => n !== undefined);
  if (scoresFromPool.length > 0) return distributionFromScores(scoresFromPool);

  const debugScores = asArray<unknown>(debug["preHybridScoreSample"] ?? debug["scoreSample"]);
  const fromDebug = debugScores.map((v) => num(v)).filter((n): n is number => n !== undefined);
  if (fromDebug.length > 0) return distributionFromScores(fromDebug);

  const fromPreV3 = preV3.map((t) => t.score).filter((n): n is number => n !== undefined);
  if (fromPreV3.length >= 5) return distributionFromScores(fromPreV3);
  return null;
}

function extractFilterStages(
  v3: Record<string, unknown>,
  gen: Record<string, unknown>,
  intentSurvival: Record<string, unknown>,
): FilterStageCount[] {
  const stages: FilterStageCount[] = [];
  const forensic = asRecord(v3["forensicPoolTrace"]);
  for (const raw of asArray<unknown>(forensic["stages"])) {
    const row = asRecord(raw);
    const stage = text(row.stage) ?? text(row.name) ?? "unknown";
    stages.push({
      stage,
      beforeCount: num(row.beforeCount) ?? num(row.inputCount) ?? num(row.poolBefore),
      afterCount: num(row.afterCount) ?? num(row.outputCount) ?? num(row.poolAfter),
      removedCount: num(row.removedCount) ?? num(row.removed),
      metadata: row,
    });
  }

  const waterfall = asRecord(gen["waterfall"] ?? gen["promptSurvivability"]);
  if (Object.keys(waterfall).length > 0) {
    stages.push({
      stage: "waterfall",
      beforeCount: num(waterfall.libraryCount) ?? num(waterfall.inputCount),
      afterCount: num(waterfall.scoredCount) ?? num(waterfall.outputCount),
      metadata: waterfall,
    });
  }

  for (const raw of asArray<unknown>(intentSurvival["stageTrace"])) {
    const row = asRecord(raw);
    const stage = text(row.stage);
    if (!stage) continue;
    const evidence = asRecord(row.evidence);
    const count =
      num(evidence.candidateCount) ??
      num(evidence.libraryCount) ??
      num(evidence.scoredCount) ??
      num(evidence.outputCount);
    if (count !== undefined) {
      stages.push({
        stage: `intent:${stage}`,
        afterCount: count,
        metadata: evidence,
      });
    }
  }

  return stages;
}

function extractRejections(
  v3: Record<string, unknown>,
  gen: Record<string, unknown>,
  retrieval: Record<string, unknown>,
): RejectionRecord[] {
  const out: RejectionRecord[] = [];
  const seen = new Set<string>();

  const push = (row: RejectionRecord) => {
    const key = `${row.reason}|${row.trackId ?? ""}|${row.source ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };

  for (const raw of asArray<unknown>(v3["removalReasons"] ?? gen["removalReasons"])) {
    if (typeof raw === "string") {
      push({ reason: raw });
      continue;
    }
    const row = asRecord(raw);
    push({
      reason: text(row.reason) ?? text(row.code) ?? "removed",
      trackId: trackIdFromUnknown(row) ?? undefined,
      artistName: text(row.artistName),
      trackName: text(row.trackName),
      source: text(row.source),
      count: num(row.count),
    });
  }

  for (const raw of asArray<unknown>(retrieval["topRejected"])) {
    const row = asRecord(raw);
    push({
      reason: text(row.reason) ?? "retrieval_rejected",
      trackId: trackIdFromUnknown(row) ?? undefined,
      artistName: text(row.artistName),
      trackName: text(row.trackName),
      source: text(row.source),
    });
  }

  for (const raw of asArray<unknown>(asRecord(v3["intentContractGuard"])["rejectionLog"])) {
    const row = asRecord(raw);
    push({
      reason: text(row.reason) ?? text(row.code) ?? "contract_rejected",
      trackId: trackIdFromUnknown(row) ?? undefined,
      count: num(row.count),
    });
  }

  return out;
}

function extractTopAfterScoring(v3: Record<string, unknown>, debug: Record<string, unknown>): TrackRef[] {
  const selectionTrace = asArray<unknown>(v3["selectionTrace"]);
  if (selectionTrace.length > 0) return mapTrackRefs(selectionTrace, "score", 20);

  const lanes = asRecord(v3["lanes"]);
  const ranked = asArray<unknown>(lanes["ranked"] ?? lanes["topCandidates"]);
  if (ranked.length > 0) return mapTrackRefs(ranked, "score", 20);

  const debugRanked = asArray<unknown>(asRecord(debug["scoringDiagnostics"])["topRanked"]);
  if (debugRanked.length > 0) return mapTrackRefs(debugRanked, "score", 20);

  return [];
}

export function extractPipelineTrace(
  promptId: string,
  response: Record<string, unknown>,
  source: "stored" | "live",
): ExtractedPipelineTrace {
  const gen = asRecord(response["generationDiagnostics"]);
  const v3 = resolveV3(response);
  const debug = resolveDebug(response);
  const retrieval = resolveCandidateRetrieval(response);
  const orchestrator = resolveOrchestrator(response, retrieval);
  const orchestratorRetrieval = asRecord(orchestrator["retrievalDiagnostics"]);
  const intentSurvival = asRecord(response["intentSurvival"]);

  const preV3Raw =
    v3["preV3TopCandidates"] ??
    asRecord(debug["scoringDiagnostics"])["preV3TopCandidates"] ??
    asRecord(debug["debug"])["preV3TopCandidates"] ??
    [];
  const top20Entering = mapTrackRefs(asArray(preV3Raw), "preScore", 20);
  const top20After = extractTopAfterScoring(v3, debug);

  const tracks = asArray<unknown>(response["tracks"]);
  const finalPlaylist = mapTrackRefs(tracks, "score", tracks.length);

  const bySource = {
    ...(asRecord(orchestratorRetrieval["sourceDistribution"]) as Record<string, number>),
    ...(asRecord(retrieval["sourceDistribution"]) as Record<string, number>),
  };
  const sourceQuotaPct = {
    ...(asRecord(orchestratorRetrieval["sourceQuotaPct"]) as Record<string, number>),
    ...(asRecord(retrieval["sourceQuotaPct"]) as Record<string, number>),
  };

  const intentStageCounts = asArray<unknown>(intentSurvival["stageTrace"]).map((raw) => {
    const row = asRecord(raw);
    return {
      stage: text(row.stage) ?? "unknown",
      evidence: asRecord(row.evidence),
    };
  });

  const executionTrace = asRecord(response["playlistExecutionTrace"]);

  return {
    promptId,
    source,
    success: response["success"] === true,
    failureCode: text(response["code"]) ?? text(response["reason"]),
    fastFallback: response["fastFallback"] === true || v3["fastFallback"] === true,
    recoveryTriggered: gen["recoveryTriggered"] === true,
    elapsedMs: num(gen["elapsedMs"]),
    retrieval: {
      applied: retrieval["applied"] === true || orchestratorRetrieval["applied"] === true || Object.keys(bySource).length > 0,
      strategy: text(orchestrator["strategy"]) ?? text(retrieval["strategyId"]) ?? text(orchestratorRetrieval["strategyId"]),
      inputCount: num(retrieval["inputCount"]) ?? num(orchestratorRetrieval["inputCount"]),
      outputCount: num(retrieval["outputCount"]) ?? num(orchestratorRetrieval["outputCount"]),
      bySource,
      sourceQuotaPct,
      topRejected: [
        ...asArray<unknown>(retrieval["topRejected"]),
        ...asArray<unknown>(orchestratorRetrieval["topRejected"]),
      ].map((raw) => {
        const row = asRecord(raw);
        return {
          reason: text(row.reason) ?? "rejected",
          trackId: trackIdFromUnknown(row) ?? undefined,
          artistName: text(row.artistName),
          trackName: text(row.trackName),
          source: text(row.source),
        };
      }),
      orchestrator: Object.keys(orchestrator).length > 0 ? orchestrator : undefined,
      validCandidateSupply: asRecord(orchestrator["validCandidateSupply"]),
      libraryCapability: asRecord(orchestrator["libraryCapability"] ?? response["libraryCapability"]),
      combinedConfidence: num(orchestrator["combinedConfidence"] ?? response["combinedConfidence"]),
      retrievalAttempts: num(orchestrator["retrievalAttempts"]),
    },
    filterStages: extractFilterStages(v3, gen, intentSurvival),
    scoreDistributionBeforeHybrid: extractScoreDistribution(v3, debug, top20Entering),
    top20EnteringScoring: top20Entering,
    top20AfterScoring: top20After,
    finalPlaylist,
    rejectionReasons: extractRejections(v3, gen, retrieval),
    intentStageCounts,
    executionPath: text(executionTrace["executionPath"]),
    rawCaps: asRecord(response["auditPayloadCap"]),
  };
}

export function buildStageSnapshots(trace: ExtractedPipelineTrace): PipelineStageSnapshot[] {
  const snapshots: PipelineStageSnapshot[] = [];

  if (trace.failureCode === "LIBRARY_INSUFFICIENT_FOR_PROMPT") {
    snapshots.push({
      stageId: "orchestrator_gate",
      label: "Orchestrator gate (pre-retrieval)",
      trackIds: [],
      candidateCount: 0,
      metadata: {
        combinedConfidence: trace.retrieval.combinedConfidence,
        retrievalAttempts: trace.retrieval.retrievalAttempts,
        limitingFactors: trace.retrieval.libraryCapability?.["limitingFactors"],
      },
    });
  }

  if (trace.retrieval.applied || trace.retrieval.outputCount !== undefined) {
    snapshots.push({
      stageId: "retrieval_output",
      label: "Retrieval pool (post multi-source assembly)",
      trackIds: trace.top20EnteringScoring.map((t) => t.trackId),
      candidateCount: trace.retrieval.outputCount ?? trace.retrieval.inputCount,
      metadata: {
        bySource: trace.retrieval.bySource,
        strategy: trace.retrieval.strategy,
      },
    });
  }

  for (const filter of trace.filterStages) {
    snapshots.push({
      stageId: `filter:${filter.stage}`,
      label: `Filter — ${filter.stage}`,
      trackIds: [],
      candidateCount: filter.afterCount ?? filter.beforeCount,
      metadata: filter.metadata,
    });
  }

  if (trace.top20EnteringScoring.length > 0) {
    snapshots.push({
      stageId: "pre_hybrid_scoring_top20",
      label: "Top 20 entering hybrid scoring",
      trackIds: trace.top20EnteringScoring.map((t) => t.trackId),
      candidateCount: trace.top20EnteringScoring.length,
    });
  }

  if (trace.top20AfterScoring.length > 0) {
    snapshots.push({
      stageId: "post_scoring_top20",
      label: "Top 20 after scoring",
      trackIds: trace.top20AfterScoring.map((t) => t.trackId),
      candidateCount: trace.top20AfterScoring.length,
    });
  }

  snapshots.push({
    stageId: "final_playlist",
    label: "Final selected playlist",
    trackIds: trace.finalPlaylist.map((t) => t.trackId),
    orderedTrackIds: trace.finalPlaylist.map((t) => t.trackId),
    candidateCount: trace.finalPlaylist.length,
  });

  return snapshots;
}

export function trackIdsFromResponse(response: Record<string, unknown>): string[] {
  return asArray<unknown>(response["tracks"])
    .map(trackIdFromUnknown)
    .filter((id): id is string => !!id);
}
