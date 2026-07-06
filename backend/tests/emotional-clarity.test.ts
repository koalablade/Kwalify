import { computeEmotionalClarityScore } from "../lib/emotional-clarity-score";
import {
  simulateFirstImpressionRender,
  simulateFirstImpressionStrict,
} from "../lib/first-impression-qa";
import { buildUxSignals } from "../lib/ux-signals";
import type { PlaylistWhySummary } from "../lib/playlist-why-summary";
import {
  assertPrimaryNarrativeSchema,
  freezePrimaryNarrative,
  migratePrimaryNarrative,
  PRIMARY_NARRATIVE_SCHEMA_VERSION,
  primaryNarrativeFieldNames,
} from "../lib/primary-narrative-schema";
import { buildPrimaryNarrative } from "../lib/primary-narrative";
import {
  buildPerceptionSnapshot,
  buildPerceptionSnapshotForUser,
  PERCEPTION_FIXED_PHASES,
} from "../lib/perception-fixture";
import { PERCEPTION_SNAPSHOT_CASES } from "./perception-prompts.data";
import {
  detectNarrativeDrift,
  resetNarrativeDriftHistory,
} from "../lib/narrative-drift-detector";
import {
  checkEmotionalInvariance,
  classifyArcDirection,
  classifyMomentLabel,
} from "../lib/emotional-invariance";
import {
  applyMomentSignatureDiversity,
  computeSelectionSignature,
} from "../lib/moment-signature";
import { recordPerceptionTestResult } from "../lib/launch-health-snapshot";

const sampleWhy: PlaylistWhySummary = {
  dominantMomentLabel: "Late-night focus",
  summary: "A steady arc that builds focus without rushing.",
  structureExplanation: "Opens softly, peaks mid-list, eases out.",
  topSceneMatch: "study session",
  dominantEmotion: "focused",
  energyProfile: "med",
  sceneConfidence: 0.8,
  signals: ["steady tempo"],
};

function runSchemaTests(failures: string[], passed: { n: number }) {
  const fields = primaryNarrativeFieldNames();
  if (fields.join(",") !== "momentLabel,summary,arcSummary") {
    failures.push("[schema] unexpected primaryNarrative field list");
  } else {
    passed.n++;
  }

  try {
    freezePrimaryNarrative({
      momentLabel: "a",
      summary: "b",
      arcSummary: "c",
      extraField: "rejected",
    } as never);
    failures.push("[schema] should reject extra narrative fields");
  } catch {
    passed.n++;
  }

  const frozen = freezePrimaryNarrative({
    momentLabel: sampleWhy.dominantMomentLabel,
    summary: sampleWhy.summary,
    arcSummary: sampleWhy.structureExplanation,
  });
  if (frozen.schemaVersion !== PRIMARY_NARRATIVE_SCHEMA_VERSION) {
    failures.push("[schema] build output missing current schemaVersion");
  } else {
    passed.n++;
  }
  assertPrimaryNarrativeSchema(frozen);
  passed.n++;

  const migrated = migratePrimaryNarrative({
    dominantMomentLabel: "legacy moment",
    summary: "legacy summary",
    structureExplanation: "legacy arc",
  });
  if (migrated.momentLabel !== "legacy moment" || migrated.schemaVersion !== 1) {
    failures.push("[schema] v0 migration failed");
  } else {
    passed.n++;
  }

  const versioned = buildPrimaryNarrative(sampleWhy);
  if (versioned.schemaVersion !== PRIMARY_NARRATIVE_SCHEMA_VERSION) {
    failures.push("[schema] buildPrimaryNarrative must emit versioned narrative");
  } else {
    passed.n++;
  }
}

