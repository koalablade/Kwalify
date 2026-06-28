/**
 * Unified per-request stage timings for latency profiling.
 */

export type RequestStageKey =
  | "retrieval"
  | "intent_expansion"
  | "candidate_generation"
  | "beam_complete_search"
  | "tournament"
  | "refinement"
  | "diagnostics"
  | "serialization"
  | "pre_v3_setup"
  | "total";

export type RequestStageTimingEntry = {
  stage: RequestStageKey;
  ms: number;
  invocations: number;
};

export type RequestStageTimingReport = {
  stages: Record<RequestStageKey, RequestStageTimingEntry>;
  ordered: RequestStageTimingEntry[];
  slowestStage: RequestStageKey | null;
  slowestStageMs: number;
  accountedMs: number;
  unaccountedMs: number;
  totalMs: number;
};

const STAGE_KEYS: RequestStageKey[] = [
  "retrieval",
  "intent_expansion",
  "candidate_generation",
  "beam_complete_search",
  "tournament",
  "refinement",
  "diagnostics",
  "serialization",
  "pre_v3_setup",
  "total",
];

function emptyStages(): Record<RequestStageKey, RequestStageTimingEntry> {
  return Object.fromEntries(
    STAGE_KEYS.map((stage) => [stage, { stage, ms: 0, invocations: 0 }]),
  ) as Record<RequestStageKey, RequestStageTimingEntry>;
}

export function createRequestStageTiming(startedAt = Date.now()): {
  startedAt: number;
  add(stage: RequestStageKey, ms: number): void;
  start(stage: RequestStageKey): () => void;
  setTotal(ms: number): void;
  mergeV3TimingMs(v3: Record<string, unknown> | null | undefined): void;
  mergeProductionTimeline(stageDurationsMs: Record<string, number> | undefined): void;
  report(): RequestStageTimingReport;
} {
  const started = startedAt;
  const stages = emptyStages();

  const add = (stage: RequestStageKey, ms: number): void => {
    if (!Number.isFinite(ms) || ms <= 0) return;
    stages[stage].ms += Math.round(ms);
    stages[stage].invocations += 1;
  };

  return {
    startedAt: started,
    add,
    start(stage: RequestStageKey) {
      const t0 = Date.now();
      return () => add(stage, Date.now() - t0);
    },
    setTotal(ms: number) {
      stages.total.ms = Math.max(stages.total.ms, Math.round(ms));
      stages.total.invocations = 1;
    },
    mergeV3TimingMs(v3) {
      if (!v3 || typeof v3 !== "object") return;
      const raw = v3["timingMs"];
      if (!raw || typeof raw !== "object") return;
      const t = raw as Record<string, number>;
      add("retrieval", t["retrieval"] ?? 0);
      add("intent_expansion", t["intentExpansion"] ?? 0);
      add("candidate_generation", (t["laneGeneration"] ?? 0) + (t["scoring"] ?? 0) + (t["candidateGeneration"] ?? 0) + (t["sampler"] ?? 0));
      add("beam_complete_search", t["completeSearch"] ?? 0);
      add("tournament", t["tournament"] ?? 0);
      add("refinement", (t["interleaver"] ?? 0) + (t["localSearch"] ?? 0) + (t["humanSaveability"] ?? 0));
    },
    mergeProductionTimeline(stageDurationsMs) {
      if (!stageDurationsMs) return;
      const retrievalMs =
        (stageDurationsMs["candidate_fetch"] ?? 0) +
        (stageDurationsMs["memory_load"] ?? 0) +
        (stageDurationsMs["genre_profile"] ?? 0) +
        (stageDurationsMs["genre_stack"] ?? 0);
      const intentMs =
        (stageDurationsMs["prompt_understanding"] ?? 0) +
        (stageDurationsMs["intent_lock"] ?? 0) +
        (stageDurationsMs["intent_quality_context"] ?? 0) +
        (stageDurationsMs["intent_constraint_extract"] ?? 0) +
        (stageDurationsMs["intent_cssp_parse"] ?? 0) +
        (stageDurationsMs["intent_object_resolve"] ?? 0) +
        (stageDurationsMs["intent_curator_identity"] ?? 0) +
        (stageDurationsMs["intent_fallback_family"] ?? 0) +
        (stageDurationsMs["intent_v3_fallback"] ?? 0);
      const preV3 =
        (stageDurationsMs["request_validation"] ?? 0) +
        (stageDurationsMs["session_acquire"] ?? 0) +
        (stageDurationsMs["cache_lookup"] ?? 0) +
        (stageDurationsMs["freshness_memory"] ?? 0) +
        (stageDurationsMs["music_chapters"] ?? 0) +
        (stageDurationsMs["library_signals"] ?? 0) +
        (stageDurationsMs["surprise_context"] ?? 0) +
        (stageDurationsMs["candidate_shape"] ?? 0) +
        (stageDurationsMs["curator_scoring"] ?? 0);
      add("retrieval", retrievalMs);
      add("intent_expansion", intentMs);
      add("pre_v3_setup", preV3);
      add("candidate_generation", stageDurationsMs["v3_pipeline"] ?? 0);
    },
    report(): RequestStageTimingReport {
      const totalMs = Math.max(stages.total.ms, Date.now() - started);
      const ordered = STAGE_KEYS
        .filter((key) => key !== "total")
        .map((key) => stages[key])
        .filter((row) => row.ms > 0)
        .sort((a, b) => b.ms - a.ms);
      const accountedMs = ordered.reduce((sum, row) => sum + row.ms, 0);
      const slowest = ordered[0] ?? null;
      return {
        stages,
        ordered,
        slowestStage: slowest?.stage ?? null,
        slowestStageMs: slowest?.ms ?? 0,
        accountedMs,
        unaccountedMs: Math.max(0, totalMs - accountedMs),
        totalMs,
      };
    },
  };
}

export function formatRequestStageTimingMarkdown(
  promptId: string,
  prompt: string,
  elapsedMs: number,
  report: RequestStageTimingReport,
  extras?: { latencyBudgetExceeded?: boolean; retries?: Record<string, number> },
): string {
  const lines = [
    `### ${promptId}`,
    `- Prompt: ${prompt}`,
    `- Total: ${elapsedMs}ms (accounted ${report.accountedMs}ms, unaccounted ${report.unaccountedMs}ms)`,
    `- Slowest stage: ${report.slowestStage ?? "unknown"} (${report.slowestStageMs}ms)`,
  ];
  if (extras?.latencyBudgetExceeded) lines.push(`- **latencyBudgetExceeded**: true`);
  if (extras?.retries) {
    const retryParts = Object.entries(extras.retries).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
    if (retryParts.length > 0) lines.push(`- Retries/loops: ${retryParts.join(", ")}`);
  }
  lines.push("", "| Stage | ms | invocations |", "| --- | ---: | ---: |");
  for (const row of report.ordered) {
    lines.push(`| ${row.stage} | ${row.ms} | ${row.invocations} |`);
  }
  return lines.join("\n");
}
