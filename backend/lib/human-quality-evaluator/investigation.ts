/**
 * Cross-case investigation, root-cause hypotheses, and the single next action.
 * Does not modify V55. Incomplete traces must not be treated as retrieved=0.
 */

import type { ForensicDiagnosis, ForensicPlaylist } from "./forensic-analysis";
import type { GoldLabel, GoldSet } from "./gold-set";

export type NextAction =
  | "DO NOTHING"
  | "GATHER MORE HUMAN EVIDENCE"
  | "FIX OBSERVABILITY"
  | "INVESTIGATE RETRIEVAL"
  | "INVESTIGATE ADMISSION"
  | "INVESTIGATE WORLD GATE"
  | "INVESTIGATE UNDERFILL"
  | "INVESTIGATE COMPOUND INTENT"
  | "INVESTIGATE REPETITION"
  | "FIX TECHNICAL RELIABILITY"
  | "MAKE ONE TARGETED ENGINE CHANGE";

export type SubsystemHypothesis =
  | "prompt_interpretation"
  | "candidate_retrieval"
  | "candidate_admission"
  | "world_filtering"
  | "genre_classification"
  | "era_filtering"
  | "negative_constraint_handling"
  | "compound_intent_handling"
  | "artist_caps"
  | "candidate_scarcity"
  | "underfill_refill"
  | "sequencing"
  | "duplicate_repetition"
  | "spotify_api"
  | "timeout"
  | "quality_gate"
  | "default_library_substitution"
  | "observability_tracing"
  | "evaluator_error"
  | "unresolved";

export type QualityDimensions = {
  promptUnderstanding: "strong" | "mixed" | "weak" | "unknown";
  promptWorldFidelity: "strong" | "mixed" | "weak" | "unknown";
  libraryUtilisation: "strong" | "mixed" | "weak" | "unknown";
  adequacy: "strong" | "mixed" | "weak" | "unknown";
  cohesion: "strong" | "mixed" | "weak" | "unknown";
  variety: "strong" | "mixed" | "weak" | "unknown";
};

export type DiagnosticRow = {
  prompt: string;
  requestId: string;
  opportunity: string;
  strongRelevant: number | null;
  delivered: number;
  requested: number;
  fill: string;
  worldFit: string;
  path: string | null;
  uniqueArtists: number;
  responseQuality: string;
  automated: string;
  human: string;
  humanClass: string | null;
};

export type EngineChangeGate = {
  met: boolean;
  repeated: boolean;
  userFacing: boolean;
  humanOrTechnical: boolean;
  subsystemIdentified: boolean;
  specificEffect: boolean;
  protectedBehaviourNamed: boolean;
  regressionExists: boolean;
  blockers: string[];
};

export type Investigation = {
  generatedAt: string;
  benchmarkRunId: string;
  engineFrozen: "V55";
  diagnosticGroup: DiagnosticRow[];
  commonMechanism: string;
  subsystem: SubsystemHypothesis;
  subsystemConfidence: "LOW" | "MEDIUM" | "HIGH";
  evidenceTypes: string[];
  observed: string[];
  hypotheses: string[];
  humanConfirmed: string[];
  evaluatorCalibration: string[];
  protectedControls: string[];
  engineChange: EngineChangeGate;
  nextAction: NextAction;
  nextActionWhy: string;
  minimumMeasurement: string;
};

function dimFromFit(v: string | undefined): QualityDimensions[keyof QualityDimensions] {
  if (v === "PASS") return "strong";
  if (v === "MIXED") return "mixed";
  if (v === "FAIL") return "weak";
  return "unknown";
}

export function qualityDimensions(p: ForensicPlaylist): QualityDimensions {
  const fill = p.fillSeverity;
  const adequacy =
    fill === "full" || fill === "near_full"
      ? "strong"
      : fill === "partial"
        ? "mixed"
        : fill === "severely_underfilled" || fill === "empty"
          ? "weak"
          : "unknown";
  const util = p.library?.utilisation;
  return {
    promptUnderstanding: dimFromFit(p.dimensions.PROMPT_FIT),
    promptWorldFidelity: dimFromFit(p.dimensions.WORLD_FIT),
    libraryUtilisation:
      util === "STRONG" || util === "REASONABLE" ? "strong" : util === "LOW" || util === "VERY_LOW" ? "weak" : "unknown",
    adequacy,
    cohesion: p.bucket === "CLEARLY_BAD" ? "mixed" : p.delivered >= 6 ? "strong" : "unknown",
    variety: dimFromFit(p.dimensions.VARIETY),
  };
}

