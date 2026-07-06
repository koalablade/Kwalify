import { normalizePrompt } from "./generate-cache-key";
import type { PrimaryNarrative } from "./primary-narrative";
import type { VersionedPrimaryNarrative } from "./primary-narrative-schema";

export type DriftSensitivity = "low" | "medium" | "high";

export interface DriftThresholdPolicy {
  momentLabelSensitivity: DriftSensitivity;
  arcSummaryTolerance: DriftSensitivity;
}

export interface NarrativeDriftResult {
  warning: string | null;
  flags: string[];
}

const DEFAULT_POLICY: DriftThresholdPolicy = {
  momentLabelSensitivity: "medium",
  arcSummaryTolerance: "medium",
};

const MOMENT_LABEL_THRESHOLDS: Record<DriftSensitivity, number> = {
  low: 0.25,
  medium: 0.35,
  high: 0.45,
};

const ARC_SUMMARY_THRESHOLDS: Record<DriftSensitivity, number> = {
  low: 0.4,
  medium: 0.5,
  high: 0.6,
};

const previousByUserPrompt = new Map<string, PrimaryNarrative | VersionedPrimaryNarrative>();
const sessionEmittedWarnings = new Map<string, Set<string>>();

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1)
  );
}

function tokenOverlap(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared++;
  }
  return shared / Math.max(left.size, right.size, 1);
}

function driftKey(userId: string, prompt: string): string {
  return `${userId}:${normalizePrompt(prompt)}`;
}

function resolvePolicy(policy?: Partial<DriftThresholdPolicy>): DriftThresholdPolicy {
  return {
    momentLabelSensitivity:
      policy?.momentLabelSensitivity ?? DEFAULT_POLICY.momentLabelSensitivity,
    arcSummaryTolerance: policy?.arcSummaryTolerance ?? DEFAULT_POLICY.arcSummaryTolerance,
  };
}

function shouldEmitSessionWarning(sessionId: string, warningKey: string): boolean {
  let emitted = sessionEmittedWarnings.get(sessionId);
  if (!emitted) {
    emitted = new Set();
    sessionEmittedWarnings.set(sessionId, emitted);
  }
  if (emitted.has(warningKey)) return false;
  emitted.add(warningKey);
  return true;
}

function buildWarning(flags: string[]): string {
  if (flags.includes("momentLabel_semantic_shift") && flags.includes("arcSummary_mismatch")) {
    return "Narrative identity shifted more than usual for this prompt.";
  }
  if (flags.includes("momentLabel_semantic_shift")) {
    return "Moment label changed significantly from your last generation with this prompt.";
  }
  return "Arc summary diverged from your last generation with this prompt.";
}

/**
 * Compares current narrative to the last one for the same user/prompt.
 * Warning only — never blocks generation.
 */
export function detectNarrativeDrift(opts: {
  userId: string;
  sessionId?: string;
  prompt: string;
  current: PrimaryNarrative | VersionedPrimaryNarrative;
  policy?: Partial<DriftThresholdPolicy>;
}): NarrativeDriftResult {
  const policy = resolvePolicy(opts.policy);
  const key = driftKey(opts.userId, opts.prompt);
  const previous = previousByUserPrompt.get(key);
  previousByUserPrompt.set(key, opts.current);

  if (!previous) {
    return { warning: null, flags: [] };
  }

  const flags: string[] = [];
  const labelMin = MOMENT_LABEL_THRESHOLDS[policy.momentLabelSensitivity];
  const arcMin = ARC_SUMMARY_THRESHOLDS[policy.arcSummaryTolerance];

  const labelOverlap = tokenOverlap(previous.momentLabel, opts.current.momentLabel);
  if (labelOverlap < labelMin) {
    flags.push("momentLabel_semantic_shift");
  }

  const arcOverlap = tokenOverlap(previous.arcSummary, opts.current.arcSummary);
  if (arcOverlap < arcMin) {
    flags.push("arcSummary_mismatch");
  }

  if (!flags.length) {
    return { warning: null, flags: [] };
  }

  const sessionId = opts.sessionId ?? `user:${opts.userId}`;
  const warningKey = `${key}:${flags.sort().join("|")}`;
  if (!shouldEmitSessionWarning(sessionId, warningKey)) {
    return { warning: null, flags };
  }

  return { warning: buildWarning(flags), flags };
}

/** Test helper — clears in-memory drift history. */
export function resetNarrativeDriftHistory(): void {
  previousByUserPrompt.clear();
  sessionEmittedWarnings.clear();
}

export function getDefaultDriftPolicy(): DriftThresholdPolicy {
  return { ...DEFAULT_POLICY };
}
