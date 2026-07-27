import { IDIOMS, PHRASES, SLANG } from "./knowledge";
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

export function interpretPhrases(text: string): PhraseMatch[] {
  const lower = normalize(text);
  const matches: PhraseMatch[] = [];

  for (const phrase of PHRASES) {
    const needle = phrase.phrase.toLowerCase();
    if (!lower.includes(needle)) continue;
    matches.push({
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
    matches.push({
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
    matches.push({
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
