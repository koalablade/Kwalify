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
import { buildGenreAudit, type GenreAudit } from "../lib/genre-audit";
import { classifyTrack } from "../lib/genre-taxonomy";
import type { ScoredLibraryTrack } from "./scoring-engine/types";
import { logScoringStage } from "../lib/generate-stage-timer";
import type { EcosystemDebug } from "../lib/ecosystem-lock";
import { detectEraFromYear, estimateEraFromAudio } from "./v2/era-model";
import { buildLockedIntent, completeLockedIntent, type LockedIntent } from "./v3/intent";
import { trackMatchesConstraints } from "./v3/constraint-filter";
import { getGenreFamily } from "./v3/global-diversity-controller";
import type { V3MetadataTrack } from "../lib/v3-track-contract";
import { trackHasEraEvidence, trackHasKnownEraMismatch } from "../lib/era-evidence";
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
import {
  createPipelineTrace,
  recordTraceCount,
  recordTraceDuration,
  recordTraceFailure,
  recordTraceFallback,
  type PipelineTrace,
} from "../lib/pipeline-trace";
import { createFailureContext } from "../lib/failure-types";
import { buildPlaylistEmbedding } from "./v3/embedding-retrieval";
import {
  EXPANDED_ACTIVITY_TERMS,
  EXPANDED_ERA_TERMS,
  EXPANDED_EVENT_TERMS,
  EXPANDED_GENRE_ALIASES,
  EXPANDED_MOOD_TERMS,
  EXPANDED_PLACE_TERMS,
  EXPANDED_TIME_TERMS,
  termRegex,
} from "../lib/expanded-intent-vocabulary";
import {
  artistMemoryPenalty,
  buildConstraintRelaxationPlan,
  relaxedIntentForProfile,
  sessionArtistMemoryDiagnostics,
  type SessionArtistMemory,
  withSessionDiversityPressure,
} from "./v3/constraint-relaxation";

const V3_SAFETY_INPUT_MIN = 180;
const V3_SAFETY_INPUT_PER_TRACK = 12;
const V3_SAFETY_INPUT_MAX = 360;

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
  sessionArtistMemory?: SessionArtistMemory;
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
    curatorScoreByTrack?: Map<string, number>;
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
  requestId?: string;
  pipelineTrace?: PipelineTrace;
  diagnosticsMode?: "minimal" | "full";
  profileStage?: (stage: string, detail?: string) => () => void;
  progress?: (stage: "scoring" | "retrieval" | "lanes" | "sampling" | "fallback" | "coherence", detail: string) => void | Promise<void>;
  shouldAbort?: () => boolean;
}

export interface BuildPlaylistPipelineResult<T extends { trackId: string }> {
  finalTracks: T[];
  sorted: ScoredLibraryTrack<T>[];
  scoringDiagnostics: Record<string, unknown>;
  hybridExcludedCount: number;
  genreAudit: GenreAudit;
  ecosystemDebug: EcosystemDebug | null;
  pipelineTrace: PipelineTrace;
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

function normalizeGenreSignal(value?: string | null): string | null {
  if (!value || value === "unknown") return null;
  const normalized = value.toLowerCase().trim().replace(/&/g, "and").replace(/[\s-]+/g, "_");
  const family = getGenreFamily(normalized);
  return family && family !== "unknown" ? family : null;
}

function genreFamilyForTrack<T extends {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  clusterId?: string | null;
  clusterIds?: string[] | null;
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  danceability?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): string | null {
  const classification = classMap.get(track.trackId);
  const metadataGenres = [
    ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres : []),
    ...(Array.isArray(track.albumGenres) ? track.albumGenres : []),
    ...(Array.isArray(track.genres) ? track.genres : []),
  ].filter((value): value is string => typeof value === "string");
  const directSignals = [
    classification?.genreFamily,
    classification?.genrePrimary,
    track.genreFamily,
    track.genrePrimary,
    truthGenreFamily(track),
    ...metadataGenres,
    track.clusterId?.replace(/^genre:/, ""),
    ...(track.clusterIds ?? []).map((id) => id.replace(/^genre:/, "")),
  ];
  for (const signal of directSignals) {
    const family = normalizeGenreSignal(signal);
    if (family) return family;
  }
  if (track.trackName && track.artistName && track.albumName) {
    const inferred = classifyTrack({
      trackName: track.trackName,
      artistName: track.artistName,
      albumName: track.albumName,
      energy: track.energy,
      valence: track.valence,
      acousticness: track.acousticness,
      danceability: track.danceability,
      instrumentalness: track.instrumentalness,
      speechiness: track.speechiness,
      tempo: track.tempo,
    });
    return normalizeGenreSignal(inferred.genreFamily ?? inferred.genrePrimary);
  }
  return null;
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

function structuredSubgenreIntentTerms(contract: IntentContract): string[] {
  const broadTerms = new Set(
    [
      ...contract.genreFamilies,
      contract.primaryGenre,
      contract.secondarySubgenre,
      "electronic",
      "rock",
      "metal",
      "techno",
      "trance",
      "house",
      "dnb",
      "drum and bass",
      "hip hop",
    ]
      .filter((term): term is string => !!term)
      .map(normalizeIdentityTerm)
  );
  const terms = [
    contract.primarySubgenre,
    ...contract.subgenreTerms,
  ]
    .filter((term): term is string => !!term)
    .map(normalizeIdentityTerm)
    .filter((term) => term.length >= 3 && !broadTerms.has(term))
    .filter((term, index, all) => all.indexOf(term) === index);
  if (terms.length === 0 && contract.primarySubgenre) {
    terms.push(normalizeIdentityTerm(contract.primarySubgenre));
  }
  return terms;
}

function trackMatchesStructuredSubgenre<T extends IntentContractTrack>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  contract: IntentContract,
): boolean {
  const terms = structuredSubgenreIntentTerms(contract);
  if (terms.length === 0) return true;
  const classification = classMap.get(track.trackId);
  const structuredTrackTerms = [
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
  ]
    .filter((term): term is string => !!term)
    .map(normalizeIdentityTerm);
  if (terms.some((term) => structuredTrackTerms.includes(term))) return true;
  return terms.some((term) => trackIdentityText(track, classMap).includes(term));
}

function trackMatchesPrimarySubgenre<T extends IntentContractTrack>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  contract: IntentContract,
): boolean {
  if (!contract.primarySubgenre) return false;
  const primary = normalizeIdentityTerm(contract.primarySubgenre);
  const classification = classMap.get(track.trackId);
  const primaryTrackTerms = [
    classification?.primarySubgenre,
    ...(classification?.subGenres ?? []).slice(0, 2),
  ]
    .filter((term): term is string => !!term)
    .map(normalizeIdentityTerm);
  if (primaryTrackTerms.includes(primary)) return true;
  return trackIdentityText(track, classMap).includes(primary);
}

function sufficientStructuredSubgenreEvidence<T extends IntentContractTrack>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
  contract: IntentContract,
  minimum = 12,
): T[] {
  if (!contract.primarySubgenre) return [];
  const matched = tracks.filter((track) => trackMatchesStructuredSubgenre(track, classMap, contract));
  const threshold = Math.min(
    Math.max(3, minimum),
    Math.max(3, Math.ceil(tracks.length * 0.03)),
  );
  return matched.length >= threshold ? matched : [];
}

function adaptiveStructuredSubgenreMinimum(
  availableCount: number,
  requestedMinimum: number,
  floor: number,
  ratio: number,
): number {
  if (availableCount <= 0) return requestedMinimum;
  return Math.min(requestedMinimum, Math.max(floor, Math.ceil(availableCount * ratio)));
}

function structuredRetrievalScope<T extends IntentContractTrack>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
  contract: IntentContract,
  opts: {
    strictMinimum: number;
    relatedMinimum: number;
  },
): {
  pool: T[];
  mode: "none" | "primary_subgenre" | "related_subgenre" | "family";
  primaryCount: number;
  relatedCount: number;
  familyCount: number;
  strictMinimum: number;
  relatedMinimum: number;
} {
  const familyPool = contract.genreFamilies.length > 0
    ? tracks.filter((track) => trackMatchesGenreFamilies(track, classMap, contract.genreFamilies))
    : tracks;
  const evidenceBasisCount = familyPool.length > 0 ? familyPool.length : tracks.length;
  const strictMinimum = adaptiveStructuredSubgenreMinimum(evidenceBasisCount, opts.strictMinimum, 4, 0.12);
  const relatedMinimum = adaptiveStructuredSubgenreMinimum(evidenceBasisCount, opts.relatedMinimum, 6, 0.18);
  if (!contract.primarySubgenre) {
    return {
      pool: familyPool,
      mode: contract.genreFamilies.length > 0 ? "family" : "none",
      primaryCount: 0,
      relatedCount: 0,
      familyCount: familyPool.length,
      strictMinimum,
      relatedMinimum,
    };
  }
  const primaryPool = tracks.filter((track) => trackMatchesPrimarySubgenre(track, classMap, contract));
  const relatedPool = tracks.filter((track) => trackMatchesStructuredSubgenre(track, classMap, contract));
  if (primaryPool.length >= strictMinimum) {
    return {
      pool: primaryPool,
      mode: "primary_subgenre",
      primaryCount: primaryPool.length,
      relatedCount: relatedPool.length,
      familyCount: familyPool.length,
      strictMinimum,
      relatedMinimum,
    };
  }
  if (relatedPool.length >= relatedMinimum) {
    return {
      pool: relatedPool,
      mode: "related_subgenre",
      primaryCount: primaryPool.length,
      relatedCount: relatedPool.length,
      familyCount: familyPool.length,
      strictMinimum,
      relatedMinimum,
    };
  }
  return {
    pool: familyPool.length > 0 ? familyPool : tracks,
    mode: "family",
    primaryCount: primaryPool.length,
    relatedCount: relatedPool.length,
    familyCount: familyPool.length,
    strictMinimum,
    relatedMinimum,
  };
}

const KNOWN_ARTIST_GENRE_TRUTH: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /\bnas\b/i, family: "hip_hop" },
  { pattern: /\bxxxtentacion\b/i, family: "hip_hop" },
  { pattern: /\bbob\s+marley\b/i, family: "reggae" },
  { pattern: /\bthe\s+doors\b/i, family: "rock" },
  { pattern: /\bblondie\b/i, family: "rock" },
  { pattern: /\btame\s+impala\b/i, family: "indie" },
  { pattern: /\beminem\b/i, family: "hip_hop" },
  { pattern: /\brockwell\b/i, family: "pop" },
];

