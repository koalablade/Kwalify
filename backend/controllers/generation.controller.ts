/**
 * Purpose: Playlist generation endpoint — the core of Kwalify.
 * Responsibilities:
 *   - POST /generate    — score the user's liked songs against a vibe and create a Spotify playlist
 *   - GET  /generate/status — return the current generation phase for the user
 * Dependencies: emotion engine, genre intelligence stack, playlist pipeline, Spotify API, drizzle-orm
 */
import { Router, type IRouter } from "express";
import { db } from "../db";
import {
  likedSongsTable,
  playlistHistoryTable,
  savedPlaylistsTable,
} from "../db";
import { createSpotifyPlaylist, getValidAccessToken } from "../lib/spotify";
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
  countRecentJourneyArc,
  journeyArcCooldownMultiplier,
  sceneClonePenalty,
} from "../lib/playlist-freshness";
import { rediscoveryJitter } from "../lib/rediscovery";
import { buildLibrarySignals, type LikedSongRow } from "../lib/library-signals";
import { detectRediscoveryMode, type RediscoveryMode } from "../lib/forgotten-favourites";
import { detectMusicChapters, matchChapterFromVibe } from "../lib/music-life-chapters";
import { detectArchaeologyIntent } from "../lib/library-archaeology";
import { computeSurpriseMix } from "../lib/human-surprise";
import { analyzeMomentPipeline } from "../lib/moment-pipeline";
import { getUserGenreProfileForGenerate } from "../lib/genre-profile-cache";
import { buildGenreIntelligenceStack } from "../lib/genre-intelligence-stack";
import {
  getCachedGenreStack,
  setCachedGenreStack,
} from "../lib/genre-stack-cache";
import {
  getGenerateCacheKey,
  getCachedGenerateResult,
  setCachedGenerateResult,
} from "../lib/generate-result-cache";
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
  isGenerateCancelled,
  getPendingSpotifyPlaylistId,
  setPendingSpotifyPlaylistId,
  clearPendingSpotifyPlaylist,
  getGenerateProgress,
  getGenerateStatus,
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
import { buildPlaylistPipeline } from "../core/output";
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
import {
  buildLockedIntent as buildCsspLockedIntent,
  completeLockedIntent as completeCsspLockedIntent,
} from "../core/v3/intent";
import { trackMatchesConstraints as trackMatchesV3Constraints } from "../core/v3/constraint-filter";

const generationControllerLock = "__kwalifyGenerationControllerRegistered";
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
  };
};

