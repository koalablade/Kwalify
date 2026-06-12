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
import {
  buildRecentTrackPoolPenalty,
  type FreshnessStats,
} from "../lib/playlist-freshness";
import type { GenreAudit } from "../lib/genre-audit";
import { classifyTrack } from "../lib/genre-taxonomy";
import type { ScoredLibraryTrack } from "./scoring-engine/types";
import { logScoringStage } from "../lib/generate-stage-timer";
import type { EcosystemDebug } from "../lib/ecosystem-lock";
import { detectEraFromYear, estimateEraFromAudio } from "./v2/era-model";
import { buildLockedIntent, completeLockedIntent, eraRangeFromBucket, type LockedIntent } from "./v3/intent";
import { constraintRejectionReasons, trackMatchesConstraints } from "./v3/constraint-filter";
import { getGenreFamily } from "./v3/global-diversity-controller";
import {
  warnIfFieldDropped,
  warnIfV3MetadataLost,
  type V3MetadataTrack,
  type V3TrackMetadata,
} from "../lib/v3-track-contract";

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
  trackName?: string;
  artistName?: string;
  albumName?: string;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: string[] | null;
  albumGenres?: string[] | null;
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
  const directSignals = [
    classification?.genreFamily,
    classification?.genrePrimary,
    track.genreFamily,
    track.genrePrimary,
    ...(track.spotifyArtistGenres ?? []),
    ...(track.albumGenres ?? []),
    ...(track.genres ?? []),
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

function trackEraRange<T extends {
  releaseYear?: number | null;
  laneEra?: string | null;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
}>(track: T): { start: number; end: number } | null {
  if (track.releaseYear !== null && track.releaseYear !== undefined) {
    return { start: track.releaseYear, end: track.releaseYear };
  }
  const laneEra = eraRangeFromBucket(track.laneEra);
  if (laneEra) return laneEra;
  return eraRangeFromBucket(estimateEraFromAudio(track));
}

function hardFinalRejectionReasons<T extends {
  trackId: string;
  genrePrimary?: string | null;
  releaseYear?: number | null;
  laneEra?: string | null;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  lockedIntent: LockedIntent,
  suppressGenres: string[],
): string[] {
  const reasons: string[] = [];
  const family = genreFamilyForTrack(track, classMap);
  if (family && suppressGenres.map((g) => getGenreFamily(g)).includes(family)) {
    reasons.push("excludedGenre");
  }
  if (lockedIntent.eraRange) {
    const range = trackEraRange(track);
    if (!range) {
      reasons.push("unknownStrictEra");
    } else if (range.end < lockedIntent.eraRange.start || range.start > lockedIntent.eraRange.end) {
      reasons.push("strictEraMismatch");
    }
  }
  return reasons;
}

function hardValidFinalPool<T extends {
  trackId: string;
  genrePrimary?: string | null;
  releaseYear?: number | null;
  laneEra?: string | null;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
}>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
  lockedIntent: LockedIntent,
  suppressGenres: string[],
): { tracks: T[]; rejected: Record<string, number> } {
  const rejected: Record<string, number> = {};
  const hardValid = tracks.filter((track) => {
    const reasons = hardFinalRejectionReasons(track, classMap, lockedIntent, suppressGenres);
    if (reasons.length > 0) incrementReasons(rejected, reasons);
    return reasons.length === 0;
  });
  return { tracks: hardValid, rejected };
}

function fillFromHardValidPool<T extends { trackId: string }>(
  selected: T[],
  pool: T[],
  targetCount: number,
): { tracks: T[]; addedCount: number } {
  if (selected.length >= targetCount) {
    return { tracks: selected.slice(0, targetCount), addedCount: 0 };
  }
  const used = new Set(selected.map((track) => track.trackId));
  const filled = [...selected];
  for (const candidate of pool) {
    if (filled.length >= targetCount) break;
    if (used.has(candidate.trackId)) continue;
    filled.push(candidate);
    used.add(candidate.trackId);
  }
  return { tracks: filled, addedCount: filled.length - selected.length };
}

function mergeUniqueByTrackId<T extends { trackId: string }>(primary: T[], secondary: T[]): T[] {
  const used = new Set<string>();
  const out: T[] = [];
  for (const track of [...primary, ...secondary]) {
    if (used.has(track.trackId)) continue;
    used.add(track.trackId);
    out.push(track);
  }
  return out;
}

