/**
 * API payload helpers for human-saveability gate observability (no threshold changes).
 */

export function buildBypassedHumanSaveabilityGate(opts: {
  reason: string;
  stageResponsible?: string;
  detail?: string | null;
}): Record<string, unknown> {
  const stage = opts.stageResponsible ?? "request";
  const detail = opts.detail ? `:${opts.detail}` : "";
  return {
    passed: false,
    humanSaveable: false,
    bypassed: true,
    bypassReason: opts.reason,
    rejectionReasons: [`human_saveability_gate_bypassed:${opts.reason}${detail}`],
    curatorScore: null,
    breakdown: null,
    offendingTracks: [],
    dominantCluster: null,
    openingTenDominantCluster: null,
    strictModeHumanSaveability: null,
    attribution: {
      stageResponsible: stage,
      bypassReason: opts.reason,
    },
    retriesUsed: 0,
    maxRetries: 2,
    hardFailed: true,
  };
}

export function isFastFallbackGenerateResponse(data: Record<string, unknown>): boolean {
  if (data.fastFallback === true) return true;
  const v3 = data.v3Diagnostics;
  if (v3 && typeof v3 === "object" && (v3 as Record<string, unknown>).fastFallback === true) return true;
  const gen = data.generationDiagnostics;
  if (gen && typeof gen === "object") {
    const g = gen as Record<string, unknown>;
    if (g.fallbackLevel === "timeout_fallback") return true;
    if (typeof g.failureReason === "string" && g.failureReason.includes("fallback")) return true;
  }
  return false;
}

export function fastFallbackDetail(data: Record<string, unknown>): string {
  const gen = data.generationDiagnostics as Record<string, unknown> | undefined;
  const v3 = data.v3Diagnostics as Record<string, unknown> | undefined;
  return String(
    gen?.failureReason ??
    v3?.failureReason ??
    gen?.blocking_stage ??
    "fast_fallback",
  );
}
