/**
 * Genre prototype centres — retrieve around the musical ecosystem, not a bare label.
 *
 * Built from taxonomy `artistHints` (e.g. disco → Donna Summer → Bee Gees → Chic).
 * Soft pull only — never overrides genre truth anchors.
 */
import { GENRE_FAMILIES } from "../../lib/genre-taxonomy-data";
import type { RootGenre } from "../../lib/genre-taxonomy";
import { OPENER_FILLER_PATTERN } from "./opener-hygiene";
import { isSafetyBlanketOutsideWorld } from "./world-identity-gate";

export type GenrePrototypeCentre = {
  id: string;
  family: RootGenre;
  subgenre: string;
  /** Canonical exemplar artists (normalized lowercase names / regex sources). */
  artists: string[];
  artistPattern: RegExp;
};

const CENTRE_CACHE = new Map<string, GenrePrototypeCentre>();

function normalizeArtistHint(hint: string): string {
  return hint.replace(/\\b/g, "").replace(/\\\+/g, "+").replace(/\.\*/g, " ").trim().toLowerCase();
}

export function listGenrePrototypeCentres(): GenrePrototypeCentre[] {
  if (CENTRE_CACHE.size > 0) return [...CENTRE_CACHE.values()];
  for (const family of GENRE_FAMILIES) {
    for (const sub of family.subgenres) {
      if (!sub.artistHints || sub.artistHints.length === 0) continue;
      const artists = sub.artistHints.map(normalizeArtistHint).filter((a) => a.length >= 2);
      if (artists.length === 0) continue;
      let artistPattern: RegExp;
      try {
        artistPattern = new RegExp(sub.artistHints.join("|"), "i");
      } catch {
        continue;
      }
      const centre: GenrePrototypeCentre = {
        id: `${family.family}:${sub.id}`,
        family: family.family as RootGenre,
        subgenre: sub.id,
        artists,
        artistPattern,
      };
      CENTRE_CACHE.set(centre.id, centre);
    }
  }
  return [...CENTRE_CACHE.values()];
}

export function resolveGenrePrototypeCentres(opts: {
  vibe?: string;
  primarySubgenre?: string | null;
  genreFamilies?: string[];
}): GenrePrototypeCentre[] {
  const centres = listGenrePrototypeCentres();
  const sub = (opts.primarySubgenre ?? "").toLowerCase().trim();
  if (sub) {
    const exact = centres.filter((c) => c.subgenre === sub || c.id.endsWith(`:${sub}`));
    if (exact.length > 0) return exact;
  }

  const lower = (opts.vibe ?? "").toLowerCase();
  const familyHits = new Set(
    (opts.genreFamilies ?? []).map((f) => f.toLowerCase()),
  );
  const matched = centres.filter((c) => {
    if (familyHits.has(c.family)) return true;
    if (lower.includes(c.subgenre.replace(/_/g, " "))) return true;
    // Prompt mentions a prototype artist (Donna Summer → disco centre).
    return c.artists.some((artist) => artist.length >= 4 && lower.includes(artist));
  });
  if (matched.length > 0) return matched.slice(0, 4);

  if (familyHits.size > 0) {
    return centres.filter((c) => familyHits.has(c.family)).slice(0, 3);
  }
  return [];
}

/** World-specific prototype centres for everyday locks. */
const WORLD_PROTOTYPE_HINTS: Record<string, string[]> = {
  feel_good_world: ["disco", "funk", "motown", "nu_disco"],
  gym_energy_world: ["edm", "house", "hip_hop", "pop_punk"],
  latin_summer_rooftop_world: ["reggaeton", "latin_pop", "salsa", "bachata"],
  social_kitchen_world: ["funk", "nu_disco", "motown"],
  party_prep_world: ["disco", "nu_disco", "house"],
};

export function resolvePrototypeCentresForWorld(worldId: string): GenrePrototypeCentre[] {
  const hints = WORLD_PROTOTYPE_HINTS[worldId];
  if (!hints?.length) return [];
  const centres = listGenrePrototypeCentres();
  const matched = centres.filter((c) => hints.includes(c.subgenre));
  return matched.slice(0, 4);
}

export function trackMatchesGenrePrototype(
  artistName: string,
  centre: GenrePrototypeCentre,
): boolean {
  if (!artistName) return false;
  return centre.artistPattern.test(artistName);
}

/**
 * Soft affinity 0–1: how many tracks sit in the prototype artist neighbourhood.
 * A Spotify-curated disco playlist usually includes several of these names.
 */
export function scorePrototypeAffinity(
  tracks: Array<{ artistName?: string | null }>,
  centres: GenrePrototypeCentre[],
): number {
  if (tracks.length === 0 || centres.length === 0) return 0.5;
  let hits = 0;
  for (const track of tracks) {
    const artist = track.artistName ?? "";
    if (centres.some((c) => trackMatchesGenrePrototype(artist, c))) hits += 1;
  }
  const share = hits / tracks.length;
  // Sparse hits still count — 2–3 prototype artists in a 30-track list is strong.
  if (hits >= 3) return Math.min(1, 0.55 + share * 1.2);
  if (hits >= 1) return Math.min(1, 0.4 + share * 1.4);
  return 0.28;
}

/** Soft ranking boost for prototype-neighbourhood artists (cap ~0.08). */
export function prototypeCentreScoreBoost(
  artistName: string,
  centres: GenrePrototypeCentre[],
  activeWorldIds: string[] = [],
): number {
  if (!artistName || centres.length === 0) return 0;
  if (
    activeWorldIds.length > 0 &&
    OPENER_FILLER_PATTERN.test(artistName) &&
    isSafetyBlanketOutsideWorld(artistName, activeWorldIds)
  ) {
    return 0;
  }
  for (const centre of centres) {
    if (trackMatchesGenrePrototype(artistName, centre)) {
      return Math.min(0.08, 0.04 + 0.01 * Math.min(4, centre.artists.length / 4));
    }
  }
  return 0;
}
