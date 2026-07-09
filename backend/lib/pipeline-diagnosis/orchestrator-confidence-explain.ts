/**
 * Diagnosis-only explainer for orchestrator libraryCapability / combinedConfidence.
 * Mirrors formulas in playlist-retrieval-orchestrator.ts — does not change generation.
 */

import type { LibraryCapability } from "../playlist-retrieval-orchestrator";

export type CapabilityWeights = {
  activity: number;
  genre: number;
  energy: number;
  sonic: number;
  opener: number;
  diversity: number;
};

export type ConfidenceComponentBreakdown = {
  component: string;
  rawScore: number;
  weight: number;
  contribution: number;
  contributionPct: number;
  failed: boolean;
  failureThreshold?: number;
  failureReason?: string;
};

export type OrchestratorGateThresholds = {
  functionalPrompt: boolean;
  preRetrievalMin: number;
  postRetrievalMin: number;
  sufficiencyMin: number;
  minRequiredValidCandidates: number;
  libraryConflictScoreCap: number;
};

export type OrchestratorConfidenceExplanation = {
  promptId: string;
  prompt: string;
  requestedLength: number;
  functionalPrompt: boolean;
  weights: CapabilityWeights;
  components: ConfidenceComponentBreakdown[];
  rawWeightedScore: number;
  roundedScore: number;
  reportedScore: number;
  libraryConflictCapApplied: boolean;
  limitingFactors: string[];
  gateThresholds: OrchestratorGateThresholds;
  likelyGate: string;
  gateReason: string;
  retrievalAttempts: number;
  validCandidateSupply?: {
    strictValidCount?: number;
    relaxedValidCount?: number;
    recoveryValidCount?: number;
    minRequired?: number;
    sufficient?: boolean;
    limitingDimensions?: string[];
  };
  pathsToGeneration: string[];
  roiAnswer: {
    dominantDrag: string;
    conflictIsPrimaryBlocker: boolean;
    energyIsPrimaryDrag: boolean;
    genreDiversityIsPrimaryDrag: boolean;
    weakOpenerIsPrimaryDrag: boolean;
  };
};

const FUNCTIONAL_ACTIVITIES = new Set(["focus_coding", "study", "gym", "party_pregame"]);

const COMPONENT_FAILURE_THRESHOLDS: Record<string, number> = {
  activity: 35,
  genre: 30,
  energy: 40,
  sonic: 32,
  opener: 45,
  diversity: 25,
};

const LIMITING_FACTOR_LABELS: Record<string, string> = {
  library_too_small: "Library has fewer than 40 liked tracks",
  low_activity_match: "Activity fit below 35% of sample",
  genre_gap: "Genre match below 30% when genres expected",
  energy_distribution_mismatch: "Energy/tempo band fit below 40% of sample",
  low_sonic_match: "Sonic prompt fit below 32% of sample",
  weak_opening_candidates: "Strong opener candidates below 45% threshold",
  low_genre_diversity: "Genre family entropy below 25%",
  library_prompt_conflict:
    "Library sonic profile conflicts with activity (gym: low mean energy + dominant genre family ≥45%)",
};

export function capabilityWeights(functionalPrompt: boolean): CapabilityWeights {
  return functionalPrompt
    ? { activity: 0.26, genre: 0.14, energy: 0.16, sonic: 0.14, opener: 0.18, diversity: 0.12 }
    : { activity: 0.16, genre: 0.18, energy: 0.14, sonic: 0.18, opener: 0.18, diversity: 0.16 };
}

export function gateThresholds(functionalPrompt: boolean, requestedLength: number): OrchestratorGateThresholds {
  return {
    functionalPrompt,
    preRetrievalMin: functionalPrompt ? 34 : 22,
    postRetrievalMin: functionalPrompt ? 40 : 28,
    sufficiencyMin: functionalPrompt ? 42 : 30,
    minRequiredValidCandidates: Math.max(5, Math.ceil(requestedLength * 0.4)),
    libraryConflictScoreCap: 28,
  };
}

