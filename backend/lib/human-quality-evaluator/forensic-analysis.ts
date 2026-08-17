/**
 * Forensic analysis of existing 100-generation benchmark outputs.
 * Measurement only — does not modify generation. Not human authority.
 */

import { BENCHMARK100_PLAYLIST_LENGTH, type Benchmark100GenerationRecord } from "./benchmark-100";

export { BENCHMARK100_PLAYLIST_LENGTH };
import {
  compoundPartsForPrompt,
  eraWindowForPrompt,
  keywordLiteralOpening,
  matchingWorlds,
  MAINSTREAM_ARTIST_TOKENS,
  negativeConstraints,
  scoreTrackAgainstWorld,
  type FitBand,
  type TrackLike,
} from "./world-evidence";
import {
  assessLibraryForPrompt,
  underfillHighOpportunity,
  type PromptLibraryAssessment,
  type QaLibrarySnapshot,
  type ResponseQuality,
  type FillSeverity,
} from "./library-opportunity";
import {
  funnelIsIncomplete,
  inferFunnelDropStage,
  readCandidateFunnel,
  rebuildCandidateFunnelFromPersistedAudit,
  type CandidateFunnelTrace,
  type FunnelDropStage,
} from "../candidate-funnel-trace";

export type ForensicBucket =
  | "CLEARLY_GOOD"
  | "PROBABLY_GOOD"
  | "MIXED"
  | "PROBABLY_BAD"
  | "CLEARLY_BAD"
  | "TECHNICAL_FAILURE"
  | "INSUFFICIENT_EVIDENCE";

export type DeliveryKind =
  | "full"
  | "partial"
  | "refused"
  | "empty"
  | "timeout_fallback"
  | "technical_failure";

export type ForensicFailureClass =
  | "SEVERE_WORLD_MISMATCH"
  | "CONTEXTUAL_DEFAULT_CLUSTER"
  | "ERA_FAILURE"
  | "NEIGHBOUR_GENRE_SUBSTITUTION"
  | "COMPOUND_INTENT_COLLAPSE"
  | "NEGATIVE_CONSTRAINT_RISK"
  | "KEYWORD_LITERAL_OPENING"
  | "UNDERFILL_SILENT"
  | "ACTIVITY_REFUSAL"
  | "TIMEOUT_FALLBACK"
  | "REPLAY_LOW_VARIATION"
  | "ARTIST_CLUSTERING"
  | "INCOMPLETE_TRACE"
  | "UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY"
  | "MISSED_LIBRARY_OPPORTUNITY"
  | "SPARSE_LIBRARY"
  | "HONEST_REFUSAL"
  | "PROMPT_OUTLIER"
  | "EVALUATOR_DISAGREEMENT";

export type DimensionFits = {
  PROMPT_FIT: FitBand;
  WORLD_FIT: FitBand;
  GENRE_FIT: FitBand;
  ERA_FIT: FitBand;
  MOOD_FIT: FitBand;
  COMPOUND_FIT: FitBand;
  NEGATIVE_CONSTRAINT_FIT: FitBand;
  OPENING_FIT: FitBand;
  SUSTAINED_FIT: FitBand;
  VARIETY: FitBand;
  UNDERFILL: FitBand;
  REPLAY_VARIATION: FitBand;
  TECHNICAL_RELIABILITY: FitBand;
};

export type DefaultClusterMember = {
  key: string;
  name: string;
  artist: string;
  playlistCount: number;
  categoryCount: number;
  categories: string[];
};

export type ForensicPlaylist = {
  requestId: string;
  promptId: string;
  prompt: string;
  category: string;
  benchmarkRunId: string;
  startedAt: string;
  httpStatus: number;
  delivery: DeliveryKind;
  requested: number;
  delivered: number;
  underfillMissing: number;
  fillPct: number;
  tracks: Array<{
    position: number;
    name: string;
    artist: string;
    album: string | null;
    releaseYear: number | null;
    spotifyId: string;
    uri: string | null;
  }>;
  executionPath: string | null;
  humanSaveable: boolean | null;
  curatorScore: number | null;
  rejectionReasons: string[];
  traceIncomplete: boolean;
  candidateFunnel: CandidateFunnelTrace | null;
  dropStage: { primary: FunnelDropStage; evidence: string } | null;
  hcsScore: number | null;
  hcsWouldSave: string | null;
  verifierVerdict: string | null;
  verifierMisfit: number;
  dimensions: DimensionFits;
  dimensionEvidence: Partial<Record<keyof DimensionFits, string>>;
  failureClasses: Array<{ class: ForensicFailureClass; confidence: "high" | "medium" | "low"; evidence: string }>;
  bucket: ForensicBucket;
  bucketWhy: string;
  defaultClusterShare: number;
  replayJaccard: number | null;
  evaluatorConflict: "hcs_optimistic" | "verifier_optimistic" | "hcs_vs_verifier" | null;
  fillSeverity: FillSeverity;
  library: PromptLibraryAssessment | null;
  responseQuality: ResponseQuality;
};

export type HumanValidationItem = {
  requestId: string;
  promptId: string;
  prompt: string;
  category: string;
  delivered: number;
  requested: number;
  bucket: ForensicBucket;
  automatedVerdict: string;
  whySelected: string;
  humanQuestion: string;
  tracks: ForensicPlaylist["tracks"];
  uris: string[];
  failureClasses: string[];
  fillSeverity?: FillSeverity;
  libraryOpportunity?: string;
  libraryUtilisation?: string;
  libraryEvidence?: string;
  responseQuality?: ResponseQuality;
};

export type ForensicDiagnosis = {
  generatedAt: string;
  benchmarkRunId: string;
  requestedLength: number;
  totals: Record<ForensicBucket, number>;
  delivery: Record<DeliveryKind, number>;
  defaultCluster: DefaultClusterMember[];
  playlists: ForensicPlaylist[];
  failureRank: Array<{
    class: ForensicFailureClass;
    count: number;
    severity: "high" | "medium" | "low";
    exampleRequestIds: string[];
    observed: string;
    likelyRootCause: string;
    alternatives: string[];
    evidenceRequired: string;
    subsystem: string;
  }>;
  shortlist: HumanValidationItem[];
  recommendedNextAction: string;
  doNotBuild: string[];
  working: string[];
  broken: string[];
};

function asTracks(record: Benchmark100GenerationRecord): TrackLike[] {
  return (record.evaluated?.tracks ?? []).map((t) => ({
    name: t.name,
    artist: t.artist,
    album: t.album,
    releaseYear: t.releaseYear,
    energy: (t as { energy?: number | null }).energy ?? null,
    valence: (t as { valence?: number | null }).valence ?? null,
    acousticness: (t as { acousticness?: number | null }).acousticness ?? null,
  }));
}

