/**
 * Situation → musical world routing.
 *
 * The world that drives retrieval, world purity and filler stripping used to be chosen by
 * keyword regexes (EVERYDAY_WORLD_MAP) with a hard-locked `sunday_chill_world` default, so
 * situations the regexes did not know ("going to a funeral", "finally getting good news",
 * "a beer with mates after work") all collapsed into one acoustic pool, and an activity phrase
 * ("driving home") beat the situation that defines the moment ("…from a funeral").
 *
 * The world-understanding layer already recognises those situations via the world atlas
 * (`interpretWorld` → ranked atlas experiences). This module turns that recognition into a world:
 *
 *   1. Rank recognised atlas experiences by match strength × domain weight. Life events,
 *      relationships, achievements and social situations define the emotional world; transport,
 *      places, activities and times of day usually describe the circumstances, so they weigh less.
 *   2. Take the dominant experience. If it maps to an existing musical world, route there.
 *      If the dominant experience has no musical mapping, do nothing (existing routing applies) —
 *      never fall through to a weaker experience, which would let a circumstance override the
 *      situation.
 *
 * No per-keyword scoring rules: situation knowledge lives in the atlas JSON, musical knowledge
 * lives in the world identity profiles; this table only links the two.
 */

import { interpretWorld } from "./index";
import { getAtlasEntry, promptNamesAtlasEntry } from "./atlas-loader";
import { detectTimeOfDay } from "../emotion-scene-layers";

/** Atlas experience id → musical world id (world ids from world-identity-gate). */
export const SITUATION_WORLDS: Readonly<Record<string, string>> = {
  // Loss, heartbreak, longing — quiet, tender, emotionally heavy
  grief_and_loss: "soft_sad_world",
  goodbye_neighbourhood: "soft_sad_world",
  breakup: "soft_sad_world",
  heartbreak: "soft_sad_world",
  missing_someone: "soft_sad_world",
  long_distance: "soft_sad_world",
  sad_rain: "soft_sad_world",
  // Romance
  first_date: "first_date_world",
  falling_in_love: "first_date_world",
  // Wins and celebrations
  personal_win: "feel_good_world",
  promotion: "feel_good_world",
  graduation: "feel_good_world",
  family_gathering: "feel_good_world",
  sun_freedom: "feel_good_world",
  // Nights out
  party_night: "party_prep_world",
  festival: "party_prep_world",
  // Mates / pub — familiar singalong anthems
  pub_evening: "pub_singalong_world",
  pub_garden: "pub_singalong_world",
  meeting_friends: "pub_singalong_world",
  old_friends_reunion: "pub_singalong_world",
  // Travel with company / open road
  road_trip: "road_trip_singalong_world",
  coastal_drive: "road_trip_singalong_world",
  // Work is over — release, familiarity, warmth (not melancholy)
  driving_home_after_work: "nostalgia_warm_world",
  finally_clocked_off: "nostalgia_warm_world",
  finishing_work: "nostalgia_warm_world",
  commute_home: "nostalgia_warm_world",
  childhood_summer_holidays: "nostalgia_warm_world",
  // Night-time solitude
  motorway_at_night: "night_drive_world",
  // empty_motorway is not mapped: the atlas places it "late night" or "early morning", so it
  // says nothing about night on its own ("empty motorway at sunrise" is not a night drive).
  two_am_thoughts: "late_night_calm_world",
  cant_sleep: "late_night_calm_world",
  lying_awake: "late_night_calm_world",
  everyone_asleep: "late_night_calm_world",
  alone_after_party: "late_night_calm_world",
  empty_house: "late_night_calm_world",
  sitting_quietly: "late_night_calm_world",
  // Unease / dread — introspective but familiar and a bit comforting
  sunday_evening_dread: "indie_bedroom_world",
  monday_morning: "indie_bedroom_world",
  // Head-clearing walks
  walk_to_clear_head: "indie_dream_world",
  night_walk: "indie_dream_world",
  staring_out_window: "indie_dream_world",
  // Home / kitchen / slow days
  cooking: "social_kitchen_world",
  family_dinner: "social_kitchen_world",
  kitchen: "social_kitchen_world",
  sunday_morning: "sunday_chill_world",
  lazy_sunday: "sunday_chill_world",
  // Same world the everyday map has always chosen for "rainy day" / "rainy day in bed".
  rainy_day_indoors: "rainy_reading_world",
  comfort_rain: "sunday_chill_world",
  coffee_alone: "sunday_chill_world",
  cuppa: "sunday_chill_world",
  quiet_saturday: "sunday_chill_world",
  tea_after_work: "sunday_chill_world",
  rain_on_windows: "chill_rainy_world",
  rainy_windscreen_drive: "rainy_drive_world",
  // Weather / season
  beach: "summer_warm_world",
  summer_evening: "summer_warm_world",
  // Doing things
  cleaning_at_night: "upbeat_chore_world",
  reorganising_room: "upbeat_chore_world",
  running: "running_energy_world",
};

