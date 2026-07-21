/**
 * Parse explicit negatives from vibe text — "not sad", "no lyrics", "without edm".
 */

export interface PromptNegatives {
  exclusionTags: string[];
  /** Penalise high speechiness when user wants instrumental / no lyrics */
  penaliseLyrics: boolean;
  /** Prefer higher acousticness */
  preferAcoustic: boolean;
  /** Hard cap energy (0–1) when user says not hype / not energetic */
  maxEnergy: number | null;
}

const PHRASE_TAGS: { re: RegExp; tags: string[]; flags?: Partial<PromptNegatives> }[] = [
  { re: /\b(?:not|no|without|never)\s+(?:too\s+)?sad\b/i, tags: ["deep_sad"] },
  { re: /\b(?:not|no|without)\s+(?:too\s+)?depressing\b/i, tags: ["deep_sad", "harsh"] },
  { re: /\b(?:not|no|without)\s+(?:too\s+)?hype\b/i, tags: ["hype", "peak_energy", "party_high_energy"] },
  { re: /\b(?:not|no|without)\s+(?:too\s+)?energetic\b/i, tags: ["hype", "peak_energy"] },
  { re: /\b(?:not|no|without)\s+edm\b/i, tags: ["club", "hype"] },
  { re: /\b(?:not|no|without)\s+(?:a\s+)?party\b/i, tags: ["party_high_energy", "social_high_energy"] },
  { re: /\b(?:not|no|non|without|never|zero)\s*[-\s]?(?:christmas|xmas|festive)\b/i, tags: ["christmas_holiday"] },
  { re: /\b(?:no|non|without)\s+[-\s]?christmas\b/i, tags: ["christmas_holiday"] },
  { re: /\b(?:not|no|without)\s+(?:any\s+)?lyrics?\b/i, tags: [], flags: { penaliseLyrics: true } },
  { re: /\b(?:not|no|without)\s+(?:too\s+)?acoustic\b/i, tags: [] },
  { re: /\b(?:only\s+)?acoustic\b/i, tags: [], flags: { preferAcoustic: true } },
  { re: /\b(?:not|no|without)\s+aggressive\b/i, tags: ["aggressive", "harsh"] },
];

export function parsePromptNegatives(vibe: string): PromptNegatives {
  const exclusionTags = new Set<string>();
  let penaliseLyrics = false;
  let preferAcoustic = false;
  let maxEnergy: number | null = null;

  for (const row of PHRASE_TAGS) {
    if (!row.re.test(vibe)) continue;
    for (const tag of row.tags) exclusionTags.add(tag);
    if (row.flags?.penaliseLyrics) penaliseLyrics = true;
    if (row.flags?.preferAcoustic) preferAcoustic = true;
  }

  if (/\b(?:not|no|without)\s+(?:too\s+)?(hype|energy|loud|intense)\b/i.test(vibe)) {
    maxEnergy = 0.72;
  }

  return {
    exclusionTags: [...exclusionTags],
    penaliseLyrics,
    preferAcoustic,
    maxEnergy,
  };
}

export function promptNegativeTrackPenalty(
  track: {
    energy: number | null;
    valence: number | null;
    danceability?: number | null;
    speechiness?: number | null;
    acousticness?: number | null;
  },
  negatives: PromptNegatives
): number {
  let penalty = 0;
  const e = track.energy ?? 0.5;
  const sp = track.speechiness ?? 0.3;
  const ac = track.acousticness ?? 0.5;

  if (negatives.maxEnergy != null && e > negatives.maxEnergy) {
    penalty -= 0.12 + (e - negatives.maxEnergy) * 0.25;
  }
  if (negatives.penaliseLyrics && sp > 0.45) {
    penalty -= 0.08 + (sp - 0.45) * 0.2;
  }
  if (negatives.preferAcoustic && ac < 0.35) {
    penalty -= 0.06;
  }

  return Math.max(-0.28, penalty);
}
