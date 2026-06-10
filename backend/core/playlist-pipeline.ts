/**
 * End-to-end playlist build — scoring → composition → genre post-enforcement.
 */

import { runScoringPipeline } from "./scoring-engine";
import { composePlaylistFromPool } from "./playlist-composer";
import { enforceFinalPlaylistGenres } from "./genre-intelligence/final-enforcement";
import { runV3Pipeline } from "./v3/v3-pipeline";
import type { EmotionProfile, VibeKind } from "../lib/emotion";
import type { IntentDecodeResult } from "../lib/intent-decoder";
import type { CanonicalSceneResult } from "../lib/scene-canonicalizer";
import type { ScenePrototype } from "../lib/scene-prototypes";
import type { SonicProfile } from "../lib/scene-sonic-map";
import type { UserGenreProfile } from "../lib/user-genre-profile";
import type { GenreIntelligenceStack } from "../lib/genre-intelligence-stack";
import type { LibrarySignals } from "../lib/library-signals";
import type { ReferenceFingerprint } from "../lib/reference-playlist";
import type { RediscoveryMode } from "../lib/forgotten-favourites";
import type { ArchaeologyIntent } from "../lib/library-archaeology";
import type { ChapterMatch } from "../lib/music-life-chapters";
import type { SurpriseMix } from "../lib/human-surprise";
import type { JourneyArc } from "../lib/emotion-destination";
import type { FeedbackMemory } from "../lib/feedback-memory";
import {
  buildRecentTrackPoolPenalty,
  type FreshnessStats,
} from "../lib/playlist-freshness";
import type { GenreAudit } from "../lib/genre-audit";
import type { ScoredLibraryTrack } from "./scoring-engine/types";
import { logScoringStage } from "../lib/generate-stage-timer";
import type { EcosystemDebug } from "../lib/ecosystem-lock";
import { detectEraFromYear, estimateEraFromAudio } from "./v2/era-model";
import { buildLockedIntent, completeLockedIntent, type LockedIntent } from "./v3/intent";
import { trackMatchesConstraints } from "./v3/constraint-filter";
import { getGenreFamily } from "./v3/global-diversity-controller";
import {
  warnIfFieldDropped,
  warnIfV3MetadataLost,
  type V3MetadataTrack,
} from "../lib/v3-track-contract";
import {
  buildUnifiedIntentContext,
  resolveUnifiedIntent,
  unifiedIntentFromControllerIntent,
  unifiedIntentFromLockedIntent,
  unifiedIntentFromSceneIntent,
  unifiedIntentFromV11Intent,
  type UnifiedIntentContext,
} from "./unified-intent";
import {
  getMomentMemory,
  injectMomentContext,
  updateMomentMemory,
} from "./memory/moment-memory";
import { buildPlaylistEmbedding } from "./v3/embedding-retrieval";
import {
  EXPANDED_EVENT_TERMS,
  EXPANDED_PLACE_TERMS,
  EXPANDED_TIME_TERMS,
  termRegex,
} from "../lib/expanded-intent-vocabulary";

export interface BuildPlaylistPipelineOpts<T extends {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
}> {
  likedSongs: T[];
  vibe: string;
  mode: "strict" | "balanced" | "chaotic";
  playlistLength: number;
  emotionProfile: EmotionProfile;
  vibeKind: VibeKind;
  intent: IntentDecodeResult;
  humanIntent: IntentDecodeResult;
  canonical: CanonicalSceneResult | null;
  prototype: ScenePrototype | null;
  sonicProfile: SonicProfile | null;
  userGenreProfile: UserGenreProfile;
  genreStack: GenreIntelligenceStack;
  surpriseMix: SurpriseMix;
  journeyArc: JourneyArc;
  memoryByTrack: (trackId: string) => number;
  noveltyByTrack: (trackId: string) => number;
  recentPlaylistTrackIds?: string[][];
  postScore: {
    referenceFingerprint: ReferenceFingerprint | null;
    memoryWeight: number;
    emotionProfile: EmotionProfile;
    librarySignals: LibrarySignals;
    rediscoveryMode: RediscoveryMode;
    archaeology: ArchaeologyIntent | null;
    chapterMatch: ChapterMatch | null;
    feedbackMemory?: FeedbackMemory | null;
    startMs: number;
    promptConfidenceMultiplier: number;
    journeyArcMultiplier: number;
    freshness: {
      stats: FreshnessStats;
      artistAppearances: Map<string, number>;
      albumAppearances: Map<string, number>;
      globalCloneMultiplier: number;
    };
    vibe: string;
  };
  genrePost: {
    allowHoliday: boolean;
    suppressGenres: string[];
  };
  maxPerArtist: number;
  varietyPenaltyScale?: number;
  referencePlaylist?: boolean;
  pipelineLog?: import("pino").Logger;
  lastSuccessfulVibe?: string | null;
  momentMemoryKey?: string;
  /**
   * No-library mode: intent always overrides user history.
   * Library affinity weight is zeroed out and redistributed to semantic.
   */
  noLibraryMode?: boolean;
}

export interface BuildPlaylistPipelineResult<T extends { trackId: string }> {
  finalTracks: T[];
  sorted: ScoredLibraryTrack<T>[];
  scoringDiagnostics: Record<string, unknown>;
  hybridExcludedCount: number;
  genreAudit: GenreAudit;
  ecosystemDebug: EcosystemDebug | null;
  composeMeta: {
    structured: T[];
    poolTarget: number;
    afterDeadZone: T[];
    afterSmoothing: T[];
    afterArtistSep: T[];
    afterArc: T[];
    emotionalPeakTrackId: string | null;
    emotionalPeakIndex: number | null;
    gradientPhases: { start: number; explore: number; peak: number; resolve: number };
  };
}

function energyIntentFromProfile(profile: EmotionProfile): "low" | "medium" | "high" {
  const energy = profile.energy ?? 0.5;
  if (energy >= 0.64) return "high";
  if (energy <= 0.38) return "low";
  return "medium";
}

function safeFeature(value: unknown, fallback = 0.5): number {
  return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
}

function moodFallbackFromProfile(profile: EmotionProfile): string[] {
  if ((profile.calm ?? 0) >= 0.6) return ["calm"];
  if ((profile.nostalgia ?? 0) >= 0.5) return ["nostalgic"];
  if ((profile.valence ?? 0.5) <= 0.42) return ["melancholic"];
  if ((profile.energy ?? 0.5) >= 0.65) return ["energised"];
  return ["balanced"];
}

function eraRangeFromCandidatePool<T extends { releaseYear?: number | null }>(
  tracks: T[],
): { start: number; end: number } | null {
  const years = tracks
    .map((track) => track.releaseYear)
    .filter((year): year is number => typeof year === "number" && year >= 1900);
  if (years.length === 0) return null;
  return { start: Math.min(...years), end: Math.max(...years) };
}

function genreFamilyForTrack<T extends { trackId: string; genrePrimary?: string | null }>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): string | null {
  const classification = classMap.get(track.trackId);
  const family = classification?.genreFamily ?? classification?.genrePrimary ?? track.genrePrimary;
  const normalized = family ? getGenreFamily(family) : null;
  return normalized && normalized !== "unknown" ? normalized : null;
}

function trackMatchesGenreFamilies<T extends { trackId: string; genrePrimary?: string | null }>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  genreFamilies: string[],
): boolean {
  if (genreFamilies.length === 0) return true;
  const family = genreFamilyForTrack(track, classMap);
  return !!family && genreFamilies.includes(family);
}

const KNOWN_ARTIST_GENRE_TRUTH: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /\bnas\b/i, family: "hip_hop" },
  { pattern: /\bxxxtentacion\b/i, family: "hip_hop" },
  { pattern: /\bbob\s+marley\b/i, family: "reggae" },
  { pattern: /\bthe\s+doors\b/i, family: "rock" },
  { pattern: /\bblondie\b/i, family: "rock" },
  { pattern: /\beminem\b/i, family: "hip_hop" },
  { pattern: /\brockwell\b/i, family: "pop" },
];

const SPOTIFY_TRUTH_TERMS: Record<string, string[]> = {
  country: ["country", "americana", "red dirt", "outlaw country", "bluegrass"],
  hip_hop: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap", "emo rap"],
  rock: ["rock", "new wave", "post-punk", "punk", "grunge", "psychedelic", "album rock"],
  reggae: ["reggae", "dancehall", "dub", "rocksteady"],
  pop: ["pop", "dance pop", "synthpop"],
  electronic: ["electronic", "edm", "house", "techno", "trance", "dubstep"],
  rnb: ["r&b", "rnb", "neo soul"],
  soul: ["soul", "funk", "motown"],
  latin: ["latin", "reggaeton", "salsa", "bachata"],
  jazz: ["jazz", "bebop", "swing"],
  metal: ["metal", "metalcore", "thrash"],
};

function truthGenreFamily(track: {
  artistName?: string | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
}): string | null {
  const artist = track.artistName ?? "";
  const known = KNOWN_ARTIST_GENRE_TRUTH.find((entry) => entry.pattern.test(artist));
  if (known) return known.family;
  const metadata = [
    ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres : []),
    ...(Array.isArray(track.albumGenres) ? track.albumGenres : []),
  ].filter((value): value is string => typeof value === "string").map((value) => value.toLowerCase());
  for (const [family, terms] of Object.entries(SPOTIFY_TRUTH_TERMS)) {
    if (metadata.some((value) => terms.some((term) => value.includes(term)))) {
      return family;
    }
  }
  return null;
}

function contradictsExplicitGenreTruth(
  track: { artistName?: string | null; spotifyArtistGenres?: unknown; albumGenres?: unknown },
  explicitFamilies: string[],
): boolean {
  if (explicitFamilies.length === 0) return false;
  const truth = truthGenreFamily(track);
  return !!truth && !explicitFamilies.includes(truth);
}

type IntentContract = {
  genres: string[];
  era?: { start?: number; end?: number } | null;
  moods: string[];
  context?: string;
  energyArc?: "low" | "medium" | "high" | "dynamic" | "progressive";
  emotionalTone?: string[];
  rawPrompt: string;
  genreFamilies: string[];
  eraRange: { start: number; end: number } | null;
  mood: string[];
  activity: string | null;
  energy: "low" | "medium" | "high" | null;
  timeOfDay: Array<"morning" | "afternoon" | "evening" | "late_night">;
  places: Array<"rural" | "outdoors" | "city" | "beach" | "bedroom" | "car">;
  explicitDimensions: string[];
};

type RetrievalPools<T> = {
  core: T[];
  adjacent: T[];
  bridge: T[];
  anchor: T[];
  discovery: T[];
  energyArc: T[];
};