function runPerceptionSnapshotTests(failures: string[], passed: { n: number }) {
  for (const testCase of PERCEPTION_SNAPSHOT_CASES) {
    const snapshot = buildPerceptionSnapshot(testCase.prompt);
    const narrative = snapshot.primaryNarrative;

    for (const field of primaryNarrativeFieldNames()) {
      if (typeof narrative[field] !== "string") {
        failures.push(`[perception] "${testCase.prompt}" missing core field ${field}`);
        continue;
      }
    }

    if (narrative.schemaVersion !== PRIMARY_NARRATIVE_SCHEMA_VERSION) {
      failures.push(`[perception] "${testCase.prompt}" unexpected schemaVersion`);
      continue;
    }

    if (snapshot.identitySignature !== testCase.identitySignature) {
      failures.push(
        `[perception] "${testCase.prompt}" signature expected ${testCase.identitySignature}, got ${snapshot.identitySignature}`
      );
      continue;
    }

    if (narrative.momentLabel !== testCase.momentLabel) {
      failures.push(
        `[perception] "${testCase.prompt}" momentLabel expected "${testCase.momentLabel}", got "${narrative.momentLabel}"`
      );
      continue;
    }

    if (
      snapshot.emotionalClarityScore < testCase.clarityMin ||
      snapshot.emotionalClarityScore > testCase.clarityMax
    ) {
      failures.push(
        `[perception] "${testCase.prompt}" clarity ${snapshot.emotionalClarityScore} outside ${testCase.clarityMin}-${testCase.clarityMax}`
      );
      continue;
    }

    const repeat = buildPerceptionSnapshot(testCase.prompt);
    if (repeat.identitySignature !== snapshot.identitySignature) {
      failures.push(`[perception] "${testCase.prompt}" signature unstable across runs`);
      continue;
    }

    passed.n++;
  }
}

function runInvarianceTests(failures: string[], passed: { n: number }) {
  const prompt = PERCEPTION_SNAPSHOT_CASES[0]!.prompt;
  const userId = "invariance-user";

  const first = buildPerceptionSnapshotForUser(prompt, userId);
  const second = buildPerceptionSnapshotForUser(prompt, userId);
  const sameContext = checkEmotionalInvariance(
    first.primaryNarrative,
    second.primaryNarrative
  );
  if (!sameContext.ok) {
    failures.push(`[invariance] same prompt/user failed: ${sameContext.violations.join("; ")}`);
  } else {
    passed.n++;
  }

  const labelClass = classifyMomentLabel(first.primaryNarrative.momentLabel);
  const repeatClass = classifyMomentLabel(second.primaryNarrative.momentLabel);
  if (labelClass !== repeatClass) {
    failures.push("[invariance] momentLabel identity class unstable");
  } else {
    passed.n++;
  }

  const arcDirection = classifyArcDirection(
    first.primaryNarrative.arcSummary,
    PERCEPTION_FIXED_PHASES
  );
  const repeatArc = classifyArcDirection(
    second.primaryNarrative.arcSummary,
    PERCEPTION_FIXED_PHASES
  );
  if (arcDirection !== repeatArc || arcDirection !== "rise_peak_fall") {
    failures.push(`[invariance] arc direction unstable: ${arcDirection} vs ${repeatArc}`);
  } else {
    passed.n++;
  }

  const narrativeBefore = first.primaryNarrative;
  const lockedWhy = {
    ...sampleWhy,
    dominantMomentLabel: narrativeBefore.momentLabel,
    summary: narrativeBefore.summary,
    structureExplanation: narrativeBefore.arcSummary,
  };
  const narrativeAfterLock = buildPrimaryNarrative(lockedWhy);

  const mockTracks = Array.from({ length: 20 }, (_, i) => ({
    trackId: `track-${i}`,
  }));
  const selectionSignature = computeSelectionSignature(mockTracks.map((t) => t.trackId));
  applyMomentSignatureDiversity(
    userId,
    prompt,
    selectionSignature,
    mockTracks,
    PERCEPTION_FIXED_PHASES
  );

  const invarianceAfterDiversity = checkEmotionalInvariance(
    narrativeBefore,
    narrativeAfterLock
  );
  if (!invarianceAfterDiversity.ok) {
    failures.push(
      `[invariance] track diversification leaked into narrative: ${invarianceAfterDiversity.violations.join("; ")}`
    );
  } else {
    passed.n++;
  }
}

