/**
 * Purpose: Playlist generation endpoint — the core of Kwalify.
 * Responsibilities:
 *   - POST /generate    — score the user's liked songs against a vibe and create a Spotify playlist
 *   - GET  /generate/status — return the current generation phase for the user
 * Dependencies: emotion engine, genre intelligence stack, playlist pipeline, Spotify API, drizzle-orm
 */
import { Router, type IRouter, type Request } from "express";
import { db } from "../db";
import {
  likedSongsTable,
  playlistHistoryTable,
  savedPlaylistsTable,
} from "../db";
import {
  createSpotifyPlaylist,
  enrichTrackMetadata,
  fetchAlbumMetadata,
  fetchArtistGenres,
  fetchAudioFeatures,
  getValidAccessToken,
  searchSpotifyTracks,
} from "../lib/spotify";
import {
  blendEmotionProfiles,
  fingerprintToEmotionProfile,
  loadReferenceFingerprint,
  type ReferenceFingerprint,
} from "../lib/reference-playlist";
import { eq, desc } from "drizzle-orm";
import { parseEmotionalDestination } from "../lib/emotion-destination";
import {
  buildAlbumAppearanceMap,
  buildArtistAppearanceMap,
  buildFreshnessStats,
  buildRecentTrackPoolPenalty,
  countRecentJourneyArc,
  journeyArcCooldownMultiplier,
  sceneClonePenalty,
} from "../lib/playlist-freshness";
import { boundedTrackReusePenalty } from "../core/v3/diversity-pressure";
import { rediscoveryJitter } from "../lib/rediscovery";
import { buildLibrarySignals, type LikedSongRow } from "../lib/library-signals";
import { detectRediscoveryMode, type RediscoveryMode } from "../lib/forgotten-favourites";
import { detectMusicChapters, matchChapterFromVibe } from "../lib/music-life-chapters";
import { detectArchaeologyIntent } from "../lib/library-archaeology";
import { computeSurpriseMix } from "../lib/human-surprise";
import { analyzeMomentPipeline } from "../lib/moment-pipeline";
import { getUserGenreProfileForGenerate } from "../lib/genre-profile-cache";
import { getCachedLikedSongs, setCachedLikedSongs } from "../lib/liked-songs-cache";
import { classifyTrack } from "../lib/genre-taxonomy";
import { getGenreFamily } from "../core/v3/global-diversity-controller";
import { buildGenreIntelligenceStack } from "../lib/genre-intelligence-stack";
import {
  getCachedGenreStack,
  setCachedGenreStack,
} from "../lib/genre-stack-cache";
import {
  getGenerateCacheKey,
  getGenerateCacheEntryStatus,
  getCachedGenerateResult,
  setCachedGenerateResult,
} from "../lib/generate-result-cache";
import { trackHasEraEvidence, trackHasKnownEraMismatch } from "../lib/era-evidence";
import { createRequestBudget } from "../lib/request-budget";
import {
  REQUEST_HARD_TIMEOUT_MS,
  MINIMAL_GENRE_STACK_THRESHOLD,
  resolveHybridPoolCap,
} from "../lib/production-limits";
import {
  acquireGenerateSession,
  endGenerateSession,
  setGeneratePhase,
  setGenerateStageDetail,
  isGenerateCancelled,
  getPendingSpotifyPlaylistId,
  setPendingSpotifyPlaylistId,
  clearPendingSpotifyPlaylist,
  getGenerateProgress,
  getGenerateStatus,
  setGeneratePartialTracks,
  cancelGenerateSession,
} from "../lib/generate-session";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { isShuttingDown } from "../lib/shutdown";
import { createGenerateStageTimer } from "../lib/generate-stage-timer";
import {
  buildFallbackPipelineResult,
  formatTracksForApi,
} from "../lib/generate-helpers";
import { decodeIntent } from "../lib/intent-decoder";
import { computeTemporalMemory } from "../lib/temporal-memory";
import type { BuildPlaylistPipelineResult } from "../core/output";
import type { GenreAudit } from "../lib/genre-audit";
import { summarizePipeline } from "../lib/scoring-explanation";
import { scorePromptConfidence } from "../lib/prompt-confidence";
import { buildGenerationExplanation } from "../lib/vibe-explanation";
import { buildMomentUnderstanding } from "../lib/moment-understanding";
import { detectMixedEmotions } from "../lib/multi-emotion";
import {
  analyzeVibeWithContext,
  generatePlaylistName,
  detectVibeKind,
  detectJourneyArc,
  type EmotionProfile,
} from "../lib/emotion";
import { GeneratePlaylistBody } from "../zod/api";
import { checkRateLimit } from "../lib/rate-limit";
import { getFeatures } from "../lib/env";
import { publicUrl } from "../lib/public-url";
import { resolveSemanticScene } from "../lib/semantic-scene-engine";
import { detectEra } from "../lib/era-detection";
import {
  MOCK_SPOTIFY_USER_ID,
  buildMockUserGenreProfile,
  generateMockSpotifyLibrary,
} from "../lib/mock-spotify";
import {
  warnIfFieldDropped,
  warnIfV3MetadataLost,
  type V3MetadataTrack,
} from "../lib/v3-track-contract";
import { buildFeedbackDiagnostics, getFeedbackMemory } from "../lib/feedback-memory";
import {
  buildCuratorIdentity,
  buildIdentityDebugView,
  scoreTrackForIdentity,
  type CuratorIdentity,
  type IdentitySessionMemory,
} from "../lib/curator-identity";
import { runRequestLayerGeneration, type RequestGenerationOrchestration } from "../lib/request-generation-orchestrator";
import {
  buildLockedIntent as buildCsspLockedIntent,
  completeLockedIntent as completeCsspLockedIntent,
  GENRE_ALIASES,
} from "../core/v3/intent";
import { trackMatchesConstraints as trackMatchesV3Constraints } from "../core/v3/constraint-filter";
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
import { beginSpotifyApiAudit, getSpotifyApiAuditSnapshot } from "../lib/spotify-api-audit";
import { buildIntentSurvivalDiagnostics } from "../lib/intent-survival-diagnostics";

const generationControllerLock = "__kwalifyGenerationControllerRegistered";
const STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO = 0.85;
const STRICT_EXPLICIT_ERA_EVIDENCE_RATIO = 0.85;
const globalArchitectureState = globalThis as typeof globalThis & Record<string, unknown>;
if (globalArchitectureState[generationControllerLock]) {
  throw new Error(
    "[architecture] duplicate generation controller loaded; backend/controllers/generation.controller.ts is the single source of truth",
  );
}
globalArchitectureState[generationControllerLock] = true;

const router: IRouter = Router();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const FINALIZATION_POOL_MIN = 180;
const FINALIZATION_POOL_PER_TRACK = 12;
const FINALIZATION_POOL_MAX = 360;

type GenerationSideEffectPolicy = {
  mode: "production" | "audit";
  allowSpotifyPlaylistCreate: boolean;
  allowSavedPlaylistWrites: boolean;
  allowHistoryWrites: boolean;
  allowFeedbackWrites: boolean;
  allowAnalyticsWrites: boolean;
  allowResultCacheWrites: boolean;
  bypassRateLimit: boolean;
};

const PRODUCTION_SIDE_EFFECT_POLICY: GenerationSideEffectPolicy = {
  mode: "production",
  allowSpotifyPlaylistCreate: true,
  allowSavedPlaylistWrites: true,
  allowHistoryWrites: true,
  allowFeedbackWrites: true,
  allowAnalyticsWrites: true,
  allowResultCacheWrites: true,
  bypassRateLimit: false,
};

const AUDIT_SIDE_EFFECT_POLICY: GenerationSideEffectPolicy = {
  mode: "audit",
  allowSpotifyPlaylistCreate: false,
  allowSavedPlaylistWrites: false,
  allowHistoryWrites: false,
  allowFeedbackWrites: false,
  allowAnalyticsWrites: false,
  allowResultCacheWrites: false,
  bypassRateLimit: true,
};

function requestHeader(req: Request, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : typeof value === "string" ? value : null;
}

function generationAuditTokenAuthorized(req: Request): boolean {
  const expected = process.env["PLAYLIST_EVAL_TOKEN"]?.trim();
  if (!expected) return false;
  return requestHeader(req, "x-kwalify-evaluation-token") === expected;
}

const NEUTRAL_PROFILE: EmotionProfile = {
  energy: 0.5,
  valence: 0.5,
  tension: 0.3,
  nostalgia: 0.2,
  calm: 0.5,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

type PreV3TimingBreakdown = {
  cacheTimeMs: number;
  dbTimeMs: number;
  likedSongsQueryMs: number;
  playlistHistoryQueryMs: number;
  genreProfileTimeMs: number;
  genreStackTimeMs: number;
  freshnessTimeMs: number;
  librarySignalTimeMs: number;
  moodIntentTimeMs: number;
  spotifyReferenceTimeMs: number;
  totalBeforeV3Ms: number;
  slowestStage: string | null;
  slowestStageMs: number;
};

type QualitySignalContext = {
  primary: string;
  moodTags: string[];
  activityTags: string[];
  eraHints: string[];
  genreHints: string[];
  canonicalHints: string[];
};

type ConstraintLayer = {
  hard: {
    genres: string[];
    excludedGenres: string[];
    eraStart: number | null;
    eraEnd: number | null;
    strictLock: boolean;
    allowMultiGenre: boolean;
    allowBridge: boolean;
  };
  soft: {
    moodTags: string[];
    activityTags: string[];
    energyTags: string[];
    atmosphereTags: string[];
  };
  raw: {
    explicitGenreTerms: string[];
    explicitEraTerms: string[];
    strictTerms: string[];
    excludedTerms: string[];
    multiGenreTerms: string[];
    americanaBridgePrompt: boolean;
  };
};

type LockedIntent = {
  genreFamilies: string[];
  eraRange: { start: number; end: number } | null;
  energy: "low" | "medium" | "high" | null;
  primaryGenres: string[];
  primaryGenre: string | null;
  primarySubgenre: string | null;
  secondarySubgenre: string | null;
  subgenreTerms: string[];
  eraStart: number | null;
  eraEnd: number | null;
  mood: string[];
  activity: string | null;
  energyLevel: "low" | "medium" | "high" | null;
  interpretationBudget?: {
    complexity: "low" | "medium" | "high";
    complexityScore: number;
    maxDimensions: number;
    inferredDimensionsUsed: number;
    inferredDimensionsAvailable: number;
    appliedDimensions: string[];
    droppedDimensions: string[];
  };
};

type ConstraintTrack = V3MetadataTrack<{
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  loudness?: number | null;
  speechiness?: number | null;
  releaseYear?: number | null;
  addedAt?: Date | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
}> & {
  score: number;
  rediscoveryScore?: number;
  narrativeRole?: string;
};

function createPreV3Timing(): PreV3TimingBreakdown {
  return {
    cacheTimeMs: 0,
    dbTimeMs: 0,
    likedSongsQueryMs: 0,
    playlistHistoryQueryMs: 0,
    genreProfileTimeMs: 0,
    genreStackTimeMs: 0,
    freshnessTimeMs: 0,
    librarySignalTimeMs: 0,
    moodIntentTimeMs: 0,
    spotifyReferenceTimeMs: 0,
    totalBeforeV3Ms: 0,
    slowestStage: null,
    slowestStageMs: 0,
  };
}

function recordPreV3Timing(
  timing: PreV3TimingBreakdown,
  key: keyof Omit<PreV3TimingBreakdown, "totalBeforeV3Ms" | "slowestStage" | "slowestStageMs">,
  ms: number
): void {
  timing[key] += ms;
  if (timing[key] > timing.slowestStageMs) {
    timing.slowestStage = key;
    timing.slowestStageMs = timing[key];
  }
}

function staleGenerate(userId: string, requestId: string): boolean {
  return isGenerateCancelled(userId, requestId);
}

function responseFinished(res: import("express").Response): boolean {
  return res.headersSent || res.writableEnded || res.destroyed;
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function useMockSpotify(): boolean {
  return getFeatures().devMode.useMockSpotify;
}

function currentGenerateUserId(req: import("express").Request): string | null {
  return useMockSpotify() ? MOCK_SPOTIFY_USER_ID : req.session.spotifyUserId ?? null;
}

/** Cancelled/superseded session — always send a response so the client does not hang. */
function respondIfStale(
  res: import("express").Response,
  userId: string,
  requestId: string
): boolean {
  if (!staleGenerate(userId, requestId)) return false;
  if (!responseFinished(res)) {
    res.status(409).json({
      success: false,
      code: "GENERATION_CANCELLED",
      error:
        "This generation was superseded or cancelled. Try again if you need a new playlist.",
      tracks: [],
      spotifyUnavailable: true,
      generationDiagnostics: {
        recoveryTriggered: false,
        fallbackLevel: "none",
        sessionCancelled: true,
      },
    });
  }
  return true;
}

/** Consistent /generate failure payload (API shape unchanged). */
function generateFail(
  res: import("express").Response,
  status: number,
  code: string,
  error: string,
  extra?: Record<string, unknown>
): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.status(status).json({
    success: false,
    code,
    error,
    tracks: [],
    spotifyUnavailable: true,
    ...extra,
  });
}

function fallbackLevelFromFinalization(
  diagnostics: Record<string, number | boolean | string | null>
): "none" | "soft" | "hardSafe" {
  const requestedLength = Number(diagnostics["requestedLength"] ?? 0);
  const finalCount = Number(diagnostics["finalCount"] ?? 0);
  const seriouslyUnderfilled =
    Number.isFinite(requestedLength) &&
    Number.isFinite(finalCount) &&
    requestedLength > 0 &&
    finalCount < recoveryActivationThreshold(requestedLength);
  if (
    seriouslyUnderfilled &&
    (diagnostics["hardSafeFillUsed"] === true || Number(diagnostics["hardSafeFillAdded"] ?? 0) > 0)
  ) {
    return "hardSafe";
  }
  if (
    typeof diagnostics["fallbackMode"] === "string" ||
    typeof diagnostics["recoveryStage"] === "string" ||
    (seriouslyUnderfilled && (diagnostics["artistLimitRelaxed"] === true || diagnostics["albumLimitRelaxed"] === true))
  ) {
    return "soft";
  }
  return "none";
}

function deriveDiagnosticTags(vibe: string): {
  moodTags: string[];
  activityTags: string[];
  eraHints: string[];
  genreHints: string[];
} {
  const lower = vibe.toLowerCase();
  const expandedMoods = Object.entries(EXPANDED_MOOD_TERMS)
    .filter(([, terms]) => termRegex(terms).test(lower))
    .map(([tag]) => tag);
  const expandedActivities = Object.entries(EXPANDED_ACTIVITY_TERMS)
    .filter(([, terms]) => termRegex(terms).test(lower))
    .map(([tag]) => tag);
  const expandedEras = EXPANDED_ERA_TERMS
    .filter((era) => termRegex(era.terms).test(lower))
    .map((era) => era.label);
  const expandedGenres = EXPANDED_GENRE_ALIASES
    .filter((alias) => termRegex(alias.terms).test(lower))
    .map((alias) => alias.family);
  const moodTags = [
    /\b(nostalg|memory|retro|vintage)\b/.test(lower) ? "nostalgic" : null,
    /\b(sunset|warm|golden|cozy|cosy|summer|barbecue|bbq)\b/.test(lower) ? "warm" : null,
    /\b(solitude|alone|reflect|introspect)\b/.test(lower) ? "introspective" : null,
    /\b(sad|melanchol|lonely|blue|rainy|rain)\b/.test(lower) ? "melancholic" : null,
    ...expandedMoods,
  ].filter((tag): tag is string => !!tag)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
  const activityTags = [
    /\b(driv|road|highway|cruise)\b/.test(lower) ? "driving" : null,
    /\b(study|focus|work|coding)\b/.test(lower) ? "focus" : null,
    /\b(party|club|dance|barbecue|bbq|cookout)\b/.test(lower) ? "party" : null,
    /\b(walk|commute)\b/.test(lower) ? "walking" : null,
    ...expandedActivities,
  ].filter((tag): tag is string => !!tag)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
  const eraHints = [
    /\b(60'?s|1960'?s|sixties)\b/.test(lower) ? "60s" : null,
    /\b(70'?s|1970'?s|seventies)\b/.test(lower) ? "70s" : null,
    /\b(80'?s|1980'?s|eighties)\b/.test(lower) ? "80s" : null,
    /\b(90'?s|1990'?s|nineties)\b/.test(lower) ? "90s" : null,
    /\b(00'?s|2000'?s|y2k)\b/.test(lower) ? "00s" : null,
    /\b(2010s|10s)\b/.test(lower) ? "10s" : null,
    /\b(2020s|20s|modern)\b/.test(lower) ? "20s" : null,
    ...expandedEras,
  ].filter((tag): tag is string => !!tag)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
  const genreHints = [
    /\b(country|americana|western|bluegrass)\b/.test(lower) ? "country" : null,
    /\b(folk|acoustic|singer-songwriter)\b/.test(lower) ? "folk" : null,
    /\b(rock|grunge|punk|metal)\b/.test(lower) ? "rock" : null,
    /\b(pop|radio)\b/.test(lower) ? "pop" : null,
    /\b(jazz|blues|soul)\b/.test(lower) ? "jazz" : null,
    /\b(hip.?hop|rap|rnb|r&b)\b/.test(lower) ? "hip_hop" : null,
    /\b(electronic|house|techno|edm)\b/.test(lower) ? "electronic" : null,
    ...expandedGenres,
  ].filter((tag): tag is string => !!tag)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);

  return {
    moodTags: moodTags.length ? moodTags : ["neutral"],
    activityTags: activityTags.length ? activityTags : ["listening"],
    eraHints: eraHints.length ? eraHints : ["any"],
    genreHints: genreHints.length ? genreHints : ["unknown"],
  };
}

function topGenreHints(userGenreProfile: { vector: object; dominant: readonly string[] }): string[] {
  const fromDominant = userGenreProfile.dominant.filter((genre) => genre && genre !== "unknown").slice(0, 3);
  if (fromDominant.length > 0) return fromDominant;
  return Object.entries(userGenreProfile.vector as Record<string, number | undefined>)
    .filter(([genre, weight]) => genre !== "unknown" && (weight ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 3)
    .map(([genre]) => genre);
}

function recentEraHints(
  playlists: Array<{ vibe: string; createdAt?: Date | string | null }>
): string[] {
  const counts = new Map<string, number>();
  for (const playlist of playlists) {
    const { eraHints } = deriveDiagnosticTags(playlist.vibe);
    for (const era of eraHints) {
      if (era === "any") continue;
      counts.set(era, (counts.get(era) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([era]) => era);
}

function canonicalCrossGenreHints(vibe: string): string[] {
  const lower = vibe.toLowerCase();
  const hints = new Set<string>();
  if (/\b(dirt.?road|country|cowboy|western|americana)\b/.test(lower)) {
    ["country", "acoustic", "folk", "warm"].forEach((hint) => hints.add(hint));
  }
  if (/\b(techno|trance|90'?s|rave|warehouse)\b/.test(lower)) {
    ["electronic", "trance", "early EDM", "high BPM"].forEach((hint) => hints.add(hint));
  }
  if (/\b(chill|study|lo.?fi|ambient|focus)\b/.test(lower)) {
    ["ambient", "lo-fi", "soft electronic", "focus"].forEach((hint) => hints.add(hint));
  }
  if (/\b(gym|hype|workout|pump|beast.?mode)\b/.test(lower)) {
    ["high BPM", "trap", "rock", "EDM"].forEach((hint) => hints.add(hint));
  }
  return [...hints];
}

function buildQualitySignalContext(opts: {
  vibe: string;
  emotionProfile: EmotionProfile;
  userGenreProfile: { vector: object; dominant: readonly string[] };
  recentPlaylists: Array<{ vibe: string; createdAt?: Date | string | null }>;
}): QualitySignalContext {
  const derived = deriveDiagnosticTags(opts.vibe);
  const genreHints = topGenreHints(opts.userGenreProfile);
  const eraHints = recentEraHints(opts.recentPlaylists);
  const canonicalHints = canonicalCrossGenreHints(opts.vibe);
  const primary = opts.vibe.trim() || [
    ...canonicalHints,
    ...genreHints,
    opts.emotionProfile.energy >= 0.65 ? "energetic" : "balanced",
  ].filter(Boolean).join(" ");

  return {
    primary,
    moodTags: derived.moodTags.length ? derived.moodTags : ["neutral"],
    activityTags: derived.activityTags.length ? derived.activityTags : ["listening"],
    eraHints: derived.eraHints[0] !== "any" ? derived.eraHints : (eraHints.length ? eraHints : ["any"]),
    genreHints: derived.genreHints[0] !== "unknown" ? derived.genreHints : (genreHints.length ? genreHints : ["unknown"]),
    canonicalHints,
  };
}

function normalizeVibeForPipeline(vibe: string, signals: QualitySignalContext): string {
  if (vibe.trim()) return vibe;
  const parts = [
    signals.primary,
    `mood:${signals.moodTags.join(",")}`,
    `activity:${signals.activityTags.join(",")}`,
    `era:${signals.eraHints.join(",")}`,
    `genre:${signals.genreHints.join(",")}`,
    signals.canonicalHints.length ? `adjacent:${signals.canonicalHints.join(",")}` : null,
  ].filter((part): part is string => !!part && part.trim().length > 0);
  return [...new Set(parts)].join(" ");
}

function extractGenreTerms(text: string): { roots: string[]; terms: string[] } {
  const lower = text.toLowerCase();
  const roots = new Set<string>();
  const terms = new Set<string>();
  for (const alias of GENRE_ALIASES) {
    for (const term of alias.terms) {
      const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
      if (pattern.test(lower)) {
        roots.add(alias.family);
        terms.add(term);
      }
    }
  }
  return { roots: [...roots], terms: [...terms] };
}

function extractEraRange(vibe: string): { start: number | null; end: number | null; terms: string[] } {
  const lower = vibe.toLowerCase();
  const terms: string[] = [];
  const decadeMatch = lower.match(/\b(60'?s|70'?s|80'?s|90'?s|00'?s|10'?s|20'?s|1960'?s|1970'?s|1980'?s|1990'?s|2000'?s|2010'?s|2020'?s)\b/);
  if (decadeMatch?.[1]) {
    const term = decadeMatch[1].replace("'", "");
    terms.push(term);
    const start = fullDecadeStart(term);
    return { start, end: start + 9, terms };
  }

  const rangeMatch = lower.match(/\b(19\d{2}|20\d{2})\s*(?:-|to|through|until)\s*(19\d{2}|20\d{2})\b/);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    terms.push(`${start}-${end}`);
    return { start: Math.min(start, end), end: Math.max(start, end), terms };
  }

  const yearMatch = lower.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch?.[1]) {
    const year = Number(yearMatch[1]);
    terms.push(String(year));
    return { start: year, end: year, terms };
  }

  return { start: null, end: null, terms };
}

function fullDecadeStart(term: string): number {
  const normalized = term.toLowerCase().replace("'", "");
  if (/^(1960|1970|1980|1990|2000|2010|2020)s$/.test(normalized)) {
    return Number(normalized.slice(0, 4));
  }
  if (normalized === "00s") return 2000;
  if (normalized === "10s") return 2010;
  if (normalized === "20s") return 2020;
  return Number(`19${normalized.slice(0, 2)}`);
}

function isAmericanaBridgePrompt(lower: string): boolean {
  return /\b(?:americana|americarna|americanna|americanana|alt[-\s]?country|roots\s+country|country\s+folk|folk\s+country|country\s+rock)\b/i.test(lower);
}

function extractConstraintLayer(vibe: string, signals: QualitySignalContext): ConstraintLayer {
  const lower = vibe.toLowerCase();
  const strictTerms = [
    /\bonly\b/.test(lower) ? "only" : null,
    /\bstrict(?:ly)?\b/.test(lower) ? "strict" : null,
    /\bpure\b/.test(lower) ? "pure" : null,
    /\bexclusively\b/.test(lower) ? "exclusively" : null,
  ].filter((term): term is string => !!term);
  const excludedText = lower.match(/\b(?:no|without|exclude|excluding|not)\s+([a-z0-9&\-\s]{2,24})/g) ?? [];
  const excludedGenreHits = extractGenreTerms(excludedText.join(" "));
  const genreHits = extractGenreTerms(vibe);
  const era = extractEraRange(vibe);
  const americanaBridgePrompt = isAmericanaBridgePrompt(lower);
  const multiGenreTerms = [
    /\bmulti.?genre\b/.test(lower) ? "multi-genre" : null,
    /\bgenre.?blend\b/.test(lower) ? "genre blend" : null,
    /\beclectic\b/.test(lower) ? "eclectic" : null,
    /\bcrossover\b/.test(lower) ? "crossover" : null,
    /\bfusion\b/.test(lower) ? "fusion" : null,
    /\bbridge\b/.test(lower) ? "bridge" : null,
    genreHits.roots.length > 1 && /\b(and|with|\+|mix|blend)\b/.test(lower) ? "explicit multi-family" : null,
  ].filter((term): term is string => !!term);

  return {
    hard: {
      genres: genreHits.roots,
      excludedGenres: excludedGenreHits.roots,
      eraStart: era.start,
      eraEnd: era.end,
      strictLock: strictTerms.length > 0,
      allowMultiGenre: multiGenreTerms.length > 0,
      allowBridge: americanaBridgePrompt || multiGenreTerms.some((term) => /bridge|blend|crossover|fusion|multi/i.test(term)),
    },
    soft: {
      moodTags: signals.moodTags,
      activityTags: signals.activityTags,
      energyTags: signals.canonicalHints.filter((hint) => /\b(bpm|hype|energy|edm|rock)\b/i.test(hint)),
      atmosphereTags: signals.canonicalHints.filter((hint) => /\b(ambient|lo-fi|soft|warm|acoustic)\b/i.test(hint)),
    },
    raw: {
      explicitGenreTerms: genreHits.terms,
      explicitEraTerms: era.terms,
      strictTerms,
      excludedTerms: excludedText,
      multiGenreTerms,
      americanaBridgePrompt,
    },
  };
}

function eraBucketRange(bucket: string | null | undefined): { start: number; end: number } | null {
  if (!bucket || bucket === "any") return null;
  const map: Record<string, { start: number; end: number }> = {
    "60s": { start: 1960, end: 1969 },
    "70s": { start: 1970, end: 1979 },
    "80s": { start: 1980, end: 1989 },
    "90s": { start: 1990, end: 1999 },
    "00s": { start: 2000, end: 2009 },
    "10s": { start: 2010, end: 2019 },
    "20s": { start: 2020, end: 2029 },
  };
  return map[bucket] ?? null;
}

function trackYearEstimate(track: ConstraintTrack): number | null {
  if (track.releaseYear) return track.releaseYear;
  const laneEra = eraBucketRange(track.laneEra);
  if (!laneEra) return null;
  return Math.round((laneEra.start + laneEra.end) / 2);
}

function trackEraMatches(track: ConstraintTrack, constraints: ConstraintLayer): boolean {
  if (constraints.hard.eraStart === null || constraints.hard.eraEnd === null) return true;
  if (track.releaseYear) {
    return track.releaseYear >= constraints.hard.eraStart && track.releaseYear <= constraints.hard.eraEnd;
  }
  const laneEra = eraBucketRange(track.laneEra);
  if (!laneEra) return !constraints.hard.strictLock;
  return laneEra.end >= constraints.hard.eraStart && laneEra.start <= constraints.hard.eraEnd;
}

function trackGenreTerms(track: ConstraintTrack, classMap: Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>): string[] {
  const classification = classMap.get(track.trackId);
  return [
    track.genrePrimary,
    classification?.genrePrimary,
    classification?.genreFamily,
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
    ...(track.clusterIds ?? []),
  ]
    .filter((term): term is string => !!term)
    .map((term) => term.toLowerCase().replace(/^genre:/, ""));
}

function trackGenreFamily(track: ConstraintTrack, classMap: Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>): string {
  const classification = classMap.get(track.trackId);
  return (
    classification?.genreFamily ??
    classification?.genrePrimary ??
    track.genrePrimary ??
    "unknown"
  ).toLowerCase();
}

function trackIsChristmasTrack(track: ConstraintTrack, classMap: Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>): boolean {
  if (trackGenreFamily(track, classMap) === "christmas") return true;
  const genreTerms = trackGenreTerms(track, classMap).join(" ");
  if (/\b(?:christmas|xmas|holiday|carol|festive|noel|santa|jingle\s+bells|winter\s+wonderland)\b/i.test(genreTerms)) return true;
  const text = `${track.trackName ?? ""} ${track.albumName ?? ""}`.toLowerCase();
  return /\b(?:christmas|xmas|holiday|festive|noel|santa|jingle\s+bells|winter\s+wonderland|mistletoe|snowman|sleigh|merry\s+christmas|christmastime|rudolph|frosty|feliz\s+navidad|baby\s+it'?s\s+cold\s+outside)\b/i.test(text);
}

function hasExplicitHolidayIntent(vibe: string): boolean {
  return /\b(?:christmas|xmas|holiday|festive)\b/i.test(vibe);
}

function dominantGenreFamily(
  tracks: ConstraintTrack[],
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): string | null {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const family = trackGenreFamily(track, classMap);
    if (family === "unknown") continue;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const ERA_COMPATIBLE_FAMILIES: Array<{
  start: number;
  end: number;
  families: string[];
}> = [
  { start: 1970, end: 1979, families: ["rock", "soul", "pop", "blues", "folk", "jazz", "country", "rnb"] },
  { start: 1980, end: 1989, families: ["pop", "electronic", "rock", "soul", "rnb", "hip_hop", "country", "folk", "jazz", "blues"] },
  { start: 1990, end: 1999, families: ["rock", "hip_hop", "electronic", "rnb", "pop", "indie", "country", "folk", "jazz", "blues", "soul"] },
  { start: 2000, end: 2009, families: ["rock", "pop", "rnb", "hip_hop", "electronic", "indie", "country", "folk", "jazz", "blues", "soul", "latin"] },
  { start: 2010, end: 2029, families: ["pop", "hip_hop", "electronic", "rnb", "indie", "rock", "country", "latin", "world"] },
];

function eraGenreCompatible(family: string, intent: LockedIntent): boolean {
  if (intent.eraStart === null || intent.eraEnd === null || family === "unknown") return true;
  const compatible = ERA_COMPATIBLE_FAMILIES.find((era) =>
    intent.eraStart! <= era.end && intent.eraEnd! >= era.start
  );
  return !compatible || compatible.families.includes(family);
}

function bridgeFamiliesForTrack(track: ConstraintTrack, classMap: Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>): string[] {
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (/\b(chillwave|synthwave|indie_pop|indie pop|electropop|synth_pop|synth pop)\b/.test(terms)) {
    return ["indie", "electronic", "pop"];
  }
  if (/\b(house|techno|trance|edm|rave)\b/.test(terms)) {
    return ["electronic"];
  }
  if (/\b(alt_country|americana|folk_country|folk country|country folk)\b/.test(terms)) {
    return ["country", "folk", "rock"];
  }
  if (/\b(soul jazz|neo_soul|neo soul|funk)\b/.test(terms)) {
    return ["jazz", "soul", "rnb"];
  }
  return [];
}

function isAmericanaCompatibleTrack(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (family === "country" || family === "folk" || family === "blues") return true;
  const bridgeFamilies = bridgeFamiliesForTrack(track, classMap);
  return family === "rock" && bridgeFamilies.includes("country");
}

function passesGenreGraphBoundary(
  track: ConstraintTrack,
  opts: {
    lockedFamily: string | null;
    constraints: ConstraintLayer;
    lockedIntent: LockedIntent;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
    bridgeUsed: boolean;
  }
): { pass: boolean; bridge: boolean } {
  const family = trackGenreFamily(track, opts.classMap);
  if (!eraGenreCompatible(family, opts.lockedIntent)) return { pass: false, bridge: false };
  if (!opts.lockedFamily || opts.constraints.hard.allowMultiGenre) return { pass: true, bridge: false };
  if (family === opts.lockedFamily || family === "unknown") return { pass: true, bridge: false };
  if (
    opts.constraints.raw.americanaBridgePrompt &&
    opts.lockedFamily === "country" &&
    isAmericanaCompatibleTrack(track, opts.classMap)
  ) {
    return { pass: true, bridge: true };
  }
  const bridgeFamilies = bridgeFamiliesForTrack(track, opts.classMap);
  const bridge = opts.constraints.hard.allowBridge &&
    bridgeFamilies.includes(opts.lockedFamily) &&
    bridgeFamilies.includes(family);
  return { pass: bridge, bridge };
}

function trackMatchesHardConstraints(
  track: ConstraintTrack,
  constraints: ConstraintLayer,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const terms = trackGenreTerms(track, classMap);
  const family = trackGenreFamily(track, classMap);
  if (constraints.hard.excludedGenres.some((genre) => terms.includes(genre))) return false;
  const bridgeFamilies = constraints.hard.allowBridge ? bridgeFamiliesForTrack(track, classMap) : [];
  if (
    constraints.hard.genres.length > 0 &&
    !constraints.hard.genres.some((genre) =>
      terms.includes(genre) ||
      bridgeFamilies.includes(genre) ||
      (constraints.raw.americanaBridgePrompt && genre === "country" && isAmericanaCompatibleTrack(track, classMap))
    )
  ) {
    if (family === "unknown") return trackEraMatches(track, constraints);
    return false;
  }
  if (constraints.hard.strictLock && constraints.raw.explicitGenreTerms.length > 0) {
    const explicitMatch = constraints.raw.explicitGenreTerms.some((term) =>
      terms.some((candidate) => candidate.includes(term.replace(/\s+/g, "_")) || candidate.includes(term))
    );
    if (!explicitMatch && constraints.hard.genres.length > 0 && family !== "unknown") return false;
  }
  return trackEraMatches(track, constraints);
}

function genreEvidence(
  track: ConstraintTrack,
  intent: LockedIntent,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean | null {
  if (intent.primaryGenres.length === 0) return null;
  const terms = trackGenreTerms(track, classMap);
  const bridgeFamilies = bridgeFamiliesForTrack(track, classMap);
  return intent.primaryGenres.some((genre) => terms.includes(genre) || bridgeFamilies.includes(genre));
}

function eraEvidence(track: ConstraintTrack, intent: LockedIntent): boolean | null {
  if (intent.eraStart === null || intent.eraEnd === null) return null;
  const year = trackYearEstimate(track);
  if (!year) return null;
  return year >= intent.eraStart && year <= intent.eraEnd;
}

function eraHardMismatch(track: ConstraintTrack, intent: LockedIntent): boolean {
  if (intent.eraStart === null || intent.eraEnd === null) return false;
  const year = trackYearEstimate(track);
  if (!year) return false;
  return year < intent.eraStart - 15 || year > intent.eraEnd + 15;
}

function moodEvidence(track: ConstraintTrack, intent: LockedIntent): boolean | null {
  if (intent.mood.length === 0) return null;
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  return intent.mood.some((mood) => {
    if (mood === "melancholic") return valence <= 0.45;
    if (mood === "warm") return valence >= 0.55 && acousticness >= 0.35;
    if (mood === "introspective") return energy <= 0.6 && acousticness >= 0.35;
    if (mood === "nostalgic") return track.laneEra !== "20s" || (track.sourceLane ?? "").includes("nostalgia");
    if (mood === "energised") return energy >= 0.65 || danceability >= 0.65;
    if (mood === "calm") return energy <= 0.45;
    if (mood === "dark") return valence <= 0.50 || energy <= 0.48;
    if (mood === "euphoric") return valence >= 0.58 && energy >= 0.48;
    if (mood === "angry") return energy >= 0.58 && valence <= 0.62;
    return false;
  });
}

function activityEvidence(track: ConstraintTrack, intent: LockedIntent): boolean | null {
  if (!intent.activity && !intent.energyLevel) return null;
  const activity = intent.activity;
  const energy = track.energy ?? 0.5;
  const tempo = track.tempo ?? 110;
  const danceability = track.danceability ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  const gentleWalk = activity === "walking" && (intent.mood.includes("melancholic") || intent.mood.includes("calm"));
  const activityMatch =
    activity === "driving" ? energy >= 0.45 && tempo >= 85 :
    activity === "focus" ? energy <= 0.6 && acousticness >= 0.25 :
    activity === "party" ? energy >= 0.6 && danceability >= 0.55 :
    activity === "walking" ? energy >= (gentleWalk ? 0.20 : 0.35) && energy <= (gentleWalk ? 0.68 : 0.75) :
    activity === "cleaning" ? energy >= 0.35 && energy <= 0.78 :
    activity === "sleep" ? energy <= 0.42 || acousticness >= 0.45 :
    activity === "travel" ? energy >= 0.30 && tempo >= 70 :
    activity === "relaxing" ? energy <= 0.45 :
    null;
  const energyMatch =
    intent.energyLevel === "high" ? energy >= 0.62 || tempo >= 125 :
    intent.energyLevel === "medium" ? energy >= 0.38 && energy <= 0.75 :
    intent.energyLevel === "low" ? energy <= 0.5 :
    null;
  if (activityMatch === null) return energyMatch;
  if (energyMatch === null) return activityMatch;
  return activityMatch && energyMatch;
}

function isSleepSafetyPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  if (/\b(?:drive|driving|gym|workout|party|club|dancefloor|rave)\b/.test(lower)) return false;
  return intent.activity === "relaxing" ||
    intent.energyLevel === "low" ||
    intent.mood.includes("calm") ||
    /\b(?:sleep|bedtime|bed\s*time|night|slow|easy|relax|relaxing|chill|chilled|soft)\b/.test(lower);
}

function trackIsSleepSafe(track: ConstraintTrack): boolean {
  if (typeof track.energy === "number" && track.energy > 0.56) return false;
  if (typeof track.tempo === "number" && track.tempo > 118) return false;
  if (typeof track.danceability === "number" && track.danceability > 0.68) return false;
  if (typeof track.loudness === "number" && track.loudness > -5.5) return false;
  if (typeof track.speechiness === "number" && track.speechiness > 0.38) return false;
  return true;
}

function isUkGaragePrompt(vibe: string): boolean {
  return /\b(?:uk\s+garage|ukg|2-step|two\s+step\s+garage|speed\s+garage|garage\s+music)\b/i.test(vibe);
}

function isKnownNonUkGarageTrack(track: ConstraintTrack): boolean {
  return /\b(?:guns\s+n['’]?\s+roses|guns\s+n\s+roses|the\s+jungle\s+giants|jungle\s+giants)\b/i.test(track.artistName ?? "");
}

const TECHNO_IDENTITY_PROMPT_RE = /\b(?:hard\s+techno|hardgroove|hard\s+groove|schranz|tekk|tekno|industrial\s+techno|warehouse\s+techno|rave\s+techno|hard\s+trance|techno|rave)\b/i;
const TECHNO_IDENTITY_EVIDENCE_RE = /\b(?:hard\s+techno|hardgroove|hard\s+groove|schranz|tekk|tekno|industrial\s+techno|warehouse\s+techno|rave\s+techno|hard\s+trance|techno|trance|rave|gabber|hardstyle|hardcore\s+techno|berghain)\b/i;
const TECHNO_COMPATIBLE_SUBGENRES = new Set(["techno", "hard_techno", "rave", "trance"]);

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isTechnoIdentityPrompt(vibe: string): boolean {
  return TECHNO_IDENTITY_PROMPT_RE.test(vibe);
}

function trackMatchesTechnoIdentity(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (family !== "electronic") return false;

  const classification = classMap.get(track.trackId);
  if (
    classification &&
    (
      TECHNO_COMPATIBLE_SUBGENRES.has(classification.primarySubgenre) ||
      (classification.secondarySubgenre ? TECHNO_COMPATIBLE_SUBGENRES.has(classification.secondarySubgenre) : false) ||
      classification.subGenres.some((subgenre) => TECHNO_COMPATIBLE_SUBGENRES.has(subgenre))
    )
  ) {
    return true;
  }

  const evidenceText = [
    ...trackGenreTerms(track, classMap),
    ...stringValues(track.spotifyArtistGenres),
    ...stringValues(track.albumGenres),
    track.trackName,
    track.albumName,
  ].filter((value): value is string => typeof value === "string").join(" ");
  if (TECHNO_IDENTITY_EVIDENCE_RE.test(evidenceText)) return true;

  const energy = track.energy ?? 0.5;
  const danceability = track.danceability ?? 0.5;
  const tempo = track.tempo ?? 110;
  const acousticness = track.acousticness ?? 0.5;
  return energy >= 0.58 && danceability >= 0.52 && tempo >= 118 && acousticness <= 0.55;
}

function isBreakupRainDrivePrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  const breakupRain = hasSadDriveQualifier(vibe);
  const drive = intent.activity === "driving" || /\b(?:drive|driving|road|home)\b/.test(lower);
  return breakupRain && drive;
}

function hasSadDriveQualifier(vibe: string): boolean {
  return /\b(?:sad|breakup|break\s+up|heartbreak|heartbroken|night|rain|rainy|lonely)\b/i.test(vibe);
}

function isChillCalmPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  if (isGymWorkoutPrompt(vibe, intent) || isUpbeatSocialPrompt(vibe, intent)) return false;
  if (/\b(?:rave|warehouse|industrial|hard\s+techno|hardgroove|tekk|breakcore|workout|gym|party|club)\b/.test(lower)) {
    return false;
  }
  return intent.energyLevel === "low" ||
    intent.energy === "low" ||
    intent.mood.includes("calm") ||
    intent.activity === "relaxing" ||
    /\b(?:chill|chilled|calm|soft|relax(?:ed|ing)?|rainy\s+night|rainy\s+walk|night\s+walk|sad\s+walk)\b/.test(lower);
}

function trackIsChillCalmSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "metal" || family === "punk")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (/\b(?:hardcore|metalcore|deathcore|thrash|gabber|hardstyle|industrial)\b/.test(terms)) return false;
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const loudness = typeof track.loudness === "number" ? track.loudness : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  if (energy !== null && energy > 0.62) return false;
  if (tempo !== null && tempo > 132 && (energy ?? 0.5) > 0.48) return false;
  if (danceability !== null && danceability > 0.78 && (energy ?? 0.5) > 0.50) return false;
  if (loudness !== null && loudness > -4.8 && (energy ?? 0.5) > 0.50) return false;
  if (speechiness !== null && speechiness > 0.30) return false;
  if (valence !== null && valence < 0.24 && (energy ?? 0.5) > 0.42) return false;
  return true;
}

function isRainyNightWalkPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  const rainy = /\b(?:rainy|rain|drizzle|wet\s+streets?|storm|overcast)\b/.test(lower) || intent.mood.includes("melancholic");
  const night = /\b(?:night|late\s+night|midnight|2am|3am|evening|after\s+dark)\b/.test(lower);
  const walk = intent.activity === "walking" || /\b(?:walk|walking|wander|wandering|stroll)\b/.test(lower);
  return rainy && night && walk;
}

function trackIsRainyNightWalkSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "metal" || family === "punk")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (!explicitGenreLocked && /\b(?:hardcore|metalcore|deathcore|thrash|gabber|hardstyle|drill|grime|trap\s+metal|industrial)\b/.test(terms)) return false;
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  const loudness = typeof track.loudness === "number" ? track.loudness : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  if (energy !== null && (energy < 0.18 || energy > 0.56)) return false;
  if (tempo !== null && (tempo < 58 || tempo > 122)) return false;
  if (danceability !== null && danceability > 0.70 && (energy ?? 0.5) > 0.42) return false;
  if (loudness !== null && loudness > -5.4 && (energy ?? 0.5) > 0.42) return false;
  if (speechiness !== null && speechiness > 0.26) return false;
  if (valence !== null && valence > 0.66) return false;
  if (valence !== null && valence < 0.18 && (energy ?? 0.5) > 0.34) return false;
  if (acousticness !== null && acousticness < 0.08 && (energy ?? 0.5) > 0.46) return false;
  return true;
}