function minimumViablePlaylistSize(requestedLength: number): number {
  return Math.min(10, requestedLength);
}

const SOFT_CONSTRAINT_DEGRADATION_ORDER = [
  "artist_cap",
  "album_cap",
  "cluster_purity",
  "mood_audio_strictness",
] as const;

function withSoftFallbackMetadata<T extends {
  trackId: string;
  genrePrimary?: string | null;
  releaseYear?: number | null;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): V3MetadataTrack<T> {
  const classification = classMap.get(track.trackId);
  const genrePrimary = classification?.genrePrimary ??
    classification?.genreFamily ??
    track.genrePrimary ??
    "unknown";
  const genreFamily = genreFamilyForTrack(track, classMap) ?? getGenreFamily(genrePrimary) ?? "unknown";
  const laneEra = track.releaseYear ? detectEraFromYear(track.releaseYear) : estimateEraFromAudio(track);
  const trackWithScores = track as unknown as { laneScore?: unknown; score?: unknown };
  const laneScore = typeof trackWithScores.laneScore === "number"
    ? trackWithScores.laneScore
    : typeof trackWithScores.score === "number"
      ? trackWithScores.score
      : 0;

  return {
    ...track,
    genrePrimary,
    sourceLane: (track as V3TrackMetadata).sourceLane ?? "soft_fallback",
    laneId: (track as V3TrackMetadata).laneId ?? (track as V3TrackMetadata).sourceLane ?? "soft_fallback",
    laneScore,
    laneEra,
    clusterId: (track as V3TrackMetadata).clusterId ?? `genre:${genreFamily}`,
    clusterIds: (track as V3TrackMetadata).clusterIds?.length
      ? (track as V3TrackMetadata).clusterIds
      : [`genre:${genreFamily}`],
    selectedByV3: (track as V3TrackMetadata).selectedByV3 ?? false,
  };
}

