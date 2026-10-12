/**
 * World musical character: what a world SOUNDS like, and how well one song fits it.
 *
 *   prompt → world / situation → musical character → per-song musical fit → ranking
 *
 * The musical character is composed from knowledge Kwalify already has — no per-world hand tuning:
 *   - the world identity profile's audio bands (energy / valence / danceability / instrumentalness),
 *     which already describe each musical world;
 *   - the recognised situation's atlas `energy_curve` (low … high), which describes the moment.
 *
 * Fit is soft: inside every band it falls gently with distance from the character's centre (so the
 * heart of a world outranks its edge); outside a band it fades to 0 at the soft width. It is used to
 * RANK (and to scale identity-derived world scores) — never as a new hard filter. The existing hard
 * identity bands in passesWorldIdentity are unchanged.
 *
 * Provenance: fit is computed only from REAL audio features (Spotify measurements, e.g. from the
 * user's library export). Metadata-inferred values are uncorrelated with real ones, so for a track
 * with inferred/missing features the fit is null and every caller falls back to its existing logic.
 * A song's own features are therefore what separate "The Winner Takes It All" from "Dancing Queen" —
 * artist-level membership no longer stands in for song-level evidence.
 */

import { detectAudioFeatureSource } from "../../lib/metadata-audio-feature-inference";
import { getAtlasEntry } from "../../lib/world-understanding/atlas-loader";
import { dominantSituationExperience, worldForSituation } from "../../lib/world-understanding/situation-world-router";
import { identityProfileForWorld } from "./world-identity-gate";

export type MusicalBand = { min?: number; max?: number };
export type MusicalDimension = "energy" | "valence" | "danceability" | "instrumentalness";
export const MUSICAL_DIMENSIONS: readonly MusicalDimension[] = ["energy", "valence", "danceability", "instrumentalness"];

/**
 * One source of musical knowledge (a world or a situation): bands on the dimensions it knows, plus
 * a target (the centre of the character) so a song deep inside it ranks above one at the edge.
 */
export type MusicalConstraintSet = { source: string; target?: Partial<Record<MusicalDimension, number>> } & Partial<
  Record<MusicalDimension, MusicalBand>
>;

/** All constraint sets a song should satisfy; fit multiplies across sets and dimensions. */
export type MusicalCharacter = { sets: MusicalConstraintSet[] };

export type MusicalFitTrack = {
  trackId?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  instrumentalness?: number | null;
  tempo?: number | null;
  loudness?: number | null;
};

/** Distance outside a band at which fit reaches 0. */
export const BAND_SOFT_WIDTH = 0.2;
/**
 * Per-dimension soft width. Instrumentalness is near-categorical (vocal ≈ 0, instrumental ≈ 1), so a
 * vocal track gets no musical fit for an instrumental world (e.g. deep focus).
 */
const SOFT_WIDTH: Readonly<Record<MusicalDimension, number>> = {
  energy: BAND_SOFT_WIDTH,
  valence: BAND_SOFT_WIDTH,
  danceability: BAND_SOFT_WIDTH,
  instrumentalness: 0.05,
};
/** How much a complete musical mismatch scales a world-identity score down (score × (1 − w)). */
export const MUSICAL_FIT_IDENTITY_WEIGHT = 0.35;
/** Max fit lost by a song as far from a target as possible (distance ≥ TARGET_RANGE). */
const TARGET_PULL = 0.5;
const TARGET_RANGE = 0.5;

/** Atlas energy curve → the energy at the centre of that moment. */
const ENERGY_CURVE_TARGET: Readonly<Record<string, number>> = {
  low: 0.25,
  "low-medium": 0.4,
  medium: 0.6,
  "medium-high": 0.72,
  high: 0.82,
};

/**
 * Atlas energy curves → Spotify energy band. Coarse on purpose: it describes the moment, not a song.
 * Spotify energy tracks loudness/intensity, so ordinary guitar records sit at 0.8–0.95; only the low
 * curves cap energy tightly.
 */
const ENERGY_CURVE_BANDS: Readonly<Record<string, MusicalBand>> = {
  low: { max: 0.45 },
  "low-medium": { min: 0.15, max: 0.68 },
  medium: { min: 0.3, max: 0.9 },
  "medium-high": { min: 0.45 },
  high: { min: 0.58 },
};