function isNeutralDrivingPrompt(vibe: string, intent: Pick<LockedIntent, "activity">): boolean {
  return (intent.activity === "driving" || /\b(?:music\s+for\s+driving|driving|drive|road|highway|cruise)\b/i.test(vibe)) &&
    !hasSadDriveQualifier(vibe);
}

function hasExplicitGenreIntent(intent: LockedIntent, constraints: ConstraintLayer): boolean {
  return intent.primaryGenres.length > 0 ||
    intent.genreFamilies.length > 0 ||
    constraints.hard.genres.length > 0 ||
    constraints.raw.explicitGenreTerms.length > 0;
}

function trackIsBreakupRainDriveSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "hip_hop" || family === "metal" || family === "soundtrack" || family === "classical")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (!explicitGenreLocked && /\b(?:punk|thrash|metalcore|deathcore|hardcore)\b/.test(terms)) return false;
  if (/\b(?:physical)\b/i.test(track.trackName ?? "") && /\bolivia\s+newton-?john\b/i.test(track.artistName ?? "")) return false;
  if (/\b(?:mobb\s+deep|big\s+l|gza|rza|ghostface|wu-?tang|kendrick\s+lamar|black\s+sabbath|destructo\s+disk|stephen\s+schwartz)\b/i.test(track.artistName ?? "")) {
    return false;
  }
  if (typeof track.energy === "number" && track.energy > 0.74) return false;
  if (typeof track.valence === "number" && track.valence > 0.62) return false;
  if (typeof track.tempo === "number" && track.tempo > 138) return false;
  if (typeof track.loudness === "number" && track.loudness > -4.5) return false;
  if (typeof track.speechiness === "number" && track.speechiness > 0.34) return false;
  return true;
}

function isLateNightDrivingPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  const drive = intent.activity === "driving" || /\b(?:drive|driving|road|highway|cruise)\b/.test(lower);
  if (!drive) return false;
  return /\b(?:late\s+night|night\s+drive|night\s+driving|midnight|2am|3am|rainy\s+drive|rain\s+drive)\b/.test(lower);
}

function trackIsLateNightDrivingSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "metal" || family === "classical" || family === "soundtrack")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (!explicitGenreLocked && /\b(?:punk|hardcore|thrash|metalcore|deathcore|show\s+tunes?|musical)\b/.test(terms)) return false;
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  const loudness = typeof track.loudness === "number" ? track.loudness : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  if (energy !== null && (energy < 0.30 || energy > 0.76)) return false;
  if (tempo !== null && (tempo < 74 || tempo > 142)) return false;
  if (valence !== null && valence > 0.78 && (energy ?? 0.5) > 0.55) return false;
  if (valence !== null && valence < 0.22 && (energy ?? 0.5) > 0.52) return false;
  if (danceability !== null && danceability < 0.30 && (energy ?? 0.5) < 0.45) return false;
  if (acousticness !== null && acousticness > 0.88 && (energy ?? 0.5) < 0.46) return false;
  if (loudness !== null && loudness > -4.2 && (energy ?? 0.5) > 0.58) return false;
  if (speechiness !== null && speechiness > 0.36) return false;
  return true;
}

function isEuphoricSummerPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  return intent.mood.includes("euphoric") &&
    /\b(?:summer|beach|sunset|sunny|sunshine|coast|seaside|poolside)\b/.test(lower);
}

function isBroadDrivingPrompt(vibe: string, intent: LockedIntent): boolean {
  if (intent.genreFamilies.length > 0 || intent.primaryGenres.length > 0 || intent.mood.includes("melancholic")) return false;
  return isNeutralDrivingPrompt(vibe, intent);
}

function trackIsBroadDrivingSafe(track: ConstraintTrack): boolean {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const tempo = track.tempo ?? 110;
  const acousticness = track.acousticness ?? 0.5;
  if (energy < 0.30) return false;
  if (tempo < 72) return false;
  if (valence < 0.34 && energy < 0.58) return false;
  if (valence < 0.28) return false;
  if (acousticness > 0.86 && energy < 0.45) return false;
  return true;
}

function isGarageHangoutPrompt(vibe: string): boolean {
  return /\bgarage\b/i.test(vibe) &&
    /\b(?:friends?|mates?|saturday|night|cars?|working|workshop|tools?|fixing|hang(?:ing)?\s*out)\b/i.test(vibe) &&
    !isUkGaragePrompt(vibe);
}

function isUpbeatSocialPrompt(vibe: string, intent: LockedIntent): boolean {
  const lower = vibe.toLowerCase();
  if (isGarageHangoutPrompt(vibe)) return true;
  if (intent.activity === "party" || intent.activity === "gym") return true;
  if (/\b(?:party|all\s+night|chaos|workout|gym|friends?|mates?|saturday\s+night)\b/.test(lower)) return true;
  if (intent.mood.includes("melancholic")) return false;
  if (intent.mood.includes("energised") || intent.energy === "high" || intent.energyLevel === "high") return true;
  return /\b(?:hype|high\s+energy|energ(?:y|ised|ized))\b/.test(lower);
}

function isGymWorkoutPrompt(vibe: string, intent: LockedIntent): boolean {
  return intent.activity === "gym" ||
    /\b(?:gym|workout|training|pump|cardio|run|running|lifting|weights)\b/i.test(vibe);
}

function trackIsGymWorkoutSafe(track: ConstraintTrack): boolean {
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  const loudness = typeof track.loudness === "number" ? track.loudness : null;
  if (energy !== null && energy < 0.55) return false;
  if (tempo !== null && tempo < 100 && (danceability ?? 0.5) < 0.60) return false;
  if (valence !== null && valence < 0.28) return false;
  if (acousticness !== null && acousticness > 0.66 && (energy ?? 0.6) < 0.72) return false;
  if (loudness !== null && loudness < -13 && (energy ?? 0.6) < 0.70) return false;
  return true;
}

function isFocusStudyPrompt(vibe: string, intent: LockedIntent): boolean {
  return intent.activity === "focus" ||
    /\b(?:focus|study|studying|deep\s+work|homework|work\s+from\s+home|coding|no\s+distractions?)\b/i.test(vibe);
}

function trackIsFocusStudySafe(track: ConstraintTrack): boolean {
  const energy = typeof track.energy === "number" ? track.energy : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const speechiness = typeof track.speechiness === "number" ? track.speechiness : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  if (energy !== null && energy > 0.52) return false;
  if (tempo !== null && (tempo > 130 || tempo < 58)) return false;
  if (danceability !== null && danceability > 0.68 && (energy ?? 0.5) > 0.44) return false;
  if (speechiness !== null && speechiness > 0.24) return false;
  if (valence !== null && valence < 0.18 && (energy ?? 0.5) < 0.42) return false;
  return true;
}

function trackIsUpbeatSocialSafe(track: ConstraintTrack): boolean {
  const energy = typeof track.energy === "number" ? track.energy : null;
  const valence = typeof track.valence === "number" ? track.valence : null;
  const tempo = typeof track.tempo === "number" ? track.tempo : null;
  const danceability = typeof track.danceability === "number" ? track.danceability : null;
  const acousticness = typeof track.acousticness === "number" ? track.acousticness : null;
  if (energy !== null && energy < 0.48) return false;
  if (tempo !== null && tempo < 86 && (danceability ?? 0.5) < 0.56) return false;
  if (danceability !== null && danceability < 0.44 && (energy ?? 0.5) < 0.62) return false;
  if (valence !== null && valence < 0.36) return false;
  if (valence !== null && valence < 0.44 && (energy ?? 0.5) < 0.62) return false;
  if (acousticness !== null && acousticness > 0.74 && (energy ?? 0.5) < 0.62) return false;
  return true;
}

function trackIsEuphoricSummerSafe(
  track: ConstraintTrack,
  explicitGenreLocked: boolean,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const family = trackGenreFamily(track, classMap);
  if (!explicitGenreLocked && (family === "hip_hop" || family === "metal" || family === "classical" || family === "soundtrack")) return false;
  const terms = trackGenreTerms(track, classMap).join(" ");
  if (!explicitGenreLocked && /\b(?:punk|hardcore|dark|doom|sad|melanchol|slowcore)\b/.test(terms)) return false;
  if (/\b(?:gza|rza|ghostface|wu-?tang|bon\s+iver|destructo\s+disk)\b/i.test(track.artistName ?? "")) return false;
  if (typeof track.valence === "number" && track.valence < 0.52) return false;
  if (typeof track.energy === "number" && track.energy < 0.34) return false;
  if (typeof track.acousticness === "number" && track.acousticness > 0.86 && (track.energy ?? 0.5) < 0.48) return false;
  if (typeof track.speechiness === "number" && track.speechiness > 0.32) return false;
  return true;
}

function isBroadMoodPlacePrompt(vibe: string, intent: LockedIntent, constraints: ConstraintLayer): boolean {
  if (constraints.hard.genres.length > 0 || constraints.hard.eraStart !== null || constraints.hard.excludedGenres.length > 0) {
    return false;
  }
  const lower = vibe.toLowerCase();
  return intent.mood.includes("euphoric") ||
    /\b(?:summer|beach|sunset|sunny|sunshine|barbecue|bbq|euphoric|uplifting)\b/.test(lower);
}

function lockedIntentMatchCount(
  track: ConstraintTrack,
  intent: LockedIntent,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): { count: number; explicitFields: number; genreMatch: boolean | null; eraMatch: boolean | null; moodMatch: boolean | null; activityMatch: boolean | null } {
  const genreMatch = genreEvidence(track, intent, classMap);
  const eraMatch = eraEvidence(track, intent);
  const moodMatch = moodEvidence(track, intent);
  const activityMatch = activityEvidence(track, intent);
  const evidence = [genreMatch, eraMatch, moodMatch, activityMatch];
  return {
    count: evidence.filter((value) => value === true).length,
    explicitFields: evidence.filter((value) => value !== null).length,
    genreMatch,
    eraMatch,
    moodMatch,
    activityMatch,
  };
}

function trackPassesLockedIntent(
  track: ConstraintTrack,
  intent: LockedIntent,
  constraints: ConstraintLayer,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const match = lockedIntentMatchCount(track, intent, classMap);
  if (constraints.hard.genres.length > 0 && match.genreMatch === false) return false;
  if (eraHardMismatch(track, intent)) return false;
  const hasMoodOrActivityIntent = intent.mood.length > 0 || !!intent.activity || !!intent.energyLevel;
  const moodOrActivityMatch =
    !hasMoodOrActivityIntent ||
    match.moodMatch === true ||
    match.activityMatch === true;
  return moodOrActivityMatch;
}

function hasHardConstraints(constraints: ConstraintLayer): boolean {
  return constraints.hard.genres.length > 0 ||
    constraints.hard.excludedGenres.length > 0 ||
    constraints.hard.eraStart !== null ||
    constraints.hard.strictLock;
}

function validateLockedIntentOutput(
  tracks: ConstraintTrack[],
  intent: LockedIntent,
  constraints: ConstraintLayer,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): {
  genreConsistency: "PASS" | "FAIL";
  eraAlignment: "PASS" | "FAIL";
  moodAlignment: "PASS" | "FAIL";
  activityRelevance: "PASS" | "FAIL";
} {
  const requiresGenre = intent.primaryGenres.length > 0 || constraints.hard.genres.length > 0;
  const requiresEra = intent.eraStart !== null && intent.eraEnd !== null;
  const requiresMood = intent.mood.length > 0;
  const requiresActivity = !!intent.activity || !!intent.energyLevel;
  const families = new Set(tracks
    .map((track) => trackGenreFamily(track, classMap))
    .filter((family) => family !== "unknown"));
  const lockedFamily = intent.primaryGenres[0] ?? dominantGenreFamily(tracks, classMap);
  const offFamilyTracks = lockedFamily
    ? tracks.filter((track) => {
        const family = trackGenreFamily(track, classMap);
        return family !== "unknown" && family !== lockedFamily;
      })
    : [];
  const familyStable = constraints.hard.allowMultiGenre ||
    families.size <= 1 ||
    (constraints.hard.allowBridge &&
      offFamilyTracks.every((track) => {
        if (
          constraints.raw.americanaBridgePrompt &&
          lockedFamily === "country" &&
          isAmericanaCompatibleTrack(track, classMap)
        ) {
          return true;
        }
        const bridgeFamilies = bridgeFamiliesForTrack(track, classMap);
        return !!lockedFamily && bridgeFamilies.includes(lockedFamily);
      }));

  const genreConsistency = familyStable && (!requiresGenre || tracks.every((track) =>
    genreEvidence(track, intent, classMap) !== false ||
    (constraints.raw.americanaBridgePrompt && lockedFamily === "country" && isAmericanaCompatibleTrack(track, classMap))
  )) ? "PASS" : "FAIL";
  const knownYears = tracks
    .map(trackYearEstimate)
    .filter((year): year is number => typeof year === "number");
  const eraSpanStable = knownYears.length < 2 || Math.max(...knownYears) - Math.min(...knownYears) <= 20;
  const eraAlignment = eraSpanStable && (!requiresEra || tracks.every((track) =>
    !eraHardMismatch(track, intent)
  )) ? "PASS" : "FAIL";
  const moodAlignment = !requiresMood || tracks.filter((track) =>
    moodEvidence(track, intent) === true
  ).length >= Math.ceil(tracks.length * 0.65) ? "PASS" : "FAIL";
  const activityRelevance = !requiresActivity || tracks.filter((track) =>
    activityEvidence(track, intent) === true
  ).length >= Math.ceil(tracks.length * 0.65) ? "PASS" : "FAIL";

  return { genreConsistency, eraAlignment, moodAlignment, activityRelevance };
}

function validationPassed(validation: Record<string, "PASS" | "FAIL">): boolean {
  return Object.values(validation).every((value) => value === "PASS");
}

function validSpotifyTrackShape(track: {
  trackId?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  albumName?: unknown;
}): boolean {
  return typeof track.trackId === "string" &&
    track.trackId.trim().length > 0 &&
    typeof track.trackName === "string" &&
    track.trackName.trim().length > 0 &&
    typeof track.artistName === "string" &&
    track.artistName.trim().length > 0 &&
    typeof track.albumName === "string";
}

function sanitizePlaylistTrack<T extends ConstraintTrack>(track: T): T | null {
  if (!validSpotifyTrackShape(track)) return null;
  const score = typeof track.score === "number" && Number.isFinite(track.score) ? track.score : 0.7;
  return {
    ...track,
    trackId: track.trackId.trim(),
    trackName: track.trackName.trim(),
    artistName: track.artistName.trim(),
    albumName: track.albumName ?? "",
    score,
    energy: typeof track.energy === "number" && Number.isFinite(track.energy) ? track.energy : null,
    valence: typeof track.valence === "number" && Number.isFinite(track.valence) ? track.valence : null,
    tempo: typeof track.tempo === "number" && Number.isFinite(track.tempo) ? track.tempo : null,
    danceability: typeof track.danceability === "number" && Number.isFinite(track.danceability) ? track.danceability : null,
    acousticness: typeof track.acousticness === "number" && Number.isFinite(track.acousticness) ? track.acousticness : null,
    loudness: typeof track.loudness === "number" && Number.isFinite(track.loudness) ? track.loudness : null,
    speechiness: typeof track.speechiness === "number" && Number.isFinite(track.speechiness) ? track.speechiness : null,
  };
}

function finalTrackMatchesExplicitGenre(
  track: ConstraintTrack,
  intent: LockedIntent,
  constraints: ConstraintLayer,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): boolean {
  const expectedFamilies = intent.primaryGenres.length > 0 ? intent.primaryGenres : intent.genreFamilies;
  if (expectedFamilies.length === 0 && constraints.hard.genres.length === 0) return true;
  const families = expectedFamilies.length > 0 ? expectedFamilies : constraints.hard.genres;
  if (families.some((family) =>
    hasFinalGenreEvidence(track, classMap, [family]) ||
    (constraints.raw.americanaBridgePrompt && family === "country" && isAmericanaCompatibleTrack(track, classMap))
  )) {
    return true;
  }
  const family = trackGenreFamily(track, classMap);
  if (family === "unknown") return true;
  return families.includes(family);
}

function finalTrackMatchesExplicitEra(track: ConstraintTrack, intent: LockedIntent): boolean {
  if (!intent.eraRange) return true;
  return !trackHasKnownEraMismatch(track, intent.eraRange);
}

function finalTrackIsSafe(
  track: ConstraintTrack,
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    allowHolidaySeason?: boolean;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  }
): boolean {
  if (!trackMatchesHardConstraints(track, opts.constraints, opts.classMap)) return false;
  if (
    isUkGaragePrompt(opts.vibe) &&
    (trackGenreFamily(track, opts.classMap) !== "electronic" || isKnownNonUkGarageTrack(track))
  ) {
    return false;
  }
  if (
    isTechnoIdentityPrompt(opts.vibe) &&
    !trackMatchesTechnoIdentity(track, opts.classMap) &&
    !["electronic", "unknown"].includes(trackGenreFamily(track, opts.classMap))
  ) {
    return false;
  }
  const lockedIntentSafe = trackPassesLockedIntent(track, opts.intent, opts.constraints, opts.classMap);
  if (!lockedIntentSafe && !isBroadMoodPlacePrompt(opts.vibe, opts.intent, opts.constraints)) return false;
  if (!finalTrackMatchesExplicitGenre(track, opts.intent, opts.constraints, opts.classMap)) return false;
  if (!finalTrackMatchesExplicitEra(track, opts.intent)) return false;
  if (opts.allowHolidaySeason !== true && trackIsChristmasTrack(track, opts.classMap)) return false;
  const explicitGenreLocked = hasExplicitGenreIntent(opts.intent, opts.constraints);
  if (isGymWorkoutPrompt(opts.vibe, opts.intent) && !trackIsGymWorkoutSafe(track)) return false;
  if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(track)) return false;
  if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(track)) return false;
  if (isLateNightDrivingPrompt(opts.vibe, opts.intent) && !trackIsLateNightDrivingSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(track)) return false;
  if (isSleepSafetyPrompt(opts.vibe, opts.intent) && !trackIsSleepSafe(track)) return false;
  if (isRainyNightWalkPrompt(opts.vibe, opts.intent) && !trackIsRainyNightWalkSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isChillCalmPrompt(opts.vibe, opts.intent) && !trackIsChillCalmSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isEuphoricSummerPrompt(opts.vibe, opts.intent) && !trackIsEuphoricSummerSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isBreakupRainDrivePrompt(opts.vibe, opts.intent) && !trackIsBreakupRainDriveSafe(track, explicitGenreLocked, opts.classMap)) return false;
  return true;
}

function finalTrackIsHardSafe(
  track: ConstraintTrack,
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    allowHolidaySeason?: boolean;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  }
): boolean {
  if (!trackMatchesHardConstraints(track, opts.constraints, opts.classMap)) return false;
  if (
    isUkGaragePrompt(opts.vibe) &&
    (trackGenreFamily(track, opts.classMap) !== "electronic" || isKnownNonUkGarageTrack(track))
  ) {
    return false;
  }
  if (
    isTechnoIdentityPrompt(opts.vibe) &&
    !trackMatchesTechnoIdentity(track, opts.classMap) &&
    !["electronic", "unknown"].includes(trackGenreFamily(track, opts.classMap))
  ) {
    return false;
  }
  if (eraHardMismatch(track, opts.intent)) return false;
  if (!finalTrackMatchesExplicitGenre(track, opts.intent, opts.constraints, opts.classMap)) return false;
  if (!finalTrackMatchesExplicitEra(track, opts.intent)) return false;
  if (opts.allowHolidaySeason !== true && trackIsChristmasTrack(track, opts.classMap)) return false;
  const explicitGenreLocked = hasExplicitGenreIntent(opts.intent, opts.constraints);
  if (isGymWorkoutPrompt(opts.vibe, opts.intent) && !trackIsGymWorkoutSafe(track)) return false;
  if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(track)) return false;
  if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(track)) return false;
  if (isLateNightDrivingPrompt(opts.vibe, opts.intent) && !trackIsLateNightDrivingSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(track)) return false;
  if (isSleepSafetyPrompt(opts.vibe, opts.intent) && !trackIsSleepSafe(track)) return false;
  if (isRainyNightWalkPrompt(opts.vibe, opts.intent) && !trackIsRainyNightWalkSafe(track, explicitGenreLocked, opts.classMap)) return false;
  if (isChillCalmPrompt(opts.vibe, opts.intent) && !trackIsChillCalmSafe(track, explicitGenreLocked, opts.classMap)) return false;
  return true;
}

const UNIVERSAL_IDENTITY_STOPWORDS = new Set([
  "music",
  "songs",
  "playlist",
  "tracks",
  "track",
  "with",
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

function normalizeUniversalIdentityTerm(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function pushUniversalIdentityTerm(out: string[], seen: Set<string>, value: string): void {
  const term = normalizeUniversalIdentityTerm(value);
  if (term.length < 3 || seen.has(term) || UNIVERSAL_IDENTITY_STOPWORDS.has(term)) return;
  seen.add(term);
  out.push(term);
}

function universalIdentityTerms(vibe: string, intent: LockedIntent, constraints: ConstraintLayer): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const addMatched = (terms: string[]): void => {
    for (const term of terms) {
      if (termRegex([term]).test(vibe)) pushUniversalIdentityTerm(out, seen, term);
    }
  };

  for (const group of [...GENRE_ALIASES, ...EXPANDED_GENRE_ALIASES]) addMatched(group.terms);
  for (const terms of Object.values(EXPANDED_MOOD_TERMS)) addMatched(terms);
  for (const terms of Object.values(EXPANDED_ACTIVITY_TERMS)) addMatched(terms);
  for (const terms of Object.values(EXPANDED_PLACE_TERMS)) addMatched(terms);
  for (const terms of Object.values(EXPANDED_TIME_TERMS)) addMatched(terms);
  for (const era of EXPANDED_ERA_TERMS) addMatched(era.terms);
  addMatched(EXPANDED_EVENT_TERMS);

  for (const family of [...intent.primaryGenres, ...intent.genreFamilies, ...constraints.hard.genres]) {
    pushUniversalIdentityTerm(out, seen, family);
  }
  if (intent.primaryGenre) pushUniversalIdentityTerm(out, seen, intent.primaryGenre);
  if (intent.primarySubgenre) pushUniversalIdentityTerm(out, seen, intent.primarySubgenre);
  if (intent.secondarySubgenre) pushUniversalIdentityTerm(out, seen, intent.secondarySubgenre);
  for (const subgenre of intent.subgenreTerms) pushUniversalIdentityTerm(out, seen, subgenre);
  for (const mood of intent.mood) pushUniversalIdentityTerm(out, seen, mood);
  if (intent.activity) pushUniversalIdentityTerm(out, seen, intent.activity);
  if (intent.energyLevel) pushUniversalIdentityTerm(out, seen, intent.energyLevel);

  const rawTokens = normalizeUniversalIdentityTerm(vibe)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !UNIVERSAL_IDENTITY_STOPWORDS.has(token));
  for (const token of rawTokens) pushUniversalIdentityTerm(out, seen, token);

  return out.slice(0, 18);
}

function trackUniversalIdentityText(
  track: ConstraintTrack,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>
): string {
  const classification = classMap.get(track.trackId);
  const metadata = [
    track.trackName,
    track.artistName,
    track.albumName,
    track.genrePrimary,
    trackGenreFamily(track, classMap),
    classification?.genrePrimary,
    classification?.genreFamily,
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
    ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres : []),
    ...(Array.isArray(track.albumGenres) ? track.albumGenres : []),
  ].filter((value): value is string => typeof value === "string");
  return normalizeUniversalIdentityTerm(metadata.join(" "));
}

