export type ExplanationPriorityKey =
  | "dominantMomentLabel"
  | "summary"
  | "fallbackExplanation"
  | "emotionalConsistencyLabel";

export interface ExplanationPriorityItem {
  key: ExplanationPriorityKey;
  value: string;
}

export function buildExplanationPriority(opts: {
  dominantMomentLabel?: string | null;
  summary?: string | null;
  fallbackExplanation?: string | null;
  emotionalConsistencyLabel?: string | null;
  emotionalConsistencyScore?: number | null;
}): ExplanationPriorityItem[] {
  const items: ExplanationPriorityItem[] = [];

  if (opts.dominantMomentLabel?.trim()) {
    items.push({ key: "dominantMomentLabel", value: opts.dominantMomentLabel.trim() });
  }
  if (opts.summary?.trim()) {
    items.push({ key: "summary", value: opts.summary.trim() });
  }
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
