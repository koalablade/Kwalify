/**
 * Observational candidate lineage for audit payloads.
 * Copies IDs only. Does not filter, score, rank, refill, or gate.
 */

export const CANDIDATE_LINEAGE_VERSION = 1 as const;

export type LineageCountStatus = "actual" | "unknown" | "skipped";

export type LineageStage = {
  name: string;
  ids: string[];
  count: number;
  status: LineageCountStatus;
};

export type WorldFilterBranch =
  | "hard_lock_add_only"
  | "skipped_no_hard_lock"
  | "skipped_no_world_ids"
  | "unknown";

export type CandidateLineageTrace = {
  version: typeof CANDIDATE_LINEAGE_VERSION;
  observational: true;
  prompt: string;
  requestedLength: number;
  deliveredLength: number;
  committedWorld: {
    id: string | null;
    hardLock: boolean | null;
    source: string | null;
    worldIds: string[];
  } | null;
  lockedIntent: {
    genreFamilies: string[];
    eraRange: { start: number; end: number } | null;
    activity: string | null;
    mood: string[];
  } | null;
  worldFilter: {
    branch: WorldFilterBranch;
    note: string;
  };
  v3: {
    forensicPreV3Trace: unknown;
    relaxationAttempts: unknown;
    rawIntentReadyCount: number | null;
    intentReadyCount: number | null;
    candidateCount: number | null;
    firstMajorDrop: unknown;
    largestDrop: unknown;
    prefilterDropReasons: unknown;
    inputRouting: Record<string, unknown> | null;
  };
  hqg: {
    terminal: { action?: string; salvageableCount?: number; reasons?: string[] } | null;
    late: { action?: string; salvageableCount?: number; reasons?: string[]; sliced: boolean } | null;
  };
  openerHygiene: Record<string, unknown> | null;
  gate: {
    humanSaveable: boolean | null;
    executionPath: string | null;
    curatorScore: number | null;
  };
  stages: {
    scoringPool: LineageStage;
    v3Prefilter: LineageStage;
    composed: LineageStage;
    postPurity: LineageStage;
    postTerminal: LineageStage;
    afterOpenerHygiene: LineageStage;
    afterLateHqg: LineageStage;
    beforeHygiene: LineageStage;
    final: LineageStage;
  };
};

export function copyTrackIds(
  tracks: ReadonlyArray<{ trackId?: unknown; id?: unknown }>,
): string[] {
  return tracks.map((track) => {
    if (typeof track.trackId === "string" && track.trackId) return track.trackId;
    if (typeof track.id === "string" && track.id) return track.id;
    return "";
  }).filter(Boolean);
}

export function lineageStage(name: string, ids: string[] | null | undefined): LineageStage {
  if (ids == null) {
    return { name, ids: [], count: 0, status: "unknown" };
  }
  const copied = [...ids];
  return { name, ids: copied, count: copied.length, status: "actual" };
}

export function skippedStage(name: string): LineageStage {
  return { name, ids: [], count: 0, status: "skipped" };
}

export function worldFilterBranchFor(
  committed: { hardLock?: boolean | null; worldIds?: string[] | null } | null | undefined,
): WorldFilterBranch {
  if (!committed) return "unknown";
  if (!committed.hardLock) return "skipped_no_hard_lock";
  if (!Array.isArray(committed.worldIds) || committed.worldIds.length === 0) return "skipped_no_world_ids";
  return "hard_lock_add_only";
}

