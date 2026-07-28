/**
 * Candidate retrieval pipeline — prompt-first multi-source pool assembly before hybrid scoring.
 * Retrieval is independent of scoring weights; it shapes WHO enters the pool, not HOW they rank.
 */

import type { EmotionProfile } from "./emotion";
import {
  activityOpeningBoost,
  resolveActivityProfile,
  scoreActivityCandidateFit,
  trackFailsActivityHardGate,
  type ActivityClassificationInput,
  type ActivityIntentInput,
  type ActivityProfile,
  type ActivityTrackInput,
} from "./activity-profiles";
import { inferWorldIdentityIdsFromPrompt } from "../core/editorial/world-identity-gate";
import { resolveCommittedWorld } from "../core/committed-world";
import {
  detectUkHipHopScene,
  ukHipHopRetrievalBoost,
  ukHipHopSceneLockProfile,
  type UkHipHopScene,
} from "./uk-hip-hop-scene";
import {
  buildPromptSonicTarget,
  buildSonicTasteProfile,
  scoreTrackSonicPromptFit,
  type PromptSonicTarget,
  type SonicTasteProfile,
} from "./sonic-taste-profile";
import type { LibrarySignals } from "./library-signals";
import {
  buildRediscoveryRetrievalInput,
  penalizeFrequentFavourite,
  scoreForgottenFavourite,
  scoreSonicMatchCandidate,
} from "./rediscovery-retrieval";
import {
  isCompoundPrompt,
  parseCompoundPromptConstraints,
  scoreCompoundPromptFit,
} from "./compound-prompt-retrieval";
import { applyRetrievalTrackCooldown } from "./playlist-freshness";
import { OPENER_FILLER_PATTERN } from "../core/editorial/opener-hygiene";
import { isSafetyBlanketOutsideWorld } from "../core/editorial/world-identity-gate";

export type RetrievalSourceId =
  | "activity_match"
  | "emotional_match"
  | "genre_match"
  | "favourite_artists"
  | "exploratory"
  | "forgotten_favourites"
  | "sonic_match";

export type RetrievalStrategyId =
  | "A_liked_only"
  | "B_liked_exploratory"
  | "C_hybrid"
  | "D_spotify_catalogue";

export type RetrievalActivityId =
  | "focus_coding"
  | "study"
  | "gym"
  | "party_pregame"
  | "driving"
  | "cleaning"
  | "cooking"
  | null;

export type RetrievalProfile = {
  activity: RetrievalActivityId;
  activityConfidence: number;
  sceneTags: string[];
  sceneConfidence: number;
  emotionalIntent: string[];
  genreExpectations: string[];
  genreConfidence: number;
  activityProfile: ActivityProfile | null;
  libraryGravityWeight: number;
  highConfidenceActivity: boolean;
  sourceQuotas: Record<RetrievalSourceId, number>;
  dominantLibraryFamilies: string[];
  ukHipHopScene: UkHipHopScene | null;
  committedWorldId: string | null;
};

export type RetrievalTrackInput = ActivityTrackInput & {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  releaseYear?: number | null;
};

export type RetrievalRejectedCandidate = {
  trackId: string;
  artistName: string;
  trackName: string;
  reason: string;
  source: RetrievalSourceId | "prefilter";
};

export type RetrievalDiagnostics = {
  applied: boolean;
  pipeline: "multi_source_retrieval";
  inputCount: number;
  outputCount: number;
  cap: number;
  profile: {
    activity: RetrievalActivityId;
    activityConfidence: number;
    sceneTags: string[];
    sceneConfidence: number;
    emotionalIntent: string[];
    genreExpectations: string[];
    genreConfidence: number;
    libraryGravityWeight: number;
    highConfidenceActivity: boolean;
    activityProfileId: string | null;
  };
  sourceDistribution: Record<RetrievalSourceId, number>;
  sourceQuotaPct: Record<RetrievalSourceId, number>;
  openingCandidatesReserved: number;
  dominantLibraryFamilies: string[];
  libraryGravityShare: number;
  diversityIndex: number;
  topRejected: RetrievalRejectedCandidate[];
  strategyId?: RetrievalStrategyId;
  compoundPrompt?: boolean;
  compoundDimensions?: number;
};

export type RetrieveScoringCandidatesOpts<T extends RetrievalTrackInput> = {
  tracks: T[];
  vibe: string;
  intent: ActivityIntentInput & {
    genreFamilies?: string[];
    primaryGenres?: string[];
    primaryGenre?: string | null;
    mood?: string[];
  };
  emotionProfile: EmotionProfile;
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>;
  sessionMemory?: {
    artistFrequencyMap?: Record<string, number>;
    usedTracks?: Set<string>;
  };
  recentTrackPenalty?: Map<string, number>;
  librarySignals?: LibrarySignals;
  sonicTasteProfile?: SonicTasteProfile | null;
  requestedLength: number;
  sceneActive?: boolean;
  debugRetrieval?: boolean;
  passesHardGate?: (track: T) => boolean;
  retrievalOverrides?: {
    strategyId?: RetrievalStrategyId;
    libraryGravityWeight?: number;
    exploratoryQuotaBoost?: number;
    sourceQuotas?: Record<RetrievalSourceId, number>;
  };
  /** Committed world ids — penalize psych-indie opener fillers outside natural worlds. */
  activeWorldIds?: string[];
};