const SPOTIFY_TRUTH_TERMS: Record<string, string[]> = {
  country: ["country", "americana", "red dirt", "outlaw country", "bluegrass"],
  hip_hop: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap", "emo rap"],
  rock: ["rock", "new wave", "post-punk", "punk", "grunge", "psychedelic", "album rock"],
  reggae: ["reggae", "dancehall", "dub", "rocksteady"],
  pop: ["pop", "dance pop", "synthpop"],
  indie: ["indie", "alternative indie", "neo-psychedelic", "pov: indie"],
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

function hasPositiveExplicitGenreEvidence(
  track: {
    trackId: string;
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
    genrePrimary?: string | null;
  },
  classMap: UserGenreProfile["trackClassifications"],
  explicitFamilies: string[],
): boolean {
  if (explicitFamilies.length === 0) return true;

  const classification = classMap.get(track.trackId);
  const family = genreFamilyForTrack(track, classMap);
  const localClassification = classifyTrack({
    trackName: track.trackName ?? "",
    artistName: track.artistName ?? "",
    albumName: track.albumName ?? "",
    energy: null,
    valence: null,
  });
  const cachedDiagnostics = classification?.diagnostics;
  const cachedHasLocalEvidence =
    !!classification &&
    !!family &&
    explicitFamilies.includes(family) &&
    cachedDiagnostics?.taxonomyHit === true &&
    cachedDiagnostics.audioFallbackUsed !== true &&
    cachedDiagnostics.patternMatched !== "spotify_genre_metadata" &&
    (!!cachedDiagnostics.artistHintMatched || !!cachedDiagnostics.patternMatched);
  const candidateClassification =
    cachedHasLocalEvidence
      ? classification
      : localClassification;
  const candidateFamily = getGenreFamily(
    candidateClassification.genreFamily ?? candidateClassification.genrePrimary
  );
  if (!candidateFamily || !explicitFamilies.includes(candidateFamily)) return false;

  const diagnostics = candidateClassification.diagnostics;
  const hasTextEvidence = diagnostics?.taxonomyHit === true &&
    diagnostics.audioFallbackUsed !== true &&
    diagnostics.patternMatched !== "spotify_genre_metadata" &&
    (!!diagnostics.artistHintMatched || !!diagnostics.patternMatched);
  return hasTextEvidence;
}

type IntentContract = {
  genres: string[];
  primaryGenre: string | null;
  primarySubgenre: string | null;
  secondarySubgenre: string | null;
  subgenreTerms: string[];
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
  identityTerms: string[];
  explicitDimensions: string[];
};

type RetrievalPools<T> = {
  core: T[];
  adjacent: T[];
  bridge: T[];
  anchor: T[];
  discovery: T[];
  energyArc: T[];
  diagnostics?: {
    inputCount: number;
    shapedRankSourceCount?: number;
    contractRankedCount: number;
    scenePreFilterApplied?: boolean;
    sceneMismatchRejected?: number;
    subgenreScopeMode?: "none" | "primary_subgenre" | "related_subgenre" | "family";
    subgenrePrimaryCount?: number;
    subgenreRelatedCount?: number;
    subgenreFamilyCount?: number;
    subgenreStrictMinimum?: number;
    subgenreRelatedMinimum?: number;
    subgenrePoolTooSmall?: boolean;
    retrievalExpandedDueToStarvation?: boolean;
    retrievalExpansionReason?: string | null;
    retrievalSignalCoverage?: {
      hasSubgenreSignal: boolean;
      hasFamilySignal: boolean;
      hasTextSignal: boolean;
      subgenreMatchCount: number;
      familyMatchCount: number;
      textMatchCount: number;
      signalCoverageScore: number;
    };
    retrievalSignalMapping?: {
      queryCanonicalization: string;
      mappedSubgenreKeys: string[];
      mappedFamilyKeys: string[];
      mappedTextAnchors: string[];
      ontologyHitRate: number;
      embeddingFallbackUsed: boolean;
      retrievalSignalSourceBreakdown: {
        ontologyMatch: number;
        embeddingMatch: number;
        hybridMatch: number;
        fallbackOnly: number;
      };
    };
    fallbackLevelUsed?: "none" | "family" | "adjacent" | "global";
    familyFallbackEmpty?: boolean;
  };
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
  strictCount?: number;
  relaxedCount?: number;
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
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
};

const IDENTITY_STOPWORDS = new Set([
  "music",
  "songs",
  "playlist",
  "tracks",
  "track",
  "for",
  "with",
  "and",
  "the",
  "that",
  "feel",
  "feels",
  "vibe",
  "vibes",
  "make",
  "made",
  "good",
  "best",
]);

function normalizeIdentityTerm(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueNormalizedTerms(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => value ? normalizeIdentityTerm(value) : "")
    .filter((value) => value.length >= 2)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function ontologyTermTokens(): Set<string> {
  const ontologyTerms = [
    ...EXPANDED_GENRE_ALIASES.flatMap((group) => [group.family, ...group.terms]),
    ...EXPANDED_ERA_TERMS.flatMap((era) => [era.label, ...era.terms]),
    ...Object.values(EXPANDED_MOOD_TERMS).flat(),
    ...Object.values(EXPANDED_ACTIVITY_TERMS).flat(),
    ...Object.values(EXPANDED_PLACE_TERMS).flat(),
    ...Object.values(EXPANDED_TIME_TERMS).flat(),
    ...EXPANDED_EVENT_TERMS,
  ];
  return new Set(
    ontologyTerms
      .flatMap((term) => normalizeIdentityTerm(term).split(/\s+/))
      .filter((token) => token.length >= 2 && !IDENTITY_STOPWORDS.has(token))
  );
}

const ONTOLOGY_TERM_TOKEN_SET = ontologyTermTokens();

function ontologyHitRateForPrompt(queryCanonicalization: string): number {
  const queryTokens = queryCanonicalization
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !IDENTITY_STOPWORDS.has(token));
  if (queryTokens.length === 0) return 0;
  const matched = queryTokens.filter((token) => ONTOLOGY_TERM_TOKEN_SET.has(token)).length;
  return Math.round((matched / queryTokens.length) * 1000) / 10;
}

function pushIdentityTerm(out: string[], seen: Set<string>, value: string): void {
  const term = normalizeIdentityTerm(value);
  if (term.length < 3 || seen.has(term) || IDENTITY_STOPWORDS.has(term)) return;
  seen.add(term);
  out.push(term);
}

function extractIdentityTerms(input: string, parsed: LockedIntent): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const addMatched = (terms: string[]): void => {
    for (const term of terms) {
      if (termRegex([term]).test(input)) pushIdentityTerm(out, seen, term);
    }
  };

  for (const group of EXPANDED_GENRE_ALIASES) addMatched(group.terms);
  for (const terms of Object.values(EXPANDED_MOOD_TERMS)) addMatched(terms);
  for (const terms of Object.values(EXPANDED_ACTIVITY_TERMS)) addMatched(terms);
  for (const terms of Object.values(EXPANDED_PLACE_TERMS)) addMatched(terms);
  for (const terms of Object.values(EXPANDED_TIME_TERMS)) addMatched(terms);
  addMatched(EXPANDED_EVENT_TERMS);

  for (const family of parsed.genreFamilies) pushIdentityTerm(out, seen, family);
  if (parsed.primaryGenre) pushIdentityTerm(out, seen, parsed.primaryGenre);
  if (parsed.primarySubgenre) pushIdentityTerm(out, seen, parsed.primarySubgenre);
  if (parsed.secondarySubgenre) pushIdentityTerm(out, seen, parsed.secondarySubgenre);
  for (const term of parsed.subgenreTerms) pushIdentityTerm(out, seen, term);
  for (const mood of parsed.mood) pushIdentityTerm(out, seen, mood);
  if (parsed.activity) pushIdentityTerm(out, seen, parsed.activity);
  if (parsed.energy) pushIdentityTerm(out, seen, parsed.energy);

  const rawTokens = normalizeIdentityTerm(input)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !IDENTITY_STOPWORDS.has(token));
  for (const token of rawTokens) pushIdentityTerm(out, seen, token);

  return out.slice(0, 16);
}

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
    parsed.primarySubgenre ? "subgenre" : null,
    parsed.eraRange ? "era" : null,
    parsed.mood.length > 0 ? "mood" : null,
    parsed.activity ? "activity" : null,
    parsed.energy ? "energy" : null,
    timeOfDay.length > 0 ? "timeOfDay" : null,
    places.length > 0 ? "place" : null,
    // Events are interpreted by the emotion/scene stack, but this contract has no
    // event-specific track matcher. Do not make event-only prompts hard-filter.
    hasEvent && (parsed.mood.length > 0 || parsed.activity || parsed.energy || places.length > 0)
      ? "event"
      : null,
  ].filter((value): value is string => !!value);
  return {
    genres: parsed.genreFamilies,
    primaryGenre: parsed.primaryGenre,
    primarySubgenre: parsed.primarySubgenre,
    secondarySubgenre: parsed.secondarySubgenre,
    subgenreTerms: parsed.subgenreTerms,
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
    identityTerms: extractIdentityTerms(input, parsed),
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
    case "introspective":
      return energy <= 0.64 && (acousticness >= 0.22 || valence <= 0.55);
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
      return energy <= 0.70 && danceability <= 0.78;
    case "gym":
      return energy >= 0.50 || tempo >= 108 || danceability >= 0.56;
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
  add(!!contract.primarySubgenre, trackMatchesStructuredSubgenre(track, classMap, contract));
  add(!!contract.eraRange, !!contract.eraRange && !trackHasKnownEraMismatch(track, contract.eraRange), true);
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

function trackCompatibleWithHardIntentContract<T extends IntentContractTrack>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  contract: IntentContract,
): boolean {
  if (
    contract.genreFamilies.length > 0 &&
    contradictsExplicitGenreTruth(track, contract.genreFamilies)
  ) {
    return false;
  }
  if (contract.eraRange && trackHasKnownEraMismatch(track, contract.eraRange)) return false;
  const family = genreFamilyForTrack(track, classMap);
  return contract.genreFamilies.length === 0 ||
    family === "unknown" ||
    trackMatchesGenreFamilies(track, classMap, contract.genreFamilies);
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
  const rareSubgenreFloor = contract.primarySubgenre
    ? Math.min(12, Math.max(4, Math.ceil(pool.length * 0.08)))
    : 0;
  const strictEnoughForNicheSubgenre = !contract.primarySubgenre || strict.length >= rareSubgenreFloor;
  const relaxed = strict.length > 0 && strictEnoughForNicheSubgenre
    ? strict
    : scored.filter(({ fit }) => fit.requiredPassed && fit.score >= 0.34);
  const hasRequiredContract = contract.genreFamilies.length > 0 || !!contract.eraRange;
  const safeMinimum = hasRequiredContract
    ? Math.min(pool.length, Math.max(12, Math.ceil(pool.length * 0.10)))
    : 0;
  const compatibleFallback = hasRequiredContract && relaxed.length < safeMinimum
    ? scored
        .filter(({ track }) => trackCompatibleWithHardIntentContract(track, classMap, contract))
        .sort((a, b) => b.fit.score - a.fit.score)
    : [];
  const selectedBase = relaxed.length > 0
    ? relaxed.map(({ track }) => track)
    : hasRequiredContract
      ? []
      : pool;
  const selected = compatibleFallback.length > 0 && selectedBase.length < safeMinimum
    ? [...selectedBase, ...compatibleFallback.map(({ track }) => track)]
        .filter((track, index, tracks) => tracks.findIndex((candidate) => candidate.trackId === track.trackId) === index)
        .slice(0, Math.max(safeMinimum, selectedBase.length))
    : selectedBase;
  const averageFit = scored.length > 0
    ? scored.reduce((sum, item) => sum + item.fit.score, 0) / scored.length
    : 0;
  return {
    pool: selected,
    diagnostics: {
      contract,
      inputCount: pool.length,
      guardedCount: selected.length,
      strictCount: strict.length,
      relaxedCount: relaxed.length,
      active: selected.length < pool.length,
      relaxed: ((!strictEnoughForNicheSubgenre || strict.length === 0) && relaxed.length > 0) ||
        compatibleFallback.length > 0,
      averageFit: round3(averageFit),
    },
  };
}

function enforceIntentContract<T extends ScoredLibraryTrack<IntentContractTrack>>(
  tracks: T[],
  intent: IntentContract,
  classMap?: UserGenreProfile["trackClassifications"],
): Array<T & { contractFitScore: number }> {
  return tracks
    .map((track) => {
      let contractFitScore = 0;
      const family = classMap ? genreFamilyForTrack(track, classMap) : track.genrePrimary ? getGenreFamily(track.genrePrimary) : null;
      if (intent.genres.length > 0 && family && intent.genres.includes(family)) contractFitScore += 3;
      if (classMap && intent.primarySubgenre && trackMatchesStructuredSubgenre(track, classMap, intent)) contractFitScore += 3;
      if (
        intent.era &&
        intent.era.start != null &&
        intent.era.end != null &&
        trackHasEraEvidence(track, { start: intent.era.start, end: intent.era.end })
      ) contractFitScore += 2;
      if (intent.moods.some((mood) => contractMoodMatch(track, mood))) contractFitScore += 2;
      if (intent.activity && contractActivityMatch(track, intent.activity)) contractFitScore += 1;
      if (intent.context && (contractActivityMatch(track, intent.activity ?? intent.context) || track.genrePrimary === intent.context)) contractFitScore += 2;
      if (intent.energyArc && intent.energyArc !== "dynamic" && intent.energyArc !== "progressive" && contractEnergyMatch(track, intent.energyArc)) contractFitScore += 2;
      if (intent.emotionalTone?.some((tone) => contractMoodMatch(track, tone))) contractFitScore += 2;
      return { ...track, contractFitScore };
    })
    .filter((track) => {
      if (intent.explicitDimensions.length === 0 || track.contractFitScore > 0) return true;
      if (!classMap || (intent.genreFamilies.length === 0 && !intent.eraRange)) return false;
      return trackCompatibleWithHardIntentContract(track, classMap, intent);
    })
    .sort((a, b) => b.contractFitScore - a.contractFitScore);
}

function feedbackPenalty<T extends IntentContractTrack & { artistName?: string | null; genrePrimary?: string | null }>(
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

function stableUnitHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function trackIdentityText<T extends IntentContractTrack>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): string {
  const classification = classMap.get(track.trackId);
  const metadata = [
    track.trackName,
    track.artistName,
    track.albumName,
    track.genrePrimary,
    genreFamilyForTrack(track, classMap),
    classification?.genrePrimary,
    classification?.genreFamily,
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
    ...(Array.isArray(track.genres) ? track.genres : []),
    ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres : []),
    ...(Array.isArray(track.albumGenres) ? track.albumGenres : []),
  ].filter((value): value is string => typeof value === "string");
  return normalizeIdentityTerm(metadata.join(" "));
}

function identityTermScore<T extends IntentContractTrack>(
  track: T,
  contract: IntentContract,
  classMap: UserGenreProfile["trackClassifications"],
): number {
  const identityText = trackIdentityText(track, classMap);
  const structuredSubgenres = [
    contract.primarySubgenre,
    contract.secondarySubgenre,
    ...contract.subgenreTerms,
  ]
    .filter((term): term is string => !!term)
    .map(normalizeIdentityTerm)
    .filter((term, index, terms) => terms.indexOf(term) === index);
  const structuredMatches = structuredSubgenres.filter((term) => identityText.includes(term));
  const structuredScore = structuredMatches.length > 0
    ? Math.min(0.18, structuredMatches.length * 0.075)
    : structuredSubgenres.length > 0 && contract.primaryGenre && identityText.includes(normalizeIdentityTerm(contract.primaryGenre))
      ? -0.10
      : 0;

  if (contract.identityTerms.length === 0) return structuredScore;
  if (!identityText) return -0.04;
  const matched = contract.identityTerms.filter((term) => identityText.includes(term));
  const requiredSpecificity = contract.identityTerms.length >= 2 ? 2 : 1;
  if (matched.length >= requiredSpecificity) return structuredScore + Math.min(0.16, matched.length * 0.055);
  if (matched.length > 0) return structuredScore + 0.035;
  const hasSpecificGenreIntent = contract.genreFamilies.length > 0 && contract.identityTerms.some((term) =>
    !contract.genreFamilies.includes(term)
  );
  return structuredScore + (hasSpecificGenreIntent ? -0.12 : -0.04);
}

function sceneIdentityCoherenceScore<T extends IntentContractTrack>(
  track: T,
  contract: IntentContract,
  classMap: UserGenreProfile["trackClassifications"],
  origin: "subgenre" | "family" | "text" | "fallback",
): number {
  const identityScore = identityTermScore(track, contract, classMap);
  const subgenreAligned = !!contract.primarySubgenre && (
    trackMatchesPrimarySubgenre(track, classMap, contract) ||
    trackMatchesStructuredSubgenre(track, classMap, contract)
  );
  const familyAligned = trackMatchesGenreFamilies(track, classMap, contract.genreFamilies);
  const eraAligned = !!contract.eraRange && trackHasEraEvidence(track, contract.eraRange);
  const eraCompatible = !!contract.eraRange && !trackHasKnownEraMismatch(track, contract.eraRange);
  const moodAligned = contract.mood.some((mood) => contractMoodMatch(track, mood));
  const activityAligned = contractActivityMatch(track, contract.activity) && !!contract.activity;
  const textAligned = identityScore > 0;
  const signalCount = [
    subgenreAligned,
    familyAligned,
    eraAligned,
    moodAligned,
    activityAligned,
    textAligned,
  ].filter(Boolean).length;

  const specificityLift =
    (activityAligned ? 0.24 : 0) +
    (moodAligned ? 0.18 : 0) +
    (textAligned ? Math.min(0.18, Math.max(0, identityScore) * 0.82) : 0) +
    (subgenreAligned ? 0.08 : 0) +
    (familyAligned && eraAligned ? 0.045 : 0) +
    (familyAligned && moodAligned ? 0.045 : 0) +
    (signalCount >= 3 ? 0.08 : signalCount >= 2 ? 0.04 : 0) +
    (eraAligned && textAligned ? 0.035 : 0);

  const weakFallbackPenalty = origin === "fallback" &&
    !subgenreAligned &&
    !familyAligned &&
    !textAligned &&
    (!contract.eraRange || !eraAligned) &&
    !moodAligned &&
    !activityAligned
    ? -0.14
    : origin === "fallback" && !textAligned && !eraAligned && !eraCompatible
      ? -0.07
      : 0;

  const requiredSceneMissPenalty =
    (contract.activity && !activityAligned ? 0.24 : 0) +
    (contract.mood.length > 0 && !moodAligned ? 0.16 : 0) +
    (contract.explicitDimensions.some((dimension) => dimension === "place" || dimension === "timeOfDay") && !textAligned ? 0.12 : 0);

  return Math.max(-0.42, Math.min(0.64, specificityLift + weakFallbackPenalty - requiredSceneMissPenalty));
}

function promptOrderingBias<T extends IntentContractTrack>(
  track: T,
  contract: IntentContract,
  classMap: UserGenreProfile["trackClassifications"],
  promptKey?: string,
): number {
  if (!promptKey) return 0;
  const fit = intentContractFit(track, classMap, contract).score;
  const energy = track.energy ?? 0.5;
  const tempo = track.tempo ?? 110;
  const valence = track.valence ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  const acousticness = track.acousticness ?? 0.4;
  const promptHash = stableUnitHash(`${promptKey}:${track.trackId}`);
  const activityLift =
    contract.activity === "gym" ? Math.max(0, Math.max(energy - 0.48, (tempo - 108) / 90, danceability - 0.52)) * 0.34 :
    contract.activity === "party" ? Math.max(0, Math.max(energy, danceability) - 0.52) * 0.28 :
    contract.activity === "focus" ? Math.max(0, 0.76 - Math.max(energy, danceability)) * 0.30 :
    contract.activity === "relaxing" || contract.activity === "sleep" ? Math.max(0, acousticness - 0.22) * 0.24 :
    0;
  const moodLift =
    contract.mood.includes("euphoric") ? Math.max(0, valence - 0.50) * 0.20 :
    contract.mood.includes("melancholic") || contract.mood.includes("dark") ? Math.max(0, 0.57 - valence) * 0.20 :
    contract.mood.includes("calm") ? Math.max(0, 0.64 - energy) * 0.18 :
    0;
  const fitLift = contract.explicitDimensions.length > 0 ? fit * 0.30 : 0;
  return fitLift + activityLift + moodLift + identityTermScore(track, contract, classMap) * 1.50 + promptHash * 0.008;
}