const realFeatureCache = new Map<string, boolean>();

/**
 * True only when the track's stored features are real measurements. Needs the track id (the
 * inference fingerprint is keyed on it); without one we cannot tell, so we do not trust the values.
 */
export function hasRealAudioFeatures(track: MusicalFitTrack): boolean {
  const id = track.trackId;
  if (!id || typeof track.valence !== "number" || typeof track.energy !== "number") return false;
  const key = `${id}:${track.valence}`;
  const cached = realFeatureCache.get(key);
  if (cached != null) return cached;
  const real =
    detectAudioFeatureSource({
      trackId: id,
      energy: track.energy,
      valence: track.valence,
      tempo: track.tempo ?? null,
      loudness: track.loudness ?? null,
    }) === "spotify";
  if (realFeatureCache.size > 50_000) realFeatureCache.clear();
  realFeatureCache.set(key, real);
  return real;
}

/** Soft membership of one value in one band: 1 inside, linear fade to 0 at BAND_SOFT_WIDTH outside. */
export function softBandFit(value: number, band: MusicalBand, width = BAND_SOFT_WIDTH): number {
  let outside = 0;
  if (band.min != null && value < band.min) outside = band.min - value;
  if (band.max != null && value > band.max) outside = Math.max(outside, value - band.max);
  return Math.max(0, 1 - outside / width);
}

/** Centre of a band on a 0–1 scale (one-sided bands use the centre of their feasible side). */
function bandCentre(band: MusicalBand): number {
  const min = band.min ?? 0;
  const max = band.max ?? 1;
  return (min + max) / 2;
}
function setFromBands(
  source: string,
  bands: Partial<Record<MusicalDimension, MusicalBand | undefined>>,
  target?: Partial<Record<MusicalDimension, number>>,
): MusicalConstraintSet | null {
  const set: MusicalConstraintSet = { source };
  const centres: Partial<Record<MusicalDimension, number>> = {};
  let any = false;
  for (const dim of MUSICAL_DIMENSIONS) {
    const band = bands[dim];
    if (band && (band.min != null || band.max != null)) {
      set[dim] = { ...band };
      // Energy / valence carry a character centre; danceability and instrumentalness are thresholds.
      if (dim === "energy" || dim === "valence") centres[dim] = target?.[dim] ?? bandCentre(band);
      any = true;
    }
  }
  if (Object.keys(centres).length > 0) set.target = centres;
  return any ? set : null;
}

/** Musical knowledge of a world, from its identity profile's audio bands. */
export function worldMusicalConstraints(worldId: string | null | undefined): MusicalConstraintSet | null {
  if (!worldId) return null;
  const profile = identityProfileForWorld(worldId);
  if (!profile) return null;
  return setFromBands(`world:${worldId}`, profile);
}

/** Musical knowledge of a situation, from its atlas energy curve. */
export function situationMusicalConstraints(experienceId: string | null | undefined): MusicalConstraintSet | null {
  if (!experienceId) return null;
  const curve = String(getAtlasEntry(experienceId)?.energy_curve ?? "").toLowerCase().trim();
  const band = ENERGY_CURVE_BANDS[curve];
  return band
    ? setFromBands(`situation:${experienceId}`, { energy: band }, { energy: ENERGY_CURVE_TARGET[curve] })
    : null;
}

/** Musical character of a world on its own (used inside world-identity scoring). */
export function worldMusicalCharacter(worldId: string | null | undefined): MusicalCharacter | null {
  const set = worldMusicalConstraints(worldId);
  return set ? { sets: [set] } : null;
}

const promptCharacterCache = new Map<string, MusicalCharacter | null>();

/**
 * Musical character for a whole request: the committed world, plus the recognised situation's
 * world and energy curve. For "indie songs for a lonely motorway at 2am" that is indie (world) +
 * night drive (situation world) + low-medium energy (situation), so both halves count.
 */