type PlaylistScore = {
  overall: number;
  promptAlignment: number;
  genrePurity: number;
  tonalConsistency: number;
  energyFlow: number;
  transitionSmoothness: number;
  culturalCoherence: number;
  genericnessPenalty: number;
};

type IntentContractDiagnostics = {
  contract: IntentContract;
  inputCount: number;
  guardedCount: number;
  active: boolean;
  relaxed: boolean;
  averageFit: number;
};

type IntentContractTrack = {
  trackId: string;
  genrePrimary?: string | null;
  releaseYear?: number | null;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  tempo: number | null;
};

function parseIntentContract(input: string, parsed: LockedIntent): IntentContract {
  const lower = input.toLowerCase();
  const timeOfDay: IntentContract["timeOfDay"] = [
    termRegex(EXPANDED_TIME_TERMS.morning).test(lower) ? "morning" : null,
    termRegex(EXPANDED_TIME_TERMS.afternoon).test(lower) ? "afternoon" : null,
    termRegex(EXPANDED_TIME_TERMS.evening).test(lower) ? "evening" : null,
    termRegex(EXPANDED_TIME_TERMS.late_night).test(lower) ? "late_night" : null,
  ].filter((value): value is IntentContract["timeOfDay"][number] => !!value);
  const places: IntentContract["places"] = [
    termRegex(EXPANDED_PLACE_TERMS.rural).test(lower) ? "rural" : null,
    termRegex(EXPANDED_PLACE_TERMS.outdoors).test(lower) ? "outdoors" : null,
    termRegex(EXPANDED_PLACE_TERMS.city).test(lower) ? "city" : null,
    termRegex(EXPANDED_PLACE_TERMS.beach).test(lower) ? "beach" : null,
    termRegex(EXPANDED_PLACE_TERMS.bedroom).test(lower) ? "bedroom" : null,
    termRegex(EXPANDED_PLACE_TERMS.car).test(lower) ? "car" : null,
  ].filter((value): value is IntentContract["places"][number] => !!value);
  const hasEvent = termRegex(EXPANDED_EVENT_TERMS).test(lower);
  const explicitDimensions = [
    parsed.genreFamilies.length > 0 ? "genre" : null,
    parsed.eraRange ? "era" : null,
    parsed.mood.length > 0 ? "mood" : null,
    parsed.activity ? "activity" : null,
    parsed.energy ? "energy" : null,
    timeOfDay.length > 0 ? "timeOfDay" : null,
    places.length > 0 ? "place" : null,
    hasEvent ? "event" : null,
  ].filter((value): value is string => !!value);
  return {
    genres: parsed.genreFamilies,
    era: parsed.eraRange,
    moods: parsed.mood,
    context: places[0] ?? parsed.activity ?? undefined,
    energyArc: /\b(low\s*(?:to|->|-)\s*high|build|rising|progressive|crescendo)\b/.test(lower)
      ? "progressive"
      : /\b(dynamic|varied|journey|arc)\b/.test(lower)
        ? "dynamic"
        : parsed.energy ?? undefined,
    emotionalTone: parsed.mood,
    rawPrompt: input,
    genreFamilies: parsed.genreFamilies,
    eraRange: parsed.eraRange,
    mood: parsed.mood,
    activity: parsed.activity,
    energy: parsed.energy,
    timeOfDay,
    places,
    explicitDimensions,
  };
}

function buildIntentContract(prompt: string): IntentContract {
  return parseIntentContract(prompt, buildLockedIntent(prompt));
}

function contractEnergyMatch(track: IntentContractTrack, energy: IntentContract["energy"]): boolean {
  if (!energy || typeof track.energy !== "number") return true;
  if (energy === "low") return track.energy <= 0.58;
  if (energy === "high") return track.energy >= 0.55;
  return track.energy >= 0.32 && track.energy <= 0.78;
}

function contractMoodMatch(track: IntentContractTrack, mood: string): boolean {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.4;
  switch (mood) {
    case "melancholic":
      return valence <= 0.48;
    case "calm":
      return energy <= 0.62 || acousticness >= 0.35;
    case "nostalgic":
      return acousticness >= 0.28 || (track.releaseYear != null && track.releaseYear <= 2015);
    case "warm":
      return valence >= 0.42 && (acousticness >= 0.22 || energy <= 0.70);
    case "energised":
      return energy >= 0.55;
    case "dark":
      return valence <= 0.50 || energy <= 0.46;
    case "euphoric":
      return valence >= 0.58 && energy >= 0.48;
    case "angry":
      return energy >= 0.58 && valence <= 0.62;
    default:
      return true;
  }
}

function contractActivityMatch(track: IntentContractTrack, activity: string | null): boolean {
  if (!activity) return true;
  const energy = track.energy ?? 0.5;
  const tempo = track.tempo ?? 110;
  const danceability = track.danceability ?? 0.5;
  const acousticness = track.acousticness ?? 0.4;
  switch (activity) {
    case "driving":
      return energy >= 0.30 && energy <= 0.82 && tempo >= 75;
    case "focus":
      return energy <= 0.65 && danceability <= 0.72;
    case "gym":
      return energy >= 0.62 || tempo >= 120;
    case "relaxing":
      return energy <= 0.55 || acousticness >= 0.35;
    case "party":
      return energy >= 0.58 || danceability >= 0.62;
    case "cleaning":
      return energy >= 0.35 && energy <= 0.78;
    case "sleep":
      return energy <= 0.42 || acousticness >= 0.45;
    case "travel":
      return energy >= 0.30 && tempo >= 70;
    default:
      return true;
  }
}

function contractTimeMatch(track: IntentContractTrack, timeOfDay: IntentContract["timeOfDay"]): boolean {
  if (timeOfDay.length === 0) return true;
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.4;
  return timeOfDay.some((time) => {
    switch (time) {
      case "morning":
        return valence >= 0.42 && energy >= 0.25 && energy <= 0.78;
      case "afternoon":
        return energy >= 0.35 && energy <= 0.82;
      case "evening":
        return energy <= 0.72 || acousticness >= 0.25;
      case "late_night":
        return energy <= 0.66 && valence <= 0.70;
    }
  });
}

function contractPlaceMatch<T extends IntentContractTrack>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  places: IntentContract["places"],
): boolean {
  if (places.length === 0) return true;
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.4;
  const danceability = track.danceability ?? 0.5;
  const family = genreFamilyForTrack(track, classMap);
  return places.some((place) => {
    switch (place) {
      case "rural":
        return family === "country" || family === "folk" || family === "blues" || acousticness >= 0.30;
      case "outdoors":
        return acousticness >= 0.25 || valence >= 0.45;
      case "city":
        return family === "hip_hop" || family === "electronic" || family === "rnb" || danceability >= 0.55;
      case "beach":
        return family === "reggae" || family === "latin" || valence >= 0.52;
      case "bedroom":
        return energy <= 0.62 || acousticness >= 0.35;
      case "car":
        return energy >= 0.30 && energy <= 0.82;
    }
  });
}

function intentContractFit<T extends IntentContractTrack>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  contract: IntentContract,
): { score: number; requiredPassed: boolean } {
  let matched = 0;
  let total = 0;
  let requiredPassed = true;
  const add = (active: boolean, pass: boolean, required = false) => {
    if (!active) return;
    total += 1;
    if (pass) matched += 1;
    if (required && !pass) requiredPassed = false;
  };

  add(contract.genreFamilies.length > 0, trackMatchesGenreFamilies(track, classMap, contract.genreFamilies), true);
  add(!!contract.eraRange, !!contract.eraRange && typeof track.releaseYear === "number" && track.releaseYear >= contract.eraRange.start && track.releaseYear <= contract.eraRange.end, true);
  add(!!contract.energy, contractEnergyMatch(track, contract.energy));
  for (const mood of contract.mood) add(true, contractMoodMatch(track, mood));
  add(!!contract.activity, contractActivityMatch(track, contract.activity));
  add(contract.timeOfDay.length > 0, contractTimeMatch(track, contract.timeOfDay));
  add(contract.places.length > 0, contractPlaceMatch(track, classMap, contract.places));

  return {
    score: total > 0 ? matched / total : 1,
    requiredPassed,
  };
}

function constrainPoolToIntentContract<T extends IntentContractTrack>(
  pool: T[],
  classMap: UserGenreProfile["trackClassifications"],
  contract: IntentContract,
): { pool: T[]; diagnostics: IntentContractDiagnostics } {
  if (contract.explicitDimensions.length === 0) {
    return {
      pool,
      diagnostics: { contract, inputCount: pool.length, guardedCount: pool.length, active: false, relaxed: false, averageFit: 1 },
    };
  }
  const scored = pool.map((track) => ({
    track,
    fit: intentContractFit(track, classMap, contract),
  }));
  const strict = scored.filter(({ fit }) => fit.requiredPassed && fit.score >= 0.50);
  const relaxed = strict.length > 0
    ? strict
    : scored.filter(({ fit }) => fit.requiredPassed && fit.score >= 0.34);
  const selected = relaxed.length > 0 ? relaxed.map(({ track }) => track) : pool;
  const averageFit = scored.length > 0
    ? scored.reduce((sum, item) => sum + item.fit.score, 0) / scored.length
    : 0;
  return {
    pool: selected,
    diagnostics: {
      contract,
      inputCount: pool.length,
      guardedCount: selected.length,
      active: selected.length < pool.length,
      relaxed: strict.length === 0 && relaxed.length > 0,
      averageFit: round3(averageFit),
    },
  };
}

function enforceIntentContract<T extends ScoredLibraryTrack<IntentContractTrack>>(
  tracks: T[],
  intent: IntentContract,
): Array<T & { contractFitScore: number }> {
  return tracks
    .map((track) => {
      let contractFitScore = 0;
      const family = track.genrePrimary ? getGenreFamily(track.genrePrimary) : null;
      if (intent.genres.length > 0 && family && intent.genres.includes(family)) contractFitScore += 3;
      if (
        intent.era &&
        typeof track.releaseYear === "number" &&
        (intent.era.start == null || track.releaseYear >= intent.era.start) &&
        (intent.era.end == null || track.releaseYear <= intent.era.end)
      ) contractFitScore += 2;
      if (intent.moods.some((mood) => contractMoodMatch(track, mood))) contractFitScore += 2;
      if (intent.activity && contractActivityMatch(track, intent.activity)) contractFitScore += 1;
      if (intent.context && (contractActivityMatch(track, intent.activity ?? intent.context) || track.genrePrimary === intent.context)) contractFitScore += 2;
      if (intent.energyArc && intent.energyArc !== "dynamic" && intent.energyArc !== "progressive" && contractEnergyMatch(track, intent.energyArc)) contractFitScore += 2;
      if (intent.emotionalTone?.some((tone) => contractMoodMatch(track, tone))) contractFitScore += 2;
      return { ...track, contractFitScore };
    })
    .filter((track) => intent.explicitDimensions.length === 0 || track.contractFitScore > 0)
    .sort((a, b) => b.contractFitScore - a.contractFitScore);
}

