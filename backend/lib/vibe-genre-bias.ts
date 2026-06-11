/**
 * Soft genre bias for ambiguous prompts — multipliers only, no hard excludes.
 * Skipped when the user explicitly names genres, decades, or artists.
 */

import type { EmotionProfile } from "./emotion";
import type { RootGenre } from "./genre-taxonomy";
import type { SceneGenreRouting } from "../core/scene-intelligence/scene-genre-routing";

const GENRE_WORDS_RE =
  /\b(country|rock|pop|jazz|soul|rnb|r&b|hip[\s-]?hop|rap|metal|folk|indie|electronic|edm|house|techno|classical|blues|reggae|latin|afrobeat|punk|emo|drill|garage|dnb|ambient|soundtrack|world|christmas|xmas|gospel|funk|disco|synthwave|dream\s*pop|post[\s-]?punk|yacht)\b/i;

const DECADE_RE =
  /\b(19[6-9]\d|20[0-2]\d)s?\b|\b[6-9]0s\b|\b00s\b|\bearly\s+2000s\b|\bmy\s+(teens|20s|30s)\b/i;

const ARTIST_HINT_RE =
  /\b(songs?\s+by|tracks?\s+by|only\s+[a-z][\w\s]{2,30}\s+(songs?|tracks?)|playlist\s+of\s+)\b/i;

const EXPENSIVE_RE =
  /\b(expensive|luxury|upscale|classy|sophisticated|bougie|high[\s-]?end|designer|champagne|premium|velvet|glamou?r)\b|\bsound(s)?\s+expensive\b/i;

const NIGHT_DRIVE_RE =
  /\b(night\s+drive|late[\s-]?night\s+drive|motorway|highway\s+at\s+night|driving\s+alone|2\s*am|3\s*am|midnight\s+drive)\b/i;

const GYM_RE =
  /\b(gym|workout|training\s+session|lifting|leg\s+day|villain\s+arc|pr\s+day|hype\s+set|beast\s+mode)\b/i;

const GARAGE_MUSIC_RE =
  /\b(?:garage\s+music|uk\s+garage|ukg|2-step|two\s+step|two-step|speed\s+garage|future\s+garage|garage\s+rock)\b/i;

const GARAGE_PHYSICAL_RE =
  /\bgarage\b/i;

const GARAGE_CONTEXT_RE =
  /\b(?:friends?|mates?|cars?|working|workshop|tools?|toolbox|fixing|welding|volvo|motorcycles?|motorbikes?|under\s+the\s+hood|saturday\s+night|hanging\s+out|talking\s+rubbish)\b/i;

function emptyRouting(): SceneGenreRouting {
  return { boostedGenres: [], suppressedGenres: [], genreMultipliers: {} };
}

function applyMult(
  genreMultipliers: Partial<Record<RootGenre, number>>,
  boosted: RootGenre[],
  suppressed: RootGenre[],
  g: RootGenre,
  mult: number
): void {
  const prev = genreMultipliers[g] ?? 1;
  genreMultipliers[g] = Math.max(0.32, Math.min(1.22, prev * mult));
  if (genreMultipliers[g]! > 1.03) boosted.push(g);
  if (genreMultipliers[g]! < 0.88) suppressed.push(g);
}

/** User named genre, era, or artist — do not apply vibe-profile bias. */
export function promptHasExplicitGenreConstraint(vibe: string): boolean {
  const t = vibe.trim();
  if (!t) return false;
  const genreText = GARAGE_PHYSICAL_RE.test(t) && GARAGE_CONTEXT_RE.test(t) && !GARAGE_MUSIC_RE.test(t)
    ? t.replace(/\bgarage\b/gi, "")
    : t;
  if (GENRE_WORDS_RE.test(genreText)) return true;
  if (DECADE_RE.test(t)) return true;
  if (ARTIST_HINT_RE.test(t)) return true;
  return false;
}

/** Soft weights for mood-only prompts (expensive, night drive, gym, etc.). */
export function resolveVibeGenreBias(opts: {
  vibe: string;
  profile: EmotionProfile;
}): SceneGenreRouting {
  const lower = opts.vibe.toLowerCase();
  const genreMultipliers: Partial<Record<RootGenre, number>> = {};
  const boosted: RootGenre[] = [];
  const suppressed: RootGenre[] = [];

  if (EXPENSIVE_RE.test(lower)) {
    for (const g of ["pop", "soul", "jazz", "rnb", "electronic"] as RootGenre[]) {
      applyMult(genreMultipliers, boosted, suppressed, g, 1.1);
    }
    for (const g of ["christmas", "folk", "world"] as RootGenre[]) {
      applyMult(genreMultipliers, boosted, suppressed, g, 0.48);
    }
    applyMult(genreMultipliers, boosted, suppressed, "soundtrack", 0.72);
  } else if (NIGHT_DRIVE_RE.test(lower) || opts.profile.timeOfDay === "late_night") {
    for (const g of ["indie", "electronic", "rock", "rnb"] as RootGenre[]) {
      applyMult(genreMultipliers, boosted, suppressed, g, 1.08);
    }
    for (const g of ["christmas", "folk", "world"] as RootGenre[]) {
      applyMult(genreMultipliers, boosted, suppressed, g, 0.52);
    }
  } else if (GYM_RE.test(lower) || opts.profile.energy >= 0.68) {
    for (const g of ["hip_hop", "electronic", "pop", "rock", "metal"] as RootGenre[]) {
      applyMult(genreMultipliers, boosted, suppressed, g, 1.08);
    }
    for (const g of ["folk", "classical", "jazz"] as RootGenre[]) {
      applyMult(genreMultipliers, boosted, suppressed, g, 0.55);
    }
  }

  return {
    boostedGenres: [...new Set(boosted)],
    suppressedGenres: [...new Set(suppressed)],
    genreMultipliers,
  };
}

/** Combine scene + vibe routing — never boosts above 1.22 or below 0.32 per genre. */
export function mergeGenreRoutings(
  base: SceneGenreRouting,
  extra: SceneGenreRouting
): SceneGenreRouting {
  const genreMultipliers = { ...base.genreMultipliers };
  const boosted = [...base.boostedGenres];
  const suppressed = [...base.suppressedGenres];

  for (const [g, mult] of Object.entries(extra.genreMultipliers) as [RootGenre, number][]) {
    const prev = genreMultipliers[g] ?? 1;
    const combined = Math.max(0.32, Math.min(1.22, prev * mult));
    genreMultipliers[g] = combined;
    if (combined > 1.03 && !boosted.includes(g)) boosted.push(g);
    if (combined < 0.88 && !suppressed.includes(g)) suppressed.push(g);
  }

  return {
    boostedGenres: [...new Set(boosted)],
    suppressedGenres: [...new Set(suppressed)],
    genreMultipliers,
  };
}