export function promptMusicalCharacter(prompt: string, committedWorldId: string | null | undefined): MusicalCharacter | null {
  const key = `${committedWorldId ?? ""}|${prompt.trim().toLowerCase()}`;
  if (promptCharacterCache.has(key)) return promptCharacterCache.get(key) ?? null;
  const sets: MusicalConstraintSet[] = [];
  const add = (set: MusicalConstraintSet | null) => {
    if (set && !sets.some((s) => s.source === set.source)) sets.push(set);
  };
  add(worldMusicalConstraints(committedWorldId));
  if (prompt.trim()) {
    const situation = dominantSituationExperience(prompt)?.experienceId;
    add(worldMusicalConstraints(worldForSituation(situation)));
    add(situationMusicalConstraints(situation));
  }
  const character = sets.length > 0 ? { sets } : null;
  if (promptCharacterCache.size > 500) promptCharacterCache.clear();
  promptCharacterCache.set(key, character);
  return character;
}

/**
 * 0–1 musical fit of a song to a character, or null when it cannot be judged honestly
 * (no character, or the song has no real audio features).
 */
export function scoreMusicalFit(track: MusicalFitTrack, character: MusicalCharacter | null): number | null {
  if (!character || character.sets.length === 0) return null;
  if (!hasRealAudioFeatures(track)) return null;
  let fit = 1;
  let judged = false;
  for (const set of character.sets) {
    for (const dim of MUSICAL_DIMENSIONS) {
      const band = set[dim];
      const value = track[dim];
      if (!band || typeof value !== "number" || !Number.isFinite(value)) continue;
      fit *= softBandFit(value, band, SOFT_WIDTH[dim]);
      judged = true;
      const centre = set.target?.[dim];
      if (centre != null) fit *= 1 - TARGET_PULL * Math.min(1, Math.abs(value - centre) / TARGET_RANGE);
    }
  }
  return judged ? fit : null;
}

/**
 * Ranking adjustment from a fit: a song at the heart of the character gains, a clear mismatch loses
 * more. Sized to steer rankings when the moment is understood but the generic intent is not.
 */
export function musicalFitRankAdjust(fit: number | null): number {
  if (fit == null) return 0;
  return (fit - 0.6) * 0.4; // +0.16 … −0.24
}

/** Mean character centre per dimension across the sets that define one (energy / valence). */
export function musicalCharacterTargets(character: MusicalCharacter | null): { energy?: number; valence?: number } {
  const out: { energy?: number; valence?: number } = {};
  if (!character) return out;
  for (const dim of ["energy", "valence"] as const) {
    const values = character.sets.map((s) => s.target?.[dim]).filter((v): v is number => typeof v === "number");
    if (values.length > 0) out[dim] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return out;
}

/** Fraction of the way the prompt's generic intent target moves toward the world's musical centre. */
export const INTENT_STEER_STRENGTH = 0.6;

/**
 * Point the generic intent target (energy range, signed valence) toward the musical character of the
 * recognised world/situation. The intent layer often reads a moment like "going to a funeral" as
 * neutral; the world knows it is quiet and low. Soft: it moves the target, it filters nothing.
 */
export function steerIntentTowardMusicalCharacter<V extends { energyRange: [number, number]; valenceTarget: number }>(
  vector: V,
  character: MusicalCharacter | null,
  strength = INTENT_STEER_STRENGTH,
): V {
  const targets = musicalCharacterTargets(character);
  if (targets.energy == null && targets.valence == null) return vector;
  const mix = (a: number, b: number) => a + (b - a) * strength;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  let energyRange = vector.energyRange;
  if (targets.energy != null) {
    const [lo, hi] = vector.energyRange;
    const width = Math.max(0.24, Math.min(0.4, hi - lo));
    const centre = mix((lo + hi) / 2, targets.energy);
    energyRange = [clamp(centre - width / 2), clamp(centre + width / 2)];
  }
  const valenceTarget =
    targets.valence != null ? Math.max(-1, Math.min(1, mix(vector.valenceTarget, targets.valence * 2 - 1))) : vector.valenceTarget;
  return { ...vector, energyRange, valenceTarget };
}

/**
 * True when the artist is one the world's identity profile names as its own (the profile's named-
 * artist patterns — requireAny beyond the first, genre-word pattern).
 */
export function isNamedWorldArtist(artistName: string | null | undefined, worldIds: readonly string[]): boolean {
  const artist = String(artistName ?? "").trim();
  if (!artist) return false;
  return worldIds.some((id) => (identityProfileForWorld(id)?.requireAny.slice(1) ?? []).some((re) => re.test(artist)));
}