function feedbackPenalty<T extends IntentContractTrack & { artistName?: string; genrePrimary?: string }>(
  track: T,
  feedback: FeedbackMemory | null,
): number {
  if (!feedback) return 0;
  let penalty = 0;
  if (track.artistName && feedback.badArtists.includes(track.artistName)) penalty += 0.35;
  if (track.genrePrimary && feedback.badGenres.includes(track.genrePrimary)) penalty += 0.25;
  if (feedback.overplayedTracks.includes(track.trackId)) penalty += 0.30;
  if (track.energy != null) {
    if (track.energy <= 0.35 && feedback.badEnergyTypes.includes("low")) penalty += 0.20;
    if (track.energy >= 0.70 && feedback.badEnergyTypes.includes("high")) penalty += 0.20;
  }
  return penalty;
}

function buildRetrievalPools<T extends ScoredLibraryTrack<IntentContractTrack> & { artistName?: string }>(
  tracks: T[],
  contract: IntentContract,
  classMap: UserGenreProfile["trackClassifications"],
  feedback: FeedbackMemory | null = null,
): RetrievalPools<T> {
  const contractRanked = enforceIntentContract(tracks, contract)
    .map((track) => ({
      track,
      adjustedScore: (track.contractFitScore * 0.20) + (track.score ?? 0) - feedbackPenalty(track, feedback),
    }))
    .sort((a, b) => b.adjustedScore - a.adjustedScore)
    .map(({ track }) => track as T);
  const seen = new Set<string>();
  const takeUnique = (items: T[], limit: number) => {
    const out: T[] = [];
    for (const item of items) {
      if (seen.has(item.trackId)) continue;
      seen.add(item.trackId);
      out.push(item);
      if (out.length >= limit) break;
    }
    return out;
  };
  const genreMatched = contractRanked.filter((track) => trackMatchesGenreFamilies(track, classMap, contract.genres));
  const adjacentFamilies = new Set(contract.genres.flatMap((genre) => adjacentGenreFamilies(genre)));
  const adjacent = contractRanked.filter((track) => {
    const family = genreFamilyForTrack(track, classMap);
    return !!family && adjacentFamilies.has(family);
  });
  const energyArc = contractRanked.filter((track) =>
    !contract.energyArc ||
    contract.energyArc === "dynamic" ||
    contract.energyArc === "progressive" ||
    contractEnergyMatch(track, contract.energyArc)
  );
  const anchor = contractRanked.filter((track) =>
    (track.score ?? 0) >= 0.72 ||
    (track.rediscoveryScore ?? 0) >= 0.68
  );
  const discovery = contractRanked.filter((track) =>
    (track.rediscoveryScore ?? 0) <= 0.45 ||
    (track as T & { explorationDistance?: number }).explorationDistance != null
  );
  return {
    core: takeUnique(genreMatched.length > 0 ? genreMatched : contractRanked, 160),
    anchor: takeUnique(anchor, 80),
    adjacent: takeUnique(adjacent, 100),
    bridge: takeUnique([...adjacent, ...contractRanked], 80),
    energyArc: takeUnique(energyArc, 80),
    discovery: takeUnique(discovery.length > 0 ? discovery : contractRanked.slice().reverse(), 80),
  };
}

function flattenRetrievalPools<T>(retrieval: RetrievalPools<T>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const track of [
    ...retrieval.core,
    ...retrieval.anchor,
    ...retrieval.adjacent,
    ...retrieval.bridge,
    ...retrieval.energyArc,
    ...retrieval.discovery,
  ] as Array<T & { trackId?: string }>) {
    const id = track.trackId;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(track as T);
  }
  return out;
}

function evaluatePlaylistQuality<T extends IntentContractTrack & { genrePrimary?: string | null }>(
  playlist: T[],
  intent: IntentContract,
  classMap: UserGenreProfile["trackClassifications"],
): PlaylistScore {
  if (playlist.length === 0) {
    return { overall: 0, promptAlignment: 0, genrePurity: 0, tonalConsistency: 0, energyFlow: 0, transitionSmoothness: 0, culturalCoherence: 0, genericnessPenalty: 1 };
  }
  const fits = playlist.map((track) => intentContractFit(track, classMap, intent).score);
  const promptAlignment = fits.reduce((sum, fit) => sum + fit, 0) / fits.length;
  const genrePurity = intent.genres.length === 0
    ? 1
    : playlist.filter((track) => trackMatchesGenreFamilies(track, classMap, intent.genres)).length / playlist.length;
  const tonalConsistency = playlist.filter((track) =>
    intent.moods.length === 0 || intent.moods.some((mood) => contractMoodMatch(track, mood))
  ).length / playlist.length;
  const energyDeltas = playlist.slice(1).map((track, index) =>
    Math.abs((track.energy ?? 0.5) - (playlist[index].energy ?? 0.5))
  );
  const transitionSmoothness = energyDeltas.length === 0
    ? 1
    : 1 - Math.min(1, energyDeltas.reduce((sum, delta) => sum + Math.max(0, delta - 0.35), 0) / energyDeltas.length);
  const fixedEnergyArc: "low" | "medium" | "high" | null =
    intent.energyArc && intent.energyArc !== "dynamic" && intent.energyArc !== "progressive"
      ? intent.energyArc
      : null;
  const energyFlow = intent.energyArc === "progressive"
    ? ((playlist.at(-1)?.energy ?? 0.5) >= (playlist[0]?.energy ?? 0.5) ? 0.9 : 0.45)
    : playlist.filter((track) => {
        if (!fixedEnergyArc) return true;
        return contractEnergyMatch(track, fixedEnergyArc);
      }).length / playlist.length;
  const culturalCoherence = (genrePurity + tonalConsistency + transitionSmoothness) / 3;
  const genericnessPenalty = Math.max(0, 1 - promptAlignment) * 0.35;
  const overall = criticClamp01(
    promptAlignment * 0.34 +
    genrePurity * 0.18 +
    tonalConsistency * 0.15 +
    energyFlow * 0.12 +
    transitionSmoothness * 0.10 +
    culturalCoherence * 0.11 -
    genericnessPenalty
  );
  return {
    overall: round3(overall),
    promptAlignment: round3(promptAlignment),
    genrePurity: round3(genrePurity),
    tonalConsistency: round3(tonalConsistency),
    energyFlow: round3(energyFlow),
    transitionSmoothness: round3(transitionSmoothness),
    culturalCoherence: round3(culturalCoherence),
    genericnessPenalty: round3(genericnessPenalty),
  };
}

function repairExplicitIntentPurity<T extends IntentContractTrack & { artistName?: string; score?: number }>(
  playlist: T[],
  candidatePool: Array<ScoredLibraryTrack<T>>,
  intent: IntentContract,
  classMap: UserGenreProfile["trackClassifications"],
  playlistLength: number,
): { tracks: T[]; diagnostics: Record<string, unknown> } {
  const before = evaluatePlaylistQuality(playlist, intent, classMap);
  const genreActive = intent.genres.length > 0;
  const eraRange = intent.eraRange;
  const eraActive = !!eraRange;
  if (!genreActive && !eraActive) {
    return { tracks: playlist, diagnostics: { active: false, repairedCount: 0, beforeQuality: before, afterQuality: before } };
  }

  const minGenrePurity = genreActive ? 0.78 : 0;
  const minEraFit = eraActive ? 0.55 : 0;
  const eraFit = eraRange
    ? playlist.filter((track) =>
        typeof track.releaseYear === "number" &&
        track.releaseYear >= eraRange.start &&
        track.releaseYear <= eraRange.end
      ).length / Math.max(1, playlist.length)
    : 1;
  if ((!genreActive || before.genrePurity >= minGenrePurity) && (!eraActive || eraFit >= minEraFit)) {
    return { tracks: playlist, diagnostics: { active: false, repairedCount: 0, beforeQuality: before, afterQuality: before, eraFit: round3(eraFit) } };
  }

  const repaired = [...playlist];
  const used = new Set(repaired.map((track) => track.trackId));
  const artistCounts = new Map<string, number>();
  for (const track of repaired) {
    if (track.artistName) artistCounts.set(track.artistName, (artistCounts.get(track.artistName) ?? 0) + 1);
  }

  const candidateRank = candidatePool
    .filter((track) => !used.has(track.trackId))
    .map((track) => ({ track, fit: intentContractFit(track, classMap, intent) }))
    .filter(({ fit }) => fit.requiredPassed && fit.score >= 0.50)
    .sort((a, b) => (b.fit.score + (b.track.score ?? 0) * 0.10) - (a.fit.score + (a.track.score ?? 0) * 0.10));

  const repairBudget = Math.min(Math.max(4, Math.floor(playlistLength * 0.35)), candidateRank.length);
  const targets = repaired
    .map((track, index) => {
      const fit = intentContractFit(track, classMap, intent);
      const reasons = [
        genreActive && !trackMatchesGenreFamilies(track, classMap, intent.genres) ? "genre" : null,
        eraRange && !(typeof track.releaseYear === "number" && track.releaseYear >= eraRange.start && track.releaseYear <= eraRange.end) ? "era" : null,
        !fit.requiredPassed || fit.score < 0.50 ? "intent_fit" : null,
      ].filter((reason): reason is string => !!reason);
      return { track, index, fit, reasons };
    })
    .filter(({ fit }) => !fit.requiredPassed || fit.score < 0.50)
    .sort((a, b) => a.fit.score - b.fit.score)
    .slice(0, repairBudget);

  let repairedCount = 0;
  const repairReasons: Record<string, number> = {};
  for (const target of targets) {
    const replacementIndex = candidateRank.findIndex(({ track }) => {
      if (used.has(track.trackId)) return false;
      if (track.artistName && (artistCounts.get(track.artistName) ?? 0) >= 2) return false;
      return true;
    });
    if (replacementIndex < 0) break;
    const [{ track: replacement }] = candidateRank.splice(replacementIndex, 1);
    const removed = repaired[target.index];
    if (removed?.artistName) {
      artistCounts.set(removed.artistName, Math.max(0, (artistCounts.get(removed.artistName) ?? 1) - 1));
    }
    repaired[target.index] = replacement;
    used.add(replacement.trackId);
    if (replacement.artistName) artistCounts.set(replacement.artistName, (artistCounts.get(replacement.artistName) ?? 0) + 1);
    for (const reason of target.reasons) {
      repairReasons[reason] = (repairReasons[reason] ?? 0) + 1;
    }
    repairedCount++;
  }

  const after = evaluatePlaylistQuality(repaired, intent, classMap);
  return {
    tracks: after.overall >= before.overall || after.genrePurity >= before.genrePurity ? repaired : playlist,
    diagnostics: {
      active: true,
      repairedCount,
      beforeQuality: before,
      afterQuality: after,
      minGenrePurity,
      minEraFit,
      eraFit: round3(eraFit),
      candidateCount: candidateRank.length,
      repairReasons,
    },
  };
}

