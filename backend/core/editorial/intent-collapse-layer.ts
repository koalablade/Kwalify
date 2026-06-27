/**
 * Intent collapse layer — pre-retrieval editorial world lock.
 *
 * Collapses free-text intent into a single constrained EditorialIntentVector
 * and hard-filters candidates before sampler/interleaver see them.
 */

import type { EmotionProfile } from "../../lib/emotion";
import { getGenreFamily } from "../v3/global-diversity-controller";
import type { LockedIntent } from "../v3/intent";
import { extractSceneDescriptor } from "../scene-world-layer";

export type SceneType =
  | "commute"
  | "night"
  | "walk"
  | "drive"
  | "morning"
  | "sunday"
  | "gym"
  | "study"
  | "unknown";

export type EditorialIntentVector = {
  primaryMood: string;
  energyRange: [number, number];
  valenceTarget: number;
  rhythmDensityCap: number;
  vocalPresenceTarget: number;
  nostalgiaBias: number;
  sonicAggressionCeiling: number;
  sceneType: SceneType;
  editorialWorldTag: string;
  allowedMicroClusters: string[];
  /** Wider valence band when library-calibrated for filter survival. */
  valenceMaxDeviation?: number;
  /** Skip primary-family gate when retrieval pool is scene-coherent but genre-tagged broadly. */
  relaxGenreFamilyFilter?: boolean;
};

export type IntentFilterRejectionReason =
  | "genre_family_not_allowed"
  | "energy_out_of_range"
  | "valence_out_of_range"
  | "nostalgia_energy_valence_conflict"
  | "nostalgia_release_year_conflict"
  | "rhythm_density_cap"
  | "aggression_cap"
  | "micro_cluster_not_allowed"
  | "passed";

export type IntentCollapseDiagnostics = {
  primaryMood: string;
  editorialWorldTag: string;
  energyRange: [number, number];
  rhythmDensityCap: number;
  allowedMicroClusters: string[];
  collapseConfidenceScore: number;
  preFilterCount: number;
  postFilterCount: number;
  filterRejectionCounts?: Partial<Record<IntentFilterRejectionReason, number>>;
  dominantFilterRejection?: IntentFilterRejectionReason | null;
  valenceMaxDeviation?: number;
  relaxGenreFamilyFilter?: boolean;
  rankedSelectionAvgScore?: number;
  rankedSelectionFloor?: number;
};

export type IntentCollapseTrack = {
  trackId: string;
  artistName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  tempo?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  releaseYear?: number | null;
};

type EditorialWorldDefinition = {
  tag: string;
  cohesionScore: number;
  primaryFamilies: string[];
  allowedMicroClusters: string[];
  moods: string[];
  sceneTypes: SceneType[];
  narrativeTags: string[];
  energyRange: [number, number];
  valenceTarget: number;
  rhythmDensityCap: number;
  vocalPresenceTarget: number;
  nostalgiaBias: number;
  sonicAggressionCeiling: number;
};

/** Scene-world archetype IDs compatible with each locked editorial world (no secondary-family blending). */
export const EDITORIAL_WORLD_ARCHETYPE_COMPAT: Record<string, string[]> = {
  indie_pop_sunshine_commute: ["indie_pop_sunshine_commute", "upbeat_alt_morning_drive", "modern_feelgood_pop"],
  upbeat_pop_commute: ["indie_pop_sunshine_commute", "upbeat_alt_morning_drive", "modern_feelgood_pop"],
  indie_folk_rain_walk: ["indie_folk_rain_walk", "mellow_alt_stroll"],
  soft_indie_morning: ["soft_indie_morning", "light_pop_sunday"],
  emotional_alt_pop: ["soft_indie_morning", "light_pop_sunday", "modern_feelgood_pop"],
  sunset_indie_drive: ["sunset_indie_drive"],
  night_drive_electronic: ["sunset_indie_drive", "nocturnal_alt"],
  late_night_indie_interior: ["late_night_indie", "nocturnal_alt"],
  late_night_rnb: ["late_night_indie", "nocturnal_alt", "light_pop_sunday"],
  gym_boost: ["gym_confidence_boost"],
  energetic_workout: ["gym_confidence_boost"],
  festival_electronic: ["gym_confidence_boost"],
  focus_study: ["ambient_focus_study"],
  coding_flow: ["ambient_focus_study"],
  deep_work: ["ambient_focus_study"],
  ambient_focus: ["ambient_focus_study"],
  modern_hiphop_focus: ["ambient_focus_study", "gym_confidence_boost"],
  indie_balanced_default: ["balanced_scene_default", "indie_balanced_default"],
  late_night_city_rain: ["indie_folk_rain_walk", "late_night_indie_interior", "mellow_alt_stroll"],
  sunday_vinyl_morning: ["soft_indie_morning", "light_pop_sunday"],
  festival_golden_hour: ["sunset_indie_drive", "upbeat_alt_morning_drive", "modern_feelgood_pop"],
  tumblr_indie_2012: ["soft_indie_morning", "indie_balanced_default", "balanced_scene_default"],
  bloghouse_2008: ["festival_electronic", "gym_confidence_boost", "night_drive_electronic"],
};