function asCapability(input: Record<string, unknown>): LibraryCapability {
  return {
    score: num(input.score) ?? 0,
    activityScore: num(input.activityScore) ?? 0,
    genreScore: num(input.genreScore) ?? 0,
    energyScore: num(input.energyScore) ?? 0,
    sonicScore: num(input.sonicScore) ?? 0,
    promptFitScore: num(input.promptFitScore) ?? 0,
    openerScore: num(input.openerScore) ?? 0,
    diversityScore: num(input.diversityScore) ?? 0,
    limitingFactors: Array.isArray(input.limitingFactors)
      ? input.limitingFactors.map(String)
      : [],
  };
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function inferFunctionalPrompt(activity: string | null | undefined, limitingFactors: string[]): boolean {
  if (activity === "gym" || activity === "party" || activity === "party_pregame") return true;
  return limitingFactors.includes("library_prompt_conflict");
}

export function explainOrchestratorConfidence(input: {
  promptId: string;
  prompt: string;
  requestedLength: number;
  activity?: string | null;
  libraryCapability: Record<string, unknown> | LibraryCapability;
  retrievalAttempts?: number;
  combinedConfidence?: number;
  validCandidateSupply?: Record<string, unknown>;
  failureCode?: string;
}): OrchestratorConfidenceExplanation {
  const cap = typeof input.libraryCapability === "object" && "activityScore" in input.libraryCapability
    ? input.libraryCapability as LibraryCapability
    : asCapability(input.libraryCapability as Record<string, unknown>);

  const functionalPrompt = inferFunctionalPrompt(input.activity, cap.limitingFactors);
  const weights = capabilityWeights(functionalPrompt);
  const thresholds = gateThresholds(functionalPrompt, input.requestedLength);

  const componentScores: Array<[string, number]> = [
    ["activity", cap.activityScore],
    ["genre", cap.genreScore],
    ["energy", cap.energyScore],
    ["sonic", cap.sonicScore],
    ["opener", cap.openerScore],
    ["diversity", cap.diversityScore],
  ];

  const components: ConfidenceComponentBreakdown[] = componentScores.map(([component, rawScore]) => {
    const weight = weights[component as keyof CapabilityWeights];
    const contribution = rawScore * weight;
    const failureThreshold = COMPONENT_FAILURE_THRESHOLDS[component];
    const failed = rawScore < failureThreshold;
    return {
      component,
      rawScore,
      weight,
      contribution: Math.round(contribution * 100) / 100,
      contributionPct: 0,
      failed,
      failureThreshold,
      failureReason: failed
        ? `${component} score ${rawScore} < threshold ${failureThreshold}`
        : undefined,
    };
  });

  const rawWeightedScore = components.reduce((sum, row) => sum + row.contribution, 0);
  const roundedScore = Math.round(rawWeightedScore);
  const libraryConflictCapApplied = cap.limitingFactors.includes("library_prompt_conflict");
  const reportedScore = cap.score;
  const afterCapScore = libraryConflictCapApplied
    ? Math.min(roundedScore, thresholds.libraryConflictScoreCap)
    : roundedScore;

  for (const row of components) {
    row.contributionPct = rawWeightedScore > 0
      ? Math.round((row.contribution / rawWeightedScore) * 1000) / 10
      : 0;
  }

  const supply = input.validCandidateSupply ?? {};
  const relaxedValid = num(supply.relaxedValidCount);
  const strictValid = num(supply.strictValidCount);
  const minRequired = num(supply.minRequired) ?? thresholds.minRequiredValidCandidates;
  const sufficient = supply.sufficient === true;

  const retrievalAttempts = input.retrievalAttempts ?? 0;
  const hasConflict = cap.limitingFactors.includes("library_prompt_conflict");

  let likelyGate = "unknown";
  let gateReason = "Gate could not be determined from stored diagnostics.";

  if (input.failureCode === "LIBRARY_INSUFFICIENT_FOR_PROMPT" && retrievalAttempts === 0) {
    if (hasConflict && (relaxedValid == null || relaxedValid < minRequired)) {
      likelyGate = "conflict_blocks_retrieval";
      gateReason =
        `library_prompt_conflict is set AND relaxed valid candidates ` +
        `(${relaxedValid ?? "unknown"}) < minRequired (${minRequired}). Retrieval never runs.`;
    } else if (reportedScore < thresholds.preRetrievalMin && (relaxedValid == null || relaxedValid < minRequired)) {
      likelyGate = "capability_blocks_retrieval";
      gateReason =
        `libraryCapability.score (${reportedScore}) < preRetrievalMin (${thresholds.preRetrievalMin}) ` +
        `AND relaxed supply (${relaxedValid ?? "unknown"}) < minRequired (${minRequired}).`;
    } else if (cap.limitingFactors.includes("library_too_small")) {
      likelyGate = "library_too_small";
      gateReason = "Fewer than 40 liked tracks in library.";
    }
  } else if (retrievalAttempts > 0) {
    likelyGate = "post_retrieval_confidence";
    gateReason = "Retrieval ran; failure would be post-retrieval combinedConfidence or sufficiency.";
  }

  const pathsToGeneration: string[] = [];
  if (hasConflict) {
    pathsToGeneration.push(
      "Resolve library_prompt_conflict: for gym, library mean energy must reach ≥0.52 OR dominant genre-family share must drop below 45%.",
    );
    pathsToGeneration.push(
      `OR supply ${minRequired}+ relaxed-valid candidates despite conflict (currently ${relaxedValid ?? "unknown"}).`,
    );
  }
  if (reportedScore < thresholds.preRetrievalMin) {
    pathsToGeneration.push(
      `Raise libraryCapability.score from ${reportedScore} to ≥${thresholds.preRetrievalMin} (functional pre-retrieval minimum).`,
    );
  }
  for (const row of components.filter((c) => c.failed).sort((a, b) => a.contribution - b.contribution)) {
    const delta = thresholds.preRetrievalMin - reportedScore;
    if (delta > 0) {
      const neededRaw = row.rawScore + delta / row.weight;
      pathsToGeneration.push(
        `Raise ${row.component} from ${row.rawScore} toward ~${Math.ceil(neededRaw)} (+${Math.round(delta / row.weight)} pts) — currently ${row.contributionPct}% of weighted sum.`,
      );
    }
  }

  const dragSorted = [...components].sort((a, b) => a.contribution - b.contribution);
  const lowest = dragSorted[0];
  const energyDrag = cap.energyScore <= 5;
  const genreDrag = cap.genreScore <= 10;
  const openerDrag = cap.openerScore <= 10;
  const diversityDrag = cap.diversityScore <= 25;

  let dominantDrag = lowest?.component ?? "unknown";
  if (libraryConflictCapApplied && reportedScore <= 28) {
    dominantDrag = "library_prompt_conflict (hard cap at 28)";
  } else if (energyDrag && cap.energyScore === 0) {
    dominantDrag = "energy_distribution_mismatch (0% energy band fit)";
  }

  return {
    promptId: input.promptId,
    prompt: input.prompt,
    requestedLength: input.requestedLength,
    functionalPrompt,
    weights,
    components,
    rawWeightedScore: Math.round(rawWeightedScore * 100) / 100,
    roundedScore,
    reportedScore,
    libraryConflictCapApplied,
    limitingFactors: cap.limitingFactors,
    gateThresholds: thresholds,
    likelyGate,
    gateReason,
    retrievalAttempts,
    validCandidateSupply: {
      strictValidCount: strictValid,
      relaxedValidCount: relaxedValid,
      recoveryValidCount: num(supply.recoveryValidCount),
      minRequired,
      sufficient,
      limitingDimensions: Array.isArray(supply.limitingDimensions)
        ? supply.limitingDimensions.map(String)
        : undefined,
    },
    pathsToGeneration,
    roiAnswer: {
      dominantDrag,
      conflictIsPrimaryBlocker: hasConflict && retrievalAttempts === 0,
      energyIsPrimaryDrag: energyDrag,
      genreDiversityIsPrimaryDrag: genreDrag || diversityDrag,
      weakOpenerIsPrimaryDrag: openerDrag,
    },
  };
}

export function limitingFactorLabel(factor: string): string {
  return LIMITING_FACTOR_LABELS[factor] ?? factor;
}

export function renderConfidenceExplanationMarkdown(explanation: OrchestratorConfidenceExplanation): string {
  const lines: string[] = [
    `### ${explanation.promptId}`,
    `**Prompt:** ${explanation.prompt}`,
    `**combinedConfidence:** ${explanation.reportedScore} (retrievalAttempts: ${explanation.retrievalAttempts})`,
    `**Functional prompt (gym/party):** ${explanation.functionalPrompt}`,
    "",
    "#### Component breakdown",
    "| Component | Raw | Weight | Contribution | % of sum | Failed |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const row of explanation.components) {
    lines.push(
      `| ${row.component} | ${row.rawScore} | ${row.weight} | ${row.contribution} | ${row.contributionPct}% | ${row.failed ? "yes" : "no"} |`,
    );
  }

  lines.push(
    "",
    `**Raw weighted sum:** ${explanation.rawWeightedScore} → rounded ${explanation.roundedScore}`,
    `**library_prompt_conflict cap applied:** ${explanation.libraryConflictCapApplied ? `yes (score capped at ${explanation.gateThresholds.libraryConflictScoreCap})` : "no"}`,
    `**Reported libraryCapability.score:** ${explanation.reportedScore}`,
    "",
    "#### Why it failed",
    `- **Gate:** \`${explanation.likelyGate}\``,
    `- ${explanation.gateReason}`,
    "",
    "#### Limiting factors",
  );

  for (const factor of explanation.limitingFactors) {
    lines.push(`- \`${factor}\` — ${limitingFactorLabel(factor)}`);
  }

  lines.push(
    "",
    "#### What would need to change to reach generation (thresholds unchanged)",
  );
  for (const path of explanation.pathsToGeneration) {
    lines.push(`- ${path}`);
  }

  lines.push(
    "",
    "#### ROI answer",
    `- **Primary blocker:** ${explanation.roiAnswer.conflictIsPrimaryBlocker ? "library_prompt_conflict (not retrieval weights)" : explanation.likelyGate}`,
    `- **Dominant score drag:** ${explanation.roiAnswer.dominantDrag}`,
    `- Energy mismatch primary drag: ${explanation.roiAnswer.energyIsPrimaryDrag}`,
    `- Genre/diversity primary drag: ${explanation.roiAnswer.genreDiversityIsPrimaryDrag}`,
    `- Weak opener primary drag: ${explanation.roiAnswer.weakOpenerIsPrimaryDrag}`,
    "",
  );

  return lines.join("\n");
}
