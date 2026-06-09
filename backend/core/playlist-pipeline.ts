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

function genreFamilyForTrack<T extends { trackId: string; genrePrimary?: string }>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): string | null {
  const classification = classMap.get(track.trackId);
  const family = classification?.genreFamily ?? classification?.genrePrimary ?? track.genrePrimary;
  const normalized = family ? getGenreFamily(family) : null;
  return normalized && normalized !== "unknown" ? normalized : null;
}

function trackMatchesGenreFamilies<T extends { trackId: string; genrePrimary?: string }>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  genreFamilies: string[],
): boolean {
  if (genreFamilies.length === 0) return true;
  const family = genreFamilyForTrack(track, classMap);
  return !!family && genreFamilies.includes(family);
}

function constrainPoolToGenreIntent<T extends { trackId: string; genrePrimary?: string }>(
  pool: T[],
  classMap: UserGenreProfile["trackClassifications"],
  genreFamilies: string[],
): T[] {
  if (genreFamilies.length === 0) return pool;
  const matching = pool.filter((track) => trackMatchesGenreFamilies(track, classMap, genreFamilies));
  return matching.length > 0 ? matching : pool;
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
  const v3IntentSourcePool = scoring.sorted as unknown as Array<T & { genrePrimary?: string; releaseYear?: number | null }>;
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
  const explicitPromptGenreFamilies = buildLockedIntent(opts.vibe).genreFamilies;
  const v3LockedIntent = buildV3LockedIntent(
    unifiedIntentContextWithMemory,
    previousUnifiedIntentContext,
    opts.emotionProfile,
    v3IntentSourcePool,
    classMap,
    explicitPromptGenreFamilies,
  );
  const unifiedIntentDiagnostics = resolveUnifiedIntent([
    ...unifiedIntentContextWithMemory.diagnostics.snapshots,
    unifiedIntentFromLockedIntent(v3LockedIntent),
    unifiedIntentFromSceneIntent(v3LockedIntent.sceneIntent),
  ]);
  const v3CandidatePool = buildV3CandidatePool(
    scoring.sorted as unknown as Array<T & { genrePrimary?: string; releaseYear?: number | null }>,
    classMap,
    opts.playlistLength,
    v3LockedIntent,
    opts.pipelineLog,
  );

  opts.pipelineLog?.info({
    sampleTrack: scoring.sorted[0] ?? null,
    hasEnergy: scoring.sorted.filter((track) => track.energy != null).length,
    hasValence: scoring.sorted.filter((track) => track.valence != null).length,
  }, "Spotify feature coverage before V3");

  opts.pipelineLog?.info({
    preV3PoolSize: v3CandidatePool.tracks.length,
    forensicPreV3Trace: v3CandidatePool.diagnostics["forensicPreV3Trace"],
  }, "Pre-V3 candidate pool built");

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
      unifiedIntentContext:   unifiedIntentContextWithMemory,
      momentMemory:           preGenerationMomentMemory,
    }
  );
  logScoringStage(opts.pipelineLog, "V3 multi-lane pipeline complete", t, {
    poolSize: v3CandidatePool.tracks.length,
    selectedCount: v3.finalTracks.length,
    lanes: (v3.diagnostics["lanes"] as Array<{ laneId: string }>)?.map((l) => l.laneId),
    preV3Recovery: v3CandidatePool.diagnostics,
    genreGuard: {
      explicitPromptGenreFamilies,
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

  const genreGuardedScoredPool = constrainPoolToGenreIntent(
    scoring.sorted,
    classMap,
    explicitPromptGenreFamilies,
  );
  const genreGuardDiagnostics = {
    explicitPromptGenreFamilies,
    inputCount: scoring.sorted.length,
    guardedCount: genreGuardedScoredPool.length,
    active: explicitPromptGenreFamilies.length > 0 && genreGuardedScoredPool.length < scoring.sorted.length,
  };

  const lastResortPool: ScoredLibraryTrack<T>[] = genreGuardedScoredPool
    .filter((track) => track.genrePrimary || track.energy != null || track.valence != null)
    .slice(0, 50);
  const emergencyScoredPool: ScoredLibraryTrack<T>[] = genreGuardedScoredPool
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
      sortedPool: genreGuardedScoredPool,
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
          genreGuard: genreGuardDiagnostics,
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
        : genreGuardedScoredPool
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
      const safeGlobalTracks: ScoredLibraryTrack<T>[] = genreGuardedScoredPool.filter((track) => {
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
          genreGuard: genreGuardDiagnostics,
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
    genreGuardedScoredPool,
    classMap,
    opts.maxPerArtist,
    opts.playlistLength,
  );
  const criticFinalTracks = playlistCritic.tracks;

  // Genre enforcement safety net — audit only; V3 structural diversity already
  // prevents collapse inside each lane (35% genre / 50% energy / 60% era caps).
  t = Date.now();
  const enforced = enforceFinalPlaylistGenres({
    finalTracks: [...criticFinalTracks] as unknown as ScoredLibraryTrack<T>[],
    sortedPool: genreGuardedScoredPool,
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
  const finalTracksForReturn = enforced.tracks.length > 0
    ? enforced.tracks as unknown as T[]
    : criticFinalTracks;
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
        genreGuard: genreGuardDiagnostics,
        playlistCritic: playlistCritic.diagnostics,
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