function earlyDiversityRank<T extends IntentContractTrack & { artistName?: string | null }>(
  entries: Array<{ track: T; adjustedScore: number }>,
  classMap: UserGenreProfile["trackClassifications"],
  contract: IntentContract,
): Array<{ track: T; adjustedScore: number }> {
  const artistCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const explicitGenre = contract.genreFamilies.length > 0;
  return [...entries]
    .sort((a, b) => b.adjustedScore - a.adjustedScore)
    .map((entry, index) => {
      const artist = entry.track.artistName?.toLowerCase().trim();
      const family = genreFamilyForTrack(entry.track, classMap);
      const artistSeen = artist ? artistCounts.get(artist) ?? 0 : 0;
      const familySeen = family ? familyCounts.get(family) ?? 0 : 0;
      if (artist) artistCounts.set(artist, artistSeen + 1);
      if (family) familyCounts.set(family, familySeen + 1);
      const artistSpacingPenalty = artistSeen * 0.11;
      const familySpacingPenalty = explicitGenre ? 0 : familySeen * 0.012;
      const rankPreservation = Math.max(0, 0.02 - index * 0.00002);
      return {
        ...entry,
        adjustedScore: entry.adjustedScore + rankPreservation - artistSpacingPenalty - familySpacingPenalty,
      };
    })
    .sort((a, b) => b.adjustedScore - a.adjustedScore);
}

function sceneConstraintActive(contract: IntentContract): boolean {
  return !!contract.activity ||
    !!contract.energy ||
    contract.mood.length > 0 ||
    contract.timeOfDay.length > 0 ||
    contract.places.length > 0;
}

function highLevelSceneMismatch<T extends IntentContractTrack>(
  track: T,
  contract: IntentContract,
  classMap: UserGenreProfile["trackClassifications"],
): boolean {
  let required = 0;
  let misses = 0;
  const add = (active: boolean, matches: boolean): void => {
    if (!active) return;
    required += 1;
    if (!matches) misses += 1;
  };
  add(!!contract.activity, contractActivityMatch(track, contract.activity));
  add(!!contract.energy, contractEnergyMatch(track, contract.energy));
  add(contract.mood.length > 0, contract.mood.some((mood) => contractMoodMatch(track, mood)));
  add(contract.timeOfDay.length > 0, contractTimeMatch(track, contract.timeOfDay));
  add(contract.places.length > 0, contractPlaceMatch(track, classMap, contract.places));
  return required > 0 && misses >= Math.max(1, Math.ceil(required * 0.55));
}

function shapeBroadCandidatePool<T extends IntentContractTrack & { artistName?: string | null }>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
  contract: IntentContract,
  limit: number,
): T[] {
  if (tracks.length <= limit) return tracks;
  const artistCounts = new Map<string, number>();
  const buckets = new Map<string, T[]>();
  for (const track of tracks) {
    const artist = track.artistName?.toLowerCase().trim();
    const artistSeen = artist ? artistCounts.get(artist) ?? 0 : 0;
    if (artist && artistSeen >= 3) continue;
    if (artist) artistCounts.set(artist, artistSeen + 1);
    const family = genreFamilyForTrack(track, classMap) ?? "unknown";
    const bucket = buckets.get(family) ?? [];
    bucket.push(track);
    buckets.set(family, bucket);
  }

  const orderedBuckets = [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([, bucket]) => bucket);
  const out: T[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  while (out.length < limit && orderedBuckets.some((bucket) => cursor < bucket.length)) {
    for (const bucket of orderedBuckets) {
      const track = bucket[cursor];
      if (!track || seen.has(track.trackId)) continue;
      seen.add(track.trackId);
      out.push(track);
      if (out.length >= limit) break;
    }
    cursor += 1;
  }
  return out;
}

function capV3IntentReadyPool<T extends {
  trackId: string;
  artistName?: string | null;
  genrePrimary?: string;
}>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
  limit: number,
): T[] {
  if (tracks.length <= limit) return tracks;
  const buckets = new Map<string, T[]>();
  const artistCounts = new Map<string, number>();
  for (const track of tracks) {
    const artist = track.artistName?.toLowerCase().trim();
    const seenArtist = artist ? artistCounts.get(artist) ?? 0 : 0;
    if (artist && seenArtist >= 4) continue;
    if (artist) artistCounts.set(artist, seenArtist + 1);
    const family = genreFamilyForTrack(track, classMap) ?? "unknown";
    const bucket = buckets.get(family) ?? [];
    bucket.push(track);
    buckets.set(family, bucket);
  }
  const orderedBuckets = [...buckets.values()].sort((a, b) => b.length - a.length);
  const out: T[] = [];
  const used = new Set<string>();
  let cursor = 0;
  while (out.length < limit && orderedBuckets.some((bucket) => cursor < bucket.length)) {
    for (const bucket of orderedBuckets) {
      const track = bucket[cursor];
      if (!track || used.has(track.trackId)) continue;
      used.add(track.trackId);
      out.push(track);
      if (out.length >= limit) break;
    }
    cursor += 1;
  }
  return out;
}

function topScoreVariance<T extends { score?: number | null }>(tracks: T[], limit = 32): number {
  const scores = tracks
    .slice(0, limit)
    .map((track) => typeof track.score === "number" ? track.score : 0)
    .filter((score) => Number.isFinite(score));
  if (scores.length < Math.min(8, limit)) return 1;
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return scores.reduce((sum, score) => sum + Math.abs(score - mean), 0) / scores.length;
}

function topArtistDiversitySatisfied<T extends { artistName?: string | null }>(tracks: T[], limit = 50): boolean {
  const counts = new Map<string, number>();
  for (const track of tracks.slice(0, limit)) {
    const artist = track.artistName?.toLowerCase().trim();
    if (!artist) continue;
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return [...counts.values()].every((count) => count <= 2);
}

function diagnosticTrack<T extends { trackId: string; trackName?: string | null; artistName?: string | null; genrePrimary?: string | null }>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): Record<string, unknown> {
  const rich = track as T & {
    score?: number;
    contractFitScore?: number;
    genreFamily?: string | null;
    genres?: unknown;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
    releaseYear?: number | null;
    energy?: number | null;
    valence?: number | null;
    scoringDebug?: { genrePrimary?: string | null };
  };
  const classification = classMap.get(track.trackId);
  return {
    trackId: track.trackId,
    trackName: rich.trackName ?? null,
    artistName: rich.artistName ?? null,
    score: typeof rich.score === "number" ? Math.round(rich.score * 1000) / 1000 : null,
    genrePrimary: rich.genrePrimary ?? classification?.genrePrimary ?? rich.scoringDebug?.genrePrimary ?? null,
    genreFamily: rich.genreFamily ?? classification?.genreFamily ?? classification?.genrePrimary ?? null,
    spotifyArtistGenres: Array.isArray(rich.spotifyArtistGenres) ? rich.spotifyArtistGenres : [],
    albumGenres: Array.isArray(rich.albumGenres) ? rich.albumGenres : [],
    releaseYear: rich.releaseYear ?? null,
    energy: rich.energy ?? null,
    valence: rich.valence ?? null,
    contractFitScore: typeof rich.contractFitScore === "number" ? rich.contractFitScore : null,
  };
}

function diagnosticPool<T extends { trackId: string; trackName?: string | null; artistName?: string | null; genrePrimary?: string | null }>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
  limit: number,
): Array<Record<string, unknown>> {
  return tracks.slice(0, limit).map((track) => diagnosticTrack(track, classMap));
}

async function yieldPipeline(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function buildRetrievalPools<T extends ScoredLibraryTrack<IntentContractTrack> & { artistName?: string | null }>(
  tracks: T[],
  contract: IntentContract,
  classMap: UserGenreProfile["trackClassifications"],
  feedback: FeedbackMemory | null = null,
  opts: {
    recentTrackPenalty?: Map<string, number>;
    sessionArtistMemory?: SessionArtistMemory;
    promptKey?: string;
    diagnosticsMode?: "minimal" | "full";
  } = {},
): Promise<RetrievalPools<T>> {
  const MIN_BROAD_RETRIEVAL_POOL = 120;
  const fullDiagnostics = opts.diagnosticsMode === "full";
  const contractSafeTracks = enforceIntentContract(tracks, contract, classMap);
  await yieldPipeline();
  const primarySubgenreMatches = new Map<string, boolean>();
  const structuredSubgenreMatches = new Map<string, boolean>();
  const genreFamilyMatches = new Map<string, boolean>();
  const contractFamilyMatches = new Map<string, boolean>();
  const identityScores = new Map<string, number>();
  const fitScores = new Map<string, number>();
  const sceneMismatches = new Map<string, boolean>();
  const primarySubgenreMatch = (track: T): boolean => {
    const cached = primarySubgenreMatches.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = trackMatchesPrimarySubgenre(track, classMap, contract);
    primarySubgenreMatches.set(track.trackId, value);
    return value;
  };
  const structuredSubgenreMatch = (track: T): boolean => {
    const cached = structuredSubgenreMatches.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = trackMatchesStructuredSubgenre(track, classMap, contract);
    structuredSubgenreMatches.set(track.trackId, value);
    return value;
  };
  const genreFamilyMatch = (track: T): boolean => {
    const cached = genreFamilyMatches.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = trackMatchesGenreFamilies(track, classMap, contract.genres);
    genreFamilyMatches.set(track.trackId, value);
    return value;
  };
  const contractFamilyMatch = (track: T): boolean => {
    const cached = contractFamilyMatches.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = trackMatchesGenreFamilies(track, classMap, contract.genreFamilies);
    contractFamilyMatches.set(track.trackId, value);
    return value;
  };
  const identityScoreFor = (track: T): number => {
    const cached = identityScores.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = identityTermScore(track, contract, classMap);
    identityScores.set(track.trackId, value);
    return value;
  };
  const fitScoreFor = (track: T): number => {
    const cached = fitScores.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = intentContractFit(track, classMap, contract).score;
    fitScores.set(track.trackId, value);
    return value;
  };
  const sceneMismatchFor = (track: T): boolean => {
    const cached = sceneMismatches.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = highLevelSceneMismatch(track, contract, classMap);
    sceneMismatches.set(track.trackId, value);
    return value;
  };
  const retrievalSignalCoverageTracks = contractSafeTracks;
  const subgenreMatchCount = fullDiagnostics && contract.primarySubgenre
    ? retrievalSignalCoverageTracks.filter(structuredSubgenreMatch).length
    : 0;
  const familyMatchCount = fullDiagnostics && contract.genres.length > 0
    ? retrievalSignalCoverageTracks.filter(genreFamilyMatch).length
    : 0;
  const textMatchCount = fullDiagnostics ? retrievalSignalCoverageTracks.filter((track) =>
    identityScoreFor(track) > 0
  ).length : 0;
  const hasSubgenreSignal = subgenreMatchCount > 0;
  const hasFamilySignal = familyMatchCount > 0;
  const hasTextSignal = textMatchCount > 0;
  const signalCoverageScore = Math.round((
    (hasSubgenreSignal ? 0.50 : 0) +
    (hasFamilySignal ? 0.30 : 0) +
    (hasTextSignal ? 0.20 : 0)
  ) * 1000) / 10;
  const queryCanonicalization = fullDiagnostics ? normalizeIdentityTerm(contract.rawPrompt) : "";
  const mappedSubgenreKeys = fullDiagnostics ? uniqueNormalizedTerms([
    contract.primarySubgenre,
    contract.secondarySubgenre,
    ...contract.subgenreTerms,
  ]) : [];
  const mappedFamilyKeys = fullDiagnostics ? uniqueNormalizedTerms([
    ...contract.genreFamilies,
    ...contract.genres,
    contract.primaryGenre,
  ]) : [];
  const mappedTextAnchors = fullDiagnostics ? uniqueNormalizedTerms(contract.identityTerms) : [];
  const ontologyHitRate = fullDiagnostics ? ontologyHitRateForPrompt(queryCanonicalization) : 0;
  const sourceBreakdown = fullDiagnostics ? retrievalSignalCoverageTracks.reduce(
    (acc, track) => {
      const ontologyMatched =
        (
          contract.primarySubgenre &&
          (
            primarySubgenreMatch(track) ||
            structuredSubgenreMatch(track)
          )
        ) ||
        contractFamilyMatch(track) ||
        identityScoreFor(track) > 0;
      const embeddingMatched =
        (track.score ?? 0) >= 0.72 ||
        (track.rediscoveryScore ?? 0) >= 0.68 ||
        (track as T & { explorationDistance?: number }).explorationDistance != null;
      if (ontologyMatched && embeddingMatched) {
        acc.hybridMatch += 1;
      } else if (ontologyMatched) {
        acc.ontologyMatch += 1;
      } else if (embeddingMatched) {
        acc.embeddingMatch += 1;
      } else {
        acc.fallbackOnly += 1;
      }
      return acc;
    },
    { ontologyMatch: 0, embeddingMatch: 0, hybridMatch: 0, fallbackOnly: 0 }
  ) : { ontologyMatch: 0, embeddingMatch: 0, hybridMatch: 0, fallbackOnly: 0 };
  const embeddingFallbackUsed = sourceBreakdown.embeddingMatch > 0 || sourceBreakdown.hybridMatch > 0;
  await yieldPipeline();
  const familyExpansionTracks = contract.genres.length > 0
    ? tracks.filter(genreFamilyMatch)
    : tracks;
  const adjacentFamilies = new Set(contract.genres.flatMap((genre) => adjacentGenreFamilies(genre)));
  const adjacentExpansionTracks = contract.genres.length > 0
    ? tracks.filter((track) => {
        const family = genreFamilyForTrack(track, classMap);
        return !!family && adjacentFamilies.has(family);
      })
    : [];
  const contractSafeTrackIds = new Set(contractSafeTracks.map((track) => track.trackId));
  const expansionSource = familyExpansionTracks.length > 0
    ? familyExpansionTracks
    : adjacentExpansionTracks.length > 0
      ? adjacentExpansionTracks
      : tracks;
  const fallbackLevelUsed = contractSafeTracks.length >= Math.min(MIN_BROAD_RETRIEVAL_POOL, Math.max(30, tracks.length))
    ? "none"
    : familyExpansionTracks.length > 0
      ? "family"
      : adjacentExpansionTracks.length > 0
        ? "adjacent"
        : tracks.length > 0
          ? "global"
          : "none";
  const contractRankSource = contractSafeTracks.length >= Math.min(MIN_BROAD_RETRIEVAL_POOL, Math.max(30, tracks.length))
    ? contractSafeTracks
    : [
        ...contractSafeTracks,
        ...expansionSource.filter((track) => !contractSafeTrackIds.has(track.trackId)),
      ].map((track) => ({
        ...track,
        contractFitScore: Math.max(
          (track as T & { contractFitScore?: number }).contractFitScore ?? 0,
          fitScoreFor(track),
          contract.genres.length > 0 && genreFamilyMatch(track) ? 0.35 : 0,
        ),
      }));
  const retrievalExpandedDueToStarvation = contractRankSource.length > contractSafeTracks.length;
  const sceneActive = sceneConstraintActive(contract);
  const sceneCompatibleRankSource = sceneActive
    ? contractRankSource.filter((track) => !sceneMismatchFor(track))
    : contractRankSource;
  const sceneMismatchRejected = sceneActive ? contractRankSource.length - sceneCompatibleRankSource.length : 0;
  const scenePreFilterApplied = sceneActive && sceneCompatibleRankSource.length >= Math.min(80, Math.max(35, Math.floor(contractRankSource.length * 0.30)));
  const sceneRankSource = scenePreFilterApplied ? sceneCompatibleRankSource : contractRankSource;
  const shapedRankSource = shapeBroadCandidatePool(
    sceneRankSource,
    classMap,
    contract,
    contract.activity || sceneActive ? 520 : 760,
  );
  await yieldPipeline();
  const contractRanked = earlyDiversityRank(
    shapedRankSource
    .map((track) => {
      const subgenreMatchWeight = contract.primarySubgenre
        ? primarySubgenreMatch(track)
          ? 0.16
          : structuredSubgenreMatch(track)
            ? 0.09
            : 0
        : 0;
      const baseScore = (track.contractFitScore * 0.20) + (track.score ?? 0) + subgenreMatchWeight - feedbackPenalty(track, feedback);
      const trackPenalty = opts.recentTrackPenalty?.get(track.trackId) ?? 0;
      const artistPenalty = artistMemoryPenalty(opts.sessionArtistMemory, track.artistName);
      const sceneMismatchPenalty = sceneMismatchFor(track) ? 0.90 : 0;
      return {
        track,
        adjustedScore: Math.max(0, baseScore + promptOrderingBias(track, contract, classMap, opts.promptKey) - trackPenalty - sceneMismatchPenalty) * artistPenalty,
      };
    }),
    classMap,
    contract,
  )
    .map(({ track }) => track as T);
  await yieldPipeline();
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
  const retrievalScope = structuredRetrievalScope(contractRanked, classMap, contract, {
    strictMinimum: 30,
    relatedMinimum: 12,
  });
  const genreMatched = contractRanked.filter(genreFamilyMatch);
  const subgenrePoolTooSmall =
    !!contract.primarySubgenre &&
    retrievalScope.mode === "family" &&
    (retrievalScope.primaryCount > 0 || retrievalScope.relatedCount > 0);
  const familyFallbackEmpty = retrievalScope.mode === "family" && retrievalScope.familyCount === 0;
  const coreSource = retrievalScope.pool.length > 0
    ? retrievalScope.pool
    : genreMatched.length > 0
      ? genreMatched
      : contractRanked;
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
    core: takeUnique(coreSource, 160),
    anchor: takeUnique(anchor, 80),
    adjacent: takeUnique(adjacent, 100),
    bridge: takeUnique([...adjacent, ...contractRanked], 80),
    energyArc: takeUnique(energyArc, 80),
    discovery: takeUnique(discovery.length > 0 ? discovery : contractRanked.slice().reverse(), 80),
    diagnostics: {
      inputCount: tracks.length,
      shapedRankSourceCount: shapedRankSource.length,
      contractRankedCount: contractRanked.length,
      scenePreFilterApplied,
      sceneMismatchRejected,
      subgenreScopeMode: retrievalScope.mode,
      subgenrePrimaryCount: retrievalScope.primaryCount,
      subgenreRelatedCount: retrievalScope.relatedCount,
      subgenreFamilyCount: retrievalScope.familyCount,
      subgenreStrictMinimum: retrievalScope.strictMinimum,
      subgenreRelatedMinimum: retrievalScope.relatedMinimum,
      subgenrePoolTooSmall,
      retrievalExpandedDueToStarvation,
      retrievalExpansionReason: retrievalExpandedDueToStarvation
        ? "contract_pool_below_minimum_broad_retrieval_pool"
        : subgenrePoolTooSmall
          ? "subgenre_pool_below_threshold_using_family_weighted_pool"
          : null,
      retrievalSignalCoverage: {
        hasSubgenreSignal,
        hasFamilySignal,
        hasTextSignal,
        subgenreMatchCount,
        familyMatchCount,
        textMatchCount,
        signalCoverageScore,
      },
      retrievalSignalMapping: {
        queryCanonicalization,
        mappedSubgenreKeys,
        mappedFamilyKeys,
        mappedTextAnchors,
        ontologyHitRate,
        embeddingFallbackUsed,
        retrievalSignalSourceBreakdown: sourceBreakdown,
      },
      fallbackLevelUsed,
      familyFallbackEmpty,
    },
  };
}

