import type { VersionedPrimaryNarrative } from "./primary-narrative-schema";
import type { EmotionalSequencePhases } from "./emotional-sequencing";

export type MomentLabelClass =
  | "energy"
  | "reset"
  | "flow"
  | "scene"
  | "mixed";

export type ArcDirection = "rise_peak_fall" | "flat" | "rise" | "fall";

export interface EmotionalInvarianceResult {
  ok: boolean;
  violations: string[];
}

export function classifyMomentLabel(label: string): MomentLabelClass {
  const lower = label.toLowerCase();
  if (/\benergy\b|hyped|gym|party|out\b/.test(lower)) return "energy";
  if (/quiet emotional|reset|recovery|calm|gentle/.test(lower)) return "reset";
  if (/\bflow\b/.test(lower)) return "flow";
  if (/\b\w+\s+\w+\s+\w+/.test(lower)) return "scene";
  return "mixed";
}

export function classifyArcDirection(
  arcSummary: string,
  phases?: EmotionalSequencePhases | null
): ArcDirection {
  const lower = arcSummary.toLowerCase();
  if (/opens with|builds across|peaks around|cools down/.test(lower)) {
    return "rise_peak_fall";
  }
  if (/ease in, lift, and settle|without jarring/.test(lower)) {
    return "flat";
  }
  if (phases) {
    if (phases.peak > phases.intro && phases.cooldown > 0) return "rise_peak_fall";
    if (phases.peak > phases.intro) return "rise";
    if (phases.cooldown > phases.peak) return "fall";
  }
  if (/rise|build|peak/.test(lower)) return "rise";
  if (/cool|settle|ease out/.test(lower)) return "fall";
  return "flat";
}

export function checkEmotionalInvariance(
  baseline: VersionedPrimaryNarrative,
  current: VersionedPrimaryNarrative
): EmotionalInvarianceResult {
  const violations: string[] = [];

  const baselineClass = classifyMomentLabel(baseline.momentLabel);
  const currentClass = classifyMomentLabel(current.momentLabel);
  if (baselineClass !== currentClass) {
    violations.push(
      `momentLabel class changed: ${baselineClass} → ${currentClass}`
    );
  }

  const baselineArc = classifyArcDirection(baseline.arcSummary);
  const currentArc = classifyArcDirection(current.arcSummary);
  if (baselineArc !== currentArc) {
    violations.push(`arc direction changed: ${baselineArc} → ${currentArc}`);
  }

  if (baseline.momentLabel !== current.momentLabel) {
    violations.push("momentLabel text changed under same context");
  }

  if (baseline.arcSummary !== current.arcSummary) {
    violations.push("arcSummary changed under same context");
  }

  return { ok: violations.length === 0, violations };
}