const SCENE_PATTERNS: Array<{ tag: string; pattern: RegExp; weight: number }> = [
  { tag: "driving", pattern: /\b(?:driv|road|motorway|highway|commute|windows.?down)\b/i, weight: 0.82 },
  { tag: "night", pattern: /\b(?:night|late.?night|midnight|after.?dark)\b/i, weight: 0.78 },
  { tag: "morning", pattern: /\b(?:morning|sunrise|wake.?up|breakfast)\b/i, weight: 0.74 },
  { tag: "rain", pattern: /\b(?:rain|rainy|wet|storm)\b/i, weight: 0.76 },
  { tag: "garden", pattern: /\b(?:garden|outdoor|sunlight|picnic|backyard)\b/i, weight: 0.8 },
  { tag: "summer", pattern: /\b(?:summer|end of summer|late summer)\b/i, weight: 0.76 },
  { tag: "party", pattern: /\b(?:party|pregame|going\s+out|club|dance)\b/i, weight: 0.8 },
  { tag: "focus", pattern: /\b(?:focus|coding|deep\s+work|study|concentrat)\b/i, weight: 0.8 },
  { tag: "gym", pattern: /\b(?:gym|workout|training|cardio|lifting|\blift\b)\b/i, weight: 0.84 },
  { tag: "cleaning", pattern: /\b(?:clean|cleaning|chores|tidy|housework)\b/i, weight: 0.72 },
  { tag: "cooking", pattern: /\b(?:cook|cooking|kitchen|meal\s+prep|dinner\s+prep)\b/i, weight: 0.7 },
  { tag: "chill", pattern: /\b(?:chill|relax|calm|cozy|soft)\b/i, weight: 0.68 },
];

const GENRE_HINT_PATTERNS: Array<{ family: string; pattern: RegExp }> = [
  { family: "electronic", pattern: /\b(?:electronic|ambient|idm|edm|house|techno|downtempo)\b/i },
  { family: "pop", pattern: /\b(?:pop|mainstream|chart|radio|singalong|banger)\b/i },
  { family: "hip_hop", pattern: /\b(?:hip.?hop|rap|trap|drill)\b/i },
  { family: "indie", pattern: /\b(?:indie|alternative|alt)\b/i },
  { family: "folk", pattern: /\b(?:folk|acoustic|singer.?songwriter)\b/i },
  { family: "rock", pattern: /\b(?:rock|grunge|punk|pop\s*punk|metal|hardcore)\b/i },
  { family: "electronic", pattern: /\b(?:disco|funk|nu\s*disco)\b/i },
  { family: "electronic", pattern: /\blo-?fi\b|\bchillhop\b|\bstudy\s+beats?\b/i },
  { family: "soul", pattern: /\b(?:soul|r&b|rnb|funk)\b/i },
  { family: "jazz", pattern: /\b(?:jazz|bossa|swing)\b/i },
  { family: "hip_hop", pattern: /\b(?:grime|ukg|uk\s+garage|uk\s+rap|uk\s+drill|road\s+rap)\b/i },
  { family: "electronic", pattern: /\b(?:ukg|uk\s+garage|2-?step|speed\s+garage|bassline)\b/i },
];

const COMMITTED_WORLD_RETRIEVAL_IDS = [
  "upbeat_chore_world",
  "feel_good_world",
  "party_prep_world",
  "gym_energy_world",
  "classic_rock_world",
  "yacht_rock_world",
  "dad_secret_world",
  "rainy_drive_world",
  "night_drive_world",
  "melancholy_drive",
  "evening_drive_world",
  "disco_party_world",
  "chill_rainy_world",
  "goth_world",
  "grunge_world",
  "pop_punk_world",
  "gym_rock_world",
  "angry_rock_world",
  "lofi_world",
  "focus_study_world",
] as const;

