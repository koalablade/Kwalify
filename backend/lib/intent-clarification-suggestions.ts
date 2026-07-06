import { CANONICAL_SCENES } from "./scene-canonicalizer";
import type { CanonicalSceneResult } from "./scene-canonicalizer";
import type { PromptConfidenceTier } from "./prompt-confidence";

export type SuggestionCategory = "calm" | "energetic" | "emotional" | "focus";

export interface IntentClarificationSuggestion {
  text: string;
  previewSceneId: string;
  category: SuggestionCategory;
}

export interface IntentClarificationGrouped {
  calm: IntentClarificationSuggestion[];
  energetic: IntentClarificationSuggestion[];
  emotional: IntentClarificationSuggestion[];
  focus: IntentClarificationSuggestion[];
}

const TONE_HINTS: { re: RegExp; tones: string[] }[] = [
  { re: /\bchill|chilled|mellow|relaxed|calm|soft\b/i, tones: ["calm", "introspection", "routine", "focus"] },
  { re: /\bsad|melancholy|blue|heartbreak|lonely\b/i, tones: ["melancholy", "introspection", "grief", "reflective"] },
  { re: /\bhype|party|dance|club|energy\b/i, tones: ["celebration", "social", "anticipation", "release"] },
  { re: /\bfocus|work|study|productive\b/i, tones: ["focus", "routine", "determination"] },
  { re: /\bdrive|road|motorway|commute\b/i, tones: ["introspection", "liminal", "transition", "nostalgic_warmth"] },
];

const TONE_TO_CATEGORY: Record<string, SuggestionCategory> = {
  calm: "calm",
  introspection: "emotional",
  routine: "focus",
  focus: "focus",
  melancholy: "emotional",
  grief: "emotional",
  reflective: "emotional",
  celebration: "energetic",
  social: "energetic",
  anticipation: "energetic",
  release: "energetic",
  determination: "focus",
  liminal: "emotional",
  transition: "calm",
  nostalgic_warmth: "emotional",
};

function vibeTokens(vibe: string): Set<string> {
  return new Set(
    vibe
      .toLowerCase()
      .split(/[\s,./-]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 2)
  );
}

function scoreAlias(vibe: string, tokens: Set<string>, alias: string): number {
  const lower = vibe.toLowerCase();
  const aliasLower = alias.toLowerCase();
  if (lower.includes(aliasLower)) return 0;

  const aliasWords = aliasLower.split(/\s+/).filter((w) => w.length > 2);
  let overlap = 0;
  for (const w of aliasWords) {
    if (tokens.has(w) || lower.includes(w)) overlap += 1;
  }
  if (overlap === 0 && aliasWords.some((w) => lower.includes(w.slice(0, Math.max(3, w.length - 1))))) {
    overlap += 0.5;
  }
  return overlap + alias.length / 120;
}

function toneBoost(vibe: string, emotionalTone: string): number {
  for (const { re, tones } of TONE_HINTS) {
    if (re.test(vibe) && tones.includes(emotionalTone)) return 0.35;
  }
  return 0;
}

function categoryForTone(emotionalTone: string): SuggestionCategory {
  return TONE_TO_CATEGORY[emotionalTone] ?? "emotional";
}

function emptyGroups(): IntentClarificationGrouped {
  return { calm: [], energetic: [], emotional: [], focus: [] };
}

export function groupIntentSuggestions(
  suggestions: IntentClarificationSuggestion[]
): IntentClarificationGrouped {
  const groups = emptyGroups();
  for (const s of suggestions) {
    groups[s.category].push(s);
  }
  return groups;
}

/**
 * Deterministic prompt rewrites from canonical scene aliases (no LLM).
 */
export function buildIntentClarificationSuggestions(
  vibe: string,
  tier: PromptConfidenceTier,
  currentCanonical: CanonicalSceneResult | null
): IntentClarificationSuggestion[] {
  if (tier !== "low") return [];

  const tokens = vibeTokens(vibe);
  const scored: { sceneId: string; alias: string; score: number; tone: string }[] = [];

  for (const entry of CANONICAL_SCENES) {
    if (currentCanonical?.sceneId === entry.id && (currentCanonical.confidence ?? 0) >= 0.7) {
      continue;
    }
    let bestAlias = entry.aliases[0] ?? entry.id;
    let bestScore = -1;
    for (const alias of entry.aliases) {
      const score = scoreAlias(vibe, tokens, alias) + toneBoost(vibe, entry.emotionalTone);
      if (score > bestScore) {
        bestScore = score;
        bestAlias = alias;
      }
    }
    const finalScore = bestScore + toneBoost(vibe, entry.emotionalTone);
    if (finalScore > 0.1) {
      scored.push({
        sceneId: entry.id,
        alias: bestAlias,
        score: finalScore,
        tone: entry.emotionalTone,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const suggestions: IntentClarificationSuggestion[] = [];
  const usedCategories = new Set<SuggestionCategory>();

  for (const row of scored) {
    if (seen.has(row.sceneId)) continue;
    const category = categoryForTone(row.tone);
    seen.add(row.sceneId);
    suggestions.push({
      text: row.alias,
      previewSceneId: row.sceneId,
      category,
    });
    usedCategories.add(category);
    if (suggestions.length >= 6) break;
  }

  if (suggestions.length < 3) {
    for (const entry of CANONICAL_SCENES) {
      if (seen.has(entry.id)) continue;
      const category = categoryForTone(entry.emotionalTone);
      if (suggestions.length >= 3 && usedCategories.has(category)) continue;
      const alias =
        entry.aliases.find((a) => a.length >= 12) ??
        entry.aliases[0] ??
        entry.id.replace(/_/g, " ");
      seen.add(entry.id);
      usedCategories.add(category);
      suggestions.push({
        text: alias,
        previewSceneId: entry.id,
        category,
      });
      if (suggestions.length >= 6) break;
    }
  }

  return suggestions.slice(0, 6);
}