const EDITORIAL_WORLDS: EditorialWorldDefinition[] = [
  {
    tag: "indie_pop_sunshine_commute",
    cohesionScore: 0.92,
    primaryFamilies: ["indie", "pop"],
    allowedMicroClusters: ["indie:rhythmic", "indie:balanced", "pop:rhythmic", "pop:balanced"],
    moods: ["uplift", "optimistic", "bright"],
    sceneTypes: ["commute", "morning"],
    narrativeTags: ["commute", "morning", "sunshine", "feel-good", "drive"],
    energyRange: [0.48, 0.72],
    valenceTarget: 0.55,
    rhythmDensityCap: 0.72,
    vocalPresenceTarget: 0.82,
    nostalgiaBias: 0.25,
    sonicAggressionCeiling: 0.58,
  },
  {
    tag: "indie_folk_rain_walk",
    cohesionScore: 0.94,
    primaryFamilies: ["indie", "folk"],
    allowedMicroClusters: ["indie:acoustic", "indie:balanced", "folk:acoustic", "folk:balanced"],
    moods: ["reflective", "melancholic", "introspective"],
    sceneTypes: ["walk", "night"],
    narrativeTags: ["rain", "walk", "reflective", "city", "melanchol"],
    energyRange: [0.28, 0.52],
    valenceTarget: -0.15,
    rhythmDensityCap: 0.48,
    vocalPresenceTarget: 0.78,
    nostalgiaBias: 0.42,
    sonicAggressionCeiling: 0.35,
  },
  {
    tag: "soft_indie_morning",
    cohesionScore: 0.93,
    primaryFamilies: ["indie", "folk"],
    allowedMicroClusters: ["indie:acoustic", "indie:balanced", "folk:acoustic", "folk:balanced"],
    moods: ["warm", "calm", "comfort"],
    sceneTypes: ["morning", "sunday"],
    narrativeTags: ["cozy", "sunday", "morning", "soft", "warm"],
    energyRange: [0.30, 0.50],
    valenceTarget: 0.20,
    rhythmDensityCap: 0.45,
    vocalPresenceTarget: 0.80,
    nostalgiaBias: 0.38,
    sonicAggressionCeiling: 0.30,
  },
  {
    tag: "sunset_indie_drive",
    cohesionScore: 0.90,
    primaryFamilies: ["indie", "rock"],
    allowedMicroClusters: ["indie:balanced", "indie:rhythmic", "rock:balanced", "rock:rhythmic"],
    moods: ["nostalgic", "cinematic", "reflective"],
    sceneTypes: ["drive", "night"],
    narrativeTags: ["sunset", "drive", "driving", "road", "golden"],
    energyRange: [0.42, 0.68],
    valenceTarget: 0.10,
    rhythmDensityCap: 0.62,
    vocalPresenceTarget: 0.76,
    nostalgiaBias: 0.55,
    sonicAggressionCeiling: 0.48,
  },
  {
    tag: "late_night_indie_interior",
    cohesionScore: 0.91,
    primaryFamilies: ["indie", "electronic"],
    allowedMicroClusters: ["indie:balanced", "indie:electronic", "electronic:balanced", "electronic:rhythmic"],
    moods: ["melancholic", "introspective", "nocturnal"],
    sceneTypes: ["night"],
    narrativeTags: ["late night", "midnight", "night", "quiet", "thinking"],
    energyRange: [0.22, 0.48],
    valenceTarget: -0.25,
    rhythmDensityCap: 0.52,
    vocalPresenceTarget: 0.70,
    nostalgiaBias: 0.48,
    sonicAggressionCeiling: 0.32,
  },
  {
    tag: "upbeat_pop_commute",
    cohesionScore: 0.91,
    primaryFamilies: ["pop", "indie"],
    allowedMicroClusters: ["pop:rhythmic", "pop:balanced", "indie:rhythmic", "indie:balanced"],
    moods: ["uplift", "optimistic", "energetic"],
    sceneTypes: ["commute", "morning"],
    narrativeTags: ["optimistic", "commute", "forward", "work", "energy"],
    energyRange: [0.52, 0.78],
    valenceTarget: 0.45,
    rhythmDensityCap: 0.74,
    vocalPresenceTarget: 0.84,
    nostalgiaBias: 0.22,
    sonicAggressionCeiling: 0.55,
  },
  {
    tag: "gym_boost",
    cohesionScore: 0.93,
    primaryFamilies: ["hip_hop", "electronic", "pop"],
    allowedMicroClusters: ["hip_hop:rhythmic", "electronic:rhythmic", "electronic:electronic", "pop:rhythmic"],
    moods: ["energetic", "uplift"],
    sceneTypes: ["gym"],
    narrativeTags: ["gym", "workout", "confidence", "boost", "training", "pump"],
    energyRange: [0.62, 0.92],
    valenceTarget: 0.35,
    rhythmDensityCap: 0.88,
    vocalPresenceTarget: 0.72,
    nostalgiaBias: 0.18,
    sonicAggressionCeiling: 0.82,
  },
  {
    tag: "energetic_workout",
    cohesionScore: 0.92,
    primaryFamilies: ["electronic", "hip_hop"],
    allowedMicroClusters: ["electronic:rhythmic", "electronic:electronic", "hip_hop:rhythmic"],
    moods: ["energetic"],
    sceneTypes: ["gym"],
    narrativeTags: ["workout", "high energy", "hype", "gym"],
    energyRange: [0.65, 0.95],
    valenceTarget: 0.40,
    rhythmDensityCap: 0.90,
    vocalPresenceTarget: 0.68,
    nostalgiaBias: 0.15,
    sonicAggressionCeiling: 0.85,
  },
  {
    tag: "festival_electronic",
    cohesionScore: 0.90,
    primaryFamilies: ["electronic", "pop"],
    allowedMicroClusters: ["electronic:rhythmic", "electronic:electronic", "pop:rhythmic"],
    moods: ["energetic", "uplift"],
    sceneTypes: ["gym", "night"],
    narrativeTags: ["festival", "electronic", "dance", "party", "energy"],
    energyRange: [0.58, 0.90],
    valenceTarget: 0.50,
    rhythmDensityCap: 0.86,
    vocalPresenceTarget: 0.65,
    nostalgiaBias: 0.20,
    sonicAggressionCeiling: 0.78,
  },
  {
    tag: "focus_study",
    cohesionScore: 0.94,
    primaryFamilies: ["electronic", "indie"],
    allowedMicroClusters: ["electronic:balanced", "electronic:electronic", "indie:acoustic", "indie:balanced"],
    moods: ["reflective", "calm"],
    sceneTypes: ["study"],
    narrativeTags: ["study", "thinking", "focus", "session", "concentration"],
    energyRange: [0.22, 0.48],
    valenceTarget: 0.05,
    rhythmDensityCap: 0.42,
    vocalPresenceTarget: 0.55,
    nostalgiaBias: 0.35,
    sonicAggressionCeiling: 0.28,
  },
  {
    tag: "ambient_focus",
    cohesionScore: 0.93,
    primaryFamilies: ["electronic"],
    allowedMicroClusters: ["electronic:balanced", "electronic:electronic", "electronic:acoustic"],
    moods: ["calm", "introspective"],
    sceneTypes: ["study"],
    narrativeTags: ["ambient", "focus", "calm", "instrumental"],
    energyRange: [0.18, 0.42],
    valenceTarget: 0.0,
    rhythmDensityCap: 0.38,
    vocalPresenceTarget: 0.45,
    nostalgiaBias: 0.40,
    sonicAggressionCeiling: 0.22,
  },
  {
    tag: "coding_flow",
    cohesionScore: 0.92,
    primaryFamilies: ["electronic", "indie"],
    allowedMicroClusters: ["electronic:balanced", "electronic:electronic", "indie:balanced"],
    moods: ["calm", "balanced"],
    sceneTypes: ["study"],
    narrativeTags: ["coding", "flow", "focus", "deep work", "programming"],
    energyRange: [0.28, 0.52],
    valenceTarget: 0.10,
    rhythmDensityCap: 0.50,
    vocalPresenceTarget: 0.50,
    nostalgiaBias: 0.30,
    sonicAggressionCeiling: 0.32,
  },
  {
    tag: "deep_work",
    cohesionScore: 0.93,
    primaryFamilies: ["electronic", "indie"],
    allowedMicroClusters: ["electronic:balanced", "electronic:acoustic", "indie:acoustic", "indie:balanced"],
    moods: ["calm", "introspective"],
    sceneTypes: ["study"],
    narrativeTags: ["deep work", "focus", "thinking", "quiet"],
    energyRange: [0.20, 0.45],
    valenceTarget: -0.05,
    rhythmDensityCap: 0.40,
    vocalPresenceTarget: 0.48,
    nostalgiaBias: 0.38,
    sonicAggressionCeiling: 0.25,
  },
  {
    tag: "modern_hiphop_focus",
    cohesionScore: 0.88,
    primaryFamilies: ["hip_hop", "electronic"],
    allowedMicroClusters: ["hip_hop:balanced", "hip_hop:rhythmic", "electronic:balanced"],
    moods: ["balanced", "calm"],
    sceneTypes: ["study"],
    narrativeTags: ["hip hop", "focus", "study", "beats"],
    energyRange: [0.35, 0.58],
    valenceTarget: 0.15,
    rhythmDensityCap: 0.58,
    vocalPresenceTarget: 0.62,
    nostalgiaBias: 0.28,
    sonicAggressionCeiling: 0.45,
  },
  {
    tag: "late_night_rnb",
    cohesionScore: 0.91,
    primaryFamilies: ["rnb", "indie", "electronic"],
    allowedMicroClusters: ["rnb:balanced", "rnb:rhythmic", "indie:balanced", "electronic:balanced"],
    moods: ["melancholic", "nocturnal", "introspective"],
    sceneTypes: ["night"],
    narrativeTags: ["late night", "night", "rnb", "soul", "feeling"],
    energyRange: [0.24, 0.50],
    valenceTarget: -0.10,
    rhythmDensityCap: 0.55,
    vocalPresenceTarget: 0.78,
    nostalgiaBias: 0.45,
    sonicAggressionCeiling: 0.35,
  },
  {
    tag: "night_drive_electronic",
    cohesionScore: 0.90,
    primaryFamilies: ["electronic", "indie"],
    allowedMicroClusters: ["electronic:rhythmic", "electronic:balanced", "indie:balanced", "indie:rhythmic"],
    moods: ["nostalgic", "cinematic"],
    sceneTypes: ["drive", "night"],
    narrativeTags: ["night drive", "electronic", "driving", "highway"],
    energyRange: [0.45, 0.72],
    valenceTarget: 0.15,
    rhythmDensityCap: 0.68,
    vocalPresenceTarget: 0.70,
    nostalgiaBias: 0.50,
    sonicAggressionCeiling: 0.52,
  },
  {
    tag: "emotional_alt_pop",
    cohesionScore: 0.90,
    primaryFamilies: ["indie", "pop"],
    allowedMicroClusters: ["indie:balanced", "indie:acoustic", "pop:balanced", "pop:rhythmic"],
    moods: ["warm", "comfort", "uplift"],
    sceneTypes: ["sunday", "morning"],
    narrativeTags: ["emotional", "happy", "warmth", "light", "sunday", "afternoon"],
    energyRange: [0.38, 0.58],
    valenceTarget: 0.35,
    rhythmDensityCap: 0.55,
    vocalPresenceTarget: 0.82,
    nostalgiaBias: 0.32,
    sonicAggressionCeiling: 0.38,
  },
  {
    tag: "late_night_city_rain",
    cohesionScore: 0.92,
    primaryFamilies: ["indie", "electronic"],
    allowedMicroClusters: ["indie:balanced", "indie:acoustic", "electronic:balanced"],
    moods: ["melancholic", "nocturnal", "reflective"],
    sceneTypes: ["walk", "night"],
    narrativeTags: ["late night", "city", "rain", "rainy", "urban", "street", "3am"],
    energyRange: [0.26, 0.52],
    valenceTarget: -0.12,
    rhythmDensityCap: 0.50,
    vocalPresenceTarget: 0.76,
    nostalgiaBias: 0.44,
    sonicAggressionCeiling: 0.34,
  },
  {
    tag: "sunday_vinyl_morning",
    cohesionScore: 0.91,
    primaryFamilies: ["indie", "folk", "soul"],
    allowedMicroClusters: ["indie:acoustic", "folk:acoustic", "soul:balanced"],
    moods: ["warm", "calm", "comfort"],
    sceneTypes: ["sunday", "morning"],
    narrativeTags: ["sunday", "vinyl", "morning", "coffee", "record", "warm", "cozy"],
    energyRange: [0.32, 0.52],
    valenceTarget: 0.22,
    rhythmDensityCap: 0.48,
    vocalPresenceTarget: 0.80,
    nostalgiaBias: 0.48,
    sonicAggressionCeiling: 0.30,
  },
  {
    tag: "festival_golden_hour",
    cohesionScore: 0.89,
    primaryFamilies: ["indie", "rock", "electronic"],
    allowedMicroClusters: ["indie:rhythmic", "rock:rhythmic", "electronic:rhythmic"],
    moods: ["uplift", "nostalgic", "euphoric"],
    sceneTypes: ["drive", "night"],
    narrativeTags: ["festival", "golden hour", "sunset", "field", "summer", "outdoor"],
    energyRange: [0.48, 0.74],
    valenceTarget: 0.38,
    rhythmDensityCap: 0.70,
    vocalPresenceTarget: 0.74,
    nostalgiaBias: 0.52,
    sonicAggressionCeiling: 0.55,
  },
  {
    tag: "tumblr_indie_2012",
    cohesionScore: 0.90,
    primaryFamilies: ["indie", "pop"],
    allowedMicroClusters: ["indie:balanced", "indie:acoustic", "pop:balanced"],
    moods: ["melancholic", "nostalgic", "warm"],
    sceneTypes: ["unknown", "night"],
    narrativeTags: ["tumblr", "2012", "indie", "bedroom", "nostalgic", "teen", "blog"],
    energyRange: [0.34, 0.58],
    valenceTarget: 0.08,
    rhythmDensityCap: 0.58,
    vocalPresenceTarget: 0.78,
    nostalgiaBias: 0.62,
    sonicAggressionCeiling: 0.40,
  },
  {
    tag: "bloghouse_2008",
    cohesionScore: 0.88,
    primaryFamilies: ["electronic", "indie"],
    allowedMicroClusters: ["electronic:rhythmic", "electronic:electronic", "indie:rhythmic"],
    moods: ["energetic", "nostalgic"],
    sceneTypes: ["night"],
    narrativeTags: ["bloghouse", "2008", "electro", "indie dance", "warehouse", "rave", "blog", "party"],
    energyRange: [0.52, 0.82],
    valenceTarget: 0.28,
    rhythmDensityCap: 0.78,
    vocalPresenceTarget: 0.68,
    nostalgiaBias: 0.58,
    sonicAggressionCeiling: 0.68,
  },
  {
    tag: "indie_balanced_default",
    cohesionScore: 0.86,
    primaryFamilies: ["indie"],
    allowedMicroClusters: ["indie:acoustic", "indie:balanced", "indie:rhythmic"],
    moods: ["reflective", "balanced", "neutral"],
    sceneTypes: ["unknown"],
    narrativeTags: ["indie", "vibe", "playlist"],
    energyRange: [0.35, 0.62],
    valenceTarget: 0.0,
    rhythmDensityCap: 0.65,
    vocalPresenceTarget: 0.75,
    nostalgiaBias: 0.30,
    sonicAggressionCeiling: 0.50,
  },
];