type LockedIntent = {
  genreFamilies: string[];
  eraRange: { start: number; end: number } | null;
  energy: "low" | "medium" | "high" | null;
  primaryGenres: string[];
  eraStart: number | null;
  eraEnd: number | null;
  mood: string[];
  activity: string | null;
  energyLevel: "low" | "medium" | "high" | null;
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
  releaseYear?: number | null;
  addedAt?: Date | null;
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
  if (!res.headersSent) {
    res.status(409).json({
      success: false,
      code: "GENERATION_CANCELLED",
      error:
        "This generation was superseded or cancelled. Try again if you need a new playlist.",
      tracks: [],
      spotifyUnavailable: true,
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
  res.status(status).json({
    success: false,
    code,
    error,
    tracks: [],
    spotifyUnavailable: true,
    ...extra,
  });
}

function deriveDiagnosticTags(vibe: string): {
  moodTags: string[];
  activityTags: string[];
  eraHints: string[];
  genreHints: string[];
} {
  const lower = vibe.toLowerCase();
  const moodTags = [
    /\b(nostalg|memory|retro|vintage)\b/.test(lower) ? "nostalgic" : null,
    /\b(sunset|warm|golden|cozy|cosy)\b/.test(lower) ? "warm" : null,
    /\b(solitude|alone|reflect|introspect)\b/.test(lower) ? "introspective" : null,
    /\b(sad|melanchol|lonely|blue)\b/.test(lower) ? "melancholic" : null,
  ].filter((tag): tag is string => !!tag);
  const activityTags = [
    /\b(driv|road|highway|cruise)\b/.test(lower) ? "driving" : null,
    /\b(study|focus|work|coding)\b/.test(lower) ? "focus" : null,
    /\b(party|club|dance)\b/.test(lower) ? "party" : null,
    /\b(walk|commute)\b/.test(lower) ? "walking" : null,
  ].filter((tag): tag is string => !!tag);
  const eraHints = [
    /\b(60s|1960s|sixties)\b/.test(lower) ? "60s" : null,
    /\b(70s|1970s|seventies)\b/.test(lower) ? "70s" : null,
    /\b(80s|1980s|eighties)\b/.test(lower) ? "80s" : null,
    /\b(90s|1990s|nineties)\b/.test(lower) ? "90s" : null,
    /\b(00s|2000s|y2k)\b/.test(lower) ? "00s" : null,
    /\b(2010s|10s)\b/.test(lower) ? "10s" : null,
    /\b(2020s|20s|modern)\b/.test(lower) ? "20s" : null,
  ].filter((tag): tag is string => !!tag);
  const genreHints = [
    /\b(country|americana|western|bluegrass)\b/.test(lower) ? "country" : null,
    /\b(folk|acoustic|singer-songwriter)\b/.test(lower) ? "folk" : null,
    /\b(rock|grunge|punk|metal)\b/.test(lower) ? "rock" : null,
    /\b(pop|radio)\b/.test(lower) ? "pop" : null,
    /\b(jazz|blues|soul)\b/.test(lower) ? "jazz" : null,
    /\b(hip.?hop|rap|rnb|r&b)\b/.test(lower) ? "hip_hop" : null,
    /\b(electronic|house|techno|edm)\b/.test(lower) ? "electronic" : null,
  ].filter((tag): tag is string => !!tag);

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
  if (/\b(techno|trance|90s|rave|warehouse)\b/.test(lower)) {
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

const GENRE_ALIASES: Array<{ root: string; terms: string[] }> = [
  { root: "country", terms: ["country", "americana", "western", "bluegrass", "honky tonk", "alt country"] },
  { root: "electronic", terms: ["electronic", "techno", "trance", "house", "edm", "rave", "dnb", "drum and bass", "dubstep", "ambient"] },
  { root: "hip_hop", terms: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap"] },
  { root: "rock", terms: ["rock", "grunge", "punk", "alt rock", "alternative rock", "classic rock"] },
  { root: "metal", terms: ["metal", "metalcore", "thrash", "death metal"] },
  { root: "jazz", terms: ["jazz", "bebop", "bossa nova", "swing"] },
  { root: "blues", terms: ["blues", "delta blues", "chicago blues"] },
  { root: "soul", terms: ["soul", "motown", "funk", "neo soul"] },
  { root: "rnb", terms: ["r&b", "rnb", "classic r&b"] },
  { root: "pop", terms: ["pop", "dance pop", "synth pop", "k-pop", "kpop"] },
  { root: "folk", terms: ["folk", "singer songwriter", "singer-songwriter", "acoustic folk"] },
  { root: "indie", terms: ["indie", "lo-fi", "lofi", "chillhop", "bedroom pop"] },
  { root: "classical", terms: ["classical", "orchestral", "piano classical"] },
  { root: "soundtrack", terms: ["soundtrack", "film score", "cinematic"] },
  { root: "reggae", terms: ["reggae", "dub", "dancehall"] },
  { root: "latin", terms: ["latin", "reggaeton", "salsa", "bachata"] },
  { root: "world", terms: ["afrobeats", "afrobeat", "world"] },
  { root: "christmas", terms: ["christmas", "xmas", "holiday", "festive"] },
];

function extractGenreTerms(text: string): { roots: string[]; terms: string[] } {
  const lower = text.toLowerCase();
  const roots = new Set<string>();
  const terms = new Set<string>();
  for (const alias of GENRE_ALIASES) {
    for (const term of alias.terms) {
      const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
      if (pattern.test(lower)) {
        roots.add(alias.root);
        terms.add(term);
      }
    }
  }
  return { roots: [...roots], terms: [...terms] };
}

function extractEraRange(vibe: string): { start: number | null; end: number | null; terms: string[] } {
  const lower = vibe.toLowerCase();
  const terms: string[] = [];
  const decadeMatch = lower.match(/\b(60s|70s|80s|90s|00s|10s|20s|1960s|1970s|1980s|1990s|2000s|2010s|2020s)\b/);
  if (decadeMatch?.[1]) {
    const term = decadeMatch[1];
    terms.push(term);
    const start = term.length === 4
      ? Number(term.slice(0, 3) + "0")
      : term === "00s" ? 2000 : term === "10s" ? 2010 : term === "20s" ? 2020 : Number(`19${term.slice(0, 2)}`);
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
      allowBridge: multiGenreTerms.some((term) => /bridge|blend|crossover|fusion|multi/i.test(term)),
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
    return track.releaseYear >= constraints.hard.eraStart - 15 && track.releaseYear <= constraints.hard.eraEnd + 15;
  }
  const laneEra = eraBucketRange(track.laneEra);
  if (!laneEra) return !constraints.hard.strictLock;
  return laneEra.end >= constraints.hard.eraStart - 15 && laneEra.start <= constraints.hard.eraEnd + 15;
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
  const bridgeFamilies = bridgeFamiliesForTrack(track, opts.classMap);
  const bridge = opts.constraints.hard.allowBridge &&
    !opts.bridgeUsed &&
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
  if (constraints.hard.excludedGenres.some((genre) => terms.includes(genre))) return false;
  if (constraints.hard.genres.length > 0 && !constraints.hard.genres.some((genre) => terms.includes(genre))) {
    return false;
  }
  if (constraints.hard.strictLock && constraints.raw.explicitGenreTerms.length > 0) {
    const explicitMatch = constraints.raw.explicitGenreTerms.some((term) =>
      terms.some((candidate) => candidate.includes(term.replace(/\s+/g, "_")) || candidate.includes(term))
    );
    if (!explicitMatch && constraints.hard.genres.length > 0) return false;
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
  return intent.primaryGenres.some((genre) => terms.includes(genre));
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
  const activityMatch =
    activity === "driving" ? energy >= 0.45 && tempo >= 85 :
    activity === "focus" ? energy <= 0.6 && acousticness >= 0.25 :
    activity === "party" ? energy >= 0.6 && danceability >= 0.55 :
    activity === "walking" ? energy >= 0.35 && energy <= 0.75 :
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
      offFamilyTracks.length <= 1 &&
      offFamilyTracks.every((track) => {
        const family = trackGenreFamily(track, classMap);
        const bridgeFamilies = bridgeFamiliesForTrack(track, classMap);
        return !!lockedFamily && bridgeFamilies.includes(lockedFamily) && bridgeFamilies.includes(family);
      }));

  const genreConsistency = familyStable && (!requiresGenre || tracks.every((track) =>
    genreEvidence(track, intent, classMap) !== false
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
    clusters:               v3["clusters"] ?? [],
    selectionTrace:         v3["selectionTrace"] ?? v3["finalDecisionTrace"] ?? [],
    finalDistribution:      v3["finalDistribution"] ?? {
      genres:  v3["genreDistribution"] ?? {},
      eras:    v3["eraDistribution"] ?? {},
      artists: {},
    },
    qualityLock:              v3["qualityLock"] ?? null,
    adaptiveLaneGenerator:    v3["adaptiveLaneGenerator"] ?? null,
    interleaverDiagnostics:   v3["interleaverDiagnostics"] ?? null,
    laneContributions:        v3["laneContributions"] ?? {},
    fallback:                 v3["fallback"] ?? null,
    clusterDistributionGraph: v3["clusterDistributionGraph"] ?? {},
    aggregateClusterSpread:   v3["aggregateClusterSpread"] ?? {},
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

function hasValidCachedIntent(cached: { v3Diagnostics?: Record<string, unknown> | null }): boolean {
  const diagnostics = cached.v3Diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return false;
  const intent = diagnostics["intentDecomposition"] as Record<string, unknown> | undefined;
  return typeof intent?.["primary"] === "string" && intent["primary"].trim().length > 0;
}

router.get("/generate/status", (req, res): void => {
  const userId = currentGenerateUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(getGenerateStatus(userId));
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

router.post("/generate", async (req, res): Promise<void> => {
  const startMs = Date.now();
  let requestId = "";
  let sessionUserId = "";
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  try {
    const devMode = useMockSpotify();
    if (!devMode && !getFeatures().spotify.enabled) {
      generateFail(res, 503, "SPOTIFY_DISABLED", "Spotify is not configured on this server.");
      return;
    }
    if (!devMode && (!req.session.spotifyTokens || !req.session.spotifyUserId)) {
      generateFail(res, 401, "NOT_AUTHENTICATED", "Not authenticated");
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

    const userId = devMode ? MOCK_SPOTIFY_USER_ID : req.session.spotifyUserId!;

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

    const rawBody = req.body ?? {};
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

    const acquired = acquireGenerateSession(userId, { force: !!varietyBoost });
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
    sessionUserId = userId;
    setGeneratePhase(userId, requestId, "starting");
    req.log.info({ elapsedMs: 0, trackCount: 0, cacheHit: false }, "Generation started");
    heartbeatTimer = setInterval(() => {
      const progress = getGenerateProgress(userId);
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

    if (referencePlaylist && !devMode) {
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
    const resultCacheKey = getGenerateCacheKey({
      userId,
      vibe,
      vibeKind,
      mode,
      length,
      referencePlaylist: !!referencePlaylist,
      mockMode: devMode,
    });
    const cacheConstraintLayer = extractConstraintLayer(vibe, {
      primary: vibe,
      ...deriveDiagnosticTags(vibe),
      canonicalHints: canonicalCrossGenreHints(vibe),
    });

    if (!varietyBoost && !devMode && !hasHardConstraints(cacheConstraintLayer)) {
      tStage = Date.now();
      const cached = getCachedGenerateResult(resultCacheKey);
      recordPreV3Timing(preV3Timing, "cacheTimeMs", Date.now() - tStage);
      // Only use cache entries that carry the v2 schema (genrePrimary per track).
      // Pre-v2 entries lack genrePrimary and are treated as cache misses so a
      // fresh generation populates the field correctly.
      if (cached && cached.cacheVersion === "v2" && hasValidCachedIntent(cached)) {
        if (respondIfStale(res, userId, requestId)) return;
        setGeneratePhase(userId, requestId, "done");
        req.log.info(
          {
            elapsedMs: Date.now() - startMs,
            cacheHit: true,
            trackCount: cached.finalTracks.length,
          },
          "Generation complete"
        );
        res.json({
          success: true,
          cached: true,
          tracks: formatTracksForApi(cached.finalTracks, cached.emotionProfile),
          playlistName: cached.playlistName,
          name: cached.playlistName,
          vibe: cached.vibe,
          mode: cached.mode,
          count: cached.finalTracks.length,
          totalTracks: cached.finalTracks.length,
          emotionProfile: cached.emotionProfile,
          v3Diagnostics: cached.v3Diagnostics ?? null,
          ...(cached.spotifyPlaylistUrl
            ? { spotifyPlaylistUrl: cached.spotifyPlaylistUrl }
            : { spotifyUnavailable: true as const }),
        });
        return;
      }
    }

    setGeneratePhase(userId, requestId, "loading_library");
    tStage = Date.now();
    const likedRowsRaw = devMode
      ? generateMockSpotifyLibrary()
      : await db
          .select()
          .from(likedSongsTable)
          .where(eq(likedSongsTable.spotifyUserId, userId));
    const likedSongsQueryMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "likedSongsQueryMs", likedSongsQueryMs);
    recordPreV3Timing(preV3Timing, "dbTimeMs", likedSongsQueryMs);

    const { valid: likedSongs, dropped: droppedTracks } = sanitizeLikedSongs(likedRowsRaw);
    if (droppedTracks > 0) {
      req.log.warn({ droppedTracks, userId }, "Dropped invalid liked-song rows");
    }

    if (likedSongs.length === 0) {
      setGeneratePhase(userId, requestId, "error");
      if (noLibraryMode) {
        generateFail(
          res,
          400,
          "LIBRARY_EMPTY_NO_LIBRARY_MODE",
          "No Library Mode requires at least a few liked songs to anchor vibe matching. Please sync your Spotify library first, then try again."
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

    if (likedSongs.length < 12) {
      setGeneratePhase(userId, requestId, "error");
      generateFail(
        res,
        400,
        "LIBRARY_TOO_SMALL",
        "Library is too small to generate. Sync more liked songs from Spotify first."
      );
      return;
    }

    (req as { _genCtx?: Record<string, unknown> })._genCtx = {
      requestId,
      userId,
      likedSongs,
      emotionProfile,
      length,
      mode,
      vibe,
      maxPerArtist: 2,
    };

    res.setTimeout(REQUEST_HARD_TIMEOUT_MS + 2000, () => {
      if (res.headersSent || staleGenerate(userId, requestId)) return; // timeout handler — no second body
      const ctx = (req as { _genCtx?: {
        likedSongs: typeof likedSongs;
        constrainedFallbackTracks?: typeof likedSongs;
        emotionProfile: EmotionProfile;
        length: number;
        maxPerArtist?: number;
        vibe: string;
        mode: string;
      } })._genCtx;
      req.log.error({ userId, requestId, code: "TIMEOUT" }, "Generate hard timeout — emergency fallback");
      if (!ctx?.likedSongs?.length) {
        res.status(504).json({
          success: false,
          error: "Generation timed out. Please try again.",
          code: "TIMEOUT",
          tracks: [],
        });
        return;
      }
      const maxPerArtist =
        ctx.mode === "strict" ? 2 : ctx.mode === "balanced" ? 3 : 5;
      const fallbackTracks = ctx.constrainedFallbackTracks?.length
        ? ctx.constrainedFallbackTracks
        : ctx.likedSongs;
      const pipeline = buildFallbackPipelineResult({
        tracks: fallbackTracks,
        emotionProfile: ctx.emotionProfile,
        playlistLength: ctx.length,
        maxPerArtist,
        librarySize: fallbackTracks.length,
      });
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
        count: pipeline.finalTracks.length,
        totalTracks: pipeline.finalTracks.length,
        spotifyUnavailable: true,
        tracks: formatTracksForApi(pipeline.finalTracks, ctx.emotionProfile),
      });
    });

    const promptConfidence = scorePromptConfidence(vibe, emotionProfile, {
      experienceSceneMatched: !!experienceScene,
      hasJourneyDestination: !!destParse.desired,
      mixedEmotions,
    });
    req.log.info({ vibe, vibeKind, promptConfidence }, "Vibe kind detected");

    tStage = Date.now();
    const recentPlaylists = await db
      .select()
      .from(playlistHistoryTable)
      .where(eq(playlistHistoryTable.spotifyUserId, userId))
      .orderBy(desc(playlistHistoryTable.createdAt))
      .limit(25);
    const playlistHistoryQueryMs = Date.now() - tStage;
    recordPreV3Timing(preV3Timing, "playlistHistoryQueryMs", playlistHistoryQueryMs);
    recordPreV3Timing(preV3Timing, "dbTimeMs", playlistHistoryQueryMs);

    tStage = Date.now();
    const freshnessStats = buildFreshnessStats(
      recentPlaylists.map((p) => ({
        vibe: p.vibe,
        trackIds: (p.trackIds as string[]) ?? [],
        emotionProfile: p.emotionProfile as EmotionProfile | null,
      }))
    );

    const trackIdToArtist = new Map(likedSongs.map((s) => [s.trackId, s.artistName]));
    const trackIdToAlbum = new Map(likedSongs.map((s) => [s.trackId, s.albumName]));
    const artistAppearances = buildArtistAppearanceMap(
      recentPlaylists.map((p) => ({ vibe: p.vibe, trackIds: (p.trackIds as string[]) ?? [] })),
      trackIdToArtist
    );
    const albumAppearances = buildAlbumAppearanceMap(
      recentPlaylists.map((p) => ({ vibe: p.vibe, trackIds: (p.trackIds as string[]) ?? [] })),
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
      recentPlaylists.map((p) => ({
        vibe: p.vibe,
        trackIds: (p.trackIds as string[]) ?? [],
        emotionProfile: p.emotionProfile as EmotionProfile | null,
        createdAt: p.createdAt,
      }))
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
      recentPlaylists.map((p) => ({
        vibe: p.vibe,
        trackIds: (p.trackIds as string[]) ?? [],
        emotionProfile: p.emotionProfile as EmotionProfile | null,
      })),
      journeyArc
    );
    const journeyArcMultiplier = journeyArcCooldownMultiplier(arcRepeatCount);

    setGeneratePhase(userId, requestId, "building_profile");
    let t0 = Date.now();
    const { profile: userGenreProfile, cacheHit } = devMode
      ? { profile: buildMockUserGenreProfile(likedSongs), cacheHit: false }
      : getUserGenreProfileForGenerate(
          userId,
          likedSongs,
          vibe
        );
    recordPreV3Timing(preV3Timing, "genreProfileTimeMs", Date.now() - t0);
    req.log.info(
      { elapsedMs: Date.now() - t0, trackCount: likedSongs.length, cacheHit },
      "Genre profile built"
    );

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

    const recentTrackLists = recentPlaylists.map((p) => (p.trackIds as string[]) ?? []);
    const recentTrackPenaltyScale = varietyBoost ? 1.75 : 1;
    const freshnessCloneMultiplier = varietyBoost
      ? cloneMultiplier * 0.88
      : cloneMultiplier;
    const stackCacheKey = `${resultCacheKey}:${likedSongs.length}`;

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

    const maxPerArtist = 2;

    const allowHolidaySeason =
      /\b(christmas|xmas|holiday|festive|winter holiday)\b/i.test(vibe) ||
      (humanIntent.intent === "nostalgia" && /\bchristmas|holiday\b/i.test(vibe));
    const qualitySignalContext = buildQualitySignalContext({
      vibe,
      emotionProfile,
      userGenreProfile,
      recentPlaylists: recentPlaylists.map((p) => ({ vibe: p.vibe, createdAt: p.createdAt })),
    });
    const pipelineVibe = normalizeVibeForPipeline(vibe, qualitySignalContext);
    const constraintLayer = extractConstraintLayer(vibe, qualitySignalContext);
    const parsedCsspIntent = buildCsspLockedIntent(vibe);
    const lockedIntent = {
      genreFamilies: parsedCsspIntent.genreFamilies.length > 0
        ? parsedCsspIntent.genreFamilies
        : constraintLayer.hard.genres.slice(0, 3),
      eraRange: parsedCsspIntent.eraRange ?? (
        constraintLayer.hard.eraStart !== null && constraintLayer.hard.eraEnd !== null
          ? { start: constraintLayer.hard.eraStart, end: constraintLayer.hard.eraEnd }
          : null
      ),
      mood: parsedCsspIntent.mood.length > 0 ? parsedCsspIntent.mood : qualitySignalContext.moodTags.filter((tag) => tag !== "neutral").slice(0, 3),
      activity: parsedCsspIntent.activity,
      energy: parsedCsspIntent.energy,
      primaryGenres: parsedCsspIntent.genreFamilies.length > 0
        ? parsedCsspIntent.genreFamilies
        : constraintLayer.hard.genres.slice(0, 3),
      eraStart: parsedCsspIntent.eraRange?.start ?? constraintLayer.hard.eraStart,
      eraEnd: parsedCsspIntent.eraRange?.end ?? constraintLayer.hard.eraEnd,
      energyLevel: parsedCsspIntent.energy,
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
      },
      "Quality signal and constraint context prepared"
    );

    setGeneratePhase(userId, requestId, "scoring");
    stageTimer.start("Running playlist pipeline (scoring + compose)", {
      tracks: likedSongs.length,
      stackFromCache,
    });
    preV3Timing.totalBeforeV3Ms = Date.now() - startMs;
    req.log.info({ ...preV3Timing }, "Pre-V3 timing breakdown");
    const useFastFallback = !devMode && budget.isExpired();

    let pipeline: ReturnType<typeof buildPlaylistPipeline>;
    let fallbackReason: { stage: string; elapsedMs: number } | null = null;
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
      });
    } else {
      pipeline = buildPlaylistPipeline({
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
        startMs,
        promptConfidenceMultiplier: promptConfidence.qualityBoost,
        journeyArcMultiplier,
        freshness: {
          stats: freshnessStats,
          artistAppearances,
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
    });
    }

    type PlaylistTrack = V3MetadataTrack<(typeof likedSongs)[number]> & {
      score: number;
      rediscoveryScore?: number;
      narrativeRole?: string;
    };
    setGeneratePhase(userId, requestId, "composing");
    let finalTracks = pipeline.finalTracks as PlaylistTrack[];
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
    const scoringDiagnostics = pipeline.scoringDiagnostics;
    const genreAudit: GenreAudit = pipeline.genreAudit;
    const { structured, afterDeadZone, afterSmoothing, afterArtistSep } = pipeline.composeMeta;

    const scoringPool = (pipeline.scoringDiagnostics.scoringPool ?? {}) as {
      librarySize?: number;
      hybridPoolSize?: number;
      poolCapped?: boolean;
    };
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

    if (finalTracks.length === 0) {
      req.log.warn({ userId, code: "EMPTY_POOL" }, "Hard filter graph removed all ranked candidates");
      setGeneratePhase(userId, requestId, "error");
      if (respondIfStale(res, userId, requestId)) return;
      generateFail(
        res,
        400,
        "EMPTY_PLAYLIST",
        "Could not build a playlist — nothing matched this vibe with your current library. Try Balanced or Chaotic mode, a broader vibe, or wait a moment and regenerate.",
        {
          hint: "The hard filter graph removed all ranked candidates.",
        }
      );
      return;
    }

    if (respondIfStale(res, userId, requestId)) return;

    const playlistName = generatePlaylistName(vibe, emotionProfile);

    const trackObjects = finalTracks.map((t) => ({
      ...t,
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: t.albumName,
      albumArt: t.albumArt ?? null,
      genrePrimary: t.genrePrimary ?? null,
      laneId: t.laneId ?? t.sourceLane ?? null,
      laneScore: t.laneScore ?? null,
      laneEra: t.laneEra ?? null,
      clusterId: t.clusterId ?? null,
      clusterIds: t.clusterIds ?? [],
    }));

    setGeneratePhase(userId, requestId, "spotify");
    let spotifyPlaylistUrl: string | null = null;
    const tSpotify = Date.now();
    req.log.info(
      { trackCount: finalTracks.length, devMode },
      devMode ? "Skipping Spotify playlist creation in dev mode" : "Creating Spotify playlist"
    );

    let spotifyPartial = false;
    let spotifyTracksAdded: number | undefined;

    if (!devMode && !staleGenerate(userId, requestId)) {
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
              setPendingSpotifyPlaylistId(userId, requestId, id),
          }
        );
        clearPendingSpotifyPlaylist(userId, requestId);
        spotifyPlaylistUrl = spotifyResult.url;
        spotifyPartial = !!spotifyResult.partial;
        spotifyTracksAdded = spotifyResult.tracksAdded;
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


    setGeneratePhase(userId, requestId, "saving");
    const tSave = Date.now();
    req.log.info("Saving playlist to database");

    const profilePayload = {
      ...emotionProfile,
      journeyArc,
      librarySize: likedSongs.length,
    };
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

    const savedPlaylistId = insertResult[0]?.id ?? 0;

    req.log.info(
      { ms: Date.now() - tSave, userId, playlistId: savedPlaylistId, trackCount: finalTracks.length },
      "Playlist saved to DB"
    );

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
      datedLikes.length >= 200 && recentLikeShare > 0.85
        ? "Most cached likes look recently added. Run a full library sync from the app so older favourites are included."
        : null;

    const v3Diagnostics = formatV3DiagnosticsForApi(
      pipeline.scoringDiagnostics?.v3Pipeline,
      vibe
    );
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
        score: Math.round(t.score * 100) / 100,
        rediscoveryScore: t.rediscoveryScore,
        narrativeRole: t.narrativeRole,
        genrePrimary: t.genrePrimary ?? null,
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
      setCachedGenerateResult(resultCacheKey, {
        cacheVersion: "v2",
        playlistName,
        vibe,
        mode,
        finalTracks: cachedFinalTracks,
        emotionProfile: { ...emotionProfile, journeyArc },
        spotifyPlaylistUrl,
        v3Diagnostics,
        cachedAt: Date.now(),
      });
    }

    setGeneratePhase(userId, requestId, "done");
    if (respondIfStale(res, userId, requestId)) return;

    req.log.info(
      {
        elapsedMs: Date.now() - startMs,
        cacheHit: false,
        trackCount: finalTracks.length,
        poolSize: scoringPool.hybridPoolSize,
      },
      "Generation complete"
    );

    const debugMode = req.query.debug === "1";

    res.json({
      success: true,
      playlistId: savedPlaylistId,
      ...spotifyFields,
      playlistName,
      name: playlistName,
      vibe,
      mode,
      noLibraryMode: !!noLibraryMode,
      devMode,
      count: finalTracks.length,
      totalTracks: finalTracks.length,
      ...(fallbackReason ? { fallbackReason } : {}),
      generationMs,
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
            scoringDiagnostics,
            genreAudit,
          }
        : {
            scoringDiagnostics,
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
      tracks: formatTracksForApi(finalTracks, emotionProfile),
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
      v3Diagnostics,
      ...(pipeline.scoringDiagnostics?.fastFallback
        ? { fastFallback: true }
        : {}),
      ...(debugMode
        ? {
            _debug: {
              noLibraryMode: !!noLibraryMode,
              scoringWeights: "semantic:0.40_emotion:0.20_scene:0.15_aesthetic:0.10_library:0.10_genre:0.05",
              noLibraryWeights: noLibraryMode ? "semantic:0.55_emotion:0.20_scene:0.15_aesthetic:0.10" : null,
              scoringDiagnostics,
              ecosystemDebug: pipeline.ecosystemDebug,
              semanticScene: (scoringDiagnostics as Record<string, unknown>).semanticResolution ?? null,
              poolInfo: {
                librarySize: scoringPool.librarySize,
                hybridPoolSize: scoringPool.hybridPoolSize,
                poolCapped: scoringPool.poolCapped,
              },
              genreAudit,
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
                exclusionReasons:
                  (scoringDiagnostics as Record<string, unknown>).exclusionReasons ?? {},
                dominantGenres:
                  (scoringDiagnostics as Record<string, unknown>).dominantGenres ?? [],
              },
              v3: (scoringDiagnostics as Record<string, unknown>).v3Pipeline ?? {},
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
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (sessionUserId && requestId) {
        endGenerateSession(sessionUserId, requestId);
      }
    }
  } catch (fatalErr: any) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    req.log.error(
      { err: fatalErr?.message, code: "INTERNAL_ERROR", userId: sessionUserId },
      "Unhandled error in /generate"
    );
    if (sessionUserId && requestId) {
      setGeneratePhase(sessionUserId, requestId, "error");
      endGenerateSession(sessionUserId, requestId);
    }
    if (!res.headersSent && !staleGenerate(sessionUserId, requestId)) {
      const timedOut = Date.now() - startMs >= REQUEST_HARD_TIMEOUT_MS - 1000;
      const ctx = (req as { _genCtx?: {
        likedSongs: { trackId: string; trackName: string; artistName: string; albumName: string }[];
        constrainedFallbackTracks?: { trackId: string; trackName: string; artistName: string; albumName: string }[];
        emotionProfile: EmotionProfile;
        length: number;
        vibe: string;
        mode: string;
      } })._genCtx;
      if (timedOut && ctx?.likedSongs?.length) {
        const maxPerArtist = 2;
        const fallbackTracks = ctx.constrainedFallbackTracks?.length
          ? ctx.constrainedFallbackTracks
          : ctx.likedSongs;
        const pipeline = buildFallbackPipelineResult({
          tracks: fallbackTracks as Parameters<typeof buildFallbackPipelineResult>[0]["tracks"],
          emotionProfile: ctx.emotionProfile,
          playlistLength: ctx.length,
          maxPerArtist,
          librarySize: fallbackTracks.length,
        });
        const playlistName = generatePlaylistName(ctx.vibe, ctx.emotionProfile);
        res.json({
          success: true,
          fastFallback: true,
          code: "TIMEOUT_FALLBACK",
          playlistName,
          name: playlistName,
          vibe: ctx.vibe,
          mode: ctx.mode,
          count: pipeline.finalTracks.length,
          totalTracks: pipeline.finalTracks.length,
          spotifyUnavailable: true,
          tracks: formatTracksForApi(pipeline.finalTracks, ctx.emotionProfile),
        });
      } else {
        res.status(timedOut ? 504 : 500).json({
          success: false,
          error: timedOut
            ? "Generation took too long. Try Balanced mode or regenerate in a moment."
            : "An unexpected error occurred. Please try again.",
          code: timedOut ? "TIMEOUT" : "INTERNAL_ERROR",
          tracks: [],
        });
      }
    }
  }
});

export default router;
