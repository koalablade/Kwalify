import { IDIOMS, PHRASES, SLANG } from "./knowledge";
import humanPhrasesData from "../../data/world-knowledge/human-phrases.json";
import type { PhraseMatch } from "./types";

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeMeaning(
  raw: Record<string, string[] | undefined>,
): PhraseMatch["meaning"] {
  const out: PhraseMatch["meaning"] = {};
  const alias: Record<string, keyof PhraseMatch["meaning"] | "weather" | "time"> = {
    emotions: "emotion",
    emotion: "emotion",
    environment: "environment",
    activity: "activity",
    social: "social",
    lifeContext: "lifeContext",
    life_context: "lifeContext",
    sensory: "sensory",
    weather: "weather",
    time: "time",
  };
  for (const [key, values] of Object.entries(raw)) {
    const mapped = alias[key];
    if (!mapped || !values?.length) continue;
    const bucket = (out[mapped] ??= []);
    for (const value of values) {
      if (!bucket.includes(value)) bucket.push(value);
    }
  }
  return out;
}

type PhraseSource = {
  id: string;
  phrase: string;
  notLiteral?: string;
  meaning?: Record<string, string[] | undefined>;
  music?: PhraseMatch["music"];
};

const HUMAN_PHRASES: PhraseSource[] = (humanPhrasesData as { phrases: PhraseSource[] }).phrases ?? [];

function toPhraseMatch(source: PhraseSource): PhraseMatch {
  return {
    id: source.id,
    phrase: source.phrase,
    notLiteral: source.notLiteral,
    meaning: normalizeMeaning((source.meaning ?? {}) as Record<string, string[]>),
    music: source.music,
  };
}

export function getHumanPhraseCount(): number {
  return HUMAN_PHRASES.length + PHRASES.length + IDIOMS.length + SLANG.length;
}

export function interpretPhrases(text: string): PhraseMatch[] {
  const lower = normalize(text);
  const matches: PhraseMatch[] = [];
  const seen = new Set<string>();

  function addMatch(match: PhraseMatch): void {
    if (seen.has(match.id)) return;
    seen.add(match.id);
    matches.push(match);
  }

  // Human experience phrases first (highest priority)
  for (const phrase of HUMAN_PHRASES) {
    const needle = phrase.phrase.toLowerCase();
    if (!lower.includes(needle)) continue;
    addMatch(toPhraseMatch(phrase));
  }

  for (const phrase of PHRASES) {
    const needle = phrase.phrase.toLowerCase();
    if (!lower.includes(needle)) continue;
    addMatch({
      id: phrase.id,
      phrase: phrase.phrase,
      notLiteral: phrase.notLiteral,
      meaning: normalizeMeaning((phrase.meaning ?? {}) as unknown as Record<string, string[]>),
      music: phrase.music
        ? {
            energy: phrase.music.energy,
            textures: phrase.music.textures,
            genres: phrase.music.genres,
            tempoBpm: phrase.music.tempoBpm
              ? ([phrase.music.tempoBpm[0], phrase.music.tempoBpm[1]] as [number, number])
              : undefined,
          }
        : undefined,
    });
  }

  for (const idiom of IDIOMS) {
    const needle = idiom.phrase.toLowerCase();
    if (!lower.includes(needle)) continue;
    addMatch({
      id: `idiom_${idiom.phrase.replace(/\s+/g, "_")}`,
      phrase: idiom.phrase,
      notLiteral: idiom.notLiteral,
      meaning: normalizeMeaning({
        emotion: idiom.emotions ?? [],
        activity: idiom.activity ?? [],
        environment: idiom.environment ?? [],
      }),
    });
  }

  for (const entry of SLANG) {
    const re = new RegExp(`\\b${entry.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(lower)) continue;
    addMatch({
      id: `slang_${entry.term}`,
      phrase: entry.term,
      notLiteral: entry.notLiteral,
      meaning: normalizeMeaning({
        emotion: entry.emotions ?? [],
        weather: entry.weather ?? [],
      }),
    });
  }

  return matches.sort((a, b) => b.phrase.length - a.phrase.length);
}