export function copyV3PrefilterIds(
  diagnostics: Record<string, unknown> | null | undefined,
): string[] | null {
  const recovery = diagnostics?.["preV3Recovery"] as Record<string, unknown> | undefined;
  const ids = recovery?.["candidatePoolTrackIds"];
  if (!Array.isArray(ids)) return null;
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function intersectCount(a: readonly string[], b: readonly string[]): number {
  const setB = new Set(b);
  let n = 0;
  const seen = new Set<string>();
  for (const id of a) {
    if (!id || seen.has(id) || !setB.has(id)) continue;
    seen.add(id);
    n += 1;
  }
  return n;
}

export function assembleCandidateLineage(input: {
  prompt: string;
  requestedLength: number;
  deliveredLength: number;
  committedWorld?: {
    id?: string | null;
    hardLock?: boolean | null;
    source?: string | null;
    worldIds?: string[];
  } | null;
  lockedIntent?: {
    genreFamilies?: string[];
    eraRange?: { start: number; end: number } | null;
    activity?: string | null;
    mood?: string[];
  } | null;
  scoringPoolIds?: string[] | null;
  v3PrefilterIds?: string[] | null;
  composedIds?: string[] | null;
  postPurityIds?: string[] | null;
  postTerminalIds?: string[] | null;
  afterHygieneIds?: string[] | null;
  afterLateHqgIds?: string[] | null;
  beforeHygieneIds?: string[] | null;
  finalIds?: string[] | null;
  v3Diagnostics?: Record<string, unknown> | null;
  terminalHqg?: { action?: string; salvageableCount?: number; reasons?: string[] } | null;
  lateHqg?: { action?: string; salvageableCount?: number; reasons?: string[] } | null;
  openerHygiene?: Record<string, unknown> | null;
  humanSaveable?: boolean | null;
  executionPath?: string | null;
  curatorScore?: number | null;
}): CandidateLineageTrace {
  const committed = input.committedWorld
    ? {
        id: input.committedWorld.id ?? null,
        hardLock: input.committedWorld.hardLock ?? null,
        source: input.committedWorld.source ?? null,
        worldIds: [...(input.committedWorld.worldIds ?? [])],
      }
    : null;
  const branch = worldFilterBranchFor(committed);
  const recovery = (input.v3Diagnostics?.preV3Recovery ?? {}) as Record<string, unknown>;
  const beforeHygiene = lineageStage("beforeHygiene", input.beforeHygieneIds);
  const afterHygiene = lineageStage("afterOpenerHygiene", input.afterHygieneIds);
  const afterLate = lineageStage("afterLateHqg", input.afterLateHqgIds);
  const lateSalvage = input.lateHqg?.salvageableCount;
  const sliced = Boolean(
    input.lateHqg?.action === "honest_partial"
    && typeof lateSalvage === "number"
    && afterHygiene.status === "actual"
    && afterLate.status === "actual"
    && afterLate.count === lateSalvage
    && afterHygiene.count > afterLate.count,
  );
  return {
    version: CANDIDATE_LINEAGE_VERSION,
    observational: true,
    prompt: input.prompt,
    requestedLength: input.requestedLength,
    deliveredLength: input.deliveredLength,
    committedWorld: committed,
    lockedIntent: input.lockedIntent
      ? {
          genreFamilies: [...(input.lockedIntent.genreFamilies ?? [])],
          eraRange: input.lockedIntent.eraRange ? { ...input.lockedIntent.eraRange } : null,
          activity: input.lockedIntent.activity ?? null,
          mood: [...(input.lockedIntent.mood ?? [])],
        }
      : null,
    worldFilter: {
      branch,
      note:
        "afterGenreFilter records eligible.length after negation/forbidden-artist/landfill prefilter — it is not a requested-genre filter. afterWorldFilter records the same array unless hardLock layered retrieval ADDS tracks. There is no subtractive world filter at that stage.",
    },
    v3: {
      forensicPreV3Trace: recovery.forensicPreV3Trace ?? input.v3Diagnostics?.forensicPreV3Trace ?? null,
      relaxationAttempts: recovery.relaxationAttempts ?? null,
      rawIntentReadyCount: typeof recovery.rawIntentReadyCount === "number" ? recovery.rawIntentReadyCount : null,
      intentReadyCount: typeof recovery.intentReadyCount === "number" ? recovery.intentReadyCount : null,
      candidateCount: typeof recovery.candidateCount === "number" ? recovery.candidateCount : null,
      firstMajorDrop: (recovery.preV3Summary as { firstMajorDrop?: unknown } | undefined)?.firstMajorDrop
        ?? null,
      largestDrop: (recovery.preV3Summary as { largestDrop?: unknown } | undefined)?.largestDrop ?? null,
      prefilterDropReasons: recovery.prefilterDropReasons ?? null,
      inputRouting: ((input.v3Diagnostics?.controlledGeneration as Record<string, unknown> | undefined)
        ?.retrievalLatencyGuard as Record<string, unknown> | undefined) ?? null,
    },
    hqg: {
      terminal: input.terminalHqg ?? null,
      late: input.lateHqg ? { ...input.lateHqg, sliced } : null,
    },
    openerHygiene: input.openerHygiene ? { ...input.openerHygiene } : null,
    gate: {
      humanSaveable: input.humanSaveable ?? null,
      executionPath: input.executionPath ?? null,
      curatorScore: input.curatorScore ?? null,
    },
    stages: {
      scoringPool: lineageStage("scoringPool", input.scoringPoolIds),
      v3Prefilter: lineageStage("v3Prefilter", input.v3PrefilterIds),
      composed: lineageStage("composed", input.composedIds),
      postPurity: lineageStage("postPurity", input.postPurityIds),
      postTerminal: lineageStage("postTerminal", input.postTerminalIds),
      afterOpenerHygiene: afterHygiene,
      afterLateHqg: afterLate,
      beforeHygiene: beforeHygiene,
      final: lineageStage("final", input.finalIds),
    },
  };
}