const COMMITTED_WORLD_GENRE_FAMILIES: Record<string, string[]> = {
  upbeat_chore_world: ["pop", "electronic", "disco", "funk", "hip_hop"],
  feel_good_world: ["pop", "soul", "funk", "disco", "rnb"],
  party_prep_world: ["pop", "electronic", "disco", "hip_hop", "soul"],
  gym_energy_world: ["hip_hop", "electronic", "pop", "rock", "metal"],
  classic_rock_world: ["rock"],
  yacht_rock_world: ["rock", "pop", "soul"],
  night_drive_world: ["indie", "electronic", "rock"],
  disco_party_world: ["soul", "pop", "electronic"],
  dad_secret_world: ["rock", "pop", "soul"],
  rainy_drive_world: ["indie", "rock", "electronic"],
  melancholy_drive: ["indie", "rock", "electronic"],
  evening_drive_world: ["indie", "electronic", "rock"],
  chill_rainy_world: ["indie", "folk"],
  goth_world: ["rock", "electronic", "indie"],
  grunge_world: ["rock"],
  pop_punk_world: ["rock", "indie"],
  gym_rock_world: ["rock", "metal"],
  angry_rock_world: ["rock", "metal"],
  lofi_world: ["indie", "electronic", "hip_hop", "jazz"],
  focus_study_world: ["electronic", "indie", "jazz"],
};

const HIGH_CONFIDENCE_QUOTAS: Record<RetrievalSourceId, number> = {
  activity_match: 0.32,
  emotional_match: 0.08,
  genre_match: 0.14,
  favourite_artists: 0.04,
  exploratory: 0.1,
  forgotten_favourites: 0.2,
  sonic_match: 0.12,
};

const BALANCED_QUOTAS: Record<RetrievalSourceId, number> = {
  activity_match: 0.16,
  emotional_match: 0.14,
  genre_match: 0.14,
  favourite_artists: 0.08,
  exploratory: 0.12,
  forgotten_favourites: 0.22,
  sonic_match: 0.14,
};

function classifyRetrievalActivity(
  vibe: string,
  intent: ActivityIntentInput,
): { activity: RetrievalActivityId; confidence: number } {
  const activityProfile = resolveActivityProfile(vibe, intent);
  if (activityProfile) {
    return { activity: activityProfile.id, confidence: 0.92 };
  }
  if (/\b(?:driv|road\s*trip|commute|motorway|highway|windows.?down)\b/i.test(vibe) || intent.activity === "driving") {
    return { activity: "driving", confidence: 0.78 };
  }
  if (/\b(?:clean|cleaning|chores|tidy|housework)\b/i.test(vibe) || intent.activity === "cleaning") {
    return { activity: "cleaning", confidence: 0.74 };
  }
  if (/\b(?:cook|cooking|kitchen|meal\s+prep|dinner\s+prep)\b/i.test(vibe) || intent.activity === "cooking") {
    return { activity: "cooking", confidence: 0.72 };
  }
  if (intent.activity) {
    const mapped = intent.activity as RetrievalActivityId;
    if (mapped) return { activity: mapped, confidence: 0.62 };
  }
  return { activity: null, confidence: 0 };
}

function detectSceneTags(vibe: string): { tags: string[]; confidence: number } {
  const hits = SCENE_PATTERNS.filter((row) => row.pattern.test(vibe));
  if (hits.length === 0) return { tags: [], confidence: 0 };
  return {
    tags: hits.map((h) => h.tag),
    confidence: Math.min(0.95, hits.reduce((max, h) => Math.max(max, h.weight), 0)),
  };
}

function detectGenreExpectations(
  vibe: string,
  intent: RetrieveScoringCandidatesOpts<RetrievalTrackInput>["intent"],
): { families: string[]; confidence: number } {
  const families = new Set<string>();
  for (const row of GENRE_HINT_PATTERNS) {
    if (row.pattern.test(vibe)) families.add(row.family);
  }
  for (const family of intent.genreFamilies ?? []) families.add(family);
  for (const genre of intent.primaryGenres ?? []) families.add(genre);
  if (intent.primaryGenre) families.add(intent.primaryGenre);
  return {
    families: [...families],
    confidence: families.size > 0 ? Math.min(0.9, 0.45 + families.size * 0.12) : 0,
  };
}

function detectEmotionalIntent(vibe: string, profile: EmotionProfile, mood: string[]): string[] {
  const tags: string[] = [...mood];
  if (profile.energy >= 0.68) tags.push("energetic");
  if (profile.energy <= 0.38) tags.push("calm");
  if (profile.valence >= 0.62) tags.push("uplifting");
  if (profile.valence <= 0.38) tags.push("melancholic");
  if (profile.calm >= 0.55) tags.push("calm");
  if (/\b(?:focus|concentrat|study)\b/i.test(vibe)) tags.push("focused");
  if (/\b(?:garden|outdoor|sunlight|afternoon in the garden)\b/i.test(vibe)) tags.push("warm", "relaxed", "outdoor");
  if (/\b(?:end of summer|summer ending)\b/i.test(vibe)) tags.push("nostalgic", "bittersweet", "warm");
  return [...new Set(tags)];
}