function intentCoherenceScore(
  track: ConstraintTrack,
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  },
  preferredFamilies: Set<string> = new Set(),
  identityTerms = universalIdentityTerms(opts.vibe, opts.intent, opts.constraints)
): number {
  let score = 0;
  let violations = 0;
  const expectedFamilies = opts.intent.primaryGenres.length > 0
    ? opts.intent.primaryGenres
    : opts.intent.genreFamilies.length > 0
      ? opts.intent.genreFamilies
      : opts.constraints.hard.genres;
  const family = trackGenreFamily(track, opts.classMap);
  const identityText = trackUniversalIdentityText(track, opts.classMap);

  if (expectedFamilies.length > 0) {
    if (hasFinalGenreEvidence(track, opts.classMap, expectedFamilies)) {
      score += 0.16;
    } else if (family !== "unknown" && !expectedFamilies.includes(family)) {
      score -= 0.28;
      violations++;
    } else {
      score -= 0.08;
    }
  } else if (preferredFamilies.size > 0 && family !== "unknown") {
    if (preferredFamilies.has(family)) {
      score += 0.08;
    } else {
      score -= 0.16;
      violations++;
    }
  }

  const structuredSubgenres = [
    opts.intent.primarySubgenre,
    opts.intent.secondarySubgenre,
    ...opts.intent.subgenreTerms,
  ]
    .filter((term): term is string => !!term)
    .map(normalizeUniversalIdentityTerm)
    .filter((term, index, terms) => terms.indexOf(term) === index);
  if (structuredSubgenres.length > 0) {
    const matchedSubgenres = structuredSubgenres.filter((term) => identityText.includes(term));
    if (matchedSubgenres.length > 0) {
      score += Math.min(0.20, matchedSubgenres.length * 0.075);
    } else if (opts.intent.primaryGenre && family === opts.intent.primaryGenre) {
      score -= 0.12;
      violations++;
    }
  }

  if (identityTerms.length > 0) {
    const matchedTerms = identityTerms.filter((term) => identityText.includes(term));
    const specificIdentityActive = identityTerms.some((term) => !expectedFamilies.includes(term));
    if (matchedTerms.length >= Math.min(2, identityTerms.length)) {
      score += Math.min(0.18, matchedTerms.length * 0.05);
    } else if (matchedTerms.length === 1) {
      score += 0.04;
    } else if (specificIdentityActive) {
      score -= 0.18;
      violations++;
    }
  }

  if (opts.intent.eraRange) {
    if (trackHasKnownEraMismatch(track, opts.intent.eraRange)) {
      score -= 0.26;
      violations++;
    } else if (trackHasEraEvidence(track, opts.intent.eraRange)) {
      score += 0.10;
    }
  }

  if (opts.intent.mood.length > 0) {
    if (moodEvidence(track, opts.intent) === true) {
      score += 0.10;
    } else {
      score -= 0.12;
      violations++;
    }
  }

  if (opts.intent.activity || opts.intent.energyLevel) {
    if (activityEvidence(track, opts.intent) === true) {
      score += 0.12;
    } else {
      score -= 0.16;
      violations++;
    }
  }

  const explicitGenreLocked = hasExplicitGenreIntent(opts.intent, opts.constraints);
  if (isGymWorkoutPrompt(opts.vibe, opts.intent) && !trackIsGymWorkoutSafe(track)) score -= 0.22;
  if (isFocusStudyPrompt(opts.vibe, opts.intent) && !trackIsFocusStudySafe(track)) score -= 0.22;
  if (isBroadDrivingPrompt(opts.vibe, opts.intent) && !trackIsBroadDrivingSafe(track)) score -= 0.18;
  if (isLateNightDrivingPrompt(opts.vibe, opts.intent) && !trackIsLateNightDrivingSafe(track, explicitGenreLocked, opts.classMap)) score -= 0.22;
  if (isUpbeatSocialPrompt(opts.vibe, opts.intent) && !trackIsUpbeatSocialSafe(track)) score -= 0.18;
  if (isSleepSafetyPrompt(opts.vibe, opts.intent) && !trackIsSleepSafe(track)) score -= 0.26;
  if (isRainyNightWalkPrompt(opts.vibe, opts.intent) && !trackIsRainyNightWalkSafe(track, explicitGenreLocked, opts.classMap)) score -= 0.28;
  if (isChillCalmPrompt(opts.vibe, opts.intent) && !trackIsChillCalmSafe(track, explicitGenreLocked, opts.classMap)) score -= 0.24;
  if (violations >= 2) score -= Math.min(0.30, violations * 0.10);

  return score;
}

type PlaylistFinalizationDiagnostics = Record<string, number | boolean | string | null>;

function cohesionFamilyLimit(vibe: string, intent: LockedIntent, constraints: ConstraintLayer): number | null {
  if (constraints.hard.genres.length > 0) return null;
  if (isFocusStudyPrompt(vibe, intent)) return 1;
  if (isGymWorkoutPrompt(vibe, intent)) return 2;
  if (isUpbeatSocialPrompt(vibe, intent)) return 2;
  return null;
}

function preferredCohesionFamilies<T extends ConstraintTrack>(
  tracks: T[],
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
  }
): Set<string> {
  const limit = cohesionFamilyLimit(opts.vibe, opts.intent, opts.constraints);
  if (!limit) return new Set();
  const counts = new Map<string, number>();
  const scores = new Map<string, number>();
  for (const track of tracks.slice(0, Math.max(40, limit * 30))) {
    if (!finalTrackIsSafe(track, opts)) continue;
    const family = trackGenreFamily(track, opts.classMap);
    if (!family || family === "unknown") continue;
    counts.set(family, (counts.get(family) ?? 0) + 1);
    scores.set(family, (scores.get(family) ?? 0) + Math.max(0, track.score ?? 0));
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 4)
      .sort((a, b) => (scores.get(b[0]) ?? 0) - (scores.get(a[0]) ?? 0) || b[1] - a[1])
      .slice(0, limit)
      .map(([family]) => family)
  );
}

function vibeClusterKey(track: ConstraintTrack, classMap: Map<string, {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
}>): string {
  const family = trackGenreFamily(track, classMap);
  const energy = typeof track.energy === "number"
    ? track.energy >= 0.66 ? "high" : track.energy <= 0.40 ? "low" : "mid"
    : "energy_unknown";
  return [family || "unknown", energy].join(":");
}

function clusterLabel(clusterId: string): string {
  const [family, energy] = clusterId.split(":");
  return [family, energy].filter(Boolean).join(" / ");
}

function clusterEnergyBand(clusterId: string): number {
  const energy = clusterId.split(":")[1] ?? "mid";
  if (energy === "low") return 0;
  if (energy === "mid") return 1;
  if (energy === "high") return 2;
  return 1;
}

function clustersHaveEnergyOverlap(primaryCluster: string, secondaryCluster: string, identity: CuratorIdentity): boolean {
  const distance = Math.abs(clusterEnergyBand(primaryCluster) - clusterEnergyBand(secondaryCluster));
  if (distance === 0) return true;
  return distance === 1 && identity.chaosAllowance >= 0.08;
}

function shouldUseClusterCuration(vibe: string, intent: LockedIntent, constraints: ConstraintLayer, identity?: CuratorIdentity): boolean {
  if (constraints.hard.genres.length > 0) return false;
  if (identity && identity.type !== "balanced_curator") return true;
  return isFocusStudyPrompt(vibe, intent) || isGymWorkoutPrompt(vibe, intent) || isUpbeatSocialPrompt(vibe, intent);
}

function curateCandidatesByVibeCluster<T extends ConstraintTrack>(
  initial: T[],
  candidates: T[],
  opts: {
    vibe: string;
    intent: LockedIntent;
    constraints: ConstraintLayer;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
    requestedLength: number;
    identity?: CuratorIdentity;
  }
): {
  initial: T[];
  candidates: T[];
  diagnostics: {
    active: boolean;
    selectedCluster: string | null;
    selectedClusterLabel: string | null;
    selectedClusterCount: number;
    clusterConfidence: number;
    fallbackCandidatePercent: number;
    outlierReserve: number;
    secondaryCluster: string | null;
    secondaryClusterLabel: string | null;
    majorExclusions: string[];
  };
} {
  const fallbackCandidateCount = candidates.filter((track) => Boolean((track as Record<string, unknown>)["_fallbackCandidate"])).length;
  const fallbackCandidatePercent = candidates.length
    ? Math.round((fallbackCandidateCount / candidates.length) * 100)
    : 0;
  if (!shouldUseClusterCuration(opts.vibe, opts.intent, opts.constraints, opts.identity)) {
    return {
      initial,
      candidates,
      diagnostics: {
        active: false,
        selectedCluster: null,
        selectedClusterLabel: null,
        selectedClusterCount: 0,
        clusterConfidence: 0,
        fallbackCandidatePercent,
        outlierReserve: 0,
        secondaryCluster: null,
        secondaryClusterLabel: null,
        majorExclusions: [],
      },
    };
  }

  const safePrimaryCandidates = candidates
    .filter((track) => !Boolean((track as Record<string, unknown>)["_fallbackCandidate"]))
    .filter((track) => finalTrackIsSafe(track, {
      vibe: opts.vibe,
      intent: opts.intent,
      constraints: opts.constraints,
      classMap: opts.classMap,
    }))
    .slice(0, Math.max(160, opts.requestedLength * 6));
  const clusters = new Map<string, { count: number; score: number }>();
  for (const track of safePrimaryCandidates) {
    const key = vibeClusterKey(track, opts.classMap);
    const current = clusters.get(key) ?? { count: 0, score: 0 };
    current.count += 1;
    current.score += Math.max(0, track.score ?? 0);
    clusters.set(key, current);
  }
  const selected = [...clusters.entries()]
    .filter(([, value]) => value.count >= Math.min(4, Math.max(2, Math.ceil(opts.requestedLength * 0.08))))
    .sort((a, b) => b[1].score - a[1].score || b[1].count - a[1].count)[0] ?? null;
  if (!selected) {
    return {
      initial,
      candidates,
      diagnostics: {
        active: true,
        selectedCluster: null,
        selectedClusterLabel: null,
        selectedClusterCount: 0,
        clusterConfidence: 0,
        fallbackCandidatePercent,
        outlierReserve: Math.max(2, Math.ceil(opts.requestedLength * 0.12)),
        secondaryCluster: null,
        secondaryClusterLabel: null,
        majorExclusions: ["no_stable_cluster_found"],
      },
    };
  }

  const [selectedCluster, selectedStats] = selected;
  const clusterConfidence = Math.min(1, selectedStats.count / Math.max(1, opts.requestedLength));
  const identityChaos = opts.identity?.chaosAllowance ?? 0.08;
  const outlierReserve = clusterConfidence < 0.45
    ? Math.ceil(opts.requestedLength * Math.max(0.12, identityChaos * 2))
    : Math.max(1, Math.ceil(opts.requestedLength * identityChaos));
  const secondary = [...clusters.entries()]
    .filter(([clusterId, value]) =>
      clusterId !== selectedCluster &&
      value.count >= Math.min(3, Math.max(2, Math.ceil(opts.requestedLength * 0.06))) &&
      (!opts.identity || clustersHaveEnergyOverlap(selectedCluster, clusterId, opts.identity))
    )
    .sort((a, b) => b[1].score - a[1].score || b[1].count - a[1].count)[0] ?? null;
  const secondaryCluster = secondary?.[0] ?? null;
  const inCluster = (track: T): boolean => {
    const cluster = vibeClusterKey(track, opts.classMap);
    return cluster === selectedCluster || (secondaryCluster !== null && cluster === secondaryCluster);
  };
  const isFinalSafe = (track: T): boolean => finalTrackIsSafe(track, {
    vibe: opts.vibe,
    intent: opts.intent,
    constraints: opts.constraints,
    classMap: opts.classMap,
  });
  const safeClusterCount = candidates.filter((track) => inCluster(track) && isFinalSafe(track)).length;
  const targetCuratedSafeCount = Math.ceil(opts.requestedLength * (isGymWorkoutPrompt(opts.vibe, opts.intent) ? 2.4 : 1.8));
  const reserveCap = Math.ceil(opts.requestedLength * (isGymWorkoutPrompt(opts.vibe, opts.intent) ? 1.1 : 0.65));
  const expandedReserve = Math.min(
    reserveCap,
    Math.max(outlierReserve, targetCuratedSafeCount - safeClusterCount),
  );
  const initialCluster = initial.filter(inCluster);
  const initialReserve = initial
    .filter((track) => !inCluster(track) && !Boolean((track as Record<string, unknown>)["_fallbackCandidate"]))
    .filter(isFinalSafe)
    .slice(0, expandedReserve);
  const candidateCluster = candidates.filter(inCluster);
  const candidateReserve = candidates
    .filter((track) => !inCluster(track))
    .filter(isFinalSafe)
    .map((track) => ({
      ...track,
      score: Math.max(0, (track.score ?? 0) - (Boolean((track as Record<string, unknown>)["_fallbackCandidate"]) ? 0.38 : 0.18)),
    } as T))
    .slice(0, expandedReserve);
  const majorExclusions = [
    `cluster_outliers:${Math.max(0, candidates.length - candidateCluster.length)}`,
    secondaryCluster ? `secondary_cluster:${clusterLabel(secondaryCluster)}` : null,
    expandedReserve > outlierReserve ? `expanded_safe_reserve:${expandedReserve}` : null,
    fallbackCandidatePercent > 20 ? `fallback_candidates:${fallbackCandidatePercent}%` : null,
  ].filter((value): value is string => !!value);

  return {
    initial: [...initialCluster, ...initialReserve],
    candidates: [...candidateCluster, ...candidateReserve],
    diagnostics: {
      active: true,
      selectedCluster,
      selectedClusterLabel: clusterLabel(selectedCluster),
      selectedClusterCount: selectedStats.count,
      clusterConfidence: Math.round(clusterConfidence * 100) / 100,
      fallbackCandidatePercent,
      outlierReserve: expandedReserve,
      secondaryCluster,
      secondaryClusterLabel: secondaryCluster ? clusterLabel(secondaryCluster) : null,
      majorExclusions,
    },
  };
}

function hasExplicitArtistRequest(vibe: string): boolean {
  return /\b(?:songs?\s+by|tracks?\s+by|only\s+[a-z0-9&'.\-\s]{2,40}\s+(?:songs?|tracks?)|playlist\s+of\s+)\b/i.test(vibe);
}

function artistDiversityCap(playlistSize: number, vibe: string): number {
  if (hasExplicitArtistRequest(vibe)) return Number.MAX_SAFE_INTEGER;
  if (playlistSize < 25) return 2;
  if (playlistSize <= 50) return 3;
  return 4;
}

function relaxedEmergencyArtistCap(playlistSize: number, maxPerArtist: number): number | null {
  if (!Number.isFinite(maxPerArtist) || maxPerArtist >= Number.MAX_SAFE_INTEGER / 2) return null;
  return maxPerArtist + 1;
}

function recoveryActivationThreshold(playlistSize: number): number {
  return Math.min(20, Math.max(8, Math.ceil(playlistSize * 0.70)));
}

function finalAlbumCap(playlistSize: number): number {
  if (playlistSize < 25) return 2;
  if (playlistSize <= 50) return 3;
  return 4;
}

function normalizeRepeatToken(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(?:remaster(?:ed)?|deluxe|expanded|anniversary|radio edit|single edit|edit|live|mono|stereo|version|mix)\b/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackRepeatSignature(track: { trackName?: string | null; artistName?: string | null }): string | null {
  const title = normalizeRepeatToken(track.trackName);
  const artist = normalizeRepeatToken(track.artistName);
  if (!title || !artist) return null;
  return `${artist}:${title}`;
}

function artistDiversityDiagnostics<T extends { artistName?: string | null }>(
  tracks: T[],
  maxPerArtist: number
): {
  uniqueArtists: number;
  repeatedArtists: number;
  cappedTracks: number;
  maxPerArtist: number | null;
  topRepeatedArtist: string | null;
  topRepeatedArtistCount: number;
} {
  const counts = new Map<string, number>();
  const displayNames = new Map<string, string>();
  for (const track of tracks) {
    const artist = (track.artistName ?? "").toLowerCase().trim();
    if (!artist) continue;
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
    displayNames.set(artist, track.artistName ?? artist);
  }
  const capped = Number.isFinite(maxPerArtist) ? maxPerArtist : Number.MAX_SAFE_INTEGER;
  const topRepeated = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  return {
    uniqueArtists: counts.size,
    repeatedArtists: [...counts.values()].filter((count) => count > 1).length,
    cappedTracks: [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - capped), 0),
    maxPerArtist: capped === Number.MAX_SAFE_INTEGER ? null : capped,
    topRepeatedArtist: topRepeated && topRepeated[1] > 1 ? displayNames.get(topRepeated[0]) ?? topRepeated[0] : null,
    topRepeatedArtistCount: topRepeated?.[1] ?? 0,
  };
}

function evaluationSessionTrackLists(rawBody: Record<string, unknown>, auditMode: boolean): string[][] {
  if (!auditMode) return [];
  const memory = rawBody["evaluationSessionMemory"];
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) return [];
  const previousTrackIds = (memory as Record<string, unknown>)["previousTrackIds"];
  if (!Array.isArray(previousTrackIds)) return [];
  return previousTrackIds
    .filter((entry): entry is unknown[] => Array.isArray(entry))
    .map((entry) => entry
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim())
      .slice(0, 100)
    )
    .filter((entry) => entry.length > 0)
    .slice(0, 20);
}

function evaluationDiversityPressure(
  vibe: string,
  profile: EmotionProfile,
  evaluationMemoryCount: number
): number {
  if (evaluationMemoryCount <= 0) return 1;
  const lower = vibe.toLowerCase();
  if (profile.environment === "gym" || /\b(?:gym|workout|training|pump|cardio|run|running|lifting|weights)\b/.test(lower)) {
    return 0.75;
  }
  if (profile.environment === "party" || /\b(?:party|club|dancefloor|pre\s*drinks|night\s*out|rave)\b/.test(lower)) {
    return 0.65;
  }
  return 1;
}

function buildSessionMemory(
  recentPlaylistTrackIds: string[][],
  trackIdToArtist: Map<string, string>,
  maxPlaylists = 8
): IdentitySessionMemory {
  const usedArtists = new Set<string>();
  const usedTracks = new Set<string>();
  const artistFrequencyMap: Record<string, number> = {};
  for (const ids of recentPlaylistTrackIds.slice(0, maxPlaylists)) {
    const artistsInPlaylist = new Set<string>();
    for (const id of ids) {
      usedTracks.add(id);
      const artist = trackIdToArtist.get(id)?.toLowerCase().trim();
      if (artist) artistsInPlaylist.add(artist);
    }
    for (const artist of artistsInPlaylist) {
      usedArtists.add(artist);
      artistFrequencyMap[artist] = (artistFrequencyMap[artist] ?? 0) + 1;
    }
  }
  return { usedArtists, usedTracks, artistFrequencyMap };
}

function buildArtistReusePenalty(
  memory: IdentitySessionMemory,
  diversityPressure: number
): Map<string, number> | undefined {
  const entries = Object.entries(memory.artistFrequencyMap);
  if (entries.length === 0) return undefined;
  const pressure = Math.max(0.25, Math.min(1.25, diversityPressure));
  return new Map(entries.map(([artist, count]) => [
    artist,
    Math.min(0.34, count * 0.10 * pressure),
  ]));
}

function sessionReusePenalty(track: { trackId: string; artistName?: string | null }, memory: IdentitySessionMemory, identity: CuratorIdentity): number {
  let penalty = 0;
  if (memory.usedTracks.has(track.trackId)) penalty += 0.34 + identity.repetitionPenalty;
  const artist = track.artistName?.toLowerCase().trim();
  if (artist) {
    const appearances = memory.artistFrequencyMap[artist] ?? 0;
    if (appearances > 0) {
      const overTolerance = Math.max(0, appearances - identity.repetitionTolerance * 4);
      penalty += Math.min(0.56, appearances * identity.repetitionPenalty + overTolerance * 0.12);
    }
  }
  return penalty;
}

type CuratorScoringContext = {
  vibe: string;
  intent: LockedIntent;
  constraints: ConstraintLayer;
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>;
  preferredFamilies?: Set<string>;
  identityTerms: string[];
  expectedFamilies: string[];
};

function promptContrastPenalty(track: ConstraintTrack, vibe: string): number {
  const lower = vibe.toLowerCase();
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const loudness = track.loudness ?? -8;
  let penalty = 0;
  if (/\b(?:not|without|no)\s+(?:sad|depressing|depressed|bleak|miserable|gloomy)\b/.test(lower)) {
    if (valence < 0.28) penalty += 0.16;
    if (energy < 0.22 && valence < 0.38) penalty += 0.08;
  }
  if (/\b(?:not|without|no)\s+(?:angry|aggressive|rage|furious|harsh)\b/.test(lower)) {
    if (energy > 0.68 && valence < 0.48) penalty += 0.14;
    if (loudness > -4.8 && energy > 0.58) penalty += 0.08;
  }
  if (/\bdark\s+but\s+(?:cozy|cosy|warm|soft|safe)\b/.test(lower)) {
    if (valence < 0.20 || energy > 0.64) penalty += 0.12;
  }
  return Math.min(0.28, penalty);
}

function softEraConfidenceScore(track: ConstraintTrack, intent: LockedIntent, coherence: number): number {
  if (!intent.eraRange) return 0;
  if (trackHasKnownEraMismatch(track, intent.eraRange)) return -0.20;
  if (trackHasEraEvidence(track, intent.eraRange)) return 0.12;
  const estimatedYear = trackYearEstimate(track);
  if (estimatedYear && estimatedYear >= intent.eraRange.start && estimatedYear <= intent.eraRange.end) return 0.08;
  if (coherence >= 0.18) return 0.04;
  return -0.03;
}

function humanCuratorIntentScore(track: ConstraintTrack, identity: CuratorIdentity, context: CuratorScoringContext): number {
  const preferredFamilies = context.preferredFamilies ?? new Set<string>();
  const coherence = intentCoherenceScore(track, {
    vibe: context.vibe,
    intent: context.intent,
    constraints: context.constraints,
    classMap: context.classMap,
  }, preferredFamilies);
  const identityText = trackUniversalIdentityText(track, context.classMap);
  const identityHits = context.identityTerms.filter((term) => identityText.includes(term)).length;
  const family = trackGenreFamily(track, context.classMap);
  const familyAligned = context.expectedFamilies.length === 0 ||
    family === "unknown" ||
    context.expectedFamilies.includes(family);
  const moodAligned = moodEvidence(track, context.intent) !== false;
  const activityAligned = activityEvidence(track, context.intent) !== false;
  const isFallbackCandidate = Boolean((track as unknown as Record<string, unknown>)["_fallbackCandidate"]);

  let score = Math.max(-0.24, Math.min(0.30, coherence * 0.42));
  if (identityHits >= 2) score += 0.12;
  else if (identityHits === 1) score += 0.05;
  score += softEraConfidenceScore(track, context.intent, coherence);

  const weakFallback =
    isFallbackCandidate &&
    identityHits === 0 &&
    !familyAligned &&
    moodAligned !== true &&
    activityAligned !== true &&
    (!context.intent.eraRange || !trackHasEraEvidence(track, context.intent.eraRange));
  if (weakFallback) {
    score -= identity.type === "balanced_curator" ? 0.22 : 0.18;
  } else if (isFallbackCandidate && identityHits === 0 && coherence < 0.05) {
    score -= 0.10;
  }
  score -= promptContrastPenalty(track, context.vibe);
  return Math.max(-0.32, Math.min(0.38, score));
}