export class IntentCollapseInsufficientPoolError extends Error {
  readonly status = "insufficient_intent_pool" as const;

  constructor(
    message: string,
    public readonly diagnostics: IntentCollapseDiagnostics,
    public readonly playlistExecutionTrace?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IntentCollapseInsufficientPoolError";
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function feature(value: number | null | undefined, fallback = 0.5): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : fallback;
}

function hasFeature(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function valenceToSigned(valence: number): number {
  return clamp01(valence) * 2 - 1;
}

function detectPrimaryMood(vibe: string, lockedIntent: LockedIntent, profile: EmotionProfile): string {
  const lower = vibe.toLowerCase();
  if (lockedIntent.mood.length > 0) return lockedIntent.mood[0]!;
  if (/\b(?:melanchol|sad|rainy|lonely|grief)\b/.test(lower)) return "melancholic";
  if (/\b(?:reflect|thought|thinking|introspect)\b/.test(lower)) return "reflective";
  if (/\b(?:uplift|optimis|happy|bright|feel.?good)\b/.test(lower)) return "uplift";
  if (/\b(?:cozy|warm|soft|comfort)\b/.test(lower)) return "comfort";
  if (/\b(?:hype|pump|energ|workout|gym)\b/.test(lower)) return "energetic";
  if (profile.valence < 0.42) return "reflective";
  if (profile.valence > 0.62) return "uplift";
  return "balanced";
}

function detectSceneType(vibe: string, lockedIntent: LockedIntent, profile: EmotionProfile): SceneType {
  const lower = vibe.toLowerCase();
  const descriptor = extractSceneDescriptor(vibe, lockedIntent);
  if (/\b(?:gym|workout|training)\b/.test(lower) || lockedIntent.activity === "workout") return "gym";
  if (/\b(?:study|studying|focus|thinking|coding|deep work)\b/.test(lower) || lockedIntent.activity === "focus") {
    return "study";
  }
  if (/\bcommute\b/.test(lower) || lockedIntent.activity === "commute") return "commute";
  if (/\b(?:late.?night|midnight)\b/.test(lower) || profile.timeOfDay === "late_night") return "night";
  if (/\b(?:walk|stroll)\b/.test(lower) || descriptor.setting.includes("walk")) return "walk";
  if (/\b(?:drive|driving|road)\b/.test(lower) || profile.motionState === "driving") return "drive";
  if (/\b(?:morning|sunrise|getting ready)\b/.test(lower) || profile.timeOfDay === "morning") return "morning";
  if (/\bsunday\b/.test(lower)) return "sunday";
  return "unknown";
}

function energyRangeForIntent(
  lockedIntent: LockedIntent,
  profile: EmotionProfile,
): [number, number] {
  if (lockedIntent.energy === "low") return [0.22, 0.48];
  if (lockedIntent.energy === "high") return [0.58, 0.88];
  if (lockedIntent.energy === "medium") return [0.42, 0.68];
  if (profile.energy < 0.42) return [0.25, 0.52];
  if (profile.energy > 0.62) return [0.52, 0.82];
  return [0.35, 0.65];
}

export function trackMicroCluster(track: IntentCollapseTrack): string {
  const family = getGenreFamily(track.genreFamily ?? track.genrePrimary ?? "unknown");
  const acoustic = feature(track.acousticness);
  const energy = feature(track.energy);
  const dance = feature(track.danceability);
  let texture = "balanced";
  if (acoustic >= 0.55) texture = "acoustic";
  else if (energy >= 0.72 && dance >= 0.65) texture = "rhythmic";
  else if (energy >= 0.72) texture = "electronic";
  return `${family}:${texture}`;
}

function rhythmDensity(track: IntentCollapseTrack): number {
  const dance = feature(track.danceability);
  const tempo = Math.min(1, feature(track.tempo, 120) / 200);
  return clamp01(dance * 0.62 + tempo * 0.38);
}

function sonicAggression(track: IntentCollapseTrack): number {
  const energy = feature(track.energy);
  const acoustic = feature(track.acousticness);
  const dance = feature(track.danceability);
  return clamp01(energy * (1 - acoustic) * (0.5 + dance * 0.5));
}

function trackFamily(track: IntentCollapseTrack): string {
  return getGenreFamily(track.genreFamily ?? track.genrePrimary ?? "unknown");
}

export function enrichIntentCollapseTrack(
  track: IntentCollapseTrack,
  classification?: { genreFamily?: string | null; genrePrimary?: string | null } | null,
): IntentCollapseTrack {
  const genreFamily = classification?.genreFamily
    ?? track.genreFamily
    ?? (track.genrePrimary ? getGenreFamily(track.genrePrimary) : null);
  const genrePrimary = classification?.genrePrimary ?? track.genrePrimary ?? null;
  if (genreFamily === track.genreFamily && genrePrimary === track.genrePrimary) return track;
  return { ...track, genreFamily, genrePrimary };
}

function dominantFilterRejectionReason(
  counts: Record<IntentFilterRejectionReason, number>,
): IntentFilterRejectionReason | null {
  let best: IntentFilterRejectionReason | null = null;
  let bestCount = 0;
  for (const [reason, count] of Object.entries(counts) as Array<[IntentFilterRejectionReason, number]>) {
    if (reason === "passed" || count <= bestCount) continue;
    best = reason;
    bestCount = count;
  }
  return best;
}

const DEALBREAKER_AGGRESSION_MARGIN = 0.12;
const OPENING_INTENT_SCORE_FLOOR = 0.36;

function countIntentFilterSurvivors<T extends IntentCollapseTrack>(
  tracks: T[],
  intent: EditorialIntentVector,
  strictMode = false,
): number {
  return selectRankedCandidatesForSampler(tracks, intent, {
    targetCount: 25,
    strictMode,
  }).selected.length;
}

export function scoreEditorialIntentMatch(
  track: IntentCollapseTrack,
  intent: EditorialIntentVector,
): number {
  const world = EDITORIAL_WORLDS.find((row) => row.tag === intent.editorialWorldTag);
  const family = trackFamily(track);

  if (
    (hasFeature(track.energy) || hasFeature(track.acousticness) || hasFeature(track.danceability)) &&
    sonicAggression(track) > intent.sonicAggressionCeiling + DEALBREAKER_AGGRESSION_MARGIN
  ) {
    return 0;
  }

  let score = 1;

  if (world && !world.primaryFamilies.includes(family)) {
    score *= 0.58;
  }

  if (hasFeature(track.energy)) {
    const energy = feature(track.energy);
    const [lo, hi] = intent.energyRange;
    if (energy < lo) score *= clamp01(1 - (lo - energy) * 1.8);
    else if (energy > hi) score *= clamp01(1 - (energy - hi) * 1.8);
  }

  const valenceSlack = intent.valenceMaxDeviation ?? 0.25;
  if (hasFeature(track.valence)) {
    const valence = valenceToSigned(feature(track.valence));
    const delta = Math.abs(valence - intent.valenceTarget);
    if (delta > valenceSlack) score *= clamp01(1 - (delta - valenceSlack) * 1.4);
  }

  const micro = trackMicroCluster(track);
  if (!intent.allowedMicroClusters.includes(micro)) {
    score *= 0.72;
  }

  if (hasFeature(track.danceability) || hasFeature(track.tempo)) {
    const rd = rhythmDensity(track);
    if (rd > intent.rhythmDensityCap + 0.04) {
      score *= clamp01(1 - (rd - intent.rhythmDensityCap) * 1.2);
    }
  }

  if (hasFeature(track.energy) || hasFeature(track.acousticness) || hasFeature(track.danceability)) {
    const agg = sonicAggression(track);
    if (agg > intent.sonicAggressionCeiling + 0.04) {
      score *= clamp01(1 - (agg - intent.sonicAggressionCeiling) * 1.5);
    }
  }

  const reason = diagnoseIntentFilterRejectionReason(track, intent);
  if (reason === "nostalgia_energy_valence_conflict" || reason === "nostalgia_release_year_conflict") {
    score *= 0.55;
  }

  return clamp01(score);
}

export function rankCandidatesByIntentVector<T extends IntentCollapseTrack>(
  tracks: T[],
  intent: EditorialIntentVector,
  fingerprintBias?: Map<string, number>,
): Array<{ track: T; score: number }> {
  return tracks
    .map((track) => {
      let score = scoreEditorialIntentMatch(track, intent);
      const bias = fingerprintBias?.get(track.trackId);
      if (bias != null) score = clamp01(score * 0.85 + bias * 0.15);
      return { track, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}

export type RankedCandidateSelection<T extends IntentCollapseTrack> = {
  selected: T[];
  scores: Map<string, number>;
  avgScore: number;
  minScoreUsed: number;
  rankedTotal: number;
};

export function selectRankedCandidatesForSampler<T extends IntentCollapseTrack>(
  tracks: T[],
  intent: EditorialIntentVector,
  opts: {
    targetCount: number;
    strictMode: boolean;
    fingerprintBias?: Map<string, number>;
  },
): RankedCandidateSelection<T> {
  const minPool = minimumIntentPoolSize(opts.targetCount, opts.strictMode);
  // Broad combinatorial pool for sampler — not "best N" truncation (cap 300).
  const maxPool = Math.min(
    tracks.length,
    Math.max(minPool * 3, Math.ceil(opts.targetCount * 12)),
    300,
  );
  const ranked = rankCandidatesByIntentVector(tracks, intent, opts.fingerprintBias);

  let floor = opts.strictMode ? 0.28 : 0.22;
  let viable = ranked.filter((row) => row.score >= floor);
  while (viable.length < minPool && floor > 0.12) {
    floor -= 0.04;
    viable = ranked.filter((row) => row.score >= floor);
  }

  let chosen = viable.slice(0, maxPool);
  if (chosen.length < minPool) {
    const chosenIds = new Set(chosen.map((row) => row.track.trackId));
    for (const row of ranked) {
      if (chosen.length >= Math.min(minPool, maxPool)) break;
      if (!chosenIds.has(row.track.trackId)) {
        chosen.push(row);
        chosenIds.add(row.track.trackId);
      }
    }
  }
  const scores = new Map(chosen.map((row) => [row.track.trackId, row.score]));
  const avgScore = chosen.length > 0
    ? chosen.reduce((sum, row) => sum + row.score, 0) / chosen.length
    : 0;

  return {
    selected: chosen.map((row) => row.track),
    scores,
    avgScore,
    minScoreUsed: floor,
    rankedTotal: ranked.length,
  };
}

export function trackPassesOpeningIntentScore(
  track: IntentCollapseTrack,
  intent: EditorialIntentVector,
): boolean {
  return scoreEditorialIntentMatch(track, intent) >= OPENING_INTENT_SCORE_FLOOR;
}

function buildProvisionalIntent(
  world: EditorialWorldDefinition,
  primaryMood: string,
  sceneType: SceneType,
  opts: {
    lockedIntent: LockedIntent;
    profile: EmotionProfile;
  },
): EditorialIntentVector {
  const promptEnergyRange = energyRangeForIntent(opts.lockedIntent, opts.profile);
  const energyRange: [number, number] = [
    Math.max(world.energyRange[0], promptEnergyRange[0]),
    Math.min(world.energyRange[1], promptEnergyRange[1]),
  ];
  const safeEnergyRange: [number, number] = energyRange[0] <= energyRange[1]
    ? energyRange
    : world.energyRange;
  return {
    primaryMood,
    energyRange: safeEnergyRange,
    valenceTarget: opts.lockedIntent.mood.length > 0
      ? valenceToSigned(opts.profile.valence) * 0.55 + world.valenceTarget * 0.45
      : world.valenceTarget,
    rhythmDensityCap: world.rhythmDensityCap,
    vocalPresenceTarget: world.vocalPresenceTarget,
    nostalgiaBias: clamp01(opts.profile.nostalgia * 0.55 + world.nostalgiaBias * 0.45),
    sonicAggressionCeiling: world.sonicAggressionCeiling,
    sceneType,
    editorialWorldTag: world.tag,
    allowedMicroClusters: [...world.allowedMicroClusters],
  };
}

function semanticWorldScore(
  world: EditorialWorldDefinition,
  opts: {
    vibe: string;
    lockedIntent: LockedIntent;
    primaryMood: string;
    sceneType: SceneType;
    strictMode?: boolean;
  },
): number {
  const lower = opts.vibe.toLowerCase();
  let score = world.cohesionScore * 0.45;
  if (world.moods.includes(opts.primaryMood)) score += 0.18;
  if (world.sceneTypes.includes(opts.sceneType)) score += 0.16;
  for (const tag of world.narrativeTags) {
    if (lower.includes(tag.replace(/-/g, " ")) || lower.includes(tag)) score += 0.08;
  }
  if (opts.lockedIntent.genreFamilies.length > 0) {
    const overlap = opts.lockedIntent.genreFamilies.filter((family) =>
      world.primaryFamilies.includes(getGenreFamily(family)),
    ).length;
    score += overlap * 0.12;
  }
  if (opts.strictMode && world.primaryFamilies.length === 1) score += 0.04;
  return score;
}

function clusterDensityForMatches(matches: IntentCollapseTrack[]): number {
  if (matches.length === 0) return 0;
  const micros = new Set(matches.map((track) => trackMicroCluster(track)));
  return micros.size / Math.max(1, Math.min(6, matches.length));
}

export function scoreWorldLibraryFit(
  world: EditorialWorldDefinition,
  tracks: IntentCollapseTrack[],
  opts: {
    lockedIntent: LockedIntent;
    profile: EmotionProfile;
    primaryMood: string;
    sceneType: SceneType;
    targetCount: number;
    strictMode?: boolean;
  },
): {
  candidateCount: number;
  clusterDensity: number;
  cohesion: number;
  libraryScore: number;
  meetsMinimum: boolean;
} {
  const intent = buildProvisionalIntent(world, opts.primaryMood, opts.sceneType, opts);
  const calibrated = calibrateIntentVectorForRetrievalPool(tracks, intent, {
    targetCount: opts.targetCount,
    strictMode: opts.strictMode,
  });
  const ranked = selectRankedCandidatesForSampler(tracks, calibrated, {
    targetCount: opts.targetCount,
    strictMode: opts.strictMode === true,
  });
  const matches = ranked.selected;
  const minPool = minimumIntentPoolSize(opts.targetCount, opts.strictMode === true);
  const density = clusterDensityForMatches(matches);
  const libraryScore = clamp01((matches.length / minPool) * 0.65 + density * 0.35);
  return {
    candidateCount: matches.length,
    clusterDensity: density,
    cohesion: world.cohesionScore,
    libraryScore,
    meetsMinimum: matches.length >= minPool,
  };
}

export function selectEditorialWorld(opts: {
  vibe: string;
  lockedIntent: LockedIntent;
  profile: EmotionProfile;
  primaryMood: string;
  sceneType: SceneType;
  strictMode?: boolean;
  libraryTracks?: IntentCollapseTrack[];
  targetCount?: number;
  sceneArchetypeId?: string | null;
}): EditorialWorldDefinition {
  const ranked = EDITORIAL_WORLDS.map((world) => ({
    world,
    semantic: semanticWorldScore(world, opts),
  })).sort((a, b) =>
    b.semantic - a.semantic ||
    b.world.cohesionScore - a.world.cohesionScore,
  );

  let candidatePool = ranked;
  if (opts.sceneArchetypeId) {
    const preferredTag = ARCHETYPE_PREFERRED_WORLD[opts.sceneArchetypeId];
    if (preferredTag) {
      const preferredWorld = EDITORIAL_WORLDS.find((row) => row.tag === preferredTag);
      if (preferredWorld) {
        return preferredWorld;
      }
    }
    const compatibleTags = new Set(editorialWorldTagsCompatibleWithArchetype(opts.sceneArchetypeId));
    if (preferredTag) compatibleTags.add(preferredTag);
    const compatible = ranked.filter((row) => compatibleTags.has(row.world.tag));
    if (compatible.length > 0) candidatePool = compatible;
  }

  if (!opts.libraryTracks?.length) {
    return candidatePool[0]!.world;
  }

  const targetCount = opts.targetCount ?? 25;
  const withLibrary = candidatePool.map((row) => {
    const fit = scoreWorldLibraryFit(row.world, opts.libraryTracks!, {
      lockedIntent: opts.lockedIntent,
      profile: opts.profile,
      primaryMood: opts.primaryMood,
      sceneType: opts.sceneType,
      targetCount,
      strictMode: opts.strictMode,
    });
    return { ...row, fit };
  });

  const preferredTag = opts.sceneArchetypeId
    ? ARCHETYPE_PREFERRED_WORLD[opts.sceneArchetypeId]
    : null;
  const preferredRow = preferredTag
    ? withLibrary.find((row) => row.world.tag === preferredTag)
    : null;

  const viable = withLibrary.filter((row) => row.fit.meetsMinimum);
  if (viable.length > 0) {
    if (preferredRow && viable.some((row) => row.world.tag === preferredRow.world.tag)) {
      const preferredViable = viable.find((row) => row.world.tag === preferredRow.world.tag)!;
      return preferredViable.world;
    }
    viable.sort((a, b) =>
      b.fit.libraryScore - a.fit.libraryScore ||
      b.world.cohesionScore - a.world.cohesionScore ||
      b.semantic - a.semantic,
    );
    return viable[0]!.world;
  }

  withLibrary.sort((a, b) =>
    b.fit.candidateCount - a.fit.candidateCount ||
    b.fit.libraryScore - a.fit.libraryScore ||
    b.world.cohesionScore - a.world.cohesionScore ||
    b.semantic - a.semantic,
  );
  const withCandidates = withLibrary.filter((row) => row.fit.candidateCount > 0);
  if (withCandidates.length > 0) return withCandidates[0]!.world;

  if (opts.sceneArchetypeId) {
    const preferredTag = ARCHETYPE_PREFERRED_WORLD[opts.sceneArchetypeId];
    const preferredInPool = preferredTag
      ? candidatePool.find((row) => row.world.tag === preferredTag)
      : null;
    if (preferredInPool) return preferredInPool.world;
    if (candidatePool.length > 0) return candidatePool[0]!.world;
  }

  return withLibrary[0]!.world;
}

export function editorialWorldTagsCompatibleWithArchetype(archetypeId: string): string[] {
  const tags: string[] = [];
  for (const [worldTag, archetypes] of Object.entries(EDITORIAL_WORLD_ARCHETYPE_COMPAT)) {
    if (archetypes.includes(archetypeId)) tags.push(worldTag);
  }
  return tags;
}

/** Preferred 1:1 editorial world when scene archetype is already locked. */
const ARCHETYPE_PREFERRED_WORLD: Record<string, string> = {
  indie_pop_sunshine_commute: "indie_pop_sunshine_commute",
  upbeat_alt_morning_drive: "upbeat_pop_commute",
  modern_feelgood_pop: "indie_pop_sunshine_commute",
  indie_folk_rain_walk: "indie_folk_rain_walk",
  mellow_alt_stroll: "indie_folk_rain_walk",
  soft_indie_morning: "soft_indie_morning",
  light_pop_sunday: "emotional_alt_pop",
  late_night_indie: "late_night_indie_interior",
  nocturnal_alt: "late_night_indie_interior",
  ambient_focus_study: "focus_study",
  sunset_indie_drive: "sunset_indie_drive",
  gym_confidence_boost: "gym_boost",
  balanced_scene_default: "indie_balanced_default",
  indie_balanced_default: "indie_balanced_default",
};

export function isEditorialWorldCompatibleWithArchetype(
  editorialWorldTag: string,
  archetypeId: string | null | undefined,
): boolean {
  if (!archetypeId) return true;
  const allowed = EDITORIAL_WORLD_ARCHETYPE_COMPAT[editorialWorldTag];
  if (!allowed) return true;
  return allowed.includes(archetypeId);
}

export function realignEditorialIntentWorldForArchetype(
  intent: EditorialIntentVector,
  archetypeId: string,
): EditorialIntentVector | null {
  const preferredTag = ARCHETYPE_PREFERRED_WORLD[archetypeId];
  if (!preferredTag) return null;
  const world = EDITORIAL_WORLDS.find((row) => row.tag === preferredTag);
  if (!world) return null;
  const energyRange: [number, number] = [
    Math.max(intent.energyRange[0], world.energyRange[0]),
    Math.min(intent.energyRange[1], world.energyRange[1]),
  ];
  return {
    ...intent,
    editorialWorldTag: world.tag,
    energyRange: energyRange[0] <= energyRange[1] ? energyRange : world.energyRange,
    rhythmDensityCap: world.rhythmDensityCap,
    vocalPresenceTarget: world.vocalPresenceTarget,
    nostalgiaBias: clamp01(intent.nostalgiaBias * 0.5 + world.nostalgiaBias * 0.5),
    sonicAggressionCeiling: world.sonicAggressionCeiling,
    allowedMicroClusters: [...world.allowedMicroClusters],
  };
}

export function selectEditorialWorldForDominantGenres(
  dominantGenres: string[],
): EditorialWorldDefinition | null {
  const families = new Set(
    dominantGenres.map((g) => getGenreFamily(g)).filter((f) => f !== "unknown"),
  );
  if (families.size === 0) return null;
  let best: EditorialWorldDefinition | null = null;
  let bestHits = 0;
  for (const world of EDITORIAL_WORLDS) {
    const hits = world.primaryFamilies.filter((f) => families.has(f)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = world;
    }
  }
  return bestHits > 0 ? best : null;
}

export function realignEditorialIntentForDominantGenres(
  intent: EditorialIntentVector,
  dominantGenres: string[],
): EditorialIntentVector | null {
  const world = selectEditorialWorldForDominantGenres(dominantGenres);
  if (!world) return null;
  return {
    ...intent,
    editorialWorldTag: world.tag,
    allowedMicroClusters: [...new Set([...intent.allowedMicroClusters, ...world.allowedMicroClusters])],
    relaxGenreFamilyFilter: intent.relaxGenreFamilyFilter || dominantGenres.length > 0,
  };
}

export function validateEditorialSceneWorldAlignment(
  editorialWorldTag: string,
  archetypeId: string | null | undefined,
): { aligned: boolean; reason: string | null } {
  if (!archetypeId) {
    return { aligned: true, reason: null };
  }
  if (isEditorialWorldCompatibleWithArchetype(editorialWorldTag, archetypeId)) {
    return { aligned: true, reason: null };
  }
  return {
    aligned: false,
    reason: `editorial_world:${editorialWorldTag} incompatible_with_archetype:${archetypeId}`,
  };
}

export function validateDominantClusterAlignment(
  editorialWorldTag: string,
  dominantClusterLabel: string | null | undefined,
  dominantGenres?: string[] | null,
): { aligned: boolean; reason: string | null } {
  if (!dominantClusterLabel && (!dominantGenres || dominantGenres.length === 0)) {
    return { aligned: true, reason: null };
  }
  const world = EDITORIAL_WORLDS.find((row) => row.tag === editorialWorldTag);
  if (!world) {
    return { aligned: true, reason: null };
  }
  const genreFamilies = new Set(
    (dominantGenres ?? [])
      .map((genre) => getGenreFamily(genre))
      .filter((family) => family !== "unknown"),
  );
  if (genreFamilies.size > 0) {
    const genreHit = world.primaryFamilies.some((family) => genreFamilies.has(family));
    if (genreHit) return { aligned: true, reason: null };
  }
  const lower = (dominantClusterLabel ?? "").toLowerCase();
  const familyHit = world.primaryFamilies.some((family) =>
    lower.includes(family.replace(/_/g, " ")) || lower.includes(family),
  );
  if (familyHit) {
    return { aligned: true, reason: null };
  }
  return {
    aligned: false,
    reason: `editorial_world:${editorialWorldTag} incompatible_with_dominant_cluster:${dominantClusterLabel ?? dominantGenres?.join(",")}`,
  };
}

export function collapseIntent(opts: {
  vibe: string;
  lockedIntent: LockedIntent;
  profile: EmotionProfile;
  seed?: number | string | null;
  strictMode?: boolean;
  libraryTracks?: IntentCollapseTrack[];
  targetCount?: number;
  sceneArchetypeId?: string | null;
}): {
  intent: EditorialIntentVector;
  collapseConfidenceScore: number;
  libraryFit: ReturnType<typeof scoreWorldLibraryFit> | null;
} {
  const primaryMood = detectPrimaryMood(opts.vibe, opts.lockedIntent, opts.profile);
  const sceneType = detectSceneType(opts.vibe, opts.lockedIntent, opts.profile);
  const world = selectEditorialWorld({
    vibe: opts.vibe,
    lockedIntent: opts.lockedIntent,
    profile: opts.profile,
    primaryMood,
    sceneType,
    strictMode: opts.strictMode,
    libraryTracks: opts.libraryTracks,
    targetCount: opts.targetCount,
    sceneArchetypeId: opts.sceneArchetypeId,
  });

  const intent = buildProvisionalIntent(world, primaryMood, sceneType, opts);
  const libraryFit = opts.libraryTracks?.length
    ? scoreWorldLibraryFit(world, opts.libraryTracks, {
      lockedIntent: opts.lockedIntent,
      profile: opts.profile,
      primaryMood,
      sceneType,
      targetCount: opts.targetCount ?? 25,
      strictMode: opts.strictMode,
    })
    : null;

  const lower = opts.vibe.toLowerCase();
  let confidence = 0.55;
  if (world.moods.includes(primaryMood)) confidence += 0.15;
  if (world.sceneTypes.includes(sceneType)) confidence += 0.12;
  if (world.narrativeTags.some((tag) => lower.includes(tag))) confidence += 0.12;
  confidence += world.cohesionScore * 0.12;
  if (libraryFit?.meetsMinimum) confidence += 0.08;

  return { intent, collapseConfidenceScore: clamp01(confidence), libraryFit };
}

export function diagnoseIntentFilterRejectionReason(
  track: IntentCollapseTrack,
  intent: EditorialIntentVector,
): IntentFilterRejectionReason {
  const family = trackFamily(track);
  const world = EDITORIAL_WORLDS.find((row) => row.tag === intent.editorialWorldTag);
  if (!intent.relaxGenreFamilyFilter && (!world || !world.primaryFamilies.includes(family))) {
    return "genre_family_not_allowed";
  }

  if (hasFeature(track.energy)) {
    const energy = feature(track.energy);
    if (energy < intent.energyRange[0] || energy > intent.energyRange[1]) return "energy_out_of_range";
    if (intent.nostalgiaBias >= 0.55) {
      const valence = hasFeature(track.valence)
        ? valenceToSigned(feature(track.valence))
        : null;
      if (energy > 0.78 && valence != null && valence > 0.45) return "nostalgia_energy_valence_conflict";
      const year = track.releaseYear;
      if (typeof year === "number" && year > 2022 && energy > 0.72) return "nostalgia_release_year_conflict";
    }
  }

  const valenceSlack = intent.valenceMaxDeviation ?? 0.25;
  if (hasFeature(track.valence)) {
    const valence = valenceToSigned(feature(track.valence));
    if (Math.abs(valence - intent.valenceTarget) > valenceSlack) return "valence_out_of_range";
  }

  if (hasFeature(track.danceability) || hasFeature(track.tempo)) {
    if (rhythmDensity(track) > intent.rhythmDensityCap + 0.04) return "rhythm_density_cap";
  }

  if (hasFeature(track.energy) || hasFeature(track.acousticness) || hasFeature(track.danceability)) {
    if (sonicAggression(track) > intent.sonicAggressionCeiling + 0.04) return "aggression_cap";
  }

  const micro = trackMicroCluster(track);
  if (!intent.allowedMicroClusters.includes(micro)) return "micro_cluster_not_allowed";

  return "passed";
}

export function diagnoseIntentFilterRejectionCounts(
  tracks: IntentCollapseTrack[],
  intent: EditorialIntentVector,
): Record<IntentFilterRejectionReason, number> {
  const counts: Record<IntentFilterRejectionReason, number> = {
    genre_family_not_allowed: 0,
    energy_out_of_range: 0,
    valence_out_of_range: 0,
    nostalgia_energy_valence_conflict: 0,
    nostalgia_release_year_conflict: 0,
    rhythm_density_cap: 0,
    aggression_cap: 0,
    micro_cluster_not_allowed: 0,
    passed: 0,
  };
  for (const track of tracks) {
    const reason = diagnoseIntentFilterRejectionReason(track, intent);
    counts[reason] += 1;
  }
  return counts;
}

export function trackMatchesEditorialIntent(
  track: IntentCollapseTrack,
  intent: EditorialIntentVector,
): boolean {
  return diagnoseIntentFilterRejectionReason(track, intent) === "passed";
}

export function filterCandidatesByIntentVector<T extends IntentCollapseTrack>(
  tracks: T[],
  intent: EditorialIntentVector,
): T[] {
  return tracks.filter((track) => trackMatchesEditorialIntent(track, intent));
}

/**
 * Adapt editorial intent micro-clusters and energy band to the retrieved library
 * so hard-filter does not zero a viable scene-coherent pool.
 */
export function calibrateIntentVectorForRetrievalPool<T extends IntentCollapseTrack>(
  tracks: T[],
  intent: EditorialIntentVector,
  opts?: { targetCount?: number; strictMode?: boolean },
): EditorialIntentVector {
  const world = EDITORIAL_WORLDS.find((row) => row.tag === intent.editorialWorldTag);
  if (!world || tracks.length === 0) return intent;

  const familyMatched = tracks.filter((track) => world.primaryFamilies.includes(trackFamily(track)));
  const calibrationPool = familyMatched.length > 0 ? familyMatched : tracks;

  const microCounts = new Map<string, number>();
  const energies: number[] = [];
  const valences: number[] = [];
  for (const track of calibrationPool) {
    const micro = trackMicroCluster(track);
    microCounts.set(micro, (microCounts.get(micro) ?? 0) + 1);
    if (hasFeature(track.energy)) energies.push(feature(track.energy));
    if (hasFeature(track.valence)) valences.push(valenceToSigned(feature(track.valence)));
  }

  const topMicros = [...microCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([micro]) => micro)
    .filter((micro) => {
      const family = micro.split(":")[0] ?? "";
      return world.primaryFamilies.includes(family);
    });
  const poolMicros = [...microCounts.keys()].filter((micro) => {
    if (intent.relaxGenreFamilyFilter) return true;
    const family = micro.split(":")[0] ?? "";
    return world.primaryFamilies.includes(family);
  });
  const allowedMicroClusters = [...new Set([...intent.allowedMicroClusters, ...topMicros])];

  let energyRange = intent.energyRange;
  if (energies.length >= 8) {
    const sorted = [...energies].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.10)] ?? sorted[0]!;
    const p90 = sorted[Math.floor(sorted.length * 0.90)] ?? sorted[sorted.length - 1]!;
    let lo = clamp01(Math.max(world.energyRange[0], p10 - 0.03));
    let hi = clamp01(Math.min(world.energyRange[1], p90 + 0.03));
    if (lo > hi || p10 > world.energyRange[1] || p90 < world.energyRange[0]) {
      lo = clamp01(p10 - 0.04);
      hi = clamp01(p90 + 0.04);
    }
    if (hi - lo < 0.14) {
      const mid = (lo + hi) / 2;
      lo = clamp01(mid - 0.07);
      hi = clamp01(mid + 0.07);
    }
    energyRange = [lo, hi];
  }

  let valenceTarget = intent.valenceTarget;
  if (valences.length >= 8) {
    const sorted = [...valences].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)] ?? intent.valenceTarget;
    valenceTarget = mid * 0.65 + intent.valenceTarget * 0.35;
  }

  let calibrated: EditorialIntentVector = {
    ...intent,
    allowedMicroClusters,
    energyRange,
    valenceTarget,
  };

  const minSurvival = minimumIntentPoolSize(opts?.targetCount ?? 25, opts?.strictMode === true);
  const maxRelaxPasses = 6;
  for (let pass = 0; pass < maxRelaxPasses && countIntentFilterSurvivors(tracks, calibrated, opts?.strictMode === true) < minSurvival; pass += 1) {
    const counts = diagnoseIntentFilterRejectionCounts(tracks, calibrated);
    const dominant = dominantFilterRejectionReason(counts);
    if (!dominant) break;

    switch (dominant) {
      case "valence_out_of_range": {
        const nextDeviation = (calibrated.valenceMaxDeviation ?? 0.25) + 0.1;
        if (nextDeviation > 0.6) return calibrated;
        calibrated = { ...calibrated, valenceMaxDeviation: nextDeviation };
        break;
      }
      case "micro_cluster_not_allowed":
        calibrated = {
          ...calibrated,
          allowedMicroClusters: [...new Set([...calibrated.allowedMicroClusters, ...poolMicros])],
        };
        break;
      case "energy_out_of_range": {
        if (energies.length < 4) return calibrated;
        const sorted = [...energies].sort((a, b) => a - b);
        const lo = clamp01(sorted[0]! - 0.05);
        const hi = clamp01(sorted[sorted.length - 1]! + 0.05);
        calibrated = {
          ...calibrated,
          energyRange: [
            Math.min(lo, calibrated.energyRange[0]),
            Math.max(hi, calibrated.energyRange[1]),
          ],
        };
        break;
      }
      case "rhythm_density_cap":
        calibrated = {
          ...calibrated,
          rhythmDensityCap: clamp01(calibrated.rhythmDensityCap + 0.08),
        };
        break;
      case "aggression_cap":
        calibrated = {
          ...calibrated,
          sonicAggressionCeiling: clamp01(calibrated.sonicAggressionCeiling + 0.08),
        };
        break;
      case "genre_family_not_allowed":
        if (countIntentFilterSurvivors(tracks, calibrated, opts?.strictMode === true) < minSurvival) {
          calibrated = { ...calibrated, relaxGenreFamilyFilter: true };
          break;
        }
        return calibrated;
      default:
        return calibrated;
    }
  }

  return calibrated;
}

export function minimumIntentPoolSize(targetCount: number, strictMode: boolean): number {
  const base = Math.max(10, targetCount);
  return strictMode ? Math.max(25, base * 2) : Math.max(18, Math.ceil(base * 1.5));
}

export function buildIntentCollapseDiagnostics(
  intent: EditorialIntentVector,
  collapseConfidenceScore: number,
  preFilterCount: number,
  postFilterCount: number,
  tracksForRejection?: IntentCollapseTrack[],
): IntentCollapseDiagnostics {
  const rejectionCounts = tracksForRejection?.length
    ? diagnoseIntentFilterRejectionCounts(tracksForRejection, intent)
    : undefined;
  return {
    primaryMood: intent.primaryMood,
    editorialWorldTag: intent.editorialWorldTag,
    energyRange: intent.energyRange,
    rhythmDensityCap: intent.rhythmDensityCap,
    allowedMicroClusters: intent.allowedMicroClusters,
    collapseConfidenceScore,
    preFilterCount,
    postFilterCount,
    filterRejectionCounts: rejectionCounts,
    dominantFilterRejection: rejectionCounts
      ? dominantFilterRejectionReason(rejectionCounts)
      : null,
    valenceMaxDeviation: intent.valenceMaxDeviation,
    relaxGenreFamilyFilter: intent.relaxGenreFamilyFilter,
  };
}

export type SamplerIntentContext = {
  intentVector: EditorialIntentVector;
};

export function buildSamplerIntentContext(intent: EditorialIntentVector): SamplerIntentContext {
  return { intentVector: intent };
}

export function reinforceOpeningEditorialWorldLock<T extends IntentCollapseTrack>(opts: {
  sampledLanes: Array<{ laneId: string; tracks: T[] }>;
  intent: EditorialIntentVector;
  openingSize?: number;
}): {
  sampledLanes: Array<{ laneId: string; tracks: T[] }>;
  openingEligibleCount: number;
  sufficient: boolean;
} {
  const openingSize = opts.openingSize ?? 10;
  const filteredLanes = opts.sampledLanes.map((lane) => ({
    laneId: lane.laneId,
    tracks: lane.tracks.filter((track) => trackPassesOpeningIntentScore(track, opts.intent)),
  }));
  const pooled = filteredLanes.flatMap((lane) => lane.tracks);
  const openingEligibleCount = pooled.length;
  const sufficient = openingEligibleCount >= openingSize;
  return {
    sampledLanes: sufficient ? filteredLanes : opts.sampledLanes,
    openingEligibleCount,
    sufficient,
  };
}
