/**
 * Representative human-quality evaluation prompt corpus.
 * Used for benchmark matrix design — does NOT drive generation.
 */

import type { PromptCategory, PromptDifficulty } from "./types";

export type CorpusPrompt = {
  id: string;
  prompt: string;
  category: PromptCategory;
  difficulty: PromptDifficulty;
  tags: string[];
  notes?: string;
};

/** Curated matrix (~48 prompts) spanning genres, moods, compounds, vague, natural language. */
export const HUMAN_QUALITY_PROMPT_CORPUS: CorpusPrompt[] = [
  // Genre
  { id: "genre-90s-alt", prompt: "90s alternative rock", category: "genre", difficulty: "normal", tags: ["era", "genre"] },
  { id: "genre-uk-garage", prompt: "UK garage", category: "genre", difficulty: "hard", tags: ["genre", "uk"] },
  { id: "genre-indie-rock", prompt: "indie rock", category: "genre", difficulty: "easy", tags: ["genre"] },
  { id: "genre-grime", prompt: "grime", category: "genre", difficulty: "hard", tags: ["genre", "uk"] },
  { id: "genre-shoegaze", prompt: "shoegaze", category: "genre", difficulty: "hard", tags: ["genre", "niche"] },
  { id: "genre-britpop", prompt: "britpop", category: "genre", difficulty: "normal", tags: ["genre", "uk"] },

  // Mood
  { id: "mood-melancholic", prompt: "melancholic", category: "mood", difficulty: "easy", tags: ["mood"] },
  { id: "mood-nostalgic", prompt: "nostalgic", category: "mood", difficulty: "easy", tags: ["mood"] },
  { id: "mood-euphoric", prompt: "euphoric", category: "mood", difficulty: "normal", tags: ["mood", "energy"] },
  { id: "mood-peaceful", prompt: "peaceful", category: "mood", difficulty: "easy", tags: ["mood", "low_energy"] },

  // Activity
  { id: "act-late-night-drive", prompt: "late night drive", category: "activity", difficulty: "normal", tags: ["driving", "night"] },
  { id: "act-gym", prompt: "gym workout", category: "activity", difficulty: "normal", tags: ["activity", "high_energy"] },
  { id: "act-cooking", prompt: "cooking dinner", category: "activity", difficulty: "easy", tags: ["activity"] },
  { id: "act-walking", prompt: "walking home", category: "activity", difficulty: "easy", tags: ["activity"] },

  // Atmosphere
  { id: "atm-rainy-sunday", prompt: "rainy Sunday morning", category: "atmosphere", difficulty: "normal", tags: ["atmospheric", "morning"] },
  { id: "atm-cozy-coffee", prompt: "cozy sunday morning coffee", category: "atmosphere", difficulty: "normal", tags: ["atmospheric", "cozy"] },
  { id: "atm-neon-night", prompt: "neon city night", category: "atmosphere", difficulty: "hard", tags: ["atmospheric", "night"] },
  { id: "atm-sunset-drive", prompt: "sunset drive", category: "atmosphere", difficulty: "normal", tags: ["atmospheric", "driving"] },
  { id: "atm-lofi-study", prompt: "lo-fi study beats", category: "atmosphere", difficulty: "normal", tags: ["atmospheric", "focus"] },
  { id: "atm-2am-bedroom", prompt: "2am bedroom", category: "atmosphere", difficulty: "hard", tags: ["atmospheric", "night"] },

  // Era
  { id: "era-80s", prompt: "80s synthpop", category: "era", difficulty: "normal", tags: ["era", "genre"] },
  { id: "era-2000s", prompt: "2000s indie", category: "era", difficulty: "normal", tags: ["era", "genre"] },

  // Compound
  { id: "cmp-sad-party", prompt: "sad party bangers", category: "compound", difficulty: "compound", tags: ["compound", "party"] },
  { id: "cmp-party-not-cheesy", prompt: "party but not cheesy", category: "compound", difficulty: "compound", tags: ["compound", "negation"] },
  { id: "cmp-party-restrained", prompt: "party but restrained", category: "compound", difficulty: "compound", tags: ["compound"] },
  { id: "cmp-nostalgic-drive", prompt: "nostalgic 2000s UK indie for driving", category: "compound", difficulty: "compound", tags: ["compound", "era", "uk"] },
  { id: "cmp-cozy-upbeat", prompt: "cozy but upbeat", category: "compound", difficulty: "compound", tags: ["compound", "contradiction"] },
  { id: "cmp-dark-romantic", prompt: "dark but romantic", category: "compound", difficulty: "compound", tags: ["compound"] },

  // Negative constraints
  { id: "neg-not-cheesy", prompt: "chill party music but not cheesy", category: "negative_constraint", difficulty: "hard", tags: ["negation"] },
  { id: "neg-no-mainstream", prompt: "indie vibes no mainstream hits", category: "negative_constraint", difficulty: "hard", tags: ["negation"] },
  { id: "neg-not-too-slow", prompt: "relaxed but not too slow", category: "negative_constraint", difficulty: "normal", tags: ["negation"] },

  // Vague
  { id: "vag-something-tonight", prompt: "something for tonight", category: "vague", difficulty: "ambiguous", tags: ["vague"] },
  { id: "vag-make-a-vibe", prompt: "make me a vibe", category: "vague", difficulty: "ambiguous", tags: ["vague"] },
  { id: "vag-surprise", prompt: "surprise me", category: "vague", difficulty: "ambiguous", tags: ["vague"] },
  { id: "vag-dunno", prompt: "I don't know what I want", category: "vague", difficulty: "ambiguous", tags: ["vague"] },

  // Edge cases
  { id: "edge-typo", prompt: "cozy sundy mornig coffe", category: "edge_case", difficulty: "adversarial", tags: ["typo"] },
  { id: "edge-contradictory", prompt: "aggressive peaceful meditation", category: "edge_case", difficulty: "adversarial", tags: ["contradiction"] },
  { id: "edge-ultra-narrow", prompt: "mid-90s Bristol trip-hop only", category: "edge_case", difficulty: "adversarial", tags: ["niche", "era"] },

  // Natural human phrasing
  { id: "nat-feeling", prompt: "you know that feeling when you're driving home at 1am and everything hits different", category: "natural", difficulty: "ambiguous", tags: ["natural", "long"] },
  { id: "nat-crap-day", prompt: "had a crap day need something that gets it", category: "natural", difficulty: "normal", tags: ["natural", "emotional"] },
  { id: "nat-bits", prompt: "bits for a sunday roast prep", category: "natural", difficulty: "normal", tags: ["natural", "uk"] },
  { id: "nat-save-this", prompt: "make me something I'd actually save", category: "natural", difficulty: "normal", tags: ["natural", "meta"] },
  { id: "nat-short", prompt: "sad", category: "natural", difficulty: "easy", tags: ["natural", "short"] },
];