export function buildPromptRetrievalProfile(
  vibe: string,
  intent: RetrieveScoringCandidatesOpts<RetrievalTrackInput>["intent"],
  emotionProfile: EmotionProfile,
  dominantLibraryFamilies: string[],
): RetrievalProfile {
  const activity = classifyRetrievalActivity(vibe, intent);
  const scene = detectSceneTags(vibe);
  const genre = detectGenreExpectations(vibe, intent);
  const activityProfile = resolveActivityProfile(vibe, intent);
  const ukHipHopScene = detectUkHipHopScene(vibe);
  const committedWorld = resolveCommittedWorld({ prompt: vibe, lockedIntent: intent });
  const committedWorldId =
    committedWorld?.id ??
    inferWorldIdentityIdsFromPrompt(vibe).find((id) =>
      (COMMITTED_WORLD_RETRIEVAL_IDS as readonly string[]).includes(id),
    ) ??
    null;
  const highConfidenceActivity =
    (activity.confidence >= 0.85 && activity.activity !== null) ||
    (committedWorldId != null && activity.confidence >= 0.7);
  const libraryGravityWeight = highConfidenceActivity ? 0.12 : activity.confidence >= 0.7 ? 0.28 : 0.48;
  const sourceQuotas = highConfidenceActivity ? { ...HIGH_CONFIDENCE_QUOTAS } : { ...BALANCED_QUOTAS };
  if (genre.confidence >= 0.55 && genre.families.length > 0) {
    sourceQuotas.genre_match = Math.min(0.34, sourceQuotas.genre_match + 0.08);
    sourceQuotas.exploratory = Math.max(0.06, sourceQuotas.exploratory - 0.04);
  }
  if (ukHipHopScene?.active) {
    const ukProfile = ukHipHopSceneLockProfile(ukHipHopScene);
    genre.families = [...ukProfile.allowedGenreFamilies];
    genre.confidence = Math.max(genre.confidence, 0.88);
    sourceQuotas.genre_match = Math.min(0.42, sourceQuotas.genre_match + 0.14);
    sourceQuotas.exploratory = Math.max(0.04, sourceQuotas.exploratory - 0.08);
    sourceQuotas.forgotten_favourites = Math.max(0.08, sourceQuotas.forgotten_favourites - 0.1);
  } else if (committedWorldId) {
    sourceQuotas.genre_match = Math.min(0.38, sourceQuotas.genre_match + 0.1);
    sourceQuotas.forgotten_favourites = Math.max(0.1, sourceQuotas.forgotten_favourites - 0.08);
    sourceQuotas.exploratory = Math.max(0.05, sourceQuotas.exploratory - 0.06);
    if (genre.families.length === 0) {
      for (const family of COMMITTED_WORLD_GENRE_FAMILIES[committedWorldId] ?? []) genre.families.push(family);
      genre.confidence = Math.max(genre.confidence, 0.72);
    }
  }

  return {
    activity: activity.activity,
    activityConfidence: activity.confidence,
    sceneTags: scene.tags,
    sceneConfidence: scene.confidence,
    emotionalIntent: detectEmotionalIntent(vibe, emotionProfile, intent.mood ?? []),
    genreExpectations: genre.families,
    genreConfidence: genre.confidence,
    activityProfile,
    libraryGravityWeight,
    highConfidenceActivity,
    sourceQuotas,
    dominantLibraryFamilies,
    ukHipHopScene,
    committedWorldId,
  };
}

function classifyFor<T extends RetrievalTrackInput>(
  track: T,
  classMap: RetrieveScoringCandidatesOpts<T>["classMap"],
): ActivityClassificationInput {
  return classMap.get(track.trackId) ?? null;
}

function quickEmotionFit(track: RetrievalTrackInput, profile: EmotionProfile): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return Math.max(0, 1 - (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2);
}

function genreRetrievalFit(
  track: RetrievalTrackInput,
  classification: ActivityClassificationInput,
  retrievalProfile: RetrievalProfile,
): number {
  if (retrievalProfile.genreExpectations.length === 0) return 0.5;
  const family = classification?.genreFamily ?? "unknown";
  const primary = classification?.genrePrimary ?? "";
  const sub = classification?.primarySubgenre ?? "";
  let score = 0;
  for (const expected of retrievalProfile.genreExpectations) {
    if (family === expected || primary === expected || sub === expected) score += 0.34;
  }
  return Math.min(1, score);
}

function favouriteArtistFit(
  track: RetrievalTrackInput,
  artistCounts: Map<string, number>,
  libraryGravityWeight: number,
): number {
  const artist = track.artistName.toLowerCase().trim();
  const count = artistCounts.get(artist) ?? 0;
  if (count === 0) return 0.2;
  const raw = Math.min(1, count / 8);
  return raw * libraryGravityWeight;
}