type PreV3TraceStage = {
  stage: string;
  before: number;
  after: number;
  removed: number;
  percentRemoved: number;
  rejectionReasons: Record<string, number>;
  topReasons: Array<{ reason: string; count: number }>;
};

function topPreV3Reasons(reasons: Record<string, number>): Array<{ reason: string; count: number }> {
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
}

function preV3StageTrace(
  stage: string,
  before: number,
  after: number,
  reasons: Record<string, number> = {},
): PreV3TraceStage {
  const removed = Math.max(0, before - after);
  return {
    stage,
    before,
    after,
    removed,
    percentRemoved: before > 0 ? Math.round((removed / before) * 10000) / 100 : 0,
    rejectionReasons: reasons,
    topReasons: topPreV3Reasons(reasons),
  };
}

function preV3Summary(
  trace: PreV3TraceStage[],
  survivingTracks: number,
): {
  firstMajorDrop: PreV3TraceStage | null;
  largestDrop: PreV3TraceStage | null;
  totalRemoved: number;
  survivingTracks: number;
} {
  const drops = trace.filter((stage) => stage.removed > 0);
  return {
    firstMajorDrop: drops.find((stage) => stage.after === 0 || stage.percentRemoved >= 50) ?? drops[0] ?? null,
    largestDrop: [...drops].sort((a, b) => b.removed - a.removed)[0] ?? null,
    totalRemoved: drops.reduce((sum, stage) => sum + stage.removed, 0),
    survivingTracks,
  };
}

function topGenreFamiliesFromPool<T extends { trackId: string; genrePrimary?: string }>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
): string[] {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const family = genreFamilyForTrack(track, classMap);
    if (!family) continue;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([family]) => family);
}

type PlaylistCriticIssue = {
  index: number;
  trackId: string;
  reason: string;
  severity: number;
};

type PlaylistCriticDiagnostics = {
  beforeQuality: number;
  afterQuality: number;
  repairedCount: number;
  qualityGatePassed: boolean;
  issues: PlaylistCriticIssue[];
  replacements: Array<{
    index: number;
    fromTrackId: string;
    toTrackId: string;
    reason: string;
    scoreLift: number;
  }>;
};

type CriticTrackShape = {
  trackId: string;
  artistName?: string;
  albumName?: string;
  energy?: number | null;
  valence?: number | null;
  genrePrimary?: string;
  genres?: unknown;
  score?: number;
  laneScore?: number | null;
  _featureQualityPenalty?: number;
  _lanePenalty?: number;
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function criticClamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function criticTrackMeta<T extends { trackId: string }>(
  track: T,
  scoreByTrack: Map<string, ScoredLibraryTrack<T>>,
): CriticTrackShape {
  const scored = scoreByTrack.get(track.trackId) as CriticTrackShape | undefined;
  const current = track as CriticTrackShape;
  return {
    ...scored,
    ...current,
    energy: current.energy ?? scored?.energy ?? null,
    valence: current.valence ?? scored?.valence ?? null,
    genrePrimary: current.genrePrimary ?? scored?.genrePrimary,
    score: current.score ?? scored?.score,
    laneScore: current.laneScore ?? scored?.laneScore,
    _featureQualityPenalty: current._featureQualityPenalty ?? scored?._featureQualityPenalty,
    _lanePenalty: current._lanePenalty ?? scored?._lanePenalty,
  };
}

function criticGenreFamily<T extends { trackId: string }>(
  track: T,
  scoreByTrack: Map<string, ScoredLibraryTrack<T>>,
  classMap: UserGenreProfile["trackClassifications"],
): string | null {
  const meta = criticTrackMeta(track, scoreByTrack);
  return genreFamilyForTrack(
    { trackId: track.trackId, genrePrimary: meta.genrePrimary },
    classMap,
  ) ?? meta.genrePrimary ?? null;
}

function criticBaseScore<T extends { trackId: string }>(
  track: T,
  scoreByTrack: Map<string, ScoredLibraryTrack<T>>,
): number {
  const meta = criticTrackMeta(track, scoreByTrack);
  const score = typeof meta.score === "number"
    ? meta.score
    : typeof meta.laneScore === "number"
      ? meta.laneScore
      : 0.5;
  return criticClamp01(score);
}

function criticTrackQuality<T extends { trackId: string }>(
  track: T,
  scoreByTrack: Map<string, ScoredLibraryTrack<T>>,
): number {
  const meta = criticTrackMeta(track, scoreByTrack);
  const hasAudio = typeof meta.energy === "number" || typeof meta.valence === "number";
  const featurePenalty = hasAudio ? 0 : 0.10;
  return criticClamp01(
    criticBaseScore(track, scoreByTrack) -
    ((meta._featureQualityPenalty ?? 0) * 0.18) -
    ((meta._lanePenalty ?? 0) * 0.16) -
    featurePenalty,
  );
}

function evaluatePlaylistCritic<T extends { trackId: string }>(
  tracks: T[],
  scoreByTrack: Map<string, ScoredLibraryTrack<T>>,
  classMap: UserGenreProfile["trackClassifications"],
  maxPerArtist: number,
): { quality: number; issues: PlaylistCriticIssue[] } {
  if (tracks.length === 0) return { quality: 0, issues: [] };

  const issues: PlaylistCriticIssue[] = [];
  const artistCounts = new Map<string, number>();
  for (const track of tracks) {
    const artist = criticTrackMeta(track, scoreByTrack).artistName;
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
  }

  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index];
    const meta = criticTrackMeta(track, scoreByTrack);
    const quality = criticTrackQuality(track, scoreByTrack);
    if (quality < 0.46) {
      issues.push({ index, trackId: track.trackId, reason: "low_track_quality", severity: round3(0.46 - quality) });
    }
    if ((meta._featureQualityPenalty ?? 0) > 0) {
      issues.push({ index, trackId: track.trackId, reason: "feature_fallback_pick", severity: round3((meta._featureQualityPenalty ?? 0) * 0.35) });
    }
    if ((meta._lanePenalty ?? 0) > 0) {
      issues.push({ index, trackId: track.trackId, reason: "lane_relaxation_pick", severity: round3((meta._lanePenalty ?? 0) * 0.30) });
    }

    const previous = tracks[index - 1];
    const next = tracks[index + 1];
    const artist = meta.artistName;
    if (artist && previous && criticTrackMeta(previous, scoreByTrack).artistName === artist) {
      issues.push({ index, trackId: track.trackId, reason: "adjacent_artist_repeat", severity: 0.34 });
    }
    if (artist && (artistCounts.get(artist) ?? 0) > maxPerArtist) {
      issues.push({ index, trackId: track.trackId, reason: "artist_over_cap", severity: 0.28 });
    }

    const genre = criticGenreFamily(track, scoreByTrack, classMap);
    if (
      genre &&
      previous &&
      next &&
      criticGenreFamily(previous, scoreByTrack, classMap) === genre &&
      criticGenreFamily(next, scoreByTrack, classMap) === genre
    ) {
      issues.push({ index, trackId: track.trackId, reason: "genre_run", severity: 0.20 });
    }

    if (typeof meta.energy === "number" && previous) {
      const previousEnergy = criticTrackMeta(previous, scoreByTrack).energy;
      if (typeof previousEnergy === "number" && Math.abs(meta.energy - previousEnergy) >= 0.48) {
        issues.push({ index, trackId: track.trackId, reason: "harsh_energy_jump", severity: 0.22 });
      }
    }
  }

  const averageQuality = tracks.reduce(
    (sum, track) => sum + criticTrackQuality(track, scoreByTrack),
    0,
  ) / tracks.length;
  const issuePenalty = Math.min(0.35, issues.reduce((sum, issue) => sum + issue.severity, 0) / Math.max(8, tracks.length * 3));
  return {
    quality: round3(criticClamp01(averageQuality - issuePenalty)),
    issues: issues.sort((a, b) => b.severity - a.severity).slice(0, 12),
  };
}

function repairPlaylistWithCritic<T extends { trackId: string }>(
  tracks: T[],
  candidatePool: ScoredLibraryTrack<T>[],
  classMap: UserGenreProfile["trackClassifications"],
  maxPerArtist: number,
  playlistLength: number,
): { tracks: T[]; diagnostics: PlaylistCriticDiagnostics } {
  const scoreByTrack = new Map(candidatePool.map((track) => [track.trackId, track]));
  const before = evaluatePlaylistCritic(tracks, scoreByTrack, classMap, maxPerArtist);
  const repaired = [...tracks];
  const replacements: PlaylistCriticDiagnostics["replacements"] = [];
  const usedTrackIds = new Set(repaired.map((track) => track.trackId));
  const repairBudget = Math.min(6, Math.max(1, Math.floor(playlistLength * 0.25)));
  const repairTargets = before.issues
    .filter((issue) => issue.severity >= 0.18)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, repairBudget);

  for (const issue of repairTargets) {
    const current = repaired[issue.index];
    if (!current) continue;
    const currentQuality = criticTrackQuality(current, scoreByTrack);
    const previous = repaired[issue.index - 1];
    const next = repaired[issue.index + 1];
    const artistCounts = new Map<string, number>();
    for (const track of repaired) {
      const artist = criticTrackMeta(track, scoreByTrack).artistName;
      if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    }

    const replacement = candidatePool
      .filter((candidate) => !usedTrackIds.has(candidate.trackId))
      .map((candidate) => {
        const meta = criticTrackMeta(candidate, scoreByTrack);
        const artist = meta.artistName;
        const genre = criticGenreFamily(candidate, scoreByTrack, classMap);
        const previousMeta = previous ? criticTrackMeta(previous, scoreByTrack) : null;
        const nextMeta = next ? criticTrackMeta(next, scoreByTrack) : null;
        const artistPenalty =
          (artist && (artistCounts.get(artist) ?? 0) >= maxPerArtist ? 0.25 : 0) +
          (artist && previousMeta?.artistName === artist ? 0.25 : 0) +
          (artist && nextMeta?.artistName === artist ? 0.18 : 0);
        const genrePenalty = genre && previous && next &&
          criticGenreFamily(previous, scoreByTrack, classMap) === genre &&
          criticGenreFamily(next, scoreByTrack, classMap) === genre
          ? 0.16
          : 0;
        const energyPenalty = typeof meta.energy === "number"
          ? Math.max(
            previousMeta && typeof previousMeta.energy === "number" ? Math.max(0, Math.abs(meta.energy - previousMeta.energy) - 0.40) * 0.35 : 0,
            nextMeta && typeof nextMeta.energy === "number" ? Math.max(0, Math.abs(meta.energy - nextMeta.energy) - 0.40) * 0.25 : 0,
          )
          : 0.08;
        return {
          candidate,
          replacementScore: criticTrackQuality(candidate, scoreByTrack) - artistPenalty - genrePenalty - energyPenalty,
        };
      })
      .sort((a, b) => b.replacementScore - a.replacementScore)[0];

    if (!replacement || replacement.replacementScore < currentQuality + 0.04) continue;
    repaired[issue.index] = replacement.candidate as unknown as T;
    usedTrackIds.delete(current.trackId);
    usedTrackIds.add(replacement.candidate.trackId);
    replacements.push({
      index: issue.index,
      fromTrackId: current.trackId,
      toTrackId: replacement.candidate.trackId,
      reason: issue.reason,
      scoreLift: round3(replacement.replacementScore - currentQuality),
    });
  }

  const after = evaluatePlaylistCritic(repaired, scoreByTrack, classMap, maxPerArtist);
  return {
    tracks: repaired,
    diagnostics: {
      beforeQuality: before.quality,
      afterQuality: after.quality,
      repairedCount: replacements.length,
      qualityGatePassed: after.quality >= 0.58 || replacements.length === 0,
      issues: after.issues,
      replacements,
    },
  };
}