function topGenreFamiliesFromPool<T extends { trackId: string; genrePrimary?: string | null }>(
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

function hasLaneReadyEra(track: {
  releaseYear?: number | null;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
}): boolean {
  if (track.releaseYear) return detectEraFromYear(track.releaseYear) !== "any";
  return estimateEraFromAudio(track) !== "any";
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
    track.energy !== null &&
    hasLaneReadyEra(track);
}

function v3LaneReadinessRejectionReasons<T extends {
  trackId: string;
  genrePrimary?: string | null;
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): string[] {
  const reasons: string[] = [];
  if (!genreFamilyForTrack(track, classMap)) reasons.push("missingGenreFamily");
  if (track.energy === null) reasons.push("missingEnergy");
  if (!hasLaneReadyEra(track)) reasons.push("unknownEra");
  return reasons;
}

function trackMatchesLockedIntent<T extends {
  trackId: string;
  genrePrimary?: string | null;
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
  const classification = classMap.get(track.trackId);
  return trackMatchesConstraints({
    ...track,
    genreFamily: classification?.genreFamily ?? classification?.genrePrimary ?? track.genrePrimary,
    genrePrimary: classification?.genrePrimary ?? track.genrePrimary,
    laneEra: track.releaseYear ? detectEraFromYear(track.releaseYear) : estimateEraFromAudio(track),
  }, lockedIntent);
}

function lockedIntentRejectionReasons<T extends {
  trackId: string;
  genrePrimary?: string | null;
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
): string[] {
  const classification = classMap.get(track.trackId);
  return constraintRejectionReasons({
    ...track,
    genreFamily: classification?.genreFamily ?? classification?.genrePrimary ?? track.genrePrimary,
    genrePrimary: classification?.genrePrimary ?? track.genrePrimary,
    laneEra: track.releaseYear ? detectEraFromYear(track.releaseYear) : estimateEraFromAudio(track),
  }, lockedIntent);
}

function incrementReasons(target: Record<string, number>, reasons: string[]): void {
  for (const reason of reasons.length > 0 ? reasons : ["unknown"]) {
    target[reason] = (target[reason] ?? 0) + 1;
  }
}

function familyCount<T extends { trackId: string; genrePrimary?: string | null }>(
  tracks: T[],
  classMap: UserGenreProfile["trackClassifications"],
): number {
  return new Set(
    tracks
      .map((track) => genreFamilyForTrack(track, classMap))
      .filter((family): family is string => !!family)
  ).size;
}

function familyDistribution<T extends { trackId: string; genrePrimary?: string | null }>(
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
  genrePrimary?: string | null;
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
): { tracks: T[]; diagnostics: Record<string, unknown> } {
  const laneReadinessRejections: Record<string, number> = {};
  const intentRejections: Record<string, number> = {};
  const laneReady = sorted.filter((track) => {
    const reasons = v3LaneReadinessRejectionReasons(track, classMap);
    if (reasons.length > 0) {
      incrementReasons(laneReadinessRejections, reasons);
      return false;
    }
    return true;
  });
  const intentReady = laneReady.filter((track) => {
    const reasons = lockedIntentRejectionReasons(track, classMap, lockedIntent);
    if (reasons.length > 0) {
      incrementReasons(intentRejections, reasons);
      return false;
    }
    return true;
  });
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
  return {
    tracks,
    diagnostics: {
      inputCount: sorted.length,
      laneReadyCount: laneReady.length,
      intentReadyCount: intentReady.length,
      candidateCount: tracks.length,
      laneReadinessRejectedCount: sorted.length - laneReady.length,
      intentRejectedCount: laneReady.length - intentReady.length,
      laneReadinessRejections,
      intentRejections,
      genreFamilyClusters: familyCount(tracks, classMap),
      expandedForFamilySpread: windowSize > baseWindow,
      v11Uncollapse: uncollapsed.diagnostics,
    },
  };
}

function v3EmptyReason(diagnostics: Record<string, unknown>): string {
  const inputCount = Number(diagnostics["inputCount"] ?? 0);
  const laneReadyCount = Number(diagnostics["laneReadyCount"] ?? 0);
  const intentReadyCount = Number(diagnostics["intentReadyCount"] ?? 0);
  const candidateCount = Number(diagnostics["candidateCount"] ?? 0);
  if (inputCount === 0) return "empty_input";
  if (laneReadyCount === 0) return "lane_readiness_filtered_all";
  if (intentReadyCount === 0) return "locked_intent_filtered_all";
  if (candidateCount === 0) return "candidate_recovery_empty";
  return "v3_selection_empty";
}

function buildV3LockedIntent<T extends {
  trackId: string;
  genrePrimary?: string;
  releaseYear?: number | null;
}>(
  vibe: string,
  lastSuccessfulVibe: string | null | undefined,
  profile: EmotionProfile,
  candidatePool: T[],
  classMap: UserGenreProfile["trackClassifications"],
): LockedIntent {
  const parsedIntent = buildLockedIntent(vibe.trim());
  const previousIntent = lastSuccessfulVibe?.trim()
    ? buildLockedIntent(lastSuccessfulVibe)
    : null;
  const hasExplicitGenre = parsedIntent.genreFamilies.length > 0;
  const hasExplicitEra = !!parsedIntent.eraRange;
  return completeLockedIntent(parsedIntent, {
    genreFamilies: hasExplicitGenre
      ? parsedIntent.genreFamilies
      : undefined,
    eraRange: hasExplicitEra
      ? parsedIntent.eraRange
      : undefined,
    mood: previousIntent?.mood.length ? previousIntent.mood : moodFallbackFromProfile(profile),
    activity: previousIntent?.activity ?? "listening",
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
  const v3IntentSourcePool = scoring.sorted as unknown as Array<T & { genrePrimary?: string; releaseYear?: number | null }>;
  const v3LockedIntent = buildV3LockedIntent(
    opts.vibe,
    opts.lastSuccessfulVibe,
    opts.emotionProfile,
    v3IntentSourcePool,
    classMap,
  );
  const v3CandidatePool = buildV3CandidatePool(
    scoring.sorted as unknown as Array<T & { genrePrimary?: string; releaseYear?: number | null }>,
    classMap,
    opts.playlistLength,
    v3LockedIntent,
  );

  let t = Date.now();
  const v3 = runV3Pipeline(
    v3CandidatePool.tracks as unknown as T[],
    opts.vibe,
    opts.emotionProfile,
    opts.playlistLength,
    {
      genreByTrack:          (trackId) => classMap.get(trackId)?.genrePrimary ?? "unknown",
      classificationByTrack: (trackId) => classMap.get(trackId),
      noveltyByTrack:        opts.noveltyByTrack,
      seed:                  opts.postScore.startMs,
      lockedIntent:          v3LockedIntent,
    }
  );
  logScoringStage(opts.pipelineLog, "V3 multi-lane pipeline complete", t, {
    poolSize: v3CandidatePool.tracks.length,
    selectedCount: v3.finalTracks.length,
    lanes: (v3.diagnostics["lanes"] as Array<{ laneId: string }>)?.map((l) => l.laneId),
  });

  // V3 final tracks are authoritative; do not rehydrate from scored tracks here,
  // or V3 metadata such as sourceLane/laneScore/clusterIds can be dropped.
  const finalTracksList = v3.finalTracks as V3MetadataTrack<T>[];
  const fallbackPool = v3CandidatePool.tracks as unknown as ScoredLibraryTrack<T>[];
  const hardFallbackPool = hardValidFinalPool(
    fallbackPool,
    classMap,
    v3LockedIntent,
    opts.genrePost.suppressGenres,
  );
  const expandedHardFallbackPool = hardValidFinalPool(
    scoring.sorted,
    classMap,
    v3LockedIntent,
    opts.genrePost.suppressGenres,
  );
  const softFallbackPool = mergeUniqueByTrackId(
    hardFallbackPool.tracks,
    expandedHardFallbackPool.tracks,
  ).map((track) =>
    withSoftFallbackMetadata(track, classMap)
  );
  const minPlaylistSize = minimumViablePlaylistSize(opts.playlistLength);

  // Last-resort fallback: V3 produced nothing (no audio features / empty lib)
  if (finalTracksList.length === 0) {
    const recentTrackPenalty = opts.recentPlaylistTrackIds?.length
      ? buildRecentTrackPoolPenalty(opts.recentPlaylistTrackIds, 5, opts.varietyPenaltyScale ?? 1)
      : undefined;
    const composed = composePlaylistFromPool({
      sortedPool: hardFallbackPool.tracks,
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
      sortedPool: hardFallbackPool.tracks,
      userGenreProfile: opts.userGenreProfile,
      genreStack: opts.genreStack,
      allowHoliday: opts.genrePost.allowHoliday,
      suppressGenres: opts.genrePost.suppressGenres,
      coverageState: scoring.coverageState,
      genreForecast: scoring.genreForecast,
      sceneInfluenceRatio: scoring.sceneInfluenceRatio,
      stabilityDiagnostics: scoring.stabilityDiagnostics,
    });
    const preRepairTracks = composed.finalTracks.map((track) =>
      withSoftFallbackMetadata(track, classMap)
    );
    const repairTracks = enforcedFallback.tracks.map((track) =>
      withSoftFallbackMetadata(track, classMap)
    );
    const repairPreservedTracks = repairTracks.length > 0 ? repairTracks : preRepairTracks;
    const softFilled = fillFromHardValidPool(
      repairPreservedTracks,
      softFallbackPool,
      opts.playlistLength,
    );
    return {
      finalTracks: softFilled.tracks,
      sorted: scoring.sorted,
      scoringDiagnostics: {
        ...scoring.scoringDiagnostics,
        v3Pipeline: {
          fallback: true,
          reason: v3EmptyReason(v3CandidatePool.diagnostics),
          preV3Recovery: v3CandidatePool.diagnostics,
          finalValidation: {
            mode: "hard_only",
            hardConstraints: {
              strictEra: !!v3LockedIntent.eraRange,
              suppressGenres: opts.genrePost.suppressGenres,
            },
            hardRejected: hardFallbackPool.rejected,
            expandedHardRejected: expandedHardFallbackPool.rejected,
            hardValidFallbackCount: hardFallbackPool.tracks.length,
            expandedHardValidFallbackCount: expandedHardFallbackPool.tracks.length,
            minPlaylistSize,
            repair: {
              inputCount: preRepairTracks.length,
              outputCount: repairTracks.length,
              preservedPreRepair: repairTracks.length === 0 && preRepairTracks.length > 0,
            },
            softFallback: {
              trigger: `playlist_size_below_${minPlaylistSize}`,
              applied: softFilled.addedCount > 0 ||
                repairPreservedTracks.length < minPlaylistSize ||
                (repairTracks.length === 0 && preRepairTracks.length > 0),
              addedCount: softFilled.addedCount,
              sourceCount: softFallbackPool.length,
              sourceOrder: ["preRepairViablePool", "expandedScoredPool"],
              degradationOrder: SOFT_CONSTRAINT_DEGRADATION_ORDER,
              confidenceBlocksReturn: false,
            },
            finalCount: softFilled.tracks.length,
          },
        },
      },
      hybridExcludedCount: scoring.hybridExcludedCount,
      genreAudit: enforcedFallback.genreAudit,
      ecosystemDebug: null,
      composeMeta: {
        structured: softFilled.tracks,
        poolTarget: opts.playlistLength,
        afterDeadZone: softFilled.tracks,
        afterSmoothing: softFilled.tracks,
        afterArtistSep: softFilled.tracks,
        afterArc: softFilled.tracks,
        emotionalPeakTrackId: composed.emotionalPeakTrackId,
        emotionalPeakIndex: composed.emotionalPeakIndex,
        gradientPhases: composed.gradientPhases,
      },
    };
  }

  // Genre enforcement safety net — audit only; V3 structural diversity already
  // prevents collapse inside each lane (35% genre / 50% energy / 60% era caps).
  t = Date.now();
  const enforced = enforceFinalPlaylistGenres({
    finalTracks: [...finalTracksList] as unknown as ScoredLibraryTrack<T>[],
    sortedPool: scoring.sorted,
    userGenreProfile: opts.userGenreProfile,
    genreStack: opts.genreStack,
    allowHoliday: opts.genrePost.allowHoliday,
    suppressGenres: opts.genrePost.suppressGenres,
    coverageState: scoring.coverageState,
    genreForecast: scoring.genreForecast,
    sceneInfluenceRatio: 0,
    stabilityDiagnostics: scoring.stabilityDiagnostics,
  });
  const hardSelected = hardValidFinalPool(
    finalTracksList,
    classMap,
    v3LockedIntent,
    opts.genrePost.suppressGenres,
  );
  const hardOnlyFilled = fillFromHardValidPool(
    hardSelected.tracks,
    softFallbackPool,
    opts.playlistLength,
  );
  const finalTracksForReturn = hardOnlyFilled.tracks as V3MetadataTrack<T>[];
  logScoringStage(opts.pipelineLog, "V3 genre audit complete", t, {
    tracks: finalTracksForReturn.length,
  });
  warnIfV3MetadataLost(
    v3.finalTracks,
    finalTracksForReturn,
    "v3-output-to-create-playlist"
  );
  warnIfFieldDropped("laneScore", v3.finalTracks, finalTracksForReturn, "v3-output-to-create-playlist");
  warnIfFieldDropped("clusterIds", v3.finalTracks, finalTracksForReturn, "v3-output-to-create-playlist");

  return {
    finalTracks: finalTracksForReturn,
    sorted: scoring.sorted,
    scoringDiagnostics: {
      ...scoring.scoringDiagnostics,
      v3Pipeline: {
        ...v3.diagnostics,
        preV3Recovery: v3CandidatePool.diagnostics,
        finalValidation: {
          mode: "hard_only",
          hardConstraints: {
            strictEra: !!v3LockedIntent.eraRange,
            suppressGenres: opts.genrePost.suppressGenres,
          },
          hardRejected: {
            selected: hardSelected.rejected,
            fallbackPool: hardFallbackPool.rejected,
            expandedFallbackPool: expandedHardFallbackPool.rejected,
          },
          selectedBeforeHardValidation: finalTracksList.length,
          selectedAfterHardValidation: hardSelected.tracks.length,
          hardValidFallbackCount: hardFallbackPool.tracks.length,
          expandedHardValidFallbackCount: expandedHardFallbackPool.tracks.length,
          minPlaylistSize,
          repair: {
            inputCount: finalTracksList.length,
            outputCount: finalTracksList.length,
            preservedPreRepair: false,
          },
          softFallback: {
            trigger: `playlist_size_below_${minPlaylistSize}`,
            applied: hardOnlyFilled.addedCount > 0 || hardSelected.tracks.length < minPlaylistSize,
            addedCount: hardOnlyFilled.addedCount,
            sourceCount: softFallbackPool.length,
            sourceOrder: ["preRepairViablePool", "expandedScoredPool"],
            degradationOrder: SOFT_CONSTRAINT_DEGRADATION_ORDER,
            confidenceBlocksReturn: false,
          },
          finalCount: finalTracksForReturn.length,
        },
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
