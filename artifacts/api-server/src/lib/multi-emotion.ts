/**
 * Preserve emotional complexity — never collapse to a single label.
 */

const EMOTION_LEXICON: Record<string, string> = {
  sad: "sad",
  melancholy: "sad",
  heartbroken: "sad",
  grieving: "sad",
  hopeful: "hopeful",
  optimistic: "hopeful",
  happy: "happy",
  joyful: "happy",
  excited: "excited",
  anxious: "anxious",
  nervous: "anxious",
  calm: "calm",
  peaceful: "calm",
  lonely: "lonely",
  nostalgic: "nostalgic",
  angry: "angry",
  tired: "tired",
  exhausted: "tired",
  motivated: "motivated",
  confident: "confident",
  grateful: "grateful",
  reflective: "reflective",
  drained: "tired",
  bittersweet: "bittersweet",
};

const CONTRADICTION_PHRASES = [
  "sad but hopeful",
  "lonely but peaceful",
  "happy but nostalgic",
  "confident but reflective",
  "excited but nervous",
  "heartbroken but healing",
  "tired but determined",
  "calm but emotional",
  "lost but optimistic",
];

const PAIR_PATTERNS: RegExp[] = [
  /(\w+)\s+but\s+(\w+)/i,
  /(\w+)\s+and\s+(\w+)/i,
  /(\w+)\s*,\s*(\w+)/i,
  /(\w+)\s+yet\s+(\w+)/i,
];

export function detectMixedEmotions(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();

  for (const phrase of CONTRADICTION_PHRASES) {
    if (lower.includes(phrase)) {
      phrase.split(/\s+but\s+|\s+and\s+/).forEach((part) => {
        const label = EMOTION_LEXICON[part.trim()] ?? part.trim();
        if (label) found.add(label);
      });
    }
  }

  for (const [word, label] of Object.entries(EMOTION_LEXICON)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(lower)) found.add(label);
  }

  for (const pattern of PAIR_PATTERNS) {
    const m = lower.match(pattern);
    if (m?.[1] && m[2]) {
      const a = EMOTION_LEXICON[m[1].replace(/[^a-z]/g, "")] ?? null;
      const b = EMOTION_LEXICON[m[2].replace(/[^a-z]/g, "")] ?? null;
      if (a) found.add(a);
      if (b) found.add(b);
    }
  }

  if (/bittersweet|mixed feelings|love.?hate/i.test(lower)) {
    found.add("bittersweet");
  }

  return [...found].slice(0, 5);
}