function hasLaneReadyEra(track: {
  releaseYear?: number | null;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
}): boolean {
  if (track.releaseYear) return detectEraFromYear(track.releaseYear) !== "any";
  return estimateEraFromAudio(track) !== "any";
}

function genreFamilyRejectionReason<T extends { trackId: string; genrePrimary?: string }>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): string | null {
  const classification = classMap.get(track.trackId);
  if (!classification) return "missingClassification";
  if (!classification.genrePrimary && !track.genrePrimary) return "missingGenrePrimary";
  if (!genreFamilyForTrack(track, classMap)) return "missingGenreFamily";
  return null;
}

function laneReadinessReason<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): string | null {
  const genreReason = genreFamilyRejectionReason(track, classMap);
  if (genreReason) return genreReason;
  if (track.energy === null) return "missingEnergy";
  if (!hasLaneReadyEra(track)) return "missingEra";
  return null;
}

function isV3LaneReady<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): boolean {
  return !!genreFamilyForTrack(track, classMap) &&
    track.energy !== null &&
    hasLaneReadyEra(track);
}

function isV3LaneReadyForIntent<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  lockedIntent: LockedIntent,
): boolean {
  if (!genreFamilyForTrack(track, classMap)) return false;
  if (track.energy === null && track.valence === null) return false;
  return lockedIntent.eraRange ? hasLaneReadyEra(track) : true;
}

function intentLaneReadinessReason<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  lockedIntent: LockedIntent,
): string | null {
  const genreReason = genreFamilyRejectionReason(track, classMap);
  if (genreReason) return genreReason;
  if (track.energy === null && track.valence === null) return "missingEnergyAndValence";
  if (lockedIntent.eraRange && !hasLaneReadyEra(track)) return "missingEra";
  return null;
}

function trackMatchesLockedIntent<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  lockedIntent: LockedIntent,
): boolean {
  if (!trackMatchesGenreFamilies(track, classMap, lockedIntent.genreFamilies)) return false;
  const classification = classMap.get(track.trackId);
  return trackMatchesConstraints({
    ...track,
    genreFamily: classification?.genreFamily ?? classification?.genrePrimary ?? track.genrePrimary,
    genrePrimary: classification?.genrePrimary ?? track.genrePrimary,
    laneEra: track.releaseYear ? detectEraFromYear(track.releaseYear) : estimateEraFromAudio(track),
  }, lockedIntent);
}

function lockedIntentRejectionReason<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  lockedIntent: LockedIntent,
): string | null {
  const classification = classMap.get(track.trackId);
  if (!classification) return "missingClassification";
  if (!classification.genrePrimary && !track.genrePrimary) return "missingGenrePrimary";
  const genreFamily = classification?.genreFamily ?? classification?.genrePrimary ?? track.genrePrimary;
  const genrePrimary = classification?.genrePrimary ?? track.genrePrimary;
  const laneEra = track.releaseYear ? detectEraFromYear(track.releaseYear) : estimateEraFromAudio(track);
  const normalizedGenre = genreFamily ? getGenreFamily(genreFamily) : genrePrimary ? getGenreFamily(genrePrimary) : null;
  if (!normalizedGenre || normalizedGenre === "unknown") return "missingGenreFamily";
  if (lockedIntent.eraRange && laneEra === "any") return "missingEra";
  if (lockedIntent.genreFamilies.length > 0 && normalizedGenre && !lockedIntent.genreFamilies.includes(normalizedGenre)) {
    return "genreMismatch";
  }
  if (!trackMatchesConstraints({
    ...track,
    genreFamily,
    genrePrimary,
    laneEra,
  }, lockedIntent)) return lockedIntent.eraRange ? "eraMismatch" : "lockedIntentFailure";
  return null;
}

function countPreV3Reasons<T>(
  tracks: T[],
  reasonOf: (track: T) => string | null,
): Record<string, number> {
  const reasons: Record<string, number> = {};
  for (const track of tracks) {
    const reason = reasonOf(track);
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return reasons;
}

function duplicateSuppressionReasons<T extends { trackId: string }>(tracks: T[]): Record<string, number> {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const track of tracks) {
    if (seen.has(track.trackId)) duplicates++;
    seen.add(track.trackId);
  }
  return duplicates > 0 ? { duplicateTrackId: duplicates } : {};
}

function familyCount<T extends { trackId: string; genrePrimary?: string }>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
): number {
  return new Set(
    tracks
      .map((track) => genreFamilyForTrack(track, classMap))
      .filter((family): family is string => !!family)
  ).size;
}

function familyDistribution<T extends { trackId: string; genrePrimary?: string }>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const track of tracks) {
    const family = genreFamilyForTrack(track, classMap);
    if (!family) continue;
    distribution[family] = (distribution[family] ?? 0) + 1;
  }
  return distribution;
}

function dominantFamilyShare(distribution: Record<string, number>): {
  family: string | null;
  share: number;
} {
  const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);
  if (total === 0) return { family: null, share: 0 };
  const [family, count] = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { family, share: count / total };
}

function adjacentGenreFamilies(family: string | null): string[] {
  switch (family) {
    case "indie":
      return ["rock", "folk", "pop", "electronic"];
    case "rock":
      return ["indie", "folk", "blues", "pop"];
    case "country":
      return ["folk", "blues", "rock"];
    case "electronic":
      return ["pop", "hip_hop", "rnb", "indie"];
    case "hip_hop":
      return ["rnb", "soul", "electronic", "pop"];
    case "rnb":
      return ["soul", "hip_hop", "pop", "jazz"];
    case "jazz":
      return ["soul", "blues", "rnb"];
    case "folk":
      return ["country", "indie", "rock"];
    case "pop":
      return ["indie", "electronic", "rnb", "rock"];
    default:
      return [];
  }
}

function uncollapseV11CandidatePool<T extends {
  trackId: string;
  genrePrimary?: string;
}>(
  initialPool: T[],
  expandedPool: T[],
  classMap: UserGenreProfile["trackClassifications"],
  playlistLength: number,
): { tracks: T[]; diagnostics: Record<string, unknown> } {
  const availableFamilyCount = familyCount(expandedPool, classMap);
  const initialDistribution = familyDistribution(initialPool, classMap);
  const initialDominant = dominantFamilyShare(initialDistribution);
  const collapseDetected =
    initialDominant.share > 0.70 ||
    familyCount(initialPool, classMap) < Math.min(3, availableFamilyCount);

  if (!collapseDetected || availableFamilyCount < 2) {
    return {
      tracks: initialPool,
      diagnostics: {
        collapseDetected,
        availableFamilyCount,
        dominantFamily: initialDominant.family,
        dominantShare: Math.round(initialDominant.share * 1000) / 1000,
        uncollapseApplied: false,
      },
    };
  }

  const targetFamilyCount = Math.min(3, availableFamilyCount);
  const targetSize = Math.max(initialPool.length, Math.min(expandedPool.length, Math.max(playlistLength * 10, 90)));
  const usedIds = new Set(initialPool.map((track) => track.trackId));
  const out = [...initialPool];
  const allFamilies = topGenreFamiliesFromPool(expandedPool, classMap);
  const preferredFamilies = [
    ...adjacentGenreFamilies(initialDominant.family),
    ...allFamilies,
  ].filter((family, index, families) =>
    family !== initialDominant.family && families.indexOf(family) === index
  );

  function addFirstFromFamily(family: string): void {
    const candidate = expandedPool.find((track) =>
      !usedIds.has(track.trackId) &&
      genreFamilyForTrack(track, classMap) === family
    );
    if (!candidate) return;
    usedIds.add(candidate.trackId);
    out.push(candidate);
  }

  function diversityTargetMet(): boolean {
    return familyCount(out, classMap) >= targetFamilyCount &&
      dominantFamilyShare(familyDistribution(out, classMap)).share <= 0.70;
  }

  for (const family of preferredFamilies) {
    if (familyCount(out, classMap) >= targetFamilyCount) break;
    addFirstFromFamily(family);
  }

  for (const track of expandedPool) {
    if (out.length >= targetSize && diversityTargetMet()) break;
    if (usedIds.has(track.trackId)) continue;
    const family = genreFamilyForTrack(track, classMap);
    if (!family || family === initialDominant.family) continue;
    usedIds.add(track.trackId);
    out.push(track);
  }

  for (const track of expandedPool) {
    if (out.length >= targetSize && diversityTargetMet()) break;
    if (usedIds.has(track.trackId)) continue;
    usedIds.add(track.trackId);
    out.push(track);
  }

  const finalDistribution = familyDistribution(out, classMap);
  const finalDominant = dominantFamilyShare(finalDistribution);

  return {
    tracks: out,
    diagnostics: {
      collapseDetected,
      availableFamilyCount,
      dominantFamily: initialDominant.family,
      dominantShare: Math.round(initialDominant.share * 1000) / 1000,
      finalDominantFamily: finalDominant.family,
      finalDominantShare: Math.round(finalDominant.share * 1000) / 1000,
      uncollapseApplied: true,
      targetFamilyCount,
    },
  };
}