function activityPromptKind(vibe: string, profile: EmotionProfile): "gym" | "party" | null {
  const lower = vibe.toLowerCase();
  if (profile.environment === "gym" || /\b(?:gym|workout|training|pump|cardio|run|running|lifting|weights)\b/.test(lower)) {
    return "gym";
  }
  if (profile.environment === "party" || /\b(?:party|club|dancefloor|pre\s*drinks|night\s*out|rave)\b/.test(lower)) {
    return "party";
  }
  return null;
}

function diversityPressureForViablePool(kind: "gym" | "party" | null, viablePoolSize: number): number {
  if (kind === "gym") {
    if (viablePoolSize < 50) return 0.35;
    if (viablePoolSize < 100) return 0.55;
    if (viablePoolSize < 180) return 0.90;
    return 1.10;
  }
  if (kind === "party") {
    if (viablePoolSize < 50) return 0.50;
    if (viablePoolSize < 120) return 0.90;
    return 1.10;
  }
  return 1;
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

function repairExplicitIntentPurity<T extends IntentContractTrack & { artistName?: string | null; score?: number }>(
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
    ? playlist.filter((track) => !trackHasKnownEraMismatch(track, eraRange)).length / Math.max(1, playlist.length)
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
    .filter(({ track, fit }) =>
      (fit.requiredPassed && fit.score >= 0.50) ||
      (trackCompatibleWithHardIntentContract(track, classMap, intent) && fit.score >= 0.34)
    )
    .sort((a, b) => (b.fit.score + (b.track.score ?? 0) * 0.10) - (a.fit.score + (a.track.score ?? 0) * 0.10));

  const repairBudget = Math.min(Math.max(4, Math.floor(playlistLength * 0.35)), candidateRank.length);
  const targets = repaired
    .map((track, index) => {
      const fit = intentContractFit(track, classMap, intent);
      const hardCompatible = trackCompatibleWithHardIntentContract(track, classMap, intent);
      const reasons = [
        genreActive && !hardCompatible ? "genre" : null,
        eraRange && trackHasKnownEraMismatch(track, eraRange) ? "era" : null,
        !hardCompatible || fit.score < 0.34 ? "intent_fit" : null,
      ].filter((reason): reason is string => !!reason);
      return { track, index, fit, reasons };
    })
    .filter(({ reasons }) => reasons.length > 0)
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

function repairPlaylistWithQualityLock<T extends { trackId: string }>(
  tracks: T[],
  candidatePool: ScoredLibraryTrack<T>[],
  classMap: UserGenreProfile["trackClassifications"],
  maxPerArtist: number,
  playlistLength: number,
): { tracks: T[]; diagnostics: PlaylistCriticDiagnostics & { implemented: true; guard: "qualityLock" } } {
  const scoreByTrack = new Map(candidatePool.map((track) => [track.trackId, track]));
  const before = evaluatePlaylistCritic(tracks, scoreByTrack, classMap, maxPerArtist);
  const repaired = [...tracks];
  const replacements: PlaylistCriticDiagnostics["replacements"] = [];
  const usedTrackIds = new Set<string>();
  const duplicateTrackIds = new Set<string>();
  for (const track of repaired) {
    if (usedTrackIds.has(track.trackId)) duplicateTrackIds.add(track.trackId);
    usedTrackIds.add(track.trackId);
  }

  const repairBudget = Math.min(5, Math.max(1, Math.floor(playlistLength * 0.18)));
  const artistCounts = new Map<string, number>();
  for (const track of repaired) {
    const artist = criticTrackMeta(track, scoreByTrack).artistName;
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
  }

  const lockTargets = before.issues
    .filter((issue) =>
      issue.reason === "artist_over_cap" ||
      issue.reason === "adjacent_artist_repeat" ||
      issue.reason === "feature_fallback_pick" ||
      issue.reason === "low_track_quality" ||
      duplicateTrackIds.has(issue.trackId)
    )
    .sort((a, b) => b.severity - a.severity)
    .slice(0, repairBudget);

  for (const issue of lockTargets) {
    const current = repaired[issue.index];
    if (!current) continue;
    const currentArtist = criticTrackMeta(current, scoreByTrack).artistName;
    const previous = repaired[issue.index - 1];
    const next = repaired[issue.index + 1];
    const currentQuality = criticTrackQuality(current, scoreByTrack);
    const replacement = candidatePool
      .filter((candidate) => !usedTrackIds.has(candidate.trackId))
      .map((candidate) => {
        const meta = criticTrackMeta(candidate, scoreByTrack);
        const artist = meta.artistName;
        const previousArtist = previous ? criticTrackMeta(previous, scoreByTrack).artistName : null;
        const nextArtist = next ? criticTrackMeta(next, scoreByTrack).artistName : null;
        const artistRepeatPenalty =
          (artist && (artistCounts.get(artist) ?? 0) >= maxPerArtist ? 0.28 : 0) +
          (artist && previousArtist === artist ? 0.25 : 0) +
          (artist && nextArtist === artist ? 0.20 : 0);
        return {
          candidate,
          replacementScore: criticTrackQuality(candidate, scoreByTrack) - artistRepeatPenalty,
        };
      })
      .sort((a, b) => b.replacementScore - a.replacementScore)[0];

    if (!replacement || replacement.replacementScore < currentQuality + 0.03) continue;
    repaired[issue.index] = replacement.candidate as unknown as T;
    usedTrackIds.delete(current.trackId);
    usedTrackIds.add(replacement.candidate.trackId);
    if (currentArtist) artistCounts.set(currentArtist, Math.max(0, (artistCounts.get(currentArtist) ?? 1) - 1));
    const replacementArtist = criticTrackMeta(replacement.candidate, scoreByTrack).artistName;
    if (replacementArtist) artistCounts.set(replacementArtist, (artistCounts.get(replacementArtist) ?? 0) + 1);
    replacements.push({
      index: issue.index,
      fromTrackId: current.trackId,
      toTrackId: replacement.candidate.trackId,
      reason: duplicateTrackIds.has(issue.trackId) ? "duplicate_track" : issue.reason,
      scoreLift: round3(replacement.replacementScore - currentQuality),
    });
  }

  const after = evaluatePlaylistCritic(repaired, scoreByTrack, classMap, maxPerArtist);
  return {
    tracks: repaired,
    diagnostics: {
      implemented: true,
      guard: "qualityLock",
      beforeQuality: before.quality,
      afterQuality: after.quality,
      repairedCount: replacements.length,
      qualityGatePassed: after.quality >= before.quality,
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

function hasIntentEraSignal(track: {
  releaseYear?: number | null;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
}, range: NonNullable<LockedIntent["eraRange"]>): boolean {
  if (trackHasEraEvidence(track, range)) return true;
  if (trackHasKnownEraMismatch(track, range)) return false;
  return hasLaneReadyEra(track);
}

function genreFamilyRejectionReason<T extends {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  clusterId?: string | null;
  clusterIds?: string[] | null;
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  danceability?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): string | null {
  if (!genreFamilyForTrack(track, classMap)) return "missingGenreFamily";
  return null;
}

function laneReadinessReason<T extends {
  trackId: string;
  genrePrimary?: string | null;
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
  if (!hasLaneReadyEra(track)) return "missingEra";
  return null;
}

function isV3LaneReady<T extends {
  trackId: string;
  genrePrimary?: string | null;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): boolean {
  return !!genreFamilyForTrack(track, classMap) &&
    hasLaneReadyEra(track);
}

function isV3LaneReadyForIntent<T extends {
  trackId: string;
  genrePrimary?: string | null;
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
  return lockedIntent.eraRange ? !trackHasKnownEraMismatch(track, lockedIntent.eraRange) : true;
}

function intentLaneReadinessReason<T extends {
  trackId: string;
  genrePrimary?: string | null;
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
  if (lockedIntent.eraRange && trackHasKnownEraMismatch(track, lockedIntent.eraRange)) return "eraMismatch";
  return null;
}

function trackMatchesLockedIntent<T extends {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  clusterId?: string | null;
  clusterIds?: string[] | null;
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
  const resolvedFamily = genreFamilyForTrack(track, classMap);
  return trackMatchesConstraints({
    ...track,
    genreFamily: resolvedFamily ?? classification?.genreFamily ?? classification?.genrePrimary ?? track.genrePrimary,
    genrePrimary: classification?.genrePrimary ?? track.genrePrimary,
    laneEra: track.releaseYear ? detectEraFromYear(track.releaseYear) : estimateEraFromAudio(track),
  }, lockedIntent);
}

function lockedIntentRejectionReason<T extends {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  clusterId?: string | null;
  clusterIds?: string[] | null;
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
  const genreFamily = genreFamilyForTrack(track, classMap) ??
    classification?.genreFamily ??
    classification?.genrePrimary ??
    track.genrePrimary;
  const genrePrimary = classification?.genrePrimary ?? track.genrePrimary;
  const laneEra = track.releaseYear ? detectEraFromYear(track.releaseYear) : estimateEraFromAudio(track);
  const normalizedGenre = genreFamily ? getGenreFamily(genreFamily) : genrePrimary ? getGenreFamily(genrePrimary) : null;
  if (!normalizedGenre || normalizedGenre === "unknown") return "missingGenreFamily";
  if (lockedIntent.eraRange && trackHasKnownEraMismatch(track, lockedIntent.eraRange)) return "eraMismatch";
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
  artistName?: string | null;
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
  opts: {
    minimumFillRatio?: number;
  } = {},
  logger?: import("pino").Logger,
): { tracks: T[]; diagnostics: Record<string, unknown> } {
  const forensicPreV3Trace: PreV3TraceStage[] = [];
  const relaxationPlan = buildConstraintRelaxationPlan(lockedIntent);
  const genreFamilyCache = new Map<string, string | null>();
  const laneReadyCache = new Map<string, boolean>();
  const laneReadinessReasonCache = new Map<string, string | null>();
  const intentLaneReadyCache = new Map<string, boolean>();
  const intentLaneReadinessReasonCache = new Map<string, string | null>();
  const eraSignalCache = new Map<string, boolean>();
  const lockedIntentRejectionReasonCache = new Map<string, string | null>();
  const relaxedIntentMatchCache = new Map<string, boolean>();
  const genreFamilyFor = (track: T): string | null => {
    const cached = genreFamilyCache.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = genreFamilyForTrack(track, classMap);
    genreFamilyCache.set(track.trackId, value);
    return value;
  };
  const laneReadyFor = (track: T): boolean => {
    const cached = laneReadyCache.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = isV3LaneReady(track, classMap);
    laneReadyCache.set(track.trackId, value);
    return value;
  };
  const laneReadinessReasonFor = (track: T): string | null => {
    const cached = laneReadinessReasonCache.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = laneReadinessReason(track, classMap);
    laneReadinessReasonCache.set(track.trackId, value);
    return value;
  };
  const intentLaneReadyFor = (track: T): boolean => {
    const cached = intentLaneReadyCache.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = isV3LaneReadyForIntent(track, classMap, lockedIntent);
    intentLaneReadyCache.set(track.trackId, value);
    return value;
  };
  const intentLaneReadinessReasonFor = (track: T): string | null => {
    const cached = intentLaneReadinessReasonCache.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = intentLaneReadinessReason(track, classMap, lockedIntent);
    intentLaneReadinessReasonCache.set(track.trackId, value);
    return value;
  };
  const eraSignalFor = (track: T): boolean => {
    if (!lockedIntent.eraRange) return true;
    const cached = eraSignalCache.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = hasIntentEraSignal(track, lockedIntent.eraRange);
    eraSignalCache.set(track.trackId, value);
    return value;
  };
  const lockedIntentRejectionReasonFor = (track: T): string | null => {
    const cached = lockedIntentRejectionReasonCache.get(track.trackId);
    if (cached !== undefined) return cached;
    const value = lockedIntentRejectionReason(track, classMap, lockedIntent);
    lockedIntentRejectionReasonCache.set(track.trackId, value);
    return value;
  };
  const minimumCandidateCount = Math.max(
    Math.ceil(playlistLength * (opts.minimumFillRatio ?? 0.8)),
    Math.min(12, playlistLength),
  );
  forensicPreV3Trace.push(preV3StageTrace("initial scored track count", sorted.length, sorted.length));
  const genreReady = sorted.filter((track) => !!genreFamilyFor(track));
  forensicPreV3Trace.push(preV3StageTrace(
    "genre family normalization",
    sorted.length,
    genreReady.length,
    countPreV3Reasons(sorted, (track) => genreFamilyFor(track) ? null : "missingGenreFamily"),
  ));
  const laneReady = sorted.filter(laneReadyFor);
  forensicPreV3Trace.push(preV3StageTrace(
    "lane readiness filter",
    sorted.length,
    laneReady.length,
    countPreV3Reasons(sorted, laneReadinessReasonFor),
  ));
  const intentLaneReady = sorted.filter(intentLaneReadyFor);
  const eraReady = lockedIntent.eraRange
    ? intentLaneReady.filter(eraSignalFor)
    : intentLaneReady;
  const eraReadyIds = new Set(eraReady.map((track) => track.trackId));
  forensicPreV3Trace.push(preV3StageTrace(
    "metadata completeness filter",
    sorted.length,
    intentLaneReady.length,
    countPreV3Reasons(sorted, intentLaneReadinessReasonFor),
  ));
  forensicPreV3Trace.push(preV3StageTrace(
    "era readiness filter",
    intentLaneReady.length,
    eraReady.length,
    lockedIntent.eraRange
      ? countPreV3Reasons(intentLaneReady, (track) => {
          if (trackHasKnownEraMismatch(track, lockedIntent.eraRange!)) return "eraMismatch";
          if (!eraSignalFor(track)) return "unknownEra";
          return eraReadyIds.has(track.trackId) ? null : "eraMismatch";
        })
      : {},
  ));
  const strictEffectiveLaneReady = lockedIntent.eraRange ? eraReady : intentLaneReady;
  const relaxationAttempts = relaxationPlan.map((step) => {
    const relaxedIntent = relaxedIntentForProfile(lockedIntent, step.profile);
    const sourcePool = step.profile.genre === "strict"
      ? intentLaneReady
      : step.profile.mood === "relaxed"
        ? laneReady
        : genreReady;
    const tracks = sourcePool.filter((track) => {
      const cacheKey = `${step.label}:${track.trackId}`;
      const cached = relaxedIntentMatchCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const value = trackMatchesLockedIntent(track, classMap, relaxedIntent);
      relaxedIntentMatchCache.set(cacheKey, value);
      return value;
    });
    return {
      step: step.label,
      profile: step.profile,
      candidateCount: tracks.length,
      tracks,
    };
  });
  const selectedRelaxation = relaxationAttempts.find((attempt) => attempt.candidateCount >= minimumCandidateCount)
    ?? relaxationAttempts.find((attempt) => attempt.candidateCount > 0)
    ?? relaxationAttempts[0];
  const effectiveLaneReady = selectedRelaxation?.step === "strict_constraints" ? strictEffectiveLaneReady : selectedRelaxation?.tracks ?? [];
  const rawIntentReady = selectedRelaxation?.tracks ?? [];
  const broadSceneIntent = !!lockedIntent.activity || !!lockedIntent.energy || lockedIntent.mood.length > 0;
  const intentReadyCap = Math.min(
    rawIntentReady.length,
    broadSceneIntent
      ? Math.max(260, playlistLength * 16)
      : Math.max(420, playlistLength * 22),
  );
  const intentReady = capV3IntentReadyPool(rawIntentReady, classMap, intentReadyCap);
  forensicPreV3Trace.push(preV3StageTrace(
    "intent readiness filter",
    selectedRelaxation?.step === "strict_constraints" ? effectiveLaneReady.length : sorted.length,
    intentReady.length,
    countPreV3Reasons(
      selectedRelaxation?.step === "strict_constraints" ? effectiveLaneReady : sorted,
      lockedIntentRejectionReasonFor,
    ),
  ));
  const baseWindow = Math.min(intentReady.length, Math.max(playlistLength * 8, 75));
  let windowSize = baseWindow;
  let expansionIterations = 0;
  const maxWindowExpansionIterations = 6;
  while (
    windowSize < intentReady.length &&
    familyCount(intentReady.slice(0, windowSize), classMap) < 3 &&
    expansionIterations < maxWindowExpansionIterations
  ) {
    windowSize = Math.min(intentReady.length, windowSize + Math.max(playlistLength * 4, 25));
    expansionIterations += 1;
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
      rawIntentReadyCount: rawIntentReady.length,
      intentReadyCap,
      candidateCount: tracks.length,
      windowExpansionIterations: expansionIterations,
      windowExpansionGuardHit: expansionIterations >= maxWindowExpansionIterations && windowSize < intentReady.length,
      requestLocalMemoization: {
        genreFamilyChecks: genreFamilyCache.size,
        laneReadinessChecks: laneReadyCache.size,
        intentLaneReadinessChecks: intentLaneReadyCache.size,
        eraSignalChecks: eraSignalCache.size,
        relaxedIntentChecks: relaxedIntentMatchCache.size,
      },
      relaxationSteps: relaxationAttempts
        .filter((attempt) => attempt.step === selectedRelaxation?.step || attempt.candidateCount < minimumCandidateCount)
        .map((attempt) => attempt.step),
      finalRelaxedConstraints: selectedRelaxation?.profile ?? relaxationPlan[0]?.profile,
      constraintFailures: selectedRelaxation && selectedRelaxation.candidateCount < minimumCandidateCount
        ? ["candidate_pool_below_minimum_after_relaxation"]
        : [],
      relaxationAttempts: relaxationAttempts.map((attempt) => ({
        step: attempt.step,
        candidateCount: attempt.candidateCount,
        selected: attempt.step === selectedRelaxation?.step,
      })),
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
  profile: EmotionProfile,
  candidatePool: T[],
  classMap: UserGenreProfile["trackClassifications"],
  explicitGenreFamilies: string[],
): LockedIntent {
  return completeLockedIntent(unifiedIntentContext.lockedIntent, {
    genreFamilies: explicitGenreFamilies.length > 0
      ? explicitGenreFamilies
      : undefined,
    eraRange: unifiedIntentContext.lockedIntent.eraRange ?? null,
    mood: unifiedIntentContext.lockedIntent.mood,
    activity: unifiedIntentContext.lockedIntent.activity,
    energy: unifiedIntentContext.lockedIntent.energy ?? energyIntentFromProfile(profile),
  });
}

type PlaylistProgressStage = "scoring" | "retrieval" | "lanes" | "sampling" | "fallback" | "coherence";

async function emitProgress(
  opts: { progress?: (stage: PlaylistProgressStage, detail: string) => void | Promise<void> },
  stage: PlaylistProgressStage,
  detail: string
): Promise<void> {
  await opts.progress?.(stage, detail);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function abortPipeline(stage: string): never {
  const error = new Error(`Generation aborted during ${stage}`);
  (error as Error & { code?: string }).code = "GENERATION_ABORTED";
  throw error;
}

export async function buildPlaylistPipeline<T extends {
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
): Promise<BuildPlaylistPipelineResult<T>> {
  const pipelineStartedAt = Date.now();
  const pipelineTrace = opts.pipelineTrace ?? createPipelineTrace(opts.requestId);
  const timingMs: Record<string, number> = {
    scoring: 0,
    retrieval: 0,
    candidateGeneration: 0,
    v3ScoringAndSampling: 0,
    repair: 0,
    finalization: 0,
    total: 0,
  };
  const recordTiming = (key: keyof typeof timingMs, startedAt: number): void => {
    const durationMs = Date.now() - startedAt;
    timingMs[key] += durationMs;
    recordTraceDuration(pipelineTrace, key, durationMs);
  };
  const buildTimingMs = (): Record<string, unknown> => {
    timingMs.total = Date.now() - pipelineStartedAt;
    const slowest = Object.entries(timingMs)
      .filter(([key]) => key !== "total")
      .sort((a, b) => b[1] - a[1])[0] ?? null;
    return {
      ...timingMs,
      slowestStage: slowest?.[0] ?? null,
      slowestStageMs: slowest?.[1] ?? 0,
    };
  };
  await emitProgress(opts, "scoring", `Scoring ${opts.likedSongs.length.toLocaleString()} liked songs`);
  if (opts.shouldAbort?.()) abortPipeline("scoring");
  let stageStartedAt = Date.now();
  const endScoringProfile = opts.profileStage?.("pipeline.scoring", `${opts.likedSongs.length} liked songs`);
  let scoring: ReturnType<typeof runScoringPipeline<T>>;
  try {
    scoring = runScoringPipeline({
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
  } finally {
    endScoringProfile?.();
  }
  recordTiming("scoring", stageStartedAt);
  if (opts.shouldAbort?.()) abortPipeline("scoring");

  if (scoring.sorted.length === 0 && opts.likedSongs.length > 0) {
    const fallbackScored = opts.likedSongs.map((track) => ({
      ...track,
      score: 0.5,
      rediscoveryScore: 0,
      scoringDebug: {
        trackId: track.trackId,
        sceneScore: 0.5,
        libraryFitScore: 0.5,
        genreBalanceScore: 0.5,
        sceneMatch: 0.5,
        emotionMatch: 0.5,
        genreMatch: 0.5,
        memoryMatch: 0.5,
        noveltyScore: 0,
        seasonalMatch: 0.5,
        moodPurity: 0.5,
        genrePrimary: "unknown",
        genreConfidence: 0,
        genreLocked: false,
        excludedBy: null,
        finalScore: 0.5,
      },
    } as ScoredLibraryTrack<T>));
    scoring.sorted = fallbackScored;
    scoring.scored = fallbackScored;
    scoring.scoringDiagnostics = {
      ...scoring.scoringDiagnostics,
      retrievalCompletionSafety: {
        emptyPoolDetectedAtStage: "scoring_output",
        fallbackDepthReached: 1,
        fallbackExpansionPath: [`input_fallback:${fallbackScored.length}`],
        finalPoolSizeAtScoringEntry: fallbackScored.length,
        retrievalFatalEmptyPool: true,
      },
    };
    opts.pipelineLog?.warn(
      {
        emptyPoolDetectedAtStage: "scoring_output",
        finalPoolSizeAtScoringEntry: fallbackScored.length,
        retrievalFatalEmptyPool: true,
      },
      "Scoring returned empty pool; using synchronous input fallback before retrieval"
    );
  }

  const sortedPool = scoring.sorted;
  await emitProgress(opts, "retrieval", `Building candidate pools from ${sortedPool.length.toLocaleString()} scored tracks`);
  if (opts.shouldAbort?.()) abortPipeline("retrieval");
  stageStartedAt = Date.now();

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
  const intentContract = buildIntentContract(opts.vibe);
  const endRetrievalProfile = opts.profileStage?.("pipeline.retrieval", `${scoring.sorted.length} scored tracks`);
  let unpenalizedRetrieval: RetrievalPools<ScoredLibraryTrack<IntentContractTrack> & { artistName?: string | null }>;
  let unpenalizedPooledCandidates: ScoredLibraryTrack<T>[];
  let unpenalizedViablePoolSize: number;
  let activityKind: ReturnType<typeof activityPromptKind>;
  let effectiveDiversityPressure: number;
  let effectiveSessionArtistMemory: SessionArtistMemory | undefined;
  let sessionMemoryHasPressure: boolean;
  let upstreamRecentTrackPenalty: Map<string, number> | undefined;
  let retrieval: RetrievalPools<ScoredLibraryTrack<IntentContractTrack> & { artistName?: string | null }>;
  try {
    unpenalizedRetrieval = await buildRetrievalPools(
      scoring.sorted as Array<ScoredLibraryTrack<IntentContractTrack> & { artistName?: string }>,
      intentContract,
      classMap,
      opts.postScore.feedbackMemory ?? null,
      {
        promptKey: opts.noLibraryMode ? undefined : opts.vibe,
        diagnosticsMode: opts.diagnosticsMode ?? "minimal",
      },
    );
    if (opts.shouldAbort?.()) abortPipeline("retrieval");
    unpenalizedPooledCandidates = flattenRetrievalPools(unpenalizedRetrieval) as ScoredLibraryTrack<T>[];
    unpenalizedViablePoolSize = unpenalizedPooledCandidates.length;
    activityKind = activityPromptKind(opts.vibe, opts.emotionProfile);
    effectiveDiversityPressure = Math.min(
      opts.sessionArtistMemory?.diversityPressure ?? 1,
      diversityPressureForViablePool(activityKind, unpenalizedViablePoolSize),
    );
    effectiveSessionArtistMemory = withSessionDiversityPressure(
      opts.sessionArtistMemory,
      effectiveDiversityPressure,
    );
    sessionMemoryHasPressure = !!effectiveSessionArtistMemory &&
      effectiveDiversityPressure > 0 &&
      (
        effectiveSessionArtistMemory.artistCount.size > 0 ||
        effectiveSessionArtistMemory.playlistArtistSet.size > 0
      );
    upstreamRecentTrackPenalty = opts.recentPlaylistTrackIds?.length
      ? buildRecentTrackPoolPenalty(opts.recentPlaylistTrackIds, 20, (opts.varietyPenaltyScale ?? 1) * effectiveDiversityPressure)
      : undefined;
    // Build retrieval pools once. Session/recent-track penalties are still
    // applied downstream in V3 sampling and finalization; rebuilding every pool
    // here doubled the most expensive retrieval pass for audit sessions.
    retrieval = unpenalizedRetrieval;
  } finally {
    endRetrievalProfile?.();
  }
  recordTiming("retrieval", stageStartedAt);
  if (opts.shouldAbort?.()) abortPipeline("retrieval");
  const pooledCandidates = flattenRetrievalPools(retrieval) as ScoredLibraryTrack<T>[];
  recordTraceCount(pipelineTrace, "retrievalCandidates", pooledCandidates.length);
  const contractSafePool = enforceIntentContract(
    pooledCandidates as unknown as Array<ScoredLibraryTrack<IntentContractTrack>>,
    intentContract,
    classMap,
  ) as unknown as ScoredLibraryTrack<T>[];
  // GUARANTEE:
  // Playlist output MUST remain inside Intent Contract bounds
  // before ANY widening or fallback logic is applied.
  // No fallback stage may violate genre/mood/era/context intent.
  const contractGuard = constrainPoolToIntentContract(contractSafePool, classMap, intentContract);
  const minContractGuardFloor = Math.min(
    contractSafePool.length,
    Math.max(27, Math.ceil(opts.playlistLength * 0.90)),
  );
  const contractGuardSoftFallback = contractSafePool
    .filter((track) => trackCompatibleWithHardIntentContract(track, classMap, intentContract))
    .map((track) => {
      const subgenreRank = intentContract.primarySubgenre
        ? trackMatchesPrimarySubgenre(track, classMap, intentContract)
          ? 4
          : trackMatchesStructuredSubgenre(track, classMap, intentContract)
            ? 3
            : 0
        : 0;
      const familyRank = trackMatchesGenreFamilies(track, classMap, intentContract.genreFamilies) ? 2 : 0;
      const textRank = identityTermScore(track, intentContract, classMap) > 0 ? 1 : 0;
      return {
        track,
        rank: subgenreRank || familyRank || textRank,
        fit: intentContractFit(track, classMap, intentContract).score,
      };
    })
    .sort((a, b) => (b.rank - a.rank) || (b.fit - a.fit) || ((b.track.score ?? 0) - (a.track.score ?? 0)))
    .map(({ track }) => track);
  const contractGuardPool = contractGuard.pool.length >= minContractGuardFloor
    ? contractGuard.pool
    : [...contractGuard.pool, ...contractGuardSoftFallback]
        .filter((track, index, pool) => pool.findIndex((candidate) => candidate.trackId === track.trackId) === index)
        .slice(0, minContractGuardFloor);
  const strictContractGuardIds = new Set(contractGuard.pool.map((track) => track.trackId));
  const softGuardFloorIds = new Set(
    contractGuardPool
      .filter((track) => !strictContractGuardIds.has(track.trackId))
      .map((track) => track.trackId)
  );
  const softGuardOriginFor = (track: ScoredLibraryTrack<T>): "subgenre" | "family" | "text" | "fallback" => {
    if (
      intentContract.primarySubgenre &&
      (
        trackMatchesPrimarySubgenre(track, classMap, intentContract) ||
        trackMatchesStructuredSubgenre(track, classMap, intentContract)
      )
    ) {
      return "subgenre";
    }
    if (trackMatchesGenreFamilies(track, classMap, intentContract.genreFamilies)) return "family";
    if (identityTermScore(track, intentContract, classMap) > 0) return "text";
    return "fallback";
  };
  const structuredScopeSource = contractGuardPool.length > 0
    ? contractGuardPool
    : contractSafePool;
  const preV3SubgenreScope = structuredRetrievalScope(
    structuredScopeSource,
    classMap,
    intentContract,
    {
      strictMinimum: Math.max(30, opts.playlistLength + 5),
      relatedMinimum: Math.max(8, Math.ceil(opts.playlistLength * 0.60)),
    },
  );
  const contractSafeSubgenreScope = structuredScopeSource === contractSafePool
    ? preV3SubgenreScope
    : structuredRetrievalScope(
        contractSafePool,
        classMap,
        intentContract,
        {
          strictMinimum: Math.max(30, opts.playlistLength + 5),
          relatedMinimum: Math.max(8, Math.ceil(opts.playlistLength * 0.60)),
        },
      );
  const rescuedSubgenreScope = preV3SubgenreScope.mode === "family" && contractSafeSubgenreScope.mode !== "family"
    ? contractSafeSubgenreScope
    : preV3SubgenreScope;
  const rawSubgenreEvidencePool = rescuedSubgenreScope.pool as ScoredLibraryTrack<T>[];
  const subgenreEvidencePool = rawSubgenreEvidencePool.filter((track) => {
    if (
      intentContract.genreFamilies.length > 0 &&
      contradictsExplicitGenreTruth(track, intentContract.genreFamilies)
    ) {
      return false;
    }
    if (intentContract.eraRange && trackHasKnownEraMismatch(track, intentContract.eraRange)) return false;
    return true;
  });
  const subgenreGuardActive = false;
  const subgenreRescueUsed = rescuedSubgenreScope !== preV3SubgenreScope;
  const intentScopedPool = contractGuardPool.length > 0
    ? contractGuardPool
    : contractSafePool;
  const truthContradictedCount = intentContract.genreFamilies.length > 0
    ? intentScopedPool.filter((track) => contradictsExplicitGenreTruth(track, intentContract.genreFamilies)).length
    : 0;
  const positiveEvidenceRejectedCount = intentContract.genreFamilies.length > 0
    ? intentScopedPool.filter((track) => !hasPositiveExplicitGenreEvidence(track, classMap, intentContract.genreFamilies)).length
    : 0;
  const explicitGenreScoredPool = intentContract.genreFamilies.length > 0
    ? (scoring.sorted as ScoredLibraryTrack<T>[]).filter((track) =>
        !contradictsExplicitGenreTruth(track, intentContract.genreFamilies) &&
        hasPositiveExplicitGenreEvidence(track, classMap, intentContract.genreFamilies)
      )
    : [];
  const contractEvidencePool = intentContract.genreFamilies.length > 0
    ? intentScopedPool.filter((track) =>
        !contradictsExplicitGenreTruth(track, intentContract.genreFamilies) &&
        hasPositiveExplicitGenreEvidence(track, classMap, intentContract.genreFamilies)
      ) as ScoredLibraryTrack<T>[]
    : [];
  const familyFallbackEvidencePool = intentContract.genreFamilies.length > 0
    ? intentScopedPool.filter((track) => !contradictsExplicitGenreTruth(track, intentContract.genreFamilies)) as ScoredLibraryTrack<T>[]
    : [];
  const minSafePreRankingPool = Math.min(80, Math.max(opts.playlistLength * 2, 30));
  const hardCompatibleScoredPool = (scoring.sorted as ScoredLibraryTrack<T>[]).filter((track) =>
    trackCompatibleWithHardIntentContract(track, classMap, intentContract)
  );
  let contractGuardedScoredPool = intentContract.genreFamilies.length > 0
    ? contractEvidencePool.length > 0
        ? contractEvidencePool
        : explicitGenreScoredPool.length > 0
          ? explicitGenreScoredPool
          : familyFallbackEvidencePool.length > 0
            ? familyFallbackEvidencePool
            : intentScopedPool
    : intentScopedPool;
  if (
    intentContract.primarySubgenre &&
    subgenreEvidencePool.length > 0 &&
    (rescuedSubgenreScope.mode !== "family" || contractGuardedScoredPool.length < minSafePreRankingPool)
  ) {
    const seenSubgenreRescueIds = new Set<string>();
    contractGuardedScoredPool = [...subgenreEvidencePool, ...contractGuardedScoredPool].filter((track) => {
      if (seenSubgenreRescueIds.has(track.trackId)) return false;
      seenSubgenreRescueIds.add(track.trackId);
      return true;
    });
  }
  let finalFallbackLevelUsed: "none" | "family" | "adjacent" | "global" = "none";
  let starvationTriggerReason: string | null = null;
  let emptyPoolDetectedAtStage: string | null = contractGuardedScoredPool.length === 0 ? "pre_scoring_candidate_pool" : null;
  let fallbackDepthReached = 0;
  const fallbackExpansionPath: string[] = [];
  let retrievalFatalEmptyPool = false;
  let fallbackSkippedByFastPath = false;
  let fastPathTriggered = false;
  let candidatePoolStabilized = false;
  let repetitionPassSkipped = false;
  let executionDepth = 3;
  const existingIds = new Set(contractGuardedScoredPool.map((track) => track.trackId));
  const appendUnique = (base: ScoredLibraryTrack<T>[], extra: ScoredLibraryTrack<T>[], limit: number): ScoredLibraryTrack<T>[] => {
    const out = [...base];
    for (const track of extra) {
      if (existingIds.has(track.trackId)) continue;
      existingIds.add(track.trackId);
      out.push(track);
      if (out.length >= limit) break;
    }
    return out;
  };
  const sameFamilyExpansion = intentContract.genreFamilies.length > 0
    ? (scoring.sorted as ScoredLibraryTrack<T>[]).filter((track) =>
        trackCompatibleWithHardIntentContract(track, classMap, intentContract) &&
        trackMatchesGenreFamilies(track, classMap, intentContract.genreFamilies)
      )
    : [];
  const adjacentFamilies = new Set(intentContract.genreFamilies.flatMap((genre) => adjacentGenreFamilies(genre)));
  const adjacentExpansion = intentContract.genreFamilies.length > 0
    ? (scoring.sorted as ScoredLibraryTrack<T>[]).filter((track) => {
        if (!trackCompatibleWithHardIntentContract(track, classMap, intentContract)) return false;
        const family = genreFamilyForTrack(track, classMap);
        return !!family && adjacentFamilies.has(family);
      })
    : [];
  const globalExpansion = hardCompatibleScoredPool.length > 0
    ? hardCompatibleScoredPool
    : scoring.sorted as ScoredLibraryTrack<T>[];
  const fallbackSteps: Array<{
    level: "family" | "adjacent" | "global";
    pool: ScoredLibraryTrack<T>[];
  }> = [
    { level: "family", pool: sameFamilyExpansion },
    { level: "adjacent", pool: adjacentExpansion },
    { level: "global", pool: globalExpansion },
  ];
  const beforeExpansion = contractGuardedScoredPool.length;
  const genreAlignmentStable =
    intentContract.genreFamilies.length === 0 ||
    contractEvidencePool.length >= Math.min(minSafePreRankingPool, Math.max(12, Math.ceil(opts.playlistLength * 0.75))) ||
    contractGuardedScoredPool.length >= minSafePreRankingPool;
  const sceneStableFastPath =
    sceneConstraintActive(intentContract) &&
    genreAlignmentStable &&
    contractGuardedScoredPool.length >= minSafePreRankingPool;
  const preExpansionScoreVariance = topScoreVariance(contractGuardedScoredPool);
  candidatePoolStabilized =
    contractGuardedScoredPool.length >= minSafePreRankingPool &&
    preExpansionScoreVariance <= 0.018;
  repetitionPassSkipped = topArtistDiversitySatisfied(contractGuardedScoredPool);
  const constrainedCompletionAtRisk =
    sceneConstraintActive(intentContract) &&
    contractGuardedScoredPool.length < Math.max(minSafePreRankingPool, Math.ceil(opts.playlistLength * 1.5));
  fallbackSkippedByFastPath = (sceneStableFastPath || candidatePoolStabilized) && !constrainedCompletionAtRisk;
  fastPathTriggered = fallbackSkippedByFastPath || repetitionPassSkipped;
  const maxFallbackDepth = 1;
  while (
    contractGuardedScoredPool.length < minSafePreRankingPool &&
    !fallbackSkippedByFastPath &&
    fallbackDepthReached < Math.min(maxFallbackDepth, fallbackSteps.length)
  ) {
    const step = fallbackSteps[fallbackDepthReached];
    fallbackDepthReached += 1;
    if (!step || step.pool.length === 0) {
      if (step) fallbackExpansionPath.push(`${step.level}:empty`);
      continue;
    }
    contractGuardedScoredPool = appendUnique(contractGuardedScoredPool, step.pool, minSafePreRankingPool);
    finalFallbackLevelUsed = step.level;
    fallbackExpansionPath.push(`${step.level}:${contractGuardedScoredPool.length}`);
  }
  if (contractGuardedScoredPool.length === 0 && globalExpansion.length > 0) {
    retrievalFatalEmptyPool = true;
    emptyPoolDetectedAtStage = emptyPoolDetectedAtStage ?? "pre_v3_scoring_entry";
    contractGuardedScoredPool = appendUnique(contractGuardedScoredPool, globalExpansion, minSafePreRankingPool);
    finalFallbackLevelUsed = "global";
    fallbackExpansionPath.push(`fatal_global:${contractGuardedScoredPool.length}`);
  }
  if (contractGuardedScoredPool.length > beforeExpansion) {
    starvationTriggerReason = beforeExpansion === 0
      ? "pre_ranking_pool_empty"
      : "pre_ranking_pool_below_min_safe_pool";
  }
  const originScoreBoost = (origin: "subgenre" | "family" | "text" | "fallback"): number => {
    switch (origin) {
      case "subgenre":
        return 0.24;
      case "family":
        return 0.08;
      case "text":
        return 0.12;
      case "fallback":
        return -0.05;
    }
  };
  contractGuardedScoredPool = contractGuardedScoredPool
    .map((track) => {
      const origin = softGuardOriginFor(track);
      return {
        ...track,
        score: (track.score ?? 0) +
          originScoreBoost(origin) +
          sceneIdentityCoherenceScore(track, intentContract, classMap, origin),
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (starvationTriggerReason) {
    opts.pipelineLog?.warn({
      fallbackLevelUsed: finalFallbackLevelUsed,
      starvationTriggerReason,
      emptyPoolDetectedAtStage,
      fallbackDepthReached,
      fallbackExpansionPath,
      finalPoolSizeAtScoringEntry: contractGuardedScoredPool.length,
      retrievalFatalEmptyPool,
      candidateCountPerStage: {
        retrieval: pooledCandidates.length,
        contractSafe: contractSafePool.length,
        contractGuard: contractGuardPool.length,
        contractEvidence: contractEvidencePool.length,
        explicitGenre: explicitGenreScoredPool.length,
        preRanking: contractGuardedScoredPool.length,
      },
    }, "Retrieval starvation safety expansion applied");
  }
  const softGuardRankTrace = contractGuardedScoredPool.map((track, index) => ({
    trackId: track.trackId,
    origin: softGuardOriginFor(track),
    finalRankPosition: index + 1,
    atRiskOfFiltering: !strictContractGuardIds.has(track.trackId),
    rescuedBySoftGuardFloor: softGuardFloorIds.has(track.trackId),
  }));
  const softGuardOriginCounts = softGuardRankTrace.reduce<Record<"subgenre" | "family" | "text" | "fallback", number>>(
    (acc, entry) => {
      acc[entry.origin] += 1;
      return acc;
    },
    { subgenre: 0, family: 0, text: 0, fallback: 0 }
  );
  opts.pipelineLog?.info({
    poolSizes: {
      retrieval: pooledCandidates.length,
      structured: subgenreEvidencePool.length,
      contractGuard: contractGuardPool.length,
      finalScoringInput: contractGuardedScoredPool.length,
    },
    originCounts: softGuardOriginCounts,
    rescuedBySoftGuardFloor: softGuardRankTrace.filter((entry) => entry.rescuedBySoftGuardFloor).length,
    trace: softGuardRankTrace.slice(0, Math.max(50, opts.playlistLength * 2)),
  }, "Soft guard final scoring origin trace");
  const fallbackLevelRank: Record<"none" | "family" | "adjacent" | "global", number> = {
    none: 0,
    family: 1,
    adjacent: 2,
    global: 3,
  };
  const retrievalFallbackLevelUsed = retrieval.diagnostics?.fallbackLevelUsed ?? "none";
  const effectiveFallbackLevelUsed =
    fallbackLevelRank[retrievalFallbackLevelUsed] > fallbackLevelRank[finalFallbackLevelUsed]
      ? retrievalFallbackLevelUsed
      : finalFallbackLevelUsed;
  await emitProgress(opts, "lanes", `Routing ${contractGuardedScoredPool.length.toLocaleString()} candidates into playlist lanes`);
  if (opts.shouldAbort?.()) abortPipeline("lanes");
  const explicitGenreRecoveryUsed = intentContract.genreFamilies.length > 0 &&
    contractEvidencePool.length === 0 &&
    explicitGenreScoredPool.length > 0;
  const explicitPromptGenreFamilies = intentContract.genreFamilies;
  const firstCollapseReason = (() => {
    if (pooledCandidates.length === 0) return "retrieval_empty";
    if (
      intentContract.primarySubgenre &&
      rescuedSubgenreScope.mode === "family" &&
      (rescuedSubgenreScope.primaryCount > 0 || rescuedSubgenreScope.relatedCount > 0)
    ) {
      return "structured_subgenre_below_adaptive_threshold";
    }
    if (contractSafePool.length === 0) return "enforce_intent_contract_empty";
    if (contractGuardPool.length === 0) return "contract_filter_empty";
    if (contractGuardedScoredPool.length < minSafePreRankingPool) return "pre_ranking_pool_below_min_safe_pool";
    return null;
  })();
  const promptSurvivability = {
    preFilterPoolSize: pooledCandidates.length,
    postStructuredRetrievalSize: subgenreEvidencePool.length,
    postContractFilterSize: contractGuardPool.length,
    postFinalizationSize: null,
    firstCollapseReason,
    structuredRetrieval: {
      source: structuredScopeSource === contractSafePool ? "contract_safe_pool" : "contract_guard_pool",
      rescueUsed: subgenreRescueUsed,
      mode: rescuedSubgenreScope.mode,
      primaryCount: rescuedSubgenreScope.primaryCount,
      relatedCount: rescuedSubgenreScope.relatedCount,
      familyCount: rescuedSubgenreScope.familyCount,
      strictMinimum: rescuedSubgenreScope.strictMinimum,
      relatedMinimum: rescuedSubgenreScope.relatedMinimum,
    },
  };
  const intentContractGuardDiagnostics = {
    ...contractGuard.diagnostics,
    subgenreGuardActive,
    subgenreEvidencePoolCount: subgenreEvidencePool.length,
    subgenreFallbackMode: rescuedSubgenreScope.mode,
    subgenrePrimaryCount: rescuedSubgenreScope.primaryCount,
    subgenreRelatedCount: rescuedSubgenreScope.relatedCount,
    subgenreFamilyCount: rescuedSubgenreScope.familyCount,
    subgenreStrictMinimum: rescuedSubgenreScope.strictMinimum,
    subgenreRelatedMinimum: rescuedSubgenreScope.relatedMinimum,
    subgenreRescueUsed,
    subgenrePoolTooSmall: !!intentContract.primarySubgenre &&
      rescuedSubgenreScope.mode === "family" &&
      (rescuedSubgenreScope.primaryCount > 0 || rescuedSubgenreScope.relatedCount > 0),
    familyFallbackEmpty: rescuedSubgenreScope.mode === "family" && rescuedSubgenreScope.familyCount === 0,
    retrievalExpandedDueToStarvation: contractGuardPool.length === 0 && contractSafePool.length > 0,
    retrievalExpansionReason: contractGuardPool.length === 0 && contractSafePool.length > 0
      ? "contract_guard_empty_using_contract_safe_pool"
      : null,
    fallbackLevelUsed: effectiveFallbackLevelUsed,
    starvationTriggerReason,
    emptyPoolDetectedAtStage,
    fallbackDepthReached,
    fallbackExpansionPath,
    finalPoolSizeAtScoringEntry: contractGuardedScoredPool.length,
    retrievalFatalEmptyPool,
      softGuardOriginTrace: softGuardRankTrace.slice(0, Math.max(40, opts.playlistLength * 2)),
    candidateCountPerStage: {
      retrieval: pooledCandidates.length,
      structuredRetrieval: subgenreEvidencePool.length,
      contractSafe: contractSafePool.length,
      contractGuard: contractGuardPool.length,
      preRanking: contractGuardedScoredPool.length,
    },
    explicitGenreScoredPoolCount: explicitGenreScoredPool.length,
    explicitGenreRecoveryUsed,
    promptSurvivability,
  };
  const v3LockedIntent = buildV3LockedIntent(
    unifiedIntentContextWithMemory,
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
  const retrievalSafetyExpanded =
    !fallbackSkippedByFastPath &&
    (
      !!starvationTriggerReason ||
      timingMs.retrieval > 20_000 ||
      retrieval.diagnostics?.retrievalExpandedDueToStarvation === true ||
      (retrieval.diagnostics?.fallbackLevelUsed != null && retrieval.diagnostics.fallbackLevelUsed !== "none")
    );
  const layeredSafetyPool = flattenRetrievalPools({
    core: retrieval.core,
    anchor: retrieval.anchor,
    adjacent: retrieval.adjacent,
    bridge: retrieval.bridge,
    energyArc: retrieval.energyArc,
    discovery: retrieval.discovery,
  }) as ScoredLibraryTrack<T>[];
  const v3SafetyInputCap = Math.min(
    V3_SAFETY_INPUT_MAX,
    Math.max(V3_SAFETY_INPUT_MIN, opts.playlistLength * V3_SAFETY_INPUT_PER_TRACK)
  );
  const capV3SafetyPool = (pool: ScoredLibraryTrack<T>[]): ScoredLibraryTrack<T>[] =>
    pool.length > v3SafetyInputCap ? pool.slice(0, v3SafetyInputCap) : pool;
  const candidateInputs: Array<{ label: string; pool: ScoredLibraryTrack<T>[]; seedOffset: number }> = retrievalSafetyExpanded
    ? [
        {
          label: "layered_safety_pool",
          pool: capV3SafetyPool(layeredSafetyPool.length > 0 ? layeredSafetyPool : contractGuardedScoredPool),
          seedOffset: 0,
        },
      ]
    : [
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
  const executableCandidateInputs = candidateInputs.slice(0, 1);
  const skippedCandidateAttemptCount = Math.max(0, candidateInputs.length - executableCandidateInputs.length);
  executionDepth =
    1 +
    (fallbackDepthReached > 0 ? 1 : 0) +
    (retrievalSafetyExpanded ? 1 : 0);
  const candidateAttempts: Array<{
    label: string;
    inputPool: Array<T & { genrePrimary?: string; releaseYear?: number | null }>;
    candidatePool: ReturnType<typeof buildV3CandidatePool<T & { genrePrimary?: string; releaseYear?: number | null }>>;
    result: Awaited<ReturnType<typeof runV3Pipeline<T>>>;
    quality: ReturnType<typeof evaluatePlaylistQuality>;
    total: number;
  }> = [];
  const canShortCircuitCandidateAttempt = (attempt: {
    result: Awaited<ReturnType<typeof runV3Pipeline<T>>>;
    quality: ReturnType<typeof evaluatePlaylistQuality>;
    total: number;
  }): boolean => {
    const fullEnough = attempt.result.finalTracks.length >= Math.ceil(opts.playlistLength * 0.90);
    const qualityGoodEnough =
      attempt.quality.overall >= 0.58 &&
      attempt.quality.promptAlignment >= 0.54 &&
      attempt.quality.genericnessPenalty <= 0.38;
    return fullEnough && qualityGoodEnough && attempt.total >= 0.70;
  };
  let candidateShortCircuitUsed = false;
  let v3InvocationCount = 0;
  let candidatePoolBuildCount = 0;
  let v3SingletonViolationBlocked = false;
  for (const candidate of executableCandidateInputs) {
    if (v3InvocationCount >= 1) {
      v3SingletonViolationBlocked = true;
      opts.pipelineLog?.error(
        {
          requestId: opts.requestId,
          stage: `pipeline.v3ScoringAndSampling.${candidate.label}`,
          callStackTag: "playlist-pipeline.candidateAttempts",
          v3InvocationCount,
        },
        "V3_SINGLETON_VIOLATION",
      );
      recordTraceFailure(pipelineTrace, createFailureContext({
        stage: `pipeline.v3ScoringAndSampling.${candidate.label}`,
        error: new Error("V3 singleton blocked additional candidate attempt"),
        recoverable: true,
      }));
      break;
    }
    await emitProgress(opts, "sampling", `Sampling ${candidate.label.replace(/_/g, " ")} candidates`);
    if (opts.shouldAbort?.()) abortPipeline(`sampling:${candidate.label}`);
    const inputPool = (candidate.pool.length > 0 ? candidate.pool : contractGuardedScoredPool) as unknown as Array<T & { genrePrimary?: string; releaseYear?: number | null }>;
    stageStartedAt = Date.now();
    const endCandidateGenerationProfile = opts.profileStage?.(`pipeline.candidateGeneration.${candidate.label}`, `${inputPool.length} input tracks`);
    let candidatePool: ReturnType<typeof buildV3CandidatePool<T & { genrePrimary?: string; releaseYear?: number | null }>>;
    try {
      candidatePoolBuildCount += 1;
      candidatePool = buildV3CandidatePool(
        inputPool,
        classMap,
        opts.playlistLength,
        v3LockedIntent,
        { minimumFillRatio: candidate.label === "strict_intent" ? 0.8 : 0.65 },
        opts.pipelineLog,
      );
    } finally {
      endCandidateGenerationProfile?.();
    }
    recordTiming("candidateGeneration", stageStartedAt);
    stageStartedAt = Date.now();
    const endV3Profile = opts.profileStage?.(`pipeline.v3ScoringAndSampling.${candidate.label}`, `${candidatePool.tracks.length} candidate tracks`);
    let result: Awaited<ReturnType<typeof runV3Pipeline<T>>>;
    try {
      v3InvocationCount += 1;
      result = await runV3Pipeline(
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
          sessionArtistMemory:     effectiveSessionArtistMemory,
          trackReusePenalty:       upstreamRecentTrackPenalty,
          requestId:               opts.requestId,
          pipelineTrace,
          diagnosticsMode:          opts.diagnosticsMode ?? "minimal",
          profileStage:            opts.profileStage,
        }
      );
    } finally {
      endV3Profile?.();
    }
    recordTiming("v3ScoringAndSampling", stageStartedAt);
    recordTraceCount(pipelineTrace, `v3.${candidate.label}.inputCandidates`, candidatePool.tracks.length);
    recordTraceCount(pipelineTrace, `v3.${candidate.label}.finalTracks`, result.finalTracks.length);
    if (opts.shouldAbort?.()) abortPipeline(`sampling:${candidate.label}`);
    const quality = evaluatePlaylistQuality(
      result.finalTracks as unknown as IntentContractTrack[],
      intentContract,
      classMap,
    );
    const countRatio = result.finalTracks.length / Math.max(1, opts.playlistLength);
    const starvationPenalty = Math.max(0, 1 - countRatio) * 0.35;
    const attempt = {
      label: candidate.label,
      inputPool,
      candidatePool,
      result,
      quality,
      total: quality.overall + Math.min(0.18, countRatio * 0.18) - starvationPenalty,
    };
    candidateAttempts.push(attempt);
    if (candidateAttempts.length === 1 && executableCandidateInputs.length > 1 && canShortCircuitCandidateAttempt(attempt)) {
      candidateShortCircuitUsed = true;
      break;
    }
    if (
      candidateAttempts.length === 1 &&
      executableCandidateInputs.length > 1 &&
      attempt.result.finalTracks.length >= Math.ceil(opts.playlistLength * 0.90) &&
      attempt.quality.overall >= 0.45 &&
      attempt.quality.promptAlignment >= 0.40
    ) {
      candidateShortCircuitUsed = true;
      break;
    }
  }
  const selectedCandidate = [...candidateAttempts].sort((a, b) => b.total - a.total)[0] ?? candidateAttempts[0];
  const v3CandidatePool = selectedCandidate.candidatePool;
  const v3 = selectedCandidate.result;
  const retrievalPoolDiagnostics = {
    signalCoverage: retrieval.diagnostics?.retrievalSignalCoverage ?? null,
    mappingDiagnostics: retrieval.diagnostics?.retrievalSignalMapping ?? null,
    core: {
      count: retrieval.core.length,
      top20: diagnosticPool(retrieval.core, classMap, 20),
    },
    anchor: {
      count: retrieval.anchor.length,
      top20: diagnosticPool(retrieval.anchor, classMap, 20),
    },
    adjacent: {
      count: retrieval.adjacent.length,
      top20: diagnosticPool(retrieval.adjacent, classMap, 20),
    },
    bridge: {
      count: retrieval.bridge.length,
      top20: diagnosticPool(retrieval.bridge, classMap, 20),
    },
    discovery: {
      count: retrieval.discovery.length,
      top20: diagnosticPool(retrieval.discovery, classMap, 20),
    },
    energyArc: {
      count: retrieval.energyArc.length,
      top20: diagnosticPool(retrieval.energyArc, classMap, 20),
    },
  };
  const baseWaterfall = {
    libraryCount: opts.likedSongs.length,
    retrievalCount: pooledCandidates.length,
    scoredCount: scoring.sorted.length,
    contractCount: contractGuardedScoredPool.length,
    constraintCount: v3CandidatePool.diagnostics["intentReadyCount"] ?? 0,
    laneCount: v3CandidatePool.tracks.length,
    samplerCount: v3.finalTracks.length,
    repairCount: v3.finalTracks.length,
    finalCount: v3.finalTracks.length,
  };
  const removalReasons = [
    {
      stage: "contract",
      before: retrieval.diagnostics?.inputCount ?? scoring.sorted.length,
      after: retrieval.diagnostics?.contractRankedCount ?? pooledCandidates.length,
      removed: Math.max(0, (retrieval.diagnostics?.inputCount ?? scoring.sorted.length) - (retrieval.diagnostics?.contractRankedCount ?? pooledCandidates.length)),
      topReasons: {},
    },
    {
      stage: "contract_guard",
      before: contractSafePool.length,
      after: contractGuardedScoredPool.length,
      removed: Math.max(0, contractSafePool.length - contractGuardedScoredPool.length),
      topReasons: {
        truthContradicted: truthContradictedCount,
        missingPositiveGenreEvidence: positiveEvidenceRejectedCount,
      },
    },
    ...((v3CandidatePool.diagnostics["forensicPreV3Trace"] as unknown[]) ?? []),
    ...((((v3.diagnostics["forensicPoolTrace"] as Record<string, unknown> | undefined)?.["stages"] as unknown[]) ?? [])),
  ];
  const fallbackActivations = [
    explicitGenreRecoveryUsed
      ? {
          name: "explicit_genre_scored_pool_recovery",
          triggerReason: "contract_evidence_pool_empty",
          tracksBefore: contractEvidencePool.length,
          tracksAfter: explicitGenreScoredPool.length,
        }
      : null,
    v3CandidatePool.tracks.length === 0
      ? {
          name: "empty_v3_candidate_pool_recovery",
          triggerReason: "pre_v3_pool_empty",
          tracksBefore: v3CandidatePool.tracks.length,
          tracksAfter: contractGuardedScoredPool.length,
        }
      : null,
    v3.finalTracks.length === 0
      ? {
          name: "empty_v3_final_tracks_recovery",
          triggerReason: "v3_selected_zero_tracks",
          tracksBefore: v3.finalTracks.length,
          tracksAfter: contractGuardedScoredPool.length,
        }
      : null,
  ].filter((entry): entry is { name: string; triggerReason: string; tracksBefore: number; tracksAfter: number } => !!entry);
  for (const activation of fallbackActivations) {
    recordTraceFallback(pipelineTrace, activation.name);
  }
  const controlledGenerationDiagnostics = {
    selectedCandidate: selectedCandidate.label,
    selectedRelaxation: selectedCandidate.candidatePool.diagnostics["finalRelaxedConstraints"] ?? null,
    relaxationSteps: selectedCandidate.candidatePool.diagnostics["relaxationSteps"] ?? [],
    constraintFailures: selectedCandidate.candidatePool.diagnostics["constraintFailures"] ?? [],
    candidateScores: candidateAttempts.map((candidate) => ({
      label: candidate.label,
      selectedCount: candidate.result.finalTracks.length,
      total: round3(candidate.total),
      quality: candidate.quality,
      relaxationSteps: candidate.candidatePool.diagnostics["relaxationSteps"] ?? [],
      finalRelaxedConstraints: candidate.candidatePool.diagnostics["finalRelaxedConstraints"] ?? null,
    })),
    diversityPressure: {
      activityKind,
      unpenalizedViablePoolSize,
      effectiveDiversityPressure,
      baseDiversityPressure: opts.sessionArtistMemory?.diversityPressure ?? 1,
    },
    sessionArtistMemory: sessionArtistMemoryDiagnostics(effectiveSessionArtistMemory),
    retrievalLatencyGuard: {
      active: retrievalSafetyExpanded,
      fastPathTriggered,
      fallbackSkipped: fallbackSkippedByFastPath,
      candidatePoolStabilized,
      repetitionPassSkipped,
      candidatePoolSizeFinal: v3CandidatePool.tracks.length,
      executionDepth,
      retrievalElapsedMs: timingMs.retrieval,
      candidateAttemptCount: candidateAttempts.length,
      candidatePoolBuildCount,
      plannedCandidateAttemptCount: candidateInputs.length,
      skippedCandidateAttemptCount,
      v3SingletonEnforced: true,
      candidateShortCircuitUsed,
      v3InvocationCount,
      v3SingletonViolationBlocked,
      fallbackLevelUsed: effectiveFallbackLevelUsed,
      starvationTriggerReason,
      layeredSafetyPoolSize: layeredSafetyPool.length,
    },
    retrievalCompletionSafety: {
      emptyPoolDetectedAtStage,
      fallbackDepthReached,
      fallbackExpansionPath,
      finalPoolSizeAtScoringEntry: contractGuardedScoredPool.length,
      retrievalFatalEmptyPool,
      maxFallbackDepth,
      fallbackSkippedByFastPath,
    },
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
    preV3TopCandidates: diagnosticPool(selectedCandidate.inputPool, classMap, 60),
    waterfall: baseWaterfall,
    removalReasons,
    retrievalPoolsDetailed: retrievalPoolDiagnostics,
    intentContract,
    fallbacks: fallbackActivations,
    intentContractGuard: intentContractGuardDiagnostics,
    retrievalPools: {
      core: retrieval.core.length,
      anchor: retrieval.anchor.length,
      adjacent: retrieval.adjacent.length,
      bridge: retrieval.bridge.length,
      energyArc: retrieval.energyArc.length,
      discovery: retrieval.discovery.length,
    },
  });

  // V3 output is the selected candidate list. Post-V3 recovery guards are bounded
  // to the existing candidate pool and never re-enter retrieval, scoring, or V3.
  let finalTracksList = v3.finalTracks as V3MetadataTrack<T>[];
  const qualityRecoveryCandidatePool = selectedCandidate.inputPool.map((track) => ({
    ...(track as unknown as V3MetadataTrack<T>),
    selectedByV3: (track as V3MetadataTrack<T>).selectedByV3 ?? false,
    sourceLane: (track as V3MetadataTrack<T>).sourceLane ?? "quality_recovery",
    laneScore: (track as V3MetadataTrack<T>).laneScore ?? (track as ScoredLibraryTrack<T>).score ?? null,
    genrePrimary: (track as V3MetadataTrack<T>).genrePrimary ?? genreFamilyForTrack(track, classMap),
    clusterId: (track as V3MetadataTrack<T>).clusterId ?? genreFamilyForTrack(track, classMap),
    clusterIds: (track as V3MetadataTrack<T>).clusterIds ?? [genreFamilyForTrack(track, classMap)].filter((value): value is string => !!value),
  })) as ScoredLibraryTrack<V3MetadataTrack<T>>[];
  const qualityRecoveryDiagnostics: Record<string, unknown> = {
    candidatePoolSize: qualityRecoveryCandidatePool.length,
    qualityLock: { implemented: true, executed: false },
    criticRepair: { executed: false },
  };
  if (finalTracksList.length > 0 && qualityRecoveryCandidatePool.length > finalTracksList.length) {
    const qualityLocked = repairPlaylistWithQualityLock(
      finalTracksList,
      qualityRecoveryCandidatePool,
      classMap,
      opts.maxPerArtist,
      opts.playlistLength,
    );
    finalTracksList = qualityLocked.tracks;
    qualityRecoveryDiagnostics["qualityLock"] = {
      ...qualityLocked.diagnostics,
      executed: true,
    };
  }
  if (finalTracksList.length > 0 && qualityRecoveryCandidatePool.length > finalTracksList.length) {
    const criticRepaired = repairPlaylistWithCritic(
      finalTracksList,
      qualityRecoveryCandidatePool,
      classMap,
      opts.maxPerArtist,
      opts.playlistLength,
    );
    if (criticRepaired.diagnostics.afterQuality >= criticRepaired.diagnostics.beforeQuality) {
      finalTracksList = criticRepaired.tracks;
    }
    qualityRecoveryDiagnostics["criticRepair"] = {
      ...criticRepaired.diagnostics,
      executed: true,
      applied: criticRepaired.diagnostics.afterQuality >= criticRepaired.diagnostics.beforeQuality,
    };
  }
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

  const fallbackResolveLimit = Math.max(50, opts.playlistLength * 3);
  const fallbackCandidateScore = (track: ScoredLibraryTrack<T>): number => {
    const origin = softGuardOriginFor(track);
    const recentTrackPenalty = upstreamRecentTrackPenalty?.get(track.trackId) ?? 0;
    const artistPenalty = 1 - artistMemoryPenalty(effectiveSessionArtistMemory, track.artistName);
    return (track.score ?? 0) +
      sceneIdentityCoherenceScore(track, intentContract, classMap, origin) +
      originScoreBoost(origin) -
      recentTrackPenalty * 1.35 -
      artistPenalty * 0.72;
  };
  const orderFallbackPool = (pool: ScoredLibraryTrack<T>[]): ScoredLibraryTrack<T>[] =>
    [...pool].sort((a, b) => fallbackCandidateScore(b) - fallbackCandidateScore(a));
  const lastResortPool: ScoredLibraryTrack<T>[] = contractGuardedScoredPool
    .filter((track) => track.genrePrimary || track.energy != null || track.valence != null)
    .sort((a, b) => fallbackCandidateScore(b) - fallbackCandidateScore(a))
    .slice(0, fallbackResolveLimit);
  const emergencyScoredPool: ScoredLibraryTrack<T>[] = contractGuardedScoredPool
    .filter((track) => typeof track.score === "number")
    .sort((a, b) => fallbackCandidateScore(b) - fallbackCandidateScore(a))
    .slice(0, fallbackResolveLimit);

  function resolveFinalTracks(
    pool: ScoredLibraryTrack<T>[],
    fallbackLabel: string,
  ): BuildPlaylistPipelineResult<T> | null {
    if (!pool.length) return null;

    const resolvedPool = orderFallbackPool(pool).slice(0, fallbackResolveLimit);
    const enforcedResolved = enforceFinalPlaylistGenres({
      finalTracks: resolvedPool,
      sortedPool: contractGuardedScoredPool,
      userGenreProfile: opts.userGenreProfile,
      genreStack: opts.genreStack,
      allowHoliday: opts.genrePost.allowHoliday,
      suppressGenres: opts.genrePost.suppressGenres,
      coverageState: scoring.coverageState,
      genreForecast: scoring.genreForecast,
      sceneInfluenceRatio: scoring.sceneInfluenceRatio,
      stabilityDiagnostics: scoring.stabilityDiagnostics,
    });
    const enforcedTracks = enforcedResolved.tracks.length > 0
      ? enforcedResolved.tracks
      : [];
    const resolvedTracks = (enforcedTracks.length >= Math.min(opts.playlistLength, resolvedPool.length)
      ? enforcedTracks
      : resolvedPool).slice(0, opts.playlistLength);
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
          generationDebug: {
            ...((v3.diagnostics["generationDebug"] as Record<string, unknown> | undefined) ?? {}),
            relaxationSteps: controlledGenerationDiagnostics.relaxationSteps,
            finalRelaxedConstraints: controlledGenerationDiagnostics.selectedRelaxation,
            constraintFailures: controlledGenerationDiagnostics.constraintFailures,
            fallbackTriggered: true,
          },
          forensicPoolTrace: {
            ...((v3.diagnostics["forensicPoolTrace"] as Record<string, unknown> | undefined) ?? {}),
            finalHardFilterTrace,
          },
          fallback: fallbackLabel,
          preV3Recovery: v3CandidatePool.diagnostics,
          preV3TopCandidates: diagnosticPool(selectedCandidate.inputPool, classMap, 60),
          waterfall: {
            ...baseWaterfall,
            repairCount: resolvedTracks.length,
            finalCount: resolvedTracks.length,
          },
          removalReasons,
          retrievalPoolsDetailed: retrievalPoolDiagnostics,
          intentContract,
          fallbacks: [
            ...fallbackActivations,
            {
              name: fallbackLabel,
              triggerReason: "resolve_final_tracks_called",
              tracksBefore: pool.length,
              tracksAfter: resolvedTracks.length,
            },
          ],
          intentContractGuard: intentContractGuardDiagnostics,
          controlledGeneration: controlledGenerationDiagnostics,
          pipelineTrace,
          timingMs: buildTimingMs(),
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
      pipelineTrace,
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

  const gymMinimumTrackCount = activityKind === "gym"
    ? Math.min(opts.playlistLength, Math.max(25, Math.floor(opts.playlistLength * 0.6)))
    : 0;
  if (gymMinimumTrackCount > 0 && finalTracksList.length < gymMinimumTrackCount) {
    const existingIds = new Set(finalTracksList.map((track) => track.trackId));
    const gymRefillPool = unpenalizedPooledCandidates.filter((track) => {
      if (existingIds.has(track.trackId)) return false;
      const energySafe = typeof track.energy === "number" ? track.energy >= 0.52 : true;
      const tempoSafe = typeof track.tempo === "number" ? track.tempo >= 105 : true;
      const acousticSafe = typeof track.acousticness === "number" ? track.acousticness <= 0.75 : true;
      return energySafe && tempoSafe && acousticSafe;
    });
    const resolvedGymRefill = resolveFinalTracks(
      [...(finalTracksList as unknown as ScoredLibraryTrack<T>[]), ...gymRefillPool].slice(0, fallbackResolveLimit),
      "gym_minimum_viable_pool_refill",
    );
    if (resolvedGymRefill && resolvedGymRefill.finalTracks.length >= Math.min(gymMinimumTrackCount, opts.playlistLength)) {
      return resolvedGymRefill;
    }
  }

  // GUARANTEE: playlist pipeline must NEVER return empty tracks.
  // All filters must degrade gracefully, not eliminate entire pool.
  // Last-resort fallback: V3 produced nothing (no audio features / empty lib)
  if (finalTracksList.length === 0) {
    await emitProgress(opts, "fallback", "Primary lanes returned no tracks; using constrained recovery pool");
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
      }).slice(0, fallbackResolveLimit);
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
    const recentTrackPenalty = upstreamRecentTrackPenalty;
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
          generationDebug: {
            ...((v3.diagnostics["generationDebug"] as Record<string, unknown> | undefined) ?? {}),
            relaxationSteps: controlledGenerationDiagnostics.relaxationSteps,
            finalRelaxedConstraints: controlledGenerationDiagnostics.selectedRelaxation,
            constraintFailures: controlledGenerationDiagnostics.constraintFailures,
            fallbackTriggered: true,
          },
          forensicPoolTrace: {
            ...((v3.diagnostics["forensicPoolTrace"] as Record<string, unknown> | undefined) ?? {}),
            finalHardFilterTrace,
          },
          fallback: true,
          reason: "empty_library",
          preV3Recovery: v3CandidatePool.diagnostics,
          preV3TopCandidates: diagnosticPool(selectedCandidate.inputPool, classMap, 60),
          waterfall: {
            ...baseWaterfall,
            repairCount: enforcedFallback.tracks.length,
            finalCount: enforcedFallback.tracks.length,
          },
          removalReasons,
          retrievalPoolsDetailed: retrievalPoolDiagnostics,
          intentContract,
          fallbacks: [
            ...fallbackActivations,
            {
              name: "empty_library",
              triggerReason: "v3_final_tracks_empty",
              tracksBefore: v3.finalTracks.length,
              tracksAfter: enforcedFallback.tracks.length,
            },
          ],
          intentContractGuard: intentContractGuardDiagnostics,
          controlledGeneration: controlledGenerationDiagnostics,
          pipelineTrace,
          timingMs: buildTimingMs(),
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
      pipelineTrace,
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
  if (finalTracksList.length < opts.playlistLength) {
    const resolvedUnderfill = resolveFinalTracks(
      [
        ...(finalTracksList as unknown as ScoredLibraryTrack<T>[]),
        ...lastResortPool,
        ...emergencyScoredPool,
      ],
      "final_underfill_completion",
    );
    if (resolvedUnderfill && resolvedUnderfill.finalTracks.length > finalTracksList.length) {
      return resolvedUnderfill;
    }
  }

  const controllerOwnedMomentMemory = updateMomentMemory({
    unifiedIntent: memoryAdjustedUnifiedIntent,
    finalPlaylistEmbedding: buildPlaylistEmbedding(finalTracksList).centroidVector,
    memoryKey: opts.momentMemoryKey,
  });
  const controllerOwnedGenreAudit = buildGenreAudit({
    userVector: opts.userGenreProfile.vector,
    finalTrackIds: finalTracksList.map((track) => track.trackId),
    classifications: opts.userGenreProfile.trackClassifications,
    adjustments: [],
    ontologyNodeCount: opts.genreStack.stats.ontologyNodes,
    ontologyTargetMet: opts.genreStack.stats.ontologyTargetMet,
    coverageState: scoring.coverageState,
    genreForecast: scoring.genreForecast,
    sceneInfluenceRatio: scoring.sceneInfluenceRatio,
    stabilityDiagnostics: scoring.stabilityDiagnostics,
  });
  const controllerOwnedTiming = buildTimingMs();
  return {
    finalTracks: finalTracksList as V3MetadataTrack<T>[],
    sorted: scoring.sorted,
    scoringDiagnostics: {
      ...scoring.scoringDiagnostics,
      unifiedIntent: unifiedIntentDiagnostics,
      momentMemory: {
        recentStates: controllerOwnedMomentMemory.recentStates.length,
        decayWeight: Math.round(controllerOwnedMomentMemory.aggregatedState.decayWeight * 1000) / 1000,
      },
      v3Pipeline: {
        ...v3.diagnostics,
        generationDebug: {
          ...((v3.diagnostics["generationDebug"] as Record<string, unknown> | undefined) ?? {}),
          relaxationSteps: controlledGenerationDiagnostics.relaxationSteps,
          finalRelaxedConstraints: controlledGenerationDiagnostics.selectedRelaxation,
          constraintFailures: controlledGenerationDiagnostics.constraintFailures,
          fallbackTriggered: fallbackActivations.length > 0,
        },
        forensicPoolTrace: {
          ...((v3.diagnostics["forensicPoolTrace"] as Record<string, unknown> | undefined) ?? {}),
          finalHardFilterTrace,
        },
        preV3Recovery: v3CandidatePool.diagnostics,
        qualityRecovery: qualityRecoveryDiagnostics,
        preV3TopCandidates: diagnosticPool(selectedCandidate.inputPool, classMap, 60),
        waterfall: {
          ...baseWaterfall,
          repairCount: finalTracksList.length,
          finalCount: finalTracksList.length,
          finalAssemblyOwner: "controller",
        },
        removalReasons,
        retrievalPoolsDetailed: retrievalPoolDiagnostics,
        intentContract,
        fallbacks: fallbackActivations,
        intentContractGuard: intentContractGuardDiagnostics,
        explicitGenreTruthGuard: {
          active: intentContract.genreFamilies.length > 0,
          rejectedCount: truthContradictedCount,
          rejectedForMissingPositiveEvidence: positiveEvidenceRejectedCount,
          remainingAfterGuard: contractGuardedScoredPool.length,
          expectedFamilies: intentContract.genreFamilies,
        },
        controlledGeneration: controlledGenerationDiagnostics,
        pipelineTrace,
        timingMs: controllerOwnedTiming,
        retrievalPools: {
          core: retrieval.core.length,
          anchor: retrieval.anchor.length,
          adjacent: retrieval.adjacent.length,
          bridge: retrieval.bridge.length,
          energyArc: retrieval.energyArc.length,
          discovery: retrieval.discovery.length,
        },
        finalAssemblyOwner: "controller",
        pipelinePostV3RepairSkipped: true,
      },
    },
    hybridExcludedCount: scoring.hybridExcludedCount,
    genreAudit: controllerOwnedGenreAudit,
    ecosystemDebug: null,
    pipelineTrace,
    composeMeta: {
      structured: finalTracksList as V3MetadataTrack<T>[],
      poolTarget: opts.playlistLength,
      afterDeadZone: finalTracksList as V3MetadataTrack<T>[],
      afterSmoothing: finalTracksList as V3MetadataTrack<T>[],
      afterArtistSep: finalTracksList as V3MetadataTrack<T>[],
      afterArc: finalTracksList as V3MetadataTrack<T>[],
      emotionalPeakTrackId: null,
      emotionalPeakIndex: null,
      gradientPhases: { start: 0, explore: 0.35, peak: 0.65, resolve: 1 },
    },
  };

}