function applyCuratorIdentityScoring<T extends ConstraintTrack>(
  tracks: T[],
  identity: CuratorIdentity,
  memory: IdentitySessionMemory,
  context?: CuratorScoringContext
): T[] {
  return tracks
    .map((track) => {
      const identityFit = scoreTrackForIdentity(track, identity);
      const reusePenalty = sessionReusePenalty(track, memory, identity);
      const isFallbackCandidate = Boolean((track as Record<string, unknown>)["_fallbackCandidate"]);
      const fallbackPenalty = isFallbackCandidate
        ? 0.26 + (memory.usedTracks.has(track.trackId) ? 0.32 : 0)
        : 0;
      const identityBias = (identityFit - 0.5) * 0.40;
      const humanCuratorBias = context ? humanCuratorIntentScore(track, identity, context) : 0;
      return {
        ...track,
        score: Math.max(0, (track.score ?? 0) + identityBias + humanCuratorBias - reusePenalty - fallbackPenalty),
        _identityFit: Math.round(identityFit * 100) / 100,
        _identityBias: Math.round(identityBias * 100) / 100,
        _humanCuratorBias: Math.round(humanCuratorBias * 100) / 100,
        _sessionReusePenalty: Math.round(reusePenalty * 100) / 100,
      } as T;
    })
    .sort((a, b) => b.score - a.score);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function humanCoherenceScore<T extends ConstraintTrack>(
  tracks: T[],
  identity: CuratorIdentity
): { score: number; components: Record<string, number>; reasons: string[] } {
  if (tracks.length === 0) {
    return { score: 0, components: {}, reasons: ["empty_playlist"] };
  }
  const energies = tracks.map((track) => track.energy ?? 0.5);
  const energyMean = average(energies);
  const energyVariance = average(energies.map((energy) => Math.abs(energy - energyMean)));
  const energyConsistency = Math.max(0, 1 - energyVariance * (identity.chaosAllowance <= 0.05 ? 3.2 : 2.6));
  const valences = tracks.map((track) => track.valence ?? 0.5);
  const valenceMean = average(valences);
  const emotionalVariance = average(valences.map((valence) => Math.abs(valence - valenceMean)));
  const emotionalStability = Math.max(0, 1 - emotionalVariance * 2.4);
  const transitionPenalties: number[] = [];
  for (let i = 1; i < tracks.length; i++) {
    const prev = tracks[i - 1]!;
    const cur = tracks[i]!;
    const energyJump = Math.abs((prev.energy ?? 0.5) - (cur.energy ?? 0.5));
    const valenceJump = Math.abs((prev.valence ?? 0.5) - (cur.valence ?? 0.5));
    transitionPenalties.push(Math.max(0, energyJump - 0.24) + Math.max(0, valenceJump - 0.30));
  }
  const transitionSmoothness = Math.max(0, 1 - average(transitionPenalties) * 1.8);
  const score =
    energyConsistency * 0.40 +
    transitionSmoothness * 0.30 +
    emotionalStability * 0.30;
  const reasons = [
    energyConsistency < 0.58 ? "low_energy_consistency" : null,
    transitionSmoothness < 0.58 ? "jumpy_transitions" : null,
    emotionalStability < 0.58 ? "unstable_emotional_flow" : null,
  ].filter((reason): reason is string => !!reason);
  return {
    score: Math.round(score * 100) / 100,
    components: {
      energyConsistency: Math.round(energyConsistency * 100) / 100,
      transitionSmoothness: Math.round(transitionSmoothness * 100) / 100,
      emotionalStability: Math.round(emotionalStability * 100) / 100,
    },
    reasons,
  };
}

function trackListChanged<T extends { trackId: string }>(before: T[], after: T[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((track, index) => track.trackId !== after[index]?.trackId);
}

function finalizePlaylistTracks<T extends ConstraintTrack>(opts: {
  initial: T[];
  candidates: T[];
  requestedLength: number;
  vibe: string;
  intent: LockedIntent;
  constraints: ConstraintLayer;
  allowHolidaySeason?: boolean;
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>;
  maxPerArtist: number;
  trackReusePenalty?: Map<string, number>;
  artistReusePenalty?: Map<string, number>;
}): { tracks: T[]; diagnostics: PlaylistFinalizationDiagnostics } {
  const seen = new Set<string>();
  const repeatSignatures = new Set<string>();
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  let malformedDropped = 0;
  let unsafeDropped = 0;
  let duplicateDropped = 0;
  let duplicateSignatureDropped = 0;
  let artistLimitSkipped = 0;
  let albumLimitSkipped = 0;
  let cohesionSkipped = 0;
  let cohesionRelaxedFillUsed = false;
  let cohesionRelaxedFillAdded = 0;
  let relaxedArtistFillUsed = false;
  let relaxedAlbumFillUsed = false;
  let hardSafeFillUsed = false;
  let hardSafeFillAdded = 0;
  let hardSafeSkipped = 0;
  let hardSafeDiversitySkipped = 0;
  let coherenceDownranked = 0;

  const out: T[] = [];
  const identityTerms = universalIdentityTerms(opts.vibe, opts.intent, opts.constraints);
  const candidateFinalizationScore = (track: T, preferredFamilies: Set<string> = new Set()): number => {
    const trackPenalty = boundedTrackReusePenalty(opts.trackReusePenalty?.get(track.trackId));
    const coherence = intentCoherenceScore(track, opts, preferredFamilies, identityTerms);
    return (track.score ?? 0) + coherence - trackPenalty;
  };
  const rankedCandidates = opts.candidates
    .map(sanitizePlaylistTrack)
    .filter((track): track is T => !!track)
    .sort((a, b) => candidateFinalizationScore(b) - candidateFinalizationScore(a));
  const preferredFamilies = preferredCohesionFamilies(rankedCandidates, opts);
  coherenceDownranked = rankedCandidates.filter((track) => intentCoherenceScore(track, opts, preferredFamilies, identityTerms) < 0).length;
  const coherentRankedCandidates = [...rankedCandidates]
    .sort((a, b) => candidateFinalizationScore(b, preferredFamilies) - candidateFinalizationScore(a, preferredFamilies));
  const outOfFamilyReserve = Math.max(2, Math.ceil(opts.requestedLength * 0.12));
  const tryAdd = (
    track: T,
    artistLimit: number | null,
    albumLimit: number | null,
    enforceRepeatSignature: boolean,
    enforceCohesion = true
  ): void => {
    if (out.length >= opts.requestedLength) return;
    const sanitized = sanitizePlaylistTrack(track);
    if (!sanitized) {
      malformedDropped++;
      return;
    }
    if (seen.has(sanitized.trackId)) {
      duplicateDropped++;
      return;
    }
    const repeatSignature = trackRepeatSignature(sanitized);
    if (enforceRepeatSignature && repeatSignature && repeatSignatures.has(repeatSignature)) {
      duplicateSignatureDropped++;
      return;
    }
    if (!finalTrackIsSafe(sanitized, opts)) {
      unsafeDropped++;
      return;
    }
    const family = trackGenreFamily(sanitized, opts.classMap);
    if (
      enforceCohesion &&
      preferredFamilies.size > 0 &&
      family !== "unknown" &&
      !preferredFamilies.has(family) &&
      out.length < opts.requestedLength - outOfFamilyReserve
    ) {
      cohesionSkipped++;
      return;
    }
    const artistKey = sanitized.artistName.toLowerCase().trim();
    const artistCount = artistCounts.get(artistKey) ?? 0;
    if (artistLimit !== null && artistCount >= artistLimit) {
      artistLimitSkipped++;
      return;
    }
    const albumKey = normalizeRepeatToken(sanitized.albumName);
    const albumCount = albumKey ? albumCounts.get(albumKey) ?? 0 : 0;
    if (albumLimit !== null && albumKey && albumCount >= albumLimit) {
      albumLimitSkipped++;
      return;
    }
    seen.add(sanitized.trackId);
    if (repeatSignature) repeatSignatures.add(repeatSignature);
    artistCounts.set(artistKey, artistCount + 1);
    if (albumKey) albumCounts.set(albumKey, albumCount + 1);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    out.push(sanitized);
  };
  const hardSafeCandidateScore = (track: T): number => {
    const artistKey = track.artistName.toLowerCase().trim();
    const albumKey = normalizeRepeatToken(track.albumName);
    const artistPressure = artistCounts.get(artistKey) ?? 0;
    const albumPressure = albumKey ? albumCounts.get(albumKey) ?? 0 : 0;
    const family = trackGenreFamily(track, opts.classMap);
    const familyPressure = familyCounts.get(family) ?? 0;
    const familyBonus = preferredFamilies.size === 0 || family === "unknown" || preferredFamilies.has(family) ? 0.08 : 0;
    const reusePenalty = boundedTrackReusePenalty(opts.trackReusePenalty?.get(track.trackId));
    const artistReusePenalty = Math.max(0, Math.min(0.34, opts.artistReusePenalty?.get(artistKey) ?? 0));
    return (track.score ?? 0) + familyBonus + intentCoherenceScore(track, opts, preferredFamilies, identityTerms) - artistPressure * 0.42 - albumPressure * 0.22 - familyPressure * 0.10 - reusePenalty - artistReusePenalty;
  };
  const hardSafeCandidates = (tracks: T[]): T[] =>
    tracks
      .map(sanitizePlaylistTrack)
      .filter((track): track is T => !!track)
      .sort((a, b) => hardSafeCandidateScore(b) - hardSafeCandidateScore(a));
  const tryAddHardSafe = (
    track: T,
    enforceRepeatSignature: boolean,
    artistLimit: number | null,
    albumLimit: number | null
  ): void => {
    if (out.length >= opts.requestedLength) return;
    const sanitized = sanitizePlaylistTrack(track);
    if (!sanitized) {
      malformedDropped++;
      return;
    }
    if (seen.has(sanitized.trackId)) {
      duplicateDropped++;
      return;
    }
    const repeatSignature = trackRepeatSignature(sanitized);
    if (enforceRepeatSignature && repeatSignature && repeatSignatures.has(repeatSignature)) {
      duplicateSignatureDropped++;
      return;
    }
    if (!finalTrackIsHardSafe(sanitized, opts)) {
      hardSafeSkipped++;
      return;
    }
    const artistKey = sanitized.artistName.toLowerCase().trim();
    const albumKey = normalizeRepeatToken(sanitized.albumName);
    const artistCount = artistCounts.get(artistKey) ?? 0;
    const albumCount = albumKey ? albumCounts.get(albumKey) ?? 0 : 0;
    if (artistLimit !== null && artistCount >= artistLimit) {
      hardSafeDiversitySkipped++;
      return;
    }
    if (albumLimit !== null && albumKey && albumCount >= albumLimit) {
      hardSafeDiversitySkipped++;
      return;
    }
    seen.add(sanitized.trackId);
    if (repeatSignature) repeatSignatures.add(repeatSignature);
    artistCounts.set(artistKey, artistCount + 1);
    if (albumKey) albumCounts.set(albumKey, albumCount + 1);
    const family = trackGenreFamily(sanitized, opts.classMap);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    out.push(sanitized);
    hardSafeFillAdded++;
  };

  const primaryArtistLimit = Number.isFinite(opts.maxPerArtist) ? opts.maxPerArtist : null;
  const emergencyArtistLimit = relaxedEmergencyArtistCap(opts.requestedLength, opts.maxPerArtist);
  const primaryAlbumLimit = finalAlbumCap(opts.requestedLength);
  const emergencyAlbumLimit = primaryAlbumLimit + Math.max(1, Math.ceil(opts.requestedLength * 0.05));
  const shouldCompleteActivityPlaylist =
    isGymWorkoutPrompt(opts.vibe, opts.intent) ||
    isBroadDrivingPrompt(opts.vibe, opts.intent) ||
    isUpbeatSocialPrompt(opts.vibe, opts.intent);
  const completionTarget = opts.requestedLength;

  for (const track of opts.initial) tryAdd(track, primaryArtistLimit, primaryAlbumLimit, true);
  for (const track of coherentRankedCandidates) tryAdd(track, primaryArtistLimit, primaryAlbumLimit, true);
  if (out.length < recoveryActivationThreshold(opts.requestedLength)) {
    const beforeRelaxedFill = out.length;
    for (const track of coherentRankedCandidates) tryAdd(track, emergencyArtistLimit, emergencyAlbumLimit, true);
    relaxedArtistFillUsed = emergencyArtistLimit !== null && out.length > beforeRelaxedFill;
    relaxedAlbumFillUsed = out.length > beforeRelaxedFill;
  }
  if (out.length < completionTarget) {
    cohesionRelaxedFillUsed = preferredFamilies.size > 0;
    for (const track of coherentRankedCandidates) {
      const before = out.length;
      tryAdd(track, emergencyArtistLimit, emergencyAlbumLimit, true, false);
      if (out.length > before) cohesionRelaxedFillAdded++;
    }
  }
  if (out.length < completionTarget) {
    hardSafeFillUsed = true;
    const strictHardSafeArtistLimit = primaryArtistLimit ?? emergencyArtistLimit;
    const strictHardSafeAlbumLimit = primaryAlbumLimit;
    for (const track of hardSafeCandidates([...opts.initial, ...coherentRankedCandidates])) {
      tryAddHardSafe(track, true, strictHardSafeArtistLimit, strictHardSafeAlbumLimit);
    }
    if (out.length < opts.requestedLength) {
      for (const track of hardSafeCandidates(coherentRankedCandidates)) {
        tryAddHardSafe(track, false, emergencyArtistLimit, emergencyAlbumLimit);
      }
    }
    if (out.length < recoveryActivationThreshold(opts.requestedLength)) {
      for (const track of hardSafeCandidates(coherentRankedCandidates)) {
        tryAddHardSafe(track, false, null, null);
      }
    }
  }
  const minimumCompleteCount = Math.min(opts.requestedLength, Math.ceil(opts.requestedLength * 0.90));
  if (out.length < minimumCompleteCount) {
    hardSafeFillUsed = true;
    for (const track of hardSafeCandidates([...coherentRankedCandidates, ...rankedCandidates])) {
      tryAddHardSafe(track, false, null, null);
      if (out.length >= minimumCompleteCount) break;
    }
  }

  return {
    tracks: out,
    diagnostics: {
      requestedLength: opts.requestedLength,
      finalCount: out.length,
      malformedDropped,
      unsafeDropped,
      duplicateDropped,
      duplicateSignatureDropped,
      artistLimitSkipped,
      albumLimitSkipped,
      cohesionSkipped,
      cohesionFamilies: preferredFamilies.size ? [...preferredFamilies].join(",") : null,
      intentCoherenceDownranked: coherenceDownranked,
      completionTarget,
      activityCompletionTarget: shouldCompleteActivityPlaylist,
      cohesionRelaxedFillUsed,
      cohesionRelaxedFillAdded,
      artistLimitRelaxed: relaxedArtistFillUsed,
      artistLimitRelaxedTo: relaxedArtistFillUsed ? emergencyArtistLimit : null,
      albumLimitRelaxed: relaxedAlbumFillUsed,
      albumLimitRelaxedTo: relaxedAlbumFillUsed ? emergencyAlbumLimit : null,
      artistLimitBypassed: false,
      hardSafeFillUsed,
      hardSafeFillAdded,
      hardSafeSkipped,
      hardSafeDiversitySkipped,
      replenished: out.length > opts.initial.length,
      sleepSafetyApplied: isSleepSafetyPrompt(opts.vibe, opts.intent),
      artistDiversityUniqueArtists: artistDiversityDiagnostics(out, opts.maxPerArtist).uniqueArtists,
      artistDiversityRepeatedArtists: artistDiversityDiagnostics(out, opts.maxPerArtist).repeatedArtists,
      artistDiversityCappedTracks: artistDiversityDiagnostics(out, opts.maxPerArtist).cappedTracks,
      fallbackMode: null,
    },
  };
}

function broadEnergyRecoveryScore(track: ConstraintTrack, intent: LockedIntent, vibe: string): number {
  const lower = vibe.toLowerCase();
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const tempo = track.tempo ?? 110;
  const danceability = track.danceability ?? 0.5;
  const highEnergyPrompt =
    intent.energy === "high" ||
    intent.energyLevel === "high" ||
    intent.mood.includes("energised") ||
    /\b(?:party|hype|dance|club|rave|workout|gym)\b/i.test(lower);
  const targetEnergy = highEnergyPrompt ? 0.76 : intent.energy === "low" || intent.energyLevel === "low" ? 0.34 : 0.55;
  const targetValence = intent.mood.includes("melancholic") ? 0.38 : highEnergyPrompt ? 0.62 : 0.50;
  const tempoLift = tempo >= 95 && tempo <= 145 ? 0.08 : tempo > 145 ? 0.03 : 0;
  return (
    1 - Math.abs(energy - targetEnergy) * 0.55 -
    Math.abs(valence - targetValence) * 0.25 +
    danceability * 0.16 +
    tempoLift
  );
}

function recoverLowComplexityPlaylist<T extends ConstraintTrack>(opts: {
  initial: T[];
  fullLibrary: T[];
  candidates: T[];
  requestedLength: number;
  vibe: string;
  intent: LockedIntent;
  constraints: ConstraintLayer;
  allowHolidaySeason: boolean;
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>;
  maxPerArtist: number;
  trackReusePenalty?: Map<string, number>;
  artistReusePenalty?: Map<string, number>;
}): { tracks: T[]; diagnostics: PlaylistFinalizationDiagnostics; intent: LockedIntent } | null {
  const broadUnconstrainedPrompt =
    opts.intent.genreFamilies.length === 0 &&
    opts.intent.primaryGenres.length === 0 &&
    opts.constraints.hard.genres.length === 0 &&
    opts.constraints.hard.eraStart === null &&
    opts.constraints.hard.eraEnd === null &&
    opts.constraints.hard.excludedGenres.length === 0;
  const activityRecoveryPrompt = isGymWorkoutPrompt(opts.vibe, opts.intent) || isUpbeatSocialPrompt(opts.vibe, opts.intent);
  if (opts.intent.interpretationBudget?.complexity !== "low" && !broadUnconstrainedPrompt && !activityRecoveryPrompt) return null;

  const base = {
    requestedLength: opts.requestedLength,
    vibe: opts.vibe,
    constraints: opts.constraints,
    allowHolidaySeason: opts.allowHolidaySeason,
    classMap: opts.classMap,
    maxPerArtist: opts.maxPerArtist,
    trackReusePenalty: opts.trackReusePenalty,
    artistReusePenalty: opts.artistReusePenalty,
  };
  const activityRelaxedConstraints: ConstraintLayer = {
    ...opts.constraints,
    hard: {
      ...opts.constraints.hard,
      genres: [],
      eraStart: null,
      eraEnd: null,
      strictLock: false,
    },
    raw: {
      ...opts.constraints.raw,
      explicitGenreTerms: [],
      explicitEraTerms: [],
      strictTerms: [],
    },
  };
  const attempts: Array<{ stage: string; intent: LockedIntent; candidates: T[]; constraints?: ConstraintLayer }> = [];
  const partialActivityTopUp = activityRecoveryPrompt && opts.initial.length > 0;

  if (!partialActivityTopUp && opts.intent.activity) {
    attempts.push({
      stage: "activity_relaxed",
      intent: { ...opts.intent, activity: null },
      candidates: opts.candidates,
    });
  }

  if (!partialActivityTopUp && opts.intent.mood.length > 0) {
    attempts.push({
      stage: "mood_relaxed",
      intent: { ...opts.intent, activity: null, mood: [] },
      candidates: opts.candidates,
    });
  }

  const recoveryIdentityTerms = universalIdentityTerms(opts.vibe, opts.intent, opts.constraints);
  const broadEnergyCandidates = opts.fullLibrary
    .filter((track) => !!track)
    .map((track) => ({
      ...track,
      score: broadEnergyRecoveryScore(track, opts.intent, opts.vibe) +
        intentCoherenceScore(track, {
          vibe: opts.vibe,
          intent: opts.intent,
          constraints: opts.constraints,
          classMap: opts.classMap,
        }, new Set(), recoveryIdentityTerms) * 0.8,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(240, opts.requestedLength * 12)) as T[];
  attempts.push({
    stage: "energy_recovery",
    intent: activityRecoveryPrompt ? opts.intent : { ...opts.intent, activity: null, mood: [], energy: null, energyLevel: null },
    candidates: broadEnergyCandidates,
    constraints: activityRecoveryPrompt && broadUnconstrainedPrompt ? activityRelaxedConstraints : undefined,
  });

  for (const attempt of attempts) {
    const finalization = finalizePlaylistTracks({
      ...base,
      constraints: attempt.constraints ?? base.constraints,
      initial: opts.initial,
      candidates: attempt.candidates,
      intent: attempt.intent,
    });
    if (finalization.tracks.length > opts.initial.length || finalization.tracks.length >= opts.requestedLength) {
      return {
        tracks: finalization.tracks,
        intent: attempt.intent,
        diagnostics: {
          ...finalization.diagnostics,
          fallbackMode: "broad_energy_recovery",
          recoveryStage: attempt.stage,
          recoveryScope: opts.intent.interpretationBudget?.complexity === "low" ? "low_complexity" : "broad_unconstrained",
          originalFinalCount: opts.initial.length,
          fullLibraryCandidates: opts.fullLibrary.length,
        },
      };
    }
  }

  return null;
}

function assertQualityConsistency(
  log: import("pino").Logger,
  opts: {
    tracks: Array<V3MetadataTrack<{ trackId: string }>>;
    diagnostics: Record<string, unknown> | null;
    fallbackUsed: boolean;
  }
): void {
  const diagnostics = opts.diagnostics ?? {};
  const lanes = diagnostics["lanes"] as unknown[] | undefined;
  const intent = diagnostics["intentDecomposition"] as Record<string, unknown> | undefined;
  const globalDiversity = diagnostics["globalDiversityMetrics"] as Record<string, unknown> | undefined;
  const postInterleave = globalDiversity?.["postInterleave"] as Record<string, unknown> | undefined;
  const warnings: string[] = [];

  if (!Array.isArray(lanes) || lanes.length === 0) warnings.push("lanes_empty");
  if (!opts.tracks.some((track) => !!track.genrePrimary)) warnings.push("missing_genrePrimary");
  if (!opts.tracks.some((track) => !!track.clusterId || (track.clusterIds?.length ?? 0) > 0)) {
    warnings.push("missing_clusterId");
  }
  if (!intent || typeof intent["primary"] !== "string" || !intent["primary"].trim()) {
    warnings.push("intent_empty");
  }
  if (!postInterleave || Object.keys(postInterleave).length === 0) {
    warnings.push("diversity_missing");
  }

  if (warnings.length > 0) {
    log.warn(
      {
        warnings,
        fallbackUsed: opts.fallbackUsed,
        trackCount: opts.tracks.length,
      },
      "Quality consistency guard warning"
    );
  }
}

function formatV3DiagnosticsForApi(
  rawV3: unknown,
  vibe: string
): Record<string, unknown> | null {
  const v3 = rawV3 as Record<string, unknown> | null | undefined;
  if (!v3 || typeof v3 !== "object") return null;
  const sampleArray = (value: unknown, limit: number): unknown[] =>
    Array.isArray(value) ? value.slice(0, limit) : [];
  const compactIntentContractGuard = (value: unknown): unknown => {
    const guard = value as Record<string, unknown> | null | undefined;
    if (!guard || typeof guard !== "object") return null;
    return {
      ...guard,
      softGuardOriginTrace: sampleArray(guard["softGuardOriginTrace"], 40),
    };
  };
  const compactRetrievalPools = (value: unknown): unknown => {
    const pools = value as Record<string, unknown> | null | undefined;
    if (!pools || typeof pools !== "object") return null;
    const compactPool = (pool: unknown): unknown => {
      const recordPool = pool as Record<string, unknown> | null | undefined;
      if (!recordPool || typeof recordPool !== "object") return pool;
      return {
        ...recordPool,
        top20: sampleArray(recordPool["top20"], 8),
      };
    };
    return Object.fromEntries(
      Object.entries(pools).map(([key, pool]) => [key, compactPool(pool)]),
    );
  };
  const compactControlledGeneration = (value: unknown): unknown => {
    const controlled = value as Record<string, unknown> | null | undefined;
    if (!controlled || typeof controlled !== "object") return null;
    return {
      ...controlled,
      candidateScores: sampleArray(controlled["candidateScores"], 3),
      constraintFailures: sampleArray(controlled["constraintFailures"], 20),
      relaxationSteps: sampleArray(controlled["relaxationSteps"], 12),
    };
  };
  const intent         = v3["intentDecomposition"] as Record<string, unknown> | undefined;
  const lanes          = v3["lanes"] as Array<Record<string, unknown>> | undefined;
  const globalDiv      = v3["globalDiversityMetrics"] as Record<string, unknown> | undefined;
  const preInterleave  = globalDiv?.["preInterleave"]  as Record<string, unknown> | undefined;
  const postInterleave = globalDiv?.["postInterleave"] as Record<string, unknown> | undefined;
  const rawPrimary = typeof intent?.["primary"] === "string" ? intent["primary"].trim() : "";
  const primary = rawPrimary && !/\b(mood|activity|era|genre|adjacent):/i.test(rawPrimary)
    ? rawPrimary
    : vibe;
  const derivedTags = deriveDiagnosticTags(vibe);
  return {
    pipelineVersion:  v3["pipelineVersion"] ?? "v3.1_unified_routing",
    activePath:       v3["activePath"] ?? "adaptive",
    sceneInfluenceMap: intent?.["sceneInfluenceMap"] ?? {},
    contextAnchors:   intent?.["contextAnchors"] ?? {},
    primary,
    intentDecomposition: {
      ...(intent ?? {}),
      primary,
      secondaryIntents: Array.isArray(intent?.["secondaryIntents"]) ? intent["secondaryIntents"] : [],
      moodTags: Array.isArray(intent?.["moodTags"]) && intent["moodTags"].length > 0 ? intent["moodTags"] : derivedTags.moodTags,
      activityTags: Array.isArray(intent?.["activityTags"]) && intent["activityTags"].length > 0 ? intent["activityTags"] : derivedTags.activityTags,
      eraHints: Array.isArray(intent?.["eraHints"]) && intent["eraHints"].length > 0 ? intent["eraHints"] : derivedTags.eraHints,
      genreHints: Array.isArray(intent?.["genreHints"]) && intent["genreHints"].length > 0 ? intent["genreHints"] : derivedTags.genreHints,
      confidence: typeof intent?.["confidence"] === "number" ? intent["confidence"] : 0.35,
    },
    lanes: (lanes ?? []).map((l) => ({
      laneId:        l["laneId"],
      type:          l["type"],
      label:         l["label"],
      weight:        l["weight"],
      scoredCount:   l["scoredCount"],
      selectedCount: l["selectedCount"],
      clusterSpread: l["clusterSpread"] ?? {},
      clusterSelectionRatios: l["clusterSelectionRatios"] ?? {},
    })),
    playlistExplanation:    v3["playlistExplanation"] ?? null,
    clusters:               sampleArray(v3["clusters"], 12),
    selectionTrace:         sampleArray(v3["selectionTrace"] ?? v3["finalDecisionTrace"], 60),
    finalDistribution:      v3["finalDistribution"] ?? {
      genres:  v3["genreDistribution"] ?? {},
      eras:    v3["eraDistribution"] ?? {},
      artists: {},
    },
    qualityLock:              v3["qualityLock"] ?? null,
    adaptiveLaneGenerator:    v3["adaptiveLaneGenerator"] ?? null,
    forensicPoolTrace:        (() => {
      const trace = v3["forensicPoolTrace"] as Record<string, unknown> | null | undefined;
      if (!trace || typeof trace !== "object") return null;
      return {
        ...trace,
        stages: sampleArray(trace["stages"], 24),
      };
    })(),
    retrievalRelaxation:      v3["retrievalRelaxation"] ?? null,
    recommendationEngine:     v3["recommendationEngine"] ?? null,
    embeddingRetrieval:       v3["embeddingRetrieval"] ?? null,
    interleaverDiagnostics:   v3["interleaverDiagnostics"] ?? null,
    laneContributions:        v3["laneContributions"] ?? {},
    fallback:                 v3["fallback"] ?? null,
    intentContractGuard:      compactIntentContractGuard(v3["intentContractGuard"]),
    controlledGeneration:     compactControlledGeneration(v3["controlledGeneration"]),
    playlistQuality:          v3["playlistQuality"] ?? null,
    playlistCritic:           v3["playlistCritic"] ?? null,
    clusterDistributionGraph: v3["clusterDistributionGraph"] ?? {},
    aggregateClusterSpread:   v3["aggregateClusterSpread"] ?? {},
    retrievalPoolsDetailed:   compactRetrievalPools(v3["retrievalPoolsDetailed"]),
    globalDiversityMetrics: {
      preInterleave:  preInterleave  ?? null,
      postInterleave: postInterleave ?? null,
    },
    genreConcentration:  postInterleave?.["genreConcentration"]  ?? null,
    explorationPressure: postInterleave?.["explorationPressure"] ?? null,
    dominantGenre:       postInterleave?.["dominantGenre"]       ?? null,
    dominantEra:         postInterleave?.["dominantEra"]         ?? null,
    systemDiagnostics: {
      v11Role:          "candidate_scoring_only",
      v3Role:           "final_selection_engine",
      uiAlignedTo:      "v3",
      debugTruthLevel:  "selection_based",
      consistencyCheck: "PASS",
    },
  };
}

function compactScoringDiagnosticsForApi(raw: unknown): Record<string, unknown> | null {
  const diagnostics = raw as Record<string, unknown> | null | undefined;
  if (!diagnostics || typeof diagnostics !== "object") return null;
  const scoring = diagnostics["scoring"] as Record<string, unknown> | undefined;
  return {
    scoring: scoring
      ? {
          mode: scoring["mode"] ?? null,
          poolSize: scoring["poolSize"] ?? null,
          hybridPoolSize: scoring["hybridPoolSize"] ?? null,
          excludedCount: scoring["excludedCount"] ?? null,
        }
      : null,
    coverage: diagnostics["coverage"] ?? null,
    stability: diagnostics["stability"] ?? null,
    retrievalCompletionSafety: diagnostics["retrievalCompletionSafety"] ?? null,
    semanticResolution: diagnostics["semanticResolution"] ?? null,
    v3Pipeline: formatV3DiagnosticsForApi(diagnostics["v3Pipeline"], ""),
  };
}

function buildPromptDriftAudit(diagnostics: Record<string, unknown> | null): Record<string, unknown> {
  const quality = diagnostics?.["playlistQuality"] as Record<string, unknown> | null | undefined;
  const contractGuard = diagnostics?.["intentContractGuard"] as Record<string, unknown> | null | undefined;
  const genrePurity = typeof quality?.["genrePurity"] === "number" ? quality["genrePurity"] : null;
  const promptAlignment = typeof quality?.["promptAlignment"] === "number" ? quality["promptAlignment"] : null;
  const guardedCount = typeof contractGuard?.["guardedCount"] === "number" ? contractGuard["guardedCount"] : null;
  const inputCount = typeof contractGuard?.["inputCount"] === "number" ? contractGuard["inputCount"] : null;
  const violations = [
    genrePurity != null && genrePurity < 0.65 ? "genre_purity_below_threshold" : null,
    promptAlignment != null && promptAlignment < 0.60 ? "prompt_alignment_below_threshold" : null,
    inputCount != null && guardedCount === 0 ? "intent_contract_eliminated_pool" : null,
  ].filter((value): value is string => !!value);
  return {
    pass: violations.length === 0,
    violations,
    genrePurity,
    promptAlignment,
    guardedCount,
    inputCount,
  };
}

function hasValidCachedIntent(cached: {
  v3Diagnostics?: Record<string, unknown> | null;
  finalTracks?: Array<{ genrePrimary?: string | null }>;
}): boolean {
  const diagnostics = cached.v3Diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return false;
  const intent = diagnostics["intentDecomposition"] as Record<string, unknown> | undefined;
  const hasIntent = typeof intent?.["primary"] === "string" && intent["primary"].trim().length > 0;
  if (!hasIntent) return false;
  const tracks = cached.finalTracks ?? [];
  if (tracks.length === 0) return false;
  const genrePresent = tracks.filter((track) => !!track.genrePrimary).length;
  return genrePresent / tracks.length >= 0.75;
}

function incrementDistribution(acc: Record<string, number>, key: string | null | undefined): Record<string, number> {
  const label = key || "(missing)";
  acc[label] = (acc[label] ?? 0) + 1;
  return acc;
}

function eraBucket(releaseYear: number | null | undefined): string {
  if (!releaseYear || releaseYear < 1900) return "unknown";
  return `${Math.floor(releaseYear / 10) * 10}s`;
}

function energyBucket(energy: number | null | undefined): string {
  if (typeof energy !== "number") return "unknown";
  if (energy < 0.33) return "low";
  if (energy < 0.66) return "medium";
  return "high";
}

function moodBucket(energy: number | null | undefined, valence: number | null | undefined): string {
  if (typeof energy !== "number" || typeof valence !== "number") return "unknown";
  if (energy >= 0.66 && valence >= 0.55) return "upbeat";
  if (energy >= 0.66 && valence < 0.45) return "intense";
  if (energy < 0.4 && valence >= 0.55) return "warm";
  if (energy < 0.4 && valence < 0.45) return "melancholic";
  return "balanced";
}

function eraDiagnosticSample<T extends {
  trackName?: string | null;
  artistName?: string | null;
  releaseYear?: number | null;
}>(tracks: T[]) {
  return tracks.slice(0, 12).map((track) => ({
    trackName: track.trackName ?? null,
    artistName: track.artistName ?? null,
    releaseYear: track.releaseYear ?? null,
  }));
}

function libraryFingerprint(tracks: Array<{
  trackId: string;
  createdAt?: Date | string | null;
  addedAt?: Date | string | null;
}>): string {
  let newest = 0;
  const ids: string[] = [];
  for (const track of tracks) {
    ids.push(track.trackId);
    const createdMs = track.createdAt ? new Date(track.createdAt).getTime() : 0;
    const addedMs = track.addedAt ? new Date(track.addedAt).getTime() : 0;
    newest = Math.max(newest, Number.isFinite(createdMs) ? createdMs : 0, Number.isFinite(addedMs) ? addedMs : 0);
  }
  ids.sort();
  const sample = [
    ...ids.slice(0, 8),
    ...ids.slice(Math.max(0, Math.floor(ids.length / 2) - 4), Math.floor(ids.length / 2) + 4),
    ...ids.slice(-8),
  ].join(",");
  return `${tracks.length}:${newest}:${sample}`;
}

const FINAL_GUARD_GENRE_TERMS: Record<string, string[]> = {
  country: ["country", "americana", "red dirt", "outlaw country", "honky tonk", "bluegrass", "nashville", "country road"],
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

const FINAL_GUARD_KNOWN_ARTISTS: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /\b(?:luke\s+combs|morgan\s+wallen|chris\s+stapleton|zach\s+bryan|bailey\s+zimmerman|lainey\s+wilson|hardy|jelly\s+roll)\b/i, family: "country" },
  { pattern: /\b(?:tyler\s+childers|sturgill\s+simpson|jason\s+isbell|colter\s+wall|charley\s+crockett|turnpike\s+troubadours|whiskey\s+myers|flatland\s+cavalry)\b/i, family: "country" },
  { pattern: /\b(?:cody\s+johnson|cody\s+jinks|george\s+strait|johnny\s+cash|willie\s+nelson|dolly\s+parton|merle\s+haggard|waylon\s+jennings)\b/i, family: "country" },
  { pattern: /\b(?:kacey\s+musgraves|shania\s+twain|carrie\s+underwood|alan\s+jackson|garth\s+brooks|brooks\s*&\s*dunn|reba\s+mcentire|toby\s+keith)\b/i, family: "country" },
  { pattern: /\b(?:billy\s+strings|alison\s+krauss|sierra\s+ferrell|red\s+clay\s+strays|treaty\s+oak\s+revival|49\s+winchester|sam\s+barber)\b/i, family: "country" },
  { pattern: /\bnas\b/i, family: "hip_hop" },
  { pattern: /\bxxxtentacion\b/i, family: "hip_hop" },
  { pattern: /\bbob\s+marley\b/i, family: "reggae" },
  { pattern: /\bthe\s+doors\b/i, family: "rock" },
  { pattern: /\bblondie\b/i, family: "rock" },
  { pattern: /\btame\s+impala\b/i, family: "indie" },
  { pattern: /\beminem\b/i, family: "hip_hop" },
  { pattern: /\brockwell\b/i, family: "pop" },
];

const NO_LIBRARY_GENRE_SEARCH_TERMS: Record<string, string[]> = {
  country: [
    "genre:country",
    "country",
    "americana",
    "red dirt country",
    "outlaw country",
    "bluegrass",
    "zach bryan",
    "johnny cash",
  ],
  hip_hop: ["genre:hip-hop", "hip hop", "rap", "trap", "drill"],
  rock: ["genre:rock", "rock", "classic rock", "alternative rock", "indie rock"],
  electronic: ["genre:electronic", "electronic", "house", "techno", "uk garage"],
  rnb: ["r&b", "rnb", "neo soul", "slow jams"],
  pop: ["genre:pop", "pop", "dance pop"],
  reggae: ["reggae", "dancehall", "dub"],
  jazz: ["jazz", "bebop", "swing"],
  latin: ["latin", "reggaeton", "salsa"],
  metal: ["metal", "metalcore", "thrash"],
};

function noLibrarySearchQueries(vibe: string, families: string[], subgenreTerms: string[] = []): string[] {
  const cleanedVibe = vibe.trim();
  const eraTerms = extractEraRange(vibe).terms;
  const priorityQueries = new Set<string>();
  const expandedQueries = new Set<string>();
  const lower = cleanedVibe.toLowerCase();
  const controlledAliases = new Set<string>();
  const aliasSource = `${lower} ${subgenreTerms.join(" ").toLowerCase().replace(/_/g, " ")}`;
  if (/\b(?:tekk|tekno|schranz|hardgroove|industrial techno)\b/.test(aliasSource)) {
    ["hard techno", "schranz", "tekno", "techno"].forEach((term) => controlledAliases.add(term));
  }
  if (/\b(?:d\s*&\s*b|dnb|drum and bass|rollers?|liquid dnb|liquid drum and bass|jungle|old\s*skool jungle|old\s*school jungle|breakbeat hardcore)\b/.test(aliasSource)) {
    ["dnb rollers", "drum and bass rollers", "liquid drum and bass", "drum and bass", "jungle", "old school jungle", "jungle rollers", "breakbeat hardcore"].forEach((term) => controlledAliases.add(term));
  }
  if (cleanedVibe) priorityQueries.add(cleanedVibe);
  for (const subgenre of [...subgenreTerms, ...controlledAliases]) {
    const term = subgenre.replace(/_/g, " ").trim();
    if (!term) continue;
    priorityQueries.add(term);
    if (cleanedVibe && !cleanedVibe.toLowerCase().includes(term.toLowerCase())) {
      expandedQueries.add(`${cleanedVibe} ${term}`);
    }
    for (const era of eraTerms) {
      expandedQueries.add(`${era} ${term}`);
    }
  }
  for (const family of families) {
    for (const term of NO_LIBRARY_GENRE_SEARCH_TERMS[family] ?? [family.replace(/_/g, " ")]) {
      priorityQueries.add(term);
      if (cleanedVibe && !cleanedVibe.toLowerCase().includes(term.toLowerCase())) {
        expandedQueries.add(`${cleanedVibe} ${term}`);
      }
      for (const era of eraTerms) {
        expandedQueries.add(`${era} ${term}`);
      }
    }
  }
  return [...priorityQueries, ...expandedQueries].slice(0, 24);
}

type RetrievalCompletionDiagnostics = {
  retrievalBlockingReason: string | null;
  unresolvedProviders: string[];
  retrievalWaitTimePerSource: Record<string, number>;
  usedPartialRetrieval: boolean;
  retrievalPartialCompletion: boolean;
  candidatePoolSizeAtUnblock: number;
  minViablePool: number;
  emptyPoolDetectedAtStage?: string | null;
  fallbackDepthReached?: number;
  fallbackExpansionPath?: string[];
  finalPoolSizeAtScoringEntry?: number;
  retrievalFatalEmptyPool?: boolean;
};

type TimedRetrievalSource<T> = {
  value: T;
  elapsedMs: number;
  timedOut: boolean;
  failed: boolean;
};

function defaultRetrievalCompletionDiagnostics(minViablePool: number): RetrievalCompletionDiagnostics {
  return {
    retrievalBlockingReason: null,
    unresolvedProviders: [],
    retrievalWaitTimePerSource: {},
    usedPartialRetrieval: false,
    retrievalPartialCompletion: false,
    candidatePoolSizeAtUnblock: 0,
    minViablePool,
    emptyPoolDetectedAtStage: null,
    fallbackDepthReached: 0,
    fallbackExpansionPath: [],
    finalPoolSizeAtScoringEntry: 0,
    retrievalFatalEmptyPool: false,
  };
}

async function timeboxRetrievalSource<T>(
  source: string,
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<TimedRetrievalSource<T>> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const guarded = promise
    .then((value) => ({
      value,
      elapsedMs: Date.now() - startedAt,
      timedOut: false,
      failed: false,
    }))
    .catch(() => ({
      value: fallback,
      elapsedMs: Date.now() - startedAt,
      timedOut: false,
      failed: true,
    }));
  const timeout = new Promise<TimedRetrievalSource<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        value: fallback,
        elapsedMs: Date.now() - startedAt,
        timedOut: true,
        failed: false,
      });
    }, timeoutMs);
  });
  const result = await Promise.race([guarded, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

async function buildNoLibrarySpotifyCandidates(opts: {
  accessToken: string;
  userId: string;
  vibe: string;
  length: number;
  families: string[];
  subgenreTerms?: string[];
}): Promise<{
  tracks: Array<typeof likedSongsTable.$inferSelect>;
  diagnostics: RetrievalCompletionDiagnostics;
}> {
  const minViablePool = Math.min(120, Math.max(50, opts.length * 2));
  const diagnostics = defaultRetrievalCompletionDiagnostics(minViablePool);
  const maxTracks = Math.max(80, opts.length * 3);
  const searchResult = await timeboxRetrievalSource(
    "spotifySearch",
    searchSpotifyTracks(
      opts.accessToken,
      noLibrarySearchQueries(opts.vibe, opts.families, opts.subgenreTerms),
      maxTracks,
      {
        userKey: opts.userId,
        bestEffort: true,
        minTracks: minViablePool,
        maxElapsedMs: 5_000,
        maxRetries: 0,
        requestTimeoutMs: 2_500,
      }
    ),
    6_000,
    []
  );
  diagnostics.retrievalWaitTimePerSource.spotifySearch = searchResult.elapsedMs;
  let rawTracks = searchResult.value;
  const searchWindowElapsed = searchResult.elapsedMs >= 4_900 && rawTracks.length < maxTracks;
  if (searchResult.timedOut || searchResult.failed || searchWindowElapsed) {
    diagnostics.unresolvedProviders.push("spotifySearch");
  }
  if (rawTracks.length === 0 && (opts.subgenreTerms?.length ?? 0) > 0) {
    diagnostics.emptyPoolDetectedAtStage = "spotify_search_strict";
    diagnostics.fallbackDepthReached = 1;
    const familySearchResult = await timeboxRetrievalSource(
      "spotifyFamilySearch",
      searchSpotifyTracks(
        opts.accessToken,
        noLibrarySearchQueries(opts.vibe, opts.families, []),
        maxTracks,
        {
          userKey: opts.userId,
          bestEffort: true,
          minTracks: minViablePool,
          maxElapsedMs: 5_000,
          maxRetries: 0,
          requestTimeoutMs: 2_500,
        }
      ),
      6_000,
      []
    );
    diagnostics.retrievalWaitTimePerSource.spotifyFamilySearch = familySearchResult.elapsedMs;
    if (familySearchResult.timedOut || familySearchResult.failed) diagnostics.unresolvedProviders.push("spotifyFamilySearch");
    rawTracks = familySearchResult.value;
    diagnostics.fallbackExpansionPath?.push(`family:${rawTracks.length}`);
  }
  if (rawTracks.length === 0) {
    diagnostics.emptyPoolDetectedAtStage = diagnostics.emptyPoolDetectedAtStage ?? "spotify_search_family";
    diagnostics.fallbackDepthReached = Math.max(diagnostics.fallbackDepthReached ?? 0, 2);
    const broadQueries = [
      ...opts.families.map((family) => family.replace(/_/g, " ")),
      ...opts.families.map((family) => `popular ${family.replace(/_/g, " ")}`),
      "popular music",
    ];
    const broadSearchResult = await timeboxRetrievalSource(
      "spotifyBroadSearch",
      searchSpotifyTracks(
        opts.accessToken,
        broadQueries,
        maxTracks,
        {
          userKey: opts.userId,
          bestEffort: true,
          minTracks: minViablePool,
          maxElapsedMs: 5_000,
          maxRetries: 0,
          requestTimeoutMs: 2_500,
        }
      ),
      6_000,
      []
    );
    diagnostics.retrievalWaitTimePerSource.spotifyBroadSearch = broadSearchResult.elapsedMs;
    if (broadSearchResult.timedOut || broadSearchResult.failed) diagnostics.unresolvedProviders.push("spotifyBroadSearch");
    rawTracks = broadSearchResult.value;
    diagnostics.fallbackExpansionPath?.push(`global:${rawTracks.length}`);
  }
  diagnostics.candidatePoolSizeAtUnblock = rawTracks.length;
  diagnostics.finalPoolSizeAtScoringEntry = rawTracks.length;
  if (rawTracks.length === 0) {
    diagnostics.retrievalBlockingReason = "empty_candidate_pool_after_timeboxed_retrieval";
    diagnostics.usedPartialRetrieval = searchResult.timedOut || searchResult.failed;
    diagnostics.retrievalPartialCompletion = diagnostics.usedPartialRetrieval;
    diagnostics.emptyPoolDetectedAtStage = diagnostics.emptyPoolDetectedAtStage ?? "spotify_search";
    diagnostics.retrievalFatalEmptyPool = true;
    return { tracks: [], diagnostics };
  }
  if (rawTracks.length >= minViablePool && (searchResult.timedOut || searchResult.failed || searchWindowElapsed)) {
    diagnostics.retrievalBlockingReason = "min_viable_pool_reached_before_all_sources_completed";
  } else if (rawTracks.length < minViablePool) {
    diagnostics.retrievalBlockingReason = "retrieval_timebox_elapsed_below_min_viable_pool";
  }

  const [artistGenreResult, albumMetadataResult, audioFeaturesResult] = await Promise.all([
    timeboxRetrievalSource(
      "artistGenres",
      fetchArtistGenres(
        opts.accessToken,
        rawTracks.flatMap((track) => track.artists.map((artist) => artist.id).filter((id): id is string => !!id)),
        { userKey: opts.userId, maxRetries: 0, requestTimeoutMs: 2_500 }
      ),
      3_500,
      new Map<string, string[]>()
    ),
    timeboxRetrievalSource(
      "albumMetadata",
      fetchAlbumMetadata(
        opts.accessToken,
        rawTracks.map((track) => track.album.id).filter((id): id is string => !!id),
        { userKey: opts.userId, maxRetries: 0, requestTimeoutMs: 2_500 }
      ),
      3_500,
      new Map()
    ),
    timeboxRetrievalSource(
      "audioFeatures",
      fetchAudioFeatures(
        opts.accessToken,
        rawTracks.map((track) => track.id),
        { userKey: opts.userId, maxRetries: 0, requestTimeoutMs: 2_500 }
      ),
      3_500,
      []
    ),
  ]);
  diagnostics.retrievalWaitTimePerSource.artistGenres = artistGenreResult.elapsedMs;
  diagnostics.retrievalWaitTimePerSource.albumMetadata = albumMetadataResult.elapsedMs;
  diagnostics.retrievalWaitTimePerSource.audioFeatures = audioFeaturesResult.elapsedMs;
  for (const [source, result] of [
    ["artistGenres", artistGenreResult],
    ["albumMetadata", albumMetadataResult],
    ["audioFeatures", audioFeaturesResult],
  ] as const) {
    if (result.timedOut || result.failed) diagnostics.unresolvedProviders.push(source);
  }
  diagnostics.usedPartialRetrieval = diagnostics.unresolvedProviders.length > 0 || rawTracks.length < minViablePool;
  diagnostics.retrievalPartialCompletion = diagnostics.usedPartialRetrieval;
  const artistGenreMap = artistGenreResult.value;
  const albumMetadataMap = albumMetadataResult.value;
  const audioFeatures = audioFeaturesResult.value;
  const featuresById = new Map(audioFeatures.map((features) => [features.id, features]));
  const now = new Date();

  const tracks = rawTracks.map((track, index) => {
    const enriched = enrichTrackMetadata(track, artistGenreMap, albumMetadataMap);
    const features = featuresById.get(track.id);
    return {
      id: -1 - index,
      spotifyUserId: opts.userId,
      trackId: enriched.id,
      trackName: enriched.name,
      artistName: enriched.artists[0]?.name ?? "Unknown",
      albumName: enriched.album.name,
      albumArt: enriched.album.images[0]?.url ?? null,
      durationMs: enriched.duration_ms,
      energy: features?.energy ?? null,
      valence: features?.valence ?? null,
      tempo: features?.tempo ?? null,
      danceability: features?.danceability ?? null,
      acousticness: features?.acousticness ?? null,
      instrumentalness: features?.instrumentalness ?? null,
      loudness: features?.loudness ?? null,
      speechiness: features?.speechiness ?? null,
      spotifyArtistGenres: enriched.spotifyArtistGenres,
      albumGenres: enriched.albumGenres,
      popularity: enriched.popularity ?? null,
      releaseYear: enriched.releaseYear ?? null,
      addedAt: now,
      createdAt: now,
    };
  });
  return { tracks, diagnostics };
}

function hasFinalGenreEvidence(
  track: {
    trackId: string;
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
  },
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
    diagnostics?: {
      taxonomyHit?: boolean;
      artistHintMatched?: string | null;
      patternMatched?: string | null;
      audioFallbackUsed?: boolean;
    };
  }>,
  expectedFamilies: string[],
  opts: { allowSpotifyMetadataEvidence?: boolean } = {},
): boolean {
  if (expectedFamilies.length === 0) return true;
  const classification = classMap.get(track.trackId);
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
    expectedFamilies.includes(classification.genreFamily) &&
    cachedDiagnostics?.audioFallbackUsed !== true &&
    cachedDiagnostics?.patternMatched !== "spotify_genre_metadata";
  const cachedHasExpectedFamily =
    !!classification &&
    expectedFamilies.includes(classification.genreFamily) &&
    cachedDiagnostics?.audioFallbackUsed !== true &&
    cachedDiagnostics?.patternMatched !== "spotify_genre_metadata";
  const candidateClassification =
    cachedHasLocalEvidence
      ? classification
      : localClassification;
  if (cachedHasExpectedFamily) return true;
  if (opts.allowSpotifyMetadataEvidence) {
    const metadataGenres = [
      ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres : []),
      ...(Array.isArray(track.albumGenres) ? track.albumGenres : []),
    ].filter((value): value is string => typeof value === "string");
    if (metadataGenres.some((genre) => {
      const family = getGenreFamily(genre.toLowerCase().trim().replace(/&/g, "and").replace(/[\s-]+/g, "_"));
      return !!family && expectedFamilies.includes(family);
    })) {
      return true;
    }
  }
  if (!candidateClassification || !expectedFamilies.includes(candidateClassification.genreFamily)) {
    const known = FINAL_GUARD_KNOWN_ARTISTS.find((entry) => entry.pattern.test(track.artistName ?? ""));
    return !!known && expectedFamilies.includes(known.family);
  }
  const diagnostics = candidateClassification.diagnostics;
  if (
    diagnostics?.taxonomyHit === true &&
    diagnostics.audioFallbackUsed !== true &&
    diagnostics.patternMatched !== "spotify_genre_metadata" &&
    (!!diagnostics.artistHintMatched || !!diagnostics.patternMatched)
  ) {
    return true;
  }

  const blob = `${track.trackName ?? ""} ${track.artistName ?? ""} ${track.albumName ?? ""}`.toLowerCase();
  return expectedFamilies.some((family) =>
    (FINAL_GUARD_GENRE_TERMS[family] ?? []).some((term) => blob.includes(term))
  );
}