function buildV3CandidatePool<T extends {
  trackId: string;
  genrePrimary?: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  sorted: T[],
  classMap: UserGenreProfile["trackClassifications"],
  playlistLength: number,
  lockedIntent: LockedIntent,
  logger?: import("pino").Logger,
): { tracks: T[]; diagnostics: Record<string, unknown> } {
  const forensicPreV3Trace: PreV3TraceStage[] = [];
  forensicPreV3Trace.push(preV3StageTrace("initial scored track count", sorted.length, sorted.length));
  const genreReady = sorted.filter((track) => !!genreFamilyForTrack(track, classMap));
  forensicPreV3Trace.push(preV3StageTrace(
    "genre family normalization",
    sorted.length,
    genreReady.length,
    countPreV3Reasons(sorted, (track) => genreFamilyForTrack(track, classMap) ? null : "missingGenreFamily"),
  ));
  const laneReady = sorted.filter((track) => isV3LaneReady(track, classMap));
  forensicPreV3Trace.push(preV3StageTrace(
    "lane readiness filter",
    sorted.length,
    laneReady.length,
    countPreV3Reasons(sorted, (track) => laneReadinessReason(track, classMap)),
  ));
  const intentLaneReady = sorted.filter((track) => isV3LaneReadyForIntent(track, classMap, lockedIntent));
  forensicPreV3Trace.push(preV3StageTrace(
    "metadata completeness filter",
    sorted.length,
    intentLaneReady.length,
    countPreV3Reasons(sorted, (track) => intentLaneReadinessReason(track, classMap, lockedIntent)),
  ));
  forensicPreV3Trace.push(preV3StageTrace(
    "era readiness filter",
    intentLaneReady.length,
    lockedIntent.eraRange ? laneReady.length : intentLaneReady.length,
    lockedIntent.eraRange
      ? countPreV3Reasons(intentLaneReady, (track) => hasLaneReadyEra(track) ? null : "missingEra")
      : {},
  ));
  const effectiveLaneReady = lockedIntent.eraRange ? laneReady : intentLaneReady;
  const intentReady = effectiveLaneReady.filter((track) =>
    trackMatchesLockedIntent(track, classMap, lockedIntent)
  );
  forensicPreV3Trace.push(preV3StageTrace(
    "intent readiness filter",
    effectiveLaneReady.length,
    intentReady.length,
    countPreV3Reasons(effectiveLaneReady, (track) => lockedIntentRejectionReason(track, classMap, lockedIntent)),
  ));
  const baseWindow = Math.min(intentReady.length, Math.max(playlistLength * 8, 75));
  let windowSize = baseWindow;
  while (windowSize < intentReady.length && familyCount(intentReady.slice(0, windowSize), classMap) < 3) {
    windowSize = Math.min(intentReady.length, windowSize + Math.max(playlistLength * 4, 25));
  }
  const initialTracks = intentReady.slice(0, windowSize);
  const expandedWindowSize = Math.min(
    intentReady.length,
    Math.max(windowSize, Math.max(playlistLength * 12, 120))
  );
  const uncollapsed = uncollapseV11CandidatePool(
    initialTracks,
    intentReady.slice(0, expandedWindowSize),
    classMap,
    playlistLength,
  );
  const tracks = uncollapsed.tracks;
  forensicPreV3Trace.push(preV3StageTrace(
    "duplicate suppression",
    tracks.length,
    new Set(tracks.map((track) => track.trackId)).size,
    duplicateSuppressionReasons(tracks),
  ));
  forensicPreV3Trace.push(preV3StageTrace("final candidate pool count", intentReady.length, tracks.length));
  const summary = preV3Summary(forensicPreV3Trace, tracks.length);
  logger?.info({
    initialScoredTracks: sorted.length,
    finalCandidatePool: tracks.length,
    forensicPreV3Trace,
    preV3Summary: summary,
  }, "Pre-V3 candidate pool diagnostics");
  return {
    tracks,
    diagnostics: {
      inputCount: sorted.length,
      laneReadyCount: laneReady.length,
      intentLaneReadyCount: intentLaneReady.length,
      laneReadinessEraRelaxed: !lockedIntent.eraRange,
      intentReadyCount: intentReady.length,
      candidateCount: tracks.length,
      genreFamilyClusters: familyCount(tracks, classMap),
      expandedForFamilySpread: windowSize > baseWindow,
      forensicPreV3Trace,
      preV3Summary: summary,
      v11Uncollapse: uncollapsed.diagnostics,
    },
  };
}

function buildV3LockedIntent<T extends {
  trackId: string;
  genrePrimary?: string;
  releaseYear?: number | null;
}>(
  unifiedIntentContext: UnifiedIntentContext,
  previousUnifiedIntentContext: UnifiedIntentContext | null,
  profile: EmotionProfile,
  candidatePool: T[],
  classMap: UserGenreProfile["trackClassifications"],
  explicitGenreFamilies: string[],
): LockedIntent {
  const poolGenreFamilies = topGenreFamiliesFromPool(candidatePool, classMap);
  return completeLockedIntent(unifiedIntentContext.lockedIntent, {
    genreFamilies: explicitGenreFamilies.length > 0
      ? explicitGenreFamilies
      : poolGenreFamilies.length > 0
        ? poolGenreFamilies
        : previousUnifiedIntentContext?.lockedIntent.genreFamilies,
    eraRange: eraRangeFromCandidatePool(candidatePool) ?? previousUnifiedIntentContext?.lockedIntent.eraRange,
    mood: previousUnifiedIntentContext?.lockedIntent.mood.length ? previousUnifiedIntentContext.lockedIntent.mood : moodFallbackFromProfile(profile),
    activity: previousUnifiedIntentContext?.lockedIntent.activity ?? "listening",
    energy: energyIntentFromProfile(profile),
  });
}

