/**
 * Genre cluster coverage — country/folk/americana and scene bindings.
 */

import type { EmotionProfile } from "./emotion";
import type { HumanIntent } from "./intent-decoder";
import type { SceneFamily } from "./scene-validation";

export const COUNTRY_CLUSTER = [
  "country",
  "modern country",
  "alt country",
  "americana",
  "folk",
  "outlaw country",
  "bluegrass",
  "southern rock",
  "country pop",
  "country rock",
  "red dirt",
  "honky tonk",
  "western",
  "acoustic folk",
  "singer-songwriter",
] as const;

const COUNTRY_ARTIST_HINTS =
  /\b(dolly parton|johnny cash|willie nelson|chris stapleton|luke combs|morgan wallen|zac brown|shania twain|carrie underwood|kacey musgraves|brandi carlile|jason aldean|george strait|merle haggard|waylon jennings|emmylou harris|alison krauss|mumford sons|avett brothers|zac brown band|old crow medicine show|tyler childers|sturgill simpson)\b/i;

const GENRE_TERM_RE: Record<string, RegExp> = {
  country: /\b(country|honky tonk|red dirt|nashville)\b/i,
  folk: /\b(folk|americana|acoustic singer|singer-songwriter)\b/i,
  blues: /\b(blues|delta blues|chicago blues)\b/i,
  pop: /\b(pop|dance pop|synth pop|indie pop)\b/i,
  rock: /\b(rock|classic rock|alt rock|indie rock)\b/i,
  electronic: /\b(electronic|edm|house|techno|ambient electronic)\b/i,
  hip_hop: /\b(hip hop|hip-hop|rap|trap)\b/i,
  jazz: /\b(jazz|swing|bebop)\b/i,
  soul: /\b(soul|motown|r&b|rnb)\b/i,
  christmas: /\b(christmas|xmas|holiday)\b/i,
};

const SCENE_GENRE_BOOST: Partial<Record<SceneFamily, string[]>> = {
  travel_driving: ["country", "folk", "rock", "pop"],
  sun_day: ["pop", "rock", "soul", "electronic"],
  social_friends: ["pop", "indie", "rock", "country"],
  memory_nostalgia: ["country", "folk", "pop", "soul"],
  night_introspective: ["folk", "electronic", "indie", "jazz"],
};

export interface TrackGenreHints {
  clusters: string[];
  isCountryFamily: boolean;
}

export function inferTrackGenreHints(track: {
  trackName: string;
  artistName: string;
  albumName: string;
}): TrackGenreHints {
  const blob = `${track.trackName} ${track.artistName} ${track.albumName}`.toLowerCase();
  const clusters: string[] = [];

  for (const term of COUNTRY_CLUSTER) {
    if (blob.includes(term)) clusters.push("country");
  }
  if (COUNTRY_ARTIST_HINTS.test(blob)) clusters.push("country");

  for (const [genre, re] of Object.entries(GENRE_TERM_RE)) {
    if (re.test(blob)) clusters.push(genre);
  }

  return {
    clusters: [...new Set(clusters)],
    isCountryFamily: clusters.includes("country") || clusters.includes("folk"),
  };
}

export function inferTrackGenreHintsFromSignals(
  track: { trackName: string; artistName: string; albumName: string },
  signals?: { acousticness?: number | null; energy?: number | null }
): TrackGenreHints {
  const base = inferTrackGenreHints(track);
  if (
    !base.isCountryFamily &&
    signals &&
    (signals.acousticness ?? 0) > 0.58 &&
    (signals.energy ?? 0.5) < 0.52
  ) {
    base.clusters.push("folk");
    base.isCountryFamily = true;
  }
  return base;
}

export function genreMatchScore(opts: {
  vibe: string;
  sceneFamily: SceneFamily;
  profile: EmotionProfile;
  intent: HumanIntent;
  hints: TrackGenreHints;
}): number {
  const { vibe, sceneFamily, profile, intent, hints } = opts;
  const lower = vibe.toLowerCase();
  let score = 0.45;

  const preferred = SCENE_GENRE_BOOST[sceneFamily] ?? [];
  for (const g of hints.clusters) {
    if (preferred.includes(g)) score += 0.18;
    if (GENRE_TERM_RE[g]?.test(lower)) score += 0.22;
  }

  if (hints.isCountryFamily) {
    if (
      profile.nostalgia > 0.4 ||
      intent === "nostalgia" ||
      /\b(road trip|highway|driving|storytelling|small town|americana|country)\b/i.test(lower)
    ) {
      score += 0.25;
    }
    if (sceneFamily === "travel_driving" || sceneFamily === "memory_nostalgia") {
      score += 0.2;
    }
    if (profile.calm > 0.4 && profile.nostalgia > 0.3) {
      score += 0.08;
    }
    if (profile.nostalgia > 0.35 && (hints.clusters.includes("folk") || hints.isCountryFamily)) {
      score += 0.12;
    }
  }

  if (hints.clusters.includes("christmas") && !/\b(christmas|holiday|winter|xmas)\b/i.test(lower)) {
    score *= 0.35;
  }

  return Math.min(1, score);
}