function explicitGenreFallbackFailure(opts: {
  vibe: string;
  requestedCount: number;
  finalCount: number;
  hasGenreAwarePool: boolean;
  noLibraryMode?: boolean;
}): { code: string; error: string; details: Record<string, unknown> } | null {
  const expectedFamilies = buildCsspLockedIntent(opts.vibe).genreFamilies;
  if (expectedFamilies.length === 0) return null;
  if (opts.finalCount <= 0) {
    return {
      code: "INSUFFICIENT_VERIFIED_GENRE_EVIDENCE",
      error: opts.noLibraryMode
        ? `I could not find enough verified ${expectedFamilies.join("/")} tracks from Spotify search to make this playlist without guessing.`
        : `I could not find enough verified ${expectedFamilies.join("/")} tracks in your synced library to make this playlist without guessing.`,
      details: {
        expectedFamilies,
        requestedCount: opts.requestedCount,
        finalCount: opts.finalCount,
        requiredCount: 1,
        requiredRatio: STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
        fallbackBlocked: true,
        noLibraryMode: !!opts.noLibraryMode,
      },
    };
  }

  const requiredCount = Math.min(
    opts.finalCount,
    Math.max(1, Math.ceil(opts.finalCount * STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO))
  );
  if (opts.hasGenreAwarePool && opts.finalCount >= requiredCount) return null;

  return {
    code: "INSUFFICIENT_VERIFIED_GENRE_EVIDENCE",
    error: opts.noLibraryMode
      ? `I could not find enough verified ${expectedFamilies.join("/")} tracks from Spotify search to make this playlist without guessing.`
      : `I could not find enough verified ${expectedFamilies.join("/")} tracks in your synced library to make this playlist without guessing.`,
    details: {
      expectedFamilies,
      requestedCount: opts.requestedCount,
      finalCount: opts.finalCount,
      requiredCount,
      requiredRatio: STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
      fallbackBlocked: true,
      noLibraryMode: !!opts.noLibraryMode,
    },
  };
}

router.get("/generate/status", (req, res): void => {
  const userId = currentGenerateUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json(getGenerateStatus(userId));
});