export function hypothesizeSubsystem(p: ForensicPlaylist): {
  subsystem: SubsystemHypothesis;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  note: string;
} {
  if (p.delivery === "timeout_fallback") return { subsystem: "timeout", confidence: "HIGH", note: "Timeout stub observed." };
  if (p.delivery === "technical_failure") return { subsystem: "spotify_api", confidence: "MEDIUM", note: "HTTP/API failure observed." };
  if (p.delivery === "refused") return { subsystem: "quality_gate", confidence: "HIGH", note: "422 refuse observed." };
  if (p.traceIncomplete && p.failureClasses.some((f) => f.class === "UNDERFILL_WITH_HIGH_LIBRARY_OPPORTUNITY")) {
    return {
      subsystem: "observability_tracing",
      confidence: "HIGH",
      note: "High-opportunity underfill observed, but funnel counts are skipped/0. Cannot distinguish retrieval vs admission vs caps.",
    };
  }
  if (p.failureClasses.some((f) => f.class === "SEVERE_WORLD_MISMATCH" || f.class === "ERA_FAILURE")) {
    return {
      subsystem: p.library && (p.library.opportunity === "HIGH" || p.library.opportunity === "VERY_HIGH")
        ? "world_filtering"
        : "default_library_substitution",
      confidence: "MEDIUM",
      note: "Wrong world with non-zero delivery. Library opportunity says the world may exist in likes.",
    };
  }
  if (p.failureClasses.some((f) => f.class === "ARTIST_CLUSTERING") && p.fillSeverity === "severely_underfilled") {
    return { subsystem: "artist_caps", confidence: "MEDIUM", note: "Tiny playlist dominated by one artist." };
  }
  if (p.failureClasses.some((f) => f.class === "COMPOUND_INTENT_COLLAPSE")) {
    return { subsystem: "compound_intent_handling", confidence: "LOW", note: "One compound dimension looks weak; needs listening." };
  }
  if (p.library?.sparseLibrary) return { subsystem: "candidate_scarcity", confidence: "MEDIUM", note: "Measured relevant pool is small." };
  return { subsystem: "unresolved", confidence: "LOW", note: "Insufficient evidence." };
}

function rowFor(p: ForensicPlaylist | undefined, gold: GoldSet): DiagnosticRow | null {
  if (!p) return null;
  const human = gold.labels.find((l) => l.requestId === p.requestId);
  return {
    prompt: p.prompt,
    requestId: p.requestId,
    opportunity: p.library?.opportunity ?? "UNKNOWN",
    strongRelevant: p.library?.strongRelevantCount ?? null,
    delivered: p.delivered,
    requested: p.requested,
    fill: `${p.delivered}/${p.requested} (${p.fillSeverity})`,
    worldFit: p.dimensions.WORLD_FIT,
    path: p.executionPath,
    uniqueArtists: new Set(p.tracks.map((t) => t.artist.toLowerCase())).size,
    responseQuality: p.responseQuality,
    automated: p.bucket,
    human: human ? `${human.verdict} (${human.humanClass})` : "PENDING",
    humanClass: human?.humanClass ?? null,
  };
}

export function engineChangeThreshold(input: {
  humanConfirmedRepeatedUnderfill: boolean;
  subsystemIdentified: boolean;
  tracesComplete: boolean;
  protectedNamed: boolean;
}): EngineChangeGate {
  const repeated = input.humanConfirmedRepeatedUnderfill;
  const userFacing = true;
  const humanOrTechnical = input.humanConfirmedRepeatedUnderfill;
  const subsystemIdentified = input.subsystemIdentified && input.tracesComplete;
  const specificEffect = false;
  const protectedBehaviourNamed = input.protectedNamed;
  const regressionExists = true;
  const blockers: string[] = [];
  if (!input.tracesComplete) blockers.push("INCOMPLETE_TRACE — cannot locate the drop stage");
  if (!subsystemIdentified) blockers.push("Subsystem not identified beyond hypothesis");
  if (!specificEffect) blockers.push("No single engine change with a stated expected effect");
  const met =
    repeated
    && userFacing
    && humanOrTechnical
    && subsystemIdentified
    && specificEffect
    && protectedBehaviourNamed
    && regressionExists
    && blockers.length === 0;
  return {
    met,
    repeated,
    userFacing,
    humanOrTechnical,
    subsystemIdentified,
    specificEffect,
    protectedBehaviourNamed,
    regressionExists,
    blockers,
  };
}