export function corpusByDifficulty(): Record<PromptDifficulty, number> {
  const counts: Record<PromptDifficulty, number> = {
    easy: 0,
    normal: 0,
    hard: 0,
    compound: 0,
    ambiguous: 0,
    adversarial: 0,
  };
  for (const p of HUMAN_QUALITY_PROMPT_CORPUS) counts[p.difficulty] += 1;
  return counts;
}

export function corpusByCategory(): Record<PromptCategory, number> {
  const counts = {} as Record<PromptCategory, number>;
  for (const p of HUMAN_QUALITY_PROMPT_CORPUS) {
    counts[p.category] = (counts[p.category] ?? 0) + 1;
  }
  return counts;
}

/** Pilot subset for first baseline run (12 prompts, breadth over repetition). */
export const HUMAN_QUALITY_PILOT_IDS = [
  "atm-cozy-coffee",
  "act-late-night-drive",
  "cmp-sad-party",
  "cmp-party-not-cheesy",
  "genre-uk-garage",
  "mood-nostalgic",
  "neg-not-cheesy",
  "vag-something-tonight",
  "nat-feeling",
  "edge-typo",
  "era-2000s",
  "atm-lofi-study",
] as const;

export function pilotPrompts(): CorpusPrompt[] {
  const byId = new Map(HUMAN_QUALITY_PROMPT_CORPUS.map((p) => [p.id, p]));
  return HUMAN_QUALITY_PILOT_IDS.map((id) => byId.get(id)).filter(Boolean) as CorpusPrompt[];
}