export function buildPlaylistPipeline<T extends {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  score?: number;
  rediscoveryScore?: number;
}>(
  opts: BuildPlaylistPipelineOpts<T>
): BuildPlaylistPipelineResult<T> {
  const scoring = runScoringPipeline({
    pipelineLog: opts.pipelineLog,
    tracks: opts.likedSongs,
    vibe: opts.vibe,
    mode: opts.mode,
    emotionProfile: opts.emotionProfile,
    vibeKind: opts.vibeKind,
    intent: opts.intent,
    canonical: opts.canonical,
    prototype: opts.prototype,
    sonicProfile: opts.sonicProfile,
    userGenreProfile: opts.userGenreProfile,
    genreStack: opts.genreStack,
    playlistLength: opts.playlistLength,
    memoryByTrack: opts.memoryByTrack,
    noveltyByTrack: opts.noveltyByTrack,
    recentPlaylistTrackIds: opts.recentPlaylistTrackIds,
    varietyPenaltyScale: opts.varietyPenaltyScale,
    referencePlaylist: opts.referencePlaylist,
    noLibraryMode: opts.noLibraryMode,
    postScore: {
      ...opts.postScore,
      emotionProfile: opts.emotionProfile,
    },
  });

  const sortedPool = scoring.sorted;

  // ─────────────────────────────────────────────────────────────────────────
  // V3 MULTI-LANE ARCHITECTURE
  //
  //   Step 1: Multi-axis intent decomposition → Scene Influence Map
  //   Step 2: Router  → 2–5 independent lanes (core/emotional/motion/contrast)
  //   Step 3: Per-lane scoring   (isolated signal weights per lane type)
  //   Step 4: Per-lane sampling  (structural diversity: 35%/50%/60% hard caps)
  //   Step 5: Cross-lane interleaving + stabilization pass
  //
  // No global ranking — each lane is a mini recommender.
  // Fallback is also multi-lane (spec §8) — never a generic mood.
  // ─────────────────────────────────────────────────────────────────────────

  const classMap = opts.userGenreProfile.trackClassifications;
  const unifiedIntentContext = buildUnifiedIntentContext(
    opts.vibe,
    opts.emotionProfile,
    {},
    [
      unifiedIntentFromControllerIntent(opts.humanIntent, opts.emotionProfile),
      unifiedIntentFromV11Intent(opts.intent, opts.emotionProfile),
    ],
  );
  const preGenerationMomentMemory = getMomentMemory(opts.momentMemoryKey);
  const memoryAdjustedUnifiedIntent = injectMomentContext(
    unifiedIntentContext.unifiedIntent,
    preGenerationMomentMemory,
  );
  const unifiedIntentContextWithMemory: UnifiedIntentContext = {
    ...unifiedIntentContext,
    unifiedIntent: memoryAdjustedUnifiedIntent,
    diagnostics: {
      ...unifiedIntentContext.diagnostics,
      resolver: {
        ...unifiedIntentContext.diagnostics.resolver,
        intent: memoryAdjustedUnifiedIntent,
      },
    },
  };
  const previousUnifiedIntentContext = opts.lastSuccessfulVibe?.trim()
    ? buildUnifiedIntentContext(opts.lastSuccessfulVibe, opts.emotionProfile)
    : null;
  const intentContract = buildIntentContract(opts.vibe);
  const retrieval = buildRetrievalPools(
    scoring.sorted as Array<ScoredLibraryTrack<IntentContractTrack> & { artistName?: string }>,
    intentContract,
    classMap,
    opts.postScore.feedbackMemory ?? null,
  );
  const pooledCandidates = flattenRetrievalPools(retrieval) as ScoredLibraryTrack<T>[];
  const contractSafePool = enforceIntentContract(
    pooledCandidates as unknown as Array<ScoredLibraryTrack<IntentContractTrack>>,
    intentContract,
  ) as unknown as ScoredLibraryTrack<T>[];
  // GUARANTEE:
  // Playlist output MUST remain inside Intent Contract bounds
  // before ANY widening or fallback logic is applied.
  // No fallback stage may violate genre/mood/era/context intent.
  const contractGuard = constrainPoolToIntentContract(contractSafePool, classMap, intentContract);
  const truthContradictedCount = intentContract.genreFamilies.length > 0
    ? contractGuard.pool.filter((track) => contradictsExplicitGenreTruth(track, intentContract.genreFamilies)).length
    : 0;
  const contractGuardedScoredPool = intentContract.genreFamilies.length > 0
    ? contractGuard.pool.filter((track) => !contradictsExplicitGenreTruth(track, intentContract.genreFamilies))
    : contractGuard.pool;
  const explicitPromptGenreFamilies = intentContract.genreFamilies;
  const v3LockedIntent = buildV3LockedIntent(
    unifiedIntentContextWithMemory,
    previousUnifiedIntentContext,
    opts.emotionProfile,
    contractGuardedScoredPool as unknown as Array<T & { genrePrimary?: string; releaseYear?: number | null }>,
    classMap,
    explicitPromptGenreFamilies,
  );
  const unifiedIntentDiagnostics = resolveUnifiedIntent([
    ...unifiedIntentContextWithMemory.diagnostics.snapshots,
    unifiedIntentFromLockedIntent(v3LockedIntent),
    unifiedIntentFromSceneIntent(v3LockedIntent.sceneIntent),
  ]);
  opts.pipelineLog?.info({
    sampleTrack: scoring.sorted[0] ?? null,
    hasEnergy: scoring.sorted.filter((track) => track.energy != null).length,
    hasValence: scoring.sorted.filter((track) => track.valence != null).length,
  }, "Spotify feature coverage before V3");

  let t = Date.now();
  // GUARANTEE:
  // Playlist quality is determined by multi-candidate evaluation.
  // No single-pass generation is allowed to directly return final output.
  // All playlists must be scored and optionally repaired before return.
  const candidateInputs: Array<{ label: string; pool: ScoredLibraryTrack<T>[]; seedOffset: number }> = [
    {
      label: "strict_intent",
      pool: flattenRetrievalPools({
        core: retrieval.core,
        anchor: retrieval.anchor,
        adjacent: [],
        bridge: [],
        energyArc: retrieval.energyArc,
        discovery: [],
      }) as ScoredLibraryTrack<T>[],
      seedOffset: 0,
    },
    {
      label: "adjacent_bridge",
      pool: flattenRetrievalPools({
        core: retrieval.core.slice(0, 80),
        anchor: retrieval.anchor.slice(0, 40),
        adjacent: retrieval.adjacent,
        bridge: retrieval.bridge,
        energyArc: retrieval.energyArc,
        discovery: [],
      }) as ScoredLibraryTrack<T>[],
      seedOffset: 9973,
    },
    {
      label: "discovery_energy_arc",
      pool: flattenRetrievalPools({
        core: retrieval.core.slice(0, 80),
        anchor: retrieval.anchor.slice(0, 40),
        adjacent: retrieval.adjacent.slice(0, 60),
        bridge: retrieval.bridge.slice(0, 60),
        energyArc: retrieval.energyArc,
        discovery: retrieval.discovery,
      }) as ScoredLibraryTrack<T>[],
      seedOffset: 19937,
    },
  ];
  const candidateAttempts = candidateInputs.map((candidate) => {
    const candidatePool = buildV3CandidatePool(
      (candidate.pool.length > 0 ? candidate.pool : contractGuardedScoredPool) as unknown as Array<T & { genrePrimary?: string; releaseYear?: number | null }>,
      classMap,
      opts.playlistLength,
      v3LockedIntent,
      opts.pipelineLog,
    );
    const result = runV3Pipeline(
      candidatePool.tracks as unknown as T[],
      opts.vibe,
      opts.emotionProfile,
      opts.playlistLength,
      {
        genreByTrack:          (trackId) => classMap.get(trackId)?.genrePrimary ?? "unknown",
        classificationByTrack: (trackId) => classMap.get(trackId),
        noveltyByTrack:        opts.noveltyByTrack,
        seed:                  opts.postScore.startMs + candidate.seedOffset,
        lockedIntent:          v3LockedIntent,
        unifiedIntentContext:   unifiedIntentContextWithMemory,
        momentMemory:           preGenerationMomentMemory,
      }
    );
    const quality = evaluatePlaylistQuality(
      result.finalTracks as unknown as IntentContractTrack[],
      intentContract,
      classMap,
    );
    return {
      label: candidate.label,
      candidatePool,
      result,
      quality,
      total: quality.overall + Math.min(0.1, result.finalTracks.length / Math.max(1, opts.playlistLength) * 0.1),
    };
  });
  const selectedCandidate = [...candidateAttempts].sort((a, b) => b.total - a.total)[0] ?? candidateAttempts[0];
  const v3CandidatePool = selectedCandidate.candidatePool;
  const v3 = selectedCandidate.result;
  const controlledGenerationDiagnostics = {
    selectedCandidate: selectedCandidate.label,
    candidateScores: candidateAttempts.map((candidate) => ({
      label: candidate.label,
      selectedCount: candidate.result.finalTracks.length,
      total: round3(candidate.total),
      quality: candidate.quality,
    })),
  };
  opts.pipelineLog?.info({
    preV3PoolSize: v3CandidatePool.tracks.length,
    forensicPreV3Trace: v3CandidatePool.diagnostics["forensicPreV3Trace"],
    ...controlledGenerationDiagnostics,
  }, "Pre-V3 candidate pool built");
  logScoringStage(opts.pipelineLog, "V3 multi-lane pipeline complete", t, {
    poolSize: v3CandidatePool.tracks.length,
    selectedCount: v3.finalTracks.length,
    ...controlledGenerationDiagnostics,
    lanes: (v3.diagnostics["lanes"] as Array<{ laneId: string }>)?.map((l) => l.laneId),
    preV3Recovery: v3CandidatePool.diagnostics,
    intentContractGuard: contractGuard.diagnostics,
    retrievalPools: {
      core: retrieval.core.length,
      anchor: retrieval.anchor.length,
      adjacent: retrieval.adjacent.length,
      bridge: retrieval.bridge.length,
      energyArc: retrieval.energyArc.length,
      discovery: retrieval.discovery.length,
    },
  });

  // V3 final tracks are authoritative; do not rehydrate from scored tracks here,
  // or V3 metadata such as sourceLane/laneScore/clusterIds can be dropped.
  const finalTracksList = v3.finalTracks as V3MetadataTrack<T>[];
  const finalHardFilterTrace = {
    stage: "final hard-filter count",
    before: v3.finalTracks.length,
    after: finalTracksList.length,
    removed: Math.max(0, v3.finalTracks.length - finalTracksList.length),
    topReasons: v3.finalTracks.length > finalTracksList.length
      ? [{ reason: "v3_output_to_controller_drop", count: v3.finalTracks.length - finalTracksList.length }]
      : [],
    sourceFile: "backend/core/playlist-pipeline.ts",
    functionName: "buildPlaylistPipeline",
  };

  const lastResortPool: ScoredLibraryTrack<T>[] = contractGuardedScoredPool
    .filter((track) => track.genrePrimary || track.energy != null || track.valence != null)
    .slice(0, 50);
  const emergencyScoredPool: ScoredLibraryTrack<T>[] = contractGuardedScoredPool
    .filter((track) => typeof track.score === "number")
    .slice(0, 50);

  function resolveFinalTracks(
    pool: ScoredLibraryTrack<T>[],
    fallbackLabel: string,
  ): BuildPlaylistPipelineResult<T> | null {
    if (!pool.length) return null;

    const resolvedPool = pool.slice(0, 50);
    const enforcedResolved = enforceFinalPlaylistGenres({
      finalTracks: resolvedPool,
      sortedPool: contractGuardedScoredPool,
      userGenreProfile: opts.userGenreProfile,
      genreStack: opts.genreStack,
      allowHoliday: opts.genrePost.allowHoliday,
      suppressGenres: opts.genrePost.suppressGenres,
      coverageState: scoring.coverageState,
      genreForecast: scoring.genreForecast,
      sceneInfluenceRatio: 0,
      stabilityDiagnostics: scoring.stabilityDiagnostics,
    });
    const resolvedTracks = enforcedResolved.tracks.length > 0
      ? enforcedResolved.tracks
      : resolvedPool;
    const resolvedMomentMemory = updateMomentMemory({
      unifiedIntent: memoryAdjustedUnifiedIntent,
      finalPlaylistEmbedding: buildPlaylistEmbedding(resolvedTracks).centroidVector,
      memoryKey: opts.momentMemoryKey,
    });

    return {
      finalTracks: resolvedTracks,
      sorted: scoring.sorted,
      scoringDiagnostics: {
        ...scoring.scoringDiagnostics,
        unifiedIntent: unifiedIntentDiagnostics,
        momentMemory: {
          recentStates: resolvedMomentMemory.recentStates.length,
          decayWeight: Math.round(resolvedMomentMemory.aggregatedState.decayWeight * 1000) / 1000,
        },
        v3Pipeline: {
          ...v3.diagnostics,
          forensicPoolTrace: {
            ...((v3.diagnostics["forensicPoolTrace"] as Record<string, unknown> | undefined) ?? {}),
            finalHardFilterTrace,
          },
          fallback: fallbackLabel,
          preV3Recovery: v3CandidatePool.diagnostics,
          intentContractGuard: contractGuard.diagnostics,
          controlledGeneration: controlledGenerationDiagnostics,
          retrievalPools: {
            core: retrieval.core.length,
            anchor: retrieval.anchor.length,
            adjacent: retrieval.adjacent.length,
            bridge: retrieval.bridge.length,
            energyArc: retrieval.energyArc.length,
            discovery: retrieval.discovery.length,
          },
        },
      },
      hybridExcludedCount: scoring.hybridExcludedCount,
      genreAudit: enforcedResolved.genreAudit,
      ecosystemDebug: null,
      composeMeta: {
        structured: resolvedTracks,
        poolTarget: opts.playlistLength,
        afterDeadZone: resolvedTracks,
        afterSmoothing: resolvedTracks,
        afterArtistSep: resolvedTracks,
        afterArc: resolvedTracks,
        emotionalPeakTrackId: null,
        emotionalPeakIndex: null,
        gradientPhases: { start: 0, explore: 0, peak: 0, resolve: resolvedTracks.length },
      },
    };
  }

  // GUARANTEE: playlist pipeline must NEVER return empty tracks.
  // All filters must degrade gracefully, not eliminate entire pool.
  // Last-resort fallback: V3 produced nothing (no audio features / empty lib)
  if (finalTracksList.length === 0) {
    const rawFallbackPool = (
      v3CandidatePool.tracks.length > 0
        ? v3CandidatePool.tracks
        : contractGuardedScoredPool
    ) as unknown as ScoredLibraryTrack<T>[];
    const fallbackPool = rawFallbackPool
      .filter((track) => !!track)
      .map((track) => ({
        ...track,
        energy: safeFeature(track.energy),
        valence: safeFeature(track.valence),
        _featureQualityPenalty: (track as { _featureQualityPenalty?: number })._featureQualityPenalty ?? 0.4,
      })) as unknown as ScoredLibraryTrack<T>[];
    if (v3CandidatePool.tracks.length === 0) {
      opts.pipelineLog?.warn({
        code: "EMPTY_POOL_RECOVERY",
        message: "Primary V3 pool empty — falling back safely",
        v3CandidateCount: v3CandidatePool.tracks?.length ?? 0,
        allTracks: scoring.sorted.length,
      });
    }
    if (fallbackPool.length === 0) {
      opts.pipelineLog?.error({
        code: "EMPTY_POOL_FATAL",
        message: "Even fallback pool is empty — returning safe global sample",
      });
      const safeGlobalTracks: ScoredLibraryTrack<T>[] = contractGuardedScoredPool.filter((track) => {
        const featureAwareTrack = track as ScoredLibraryTrack<T> & { genres?: unknown };
        const hasAudioFeatures =
          typeof track.energy === "number" ||
          typeof track.valence === "number";

        const hasGenre = Array.isArray(featureAwareTrack.genres)
          ? featureAwareTrack.genres.length > 0
          : !!track.genrePrimary;

        return hasAudioFeatures || hasGenre;
      }).slice(0, 50);
      const resolvedSafeGlobal = resolveFinalTracks(safeGlobalTracks, "global_sample_used");
      if (resolvedSafeGlobal) return resolvedSafeGlobal;

      const resolvedLastResort = resolveFinalTracks(lastResortPool, "last_resort_scored_sorted");
      if (resolvedLastResort) return resolvedLastResort;

      if (lastResortPool.length === 0) {
        opts.pipelineLog?.error({
          code: "EMPTY_POOL_FATAL",
          message: "No usable tracks even after global fallback",
        });
      }
      const resolvedEmergencyScored = resolveFinalTracks(emergencyScoredPool, "emergency_scored_pool");
      if (resolvedEmergencyScored) return resolvedEmergencyScored;
    }
    const recentTrackPenalty = opts.recentPlaylistTrackIds?.length
      ? buildRecentTrackPoolPenalty(opts.recentPlaylistTrackIds, 5, opts.varietyPenaltyScale ?? 1)
      : undefined;
    const composed = composePlaylistFromPool({
      sortedPool: fallbackPool,
      playlistLength: opts.playlistLength,
      mode: opts.mode,
      maxPerArtist: opts.maxPerArtist,
      emotionProfile: opts.emotionProfile,
      vibeKind: opts.vibeKind,
      journeyArc: opts.journeyArc,
      surpriseMix: opts.surpriseMix,
      humanIntent: opts.humanIntent,
      vibe: opts.vibe,
      canonical: opts.canonical,
      recentTrackPenalty,
      ecosystemVector: undefined,
    });
    const enforcedFallback = enforceFinalPlaylistGenres({
      finalTracks: composed.finalTracks,
      sortedPool: fallbackPool,
      userGenreProfile: opts.userGenreProfile,
      genreStack: opts.genreStack,
      allowHoliday: opts.genrePost.allowHoliday,
      suppressGenres: opts.genrePost.suppressGenres,
      coverageState: scoring.coverageState,
      genreForecast: scoring.genreForecast,
      sceneInfluenceRatio: scoring.sceneInfluenceRatio,
      stabilityDiagnostics: scoring.stabilityDiagnostics,
    });
    if (enforcedFallback.tracks.length === 0) {
      const resolvedFallback = resolveFinalTracks(fallbackPool, "fallback_enforcement_empty") ??
        resolveFinalTracks(lastResortPool, "last_resort_scored_sorted");
      if (resolvedFallback) return resolvedFallback;
    }
    const fallbackMomentMemory = updateMomentMemory({
      unifiedIntent: memoryAdjustedUnifiedIntent,
      finalPlaylistEmbedding: buildPlaylistEmbedding(enforcedFallback.tracks).centroidVector,
      memoryKey: opts.momentMemoryKey,
    });
    return {
      finalTracks: enforcedFallback.tracks,
      sorted: scoring.sorted,
      scoringDiagnostics: {
        ...scoring.scoringDiagnostics,
        unifiedIntent: unifiedIntentDiagnostics,
        momentMemory: {
          recentStates: fallbackMomentMemory.recentStates.length,
          decayWeight: Math.round(fallbackMomentMemory.aggregatedState.decayWeight * 1000) / 1000,
        },
        v3Pipeline: {
          ...v3.diagnostics,
          forensicPoolTrace: {
            ...((v3.diagnostics["forensicPoolTrace"] as Record<string, unknown> | undefined) ?? {}),
            finalHardFilterTrace,
          },
          fallback: true,
          reason: "empty_library",
          preV3Recovery: v3CandidatePool.diagnostics,
          intentContractGuard: contractGuard.diagnostics,
          controlledGeneration: controlledGenerationDiagnostics,
          retrievalPools: {
            core: retrieval.core.length,
            anchor: retrieval.anchor.length,
            adjacent: retrieval.adjacent.length,
            bridge: retrieval.bridge.length,
            energyArc: retrieval.energyArc.length,
            discovery: retrieval.discovery.length,
          },
        },
      },
      hybridExcludedCount: scoring.hybridExcludedCount,
      genreAudit: enforcedFallback.genreAudit,
      ecosystemDebug: null,
      composeMeta: {
        structured: enforcedFallback.tracks,
        poolTarget: opts.playlistLength,
        afterDeadZone: enforcedFallback.tracks,
        afterSmoothing: enforcedFallback.tracks,
        afterArtistSep: enforcedFallback.tracks,
        afterArc: enforcedFallback.tracks,
        emotionalPeakTrackId: composed.emotionalPeakTrackId,
        emotionalPeakIndex: composed.emotionalPeakIndex,
        gradientPhases: composed.gradientPhases,
      },
    };
  }

  if (!finalTracksList?.length) {
    opts.pipelineLog?.error({
      code: "CRITICAL_PIPELINE_BUG",
      message: "All fallback layers failed",
    });
    const emergencyFallback = resolveFinalTracks(lastResortPool, "emergency_guard");
    if (emergencyFallback) return emergencyFallback;
    const emergencyScoredFallback = resolveFinalTracks(emergencyScoredPool, "emergency_scored_pool");
    if (emergencyScoredFallback) return emergencyScoredFallback;
  }

  const playlistCritic = repairPlaylistWithCritic(
    finalTracksList as T[],
    contractGuardedScoredPool,
    classMap,
    opts.maxPerArtist,
    opts.playlistLength,
  );
  const criticFinalTracks = playlistCritic.tracks;

  // Genre enforcement safety net — this is applied to the returned playlist,
  // after the critic repair loop, so explicit genre drift is corrected before serialization.
  t = Date.now();
  const enforced = enforceFinalPlaylistGenres({
    finalTracks: [...criticFinalTracks] as unknown as ScoredLibraryTrack<T>[],
    sortedPool: contractGuardedScoredPool,
    userGenreProfile: opts.userGenreProfile,
    genreStack: opts.genreStack,
    allowHoliday: opts.genrePost.allowHoliday,
    suppressGenres: opts.genrePost.suppressGenres,
    coverageState: scoring.coverageState,
    genreForecast: scoring.genreForecast,
    sceneInfluenceRatio: 0,
    stabilityDiagnostics: scoring.stabilityDiagnostics,
  });
  logScoringStage(opts.pipelineLog, "V3 genre audit complete", t, {
    tracks: criticFinalTracks.length,
    criticQualityBefore: playlistCritic.diagnostics.beforeQuality,
    criticQualityAfter: playlistCritic.diagnostics.afterQuality,
    criticRepairs: playlistCritic.diagnostics.repairedCount,
  });
  const genreEnforcedTracks = enforced.tracks.length > 0
    ? enforced.tracks as unknown as T[]
    : criticFinalTracks;
  const explicitIntentRepair = repairExplicitIntentPurity(
    genreEnforcedTracks as unknown as IntentContractTrack[],
    contractGuardedScoredPool as unknown as Array<ScoredLibraryTrack<IntentContractTrack>>,
    intentContract,
    classMap,
    opts.playlistLength,
  );
  const finalTracksForReturn = explicitIntentRepair.tracks as unknown as T[];
  const playlistQuality = evaluatePlaylistQuality(
    finalTracksForReturn as unknown as IntentContractTrack[],
    intentContract,
    classMap,
  );
  warnIfV3MetadataLost(
    v3.finalTracks,
    finalTracksForReturn,
    "v3-output-to-create-playlist"
  );
  warnIfFieldDropped("laneScore", v3.finalTracks, finalTracksForReturn, "v3-output-to-create-playlist");
  warnIfFieldDropped("clusterIds", v3.finalTracks, finalTracksForReturn, "v3-output-to-create-playlist");
  const updatedMomentMemory = updateMomentMemory({
    unifiedIntent: memoryAdjustedUnifiedIntent,
    finalPlaylistEmbedding: buildPlaylistEmbedding(finalTracksForReturn).centroidVector,
    memoryKey: opts.momentMemoryKey,
  });

  return {
    finalTracks: finalTracksForReturn,
    sorted: scoring.sorted,
    scoringDiagnostics: {
      ...scoring.scoringDiagnostics,
      unifiedIntent: unifiedIntentDiagnostics,
      momentMemory: {
        recentStates: updatedMomentMemory.recentStates.length,
        decayWeight: Math.round(updatedMomentMemory.aggregatedState.decayWeight * 1000) / 1000,
      },
      v3Pipeline: {
        ...v3.diagnostics,
        forensicPoolTrace: {
          ...((v3.diagnostics["forensicPoolTrace"] as Record<string, unknown> | undefined) ?? {}),
          finalHardFilterTrace,
        },
        preV3Recovery: v3CandidatePool.diagnostics,
        intentContractGuard: contractGuard.diagnostics,
        explicitGenreTruthGuard: {
          active: intentContract.genreFamilies.length > 0,
          rejectedCount: truthContradictedCount,
          expectedFamilies: intentContract.genreFamilies,
        },
        controlledGeneration: controlledGenerationDiagnostics,
        retrievalPools: {
          core: retrieval.core.length,
          anchor: retrieval.anchor.length,
          adjacent: retrieval.adjacent.length,
          bridge: retrieval.bridge.length,
          energyArc: retrieval.energyArc.length,
          discovery: retrieval.discovery.length,
        },
        playlistQuality,
        playlistCritic: playlistCritic.diagnostics,
        explicitIntentRepair: explicitIntentRepair.diagnostics,
      },
    },
    hybridExcludedCount: scoring.hybridExcludedCount,
    genreAudit: enforced.genreAudit,
    ecosystemDebug: null,
    composeMeta: {
      structured: finalTracksForReturn,
      poolTarget: opts.playlistLength,
      afterDeadZone: finalTracksForReturn,
      afterSmoothing: finalTracksForReturn,
      afterArtistSep: finalTracksForReturn,
      afterArc: finalTracksForReturn,
      emotionalPeakTrackId: null,
      emotionalPeakIndex: null,
      gradientPhases: { start: 0.10, explore: 0.35, peak: 0.65, resolve: 0.85 },
    },
  };
}