export function investigate(diagnosis: ForensicDiagnosis, gold: GoldSet): Investigation {
  const byPrompt = (re: RegExp) => diagnosis.playlists.find((p) => re.test(p.prompt));
  const indie = byPrompt(/^indie rock$/i);
  const twoThousands = byPrompt(/^2000s indie$/i);
  const nineties = byPrompt(/90s alternative/i);
  const melancholic = byPrompt(/^melancholic$/i);
  const nostalgic = byPrompt(/^nostalgic$/i);

  const diagnosticGroup = [indie, twoThousands, nineties]
    .map((p) => rowFor(p ?? undefined, gold))
    .filter((r): r is DiagnosticRow => Boolean(r));

  const human = (id: string | undefined) => gold.labels.find((l) => l.requestId === id);
  const indieH = human(indie?.requestId);
  const twoH = human(twoThousands?.requestId);
  const nostH = human(nostalgic?.requestId);
  const melH = human(melancholic?.requestId);

  const humanConfirmed: string[] = [];
  if (melH?.verdict === "YES") humanConfirmed.push("melancholic = genuinely good (POSITIVE CONTROL — protect)");
  if (nostH?.verdict === "NO") humanConfirmed.push("nostalgic = bad (do not engine-change from this alone)");
  if (indieH?.humanClass === "CORRECT_WORLD_UNDERFILL") {
    humanConfirmed.push("indie rock = good music / underfilled 14/25 (not a total retrieval failure)");
  }
  if (twoH?.verdict === "NO") {
    humanConfirmed.push("2000s indie = bad (3 tracks, repetition, high opportunity)");
  }

  const observed: string[] = [
    `${diagnosis.delivery.partial}/${diagnosis.playlists.length} underfilled vs requested ${diagnosis.requestedLength}`,
    indie ? `indie rock ${indie.delivered}/${indie.requested}, path=${indie.executionPath}, opportunity=${indie.library?.strongRelevantCount ?? "?"}` : "",
    twoThousands ? `2000s indie ${twoThousands.delivered}/${twoThousands.requested}, uniqueArtists=${new Set(twoThousands.tracks.map((t) => t.artist)).size}, path=${twoThousands.executionPath}` : "",
    nineties ? `90s alt ${nineties.delivered}/${nineties.requested}, world=${nineties.dimensions.WORLD_FIT}, path=${nineties.executionPath}` : "",
    `INCOMPLETE_TRACE on ${diagnosis.playlists.filter((p) => p.traceIncomplete).length}/${diagnosis.playlists.length} runs`,
  ].filter(Boolean);

  const hypotheses: string[] = [
    "gate_failure still ships a short or substituted list instead of refusing or admitting from the relevant pool (HYPOTHESIS).",
    "Default-library artists can be correct for indie (human YES) and wrong for 90s alt / nostalgic — cluster is contextual (HYPOTHESIS + partial human evidence).",
    "2000s indie collapsed to one artist (Bon Iver ×3) — artist cap / refill / admission, not sparse library (HYPOTHESIS; library evidence contradicts scarcity).",
  ];

  const tracesComplete = diagnosis.playlists.every((p) => !p.traceIncomplete || p.delivery === "refused");
  const humanConfirmedRepeatedUnderfill = Boolean(
    indieH?.humanClass === "CORRECT_WORLD_UNDERFILL" && twoH?.verdict === "NO",
  );
  const engineChange = engineChangeThreshold({
    humanConfirmedRepeatedUnderfill,
    subsystemIdentified: false,
    tracesComplete,
    protectedNamed: Boolean(melH?.protect),
  });

  const nextAction: NextAction = engineChange.met
    ? "MAKE ONE TARGETED ENGINE CHANGE"
    : !tracesComplete && humanConfirmedRepeatedUnderfill
      ? "FIX OBSERVABILITY"
      : humanConfirmedRepeatedUnderfill
        ? "INVESTIGATE ADMISSION"
        : gold.labels.length < 8
          ? "GATHER MORE HUMAN EVIDENCE"
          : "DO NOTHING";

  const nextActionWhy =
    nextAction === "FIX OBSERVABILITY"
      ? "Humans confirmed high-opportunity underfill (indie good-but-short; 2000s indie 3-track fail). funnel traces are skipped/0, so retrieval vs admission vs caps cannot be distinguished. Do not change V55 until the drop stage is visible."
      : nextAction === "GATHER MORE HUMAN EVIDENCE"
        ? "90s alt is still unconfirmed. Nostalgic is confirmed bad but must not drive an engine change alone."
        : nextAction;

  return {
    generatedAt: new Date().toISOString(),
    benchmarkRunId: diagnosis.benchmarkRunId,
    engineFrozen: "V55",
    diagnosticGroup,
    commonMechanism:
      "All three diagnostic prompts (indie / 2000s indie / 90s alt) shipped via gate_failure, underfilled, with HIGH/VERY_HIGH measured library opportunity. Common mechanism is post-gate length/world handling — not proven, traces incomplete.",
    subsystem: "observability_tracing",
    subsystemConfidence: "HIGH",
    evidenceTypes: ["automated observation", "library evidence", "human evidence", "incomplete trace"],
    observed,
    hypotheses,
    humanConfirmed,
    evaluatorCalibration: buildCalibrationNotes(gold, diagnosis),
    protectedControls: gold.labels.filter((l) => l.protect).map((l) => `${l.prompt} (${l.requestId})`),
    engineChange,
    nextAction,
    nextActionWhy,
    minimumMeasurement:
      "Persist retrieved / world-admitted / rejected counts and top rejection reasons on the generate audit payload without changing which tracks are selected. Then re-diagnose the same JSONL-equivalent fields.",
  };
}

