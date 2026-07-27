import type { WorldConceptTaxonomy } from "./types";

export interface NegationAdjustment {
  taxonomy: WorldConceptTaxonomy;
  suppressed: string[];
  boosted: string[];
  notes: string[];
}

const NEGATION_RE =
  /\b(?:not|no|never|isn'?t|aren'?t|don'?t|doesn'?t|wasn'?t|weren'?t|without)\s+(?:a\s+|an\s+|the\s+|too\s+|very\s+)?([a-z][a-z\s-]{1,24})/gi;

const EMOTION_OPPOSITES: Record<string, string[]> = {
  sad: ["peace", "hope", "contentment"],
  sadness: ["peace", "hope"],
  angry: ["peace", "calm"],
  anger: ["peace", "calm"],
  aggression: ["peace", "calm"],
  anxious: ["peace", "calm"],
  anxiety: ["peace", "calm"],
  depressing: ["hope", "peace"],
  dark: ["hope", "warmth"],
  upbeat: ["reflection", "peace"],
  happy: ["reflection", "melancholy"],
};

const POSITIVE_OVERRIDES: Array<{ pattern: RegExp; add: string[]; remove?: RegExp }> = [
  { pattern: /\bhappy\s+rain\b/i, add: ["peace", "comfort", "nostalgia"], remove: /sadness|melancholy/i },
  { pattern: /\bdriving\s+but\s+not\s+angry\b/i, add: ["reflection", "peace"], remove: /anger|aggression/i },
  { pattern: /\bnot\s+a\s+sad\s+playlist\b/i, add: ["hope", "peace", "contentment"], remove: /sadness|grief|melancholy/i },
  { pattern: /\bnot\s+sad\b/i, add: ["peace", "hope"], remove: /sadness|grief/i },
];

function removeMatching(arr: string[], pattern: RegExp): string[] {
  return arr.filter((v) => !pattern.test(v));
}

function pushUnique(arr: string[], values: string[]): void {
  for (const v of values) {
    if (!arr.includes(v)) arr.push(v);
  }
}

export function applyNegation(prompt: string, taxonomy: WorldConceptTaxonomy): NegationAdjustment {
  const next: WorldConceptTaxonomy = {
    environment: [...taxonomy.environment],
    activity: [...taxonomy.activity],
    social: [...taxonomy.social],
    emotion: [...taxonomy.emotion],
    lifeContext: [...taxonomy.lifeContext],
    sensory: [...taxonomy.sensory],
  };
  const suppressed: string[] = [];
  const boosted: string[] = [];
  const notes: string[] = [];

  for (const override of POSITIVE_OVERRIDES) {
    if (!override.pattern.test(prompt)) continue;
    if (override.remove) next.emotion = removeMatching(next.emotion, override.remove);
    pushUnique(next.emotion, override.add);
    boosted.push(...override.add);
    notes.push(`override:${override.pattern.source}`);
  }

  let match: RegExpExecArray | null;
  NEGATION_RE.lastIndex = 0;
  while ((match = NEGATION_RE.exec(prompt)) !== null) {
    const term = match[1].trim().toLowerCase();
    const opposite = EMOTION_OPPOSITES[term];
    if (!opposite) continue;
    next.emotion = next.emotion.filter((e) => !e.toLowerCase().includes(term));
    pushUnique(next.emotion, opposite);
    suppressed.push(term);
    boosted.push(...opposite);
    notes.push(`negated:${term}`);
  }

  return { taxonomy: next, suppressed, boosted, notes };
}
