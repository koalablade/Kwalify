import type { ExplanationPriorityItem } from "./explanation-priority";

/** Supporting metadata only — not primary narrative. */
export function buildSupportingExplanationPriority(opts: {
  fallbackExplanation?: string | null;
  emotionalConsistencyLabel?: string | null;
  emotionalConsistencyScore?: number | null;
}): ExplanationPriorityItem[] {
  const items: ExplanationPriorityItem[] = [];

  if (opts.fallbackExplanation?.trim()) {
    items.push({ key: "fallbackExplanation", value: opts.fallbackExplanation.trim() });
  }
  if (opts.emotionalConsistencyLabel?.trim()) {
    const score = opts.emotionalConsistencyScore;
    const value =
      score != null && Number.isFinite(score)
        ? `${opts.emotionalConsistencyLabel} (${Math.round(score)})`
        : opts.emotionalConsistencyLabel.trim();
    items.push({ key: "emotionalConsistencyLabel", value });
  }

  return items;
}