function buildCalibrationNotes(gold: GoldSet, diagnosis: ForensicDiagnosis): string[] {
  const notes: string[] = [];
  for (const label of gold.labels) {
    const p = diagnosis.playlists.find((x) => x.requestId === label.requestId);
    if (!p) continue;
    const autoGood = p.bucket === "CLEARLY_GOOD" || p.bucket === "PROBABLY_GOOD";
    const autoBad = p.bucket === "CLEARLY_BAD" || p.bucket === "PROBABLY_BAD";
    if (autoGood && label.verdict === "NO") {
      notes.push(`AUTOMATED_BLIND_SPOT: ${label.prompt} auto ${p.bucket} / human NO (${label.humanClass})`);
    } else if (autoBad && label.verdict === "YES") {
      notes.push(`AUTOMATED_FALSE_ALARM: ${label.prompt} auto ${p.bucket} / human YES`);
    } else if (p.bucket === "MIXED" && label.humanClass === "CORRECT_WORLD_UNDERFILL") {
      notes.push(`DIMENSIONAL_AGREEMENT: ${label.prompt} auto MIXED matches human YES + too short (world ok, adequacy fail)`);
    } else if (p.bucket === "MIXED" && label.verdict === "NO") {
      notes.push(`DIRECTIONAL_AGREEMENT: ${label.prompt} auto MIXED / human NO — not CLEARLY_GOOD, still under-called severity`);
    } else if (autoGood && label.verdict === "YES") {
      notes.push(`TRUE POSITIVE: ${label.prompt}`);
    }
  }
  notes.push("HCS remains AUTOMATED PROXY — not human quality. Do not retune HCS to chase agreement.");
  return notes;
}

export function formatInvestigationMarkdown(inv: Investigation): string {
  const lines: string[] = [
    "# HUMAN-QUALITY INVESTIGATION",
    "",
    `Benchmark: ${inv.benchmarkRunId}`,
    `Engine: ${inv.engineFrozen} FROZEN`,
    `Generated: ${inv.generatedAt}`,
    "",
    "## EXECUTIVE SUMMARY",
    "",
    inv.commonMechanism,
    "",
    `ONE RECOMMENDED NEXT ACTION: **${inv.nextAction}**`,
    "",
    inv.nextActionWhy,
    "",
    `Minimum measurement: ${inv.minimumMeasurement}`,
    "",
    "## HUMAN-CONFIRMED",
    "",
    ...(inv.humanConfirmed.length ? inv.humanConfirmed.map((x) => `- ${x}`) : ["- None"]),
    "",
    "## AUTOMATED OBSERVATIONS",
    "",
    ...inv.observed.map((x) => `- ${x}`),
    "",
    "## AUTOMATED HYPOTHESES",
    "",
    ...inv.hypotheses.map((x) => `- ${x}`),
    "",
    "## DIAGNOSTIC GROUP (indie / 2000s indie / 90s alt)",
    "",
    "| Prompt | Opportunity | Strong likes | Delivered | World | Path | Artists | Auto | Human |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of inv.diagnosticGroup) {
    lines.push(
      `| ${r.prompt} | ${r.opportunity} | ${r.strongRelevant ?? "?"} | ${r.fill} | ${r.worldFit} | ${r.path ?? "?"} | ${r.uniqueArtists} | ${r.automated} | ${r.human} |`,
    );
  }
  lines.push(
    "",
    "## ENGINE CHANGE THRESHOLD",
    "",
    `- Met: ${inv.engineChange.met ? "YES" : "NO — V55 stays frozen"}`,
    ...inv.engineChange.blockers.map((b) => `- Blocker: ${b}`),
    "",
    "## EVALUATOR CALIBRATION",
    "",
    ...inv.evaluatorCalibration.map((x) => `- ${x}`),
    "",
    "## POSITIVE CONTROLS (must not break)",
    "",
    ...(inv.protectedControls.length ? inv.protectedControls.map((x) => `- ${x}`) : ["- none yet"]),
    "",
    "## ROOT-CAUSE",
    "",
    `- Subsystem: ${inv.subsystem} (confidence ${inv.subsystemConfidence})`,
    `- Evidence types: ${inv.evidenceTypes.join(", ")}`,
    "",
    "Root cause of the *drop stage* is unresolved because instrumentation is insufficient.",
    "",
  );
  return lines.join("\n");
}