/**
 * How strongly an experience domain defines the emotional world (vs. merely describing the
 * circumstances). Unlisted domains (transport, places, activities, home, …) use the default.
 */
const DOMAIN_WEIGHT: Readonly<Record<string, number>> = {
  "life-events": 1,
  loss: 1,
  relationships: 1,
  achievement: 1,
  celebrations: 1,
  social: 0.95,
  time: 0.9,
};
const CIRCUMSTANCE_WEIGHT = 0.8;
/** Weighted atlas match needed before a situation may choose the world. */
export const SITUATION_MIN_WEIGHTED_SCORE = 0.3;

export type SituationWorldRoute = {
  worldId: string;
  experienceId: string;
  domain: string;
  /** Raw atlas match score of the dominant experience. */
  matchScore: number;
  /** Match score × domain weight — the dominance score. */
  weightedScore: number;
  /** Other recognised experiences, strongest first (diagnostics / "why this playlist"). */
  supporting: Array<{ experienceId: string; domain: string; weightedScore: number }>;
};

type AtlasHit = { entryId: string; domain: string; matchScore: number };

export function domainWeight(domain: string): number {
  return DOMAIN_WEIGHT[domain] ?? CIRCUMSTANCE_WEIGHT;
}

type RankedHit = AtlasHit & { weightedScore: number };

function rankHits(hits: readonly AtlasHit[]): RankedHit[] {
  return hits
    .map((h) => ({ ...h, weightedScore: Math.round(h.matchScore * domainWeight(h.domain) * 100) / 100 }))
    .sort((a, b) => b.weightedScore - a.weightedScore);
}

/** Domains naming where the listener is or what they are doing — the concrete moment. */
const CONCRETE_DOMAINS: ReadonlySet<string> = new Set(["transport", "places", "activities"]);
/**
 * Musically, a time of day ("2am") colours a moment; a concrete place matched almost as strongly
 * ("motorway at 2am") is what the music should sound like. Used for the musical reading only —
 * world routing keeps the plain ranking (routing these prompts to night_drive_world was traced as
 * slower and underfilled).
 */
const TIME_MODIFIER_YIELD_RATIO = 0.9;

function musicalDominantHit(ranked: RankedHit[]): RankedHit | undefined {
  const top = ranked[0];
  if (!top || top.domain !== "time") return top;
  return (
    ranked.find(
      (h) =>
        CONCRETE_DOMAINS.has(h.domain) &&
        SITUATION_WORLDS[h.entryId] != null &&
        h.matchScore >= top.matchScore * TIME_MODIFIER_YIELD_RATIO,
    ) ?? top
  );
}

/** World a recognised situation maps to, or null. */
export function worldForSituation(experienceId: string | null | undefined): string | null {
  return experienceId ? SITUATION_WORLDS[experienceId] ?? null : null;
}