function exploratoryFit(
  track: RetrievalTrackInput,
  classification: ActivityClassificationInput,
  retrievalProfile: RetrievalProfile,
  vibe: string,
): number {
  const family = classification?.genreFamily ?? "unknown";
  const dominantPenalty = retrievalProfile.dominantLibraryFamilies.includes(family) ? 0.22 : 0.55;
  const activityProfile = retrievalProfile.activityProfile;
  const activityFit = activityProfile
    ? scoreActivityCandidateFit(track, classification, activityProfile, vibe)
    : 0.45;
  const novelty = 1 - dominantPenalty;
  return novelty * 0.55 + activityFit * 0.45;
}

function scoreOpeningCandidate(
  track: RetrievalTrackInput,
  classification: ActivityClassificationInput,
  retrievalProfile: RetrievalProfile,
  vibe: string,
  activeWorldIds: string[] = [],
): number {
  const artist = track.artistName ?? "";
  if (
    activeWorldIds.length > 0 &&
    OPENER_FILLER_PATTERN.test(artist) &&
    isSafetyBlanketOutsideWorld(artist, activeWorldIds)
  ) {
    return -1;
  }
  if (retrievalProfile.activityProfile) {
    if (trackFailsActivityHardGate(track, classification, retrievalProfile.activityProfile, vibe)) return -1;
    return activityOpeningBoost(track, classification, retrievalProfile.activityProfile, vibe, 0);
  }
  const pop = typeof track.popularity === "number" ? Math.min(1, track.popularity / 100) : 0.45;
  const emotion = quickEmotionFit(track, { energy: 0.5, valence: 0.5, tension: 0.5, nostalgia: 0.5, calm: 0.5, environment: null, timeOfDay: null, motionState: null });
  if (retrievalProfile.activity === "party_pregame") return pop * 0.55 + (track.energy ?? 0.5) * 0.45;
  if (retrievalProfile.activity === "gym") return (track.energy ?? 0.5) * 0.65 + (track.danceability ?? 0.5) * 0.35;
  if (retrievalProfile.activity === "driving") return emotion * 0.5 + pop * 0.2 + (track.valence ?? 0.5) * 0.3;
  return emotion;
}

function dominantLibraryFamilies<T extends RetrievalTrackInput>(
  tracks: T[],
  classMap: RetrieveScoringCandidatesOpts<T>["classMap"],
  limit = 3,
): string[] {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const family = classMap.get(track.trackId)?.genreFamily ?? "unknown";
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([family]) => family);
}