router.post("/generate/cancel", (req, res): void => {
  const userId = currentGenerateUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const status = getGenerateStatus(userId);
  if (status.active && status.requestId) {
    cancelGenerateSession(userId, status.requestId);
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json({
    success: true,
    cancelled: status.active,
    requestId: status.requestId,
  });
});

/**
 * GET /generate/preview?vibe=...
 * Lightweight scene detection endpoint for the live preview panel.
 * Returns scene, confidence, alternatives, era, and emotion profile
 * without touching the library or Spotify — used while the user is typing.
 */
router.get("/generate/preview", (req, res): void => {
  if (!useMockSpotify() && !req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const vibe = typeof req.query.vibe === "string" ? req.query.vibe.trim() : "";
  if (!vibe || vibe.length < 3) {
    res.json({ scene: null, confidence: 0, alternatives: [], era: null, emotion: null });
    return;
  }

  try {
    // Run scene detection + era detection synchronously (both are fast regex/rule-based)
    const { profile, journeyArc } = analyzeVibeWithContext(vibe);
    const sceneResolution = resolveSemanticScene(vibe, profile);
    const eraCtx = detectEra(vibe);

    // Build primary genre list from scene ecosystem (top 4 by weight)
    const primaryGenres = sceneResolution.vector
      ? sceneResolution.vector.genreEcosystem
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 4)
          .map((g) => g.genre)
      : [];

    res.json({
      scene: sceneResolution.matchedId
        ? {
            id: sceneResolution.matchedId,
            label: sceneResolution.vector?.label ?? sceneResolution.matchedId,
            confidence: sceneResolution.confidence,
            energy: sceneResolution.vector?.energy ?? null,
            aesthetics: sceneResolution.vector?.aesthetics?.slice(0, 4) ?? [],
            primaryGenres,
          }
        : null,
      alternatives: sceneResolution.alternatives,
      era: eraCtx.decade ? { decade: eraCtx.decade, confidence: eraCtx.eraConfidence } : null,
      emotion: {
        energy: profile.energy,
        valence: profile.valence,
        nostalgia: profile.nostalgia,
        tension: profile.tension,
        calm: profile.calm,
      },
      journeyArc: journeyArc ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: "Preview analysis failed" });
  }
});

// SYSTEM GUARANTEE:
// Backend generates candidates only.
// Request layer performs evaluation, regeneration, and selection.
// Frontend supplies behavioural feedback signals.
// Long-term learning is driven by implicit + explicit feedback loops.
router.post("/generate", async (req, res): Promise<void> => {
  const startMs = Date.now();
  let requestId = "";
  let sessionUserId = "";
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let hardTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let clientDisconnected = false;
  let cleanupClientDisconnectListeners: (() => void) | null = null;
  let requestHardTimeoutMs = REQUEST_HARD_TIMEOUT_MS;
  try {
    const devMode = useMockSpotify();
    const rawBody = req.body ?? {};
    const auditModeRequested = rawBody.auditMode === true || req.query.audit === "1";
    const auditTokenAuthorized = auditModeRequested && generationAuditTokenAuthorized(req);
    const auditMode = auditModeRequested && auditTokenAuthorized;
    const sideEffectPolicy = auditMode ? AUDIT_SIDE_EFFECT_POLICY : PRODUCTION_SIDE_EFFECT_POLICY;
    requestHardTimeoutMs = REQUEST_HARD_TIMEOUT_MS;
    if (auditMode) beginSpotifyApiAudit();
    const auditUserIdRaw = typeof rawBody.spotifyUserId === "string"
      ? rawBody.spotifyUserId.trim()
      : typeof rawBody.auditSpotifyUserId === "string"
        ? rawBody.auditSpotifyUserId.trim()
        : "";

    if (auditModeRequested && !auditMode) {
      generateFail(
        res,
        403,
        "AUDIT_MODE_NOT_AUTHORIZED",
        "Playlist evaluation audit mode requires PLAYLIST_EVAL_TOKEN.",
      );
      return;
    }
    if (!devMode && !auditMode && !getFeatures().spotify.enabled) {
      generateFail(res, 503, "SPOTIFY_DISABLED", "Spotify is not configured on this server.");
      return;
    }
    if (!devMode && !auditMode && (!req.session.spotifyTokens || !req.session.spotifyUserId)) {
      generateFail(res, 401, "NOT_AUTHENTICATED", "Not authenticated");
      return;
    }
    if (!devMode && auditTokenAuthorized && !auditUserIdRaw) {
      generateFail(
        res,
        400,
        "AUDIT_USER_REQUIRED",
        "Audit mode with PLAYLIST_EVAL_TOKEN requires spotifyUserId in the request body.",
      );
      return;
    }

    if (isShuttingDown()) {
      generateFail(
        res,
        503,
        "SERVER_RESTARTING",
        "Server is updating — wait about 30 seconds, then try again."
      );
      return;
    }

    const userId = devMode
      ? MOCK_SPOTIFY_USER_ID
      : auditTokenAuthorized
        ? auditUserIdRaw
        : req.session.spotifyUserId!;
    const generateSessionUserId = auditMode
      ? `${userId}:audit:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
      : userId;

    if (!sideEffectPolicy.bypassRateLimit) {
    const rateCheck = checkRateLimit(userId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rateCheck.allowed) {
      const retryAfterSec = Math.ceil(rateCheck.resetInMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      generateFail(
        res,
        429,
        "RATE_LIMITED",
        `Too many requests. Please wait ${retryAfterSec}s before generating again.`,
        { retry_after: retryAfterSec }
      );
      return;
      }
    }

    const vibeRaw = rawBody.vibe ?? "";
    const modeRaw = rawBody.mode ?? "balanced";
    const lengthRaw = rawBody.length ?? 25;
    const referencePlaylistRaw =
      typeof rawBody.referencePlaylist === "string" ? rawBody.referencePlaylist.trim() : "";
    const parsedLength =
      typeof lengthRaw === "string" ? parseInt(lengthRaw, 10) : Number(lengthRaw);

    const varietyBoostRequested = rawBody.varietyBoost === true;
    const noLibraryModeRequested = rawBody.noLibraryMode === true;
    const moodSceneRaw =
      typeof rawBody.sceneId === "string"
        ? rawBody.sceneId.trim()
        : typeof rawBody.filmScene === "string"
          ? rawBody.filmScene.trim()
          : "";

    const payload = {
      vibe: (typeof vibeRaw === "string" ? vibeRaw.trim() : String(vibeRaw).trim()) || "balanced",
      mode: (["strict", "balanced", "chaotic"] as const).includes(modeRaw) ? modeRaw : "balanced",
      length: isNaN(parsedLength) || parsedLength <= 0 ? 25 : parsedLength,
      ...(referencePlaylistRaw ? { referencePlaylist: referencePlaylistRaw } : {}),
      ...(varietyBoostRequested ? { varietyBoost: true } : {}),
      ...(moodSceneRaw ? { sceneId: moodSceneRaw } : {}),
      ...(noLibraryModeRequested ? { noLibraryMode: true } : {}),
    };

    const parsed = GeneratePlaylistBody.safeParse(payload);
    if (!parsed.success) {
      req.log.warn({ errors: parsed.error.message, rawBody }, "Invalid generate request");
      generateFail(res, 400, "INVALID_REQUEST", parsed.error.message);
      return;
    }

    const { vibe, mode, length, referencePlaylist, varietyBoost, sceneId, noLibraryMode } = parsed.data;
    const moodSceneId = sceneId?.trim() || null;
    const noLibraryParsedIntent = noLibraryMode ? buildCsspLockedIntent(vibe) : null;
    const noLibraryExplicitFamilies = noLibraryParsedIntent?.genreFamilies ?? [];
    if (noLibraryMode && noLibraryExplicitFamilies.length === 0) {
      generateFail(
        res,
        400,
        "NO_LIBRARY_REQUIRES_GENRE",
        "No Library Mode needs a clear genre prompt so Spotify-wide search can stay on target. Try adding a genre like pop punk, country, UK garage, house, or indie rock.",
        {
          hint: "Use normal mode for mood-only prompts, or keep No Library Mode on and add a genre.",
          noLibrarySpotify: {
            searched: false,
            fallbackUsed: false,
            fallbackReason: "missing_explicit_genre",
          },
        }
      );
      return;
    }

    const acquired = acquireGenerateSession(generateSessionUserId);
    if (!acquired) {
      req.log.info({ userId, code: "GENERATION_IN_PROGRESS" }, "Rejected duplicate generate");
      generateFail(
        res,
        409,
        "GENERATION_IN_PROGRESS",
        "A playlist is already being generated. Wait for it to finish or try again in a moment."
      );
      return;
    }
    requestId = acquired;
    sessionUserId = generateSessionUserId;
    const deadlineAt = startMs + requestHardTimeoutMs;
    const generationShouldAbort = (): boolean => {
      if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return true;
      if (Date.now() >= deadlineAt - 2_000) {
        cancelGenerateSession(generateSessionUserId, requestId);
        return true;
      }
      return false;
    };
    const markClientDisconnected = (): void => {
      if (clientDisconnected) return;
      clientDisconnected = true;
      cancelGenerateSession(generateSessionUserId, requestId);
      req.log.warn({ userId, requestId }, "Generate request client disconnected — cancelling session");
    };
    const onRequestAborted = (): void => markClientDisconnected();
    const onResponseClose = (): void => {
      if (!res.writableEnded) markClientDisconnected();
    };
    req.once("aborted", onRequestAborted);
    res.once("close", onResponseClose);
    cleanupClientDisconnectListeners = () => {
      req.off("aborted", onRequestAborted);
      res.off("close", onResponseClose);
    };
    const timeoutAfterMs = Math.max(1, deadlineAt - Date.now());
    hardTimeoutTimer = setTimeout(() => {
      if (responseFinished(res)) return;
      const progressBeforeCancel = getGenerateProgress(generateSessionUserId);
      cancelGenerateSession(generateSessionUserId, requestId);
      req.log.error(
        {
          userId,
          requestId,
          elapsedMs: Date.now() - startMs,
          phase: progressBeforeCancel?.phase ?? "unknown",
          stage: progressBeforeCancel?.stage ?? null,
          code: "TIMEOUT",
        },
        "Generate absolute watchdog timeout"
      );
      res.status(504).json({
        success: false,
        error: "Generation took too long before a safe playlist could be built. Try again with a slightly broader prompt, or sync your Spotify library and retry.",
        code: "TIMEOUT",
        tracks: [],
        generationDiagnostics: {
          recoveryTriggered: false,
          fallbackLevel: "none",
          sessionCancelled: true,
          failureReason: "absolute_watchdog_timeout_before_safe_fallback",
          requestId,
          elapsedMs: Date.now() - startMs,
          lastPhase: progressBeforeCancel?.phase ?? null,
          lastStage: progressBeforeCancel?.stage ?? null,
        },
      });
    }, timeoutAfterMs);
    hardTimeoutTimer.unref?.();
    setGeneratePhase(generateSessionUserId, requestId, "starting");
    req.log.info({ elapsedMs: 0, trackCount: 0, cacheHit: false }, "Generation started");
    heartbeatTimer = setInterval(() => {
      const progress = getGenerateProgress(generateSessionUserId);
      req.log.info(
        {
          requestId,
          ms: Date.now() - startMs,
          phase: progress?.phase ?? "unknown",
        },
        "Generate in progress"
      );
    }, 15_000);

    let genStageTimer: ReturnType<typeof createGenerateStageTimer> | null = null;
    const preV3Timing = createPreV3Timing();

    try {

    let tStage = Date.now();
    const mixedEmotions = detectMixedEmotions(vibe);
    const destParse = parseEmotionalDestination(vibe);

    let emotionProfile: EmotionProfile;
    let experienceScene: ReturnType<typeof analyzeVibeWithContext>["experienceScene"] = null;
    let sceneJourneyArc: ReturnType<typeof analyzeVibeWithContext>["journeyArc"] | null = null;
    let momentPipeline: ReturnType<typeof analyzeMomentPipeline> | null = null;
    try {
      momentPipeline = analyzeMomentPipeline(vibe, { moodSceneId });
      emotionProfile = momentPipeline.profile;
      experienceScene = momentPipeline.experienceScene;
      sceneJourneyArc = momentPipeline.journeyArc;
      req.log.info(
        {
          elapsedMs: Date.now() - startMs,
          canonicalScene: momentPipeline.canonicalScene?.sceneId,
          intent: momentPipeline.intent.intent,
          hasExperienceScene: !!experienceScene,
          journeyArc: sceneJourneyArc ?? null,
        },
        "Emotion profile computed"
      );
    } catch (emotionErr) {
      req.log.error({ err: emotionErr }, "Emotion engine failed — using neutral fallback");
      emotionProfile = { ...NEUTRAL_PROFILE };
    }
    recordPreV3Timing(preV3Timing, "moodIntentTimeMs", Date.now() - tStage);

    let referenceFingerprint: ReferenceFingerprint | null = null;
    let referencePlaylistId: string | null = null;

    if (referencePlaylist && !devMode && req.session.spotifyTokens) {
      tStage = Date.now();
      try {
        const tokens = await getValidAccessToken(req.session.spotifyTokens!);
        const loaded = await loadReferenceFingerprint(tokens.accessToken, referencePlaylist);
        if (loaded) {
          referenceFingerprint = loaded.fingerprint;
          referencePlaylistId = loaded.playlistId;
          const refProfile = fingerprintToEmotionProfile(referenceFingerprint);
          const refWeight = mode === "strict" ? 0.65 : mode === "balanced" ? 0.55 : 0.42;
          emotionProfile = blendEmotionProfiles(emotionProfile, refProfile, refWeight);
          req.log.info(
            {
              referencePlaylistId,
              sampleCount: referenceFingerprint.sampleCount,
              refValence: referenceFingerprint.valence,
              refEnergy: referenceFingerprint.energy,
            },
            "Reference playlist fingerprint applied"
          );
        } else {
          req.log.warn({ referencePlaylist }, "Reference playlist had too few audio features");
        }
      } catch (refErr: any) {
        const refStatus = refErr?.response?.status;
        req.log.warn(
          { status: refStatus, referencePlaylist },
          "Reference playlist load failed — continuing with text vibe only"
        );
      }
      recordPreV3Timing(preV3Timing, "spotifyReferenceTimeMs", Date.now() - tStage);
    }

    const vibeKind = detectVibeKind(vibe, emotionProfile);
    const budget = createRequestBudget(startMs);
    const debugMode = req.query.debug === "1";
    const resultCacheBaseKey = getGenerateCacheKey({
      userId,
      vibe,
      vibeKind,
      mode,
      length,
      referencePlaylist: !!referencePlaylist,
      referencePlaylistKey: referencePlaylist ?? null,
      sceneId: moodSceneId,
      noLibraryMode: !!noLibraryMode,
      mockMode: devMode,
    });
    let resultCacheKey = resultCacheBaseKey;
    let cacheEntryStatus = getGenerateCacheEntryStatus(resultCacheKey);
    const cacheConstraintLayer = extractConstraintLayer(vibe, {
      primary: vibe,
      ...deriveDiagnosticTags(vibe),
      canonicalHints: canonicalCrossGenreHints(vibe),
    });

    setGeneratePhase(generateSessionUserId, requestId, "loading_library");
    setGenerateStageDetail(generateSessionUserId, requestId, "Scanning your liked songs...");
    tStage = Date.now();
    const cachedLikedRows = devMode ? null : getCachedLikedSongs(userId);
    const likedRowsRaw = devMode
      ? generateMockSpotifyLibrary()
      : cachedLikedRows ??
        await db
      .select()
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));
    if (!devMode && !cachedLikedRows) setCachedLikedSongs(userId, likedRowsRaw);
    const likedSongsQueryMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "likedSongsQueryMs", likedSongsQueryMs);
    recordPreV3Timing(preV3Timing, "dbTimeMs", likedSongsQueryMs);

    let { valid: likedSongs, dropped: droppedTracks } = sanitizeLikedSongs(likedRowsRaw);
    if (droppedTracks > 0) {
      req.log.warn({ droppedTracks, userId }, "Dropped invalid liked-song rows");
    }

    let noLibrarySpotifyCandidateCount = 0;
    let noLibrarySpotifyVerifiedCount = 0;
    let noLibrarySpotifyFallbackReason: string | null = null;
    let noLibraryRetrievalDiagnostics: RetrievalCompletionDiagnostics | null = null;
    if (!devMode && noLibraryMode && noLibraryExplicitFamilies.length > 0) {
      try {
        setGenerateStageDetail(generateSessionUserId, requestId, "Searching Spotify-wide candidates...");
        const freshTokens = await getValidAccessToken(req.session.spotifyTokens!, userId);
        if (freshTokens.accessToken !== req.session.spotifyTokens!.accessToken) {
          req.session.spotifyTokens = freshTokens;
        }
        const spotifyCandidateResult = await buildNoLibrarySpotifyCandidates({
          accessToken: freshTokens.accessToken,
          userId,
          vibe,
          length,
          families: noLibraryExplicitFamilies,
          subgenreTerms: noLibraryParsedIntent?.subgenreTerms ?? [],
        });
        const spotifyCandidates = spotifyCandidateResult.tracks;
        noLibraryRetrievalDiagnostics = spotifyCandidateResult.diagnostics;
        noLibrarySpotifyCandidateCount = spotifyCandidates.length;
        const verifiedSpotifyCandidates = spotifyCandidates.filter((track) =>
          hasFinalGenreEvidence(track, new Map(), noLibraryExplicitFamilies, { allowSpotifyMetadataEvidence: true })
        );
        noLibrarySpotifyVerifiedCount = verifiedSpotifyCandidates.length;
        const requiredVerifiedCandidates = Math.min(
          length,
          Math.max(10, Math.ceil(length * STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO))
        );
        if (verifiedSpotifyCandidates.length >= requiredVerifiedCandidates) {
          likedSongs = verifiedSpotifyCandidates;
          noLibrarySpotifyFallbackReason = null;
          req.log.info(
            {
              vibe,
              families: noLibraryExplicitFamilies,
              spotifyCandidateCount: spotifyCandidates.length,
              verifiedSpotifyCandidateCount: verifiedSpotifyCandidates.length,
              requiredVerifiedCandidates,
              retrievalCompletion: noLibraryRetrievalDiagnostics,
            },
            "No Library Mode using verified Spotify search candidates"
          );
        } else if (spotifyCandidates.length >= Math.min(20, length)) {
          likedSongs = spotifyCandidates;
          noLibrarySpotifyCandidateCount = spotifyCandidates.length;
          noLibrarySpotifyFallbackReason = "spotify_search_candidates_below_verified_threshold";
          req.log.warn(
            {
              vibe,
              families: noLibraryExplicitFamilies,
              spotifyCandidateCount: spotifyCandidates.length,
              verifiedSpotifyCandidateCount: verifiedSpotifyCandidates.length,
              requiredVerifiedCandidates,
              retrievalCompletion: noLibraryRetrievalDiagnostics,
            },
            "No Library Mode using unverified Spotify search pool; final guard will enforce genre evidence"
          );
        } else {
          noLibrarySpotifyFallbackReason = "spotify_search_too_few_candidates";
          req.log.warn(
            {
              vibe,
              families: noLibraryExplicitFamilies,
              spotifyCandidateCount: spotifyCandidates.length,
              verifiedSpotifyCandidateCount: verifiedSpotifyCandidates.length,
              requiredVerifiedCandidates,
              retrievalCompletion: noLibraryRetrievalDiagnostics,
            },
            "No Library Mode Spotify search returned too few candidates"
          );
          if (spotifyCandidates.length > 0) {
            likedSongs = spotifyCandidates;
          } else if (likedSongs.length > 0) {
            noLibrarySpotifyFallbackReason = "spotify_search_empty_using_synced_library_fallback";
            noLibraryRetrievalDiagnostics = {
              ...(noLibraryRetrievalDiagnostics ?? defaultRetrievalCompletionDiagnostics(Math.min(120, Math.max(50, length * 2)))),
              emptyPoolDetectedAtStage: noLibraryRetrievalDiagnostics?.emptyPoolDetectedAtStage ?? "spotify_search_final",
              finalPoolSizeAtScoringEntry: likedSongs.length,
              retrievalFatalEmptyPool: true,
            };
          } else {
            setGeneratePhase(generateSessionUserId, requestId, "error");
            generateFail(
              res,
              409,
              "NO_LIBRARY_SPOTIFY_POOL_EMPTY",
              "No Library Mode could not find usable Spotify-wide candidates for this prompt. Try a broader genre phrase or turn off No Library Mode.",
              {
                noLibrarySpotify: {
                  searched: true,
                  fallbackUsed: false,
                  fallbackReason: noLibrarySpotifyFallbackReason,
                  candidateCount: noLibrarySpotifyCandidateCount,
                  verifiedCount: noLibrarySpotifyVerifiedCount,
                  expectedFamilies: noLibraryExplicitFamilies,
                  retrievalCompletion: noLibraryRetrievalDiagnostics,
                },
              }
            );
            return;
          }
        }
      } catch (searchErr: any) {
        noLibrarySpotifyFallbackReason = "spotify_search_failed";
        req.log.warn(
          { err: searchErr?.message, vibe, families: noLibraryExplicitFamilies },
          "No Library Mode Spotify search failed"
        );
        setGeneratePhase(generateSessionUserId, requestId, "error");
        generateFail(
          res,
          503,
          "NO_LIBRARY_SPOTIFY_SEARCH_FAILED",
          "Spotify-wide search failed before No Library Mode could build a playlist. Please regenerate in a moment or turn off No Library Mode.",
          {
            noLibrarySpotify: {
              searched: true,
              fallbackUsed: false,
              fallbackReason: noLibrarySpotifyFallbackReason,
              candidateCount: noLibrarySpotifyCandidateCount,
              verifiedCount: noLibrarySpotifyVerifiedCount,
              expectedFamilies: noLibraryExplicitFamilies,
              retrievalCompletion: noLibraryRetrievalDiagnostics,
            },
          }
        );
        return;
      }
    }

    setGenerateStageDetail(
      generateSessionUserId,
      requestId,
      noLibraryMode
        ? `Analysing ${likedSongs.length.toLocaleString()} Spotify-wide candidates`
        : `Analysing ${likedSongs.length.toLocaleString()} liked songs`
    );

    if (likedSongs.length === 0) {
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (noLibraryMode) {
        generateFail(
          res,
          400,
          "LIBRARY_EMPTY_NO_LIBRARY_MODE",
          noLibraryExplicitFamilies.length > 0
            ? "No Library Mode could not find usable Spotify-wide candidates for this prompt. Try a broader genre phrase or regenerate in a moment."
            : "No Library Mode needs a clear genre prompt or a synced library fallback. Try a genre like country, rock, or UK garage."
        );
      } else {
        generateFail(
          res,
          400,
          "LIBRARY_EMPTY",
          "No liked songs found. Please sync your Spotify library first."
        );
      }
      return;
    }

    if (!noLibraryMode && likedSongs.length < 12) {
      setGeneratePhase(generateSessionUserId, requestId, "error");
      generateFail(
        res,
        400,
        "LIBRARY_TOO_SMALL",
        "Library is too small to generate. Sync more liked songs from Spotify first."
      );
      return;
    }

    resultCacheKey = `${resultCacheBaseKey}:${libraryFingerprint(likedSongs)}`;
    cacheEntryStatus = getGenerateCacheEntryStatus(resultCacheKey);
    if (sideEffectPolicy.mode === "production" && !debugMode && !varietyBoost && !devMode && !hasHardConstraints(cacheConstraintLayer)) {
      tStage = Date.now();
      const cached = getCachedGenerateResult(resultCacheKey);
      recordPreV3Timing(preV3Timing, "cacheTimeMs", Date.now() - tStage);
      const currentTrackIds = new Set(likedSongs.map((track) => track.trackId));
      const cacheInvalidReason = !cached
        ? null
        : cached.cacheVersion !== "v30"
          ? "cache_version_mismatch"
          : !hasValidCachedIntent(cached)
            ? "invalid_cached_intent"
            : !cached.finalTracks.length
              ? "empty_cached_tracks"
              : cached.finalTracks.some((track) => !track.trackId || !track.trackName || !track.artistName)
                ? "invalid_cached_track_payload"
                : cached.finalTracks.some((track) => !currentTrackIds.has(track.trackId))
                  ? "cached_track_missing_from_current_library"
                  : null;
      // Only use cache entries generated after strict validation and scoped to the current candidate library.
      if (cached && !cacheInvalidReason) {
        if (respondIfStale(res, generateSessionUserId, requestId)) return;
        setGeneratePhase(generateSessionUserId, requestId, "done");
        const cachedApiTracks = formatTracksForApi(cached.finalTracks, cached.emotionProfile);
        const cachedFinalGenreDistribution = cachedApiTracks.reduce<Record<string, number>>(
          (acc, track) => incrementDistribution(acc, track.genrePrimary ?? track.genreFamily ?? track.genres?.[0]),
          {},
        );
        const cachedFinalEraDistribution = cachedApiTracks.reduce<Record<string, number>>(
          (acc, track) => incrementDistribution(acc, eraBucket(track.releaseYear)),
          {},
        );
        const cachedFinalMoodDistribution = cachedApiTracks.reduce<Record<string, number>>(
          (acc, track) => incrementDistribution(acc, moodBucket(track.energy, track.valence)),
          {},
        );
        const cachedFinalEnergyDistribution = cachedApiTracks.reduce<Record<string, number>>(
          (acc, track) => incrementDistribution(acc, energyBucket(track.energy)),
          {},
        );
        req.log.info(
          {
            elapsedMs: Date.now() - startMs,
            cacheHit: true,
            cacheHitValid: true,
            cacheInvalidReason: null,
            trackCount: cached.finalTracks.length,
          },
          "Generation complete"
        );
        let cachedSavedPlaylistId: number | null = null;
        try {
          const [saved] = await db
            .insert(savedPlaylistsTable)
            .values({
              userId,
              name: cached.playlistName,
              emotionProfile: cached.emotionProfile as any,
              tracks: cached.finalTracks as any,
              spotifyUrl: cached.spotifyPlaylistUrl,
              vibe: cached.vibe,
              mode: cached.mode,
            })
            .returning({ id: savedPlaylistsTable.id });
          cachedSavedPlaylistId = saved?.id ?? null;
          if (cachedSavedPlaylistId) {
            await db.insert(playlistHistoryTable).values({
              spotifyUserId: userId,
              playlistId: cached.spotifyPlaylistUrl?.split("/").pop() ?? `kwalify-${cachedSavedPlaylistId}`,
              playlistUrl: cached.spotifyPlaylistUrl ?? publicUrl(`/p/${cachedSavedPlaylistId}`),
              name: cached.playlistName,
              vibe: cached.vibe,
              mode: cached.mode,
              trackCount: cachedApiTracks.length,
              emotionProfile: cached.emotionProfile as any,
              trackIds: cached.finalTracks.map((track) => track.trackId),
            });
          }
        } catch (cacheSaveErr) {
          req.log.warn({ err: cacheSaveErr, userId }, "Cached generation could not create local saved playlist");
        }
        res.json({
          success: true,
          cached: true,
          playlistId: cachedSavedPlaylistId,
          savedPlaylistId: cachedSavedPlaylistId,
          tracks: cachedApiTracks,
          playlistName: cached.playlistName,
          name: cached.playlistName,
          vibe: cached.vibe,
          mode: cached.mode,
          noLibraryMode: !!noLibraryMode,
          count: cachedApiTracks.length,
          totalTracks: cachedApiTracks.length,
          emotionProfile: cached.emotionProfile,
          cacheDiagnostics: { status: "fresh", staleBypassed: false, cacheHitValid: true, invalidReason: null },
          finalGenreDistribution: cachedFinalGenreDistribution,
          finalEraDistribution: cachedFinalEraDistribution,
          finalMoodDistribution: cachedFinalMoodDistribution,
          finalEnergyDistribution: cachedFinalEnergyDistribution,
          v3Diagnostics: cached.v3Diagnostics ?? null,
          generationDiagnostics: {
            recoveryTriggered: false,
            fallbackLevel: "none",
            sessionCancelled: false,
            ...(cached.generationDiagnostics ?? {}),
          },
          artistDiversity: cached.artistDiversity ?? null,
          playlistConfidence: cached.playlistConfidence ?? null,
          ...(cached.spotifyPlaylistUrl
            ? { spotifyPlaylistUrl: cached.spotifyPlaylistUrl }
            : { spotifyUnavailable: true as const }),
        });
        return;
      }
      if (cached && cacheInvalidReason) {
        cacheEntryStatus = "stale";
        req.log.info({
          userId,
          vibe,
          cacheHitValid: false,
          cacheInvalidReason,
        }, "Generate result cache bypassed");
      }
    }

    (req as { _genCtx?: Record<string, unknown> })._genCtx = {
      requestId,
      userId,
      likedSongs,
      emotionProfile,
      length,
      mode,
      vibe,
      maxPerArtist: artistDiversityCap(length, vibe),
      noLibrarySpotifyCandidateCount,
      noLibrarySpotifyVerifiedCount,
      noLibrarySpotifyFallbackReason,
      noLibraryRetrievalDiagnostics,
      noLibraryMode,
    };

    if (responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    res.setTimeout(Math.max(1_000, deadlineAt - Date.now() + 2_000), () => {
      if (responseFinished(res)) return; // timeout handler — no second body
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      cancelGenerateSession(generateSessionUserId, requestId);
      const ctx = (req as { _genCtx?: {
        likedSongs: typeof likedSongs;
        constrainedFallbackTracks?: typeof likedSongs;
        emotionProfile: EmotionProfile;
        length: number;
        maxPerArtist?: number;
        vibe: string;
        mode: string;
        noLibraryMode?: boolean;
        lockedIntent?: LockedIntent;
        constraintLayer?: ConstraintLayer;
        classMap?: Map<string, {
          genrePrimary: string;
          genreFamily: string;
          primarySubgenre: string;
          secondarySubgenre: string | null;
          subGenres: string[];
        }>;
        genreByTrack?: (trackId: string) => {
          genrePrimary?: string | null;
          genreFamily?: string | null;
          genres?: string[] | null;
        } | null;
        trackReusePenalty?: Map<string, number>;
        artistReusePenalty?: Map<string, number>;
      } })._genCtx;
      req.log.error({ userId, requestId, code: "TIMEOUT" }, "Generate hard timeout — emergency fallback");
      if (!ctx?.likedSongs?.length) {
        res.status(504).json({
          success: false,
          error: "Generation took too long before a safe playlist could be built. Try again with a slightly broader prompt, or sync your Spotify library and retry.",
          code: "TIMEOUT",
          tracks: [],
          generationDiagnostics: {
            recoveryTriggered: false,
            fallbackLevel: "none",
            sessionCancelled: true,
            failureReason: "hard_timeout_before_safe_fallback",
          },
        });
        return;
      }
      const maxPerArtist = ctx.maxPerArtist ?? artistDiversityCap(ctx.length, ctx.vibe);
      const fallbackTracks = ctx.constrainedFallbackTracks?.length
        ? ctx.constrainedFallbackTracks
        : ctx.likedSongs;
      const pipeline = buildFallbackPipelineResult({
        tracks: fallbackTracks,
        emotionProfile: ctx.emotionProfile,
        playlistLength: ctx.length,
        maxPerArtist,
        librarySize: fallbackTracks.length,
        genreByTrack: ctx.genreByTrack,
      });
      const finalizedFallback = ctx.lockedIntent && ctx.constraintLayer && ctx.classMap
        ? finalizePlaylistTracks({
            initial: pipeline.finalTracks as unknown as ConstraintTrack[],
            candidates: fallbackTracks.map((track) => ({ ...track, score: 0.6 } as ConstraintTrack)),
            requestedLength: ctx.length,
            vibe: ctx.vibe,
            intent: ctx.lockedIntent,
            constraints: ctx.constraintLayer,
            classMap: ctx.classMap,
            maxPerArtist,
            trackReusePenalty: ctx.trackReusePenalty,
            artistReusePenalty: ctx.artistReusePenalty,
          }).tracks
        : pipeline.finalTracks;
      const strictFallbackFailure = explicitGenreFallbackFailure({
        vibe: ctx.vibe,
        requestedCount: ctx.length,
        finalCount: finalizedFallback.length,
        hasGenreAwarePool: !!ctx.constrainedFallbackTracks?.length && !!ctx.genreByTrack,
        noLibraryMode: !!ctx.noLibraryMode,
      });
      if (strictFallbackFailure && finalizedFallback.length === 0) {
        res.status(409).json({
          success: false,
          error: strictFallbackFailure.error,
          code: strictFallbackFailure.code,
          strictGenreEvidence: strictFallbackFailure.details,
          tracks: [],
        });
        return;
      }
      const playlistName = generatePlaylistName(ctx.vibe, ctx.emotionProfile);
      res.json({
        success: true,
        fastFallback: true,
        code: "TIMEOUT_FALLBACK",
        fallbackReason: {
          stage: preV3Timing.slowestStage ?? "hard_timeout",
          elapsedMs: preV3Timing.slowestStageMs,
        },
        playlistName,
        name: playlistName,
        vibe: ctx.vibe,
        mode: ctx.mode,
        count: finalizedFallback.length,
        totalTracks: finalizedFallback.length,
        spotifyUnavailable: true,
        tracks: formatTracksForApi(finalizedFallback, ctx.emotionProfile),
      });
    });

    const promptConfidence = scorePromptConfidence(vibe, emotionProfile, {
      experienceSceneMatched: !!experienceScene,
      hasJourneyDestination: !!destParse.desired,
      mixedEmotions,
    });
    req.log.info({ vibe, vibeKind, promptConfidence }, "Vibe kind detected");

    setGeneratePhase(generateSessionUserId, requestId, "building_profile");
    setGenerateStageDetail(generateSessionUserId, requestId, "Loading recent playlist memory and feedback");
    tStage = Date.now();
    const [recentPlaylists, feedbackMemory] = await Promise.all([
      db
      .select()
      .from(playlistHistoryTable)
      .where(eq(playlistHistoryTable.spotifyUserId, userId))
      .orderBy(desc(playlistHistoryTable.createdAt))
        .limit(25),
      getFeedbackMemory(userId),
    ]);
    const playlistHistoryQueryMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "playlistHistoryQueryMs", playlistHistoryQueryMs);
    recordPreV3Timing(preV3Timing, "dbTimeMs", playlistHistoryQueryMs);
    const evaluationRecentTrackLists = evaluationSessionTrackLists(rawBody as Record<string, unknown>, sideEffectPolicy.mode === "audit");
    const auditDiversityPressure = evaluationDiversityPressure(vibe, emotionProfile, evaluationRecentTrackLists.length);
    const persistentMemoryPlaylistRows = recentPlaylists.map((p) => ({
        vibe: p.vibe,
        trackIds: (p.trackIds as string[]) ?? [],
        emotionProfile: p.emotionProfile as EmotionProfile | null,
      createdAt: p.createdAt,
    }));
    const memoryPlaylistRows = [
      ...persistentMemoryPlaylistRows,
      ...evaluationRecentTrackLists.map((trackIds, index) => ({
        vibe: `evaluation-session-${index + 1}`,
        trackIds,
        emotionProfile: null,
        createdAt: new Date(),
      })),
    ];
    const scoringMemoryPlaylistRows = auditDiversityPressure < 0.5
      ? persistentMemoryPlaylistRows
      : memoryPlaylistRows;

    tStage = Date.now();
    const freshnessStats = buildFreshnessStats(
      scoringMemoryPlaylistRows
    );

    const trackIdToArtist = new Map(likedSongs.map((s) => [s.trackId, s.artistName]));
    const trackIdToAlbum = new Map(likedSongs.map((s) => [s.trackId, s.albumName]));
    const scoringArtistAppearances = buildArtistAppearanceMap(
      scoringMemoryPlaylistRows,
      trackIdToArtist
    );
    const sessionArtistAppearances = buildArtistAppearanceMap(
      memoryPlaylistRows,
      trackIdToArtist
    );
    const albumAppearances = buildAlbumAppearanceMap(
      scoringMemoryPlaylistRows,
      trackIdToAlbum
    );

    const cloneMultiplier = sceneClonePenalty(
      vibe,
      emotionProfile,
      freshnessStats.recentSceneFingerprints,
      momentPipeline?.canonicalScene?.sceneId ?? experienceScene?.sceneId
    );
    recordPreV3Timing(preV3Timing, "freshnessTimeMs", Date.now() - tStage);

    const humanIntent = momentPipeline?.intent ?? decodeIntent(vibe);
    const sonicProfile = momentPipeline?.sonicProfile ?? null;
    const scenePrototype = momentPipeline?.prototype ?? null;
    const memoryWeight =
      momentPipeline?.canonicalScene && momentPipeline.canonicalScene.confidence >= 0.65
        ? 0.55
        : momentPipeline?.experienceScene
          ? 0.35
          : 0;

    const journeyArc =
      sceneJourneyArc && sceneJourneyArc !== "default"
        ? sceneJourneyArc
        : detectJourneyArc(vibe, emotionProfile);

    const archaeology = detectArchaeologyIntent(vibe);
    let rediscoveryMode: RediscoveryMode = detectRediscoveryMode(vibe);
    if (archaeology) rediscoveryMode = archaeology.rediscoveryMode;

    const likedRows: LikedSongRow[] = likedSongs.map((s) => ({
      trackId: s.trackId,
      artistName: s.artistName,
      albumName: s.albumName,
      addedAt: s.addedAt,
      energy: s.energy,
      valence: s.valence,
      acousticness: s.acousticness,
      danceability: s.danceability,
    }));

    const musicChapters = detectMusicChapters(likedRows);
    const chapterMatch = matchChapterFromVibe(vibe, musicChapters, likedRows);

    tStage = Date.now();
    const librarySignals = buildLibrarySignals(
      likedRows,
      memoryPlaylistRows
    );
    recordPreV3Timing(preV3Timing, "librarySignalTimeMs", Date.now() - tStage);

    const surpriseMix = computeSurpriseMix({
      profile: emotionProfile,
      vibe,
      rediscoveryMode,
      archaeology,
      journeyArc,
      mode: mode as "strict" | "balanced" | "chaotic",
    });

    const arcRepeatCount = countRecentJourneyArc(
      memoryPlaylistRows,
      journeyArc
    );
    const journeyArcMultiplier = journeyArcCooldownMultiplier(arcRepeatCount);

    setGenerateStageDetail(generateSessionUserId, requestId, `Building taste profile from ${likedSongs.length.toLocaleString()} tracks`);
    let t0 = Date.now();
    const { profile: userGenreProfile, cacheHit } = devMode
      ? { profile: buildMockUserGenreProfile(likedSongs), cacheHit: false }
      : getUserGenreProfileForGenerate(
      userId,
      likedSongs,
          vibe,
          { bypassCache: !!noLibraryMode }
    );
    recordPreV3Timing(preV3Timing, "genreProfileTimeMs", Date.now() - t0);
    req.log.info(
      { elapsedMs: Date.now() - t0, trackCount: likedSongs.length, cacheHit },
      "Genre profile built"
    );
    const genreByTrack = (trackId: string) => {
      const classification = userGenreProfile.trackClassifications.get(trackId);
      if (!classification) return null;
      const genres = [
        classification.primarySubgenre,
        classification.secondarySubgenre,
        ...(classification.subGenres ?? []),
        classification.genrePrimary,
        classification.genreFamily,
      ].filter((value): value is string => !!value);
      return {
        genrePrimary: classification.genrePrimary ?? classification.genreFamily ?? null,
        genreFamily: classification.genreFamily ?? classification.genrePrimary ?? null,
        genres: [...new Set(genres)],
      };
    };
    const hydrateTrackGenre = <T extends { trackId: string; genrePrimary?: string | null; genreFamily?: string | null; genres?: string[] | null }>(
      track: T
    ): T => {
      const genre = genreByTrack(track.trackId);
      if (!genre) return track;
      const genrePrimary = track.genrePrimary ?? genre.genrePrimary ?? null;
      return {
        ...track,
        genrePrimary,
        genreFamily: track.genreFamily ?? genre.genreFamily ?? genrePrimary,
        genres: Array.isArray(track.genres) && track.genres.length > 0
          ? track.genres
          : genre.genres ?? (genrePrimary ? [genrePrimary] : []),
      };
    };

    genStageTimer = createGenerateStageTimer(req.log, { requestId, userId });
    const stageTimer = genStageTimer;
    const hybridCap = resolveHybridPoolCap(likedSongs.length, {
      vibeKind,
      referencePlaylist: !!referencePlaylist,
      promptWordCount: vibe.trim().split(/\s+/).length,
    });
    stageTimer.start("Starting scoring pipeline", {
      tracks: likedSongs.length,
      hybridCap,
    });

    const recentTrackLists = memoryPlaylistRows.map((p) => p.trackIds);
    const sessionMemory = buildSessionMemory(recentTrackLists, trackIdToArtist);
    const playlistArtistSet = new Map<string, Set<string>>();
    memoryPlaylistRows.forEach((playlist, index) => {
      const artists = new Set<string>();
      for (const trackId of playlist.trackIds) {
        const artist = trackIdToArtist.get(trackId)?.trim().toLowerCase();
        if (artist) artists.add(artist);
      }
      playlistArtistSet.set(String(index), artists);
    });
    const sessionArtistMemory = {
      artistCount: sessionArtistAppearances,
      playlistArtistSet,
      maxArtistAppearances: 2,
      diversityPressure: auditDiversityPressure,
    };
    const recentTrackPenaltyScale = (varietyBoost ? 2.75 : 1.85) * auditDiversityPressure;
    const finalizationReusePenalty = recentTrackLists.length
      ? buildRecentTrackPoolPenalty(recentTrackLists, 20, recentTrackPenaltyScale)
      : undefined;
    const finalizationArtistReusePenalty = buildArtistReusePenalty(sessionMemory, auditDiversityPressure);
    const freshnessCloneMultiplier = varietyBoost
      ? cloneMultiplier * 0.88
      : cloneMultiplier;
    const stackCacheKey = resultCacheKey;

    stageTimer.start("Building genre stack", {
      tracks: likedSongs.length,
      minimal: likedSongs.length >= MINIMAL_GENRE_STACK_THRESHOLD,
    });
    let genreStack = getCachedGenreStack(stackCacheKey);
    const stackFromCache = !!genreStack;
    tStage = Date.now();
    if (!genreStack) {
      genreStack = buildGenreIntelligenceStack({
        librarySize: likedSongs.length,
        tracks: likedSongs,
        userProfile: userGenreProfile,
        vibe,
        recentPlaylistTrackIds: recentTrackLists,
      });
      setCachedGenreStack(stackCacheKey, genreStack);
    }
    recordPreV3Timing(preV3Timing, "genreStackTimeMs", Date.now() - tStage);
    stageTimer.end("Genre stack built", {
      stackFromCache,
      microGenres: genreStack.stats.microGenreCount,
      ontologyEdges: genreStack.stats.ontologyEdges,
    });

    const maxPerArtist = artistDiversityCap(length, vibe);

    const allowHolidaySeason = hasExplicitHolidayIntent(vibe);
    const qualitySignalContext = buildQualitySignalContext({
      vibe,
      emotionProfile,
      userGenreProfile,
      recentPlaylists: recentPlaylists.map((p) => ({ vibe: p.vibe, createdAt: p.createdAt })),
    });
    const pipelineVibe = normalizeVibeForPipeline(vibe, qualitySignalContext);
    const constraintLayer = extractConstraintLayer(vibe, qualitySignalContext);
    const parsedCsspIntent = buildCsspLockedIntent(vibe);
    const neutralDrivingPrompt = isNeutralDrivingPrompt(vibe, parsedCsspIntent);
    const resolvedMoodTags = (parsedCsspIntent.mood.length > 0
      ? parsedCsspIntent.mood
      : qualitySignalContext.moodTags.filter((tag) => tag !== "neutral").slice(0, 3))
      .filter((tag) => !(neutralDrivingPrompt && (tag === "melancholic" || tag === "dark")));
    const resolvedEnergy = parsedCsspIntent.energy ?? (neutralDrivingPrompt ? "medium" : null);
    const lockedIntent = {
      genreFamilies: parsedCsspIntent.genreFamilies.length > 0
        ? parsedCsspIntent.genreFamilies
        : constraintLayer.hard.genres.slice(0, 3),
      eraRange: parsedCsspIntent.eraRange ?? (
        constraintLayer.hard.eraStart !== null && constraintLayer.hard.eraEnd !== null
          ? { start: constraintLayer.hard.eraStart, end: constraintLayer.hard.eraEnd }
          : null
      ),
      mood: resolvedMoodTags,
      activity: parsedCsspIntent.activity,
      energy: resolvedEnergy,
      primaryGenres: parsedCsspIntent.genreFamilies.length > 0
        ? parsedCsspIntent.genreFamilies
        : constraintLayer.hard.genres.slice(0, 3),
      primaryGenre: parsedCsspIntent.primaryGenre ?? parsedCsspIntent.genreFamilies[0] ?? constraintLayer.hard.genres[0] ?? null,
      primarySubgenre: parsedCsspIntent.primarySubgenre,
      secondarySubgenre: parsedCsspIntent.secondarySubgenre,
      subgenreTerms: parsedCsspIntent.subgenreTerms,
      eraStart: parsedCsspIntent.eraRange?.start ?? constraintLayer.hard.eraStart,
      eraEnd: parsedCsspIntent.eraRange?.end ?? constraintLayer.hard.eraEnd,
      energyLevel: resolvedEnergy,
      interpretationBudget: parsedCsspIntent.interpretationBudget,
    };
    const curatorIdentity = buildCuratorIdentity({
      prompt: vibe,
      intent: lockedIntent,
      emotionProfile,
    });
    const curatorScoringContext: CuratorScoringContext = {
      vibe,
      intent: lockedIntent,
      constraints: constraintLayer,
      classMap: userGenreProfile.trackClassifications,
      identityTerms: universalIdentityTerms(vibe, lockedIntent, constraintLayer),
      expectedFamilies: lockedIntent.primaryGenres.length > 0
        ? lockedIntent.primaryGenres
        : lockedIntent.genreFamilies.length > 0
          ? lockedIntent.genreFamilies
          : constraintLayer.hard.genres,
    };
    const fallbackLockedFamily =
      lockedIntent.primaryGenres[0] ??
      dominantGenreFamily(likedSongs.map((track) => ({ ...track, score: 0.7 } as ConstraintTrack)), userGenreProfile.trackClassifications);
    const v3FallbackIntent = completeCsspLockedIntent(parsedCsspIntent, {
      genreFamilies: lockedIntent.genreFamilies.length > 0
        ? lockedIntent.genreFamilies
        : fallbackLockedFamily
          ? [fallbackLockedFamily]
          : [],
      eraRange: lockedIntent.eraRange,
      mood: lockedIntent.mood,
      activity: lockedIntent.activity,
      energy: lockedIntent.energy,
      primaryGenre: lockedIntent.primaryGenre,
      primarySubgenre: lockedIntent.primarySubgenre,
      secondarySubgenre: lockedIntent.secondarySubgenre,
      subgenreTerms: lockedIntent.subgenreTerms,
    });
    let fallbackBridgeUsed = false;
    const constrainedFallbackTracks = likedSongs.filter((track) => {
      const candidate = { ...track, score: 0.7 } as ConstraintTrack;
      const boundary = passesGenreGraphBoundary(candidate, {
        lockedFamily: fallbackLockedFamily,
        constraints: constraintLayer,
        lockedIntent,
        classMap: userGenreProfile.trackClassifications,
        bridgeUsed: fallbackBridgeUsed,
      });
      if (!boundary.pass) return false;
      if (!trackMatchesHardConstraints(candidate, constraintLayer, userGenreProfile.trackClassifications)) return false;
      if (!trackPassesLockedIntent(candidate, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)) return false;
      const classification = userGenreProfile.trackClassifications.get(track.trackId);
      if (!trackMatchesV3Constraints({
        ...candidate,
        genreFamily: classification?.genreFamily ?? classification?.genrePrimary ?? candidate.genrePrimary,
        genrePrimary: classification?.genrePrimary ?? candidate.genrePrimary,
        laneEra: candidate.laneEra,
      }, v3FallbackIntent)) return false;
      if (boundary.bridge) fallbackBridgeUsed = true;
      return true;
    });
    const genCtx = (req as { _genCtx?: Record<string, unknown> })._genCtx;
    if (genCtx) {
      genCtx["constrainedFallbackTracks"] = constrainedFallbackTracks;
      genCtx["genreByTrack"] = genreByTrack;
      genCtx["lockedIntent"] = lockedIntent;
      genCtx["constraintLayer"] = constraintLayer;
      genCtx["classMap"] = userGenreProfile.trackClassifications;
      genCtx["trackReusePenalty"] = finalizationReusePenalty;
      genCtx["artistReusePenalty"] = finalizationArtistReusePenalty;
    }
    req.log.info(
      {
        primary: qualitySignalContext.primary,
        moodTags: qualitySignalContext.moodTags,
        activityTags: qualitySignalContext.activityTags,
        eraHints: qualitySignalContext.eraHints,
        genreHints: qualitySignalContext.genreHints,
        canonicalHints: qualitySignalContext.canonicalHints,
        constraintLayer,
        lockedIntent,
        interpretationBudget: lockedIntent.interpretationBudget,
      },
      "Quality signal and constraint context prepared"
    );

    setGeneratePhase(generateSessionUserId, requestId, "scoring");
    setGenerateStageDetail(generateSessionUserId, requestId, `Ranking matches from ${likedSongs.length.toLocaleString()} liked songs`);
    stageTimer.start("Running playlist pipeline (scoring + compose)", {
      tracks: likedSongs.length,
      stackFromCache,
    });
    preV3Timing.totalBeforeV3Ms = Date.now() - startMs;
    req.log.info({ ...preV3Timing }, "Pre-V3 timing breakdown");
    const useFastFallback = !devMode && budget.shouldFastFallback();

    let pipeline: BuildPlaylistPipelineResult<(typeof likedSongs)[number]> & {
      requestOrchestration?: RequestGenerationOrchestration;
    };
    let fallbackReason: { stage: string; elapsedMs: number } | null = null;
    let playlistPipelineTimeMs = 0;
    const playlistPipelineStartedAt = Date.now();
    if (useFastFallback) {
      fallbackReason = {
        stage: preV3Timing.slowestStage ?? "hard_timeout",
        elapsedMs: preV3Timing.slowestStageMs,
      };
      req.log.warn(
        {
          ms: Date.now() - startMs,
          remainingMs: budget.remainingMs(),
          code: "FAST_FALLBACK",
          fallbackReason,
          preV3Timing,
        },
        "Time budget — fast fallback playlist"
      );
      pipeline = buildFallbackPipelineResult({
        tracks: constrainedFallbackTracks,
        emotionProfile,
        playlistLength: length,
        maxPerArtist,
        librarySize: constrainedFallbackTracks.length,
        genreByTrack,
      });
    } else {
      pipeline = await runRequestLayerGeneration({
      pipelineLog: req.log,
      likedSongs,
      vibe: pipelineVibe,
      mode: mode as "strict" | "balanced" | "chaotic",
      playlistLength: length,
      referencePlaylist: !!referencePlaylist,
      emotionProfile,
      vibeKind,
      intent: humanIntent,
      humanIntent,
      canonical: momentPipeline?.canonicalScene ?? null,
      prototype: scenePrototype,
      sonicProfile,
      userGenreProfile,
      genreStack,
      surpriseMix,
      journeyArc,
      maxPerArtist,
      recentPlaylistTrackIds: recentTrackLists,
      sessionArtistMemory,
      lastSuccessfulVibe: recentPlaylists[0]?.vibe ?? null,
      noLibraryMode: !!noLibraryMode,
      memoryByTrack: (trackId) => {
        const signal = librarySignals.tracks.get(trackId);
        if (!signal) return 0.35;
        const tm = computeTemporalMemory(signal);
        return Math.max(0, Math.min(1, 0.42 + tm.scoreModifier * 2));
      },
      noveltyByTrack: (trackId) =>
        Math.max(0, Math.min(1, 0.32 + (rediscoveryJitter(trackId, startMs) + 0.02) / 0.06)),
      postScore: {
        referenceFingerprint,
        memoryWeight,
        emotionProfile,
        librarySignals,
        rediscoveryMode,
        archaeology,
        chapterMatch,
        feedbackMemory,
        startMs,
        promptConfidenceMultiplier: promptConfidence.qualityBoost,
        journeyArcMultiplier,
        freshness: {
          stats: freshnessStats,
          artistAppearances: scoringArtistAppearances,
          albumAppearances,
          globalCloneMultiplier: freshnessCloneMultiplier,
        },
        vibe: pipelineVibe,
      },
      varietyPenaltyScale: recentTrackPenaltyScale,
      genrePost: {
        allowHoliday: allowHolidaySeason,
        suppressGenres: allowHolidaySeason ? [] : ["christmas"],
      },
      shouldAbort: generationShouldAbort,
      progress: (stage, detail) => {
        if (generationShouldAbort()) return;
        let phaseAccepted = true;
        if (stage === "scoring") {
          phaseAccepted = setGeneratePhase(generateSessionUserId, requestId, "scoring");
        } else if (stage === "retrieval" || stage === "lanes" || stage === "sampling") {
          phaseAccepted = setGeneratePhase(generateSessionUserId, requestId, "loading_library");
        } else if (stage === "fallback") {
          phaseAccepted = setGeneratePhase(generateSessionUserId, requestId, "composing");
        } else if (stage === "coherence") {
          phaseAccepted = setGeneratePhase(generateSessionUserId, requestId, "composing");
        }
        if (!phaseAccepted && (clientDisconnected || staleGenerate(generateSessionUserId, requestId))) return;
        setGenerateStageDetail(generateSessionUserId, requestId, detail);
      },
    });
    }
    playlistPipelineTimeMs = Date.now() - playlistPipelineStartedAt;
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;

    type PlaylistTrack = V3MetadataTrack<(typeof likedSongs)[number]> & {
      score: number;
      rediscoveryScore?: number;
      narrativeRole?: string;
      genreFamily?: string | null;
      genres?: string[] | null;
    };
    const finalizationPoolCap = Math.min(
      FINALIZATION_POOL_MAX,
      Math.max(FINALIZATION_POOL_MIN, length * FINALIZATION_POOL_PER_TRACK)
    );
    const buildFinalCandidatePool = (): PlaylistTrack[] => {
      const scoredFallbackTracks = constrainedFallbackTracks.slice(0, finalizationPoolCap).map((track) => ({
        ...track,
        score: 0.42,
        _fallbackCandidate: true,
      } as PlaylistTrack));
      const scoredLibraryTracks = likedSongs.slice(0, finalizationPoolCap).map((track) => ({
        ...track,
        score: 0.55,
      } as PlaylistTrack));
      return [
        ...(pipeline.finalTracks as PlaylistTrack[]),
        ...(pipeline.sorted as PlaylistTrack[]).slice(0, finalizationPoolCap),
        ...scoredFallbackTracks,
        ...scoredLibraryTracks,
      ].map(hydrateTrackGenre);
    };
    setGeneratePhase(generateSessionUserId, requestId, "composing");
    setGenerateStageDetail(generateSessionUserId, requestId, `Building playlist flow from ${pipeline.finalTracks.length.toLocaleString()} candidates`);
    let finalTracks = (pipeline.finalTracks as PlaylistTrack[]).map(hydrateTrackGenre);
    const publishPartialTracks = (tracks: PlaylistTrack[], limit = tracks.length): void => {
      const partialTracks = formatTracksForApi(tracks.slice(0, limit), emotionProfile).map((track) => ({
        trackId: track.id,
        trackName: track.name,
        artistName: track.artist,
        albumArt: track.albumArt ?? null,
      }));
      setGeneratePartialTracks(generateSessionUserId, requestId, partialTracks);
    };
    publishPartialTracks(finalTracks, 5);
    warnIfV3MetadataLost(
      pipeline.finalTracks,
      finalTracks,
      "create-playlist-to-controller"
    );
    warnIfFieldDropped("laneScore", pipeline.finalTracks, finalTracks, "create-playlist-to-controller");
    warnIfFieldDropped("clusterIds", pipeline.finalTracks, finalTracks, "create-playlist-to-controller");
    let finalValidation = validateLockedIntentOutput(
      finalTracks,
      lockedIntent,
      constraintLayer,
      userGenreProfile.trackClassifications
    );
    if (!validationPassed(finalValidation)) {
      req.log.warn(
        { finalValidation, finalCount: finalTracks.length },
        "Locked intent validation failed after hard filter"
      );
    }
    req.log.info(
      {
        lockedIntent,
        finalValidation,
        validationPassed: validationPassed(finalValidation),
      },
      "Locked intent final validation"
    );
    setGenerateStageDetail(generateSessionUserId, requestId, `Applying ${curatorIdentity.type.replace(/_/g, " ")} curator identity`);
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    const identityInitialTracks = applyCuratorIdentityScoring(finalTracks, curatorIdentity, sessionMemory, curatorScoringContext);
    const finalCandidatePool = applyCuratorIdentityScoring(buildFinalCandidatePool(), curatorIdentity, sessionMemory, curatorScoringContext);
    setGenerateStageDetail(generateSessionUserId, requestId, "Selecting dominant vibe cluster before final checks");
    const clusterCuration = curateCandidatesByVibeCluster(
      identityInitialTracks,
      finalCandidatePool,
      {
        vibe,
        intent: lockedIntent,
        constraints: constraintLayer,
        classMap: userGenreProfile.trackClassifications,
        requestedLength: length,
        identity: curatorIdentity,
      }
    );
    let repairTimeMs = 0;
    let finalizationTimeMs = 0;
    tStage = Date.now();
    let finalization = finalizePlaylistTracks({
      initial: clusterCuration.initial,
      candidates: clusterCuration.candidates,
      requestedLength: length,
      vibe,
      intent: lockedIntent,
      constraints: constraintLayer,
      allowHolidaySeason,
      classMap: userGenreProfile.trackClassifications,
      maxPerArtist,
      trackReusePenalty: finalizationReusePenalty,
      artistReusePenalty: finalizationArtistReusePenalty,
    });
    finalizationTimeMs += Date.now() - tStage;
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    const buildBroadRecoveryLibrary = (): PlaylistTrack[] => applyCuratorIdentityScoring(
      likedSongs
        .slice(0, finalizationPoolCap)
        .map((track) => ({
          ...track,
          score: 0.55,
        } as PlaylistTrack))
        .map(hydrateTrackGenre),
      curatorIdentity,
      sessionMemory,
      curatorScoringContext
    );
    const applyLowComplexityRecovery = (triggerStage: string): boolean => {
      if (finalTracks.length >= length) return false;
      if (finalTracks.length >= recoveryActivationThreshold(length)) return false;
      const recoveryStartedAt = Date.now();
      const recovered = recoverLowComplexityPlaylist({
        initial: finalTracks,
        fullLibrary: buildBroadRecoveryLibrary(),
        candidates: clusterCuration.diagnostics.active && clusterCuration.diagnostics.selectedCluster
          ? clusterCuration.candidates
          : finalCandidatePool,
        requestedLength: length,
        vibe,
        intent: lockedIntent,
        constraints: constraintLayer,
        allowHolidaySeason,
        classMap: userGenreProfile.trackClassifications,
        maxPerArtist,
        trackReusePenalty: finalizationReusePenalty,
        artistReusePenalty: finalizationArtistReusePenalty,
      });
      if (!recovered) return false;
      repairTimeMs += Date.now() - recoveryStartedAt;
      finalTracks = recovered.tracks;
      finalization = {
        tracks: recovered.tracks,
        diagnostics: {
          ...recovered.diagnostics,
          recoveryTrigger: triggerStage,
        },
      };
      finalValidation = validateLockedIntentOutput(
        finalTracks,
        lockedIntent,
        constraintLayer,
        userGenreProfile.trackClassifications
      );
      publishPartialTracks(finalTracks);
      req.log.info(
        { userId, vibe, finalization: finalization.diagnostics },
        "Broad energy recovery produced playlist"
      );
      return true;
    };
    if (trackListChanged(finalTracks, finalization.tracks)) {
      req.log.info(
        { userId, vibe, finalization: finalization.diagnostics },
        "Final playlist invariants repaired track list before evidence guards"
      );
      finalTracks = finalization.tracks;
      finalValidation = validateLockedIntentOutput(
        finalTracks,
        lockedIntent,
        constraintLayer,
        userGenreProfile.trackClassifications
      );
    }
    applyLowComplexityRecovery("pre_evidence_finalization_empty");
    const minBestAvailableCount = Math.min(length, Math.max(5, Math.ceil(length * 0.40)));
    const evidenceRelaxations: string[] = [];
    let strictGenreEvidenceRelaxed = false;
    let strictEraEvidenceRelaxed = false;
    let hardValidationRelaxed = false;
    const baseFinalizationCandidates = clusterCuration.diagnostics.active && clusterCuration.diagnostics.selectedCluster
      ? clusterCuration.candidates
      : finalCandidatePool;
    const strictGenreEvidenceDiagnostics = (() => {
      const expectedFamilies = lockedIntent.primaryGenres.length > 0
        ? lockedIntent.primaryGenres
        : lockedIntent.genreFamilies;
      if (expectedFamilies.length === 0) {
        return { active: false, expectedFamilies: [], verifiedCount: finalTracks.length, rejectedCount: 0, requiredCount: 0, verified: finalTracks, compatible: finalTracks };
      }
      const verified = finalTracks.filter((track) =>
        hasFinalGenreEvidence(track, userGenreProfile.trackClassifications, expectedFamilies)
      );
      const compatible = finalTracks.filter((track) =>
        finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
      );
      const rejected = finalTracks.filter((track) =>
        !finalTrackMatchesExplicitGenre(track, lockedIntent, constraintLayer, userGenreProfile.trackClassifications)
      );
      const evidenceBasisCount = finalTracks.length;
      const requiredCount = Math.min(
        evidenceBasisCount,
        Math.max(1, Math.ceil(evidenceBasisCount * STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO))
      );
      return {
        active: true,
        expectedFamilies,
        requiredRatio: STRICT_EXPLICIT_GENRE_EVIDENCE_RATIO,
        requestedCount: length,
        finalCount: finalTracks.length,
        evidenceBasisCount,
        verifiedCount: verified.length,
        rejectedCount: rejected.length,
        requiredCount,
        verified,
        compatible,
      };
    })();
    if (
      strictGenreEvidenceDiagnostics.active &&
      strictGenreEvidenceDiagnostics.verifiedCount < strictGenreEvidenceDiagnostics.requiredCount
    ) {
      if (finalTracks.length >= minBestAvailableCount) {
        strictGenreEvidenceRelaxed = true;
        evidenceRelaxations.push("genre_evidence_relaxed_best_available");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: finalTracks.length,
            minBestAvailableCount,
            strictGenreEvidenceDiagnostics: {
              ...strictGenreEvidenceDiagnostics,
              verified: undefined,
              compatible: undefined,
            },
          },
          "Explicit genre evidence guard relaxed to best available playlist"
        );
      } else {
      req.log.warn(
        {
          userId,
          vibe,
          strictGenreEvidenceDiagnostics: {
            ...strictGenreEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
          },
        },
        "Explicit genre evidence guard blocked weak playlist"
      );
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      generateFail(
        res,
        409,
        "INSUFFICIENT_VERIFIED_GENRE_EVIDENCE",
        noLibraryMode
          ? `I could not find enough verified ${strictGenreEvidenceDiagnostics.expectedFamilies.join("/")} tracks from Spotify search to make this playlist without guessing.`
          : `I could not find enough verified ${strictGenreEvidenceDiagnostics.expectedFamilies.join("/")} tracks in your synced library to make this playlist without guessing.`,
        {
          hint: noLibraryMode
            ? "Try a broader genre phrase, turn off No Library Mode to use your saved tracks, or regenerate in a moment."
            : "Run a fresh Spotify library sync so artist genres are updated, or broaden the prompt.",
          strictGenreEvidence: {
            ...strictGenreEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
          },
          noLibrarySpotify: noLibraryMode
            ? {
                candidateCount: noLibrarySpotifyCandidateCount,
                verifiedCandidateCount: noLibrarySpotifyVerifiedCount,
                fallbackReason: noLibrarySpotifyFallbackReason,
                retrievalCompletion: noLibraryRetrievalDiagnostics,
              }
            : undefined,
        }
      );
      return;
      }
    }
    if (
      strictGenreEvidenceDiagnostics.active &&
      strictGenreEvidenceDiagnostics.rejectedCount > 0 &&
      !strictGenreEvidenceRelaxed
    ) {
      finalTracks = strictGenreEvidenceDiagnostics.compatible as PlaylistTrack[];
      finalValidation = validateLockedIntentOutput(
        finalTracks,
        lockedIntent,
        constraintLayer,
        userGenreProfile.trackClassifications
      );
    }
    const strictEraEvidenceDiagnostics = (() => {
      const eraRange = lockedIntent.eraRange;
      if (!eraRange) {
        return {
          active: false,
          eraRange: null,
          requiredRatio: STRICT_EXPLICIT_ERA_EVIDENCE_RATIO,
          requestedCount: length,
          finalCount: finalTracks.length,
          verifiedCount: finalTracks.length,
          unknownCount: 0,
          rejectedCount: 0,
          requiredCount: 0,
          compatibleFallbackUsed: false,
          verified: finalTracks,
          compatible: finalTracks,
          compatibleRecoveryCount: finalTracks.length,
          compatibleRecovery: finalTracks,
        };
      }
      const verified = finalTracks.filter((track) => trackHasEraEvidence(track, eraRange));
      const knownMismatches = finalTracks.filter((track) => trackHasKnownEraMismatch(track, eraRange));
      const compatible = finalTracks.filter((track) => !trackHasKnownEraMismatch(track, eraRange));
      const compatibleRecovery = baseFinalizationCandidates.filter((track) => !trackHasKnownEraMismatch(track, eraRange));
      const requiredCount = Math.min(
        length,
        Math.max(10, Math.ceil(length * STRICT_EXPLICIT_ERA_EVIDENCE_RATIO))
      );
      const compatibleFallbackUsed =
        verified.length < requiredCount &&
        lockedIntent.genreFamilies.length > 0 &&
        knownMismatches.length === 0 &&
        compatible.length >= Math.min(length, Math.max(8, Math.ceil(length * 0.50)));
      return {
        active: true,
        eraRange,
        requiredRatio: STRICT_EXPLICIT_ERA_EVIDENCE_RATIO,
        requestedCount: length,
        finalCount: finalTracks.length,
        verifiedCount: verified.length,
        unknownCount: compatible.length - verified.length,
        rejectedCount: knownMismatches.length,
        compatibleRecoveryCount: compatibleRecovery.length,
        requiredCount,
        verifiedSample: eraDiagnosticSample(verified),
        unknownSample: eraDiagnosticSample(compatible.filter((track) => !trackHasEraEvidence(track, eraRange))),
        rejectedSample: eraDiagnosticSample(knownMismatches),
        compatibleFallbackUsed,
        verified,
        compatible,
        compatibleRecovery,
      };
    })();
    if (
      strictEraEvidenceDiagnostics.active &&
      strictEraEvidenceDiagnostics.verifiedCount < strictEraEvidenceDiagnostics.requiredCount &&
      !strictEraEvidenceDiagnostics.compatibleFallbackUsed
    ) {
      const compatibleEraRecoveryPool = strictEraEvidenceDiagnostics.compatible.length >= minBestAvailableCount
        ? strictEraEvidenceDiagnostics.compatible
        : strictEraEvidenceDiagnostics.compatibleRecovery;
      if (compatibleEraRecoveryPool.length >= minBestAvailableCount) {
        strictEraEvidenceRelaxed = true;
        evidenceRelaxations.push("era_evidence_relaxed_to_compatible_unknowns");
        finalTracks = compatibleEraRecoveryPool.slice(0, length) as PlaylistTrack[];
        finalValidation = validateLockedIntentOutput(
          finalTracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: finalTracks.length,
            minBestAvailableCount,
            strictEraEvidenceDiagnostics: {
              ...strictEraEvidenceDiagnostics,
              verified: undefined,
              compatible: undefined,
              compatibleRecovery: undefined,
            },
          },
          "Explicit era evidence guard relaxed to compatible unknown-era playlist"
        );
      } else if (
        (isGymWorkoutPrompt(vibe, lockedIntent) || isUpbeatSocialPrompt(vibe, lockedIntent)) &&
        finalTracks.length >= minBestAvailableCount
      ) {
        strictEraEvidenceRelaxed = true;
        evidenceRelaxations.push("era_evidence_relaxed_for_activity_recovery");
        req.log.warn(
          {
            userId,
            vibe,
            finalCount: finalTracks.length,
            minBestAvailableCount,
            strictEraEvidenceDiagnostics: {
              ...strictEraEvidenceDiagnostics,
              verified: undefined,
              compatible: undefined,
              compatibleRecovery: undefined,
            },
          },
          "Explicit era evidence guard kept activity-safe recovery playlist"
        );
      } else {
      req.log.warn(
        {
          userId,
          vibe,
          strictEraEvidenceDiagnostics: {
            ...strictEraEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
            compatibleRecovery: undefined,
          },
        },
        "Explicit era evidence guard blocked weak playlist"
      );
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      generateFail(
        res,
        409,
        "INSUFFICIENT_VERIFIED_ERA_EVIDENCE",
        `I could not find enough verified ${strictEraEvidenceDiagnostics.eraRange?.start}-${strictEraEvidenceDiagnostics.eraRange?.end} tracks after removing wrong-era songs.`,
        {
          hint: "Try a broader decade prompt, add a genre, or regenerate after syncing tracks with release years.",
          strictEraEvidence: {
            ...strictEraEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
            compatibleRecovery: undefined,
          },
        }
      );
      return;
      }
    }
    if (
      strictEraEvidenceDiagnostics.active &&
      strictEraEvidenceDiagnostics.compatibleFallbackUsed &&
      !strictEraEvidenceRelaxed
    ) {
      strictEraEvidenceRelaxed = true;
      evidenceRelaxations.push("era_evidence_relaxed_to_compatible_unknowns");
      finalTracks = strictEraEvidenceDiagnostics.compatible as PlaylistTrack[];
      finalValidation = validateLockedIntentOutput(
        finalTracks,
        lockedIntent,
        constraintLayer,
        userGenreProfile.trackClassifications
      );
    }
    if (strictEraEvidenceDiagnostics.active && !strictEraEvidenceRelaxed) {
      const nextFinalTracks = strictEraEvidenceDiagnostics.compatible;
      if (nextFinalTracks.length !== finalTracks.length) {
        finalTracks = nextFinalTracks as PlaylistTrack[];
        finalValidation = validateLockedIntentOutput(
          finalTracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
      }
    }
    tStage = Date.now();
    const finalizationIntent = strictEraEvidenceRelaxed
      ? {
          ...lockedIntent,
          eraRange: null,
          eraStart: null,
          eraEnd: null,
        }
      : lockedIntent;
    const finalizationCandidates = strictEraEvidenceRelaxed && lockedIntent.eraRange
      ? baseFinalizationCandidates.filter((track) => !trackHasKnownEraMismatch(track, lockedIntent.eraRange!))
      : baseFinalizationCandidates;
    const secondFinalizationNeeded =
      strictEraEvidenceRelaxed ||
      finalTracks.length < Math.ceil(length * 0.90) ||
      trackListChanged(finalTracks, finalization.tracks);
    if (secondFinalizationNeeded) {
      finalization = finalizePlaylistTracks({
        initial: finalTracks,
        candidates: finalizationCandidates,
        requestedLength: length,
        vibe,
        intent: finalizationIntent,
        constraints: constraintLayer,
        allowHolidaySeason,
        classMap: userGenreProfile.trackClassifications,
        maxPerArtist,
        trackReusePenalty: finalizationReusePenalty,
        artistReusePenalty: finalizationArtistReusePenalty,
      });
      finalizationTimeMs += Date.now() - tStage;
    } else {
      finalization = {
        tracks: finalTracks,
        diagnostics: {
          ...finalization.diagnostics,
          repeatedPassSkipped: true,
          skippedReason: "playlist_already_finalized",
        },
      };
    }
    if (trackListChanged(finalTracks, finalization.tracks)) {
      req.log.info(
        { userId, vibe, finalization: finalization.diagnostics },
        "Final playlist invariants repaired track list"
      );
      finalTracks = finalization.tracks;
      finalValidation = validateLockedIntentOutput(
        finalTracks,
        lockedIntent,
        constraintLayer,
        userGenreProfile.trackClassifications
      );
    }
    applyLowComplexityRecovery("post_evidence_finalization_empty");
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    const strictEraEvidencePublic = {
      ...strictEraEvidenceDiagnostics,
      verified: undefined,
      compatible: undefined,
      compatibleRecovery: undefined,
      publishedCount: finalTracks.length,
      publishMode: strictEraEvidenceRelaxed
        ? "compatible_unknowns_relaxed"
        : strictEraEvidenceDiagnostics.active ? "verified_only" : "inactive",
      relaxed: strictEraEvidenceRelaxed,
    };
    const hardValidationFailures = [
      (lockedIntent.primaryGenres.length > 0 || constraintLayer.hard.genres.length > 0) &&
        finalValidation.genreConsistency === "FAIL" ? "genreConsistency" : null,
      (lockedIntent.eraStart !== null || constraintLayer.hard.eraStart !== null) &&
        finalValidation.eraAlignment === "FAIL" ? "eraAlignment" : null,
    ].filter((failure): failure is string => !!failure);
    if (finalTracks.length > 0 && hardValidationFailures.length > 0) {
      if (finalTracks.length >= minBestAvailableCount) {
        hardValidationRelaxed = true;
        evidenceRelaxations.push("locked_intent_validation_relaxed_best_available");
        req.log.warn(
          { userId, vibe, finalValidation, hardValidationFailures, finalCount: finalTracks.length, minBestAvailableCount },
          "Hard locked intent validation relaxed to best available playlist"
        );
      } else {
      req.log.warn(
        { userId, vibe, finalValidation, hardValidationFailures, finalCount: finalTracks.length },
        "Hard locked intent validation blocked playlist"
      );
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
      generateFail(
        res,
        409,
        "LOCKED_INTENT_VALIDATION_FAILED",
        "I could not make this playlist without breaking the explicit genre or era request.",
        {
          finalValidation,
          hardValidationFailures,
          strictGenreEvidence: {
            ...strictGenreEvidenceDiagnostics,
            verified: undefined,
            compatible: undefined,
          },
          strictEraEvidence: strictEraEvidencePublic,
        }
      );
      return;
      }
    }
    let humanCoherence = humanCoherenceScore(finalTracks, curatorIdentity);
    let humanCoherenceRepairUsed = false;
    if (finalTracks.length > 0 && humanCoherence.score < 0.56) {
      const repairStartedAt = Date.now();
      const repairCandidates = finalCandidatePool.filter((track) => {
        if (strictEraEvidenceRelaxed && lockedIntent.eraRange && trackHasKnownEraMismatch(track, lockedIntent.eraRange)) return false;
        const identityFit = (track as unknown as Record<string, unknown>)["_identityFit"];
        const fit = typeof identityFit === "number" ? identityFit : scoreTrackForIdentity(track, curatorIdentity);
        const cluster = vibeClusterKey(track, userGenreProfile.trackClassifications);
        const allowedCluster = clusterCuration.diagnostics.selectedCluster
          ? cluster === clusterCuration.diagnostics.selectedCluster ||
            (clusterCuration.diagnostics.secondaryCluster !== null && cluster === clusterCuration.diagnostics.secondaryCluster)
          : true;
        return fit >= 0.48 && allowedCluster;
      });
      const repaired = finalizePlaylistTracks({
        initial: repairCandidates.slice(0, length),
        candidates: repairCandidates,
        requestedLength: length,
        vibe,
        intent: finalizationIntent,
        constraints: constraintLayer,
        allowHolidaySeason,
        classMap: userGenreProfile.trackClassifications,
        maxPerArtist,
        trackReusePenalty: finalizationReusePenalty,
        artistReusePenalty: finalizationArtistReusePenalty,
      });
      const repairedCoherence = humanCoherenceScore(repaired.tracks, curatorIdentity);
      repairTimeMs += Date.now() - repairStartedAt;
      if (
        repaired.tracks.length >= Math.min(length, Math.max(6, Math.ceil(length * 0.60))) &&
        repairedCoherence.score >= humanCoherence.score + 0.06
      ) {
        finalTracks = repaired.tracks;
        finalization = {
          tracks: repaired.tracks,
          diagnostics: {
            ...repaired.diagnostics,
            humanCoherenceRepair: true,
          },
        };
        finalValidation = validateLockedIntentOutput(
          finalTracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
        humanCoherence = repairedCoherence;
        humanCoherenceRepairUsed = true;
        evidenceRelaxations.push("human_coherence_repaired");
        req.log.info(
          { userId, vibe, curatorIdentity: curatorIdentity.type, humanCoherence },
          "Human coherence repair rebuilt playlist"
        );
      } else if (humanCoherence.score < 0.46 && finalTracks.length < minBestAvailableCount) {
        evidenceRelaxations.push("human_coherence_low_best_available");
      }
    }
    const scoringDiagnostics = pipeline.scoringDiagnostics;
    const genreAudit: GenreAudit = pipeline.genreAudit;
    const { structured, afterDeadZone, afterSmoothing, afterArtistSep } = pipeline.composeMeta;

    const scoringPool = (pipeline.scoringDiagnostics.scoringPool ?? {}) as {
      librarySize?: number;
      hybridPoolSize?: number;
      poolCapped?: boolean;
    };
    const v3PipelineDiagnostics = ((scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {}) as Record<string, unknown>;
    const v3GenerationDebug = (v3PipelineDiagnostics["generationDebug"] ?? {}) as Record<string, unknown>;
    const waterfallDiagnostics = (v3PipelineDiagnostics["waterfall"] ?? {}) as Record<string, unknown>;
    const removalReasonDiagnostics = Array.isArray(v3PipelineDiagnostics["removalReasons"])
      ? v3PipelineDiagnostics["removalReasons"] as Array<Record<string, unknown>>
      : [];
    const numberFromWaterfall = (key: string, fallback: number): number => {
      const value = waterfallDiagnostics[key];
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    };
    const afterForStage = (matcher: RegExp, fallback: number): number => {
      const stage = removalReasonDiagnostics.find((entry) => matcher.test(String(entry["stage"] ?? "")));
      const after = stage?.["after"];
      return typeof after === "number" && Number.isFinite(after) ? after : fallback;
    };
    const stageWaterfall = [
      { stage: "Library Size", count: likedSongs.length },
      { stage: "Sampled", count: numberFromWaterfall("retrievalCount", scoringPool.hybridPoolSize ?? pipeline.sorted.length) },
      { stage: "Classified", count: afterForStage(/genre family normalization|metadata completeness/i, numberFromWaterfall("scoredCount", pipeline.sorted.length)) },
      { stage: "Intent Match", count: numberFromWaterfall("contractCount", likedSongs.length) },
      { stage: "Era Match", count: afterForStage(/era readiness/i, numberFromWaterfall("constraintCount", pipeline.sorted.length)) },
      { stage: "Mood Match", count: afterForStage(/constraint filter|intent readiness/i, numberFromWaterfall("constraintCount", pipeline.sorted.length)) },
      { stage: "Ranking", count: numberFromWaterfall("laneCount", scoringPool.hybridPoolSize ?? pipeline.sorted.length) },
      { stage: "Repair", count: finalization.tracks.length },
      { stage: "Coherence", count: numberFromWaterfall("finalCount", finalTracks.length) },
      { stage: "Final Playlist", count: finalTracks.length },
    ].map((entry, index, entries) => {
      const before = index === 0 ? entry.count : entries[index - 1].count;
      return {
        ...entry,
        before,
        removed: Math.max(0, before - entry.count),
      };
    });
    const largestDrop = [...stageWaterfall]
      .filter((stage) => stage.removed > 0)
      .sort((a, b) => b.removed - a.removed)[0] ?? null;
    const finalizationSeriouslyUnderfilled =
      finalTracks.length < recoveryActivationThreshold(length);
    const recoveryRelaxations = [
      typeof finalization.diagnostics["recoveryStage"] === "string" ? finalization.diagnostics["recoveryStage"] : null,
      finalizationSeriouslyUnderfilled && finalization.diagnostics["artistLimitRelaxed"] ? "artist_limit_relaxed" : null,
      finalizationSeriouslyUnderfilled && finalization.diagnostics["albumLimitRelaxed"] ? "album_limit_relaxed" : null,
      ...evidenceRelaxations,
    ].filter((entry): entry is string => !!entry);
    const fallbackLevel = fallbackLevelFromFinalization(finalization.diagnostics);
    const pipelineTiming = (v3PipelineDiagnostics["timingMs"] ?? null) as Record<string, unknown> | null;
    const intentContractGuardDiagnostics = (v3PipelineDiagnostics["intentContractGuard"] ?? {}) as Record<string, unknown>;
    const pipelinePromptSurvivability = (intentContractGuardDiagnostics["promptSurvivability"] ?? {}) as Record<string, unknown>;
    const promptSurvivability = {
      preFilterPoolSize: typeof pipelinePromptSurvivability["preFilterPoolSize"] === "number"
        ? pipelinePromptSurvivability["preFilterPoolSize"]
        : null,
      postStructuredRetrievalSize: typeof pipelinePromptSurvivability["postStructuredRetrievalSize"] === "number"
        ? pipelinePromptSurvivability["postStructuredRetrievalSize"]
        : null,
      postContractFilterSize: typeof pipelinePromptSurvivability["postContractFilterSize"] === "number"
        ? pipelinePromptSurvivability["postContractFilterSize"]
        : null,
      postFinalizationSize: finalization.tracks.length,
      firstCollapseReason: typeof pipelinePromptSurvivability["firstCollapseReason"] === "string"
        ? pipelinePromptSurvivability["firstCollapseReason"]
        : finalTracks.length === 0
          ? "finalization_empty"
          : null,
      structuredRetrieval: pipelinePromptSurvivability["structuredRetrieval"] ?? null,
    };
    const softGuardTrace = Array.isArray(intentContractGuardDiagnostics["softGuardOriginTrace"])
      ? intentContractGuardDiagnostics["softGuardOriginTrace"] as Array<Record<string, unknown>>
      : [];
    const buildSoftGuardDebugSummary = (tracks: PlaylistTrack[]): Record<string, unknown> => {
      const traceByTrackId = new Map(
        softGuardTrace
          .filter((entry) => typeof entry["trackId"] === "string")
          .map((entry) => [entry["trackId"] as string, entry])
      );
      const originCounts = {
        subgenre: 0,
        family: 0,
        text: 0,
        fallback: 0,
      };
      let rescuedBySoftGuardFloor = 0;
      for (const track of tracks) {
        const trace = traceByTrackId.get(track.trackId);
        const origin = trace?.["origin"];
        const bucket = origin === "subgenre" || origin === "family" || origin === "text"
          ? origin
          : "fallback";
        originCounts[bucket] += 1;
        if (trace?.["rescuedBySoftGuardFloor"] === true) rescuedBySoftGuardFloor++;
      }
      const topFiveOriginCounts = softGuardTrace
        .filter((entry) => typeof entry["finalRankPosition"] === "number" && entry["finalRankPosition"] <= 5)
        .reduce<Record<"subgenre" | "family" | "text" | "fallback", number>>(
          (acc, entry) => {
            const origin = entry["origin"];
            const bucket = origin === "subgenre" || origin === "family" || origin === "text"
              ? origin
              : "fallback";
            acc[bucket] += 1;
            return acc;
          },
          { subgenre: 0, family: 0, text: 0, fallback: 0 }
        );
      const total = Math.max(1, tracks.length);
      return {
        poolSizeProgression: {
          retrieval: promptSurvivability.preFilterPoolSize,
          structured: promptSurvivability.postStructuredRetrievalSize,
          contractGuard: promptSurvivability.postContractFilterSize,
          final: tracks.length,
        },
        finalOriginDistribution: {
          subgenre: Math.round((originCounts.subgenre / total) * 1000) / 10,
          family: Math.round((originCounts.family / total) * 1000) / 10,
          text: Math.round((originCounts.text / total) * 1000) / 10,
          fallback: Math.round((originCounts.fallback / total) * 1000) / 10,
        },
        finalOriginCounts: originCounts,
        topFiveOriginCounts,
        topFiveHasSubgenre: topFiveOriginCounts.subgenre > 0,
        topFiveHasFallback: topFiveOriginCounts.fallback > 0,
        rescuedBySoftGuardFloor,
      };
    };
    const requestTimingMs = {
      total: Date.now() - startMs,
      preV3: preV3Timing,
      playlistPipeline: playlistPipelineTimeMs,
      retrieval: typeof pipelineTiming?.["retrieval"] === "number" ? pipelineTiming["retrieval"] : null,
      candidateGeneration: typeof pipelineTiming?.["candidateGeneration"] === "number" ? pipelineTiming["candidateGeneration"] : null,
      v3Scoring: typeof pipelineTiming?.["scoring"] === "number" ? pipelineTiming["scoring"] : null,
      sampler: typeof pipelineTiming?.["sampler"] === "number" ? pipelineTiming["sampler"] : null,
      repair: repairTimeMs,
      finalization: finalizationTimeMs,
      v3Pipeline: pipelineTiming,
    };
    const slowestRequestStage = Object.entries({
      preV3: preV3Timing.totalBeforeV3Ms,
      playlistPipeline: playlistPipelineTimeMs,
      retrieval: typeof pipelineTiming?.["retrieval"] === "number" ? pipelineTiming["retrieval"] as number : 0,
      candidateGeneration: typeof pipelineTiming?.["candidateGeneration"] === "number" ? pipelineTiming["candidateGeneration"] as number : 0,
      v3Scoring: typeof pipelineTiming?.["scoring"] === "number" ? pipelineTiming["scoring"] as number : 0,
      sampler: typeof pipelineTiming?.["sampler"] === "number" ? pipelineTiming["sampler"] as number : 0,
      repair: repairTimeMs,
      finalization: finalizationTimeMs,
    }).sort((a, b) => b[1] - a[1])[0] ?? null;
    const generationDiagnostics = {
      initialLibrarySize: likedSongs.length,
      candidatesSampled: numberFromWaterfall("retrievalCount", scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesClassified: afterForStage(/genre family normalization|metadata completeness/i, numberFromWaterfall("scoredCount", pipeline.sorted.length)),
      candidatesAfterIntent: Number(waterfallDiagnostics["contractCount"] ?? likedSongs.length),
      candidatesAfterEra: afterForStage(/era readiness/i, Number(waterfallDiagnostics["constraintCount"] ?? pipeline.sorted.length)),
      candidatesAfterMood: afterForStage(/constraint filter|intent readiness/i, Number(waterfallDiagnostics["constraintCount"] ?? pipeline.sorted.length)),
      candidatesAfterConstraints: Number(waterfallDiagnostics["constraintCount"] ?? scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesAfterRanking: Number(scoringPool.hybridPoolSize ?? pipeline.sorted.length),
      candidatesAfterDiversity: afterArtistSep.length,
      candidatesAfterRepair: finalization.tracks.length,
      candidatesAfterCoherence: Number(waterfallDiagnostics["finalCount"] ?? finalTracks.length),
      candidatesFinal: finalTracks.length,
      promptSurvivability,
      softGuardDebugSummary: buildSoftGuardDebugSummary(finalTracks),
      waterfall: stageWaterfall,
      largestDrop,
      removalReasons: removalReasonDiagnostics.slice(0, 12),
      timingMs: {
        ...requestTimingMs,
        slowestStage: slowestRequestStage?.[0] ?? null,
        slowestStageMs: slowestRequestStage?.[1] ?? 0,
        stagesOver30s: Object.entries({
          total: requestTimingMs.total,
          preV3: preV3Timing.totalBeforeV3Ms,
          playlistPipeline: playlistPipelineTimeMs,
          retrieval: typeof requestTimingMs.retrieval === "number" ? requestTimingMs.retrieval : 0,
          candidateGeneration: typeof requestTimingMs.candidateGeneration === "number" ? requestTimingMs.candidateGeneration : 0,
          v3Scoring: typeof requestTimingMs.v3Scoring === "number" ? requestTimingMs.v3Scoring : 0,
          sampler: typeof requestTimingMs.sampler === "number" ? requestTimingMs.sampler : 0,
          repair: repairTimeMs,
          finalization: finalizationTimeMs,
        })
          .filter(([, ms]) => ms >= 30_000)
          .map(([stage, ms]) => ({ stage, ms })),
      },
      recoveryRelaxations,
      recoveryTriggered: fallbackLevel !== "none" || recoveryRelaxations.length > 0,
      fallbackLevel,
      sessionCancelled: false,
      generationDebug: v3GenerationDebug,
      relaxationSteps: Array.isArray(v3GenerationDebug["relaxationSteps"])
        ? v3GenerationDebug["relaxationSteps"]
        : [],
      finalRelaxedConstraints: v3GenerationDebug["finalRelaxedConstraints"] ?? null,
      constraintFailures: Array.isArray(v3GenerationDebug["constraintFailures"])
        ? v3GenerationDebug["constraintFailures"]
        : [],
      dominantCluster: v3GenerationDebug["dominantCluster"] ?? null,
      clusterPurity: typeof v3GenerationDebug["clusterPurity"] === "number"
        ? v3GenerationDebug["clusterPurity"]
        : null,
      artistReuseRate: typeof v3GenerationDebug["artistReuseRate"] === "number"
        ? v3GenerationDebug["artistReuseRate"]
        : null,
      fallbackTriggered: !!fallbackReason || !!finalization.diagnostics.fallbackMode,
      identityType: curatorIdentity.type,
      identitySummary: curatorIdentity.summary,
      curatorIdentity: buildIdentityDebugView(curatorIdentity),
      selectedCluster: clusterCuration.diagnostics.selectedClusterLabel,
      selectedClusterId: clusterCuration.diagnostics.selectedCluster,
      secondaryCluster: clusterCuration.diagnostics.secondaryClusterLabel,
      secondaryClusterId: clusterCuration.diagnostics.secondaryCluster,
      clusterConfidence: clusterCuration.diagnostics.clusterConfidence,
      fallbackCandidatePercent: clusterCuration.diagnostics.fallbackCandidatePercent,
      humanCoherenceScore: humanCoherence.score,
      humanCoherenceComponents: humanCoherence.components,
      humanCoherenceReasons: humanCoherence.reasons,
      humanCoherenceRepairUsed,
      majorExclusions: [
        ...clusterCuration.diagnostics.majorExclusions,
        ...humanCoherence.reasons,
      ],
      cohesionScore: typeof finalization.diagnostics["cohesionSkipped"] === "number"
        ? Math.max(0, Math.min(1, 1 - (finalization.diagnostics["cohesionSkipped"] as number) / Math.max(1, finalization.tracks.length + (finalization.diagnostics["cohesionSkipped"] as number))))
        : null,
      failureReason: finalTracks.length === 0 ? "no_final_tracks_after_filters" : null,
    };
    setGenerateStageDetail(
      generateSessionUserId,
      requestId,
      `Found ${(scoringPool.hybridPoolSize ?? pipeline.sorted.length).toLocaleString()} matching tracks`
    );
    stageTimer.end("Playlist pipeline complete", {
      totalMs: Date.now() - startMs,
      totalSongs: likedSongs.length,
      hybridPool: scoringPool.hybridPoolSize,
      poolCapped: scoringPool.poolCapped,
      excluded: pipeline.hybridExcludedCount,
      finalTracks: finalTracks.length,
    });
    req.log.info(
      {
        elapsedMs: Date.now() - startMs,
        trackCount: finalTracks.length,
        poolSize: scoringPool.hybridPoolSize,
      },
      "Playlist composed"
    );

    const explanation = buildGenerationExplanation({
      profile: emotionProfile,
      vibe,
      journeyArc,
      experienceScene,
      mixedEmotions,
      promptConfidence,
      socialContext: undefined,
      season: undefined,
    });

    const momentUnderstanding = buildMomentUnderstanding({
      vibe,
      profile: emotionProfile,
      journeyArc,
      destParse,
      mixedEmotions,
      explanation,
      experienceScene,
      socialContext: undefined,
      season: undefined,
      librarySize: likedSongs.length,
      tracksSelected: finalTracks.length,
      rediscoveryMode,
      chapterLabel: chapterMatch?.chapter.label ?? null,
      surpriseMix,
      archaeologyActive: !!archaeology,
    });

    req.log.info(
      {
        poolAfterStructure: structured.length,
        afterDeadZone: afterDeadZone.length,
        afterSmoothing: afterSmoothing.length,
        afterArtistSep: afterArtistSep.length,
        finalTracks: finalTracks.length,
      },
      "Quality engine pipeline complete"
    );
    setGenerateStageDetail(generateSessionUserId, requestId, `Applying diversity rules to ${finalTracks.length.toLocaleString()} tracks`);

    publishPartialTracks(finalTracks);
    const recoveredBeforeEmptyCheck = applyLowComplexityRecovery("pre_empty_playlist_error");
    if (recoveredBeforeEmptyCheck) {
      humanCoherence = humanCoherenceScore(finalTracks, curatorIdentity);
      generationDiagnostics.humanCoherenceScore = humanCoherence.score;
      generationDiagnostics.humanCoherenceComponents = humanCoherence.components;
      generationDiagnostics.humanCoherenceReasons = humanCoherence.reasons;
      generationDiagnostics.majorExclusions = [
        ...clusterCuration.diagnostics.majorExclusions,
        ...humanCoherence.reasons,
      ];
    }
    generationDiagnostics.candidatesFinal = finalTracks.length;
    generationDiagnostics.promptSurvivability = {
      ...generationDiagnostics.promptSurvivability,
      postFinalizationSize: finalTracks.length,
      firstCollapseReason: generationDiagnostics.promptSurvivability.firstCollapseReason ??
        (finalTracks.length === 0 ? "finalization_empty" : null),
    };
    generationDiagnostics.softGuardDebugSummary = buildSoftGuardDebugSummary(finalTracks);
    req.log.info(
      {
        userId,
        vibe,
        poolSizes: {
          retrieval: generationDiagnostics.promptSurvivability.preFilterPoolSize,
          structuredRetrieval: generationDiagnostics.promptSurvivability.postStructuredRetrievalSize,
          contractFilter: generationDiagnostics.promptSurvivability.postContractFilterSize,
          finalizationInput: finalizationCandidates.length,
          finalOutput: finalTracks.length,
        },
        softGuardDebugSummary: generationDiagnostics.softGuardDebugSummary,
      },
      "Prompt generation pool-size trace"
    );
    generationDiagnostics.fallbackTriggered = generationDiagnostics.fallbackTriggered || !!finalization.diagnostics.fallbackMode;
    generationDiagnostics.fallbackLevel = fallbackLevelFromFinalization(finalization.diagnostics);
    generationDiagnostics.recoveryTriggered =
      generationDiagnostics.fallbackLevel !== "none" ||
      generationDiagnostics.recoveryRelaxations.length > 0;
    generationDiagnostics.failureReason = finalTracks.length === 0 ? "no_final_tracks_after_filters" : null;
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    if (finalTracks.length === 0) {
      const emergencySourcePool = strictEraEvidenceRelaxed && lockedIntent.eraRange
        ? [...finalizationCandidates, ...buildBroadRecoveryLibrary().filter((track) => !trackHasKnownEraMismatch(track, lockedIntent.eraRange!))]
        : [...finalCandidatePool, ...buildBroadRecoveryLibrary()];
      const emergencyPool = applyCuratorIdentityScoring(
        emergencySourcePool,
        curatorIdentity,
        sessionMemory,
        curatorScoringContext
      );
      const emergencyFinalization = finalizePlaylistTracks({
        initial: [],
        candidates: emergencyPool,
        requestedLength: length,
        vibe,
        intent: finalizationIntent,
        constraints: constraintLayer,
        allowHolidaySeason,
        classMap: userGenreProfile.trackClassifications,
        maxPerArtist,
      });
      if (emergencyFinalization.tracks.length > 0) {
        finalTracks = emergencyFinalization.tracks;
        finalization = {
          tracks: emergencyFinalization.tracks,
          diagnostics: {
            ...emergencyFinalization.diagnostics,
            fallbackMode: emergencyFinalization.diagnostics.fallbackMode ?? "emergency_hard_safe_return",
            recoveryTrigger: "pre_empty_playlist_error",
          },
        };
        finalValidation = validateLockedIntentOutput(
          finalTracks,
          lockedIntent,
          constraintLayer,
          userGenreProfile.trackClassifications
        );
        humanCoherence = humanCoherenceScore(finalTracks, curatorIdentity);
        generationDiagnostics.candidatesAfterRepair = finalization.tracks.length;
        generationDiagnostics.candidatesFinal = finalTracks.length;
        generationDiagnostics.fallbackTriggered = true;
        generationDiagnostics.failureReason = null;
        generationDiagnostics.recoveryRelaxations = [
          ...generationDiagnostics.recoveryRelaxations,
          "emergency_hard_safe_return",
        ];
        generationDiagnostics.fallbackLevel = fallbackLevelFromFinalization(finalization.diagnostics);
        generationDiagnostics.recoveryTriggered = true;
        generationDiagnostics.humanCoherenceScore = humanCoherence.score;
        generationDiagnostics.humanCoherenceComponents = humanCoherence.components;
        generationDiagnostics.humanCoherenceReasons = humanCoherence.reasons;
        publishPartialTracks(finalTracks);
        req.log.warn(
          { userId, vibe, finalCount: finalTracks.length, finalization: finalization.diagnostics },
          "Emergency hard-safe recovery prevented empty playlist"
        );
      }
    }
    if (finalTracks.length === 0) {
      const forensicPoolTrace = (scoringDiagnostics.v3Pipeline as Record<string, unknown> | undefined)?.["forensicPoolTrace"];
      req.log.warn(
        { userId, code: "EMPTY_POOL", forensicPoolTrace },
        "Hard filter graph removed all ranked candidates"
      );
      setGeneratePhase(generateSessionUserId, requestId, "error");
      if (respondIfStale(res, generateSessionUserId, requestId)) return;
        generateFail(
          res,
          400,
          "EMPTY_PLAYLIST",
        `I found ${generationDiagnostics.candidatesAfterConstraints.toLocaleString()} possible matches, but none survived the final playlist checks. Try broadening the prompt, using Balanced mode, or removing strict era words.`,
        {
          hint: "The final filter graph removed all ranked candidates.",
          generationDiagnostics,
          spotifyApiAudit: sideEffectPolicy.mode === "audit" ? getSpotifyApiAuditSnapshot() : undefined,
          suggestions: [
            "Broaden the prompt",
            "Use Balanced mode",
            "Remove strict era constraints",
          ],
          }
        );
        return;
    }

    if (respondIfStale(res, generateSessionUserId, requestId)) return;

    const playlistName = generatePlaylistName(vibe, emotionProfile);

    const trackObjects = finalTracks.map((t) => ({
      ...t,
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: t.albumName,
      albumArt: t.albumArt ?? null,
      durationMs: t.durationMs ?? null,
      energy: t.energy ?? null,
      valence: t.valence ?? null,
      tempo: t.tempo ?? null,
      danceability: t.danceability ?? null,
      acousticness: t.acousticness ?? null,
      instrumentalness: t.instrumentalness ?? null,
      speechiness: t.speechiness ?? null,
      releaseYear: t.releaseYear ?? null,
      popularity: t.popularity ?? null,
      spotifyArtistGenres: Array.isArray(t.spotifyArtistGenres) ? t.spotifyArtistGenres : [],
      albumGenres: Array.isArray(t.albumGenres) ? t.albumGenres : [],
      genrePrimary: t.genrePrimary ?? null,
      genreFamily: t.genreFamily ?? t.genrePrimary ?? null,
      genres: Array.isArray(t.genres) && t.genres.length > 0
        ? t.genres
        : t.genrePrimary
          ? [t.genrePrimary]
          : [],
      laneId: t.laneId ?? t.sourceLane ?? null,
      laneScore: t.laneScore ?? null,
      laneEra: t.laneEra ?? null,
      clusterId: t.clusterId ?? null,
      clusterIds: t.clusterIds ?? [],
    }));

    setGeneratePhase(generateSessionUserId, requestId, "spotify");
    setGenerateStageDetail(generateSessionUserId, requestId, `Finalising ${finalTracks.length.toLocaleString()} tracks`);
    let spotifyPlaylistUrl: string | null = null;
    const tSpotify = Date.now();
    req.log.info(
      { trackCount: finalTracks.length, devMode },
      devMode ? "Skipping Spotify playlist creation in dev mode" : "Creating Spotify playlist"
    );

    let spotifyPartial = false;
    let spotifyTracksAdded: number | undefined;

    if (sideEffectPolicy.allowSpotifyPlaylistCreate && !devMode && !staleGenerate(generateSessionUserId, requestId)) {
      try {
        const freshTokens = await getValidAccessToken(
          req.session.spotifyTokens!,
          userId
        );
        if (freshTokens.accessToken !== req.session.spotifyTokens!.accessToken) {
          req.session.spotifyTokens = freshTokens;
        }
        const trackUris = finalTracks.map((t) => `spotify:track:${t.trackId}`);
        const pendingId = getPendingSpotifyPlaylistId(userId);
        const spotifyResult = await createSpotifyPlaylist(
          freshTokens.accessToken,
          userId,
          playlistName,
          trackUris,
          {
            existingPlaylistId: pendingId,
            onPlaylistCreated: (id) =>
              setPendingSpotifyPlaylistId(generateSessionUserId, requestId, id),
          }
        );
        spotifyPartial = !!spotifyResult.partial;
        spotifyTracksAdded = spotifyResult.tracksAdded;
        if (spotifyPartial && (spotifyTracksAdded ?? 0) === 0) {
          spotifyPlaylistUrl = null;
          req.log.warn(
            {
              elapsedMs: Date.now() - tSpotify,
              playlistId: spotifyResult.id,
              tracksRequested: finalTracks.length,
              reused: !!pendingId,
            },
            "Spotify playlist shell created but no tracks were added"
          );
        } else {
          clearPendingSpotifyPlaylist(generateSessionUserId, requestId);
          spotifyPlaylistUrl = spotifyResult.url;
        }
        req.log.info(
          {
            elapsedMs: Date.now() - tSpotify,
            partial: spotifyPartial,
            tracksAdded: spotifyTracksAdded,
            tracksRequested: finalTracks.length,
            reused: !!pendingId,
          },
          "Spotify playlist created"
        );
      } catch (spotifyErr: any) {
        req.log.warn(
          {
            code: "SPOTIFY_CREATE_FAILED",
            err: spotifyErr?.message,
            status: spotifyErr?.response?.status,
          },
          "Spotify playlist creation failed — degrading gracefully"
        );
      }
    }


    setGeneratePhase(generateSessionUserId, requestId, sideEffectPolicy.allowSavedPlaylistWrites ? "saving" : "done");
    setGenerateStageDetail(generateSessionUserId, requestId, sideEffectPolicy.allowSavedPlaylistWrites ? "Saving playlist" : "Audit mode: skipping playlist writes");
    const tSave = Date.now();
    req.log.info(
      { auditMode: sideEffectPolicy.mode === "audit" },
      sideEffectPolicy.allowSavedPlaylistWrites ? "Saving playlist to database" : "Skipping playlist database writes",
    );

    const profilePayload = {
      ...emotionProfile,
      journeyArc,
      librarySize: likedSongs.length,
    };
    let savedPlaylistId = 0;
    if (sideEffectPolicy.allowSavedPlaylistWrites) {
    const insertResult = await db
      .insert(savedPlaylistsTable)
      .values({
        userId,
        name: playlistName,
        emotionProfile: profilePayload as any,
        tracks: trackObjects as any,
        spotifyUrl: spotifyPlaylistUrl,
        vibe,
        mode,
      })
      .returning({ id: savedPlaylistsTable.id });
      savedPlaylistId = insertResult[0]?.id ?? 0;
    }

    req.log.info(
      { ms: Date.now() - tSave, userId, playlistId: savedPlaylistId, trackCount: finalTracks.length },
      "Playlist saved to DB"
    );
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;

    if (sideEffectPolicy.allowHistoryWrites) {
    try {
      await db.insert(playlistHistoryTable).values({
        spotifyUserId: userId,
        playlistId: spotifyPlaylistUrl?.split("/").pop() ?? `kwalify-${savedPlaylistId}`,
        playlistUrl: spotifyPlaylistUrl ?? publicUrl(`/p/${savedPlaylistId}`),
        name: playlistName,
        vibe,
        mode,
        trackCount: finalTracks.length,
        emotionProfile: { ...emotionProfile, journeyArc } as any,
        trackIds: finalTracks.map((t) => t.trackId) as any,
      });
    } catch (histErr) {
      req.log.warn({ err: histErr }, "playlist_history insert failed");
    }
    }

    const spotifyFields = spotifyPlaylistUrl
      ? {
          spotifyPlaylistUrl,
          ...(spotifyPartial
            ? { spotifyPartial: true as const, spotifyTracksAdded: spotifyTracksAdded ?? 0 }
            : {}),
        }
      : { spotifyUnavailable: true as const };

    const totalDurationMs = finalTracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
    const artistCount = new Set(finalTracks.map((t) => t.artistName)).size;
    const generationMs = Date.now() - startMs;

    const datedLikes = likedSongs.filter((s) => s.addedAt);
    const recentCutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
    const recentLikeShare =
      datedLikes.length > 0
        ? datedLikes.filter((s) => s.addedAt!.getTime() > recentCutoff).length / datedLikes.length
        : 0;
    const librarySyncHint =
      !noLibraryMode && datedLikes.length >= 200 && recentLikeShare > 0.85
        ? "Most cached likes look recently added. Run a full library sync from the app so older favourites are included."
        : null;
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;

    const v3Diagnostics = formatV3DiagnosticsForApi(
      pipeline.scoringDiagnostics?.v3Pipeline,
      vibe
    );
    const promptDriftAudit = buildPromptDriftAudit(v3Diagnostics);
    const feedbackDiagnostics = buildFeedbackDiagnostics(feedbackMemory, finalTracks);
    if (promptDriftAudit["pass"] === false) {
      req.log.warn(
        { userId, vibe, promptDriftAudit, playlistQuality: v3Diagnostics?.["playlistQuality"] ?? null },
        "Prompt drift audit warning"
      );
    }
    assertQualityConsistency(req.log, {
      tracks: finalTracks,
      diagnostics: v3Diagnostics,
      fallbackUsed: !!pipeline.scoringDiagnostics?.fastFallback,
    });

    if (!varietyBoost && !devMode) {
      const cachedFinalTracks = finalTracks.map((t) => ({
        ...t,
          trackId: t.trackId,
          trackName: t.trackName,
          artistName: t.artistName,
          albumName: t.albumName,
          albumArt: t.albumArt ?? null,
          durationMs: t.durationMs ?? null,
          energy: t.energy ?? null,
          valence: t.valence ?? null,
          tempo: t.tempo ?? null,
        danceability: t.danceability ?? null,
        acousticness: t.acousticness ?? null,
        instrumentalness: t.instrumentalness ?? null,
        speechiness: t.speechiness ?? null,
        releaseYear: t.releaseYear ?? null,
        popularity: t.popularity ?? null,
        spotifyArtistGenres: Array.isArray(t.spotifyArtistGenres) ? t.spotifyArtistGenres : [],
        albumGenres: Array.isArray(t.albumGenres) ? t.albumGenres : [],
          score: Math.round(t.score * 100) / 100,
          rediscoveryScore: t.rediscoveryScore,
          narrativeRole: t.narrativeRole,
        genrePrimary: t.genrePrimary ?? null,
        genreFamily: t.genreFamily ?? t.genrePrimary ?? null,
        genres: Array.isArray(t.genres) && t.genres.length > 0
          ? t.genres
          : t.genrePrimary
            ? [t.genrePrimary]
            : [],
        laneId: t.laneId ?? t.sourceLane ?? null,
        sourceLane: t.sourceLane ?? t.laneId ?? null,
        laneScore: t.laneScore,
        laneEra: t.laneEra,
        clusterId: t.clusterId ?? t.clusterIds?.[0] ?? null,
        clusterIds: t.clusterIds ?? (t.clusterId ? [t.clusterId] : []),
      }));
      warnIfV3MetadataLost(
        finalTracks,
        cachedFinalTracks,
        "cache-write"
      );
      warnIfFieldDropped("laneScore", finalTracks, cachedFinalTracks, "cache-write");
      warnIfFieldDropped("clusterIds", finalTracks, cachedFinalTracks, "cache-write");
    }

    setGeneratePhase(generateSessionUserId, requestId, "done");
    if (respondIfStale(res, generateSessionUserId, requestId)) return;

    req.log.info(
      {
        elapsedMs: Date.now() - startMs,
        cacheHit: false,
        trackCount: finalTracks.length,
        poolSize: scoringPool.hybridPoolSize,
        promptDriftAudit,
        feedbackDiagnostics,
      },
      "Generation complete"
    );
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;

    const finalApiTracks = formatTracksForApi(finalTracks, emotionProfile);
    const finalGenreDistribution = finalApiTracks.reduce<Record<string, number>>(
      (acc, track) => incrementDistribution(acc, track.genrePrimary ?? track.genreFamily ?? track.genres?.[0]),
      {},
    );
    const finalEraDistribution = finalApiTracks.reduce<Record<string, number>>(
      (acc, track) => incrementDistribution(acc, eraBucket(track.releaseYear)),
      {},
    );
    const finalMoodDistribution = finalApiTracks.reduce<Record<string, number>>(
      (acc, track) => incrementDistribution(acc, moodBucket(track.energy, track.valence)),
      {},
    );
    const finalEnergyDistribution = finalApiTracks.reduce<Record<string, number>>(
      (acc, track) => incrementDistribution(acc, energyBucket(track.energy)),
      {},
    );
    const artistDiversity = artistDiversityDiagnostics(finalTracks, maxPerArtist);
    const playlistQuality = (v3Diagnostics?.playlistQuality ?? null) as Record<string, unknown> | null;
    const coherenceDiagnostics = (v3Diagnostics?.playlistCoherence ?? null) as Record<string, unknown> | null;
    const qualitySignals = [
      typeof playlistQuality?.["overall"] === "number" ? playlistQuality["overall"] as number : null,
      typeof playlistQuality?.["promptAlignment"] === "number" ? playlistQuality["promptAlignment"] as number : null,
      typeof playlistQuality?.["genrePurity"] === "number" ? playlistQuality["genrePurity"] as number : null,
      typeof playlistQuality?.["eraAlignment"] === "number" ? playlistQuality["eraAlignment"] as number : null,
      typeof coherenceDiagnostics?.["avg_transition_score"] === "number" ? coherenceDiagnostics["avg_transition_score"] as number : null,
    ].filter((value): value is number => value !== null && Number.isFinite(value));
    const recoveryPenalty = generationDiagnostics.recoveryRelaxations.length > 0 ? 0.10 : 0;
    const fallbackPenalty = generationDiagnostics.fallbackTriggered ? 0.12 : 0;
    const underfilledPenalty = finalTracks.length < length ? Math.min(0.20, (length - finalTracks.length) / Math.max(1, length) * 0.5) : 0;
    const diversityPenalty = (artistDiversity.cappedTracks > 0 ? 0.10 : 0) +
      (finalization.diagnostics["artistLimitRelaxed"] ? 0.04 : 0) +
      (finalization.diagnostics["albumLimitRelaxed"] ? 0.03 : 0);
    const coherencePenalty = typeof coherenceDiagnostics?.["avg_position_shift"] === "number" &&
      (coherenceDiagnostics["avg_position_shift"] as number) > Math.max(8, length * 0.35)
      ? 0.05
      : 0;
    const fillRatio = Math.min(1, finalTracks.length / Math.max(1, length));
    const confidenceScore = Math.max(
      0.05,
      Math.min(
        0.99,
        (qualitySignals.length
          ? qualitySignals.reduce((sum, value) => sum + value, 0) / qualitySignals.length
          : fillRatio * 0.72 + 0.18) - recoveryPenalty - fallbackPenalty - underfilledPenalty - diversityPenalty - coherencePenalty
      )
    );
    const playlistConfidence = {
      score: Math.round(confidenceScore * 100) / 100,
      percent: Math.round(confidenceScore * 100),
      label: confidenceScore >= 0.78
        ? "Strong match"
        : confidenceScore >= 0.58
          ? "Good match"
          : "Best available match",
      recoveryUsed: generationDiagnostics.recoveryTriggered,
      fallbackUsed: generationDiagnostics.fallbackTriggered,
    };
    if (sideEffectPolicy.allowSavedPlaylistWrites && savedPlaylistId > 0) {
    try {
      await db
        .update(savedPlaylistsTable)
        .set({
          emotionProfile: {
            ...(profilePayload as Record<string, unknown>),
            generationSummary: {
              confidence: playlistConfidence,
              generationDiagnostics: {
                initialLibrarySize: generationDiagnostics.initialLibrarySize,
                candidatesSampled: generationDiagnostics.candidatesSampled,
                candidatesFinal: generationDiagnostics.candidatesFinal,
                largestDrop: generationDiagnostics.largestDrop,
                recoveryRelaxations: generationDiagnostics.recoveryRelaxations,
                recoveryTriggered: generationDiagnostics.recoveryTriggered,
                fallbackLevel: generationDiagnostics.fallbackLevel,
                sessionCancelled: generationDiagnostics.sessionCancelled,
                fallbackTriggered: generationDiagnostics.fallbackTriggered,
              },
              artistDiversity,
            },
          } as any,
        })
        .where(eq(savedPlaylistsTable.id, savedPlaylistId));
    } catch (err) {
      req.log.warn({ err, savedPlaylistId }, "Failed to persist generation summary for gallery");
    }
    }
    const v3DiagnosticPayload = ((scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {}) as Record<string, unknown>;
    const compactScoringDiagnostics = compactScoringDiagnosticsForApi(scoringDiagnostics);
    const noLibrarySpotifyDiagnostics = noLibraryMode
      ? {
          searched: noLibraryExplicitFamilies.length > 0,
          expectedFamilies: noLibraryExplicitFamilies,
          candidateCount: noLibrarySpotifyCandidateCount,
          verifiedCandidateCount: noLibrarySpotifyVerifiedCount,
          fallbackReason: noLibrarySpotifyFallbackReason,
          retrievalCompletion: noLibraryRetrievalDiagnostics,
        }
      : null;
    const strictGenreEvidencePublic = {
      ...strictGenreEvidenceDiagnostics,
      verified: undefined,
      compatible: undefined,
      relaxed: strictGenreEvidenceRelaxed,
    };
    const intentSurvivalDiagnostics = buildIntentSurvivalDiagnostics({
      prompt: vibe,
      lockedIntent,
      constraintLayer,
      emotionProfile,
      finalTracks,
      classMap: userGenreProfile.trackClassifications,
      v3Diagnostics,
      generationDiagnostics: generationDiagnostics as Record<string, unknown>,
      finalizationDiagnostics: finalization.diagnostics as Record<string, unknown>,
      finalValidation: finalValidation as unknown as Record<string, "PASS" | "FAIL">,
      strictGenreEvidence: strictGenreEvidencePublic,
      strictEraEvidence: strictEraEvidencePublic,
      noLibrarySpotify: noLibrarySpotifyDiagnostics,
      finalGenreDistribution,
      finalEraDistribution,
      finalMoodDistribution,
      finalEnergyDistribution,
    });
    await yieldToEventLoop();
    if (clientDisconnected || responseFinished(res) || staleGenerate(generateSessionUserId, requestId)) return;
    const v3DiagnosticsWithIntentSurvival = {
      ...(v3Diagnostics ?? {}),
      intentSurvival: intentSurvivalDiagnostics,
    };
    const generationAuditSnapshot = {
      prompt: vibe,
      mode,
      noLibraryMode: !!noLibraryMode,
      playlistId: savedPlaylistId,
      trackCount: finalTracks.length,
      cacheDiagnostics: {
        status: cacheEntryStatus,
        staleBypassed: cacheEntryStatus === "stale",
      },
      pool: {
        librarySize: scoringPool.librarySize,
        hybridPoolSize: scoringPool.hybridPoolSize,
        poolCapped: scoringPool.poolCapped,
      },
      finalGenreDistribution,
      finalEraDistribution,
      finalMoodDistribution,
      finalEnergyDistribution,
      promptDriftAudit,
      generationDiagnostics,
      artistDiversity,
      playlistConfidence,
      noLibrarySpotify: noLibrarySpotifyDiagnostics,
      strictGenreEvidence: strictGenreEvidencePublic,
      strictEraEvidence: strictEraEvidencePublic,
      finalization: finalization.diagnostics,
      playlistQuality: v3Diagnostics?.playlistQuality ?? null,
      explicitIntentRepair: ((v3Diagnostics ?? {}) as Record<string, unknown>)["explicitIntentRepair"] ?? null,
      feedbackDiagnostics,
      intentSurvival: intentSurvivalDiagnostics,
    };

    if (sideEffectPolicy.allowResultCacheWrites && !varietyBoost && !devMode && spotifyPlaylistUrl) {
      setCachedGenerateResult(resultCacheKey, {
        cacheVersion: "v30",
        playlistName,
        vibe,
        mode,
        finalTracks: trackObjects as any,
        emotionProfile: { ...emotionProfile, journeyArc },
        spotifyPlaylistUrl,
        v3Diagnostics: v3DiagnosticsWithIntentSurvival,
        generationDiagnostics,
        artistDiversity,
        playlistConfidence,
        cachedAt: Date.now(),
      });
    }

    res.json({
      success: true,
      playlistId: savedPlaylistId,
      auditMode: sideEffectPolicy.mode === "audit",
      spotifyApiAudit: sideEffectPolicy.mode === "audit" ? getSpotifyApiAuditSnapshot() : undefined,
      sideEffects: sideEffectPolicy.mode === "audit"
        ? {
            spotifyPlaylistCreate: "skipped",
            savedPlaylistWrites: "skipped",
            historyWrites: "skipped",
            feedbackWrites: "skipped",
            analyticsWrites: "skipped",
            resultCacheWrites: "skipped",
          }
        : undefined,
      ...spotifyFields,
      playlistName,
      name: playlistName,
      vibe,
      mode,
      noLibraryMode: !!noLibraryMode,
      noLibrarySpotify: noLibrarySpotifyDiagnostics,
      devMode,
      playlistConfidence,
      count: finalTracks.length,
      totalTracks: finalTracks.length,
      ...(fallbackReason ? { fallbackReason } : {}),
      generationMs,
      cacheDiagnostics: {
        status: cacheEntryStatus,
        staleBypassed: cacheEntryStatus === "stale",
      },
      stats: {
        trackCount: finalTracks.length,
        totalDurationMs,
        artistCount,
        generationMs,
      },
      emotionProfile: { ...emotionProfile, journeyArc },
      experienceScene,
      momentUnderstanding,
      emotionalIntelligence: momentPipeline
        ? {
            pipeline: momentPipeline.pipelineSummary,
            ...summarizePipeline({
              canonical: momentPipeline.canonicalScene,
              prototype: momentPipeline.prototype,
              intent: momentPipeline.intent,
              physics: momentPipeline.physics,
              graphPaths: momentPipeline.graph.propagationPath,
            }),
            sonicTraits: momentPipeline.sonicProfile?.traits ?? [],
            scoringDiagnostics: compactScoringDiagnostics,
            genreAudit,
          }
        : {
            scoringDiagnostics: compactScoringDiagnostics,
            genreAudit,
            genreIntelligence: {
              ontologyNodes: genreStack.stats.ontologyNodes,
              microGenres: genreStack.stats.microGenreCount,
              embeddingVersion: genreStack.stats.embeddingVersion,
            },
          },
      explanation,
      promptConfidence,
      libraryIntelligence: {
        rediscoveryMode,
        archaeology: archaeology
          ? { concept: archaeology.concept, label: archaeology.label }
          : null,
        chapter: chapterMatch
          ? {
              id: chapterMatch.chapter.id,
              label: chapterMatch.chapter.label,
              trackCount: chapterMatch.chapter.trackIds.length,
            }
          : null,
        surpriseMix,
        chaptersAvailable: musicChapters.length,
        userGenreVector: userGenreProfile.vector,
        dominantGenres: userGenreProfile.dominant,
        genreAudit,
        genreIntelligence: {
          ontologyNodes: genreStack.stats.ontologyNodes,
          ontologyTargetMet: genreStack.stats.ontologyTargetMet,
          ontologyEdges: genreStack.stats.ontologyEdges,
          microGenres: genreStack.stats.microGenreCount,
          topMicroLabels: genreStack.stats.topMicroLabels,
          embeddingVersion: genreStack.stats.embeddingVersion,
          vectorStoreSizes: genreStack.stats.vectorStoreSizes,
          strengthenedEdges: genreStack.userLayer.strengthenedEdges.length,
        },
      },
      vibeKind,
      journeyArc,
      referenceMatch: referenceFingerprint
        ? {
            playlistId: referencePlaylistId,
            sampleCount: referenceFingerprint.sampleCount,
            valence: Math.round(referenceFingerprint.valence * 100) / 100,
            energy: Math.round(referenceFingerprint.energy * 100) / 100,
          }
        : null,
      referencePlaylistWarning: referencePlaylist && !referenceFingerprint
        ? "Could not read that reference playlist. If it is public, try the open.spotify.com link; if it is yours, log out and back in to refresh permissions. Generation used your text vibe only."
        : null,
      librarySyncHint,
      tracks: finalApiTracks,
      finalGenreDistribution,
      finalEraDistribution,
      finalMoodDistribution,
      finalEnergyDistribution,
      generationDiagnostics,
      artistDiversity,
      feedbackDiagnostics,
      promptDriftAudit,
      strictGenreEvidence: strictGenreEvidencePublic,
      strictEraEvidence: strictEraEvidencePublic,
      intentSurvival: intentSurvivalDiagnostics,
      generationAuditSnapshot,
      requestOrchestration: pipeline.requestOrchestration ?? {
        layer: "request",
        candidateGenerator: fallbackReason ? "fast_fallback" : "v3",
        selectionOwner: "request-layer",
        repairOwner: "request-layer",
      },
      sceneDetection: pipeline.ecosystemDebug
        ? {
            sceneId: pipeline.ecosystemDebug.sceneId,
            sceneLabel: pipeline.ecosystemDebug.sceneLabel,
            sceneConfidence: pipeline.ecosystemDebug.sceneConfidence,
            locked: pipeline.ecosystemDebug.locked,
            primaryEcosystem: pipeline.ecosystemDebug.primaryEcosystem,
            flowPhases: pipeline.ecosystemDebug.flowPhases,
            ecosystemCompliance: pipeline.ecosystemDebug.ecosystemCompliance,
          }
        : null,
      v3Diagnostics: v3DiagnosticsWithIntentSurvival,
      ...(pipeline.scoringDiagnostics?.fastFallback
        ? { fastFallback: true }
        : {}),
      ...(debugMode
        ? {
            _debug: {
              noLibraryMode: !!noLibraryMode,
              scoringWeights: "semantic:0.40_emotion:0.20_scene:0.15_aesthetic:0.10_library:0.10_genre:0.05",
              noLibraryWeights: noLibraryMode ? "semantic:0.55_emotion:0.20_scene:0.15_aesthetic:0.10" : null,
              scoringDiagnostics: compactScoringDiagnostics,
              ecosystemDebug: pipeline.ecosystemDebug,
              semanticScene: (scoringDiagnostics as Record<string, unknown>).semanticResolution ?? null,
              poolInfo: {
                librarySize: scoringPool.librarySize,
                hybridPoolSize: scoringPool.hybridPoolSize,
                poolCapped: scoringPool.poolCapped,
              },
              genreAudit,
              intentSurvival: intentSurvivalDiagnostics,
            },
            debug: {
              activePipeline: "v3.1_unified_routing",
              timing: {
                preV3Breakdown: preV3Timing,
              },
              qualitySignals: qualitySignalContext,
              constraints: {
                layer: constraintLayer,
                lockedIntent,
                finalValidation,
                strictEraEvidence: strictEraEvidencePublic,
                result: {
                  filteredCount: 0,
                  diversityWarning: false,
                  finalCount: finalTracks.length,
                },
              },
              v11: {
                role: "candidateGeneration",
                semanticResolution:
                  (scoringDiagnostics as Record<string, unknown>).semanticResolution ??
                  { sceneId: null, confidence: 0, fallback: true, sceneStatus: "fallback" },
                scoringModel:
                  (scoringDiagnostics as Record<string, unknown>).scoringModel ?? "v11",
                candidatePool: {
                  librarySize: scoringPool.librarySize,
                  hybridPoolSize: scoringPool.hybridPoolSize,
                  poolCapped: scoringPool.poolCapped,
                },
                candidateWeights: noLibraryMode
                  ? "semantic:0.55_emotion:0.20_scene:0.15_aesthetic:0.10"
                  : "semantic:0.40_emotion:0.20_scene:0.15_aesthetic:0.10_library:0.10_genre:0.05",
                topRankedCandidates:
                  (scoringDiagnostics as Record<string, unknown>).topScored ?? [],
                preV3TopCandidates:
                  v3DiagnosticPayload["preV3TopCandidates"] ?? [],
                exclusionReasons:
                  (scoringDiagnostics as Record<string, unknown>).exclusionReasons ?? {},
                dominantGenres:
                  (scoringDiagnostics as Record<string, unknown>).dominantGenres ?? [],
              },
              v3: (scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {},
              intentSurvival: intentSurvivalDiagnostics,
              waterfall: v3DiagnosticPayload["waterfall"] ?? null,
              removalReasons: v3DiagnosticPayload["removalReasons"] ?? [],
              retrievalPools: v3DiagnosticPayload["retrievalPoolsDetailed"] ?? null,
              intentContract: v3DiagnosticPayload["intentContract"] ?? null,
              fallbacks: v3DiagnosticPayload["fallbacks"] ?? [],
              noLibraryMode: !!noLibraryMode,
              poolInfo: {
                librarySize: scoringPool.librarySize,
                hybridPoolSize: scoringPool.hybridPoolSize,
                poolCapped: scoringPool.poolCapped,
              },
              genreAudit,
              systemDiagnostics: {
                v11Role:          "candidate_scoring_only",
                v3Role:           "final_selection_engine",
                uiAlignedTo:      "v3",
                debugTruthLevel:  "selection_based",
                consistencyCheck: "PASS",
                v11UsedFor: "candidateGeneration",
                v3UsedFor: "finalSelection",
                debugPanelAligned: true,
                pipelineConsistency: "OK",
              },
            },
          }
        : {}),
    });
    } finally {
      genStageTimer?.dispose();
      cleanupClientDisconnectListeners?.();
      if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (sessionUserId && requestId) {
        endGenerateSession(sessionUserId, requestId);
      }
    }
  } catch (fatalErr: any) {
    cleanupClientDisconnectListeners?.();
    if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    req.log.error(
      { err: fatalErr?.message, code: "INTERNAL_ERROR", userId: sessionUserId },
      "Unhandled error in /generate"
    );
    const sessionWasCancelled = sessionUserId && requestId
      ? staleGenerate(sessionUserId, requestId)
      : false;
    if (sessionUserId && requestId) {
      setGeneratePhase(sessionUserId, requestId, "error");
      endGenerateSession(sessionUserId, requestId);
    }
    if (!responseFinished(res)) {
      if (sessionWasCancelled) {
        generateFail(
          res,
          409,
          "GENERATION_CANCELLED",
          "This generation was superseded or cancelled. Try again if you need a new playlist.",
          {
            generationDiagnostics: {
              recoveryTriggered: false,
              fallbackLevel: "none",
              sessionCancelled: true,
            },
          }
        );
        return;
      }
      const timedOut = Date.now() - startMs >= requestHardTimeoutMs - 1000;
      const ctx = (req as { _genCtx?: {
        likedSongs: { trackId: string; trackName: string; artistName: string; albumName: string }[];
        constrainedFallbackTracks?: { trackId: string; trackName: string; artistName: string; albumName: string }[];
        emotionProfile: EmotionProfile;
        length: number;
        maxPerArtist?: number;
        vibe: string;
        mode: string;
        noLibraryMode?: boolean;
        lockedIntent?: LockedIntent;
        constraintLayer?: ConstraintLayer;
        classMap?: Map<string, {
          genrePrimary: string;
          genreFamily: string;
          primarySubgenre: string;
          secondarySubgenre: string | null;
          subGenres: string[];
        }>;
        genreByTrack?: (trackId: string) => {
          genrePrimary?: string | null;
          genreFamily?: string | null;
          genres?: string[] | null;
        } | null;
        trackReusePenalty?: Map<string, number>;
        artistReusePenalty?: Map<string, number>;
      } })._genCtx;
      if (timedOut && ctx?.likedSongs?.length) {
        const maxPerArtist = ctx.maxPerArtist ?? artistDiversityCap(ctx.length, ctx.vibe);
        const fallbackTracks = ctx.constrainedFallbackTracks?.length
          ? ctx.constrainedFallbackTracks
          : ctx.likedSongs;
        const pipeline = buildFallbackPipelineResult({
          tracks: fallbackTracks as Parameters<typeof buildFallbackPipelineResult>[0]["tracks"],
          emotionProfile: ctx.emotionProfile,
          playlistLength: ctx.length,
          maxPerArtist,
          librarySize: fallbackTracks.length,
          genreByTrack: ctx.genreByTrack,
        });
        const finalizedFallback = ctx.lockedIntent && ctx.constraintLayer && ctx.classMap
          ? finalizePlaylistTracks({
              initial: pipeline.finalTracks as ConstraintTrack[],
              candidates: fallbackTracks.map((track) => ({ ...track, score: 0.6 } as ConstraintTrack)),
              requestedLength: ctx.length,
              vibe: ctx.vibe,
              intent: ctx.lockedIntent,
              constraints: ctx.constraintLayer,
              classMap: ctx.classMap,
              maxPerArtist,
              trackReusePenalty: ctx.trackReusePenalty,
              artistReusePenalty: ctx.artistReusePenalty,
            }).tracks
          : pipeline.finalTracks;
        const strictFallbackFailure = explicitGenreFallbackFailure({
          vibe: ctx.vibe,
          requestedCount: ctx.length,
          finalCount: finalizedFallback.length,
          hasGenreAwarePool: !!ctx.constrainedFallbackTracks?.length && !!ctx.genreByTrack,
          noLibraryMode: !!ctx.noLibraryMode,
        });
        if (strictFallbackFailure && finalizedFallback.length === 0) {
          res.status(409).json({
            success: false,
            error: strictFallbackFailure.error,
            code: strictFallbackFailure.code,
            strictGenreEvidence: strictFallbackFailure.details,
            tracks: [],
          });
          return;
        }
        const playlistName = generatePlaylistName(ctx.vibe, ctx.emotionProfile);
        res.json({
          success: true,
          fastFallback: true,
          code: "TIMEOUT_FALLBACK",
          playlistName,
          name: playlistName,
          vibe: ctx.vibe,
          mode: ctx.mode,
          count: finalizedFallback.length,
          totalTracks: finalizedFallback.length,
          spotifyUnavailable: true,
          generationDiagnostics: {
            recoveryTriggered: true,
            fallbackLevel: "soft",
            sessionCancelled: false,
          },
          tracks: formatTracksForApi(finalizedFallback, ctx.emotionProfile),
        });
      } else {
        res.status(timedOut ? 504 : 500).json({
          success: false,
          error: timedOut
            ? "Generation took too long. Try Balanced mode or regenerate in a moment."
            : "An unexpected error occurred. Please try again.",
          code: timedOut ? "TIMEOUT" : "INTERNAL_ERROR",
          tracks: [],
          generationDiagnostics: {
            recoveryTriggered: false,
            fallbackLevel: "none",
            sessionCancelled: false,
          },
        });
      }
    }
  }
});

export default router;