function pipeline(record: Benchmark100GenerationRecord): Record<string, unknown> {
  const evaluated = (record.evaluated?.pipeline ?? {}) as Record<string, unknown>;
  const raw = (record.rawResponse ?? {}) as Record<string, unknown>;
  return {
    ...evaluated,
    ...(raw.candidateFunnel ? { candidateFunnel: raw.candidateFunnel } : {}),
    ...(raw.deliveryLossFunnel ? { deliveryLossFunnel: raw.deliveryLossFunnel } : {}),
    ...(raw.retrievalFunnel ? { retrievalFunnel: raw.retrievalFunnel } : {}),
    ...(raw.puritySubFunnel ? { puritySubFunnel: raw.puritySubFunnel } : {}),
  };
}

function honestCandidateFunnel(
  record: Benchmark100GenerationRecord,
  pipe: Record<string, unknown>,
  requested: number,
  delivered: number,
): CandidateFunnelTrace | null {
  const persisted = readCandidateFunnel(pipe) ?? readCandidateFunnel(record.evaluated as unknown as Record<string, unknown>);
  const retrievalFunnel = pipe.retrievalFunnel as { stages?: Record<string, unknown> } | undefined;
  const deliveryLossFunnel = pipe.deliveryLossFunnel as {
    orchestratorFinal?: number | null;
    v3PreFilterSurvivors?: number | null;
    v3Composed?: number | null;
    postPurity?: number | null;
    postTerminal?: number | null;
  } | undefined;
  const puritySubFunnel = pipe.puritySubFunnel as {
    hardRejectOffWorldCount?: number | null;
    removedReasons?: string[];
    checkpointRemovedReasons?: string[];
  } | undefined;
  if (!persisted && retrievalFunnel == null && deliveryLossFunnel == null) return null;
  return rebuildCandidateFunnelFromPersistedAudit({
    requestedLength: requested,
    deliveredLength: delivered,
    persisted,
    retrievalFunnel: retrievalFunnel ?? null,
    deliveryLossFunnel: deliveryLossFunnel ?? null,
    puritySubFunnel: puritySubFunnel ?? null,
  });
}

export function deliveryKind(record: Benchmark100GenerationRecord): DeliveryKind {
  const path = String(pipeline(record).executionPath ?? "");
  const n = record.evaluated?.tracks.length ?? 0;
  if (path === "timeout_fallback") return "timeout_fallback";
  if (record.httpStatus === 422 || /HUMAN_QUALITY_GATE_REFUSED/i.test(record.error ?? "")) return "refused";
  if (record.httpStatus === 0 || record.httpStatus >= 500) return "technical_failure";
  if (n === 0) return "empty";
  if (n < BENCHMARK100_PLAYLIST_LENGTH) return "partial";
  return "full";
}

function fillBand(pct: number): FitBand {
  if (pct >= 100) return "PASS";
  if (pct >= 80) return "MIXED";
  return "FAIL";
}

function bandFromRatio(hits: number, n: number, pass = 0.45, mixed = 0.2): FitBand {
  if (n === 0) return "UNKNOWN";
  const r = hits / n;
  if (r >= pass) return "PASS";
  if (r >= mixed) return "MIXED";
  return "FAIL";
}