function runDriftDetectorTests(failures: string[], passed: { n: number }) {
  resetNarrativeDriftHistory();
  const base = freezePrimaryNarrative({
    momentLabel: "late night reflective drive",
    summary: "Built for a calm motorway moment.",
    arcSummary: "Opens with 3 stabilising tracks, builds across 5.",
  });

  const first = detectNarrativeDrift({
    userId: "u1",
    sessionId: "session-1",
    prompt: "late night drive",
    current: base,
  });
  if (first.warning) {
    failures.push("[drift] first generation should not warn");
    return;
  }

  const shifted = detectNarrativeDrift({
    userId: "u1",
    sessionId: "session-1",
    prompt: "late night drive",
    current: freezePrimaryNarrative({
      momentLabel: "hyped party gym energy",
      summary: base.summary,
      arcSummary: "Completely different arc shape with other peaks.",
    }),
  });
  if (!shifted.warning || !shifted.flags.length) {
    failures.push("[drift] expected warning on semantic shift");
    return;
  }
  passed.n++;

  const repeatShift = detectNarrativeDrift({
    userId: "u1",
    sessionId: "session-1",
    prompt: "late night drive",
    current: freezePrimaryNarrative({
      momentLabel: "hyped party gym energy",
      summary: base.summary,
      arcSummary: "Completely different arc shape with other peaks.",
    }),
  });
  if (repeatShift.warning) {
    failures.push("[drift] session should aggregate warnings and avoid spam");
  } else {
    passed.n++;
  }

  resetNarrativeDriftHistory();
}

export function runEmotionalClarityTests(): {
  passed: number;
  failed: number;
  failures: string[];
} {
  const failures: string[] = [];
  const passed = { n: 0 };

  runSchemaTests(failures, passed);
  runPerceptionSnapshotTests(failures, passed);
  runInvarianceTests(failures, passed);
  runDriftDetectorTests(failures, passed);

  const high = computeEmotionalClarityScore({
    primaryNarrative: {
      momentLabel: sampleWhy.dominantMomentLabel,
      summary: sampleWhy.summary,
      arcSummary: sampleWhy.structureExplanation,
    },
    emotionalConsistencyScore: 82,
    signatureStable: true,
  });
  if (high.label !== "Very clear emotional arc" || high.score < 72) {
    failures.push(`[clarity] expected high clarity, got ${high.label} (${high.score})`);
  } else {
    passed.n++;
  }

  const ux = buildUxSignals({
    playlistWhy: sampleWhy,
    emotionalConsistency: { score: 55, label: "Mixed flow" },
    signatureStable: false,
  });
  if (!ux.emotionalClarityLabel || ux.primaryNarrative.momentLabel !== sampleWhy.dominantMomentLabel) {
    failures.push("[uxSignals] clarity or narrative missing after build");
  } else {
    passed.n++;
  }

  const impression = simulateFirstImpressionRender(
    buildUxSignals({
      playlistWhy: sampleWhy,
      emotionalConsistency: { score: 70, label: "Cohesive" },
      signatureStable: true,
    })
  );
  if (
    impression.hasExpandedDetails !== false ||
    impression.primaryNarrative.momentLabel !== sampleWhy.dominantMomentLabel ||
    !impression.clarityBadge.label
  ) {
    failures.push("[firstImpression] unexpected QA render state");
  } else {
    passed.n++;
  }

  const strictUx = buildUxSignals({
    playlistWhy: sampleWhy,
    emotionalConsistency: { score: 70, label: "Cohesive" },
    signatureStable: true,
  });
  const strict = simulateFirstImpressionStrict(strictUx);
  const strictKeys = Object.keys(strict).sort().join(",");
  if (strictKeys !== "clarityBadge,momentLabel,summary") {
    failures.push(`[strictImpression] unexpected keys: ${strictKeys}`);
  } else if ("arcSummary" in strict || "consistencyBadge" in strict) {
    failures.push("[strictImpression] forbidden fields present");
  } else {
    passed.n++;
  }

  const result = { passed: passed.n, failed: failures.length, failures };
  recordPerceptionTestResult(result.passed, result.failed);
  return result;
}

if (require.main === module) {
  const result = runEmotionalClarityTests();
  if (result.failures.length) {
    console.error(result.failures.join("\n"));
    process.exit(1);
  }
  console.log(`emotional-clarity tests: ${result.passed} passed`);
}