function artistFrequencyMap<T extends RetrievalTrackInput>(tracks: T[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const artist = track.artistName.toLowerCase().trim();
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return counts;
}

function computeDiversityIndex(
  tracks: RetrievalTrackInput[],
  classMap: Map<string, { genreFamily: string }>,
): number {
  if (tracks.length === 0) return 0;
  const families = tracks.map((t) => classMap.get(t.trackId)?.genreFamily ?? "unknown");
  const unique = new Set(families).size;
  return unique / Math.max(1, Math.min(12, tracks.length));
}

function libraryGravityShare(
  tracks: RetrievalTrackInput[],
  dominantFamilies: string[],
  classMap: Map<string, { genreFamily: string }>,
): number {
  if (tracks.length === 0 || dominantFamilies.length === 0) return 0;
  const dominant = tracks.filter((t) =>
    dominantFamilies.includes(classMap.get(t.trackId)?.genreFamily ?? "unknown")
  ).length;
  return dominant / tracks.length;
}

function pullSourcePool<T extends RetrievalTrackInput>(
  ranked: Array<{ track: T; score: number }>,
  quota: number,
  seen: Set<string>,
): T[] {
  const out: T[] = [];
  for (const item of ranked) {
    if (out.length >= quota) break;
    if (seen.has(item.track.trackId)) continue;
    seen.add(item.track.trackId);
    out.push(item.track);
  }
  return out;
}

function applyRetrievalScoreModifiers(
  baseScore: number,
  track: RetrievalTrackInput,
  opts: {
    recentTrackPenalty?: Map<string, number>;
    sonicTieBreak?: number;
    compoundFit?: number;
    compoundActive?: boolean;
  },
): number {
  let score = baseScore;
  if (opts.compoundActive && typeof opts.compoundFit === "number") {
    score *= 0.42 + opts.compoundFit * 0.58;
  }
  score = applyRetrievalTrackCooldown(score, opts.recentTrackPenalty?.get(track.trackId));
  if (typeof opts.sonicTieBreak === "number") {
    score += opts.sonicTieBreak * 0.07;
  }
  return score;
}

export function retrieveScoringCandidates<T extends RetrievalTrackInput>(
  opts: RetrieveScoringCandidatesOpts<T>,
): { tracks: T[]; diagnostics: RetrievalDiagnostics | Record<string, unknown> } {
  const sceneActive = opts.sceneActive ?? true;
  const broadCap = sceneActive
    ? Math.max(240, opts.requestedLength * 12)
    : Math.max(900, opts.requestedLength * 35);

  if (opts.tracks.length <= broadCap && !sceneActive) {
    return {
      tracks: opts.tracks,
      diagnostics: {
        applied: false,
        pipeline: "multi_source_retrieval",
        inputCount: opts.tracks.length,
        outputCount: opts.tracks.length,
        cap: broadCap,
      },
    };
  }

  const dominantFamilies = dominantLibraryFamilies(opts.tracks, opts.classMap);
  let retrievalProfile = buildPromptRetrievalProfile(
    opts.vibe,
    opts.intent,
    opts.emotionProfile,
    dominantFamilies,
  );
  if (opts.retrievalOverrides) {
    const overrides = opts.retrievalOverrides;
    if (typeof overrides.libraryGravityWeight === "number") {
      retrievalProfile = { ...retrievalProfile, libraryGravityWeight: overrides.libraryGravityWeight };
    }
    if (overrides.sourceQuotas) {
      retrievalProfile = { ...retrievalProfile, sourceQuotas: { ...overrides.sourceQuotas } };
    }
  }
  const artistCounts = artistFrequencyMap(opts.tracks);
  const rejected: RetrievalRejectedCandidate[] = [];
  let eligible: T[] = [];

  for (const track of opts.tracks) {
    const classification = classifyFor(track, opts.classMap);
    if (opts.passesHardGate && !opts.passesHardGate(track)) {
      if (opts.debugRetrieval && rejected.length < 12) {
        rejected.push({
          trackId: track.trackId,
          artistName: track.artistName,
          trackName: track.trackName,
          reason: "constraint_prefilter",
          source: "prefilter",
        });
      }
      continue;
    }
    eligible.push(track);
  }

  if (retrievalProfile.activityProfile) {
    const hardGated = eligible.filter((track) =>
      !trackFailsActivityHardGate(
        track,
        classifyFor(track, opts.classMap),
        retrievalProfile.activityProfile!,
        opts.vibe,
      )
    );
    const minActivityKeep = retrievalProfile.highConfidenceActivity
      ? Math.max(3, Math.min(8, Math.ceil(eligible.length * 0.25)))
      : Math.max(24, Math.floor(eligible.length * 0.08));
    const activityKeepTarget = Math.max(minActivityKeep, Math.ceil(opts.requestedLength * 0.6));
    if (hardGated.length >= minActivityKeep || hardGated.length >= activityKeepTarget) {
      eligible = hardGated;
    }
  }

  if (eligible.length === 0) {
    const inferredWorldIds = inferWorldIdentityIdsFromPrompt(opts.vibe);
    const committed = resolveCommittedWorld({
      prompt: opts.vibe,
      lockedIntent: opts.intent,
    });
    const worldCommitted =
      committed?.hardLock === true ||
      retrievalProfile.committedWorldId != null ||
      (opts.activeWorldIds?.length ?? 0) > 0 ||
      inferredWorldIds.length > 0 ||
      typeof opts.passesHardGate === "function";
    if (worldCommitted) {
      const thinCap = Math.max(
        3,
        Math.min(12, Math.ceil(opts.requestedLength * 0.4)),
      );
      const thinPool = opts.tracks
        .filter((track) => (opts.passesHardGate ? opts.passesHardGate(track) : true))
        .slice(0, thinCap);
      return {
        tracks: thinPool,
        diagnostics: {
          applied: true,
          pipeline: "multi_source_retrieval",
          inputCount: opts.tracks.length,
          outputCount: thinPool.length,
          cap: thinCap,
          fallback: "world_committed_thin_honest_pool",
          committedWorldId: committed?.id ?? retrievalProfile.committedWorldId,
          committedWorldHardLock: committed?.hardLock ?? false,
          inferredWorldIds,
          activityProfileId: retrievalProfile.activityProfile?.id ?? null,
        },
      };
    }
    const fallbackRanked = opts.tracks
      .map((track) => ({
        track,
        score: retrievalProfile.activityProfile
          ? scoreActivityCandidateFit(track, classifyFor(track, opts.classMap), retrievalProfile.activityProfile, opts.vibe)
          : quickEmotionFit(track, opts.emotionProfile),
      }))
      .sort((a, b) => b.score - a.score)
      .map((row) => row.track)
      .slice(0, broadCap);
    return {
      tracks: fallbackRanked.length > 0 ? fallbackRanked : opts.tracks.slice(0, broadCap),
      diagnostics: {
        applied: true,
        pipeline: "multi_source_retrieval",
        inputCount: opts.tracks.length,
        outputCount: fallbackRanked.length > 0 ? fallbackRanked.length : Math.min(opts.tracks.length, broadCap),
        cap: broadCap,
        fallback: "activity_ranked_full_library",
        activityProfileId: retrievalProfile.activityProfile?.id ?? null,
      },
    };
  }

  const promptSonicTarget = buildPromptSonicTarget(
    opts.vibe,
    opts.emotionProfile,
    retrievalProfile.activityProfile,
  );
  const sonicTasteProfile =
    opts.sonicTasteProfile ?? buildSonicTasteProfile(opts.tracks);
  const compoundConstraints = parseCompoundPromptConstraints(opts.vibe, opts.intent, opts.emotionProfile);
  const compoundActive = isCompoundPrompt(compoundConstraints);

  const scoreModifiersFor = (track: RetrievalTrackInput, baseScore: number) => {
    const classification = classifyFor(track, opts.classMap);
    const activityFit = retrievalProfile.activityProfile
      ? scoreActivityCandidateFit(track, classification, retrievalProfile.activityProfile, opts.vibe)
      : quickEmotionFit(track, opts.emotionProfile);
    const compoundFit = compoundActive
      ? scoreCompoundPromptFit(track, classification, compoundConstraints, opts.vibe, opts.emotionProfile)
      : 1;
    const sonicTieBreak = scoreSonicMatchCandidate(track, promptSonicTarget, sonicTasteProfile, activityFit);
    let score = applyRetrievalScoreModifiers(baseScore, track, {
      recentTrackPenalty: opts.recentTrackPenalty,
      sonicTieBreak,
      compoundFit,
      compoundActive,
    });
    if (retrievalProfile.ukHipHopScene?.active) {
      score += ukHipHopRetrievalBoost(track, retrievalProfile.ukHipHopScene);
    }
    return score;
  };

  const activityRanked = eligible
    .map((track) => {
      let score = retrievalProfile.activityProfile
        ? scoreActivityCandidateFit(track, classifyFor(track, opts.classMap), retrievalProfile.activityProfile, opts.vibe)
        : quickEmotionFit(track, opts.emotionProfile);
      if (
        retrievalProfile.activity === "party_pregame" &&
        !retrievalProfile.ukHipHopScene?.active &&
        typeof track.popularity === "number"
      ) {
        score = score * 0.72 + Math.min(1, track.popularity / 100) * 0.28;
      }
      return { track, score: scoreModifiersFor(track, score) };
    })
    .sort((a, b) => b.score - a.score);

  const emotionalRanked = eligible
    .map((track) => ({ track, score: scoreModifiersFor(track, quickEmotionFit(track, opts.emotionProfile)) }))
    .sort((a, b) => b.score - a.score);

  const genreRanked = eligible
    .map((track) => ({
      track,
      score: scoreModifiersFor(track, genreRetrievalFit(track, classifyFor(track, opts.classMap), retrievalProfile)),
    }))
    .sort((a, b) => b.score - a.score);

  const favouriteRanked = eligible
    .map((track) => {
      const artist = track.artistName.toLowerCase().trim();
      const signal = opts.librarySignals?.tracks.get(track.trackId) ?? null;
      const artistPlaylistCount = opts.librarySignals?.artistPlaylistCounts.get(artist) ?? 0;
      let score = favouriteArtistFit(track, artistCounts, retrievalProfile.libraryGravityWeight);
      score = penalizeFrequentFavourite(score, signal, artistPlaylistCount);
      return { track, score: scoreModifiersFor(track, score) };
    })
    .sort((a, b) => b.score - a.score);

  const exploratoryRanked = eligible
    .map((track) => ({
      track,
      score: scoreModifiersFor(track, exploratoryFit(track, classifyFor(track, opts.classMap), retrievalProfile, opts.vibe)),
    }))
    .sort((a, b) => b.score - a.score);

  const forgottenRanked = eligible
    .map((track) => {
      const classification = classifyFor(track, opts.classMap);
      const artist = track.artistName.toLowerCase().trim();
      const signal = opts.librarySignals?.tracks.get(track.trackId) ?? null;
      const artistPlaylistCount = opts.librarySignals?.artistPlaylistCounts.get(artist) ?? 0;
      const activityFit = retrievalProfile.activityProfile
        ? scoreActivityCandidateFit(track, classification, retrievalProfile.activityProfile, opts.vibe)
        : quickEmotionFit(track, opts.emotionProfile);
      const emotionFit = quickEmotionFit(track, opts.emotionProfile);
      const input = buildRediscoveryRetrievalInput(track, {
        signal,
        emotionFit,
        activityFit,
        promptTarget: promptSonicTarget,
        userProfile: sonicTasteProfile,
        artistPlaylistCount,
      });
      return { track, score: scoreModifiersFor(track, scoreForgottenFavourite(input)) };
    })
    .sort((a, b) => b.score - a.score);

  const sonicRanked = eligible
    .map((track) => {
      const classification = classifyFor(track, opts.classMap);
      const activityFit = retrievalProfile.activityProfile
        ? scoreActivityCandidateFit(track, classification, retrievalProfile.activityProfile, opts.vibe)
        : quickEmotionFit(track, opts.emotionProfile);
      return {
        track,
        score: scoreModifiersFor(track, scoreSonicMatchCandidate(track, promptSonicTarget, sonicTasteProfile, activityFit)),
      };
    })
    .sort((a, b) => b.score - a.score);

  const sourcePools: Record<RetrievalSourceId, Array<{ track: T; score: number }>> = {
    activity_match: activityRanked,
    emotional_match: emotionalRanked,
    genre_match: genreRanked,
    favourite_artists: favouriteRanked,
    exploratory: exploratoryRanked,
    forgotten_favourites: forgottenRanked,
    sonic_match: sonicRanked,
  };

  const seen = new Set<string>();
  const merged: T[] = [];
  const sourceDistribution: Record<RetrievalSourceId, number> = {
    activity_match: 0,
    emotional_match: 0,
    genre_match: 0,
    favourite_artists: 0,
    exploratory: 0,
    forgotten_favourites: 0,
    sonic_match: 0,
  };

  const sourceOrder: RetrievalSourceId[] = retrievalProfile.highConfidenceActivity
    ? ["activity_match", "sonic_match", "forgotten_favourites", "genre_match", "emotional_match", "exploratory", "favourite_artists"]
    : ["forgotten_favourites", "sonic_match", "emotional_match", "genre_match", "activity_match", "exploratory", "favourite_artists"];

  for (const sourceId of sourceOrder) {
    const quota = Math.max(8, Math.floor(broadCap * retrievalProfile.sourceQuotas[sourceId]));
    const picked = pullSourcePool(sourcePools[sourceId], quota, seen);
    sourceDistribution[sourceId] = picked.length;
    merged.push(...picked);
  }

  for (const item of activityRanked) {
    if (merged.length >= broadCap) break;
    if (seen.has(item.track.trackId)) continue;
    seen.add(item.track.trackId);
    merged.push(item.track);
  }

  const openingReserve = Math.min(28, Math.max(12, opts.requestedLength * 2));
  const openingRanked = eligible
    .map((track) => ({
      track,
      score: scoreOpeningCandidate(track, classifyFor(track, opts.classMap), retrievalProfile, opts.vibe, opts.activeWorldIds ?? []),
    }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score);

  const openingIds = new Set(openingRanked.slice(0, openingReserve).map((row) => row.track.trackId));
  const openingFront = openingRanked
    .slice(0, openingReserve)
    .map((row) => row.track)
    .filter((track) => seen.has(track.trackId));
  const remainder = merged.filter((track) => !openingIds.has(track.trackId));
  const ordered = [...openingFront, ...remainder].slice(0, broadCap);

  const diagnostics: RetrievalDiagnostics = {
    applied: true,
    pipeline: "multi_source_retrieval",
    inputCount: opts.tracks.length,
    outputCount: ordered.length,
    cap: broadCap,
    profile: {
      activity: retrievalProfile.activity,
      activityConfidence: retrievalProfile.activityConfidence,
      sceneTags: retrievalProfile.sceneTags,
      sceneConfidence: retrievalProfile.sceneConfidence,
      emotionalIntent: retrievalProfile.emotionalIntent,
      genreExpectations: retrievalProfile.genreExpectations,
      genreConfidence: retrievalProfile.genreConfidence,
      libraryGravityWeight: retrievalProfile.libraryGravityWeight,
      highConfidenceActivity: retrievalProfile.highConfidenceActivity,
      activityProfileId: retrievalProfile.activityProfile?.id ?? null,
    },
    sourceDistribution,
    sourceQuotaPct: retrievalProfile.sourceQuotas,
    openingCandidatesReserved: openingFront.length,
    dominantLibraryFamilies: dominantFamilies,
    libraryGravityShare: libraryGravityShare(ordered, dominantFamilies, opts.classMap),
    diversityIndex: computeDiversityIndex(ordered, opts.classMap),
    topRejected: rejected,
    compoundPrompt: compoundActive,
    compoundDimensions: compoundConstraints.dimensions,
    ...(opts.retrievalOverrides?.strategyId
      ? { strategyId: opts.retrievalOverrides.strategyId }
      : {}),
  };

  return {
    tracks: ordered.length > 0 ? ordered : opts.tracks.slice(0, broadCap),
    diagnostics: opts.debugRetrieval
      ? diagnostics
      : {
        applied: diagnostics.applied,
        pipeline: diagnostics.pipeline,
        inputCount: diagnostics.inputCount,
        outputCount: diagnostics.outputCount,
        cap: diagnostics.cap,
        activityProfileId: diagnostics.profile.activityProfileId,
        highConfidenceActivity: diagnostics.profile.highConfidenceActivity,
        libraryGravityShare: diagnostics.libraryGravityShare,
        diversityIndex: diagnostics.diversityIndex,
        sourceDistribution: diagnostics.sourceDistribution,
        openingCandidatesReserved: diagnostics.openingCandidatesReserved,
        ...(diagnostics.strategyId ? { strategyId: diagnostics.strategyId } : {}),
      },
  };
}