export function detectDefaultCluster(
  records: Benchmark100GenerationRecord[],
  opts?: { minPlaylists?: number; minCategories?: number },
): DefaultClusterMember[] {
  const minPlaylists = opts?.minPlaylists ?? 12;
  const minCategories = opts?.minCategories ?? 3;
  const map = new Map<string, { name: string; artist: string; playlists: Set<string>; cats: Set<string> }>();
  for (const r of records) {
    const cat = r.runItem.category;
    const seen = new Set<string>();
    for (const t of r.evaluated?.tracks ?? []) {
      const key = (t.spotifyId || `${t.artist}|${t.name}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const row = map.get(key) ?? {
        name: t.name,
        artist: t.artist,
        playlists: new Set(),
        cats: new Set(),
      };
      row.playlists.add(r.runItem.requestId);
      row.cats.add(cat);
      map.set(key, row);
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      artist: v.artist,
      playlistCount: v.playlists.size,
      categoryCount: v.cats.size,
      categories: [...v.cats].sort(),
    }))
    .filter((x) => x.playlistCount >= minPlaylists && x.categoryCount >= minCategories)
    .sort((a, b) => b.playlistCount - a.playlistCount);
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a.filter(Boolean));
  const B = new Set(b.filter(Boolean));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

function replayMap(records: Benchmark100GenerationRecord[]): Map<string, number | null> {
  const byBase = new Map<string, string[][]>();
  for (const r of records) {
    const base = r.runItem.promptId.replace(/-r[12]$/, "");
    const ids = (r.evaluated?.tracks ?? []).map((t) => t.spotifyId || `${t.artist}|${t.name}`);
    const arr = byBase.get(base) ?? [];
    arr.push(ids);
    byBase.set(base, arr);
  }
  const out = new Map<string, number | null>();
  for (const r of records) {
    const base = r.runItem.promptId.replace(/-r[12]$/, "");
    const runs = byBase.get(base) ?? [];
    if (runs.length < 2) {
      out.set(r.runItem.requestId, null);
      continue;
    }
    const js: number[] = [];
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) js.push(jaccard(runs[i]!, runs[j]!));
    }
    out.set(r.runItem.requestId, js.length ? js.reduce((a, b) => a + b, 0) / js.length : null);
  }
  return out;
}

function addFailure(
  failures: ForensicPlaylist["failureClasses"],
  cls: ForensicFailureClass,
  confidence: "high" | "medium" | "low",
  evidence: string,
) {
  if (failures.some((f) => f.class === cls)) return;
  failures.push({ class: cls, confidence, evidence });
}

export function classifyRecord(
  record: Benchmark100GenerationRecord,
  clusterKeys: Set<string>,
  replayJaccard: number | null,
  requested = BENCHMARK100_PLAYLIST_LENGTH,
  library: QaLibrarySnapshot | null = null,
): ForensicPlaylist {
  const prompt = record.runItem.prompt;
  const tracks = asTracks(record);
  const n = tracks.length;
  const pipe = pipeline(record);
  const delivery = deliveryKind(record);
  const fillPct = requested > 0 ? Math.round((n / requested) * 100) : 0;
  const evald = record.evaluated;
  const auto = evald?.automated;
  const stages = (pipe.stageAttribution ?? {}) as Record<string, { status?: string }>;
  const candidateFunnel = honestCandidateFunnel(record, pipe, requested, n);
  const skippedLegacyTrace =
    String(stages.retrieval?.status ?? "skipped") === "skipped"
    && String(stages.scene_world?.status ?? "skipped") === "skipped";
  const traceIncomplete = candidateFunnel
    ? funnelIsIncomplete(candidateFunnel)
    : skippedLegacyTrace;

  const dims: DimensionFits = {
    PROMPT_FIT: "UNKNOWN",
    WORLD_FIT: "UNKNOWN",
    GENRE_FIT: "UNKNOWN",
    ERA_FIT: "UNKNOWN",
    MOOD_FIT: "UNKNOWN",
    COMPOUND_FIT: "UNKNOWN",
    NEGATIVE_CONSTRAINT_FIT: "UNKNOWN",
    OPENING_FIT: "UNKNOWN",
    SUSTAINED_FIT: "UNKNOWN",
    VARIETY: "UNKNOWN",
    UNDERFILL: fillBand(fillPct),
    REPLAY_VARIATION: replayJaccard == null ? "UNKNOWN" : replayJaccard >= 0.8 ? "FAIL" : replayJaccard >= 0.5 ? "MIXED" : "PASS",
    TECHNICAL_RELIABILITY:
      delivery === "refused" || delivery === "timeout_fallback" || delivery === "technical_failure" || delivery === "empty"
        ? "FAIL"
        : "PASS",
  };
  const evidence: Partial<Record<keyof DimensionFits, string>> = {};
  const failures: ForensicPlaylist["failureClasses"] = [];

  const clusterHits = (evald?.tracks ?? []).filter((t) =>
    clusterKeys.has((t.spotifyId || `${t.artist}|${t.name}`).toLowerCase()),
  ).length;
  const clusterShare = n > 0 ? clusterHits / n : 0;
  const worlds = matchingWorlds(prompt);
  const opening = tracks.slice(0, Math.min(5, n));
  const era = eraWindowForPrompt(prompt);

  if (delivery === "refused" || delivery === "empty") {
    dims.PROMPT_FIT = "FAIL";
    evidence.PROMPT_FIT = delivery === "refused" ? "Quality gate refused; no tracks shipped" : "Empty result";
    addFailure(failures, "HONEST_REFUSAL", "high", record.error ?? "empty/refused");
    if (record.runItem.category === "activity") {
      addFailure(failures, "ACTIVITY_REFUSAL", "high", record.error ?? "empty/refused");
    }
  } else if (delivery === "timeout_fallback") {
    dims.PROMPT_FIT = "FAIL";
    evidence.PROMPT_FIT = "Timeout fallback shipped a stub";
    addFailure(failures, "TIMEOUT_FALLBACK", "high", String(pipe.rejectionReasons ?? ""));
  } else if (worlds.length > 0) {
    const world = worlds[0]!;
    const hits = tracks.map((t) => scoreTrackAgainstWorld(t, world));
    const pos = hits.filter((h) => h.positive).length;
    const neg = hits.filter((h) => h.negative).length;
    const eraHits = era
      ? tracks.filter((t) => typeof t.releaseYear === "number" && t.releaseYear >= era.min && t.releaseYear <= era.max).length
      : null;
    dims.WORLD_FIT = neg >= 2 && pos === 0 ? "FAIL" : bandFromRatio(pos, n, world.strict ? 0.35 : 0.25, 0.12);
    dims.GENRE_FIT = dims.WORLD_FIT;
    dims.PROMPT_FIT = dims.WORLD_FIT;
    evidence.WORLD_FIT = `${world.label}: ${pos} supporting / ${neg} contradictory / ${n} tracks`;
    evidence.GENRE_FIT = evidence.WORLD_FIT;
    evidence.PROMPT_FIT = evidence.WORLD_FIT;

    const openPos = opening.filter((t) => scoreTrackAgainstWorld(t, world).positive).length;
    const openNeg = opening.filter((t) => scoreTrackAgainstWorld(t, world).negative).length;
    dims.OPENING_FIT = openNeg > 0 && openPos === 0 ? "FAIL" : bandFromRatio(openPos, opening.length || 1, 0.4, 0.2);
    evidence.OPENING_FIT = `Opening ${opening.length}: ${openPos} in-world, ${openNeg} contradictory`;

    if (era) {
      dims.ERA_FIT = eraHits === 0 ? "FAIL" : bandFromRatio(eraHits ?? 0, n, 0.4, 0.15);
      evidence.ERA_FIT = `${eraHits ?? 0}/${n} tracks in ${era.label} (${era.min}–${era.max})`;
      if (eraHits === 0) addFailure(failures, "ERA_FAILURE", "high", evidence.ERA_FIT);
    }

    if (dims.WORLD_FIT === "FAIL" && (neg >= 2 || (eraHits === 0 && era))) {
      addFailure(failures, "SEVERE_WORLD_MISMATCH", "high", `${world.label} not present; ${evidence.WORLD_FIT}`);
      if (openNeg > 0) addFailure(failures, "PROMPT_OUTLIER", "high", evidence.OPENING_FIT ?? "Opening contradicts requested world");
    } else if (dims.WORLD_FIT === "FAIL" && pos === 0) {
      addFailure(
        failures,
        "NEIGHBOUR_GENRE_SUBSTITUTION",
        "high",
        `No ${world.label} evidence; neighbours ${world.neighbourLabels.join(", ") || "unknown"} likely substituted`,
      );
    }

    if (world.strict && clusterShare >= 0.45 && pos <= Math.max(1, Math.floor(n * 0.15))) {
      addFailure(
        failures,
        "CONTEXTUAL_DEFAULT_CLUSTER",
        "high",
        `${Math.round(clusterShare * 100)}% tracks are cross-prompt default-cluster members`,
      );
    }
  } else {
    const loose = /vague|natural|mood|activity|atmosphere/.test(record.runItem.category);
    dims.PROMPT_FIT = loose ? "UNKNOWN" : "UNKNOWN";
    evidence.PROMPT_FIT = "No strict world spec; metadata cannot prove prompt fidelity";
    evidence.WORLD_FIT = evidence.PROMPT_FIT;
    evidence.OPENING_FIT = "No strict world to judge opening against";
  }

  const kw = keywordLiteralOpening(prompt, tracks);
  if (kw.flagged) {
    dims.OPENING_FIT = "FAIL";
    evidence.OPENING_FIT = kw.evidence;
    addFailure(failures, "KEYWORD_LITERAL_OPENING", "medium", kw.evidence);
  }

  if (!era) {
    dims.ERA_FIT = "UNKNOWN";
    evidence.ERA_FIT = "No explicit era in prompt";
  } else if (dims.ERA_FIT === "UNKNOWN" && n > 0) {
    const eraHits = tracks.filter((t) => typeof t.releaseYear === "number" && t.releaseYear >= era.min && t.releaseYear <= era.max).length;
    dims.ERA_FIT = eraHits === 0 ? "FAIL" : bandFromRatio(eraHits, n, 0.4, 0.15);
    evidence.ERA_FIT = `${eraHits}/${n} in ${era.label}`;
    if (eraHits === 0) addFailure(failures, "ERA_FAILURE", "high", evidence.ERA_FIT);
  }

  const compounds = compoundPartsForPrompt(prompt);
  if (compounds.length >= 2 && n > 0) {
    const scores = compounds.map((c) => ({ ...c.score(tracks), label: c.label }));
    const ok = scores.map((s) => s.hits / n >= 0.25);
    const both = ok.every(Boolean);
    dims.COMPOUND_FIT = both ? "PASS" : "FAIL";
    evidence.COMPOUND_FIT = scores.map((s) => `${s.label}: ${s.evidence}`).join("; ");
    if (!both) addFailure(failures, "COMPOUND_INTENT_COLLAPSE", "medium", evidence.COMPOUND_FIT);
  } else {
    dims.COMPOUND_FIT = "UNKNOWN";
    evidence.COMPOUND_FIT = "Not a scored compound prompt";
  }

  const negs = negativeConstraints(prompt);
  if (negs.includes("no mainstream") && n > 0) {
    const hits = tracks.filter((t) => MAINSTREAM_ARTIST_TOKENS.some((tok) => t.artist.toLowerCase().includes(tok))).length;
    dims.NEGATIVE_CONSTRAINT_FIT = hits > 0 ? "FAIL" : "UNKNOWN";
    evidence.NEGATIVE_CONSTRAINT_FIT = hits > 0
      ? `${hits} likely-mainstream artists present (hypothesis)`
      : "No obvious mainstream tokens; still needs human check";
    if (hits > 0) addFailure(failures, "NEGATIVE_CONSTRAINT_RISK", "medium", evidence.NEGATIVE_CONSTRAINT_FIT);
  } else {
    dims.NEGATIVE_CONSTRAINT_FIT = "UNKNOWN";
    evidence.NEGATIVE_CONSTRAINT_FIT = negs.length ? `${negs.join(", ")} not provable automatically` : "No explicit negative constraint";
  }

  dims.MOOD_FIT = "UNKNOWN";
  evidence.MOOD_FIT = "Mood/atmosphere requires listening; audio features are proxies only";

  if (n >= 6 && worlds[0]) {
    const third = Math.max(1, Math.floor(n / 3));
    const last = tracks.slice(-third);
    const lastPos = last.filter((t) => scoreTrackAgainstWorld(t, worlds[0]!).positive).length;
    dims.SUSTAINED_FIT = bandFromRatio(lastPos, last.length, 0.3, 0.1);
    evidence.SUSTAINED_FIT = `Final third in-world ${lastPos}/${last.length}`;
  } else {
    dims.SUSTAINED_FIT = n === 0 ? "FAIL" : "UNKNOWN";
    evidence.SUSTAINED_FIT = n < 6 ? "Too short for a meaningful tail" : "No strict world for sustained check";
  }

  const artists = tracks.map((t) => t.artist.toLowerCase());
  const counts = new Map<string, number>();
  for (const a of artists) counts.set(a, (counts.get(a) ?? 0) + 1);
  const maxA = Math.max(0, ...counts.values());
  dims.VARIETY = n === 0 ? "FAIL" : new Set(artists).size === 1 && n >= 3 ? "FAIL" : maxA >= 4 || (n >= 8 && maxA / n > 0.35) ? "FAIL" : maxA >= 3 ? "MIXED" : "PASS";
  evidence.VARIETY = `unique artists ${new Set(artists).size}/${n}; max per artist ${maxA}`;
  if (dims.VARIETY === "FAIL") addFailure(failures, "ARTIST_CLUSTERING", n >= 3 && new Set(artists).size === 1 ? "high" : "medium", evidence.VARIETY);

  evidence.UNDERFILL = `${n}/${requested} delivered (${fillPct}%)`;
  if (delivery === "partial") {
    addFailure(
      failures,
      "UNDERFILL_SILENT",
      "high",
      `Requested ${requested}, delivered ${n}, missing ${requested - n}`,
    );
  }

  const libraryAssessment = assessLibraryForPrompt({
    prompt,
    snapshot: library,
    selected: tracks,
    delivered: n,
    requested,
    delivery,
  });
  if (underfillHighOpportunity(libraryAssessment)) {
    addFailure(
      failures,
      "UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY",
      "high",
      `${libraryAssessment.evidence} — treat as candidate/admission failure until disproven (not sparse library)`,
    );
  } else if (libraryAssessment.sparseLibrary && delivery === "partial") {
    addFailure(failures, "SPARSE_LIBRARY", "medium", libraryAssessment.evidence);
  }
  if (libraryAssessment.missedOpportunity && libraryAssessment.selectedStrong === 0 && n > 0 && libraryAssessment.strongRelevantCount >= 25) {
    addFailure(
      failures,
      "MISSED_LIBRARY_OPPORTUNITY",
      "high",
      `Library has ${libraryAssessment.strongRelevantCount} strong matches; playlist used ${libraryAssessment.selectedStrong}`,
    );
  }

  evidence.REPLAY_VARIATION = replayJaccard == null
    ? "Single run of this prompt"
    : `Mean Jaccard vs sibling runs ${replayJaccard.toFixed(2)}`;
  if (replayJaccard != null && replayJaccard >= 0.8) {
    addFailure(failures, "REPLAY_LOW_VARIATION", "high", evidence.REPLAY_VARIATION);
  }
  evidence.TECHNICAL_RELIABILITY = `${delivery}; path=${String(pipe.executionPath ?? "?")}; saveable=${String(pipe.humanSaveable)}`;
  if (traceIncomplete) {
    addFailure(
      failures,
      "INCOMPLETE_TRACE",
      "high",
      candidateFunnel
        ? `candidateFunnel completeness=${candidateFunnel.completeness}; missing ${candidateFunnel.missingFields.join(", ") || "none"}; do not treat unknown counts as 0`
        : "Retrieval/world/sampler stages marked skipped; funnel counts are 0 even when tracks shipped",
    );
  }

  const hcsScore = auto?.hcs.totalScore ?? null;
  const verifierVerdict = auto?.independentVerifier.playlistVerdict ?? null;
  const worldFail = failures.some((f) => f.class === "SEVERE_WORLD_MISMATCH" || f.class === "ERA_FAILURE");
  let evaluatorConflict: ForensicPlaylist["evaluatorConflict"] = null;
  if (worldFail && (hcsScore ?? 0) >= 80) evaluatorConflict = "hcs_optimistic";
  if (worldFail && verifierVerdict === "strong") {
    evaluatorConflict = evaluatorConflict ? "hcs_vs_verifier" : "verifier_optimistic";
  }
  if (!worldFail && verifierVerdict === "weak" && (hcsScore ?? 0) >= 85) evaluatorConflict = "hcs_vs_verifier";
  if (evaluatorConflict) addFailure(failures, "EVALUATOR_DISAGREEMENT", "medium", evaluatorConflict);

  const bucket = assignBucket({
    delivery,
    failures,
    dims,
    category: record.runItem.category,
    n,
    worldCount: worlds.length,
    fillSeverity: libraryAssessment.fillSeverity,
    library: libraryAssessment,
  });
  const responseQuality = assignResponseQuality({
    bucket,
    delivery,
    failures,
    library: libraryAssessment,
    dims,
  });

  return {
    requestId: record.runItem.requestId,
    promptId: record.runItem.promptId,
    prompt,
    category: record.runItem.category,
    benchmarkRunId: record.benchmarkRunId,
    startedAt: record.startedAt,
    httpStatus: record.httpStatus,
    delivery,
    requested,
    delivered: n,
    underfillMissing: Math.max(0, requested - n),
    fillPct,
    tracks: (evald?.tracks ?? []).map((t) => ({
      position: t.position,
      name: t.name,
      artist: t.artist,
      album: t.album,
      releaseYear: t.releaseYear,
      spotifyId: t.spotifyId,
      uri: t.spotifyId ? `spotify:track:${t.spotifyId}` : null,
    })),
    executionPath: typeof pipe.executionPath === "string" ? pipe.executionPath : null,
    humanSaveable: typeof pipe.humanSaveable === "boolean" ? pipe.humanSaveable : null,
    curatorScore: typeof pipe.curatorScore === "number" ? pipe.curatorScore : null,
    rejectionReasons: Array.isArray(pipe.rejectionReasons) ? pipe.rejectionReasons.map(String) : [],
    traceIncomplete,
    candidateFunnel,
    dropStage: candidateFunnel
      ? inferFunnelDropStage(candidateFunnel, libraryAssessment.strongRelevantCount)
      : null,
    hcsScore,
    hcsWouldSave: auto?.hcs.wouldSave ?? null,
    verifierVerdict,
    verifierMisfit: auto?.independentVerifier.misfitCount ?? 0,
    dimensions: dims,
    dimensionEvidence: evidence,
    failureClasses: failures,
    bucket,
    bucketWhy: explainBucket(bucket, failures, dims, delivery, libraryAssessment),
    defaultClusterShare: clusterShare,
    replayJaccard,
    evaluatorConflict,
    fillSeverity: libraryAssessment.fillSeverity,
    library: libraryAssessment,
    responseQuality,
  };
}

function assignBucket(input: {
  delivery: DeliveryKind;
  failures: ForensicPlaylist["failureClasses"];
  dims: DimensionFits;
  category: string;
  n: number;
  worldCount: number;
  fillSeverity: FillSeverity;
  library: PromptLibraryAssessment;
}): ForensicBucket {
  if (
    input.delivery === "technical_failure"
    || input.delivery === "refused"
    || input.delivery === "timeout_fallback"
    || input.delivery === "empty"
  ) {
    return "TECHNICAL_FAILURE";
  }
  const severe = input.failures.some((f) => f.class === "SEVERE_WORLD_MISMATCH" || f.class === "ERA_FAILURE");
  if (severe) return "CLEARLY_BAD";
  const neighbour = input.failures.some((f) => f.class === "NEIGHBOUR_GENRE_SUBSTITUTION");
  const cluster = input.failures.some((f) => f.class === "CONTEXTUAL_DEFAULT_CLUSTER");
  const compound = input.failures.some((f) => f.class === "COMPOUND_INTENT_COLLAPSE");
  if (neighbour || (cluster && input.worldCount > 0) || compound) return "PROBABLY_BAD";

  const adequateLength = input.fillSeverity === "full" || input.fillSeverity === "near_full";
  const highOppUnderfill = underfillHighOpportunity(input.library);
  const loose = /vague|natural|mood/.test(input.category);

  if (highOppUnderfill && input.dims.PROMPT_FIT !== "FAIL") {
    return "MIXED";
  }

  if (input.dims.PROMPT_FIT === "PASS" && input.dims.OPENING_FIT === "PASS" && adequateLength) {
    return "CLEARLY_GOOD";
  }

  if (loose && input.n >= 6 && input.dims.TECHNICAL_RELIABILITY === "PASS") return "PROBABLY_GOOD";
  if (input.n >= 20 && input.worldCount === 0 && input.dims.TECHNICAL_RELIABILITY === "PASS") return "PROBABLY_GOOD";
  if (input.dims.PROMPT_FIT === "PASS" && adequateLength) return "PROBABLY_GOOD";
  if (input.dims.PROMPT_FIT === "PASS" && input.library.sparseLibrary) return "INSUFFICIENT_EVIDENCE";
  if (input.dims.PROMPT_FIT === "PASS") return "MIXED";
  if (input.dims.PROMPT_FIT === "MIXED" || input.dims.WORLD_FIT === "MIXED") return "MIXED";
  if (input.n > 0 && input.worldCount === 0) return "INSUFFICIENT_EVIDENCE";
  return "MIXED";
}

function assignResponseQuality(input: {
  bucket: ForensicBucket;
  delivery: DeliveryKind;
  failures: ForensicPlaylist["failureClasses"];
  library: PromptLibraryAssessment;
  dims: DimensionFits;
}): ResponseQuality {
  if (input.delivery === "refused") return "HONEST_REFUSAL";
  if (input.failures.some((f) => f.class === "SEVERE_WORLD_MISMATCH" || f.class === "ERA_FAILURE")) {
    return "GOOD_MUSIC_WRONG_PROMPT";
  }
  if (underfillHighOpportunity(input.library) || (input.dims.PROMPT_FIT === "PASS" && input.library.fillSeverity !== "full" && input.library.fillSeverity !== "near_full")) {
    return "CORRECT_PROMPT_BUT_UNDERFILLED";
  }
  if (input.failures.some((f) => f.class === "REPLAY_LOW_VARIATION" || f.class === "ARTIST_CLUSTERING") && input.dims.PROMPT_FIT !== "FAIL") {
    return "CORRECT_PROMPT_BUT_REPETITIVE";
  }
  if (input.bucket === "CLEARLY_GOOD") return "GENUINELY_GOOD";
  if (input.bucket === "PROBABLY_BAD") return "TECHNICALLY_VALID_POOR_EXPERIENCE";
  return "UNCERTAIN";
}

function explainBucket(
  bucket: ForensicBucket,
  failures: ForensicPlaylist["failureClasses"],
  dims: DimensionFits,
  delivery: DeliveryKind,
  library?: PromptLibraryAssessment | null,
): string {
  if (bucket === "TECHNICAL_FAILURE") return `Delivery=${delivery}`;
  if (bucket === "CLEARLY_BAD") {
    return failures
      .filter((f) => f.class === "SEVERE_WORLD_MISMATCH" || f.class === "ERA_FAILURE")
      .map((f) => f.evidence)
      .join("; ");
  }
  if (bucket === "PROBABLY_BAD") return failures.slice(0, 3).map((f) => `${f.class}: ${f.evidence}`).join("; ");
  if (bucket === "CLEARLY_GOOD") return `Prompt/world/opening PASS and length adequate (${dims.PROMPT_FIT}/${dims.WORLD_FIT}/${dims.OPENING_FIT})`;
  if (bucket === "MIXED" && library && underfillHighOpportunity(library)) {
    return `PROMISING BUT UNDER-EXPLOITED — ${library.evidence}`;
  }
  if (bucket === "PROBABLY_GOOD") return "No severe world mismatch; likely listenable — not human-verified; coherence is not enough";
  if (bucket === "INSUFFICIENT_EVIDENCE") return "Cannot prove prompt fidelity from metadata alone";
  return "Mixed or competing signals";
}

function toItem(p: ForensicPlaylist, why: string, question: string): HumanValidationItem {
  return {
    requestId: p.requestId,
    promptId: p.promptId,
    prompt: p.prompt,
    category: p.category,
    delivered: p.delivered,
    requested: p.requested,
    bucket: p.bucket,
    automatedVerdict: `${p.bucket} | HCS ${p.hcsScore ?? "?"} | verifier ${p.verifierVerdict ?? "?"}`,
    whySelected: why,
    humanQuestion: question,
    tracks: p.tracks,
    uris: p.tracks.map((t) => t.uri).filter((u): u is string => Boolean(u)),
    failureClasses: p.failureClasses.map((f) => f.class),
    fillSeverity: p.fillSeverity,
    libraryOpportunity: p.library?.opportunity,
    libraryUtilisation: p.library?.utilisation,
    libraryEvidence: p.library?.evidence,
    responseQuality: p.responseQuality,
  };
}

export function selectHumanValidationShortlist(playlists: ForensicPlaylist[]): HumanValidationItem[] {
  const unused = [...playlists];
  const take = (pred: (p: ForensicPlaylist) => boolean, why: string, question: string): HumanValidationItem | null => {
    const i = unused.findIndex(pred);
    if (i < 0) return null;
    const p = unused.splice(i, 1)[0]!;
    const base = p.promptId.replace(/-r[12]$/, "");
    for (let j = unused.length - 1; j >= 0; j--) {
      if (unused[j]!.promptId.replace(/-r[12]$/, "") === base) unused.splice(j, 1);
    }
    return toItem(p, why, question);
  };

  const items: HumanValidationItem[] = [];
  const push = (x: HumanValidationItem | null) => {
    if (x) items.push(x);
  };

  push(take(
    (p) => (p.bucket === "CLEARLY_GOOD" || p.bucket === "PROBABLY_GOOD") && p.delivered >= 20,
    "Likely excellent — long playlist, no severe world mismatch",
    "If this is actually saveable, open/activity prompts can work on this library.",
  ));
  push(take(
    (p) => (p.bucket === "PROBABLY_GOOD" || p.bucket === "INSUFFICIENT_EVIDENCE") && /vague|natural|mood/.test(p.category) && p.delivered >= 7,
    "Likely good library-taste playlist on a vague/mood prompt",
    "Would a human save this even though the prompt was vague?",
  ));
  push(take(
    (p) => /indie rock/i.test(p.prompt) && p.delivered < p.requested,
    "High-opportunity underfill — favourite-genre depth vs short delivery",
    "Given a deep indie library, is 14/25 actually a good Kwalify answer?",
  ));
  push(take(
    (p) => p.failureClasses.some((f) => f.class === "UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY") && !/indie rock/i.test(p.prompt),
    "Underfill despite abundant relevant library",
    "Did Kwalify fail to admit available matching tracks?",
  ));
  push(take(
    (p) => p.delivery === "refused" || p.delivery === "empty",
    "Obvious failure — generation refused/empty",
    "Is honest refusal the right product behaviour here?",
  ));
  push(take(
    (p) => p.failureClasses.some((f) => f.class === "ERA_FAILURE"),
    "Obvious failure — requested era is absent",
    "Confirm that zero in-era tracks is as bad as it looks.",
  ));
  push(take(
    (p) => p.evaluatorConflict === "hcs_optimistic" || p.evaluatorConflict === "hcs_vs_verifier",
    "Evaluator conflict — HCS high vs forensic/verifier low",
    "Is HCS lying, or is the playlist secretly fine despite metadata?",
  ));
  push(take(
    (p) => p.verifierVerdict === "weak" && (p.hcsScore ?? 0) >= 85,
    "Evaluator conflict — HCS vs independent verifier",
    "Which automated signal should we believe for this prompt class?",
  ));
  push(take(
    (p) => p.failureClasses.some((f) => f.class === "SEVERE_WORLD_MISMATCH") && /shoegaze|trip-?hop|britpop/i.test(p.prompt),
    "Severe wrong-world (narrow genre)",
    "Is this unlistenable as the requested genre, or a decent playlist in the wrong world?",
  ));
  push(take(
    (p) => p.failureClasses.some((f) => f.class === "NEIGHBOUR_GENRE_SUBSTITUTION" || (f.class === "SEVERE_WORLD_MISMATCH" && /grime/i.test(p.prompt))),
    "Severe wrong-world / neighbour substitution",
    "Did the system substitute a neighbouring scene (e.g. garage for grime)?",
  ));
  push(take(
    (p) => p.category === "compound" && p.failureClasses.some((f) => f.class === "COMPOUND_INTENT_COLLAPSE"),
    "Compound-intent case",
    "Does it satisfy BOTH halves, or only one?",
  ));
  push(take(
    (p) => p.category === "negative_constraint" || p.failureClasses.some((f) => f.class === "NEGATIVE_CONSTRAINT_RISK"),
    "Negative-constraint case",
    "Was the exclusion actually respected?",
  ));
  push(take(
    (p) => p.delivery === "partial" && p.delivered > 0 && p.delivered <= 6,
    "Underfilled playlist",
    "Is a short list acceptable, or does this feel broken?",
  ));
  push(take(
    (p) => (p.replayJaccard ?? 0) >= 0.95 && p.delivered >= 6,
    "Replay-similarity case (near-identical rerun)",
    "Does regenerating this prompt feel like the same playlist?",
  ));

  return items.slice(0, 15);
}

function rankFailures(playlists: ForensicPlaylist[]): ForensicDiagnosis["failureRank"] {
  const groups = new Map<ForensicFailureClass, ForensicPlaylist[]>();
  for (const p of playlists) {
    const seen = new Set<ForensicFailureClass>();
    for (const f of p.failureClasses) {
      if (seen.has(f.class)) continue;
      seen.add(f.class);
      const arr = groups.get(f.class) ?? [];
      arr.push(p);
      groups.set(f.class, arr);
    }
  }

  const catalog: Array<Omit<ForensicDiagnosis["failureRank"][number], "count" | "exampleRequestIds">> = [
    {
      class: "SEVERE_WORLD_MISMATCH",
      severity: "high",
      observed: "Requested musical world is absent; contradictory artists appear from track 1.",
      likelyRootCause: "World retrieval/admission fails; a default library cluster is still shipped after gate_failure.",
      alternatives: ["Library truly lacks the world", "Traces omit real retrieval", "Scoring ranks the default cluster first"],
      evidenceRequired: "Full retrieval/world/rejection traces for shoegaze, 80s synthpop, 90s alt vs gym refuse.",
      subsystem: "world gate + post-gate admission (not HCS scoring)",
    },
    {
      class: "CONTEXTUAL_DEFAULT_CLUSTER",
      severity: "high",
      observed: "The same tracks appear across unrelated prompt categories.",
      likelyRootCause: "A small library house-style set is used as a universal fallback.",
      alternatives: ["This is the user's real taste and is correct for vague prompts", "Artist caps force recycling"],
      evidenceRequired: "Per-prompt candidate lists vs final tracks.",
      subsystem: "candidate admission after failed world match",
    },
    {
      class: "ERA_FAILURE",
      severity: "high",
      observed: "Explicit era requests contain zero in-era tracks.",
      likelyRootCause: "Era is not enforced as a hard constraint when the library is sparse.",
      alternatives: ["No in-era tracks in library", "Release-year metadata wrong"],
      evidenceRequired: "Whether any in-era candidates were retrieved then rejected.",
      subsystem: "era constraint / retrieval filters",
    },
    {
      class: "NEIGHBOUR_GENRE_SUBSTITUTION",
      severity: "high",
      observed: "Narrow genre replaced by a neighbouring scene (e.g. grime → UK garage).",
      likelyRootCause: "UK scene bucket treats garage/grime as one world.",
      alternatives: ["Library has garage and almost no grime"],
      evidenceRequired: "Intent/world id for grime vs UK garage runs.",
      subsystem: "world identity / UK scene routing",
    },
    {
      class: "ACTIVITY_REFUSAL",
      severity: "high",
      observed: "Gym and late-night drive 422-refuse while other prompts ship a default cluster.",
      likelyRootCause: "Gate refuse is applied inconsistently vs gate_failure-still-ships.",
      alternatives: ["Library cannot support those activities"],
      evidenceRequired: "Compare gym refuse trace to 80s synthpop gate_failure that still shipped.",
      subsystem: "human-quality gate policy after world failure",
    },
    {
      class: "COMPOUND_INTENT_COLLAPSE",
      severity: "medium",
      observed: "Only one half of a compound prompt survives.",
      likelyRootCause: "One library cluster wins composition.",
      alternatives: ["Audio-feature proxies are wrong; humans may hear both halves"],
      evidenceRequired: "Human listen of one compound shortlist item.",
      subsystem: "intent intersection / composition",
    },
    {
      class: "UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY",
      severity: "high",
      observed: "Requested length not met despite a large relevant library (candidate/admission failure until disproven).",
      likelyRootCause: "Relevant tracks exist in likes but are not admitted into the final playlist.",
      alternatives: ["Relevance classifier over-counts", "Caps/diversity truncate a valid short list"],
      evidenceRequired: "Per-prompt relevant-library count vs rejection/admission traces.",
      subsystem: "candidate admission / length fulfilment — not sparse-library copy",
    },
    {
      class: "MISSED_LIBRARY_OPPORTUNITY",
      severity: "high",
      observed: "Library contains many prompt-relevant tracks; the playlist used almost none of them.",
      likelyRootCause: "Wrong-world fallback or house cluster replaced the relevant pool.",
      alternatives: ["Classification of likes is too generous"],
      evidenceRequired: "Compare relevant like IDs vs final track IDs.",
      subsystem: "retrieval/admission vs default cluster",
    },
    {
      class: "SPARSE_LIBRARY",
      severity: "medium",
      observed: "Underfill with a measured small relevant pool.",
      likelyRootCause: "User library may not support a 25-track version of this world.",
      alternatives: ["Classifier under-counts relevant likes"],
      evidenceRequired: "Human check of whether the library actually contains the world.",
      subsystem: "product: honest partial vs refuse",
    },
    {
      class: "HONEST_REFUSAL",
      severity: "medium",
      observed: "Generation refused rather than shipping a filler playlist.",
      likelyRootCause: "Quality gate refuse path.",
      alternatives: ["Refuse is wrong if the library actually has the activity/world"],
      evidenceRequired: "Library opportunity for the refused prompt vs gym/drive traces.",
      subsystem: "refuse vs gate_failure-still-ships policy",
    },
    {
      class: "PROMPT_OUTLIER",
      severity: "high",
      observed: "Opening tracks contradict the requested world.",
      likelyRootCause: "Opener selection ignores world identity.",
      alternatives: ["Token list is too strict"],
      evidenceRequired: "First-track listen + library alternatives.",
      subsystem: "opening curator / world admission",
    },
    {
      class: "EVALUATOR_DISAGREEMENT",
      severity: "medium",
      observed: "HCS / independent verifier / forensic world evidence disagree.",
      likelyRootCause: "HCS rewards coherence; forensic checks prompt-world fit.",
      alternatives: ["Humans may side with either signal"],
      evidenceRequired: "Human YES/NO on the shortlist item.",
      subsystem: "evaluator calibration (not V55)",
    },
    {
      class: "UNDERFILL_SILENT",
      severity: "medium",
      observed: "Requested 25, delivered far fewer, previously labelled success.",
      likelyRootCause: "Sparse in-world pool and/or caps; evaluator previously treated delivered as requested.",
      alternatives: ["Honest partial is correct if explained in the UI"],
      evidenceRequired: "Rejection reasons for dropped candidates.",
      subsystem: "candidate depth + product copy for partials",
    },
    {
      class: "NEGATIVE_CONSTRAINT_RISK",
      severity: "medium",
      observed: "Possible exclusion violations (e.g. mainstream artists on 'no mainstream').",
      likelyRootCause: "Negations are not hard-filtered.",
      alternatives: ["Mainstream is subjective for this user's library"],
      evidenceRequired: "Human verdict on the negative-constraint shortlist item.",
      subsystem: "negation handling",
    },
    {
      class: "KEYWORD_LITERAL_OPENING",
      severity: "medium",
      observed: "Opening tracks match prompt words in titles/artist names.",
      likelyRootCause: "Literal keyword retrieval.",
      alternatives: ["Coincidence"],
      evidenceRequired: "Opening listen.",
      subsystem: "retrieval query / opener selection",
    },
    {
      class: "TIMEOUT_FALLBACK",
      severity: "medium",
      observed: "Timeout stub shipped.",
      likelyRootCause: "Generation exceeded timeout on an activity prompt.",
      alternatives: ["Local resource contention during the 100-run"],
      evidenceRequired: "Timeout logs for that request id.",
      subsystem: "reliability / activity path",
    },
    {
      class: "REPLAY_LOW_VARIATION",
      severity: "low",
      observed: "Reruns of the same prompt are near-identical.",
      likelyRootCause: "Deterministic ranking of a tiny candidate pool.",
      alternatives: ["Seed ignored in audit mode"],
      evidenceRequired: "Whether seed reached the sampler.",
      subsystem: "sampling / seed",
    },
    {
      class: "ARTIST_CLUSTERING",
      severity: "low",
      observed: "Three consecutive / dominant artists.",
      likelyRootCause: "Artist caps not applied or set high.",
      alternatives: ["Short playlists make 3 tracks look dominant"],
      evidenceRequired: "Cap settings vs delivered repeats.",
      subsystem: "diversity caps",
    },
    {
      class: "INCOMPLETE_TRACE",
      severity: "medium",
      observed: "Retrieval/world/sampler marked skipped; funnel counts 0.",
      likelyRootCause: "Audit payload does not include those stages.",
      alternatives: ["Those stages truly did not run"],
      evidenceRequired: "A full pipeline trace for one gate_failure and one full_pipeline run.",
      subsystem: "observability (evaluator/trace), not generation logic",
    },
  ];

  const ranked: ForensicDiagnosis["failureRank"] = [];
  for (const row of catalog) {
    const rows = groups.get(row.class) ?? [];
    if (rows.length === 0) continue;
    ranked.push({
      ...row,
      count: rows.length,
      exampleRequestIds: rows.slice(0, 5).map((r) => r.requestId),
    });
  }
  ranked.sort((a, b) => {
    const sev = { high: 10, medium: 2, low: 1 };
    return b.count * sev[b.severity] - a.count * sev[a.severity];
  });
  return ranked.filter((r) => r.class !== "INCOMPLETE_TRACE");
}

export function diagnose100GenerationRecords(
  records: Benchmark100GenerationRecord[],
  requestedLength = BENCHMARK100_PLAYLIST_LENGTH,
  library: QaLibrarySnapshot | null = null,
): ForensicDiagnosis {
  const cluster = detectDefaultCluster(records);
  const clusterKeys = new Set(cluster.map((c) => c.key));
  const replays = replayMap(records);
  const playlists = records.map((r) =>
    classifyRecord(r, clusterKeys, replays.get(r.runItem.requestId) ?? null, requestedLength, library),
  );

  const totals: Record<ForensicBucket, number> = {
    CLEARLY_GOOD: 0,
    PROBABLY_GOOD: 0,
    MIXED: 0,
    PROBABLY_BAD: 0,
    CLEARLY_BAD: 0,
    TECHNICAL_FAILURE: 0,
    INSUFFICIENT_EVIDENCE: 0,
  };
  const delivery: Record<DeliveryKind, number> = {
    full: 0,
    partial: 0,
    refused: 0,
    empty: 0,
    timeout_fallback: 0,
    technical_failure: 0,
  };
  for (const p of playlists) {
    totals[p.bucket] += 1;
    delivery[p.delivery] += 1;
  }

  const failureRank = rankFailures(playlists);
  const shortlist = selectHumanValidationShortlist(playlists);
  const highOppUnderfill = playlists.filter((p) =>
    p.failureClasses.some((f) => f.class === "UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY"),
  ).length;
  const indie = playlists.find((p) => /indie rock/i.test(p.prompt));
  const recommendedNextAction = highOppUnderfill > 0
    ? `Investigate candidate admission for high-opportunity underfill (e.g. indie rock ${indie?.delivered ?? "?"}/${requestedLength} with ${indie?.library?.strongRelevantCount ?? "unknown"} strong library matches). Do not treat this as sparse library until the relevant pool is shown to be small. Do not change V55 until humans review the Spotify QA shortlist.`
    : "Investigate why failed world-gate candidates can still become final playlists (compare gym refuse vs 80s/shoegaze/90s-alt gate_failure that still shipped). Do not change the engine until those traces and the human shortlist are reviewed.";

  return {
    generatedAt: new Date().toISOString(),
    benchmarkRunId: records[0]?.benchmarkRunId ?? "unknown",
    requestedLength,
    totals,
    delivery,
    defaultCluster: cluster.slice(0, 20),
    playlists,
    failureRank,
    shortlist,
    recommendedNextAction,
    doNotBuild: [
      "Do not create V56",
      "Do not raise HCS thresholds (HCS is already optimistic on wrong-world playlists)",
      "Do not add refill to force gym/drive completions",
      "Do not treat vague-prompt house-library output as a bug",
      "Do not build a dashboard, LLM judge, or auto-optimisation loop",
    ],
    working: [
      "Vague/natural/mood prompts return this user's library (taste-fit hypothesis)",
      "UK garage neighbourhood often recognisable",
      "Cooking dinner can fill to 25",
      "Gym quality-gate refuse is honest product behaviour",
    ],
    broken: [
      "Narrow worlds (shoegaze, 80s synthpop, 90s alt, Bristol trip-hop) collapse to a default library cluster or the wrong neighbour",
      "Requested 25 vs typical far fewer delivered — underfill is a generation-quality question, especially when library opportunity is high",
      "Coherence is not a good-answer proof (indie rock 14-track case)",
      "Gate failure still ships playlists; gym refuses — inconsistent",
      "Replay clones",
    ],
  };
}