/**
 * The dominant recognised situation for the musical reading of the prompt, mapped to a world or not
 * (its atlas data still describes the moment).
 */
export function dominantSituationFromAtlasHits(hits: readonly AtlasHit[]): { experienceId: string; domain: string; weightedScore: number } | null {
  const dominant = musicalDominantHit(rankHits(hits));
  if (!dominant || dominant.weightedScore < SITUATION_MIN_WEIGHTED_SCORE) return null;
  return { experienceId: dominant.entryId, domain: dominant.domain, weightedScore: dominant.weightedScore };
}

/** Pure decision from ranked atlas hits — exported for tests. */
export function routeSituationFromAtlasHits(hits: readonly AtlasHit[]): SituationWorldRoute | null {
  const ranked = rankHits(hits);
  const dominant = ranked[0];
  if (!dominant || dominant.weightedScore < SITUATION_MIN_WEIGHTED_SCORE) return null;
  const worldId = SITUATION_WORLDS[dominant.entryId];
  if (!worldId) return null;
  return {
    worldId,
    experienceId: dominant.entryId,
    domain: dominant.domain,
    matchScore: dominant.matchScore,
    weightedScore: dominant.weightedScore,
    supporting: ranked.slice(1, 4).map((h) => ({
      experienceId: h.entryId,
      domain: h.domain,
      weightedScore: h.weightedScore,
    })),
  };
}

const hitsCache = new Map<string, AtlasHit[]>();
const ROUTE_CACHE_MAX = 500;

type TimeBand = "night" | "day";

function timeBand(time: string | null): TimeBand | null {
  if (!time) return null;
  return time === "late_night" || time === "night" ? "night" : "day";
}

/** The single time band an atlas entry belongs to ("night" for midnight / late night), or null. */
function entryTimeBand(entryId: string): TimeBand | null {
  const contexts = getAtlasEntry(entryId)?.time_context ?? [];
  if (contexts.length === 0) return null;
  const bands = new Set(contexts.map((context) => timeBand(detectTimeOfDay(String(context)))));
  if (bands.size !== 1) return null;
  return [...bands][0] ?? null;
}

/**
 * Drop recognised experiences whose time of day contradicts the time the user stated: "empty
 * motorway at sunrise" matched motorway_at_night (whose phrases include "empty motorway") and was
 * routed to the night-drive world.
 */
export function filterHitsByStatedTime<T extends { entryId: string }>(hits: readonly T[], prompt: string): T[] {
  const stated = timeBand(detectTimeOfDay(prompt));
  if (!stated) return [...hits];
  return hits.filter((hit) => {
    const band = entryTimeBand(hit.entryId);
    return band == null || band === stated;
  });
}

function atlasHitsForPrompt(prompt: string): AtlasHit[] {
  const key = prompt.trim().toLowerCase();
  if (!key) return [];
  const cached = hitsCache.get(key);
  if (cached) return cached;
  let hits: AtlasHit[] = [];
  try {
    hits = filterHitsByStatedTime(interpretWorld(prompt).humanExperience.atlasConsultations ?? [], prompt).filter(
      (hit) => promptNamesAtlasEntry(prompt, hit.entryId),
    );
  } catch {
    hits = [];
  }
  if (hitsCache.size >= ROUTE_CACHE_MAX) hitsCache.clear();
  hitsCache.set(key, hits);
  return hits;
}

/** Route a prompt to a musical world from its recognised situation, or null. */
export function resolveSituationWorld(prompt: string): SituationWorldRoute | null {
  return routeSituationFromAtlasHits(atlasHitsForPrompt(prompt));
}

/** The prompt's dominant recognised situation (mapped to a world or not), or null. */
export function dominantSituationExperience(prompt: string): { experienceId: string; domain: string; weightedScore: number } | null {
  return dominantSituationFromAtlasHits(atlasHitsForPrompt(prompt));
}
