import { trackHasEraEvidence, trackHasKnownEraMismatch, type EraRange } from "./era-evidence";
import { buildLockedIntent, type LockedIntent } from "../core/v3/intent";
import type { IntentUnderstandingDiagnostics } from "./intent-understanding-diagnostics";
import { computeTruthfulMetrics } from "./quality-control/truthful-metrics";

export type SurvivalDimension =
  | "genre"
  | "subgenre"
  | "mood"
  | "scene"
  | "activity"
  | "era"
  | "energy"
  | "emotion"
  | "place"
  | "time"
  | "atmosphere";

export type SurvivalRisk = "critical" | "high" | "medium" | "low";

export type SurvivalTrack = {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  releaseYear?: number | null;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  loudness?: number | null;
  speechiness?: number | null;
  laneEra?: string | null;
  sourceLane?: string | null;
  laneId?: string | null;
  clusterId?: string | null;
  clusterIds?: string[] | null;
};

export type TrackClassification = {
  genrePrimary: string;
  genreFamily: string;
  primarySubgenre: string;
  secondarySubgenre: string | null;
  subGenres: string[];
};

export type IntentStageTrace = {
  stage: string;
  inputIntent: Record<string, unknown>;
  outputIntent: Record<string, unknown>;
  preservedDimensions: SurvivalDimension[];
  weakenedDimensions: SurvivalDimension[];
  lostDimensions: SurvivalDimension[];
  newlyIntroducedDimensions: SurvivalDimension[];
  potentialDriftVectors: SurvivalDimension[];
  evidence: Record<string, unknown>;
};

export type DimensionSurvivalScore = {
  dimension: SurvivalDimension;
  score: number;
  explicit: boolean;
  matchedCount: number;
  totalCount: number;
  evidence: Record<string, unknown>;
};

export type EmotionSurvivalDiagnostics = {
  dominantEmotion: string | null;
  promptEmotions: Record<string, number>;
  finalEmotionDistribution: Record<string, number>;
  survivalPercent: number;
  intensityRetainedPercent: number;
  polarityFlipRisk: SurvivalRisk;
  driftWarnings: string[];
  stageRisks: Array<{
    stage: string;
    canDrift: boolean;
    canMix: boolean;
    canWeaken: boolean;
    canFlip: boolean;
    reason: string;
  }>;
};

export type ConvergenceDiagnostics = {
  promptSignature: string;
  intentSignature: string;
  retrievalSignature: string;
  candidateSignature: string;
  samplerSignature: string;
  finalSignature: string;
  overlap: {
    retrievalToCandidate: number | null;
    candidateToSampler: number | null;
    samplerToFinal: number | null;
    retrievalToFinal: number | null;
  };
  convergenceRisk: SurvivalRisk;
  likelyConvergencePoints: string[];
};

export type IntentLeakDetection = {
  file: string;
  functionName: string;
  reason: string;
  severity: SurvivalRisk;
  affectedDimensions: SurvivalDimension[];
  evidence: Record<string, unknown>;
};

export type RelaxationDetection = {
  path: string;
  trigger: string;
  maximumExpansion: string;
  dimensionsSacrificed: SurvivalDimension[];
  riskLevel: SurvivalRisk;
  evidence: Record<string, unknown>;
};

export type IntentSurvivalDiagnostics = {
  prompt: string;
  generatedAt: string;
  dimensions: Record<SurvivalDimension, DimensionSurvivalScore>;
  scores: {
    genreSurvival: number;
    subgenreSurvival: number;
    moodSurvival: number;
    sceneSurvival: number;
    activitySurvival: number;
    eraSurvival: number;
    energySurvival: number;
    emotionSurvival: number;
    placeSurvival: number;
    timeSurvival: number;
    atmosphereSurvival: number;
    overallIntentSurvival: number;
  };
  stageTrace: IntentStageTrace[];
  emotionSurvival: EmotionSurvivalDiagnostics;
  convergence: ConvergenceDiagnostics;
  leakDetections: IntentLeakDetection[];
  relaxationAudit: RelaxationDetection[];
  stageByStageLog: Array<{
    stage: string;
    summary: string;
    counts: Record<string, number | null>;
    survivalPercent: number | null;
  }>;
  releaseReadiness: {
    canPreserveGenre: boolean;
    canPreserveSubgenre: boolean;
    canPreserveMood: boolean;
    canPreserveScene: boolean;
    canPreserveActivity: boolean;
    canPreserveEra: boolean;
    canPreserveEmotion: boolean;
    highestRisk: SurvivalRisk;
    highestRiskReasons: string[];
  };
  intentUnderstanding?: IntentUnderstandingDiagnostics | null;
  termTrace?: IntentTermTrace[];
  intentLossPipeline?: IntentLossStage[];
  /** Externally verifiable scores — prompt + track metadata only (no pipeline circular inputs). */
  truthfulMetrics?: import("./quality-control/truthful-metrics").TruthfulMetricScores;
};

export type IntentTermTrace = {
  term: string;
  status: "recognized" | "unrecognized" | "assumed" | "lost" | "drifted";
  stage: string;
  note: string | null;
};

export type IntentLossStage = {
  stage: string;
  summary: string;
  concepts: Record<string, string[]>;
  lostTerms: string[];
};

type ConstraintLayerLike = {
  hard?: {
    genres?: string[];
    eraStart?: number | null;
    eraEnd?: number | null;
    strictLock?: boolean;
  };
  raw?: {
    explicitGenreTerms?: string[];
    explicitEraTerms?: string[];
    strictTerms?: string[];
  };
};

type BuildIntentSurvivalDiagnosticsOpts = {
  prompt: string;
  lockedIntent?: Partial<LockedIntent> & {
    primaryGenres?: string[];
    eraStart?: number | null;
    eraEnd?: number | null;
    energyLevel?: "low" | "medium" | "high" | null;
  };
  constraintLayer?: ConstraintLayerLike | null;
  emotionProfile?: {
    energy?: number;
    valence?: number;
    tension?: number;
    nostalgia?: number;
    calm?: number;
    environment?: string | null;
    timeOfDay?: string | null;
    motionState?: string | null;
  } | null;
  finalTracks: SurvivalTrack[];
  classMap?: Map<string, TrackClassification>;
  v3Diagnostics?: Record<string, unknown> | null;
  generationDiagnostics?: Record<string, unknown> | null;
  finalizationDiagnostics?: Record<string, unknown> | null;
  finalValidation?: Record<string, "PASS" | "FAIL"> | null;
  strictGenreEvidence?: Record<string, unknown> | null;
  strictEraEvidence?: Record<string, unknown> | null;
  noLibrarySpotify?: Record<string, unknown> | null;
  finalGenreDistribution?: Record<string, number>;
  finalEraDistribution?: Record<string, number>;
  finalMoodDistribution?: Record<string, number>;
  finalEnergyDistribution?: Record<string, number>;
  intentUnderstanding?: IntentUnderstandingDiagnostics | null;
};

const DIMENSIONS: SurvivalDimension[] = [
  "genre",
  "subgenre",
  "mood",
  "scene",
  "activity",
  "era",
  "energy",
  "emotion",
  "place",
  "time",
  "atmosphere",
];

const EMOTION_TERMS: Record<string, RegExp[]> = {
  melancholy: [/\bmelanchol/i, /\bsad\b/i, /\brain(?:y)?\b/i, /\bblue\b/i, /\bheartbreak/i],
  nostalgia: [/\bnostalg/i, /\bthrowback\b/i, /\bmemory|memories\b/i, /\bold\s*school\b/i, /\bclassic\b/i],
  tension: [/\btense\b/i, /\btension\b/i, /\banxious\b/i, /\buneasy\b/i, /\bdark\b/i],
  aggression: [/\baggressive\b/i, /\bangry\b/i, /\brage\b/i, /\bhardcore\b/i, /\bmetal\b/i, /\bindustrial\b/i],
  anticipation: [/\banticipat/i, /\bbuild(?:ing)?\b/i, /\brising\b/i, /\bpre[-\s]?game\b/i],
  loneliness: [/\blonely\b/i, /\balone\b/i, /\bsolitude\b/i, /\bempty\b/i],
  peace: [/\bpeace/i, /\bcalm\b/i, /\bchill\b/i, /\bsoft\b/i, /\btranquil\b/i],
  euphoria: [/\beuphor/i, /\bbliss\b/i, /\becstatic\b/i, /\buplifting\b/i, /\bhype\b/i],
  longing: [/\blonging\b/i, /\byearning\b/i, /\baching\b/i, /\bmissing\b/i],
  wonder: [/\bwonder\b/i, /\bwide[-\s]?eyed\b/i, /\bmagic(?:al)?\b/i, /\btranscendent\b/i],
};

const PLACE_PATTERNS: Record<string, RegExp[]> = {
  city: [/\bcity\b/i, /\burban\b/i, /\bstreet/i, /\btokyo\b/i, /\bneon\b/i],
  car: [/\bcar\b/i, /\bdriv/i, /\broad\b/i, /\bhighway\b/i, /\bmotorway\b/i],
  warehouse: [/\bwarehouse\b/i, /\bbunker\b/i, /\bunderground\b/i],
  bedroom: [/\bbedroom\b/i, /\broom\b/i, /\bhome\b/i],
  nature: [/\bnature\b/i, /\bforest\b/i, /\bfield\b/i, /\btrail\b/i],
  bar: [/\bbar\b/i, /\bjazz\s+bar\b/i, /\bclub\b/i],
};

const TIME_PATTERNS: Record<string, RegExp[]> = {
  late_night: [/\blate\s+night\b/i, /\bmidnight\b/i, /\b[234]\s?am\b/i, /\bnight\b/i],
  evening: [/\bevening\b/i, /\bdusk\b/i],
  morning: [/\bmorning\b/i, /\bsunrise\b/i],
};

const ATMOSPHERE_PATTERNS: Record<string, RegExp[]> = {
  rainy: [/\brain/i, /\bwet\b/i, /\bstorm\b/i],
  dark: [/\bdark\b/i, /\bunderground\b/i, /\bbunker\b/i],
  warehouse: [/\bwarehouse\b/i, /\bindustrial\b/i],
  atmospheric: [/\batmospheric\b/i, /\bambient\b/i, /\bdeep\b/i],
  chill: [/\bchill\b/i, /\bcalm\b/i, /\bsoft\b/i],
};

function roundPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundRatio(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return safeArray(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function compact<T>(items: Array<T | null | undefined | false>): T[] {
  return items.filter((item): item is T => Boolean(item));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function getNestedRecord(root: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const value = root?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function trackClassification(track: SurvivalTrack, classMap?: Map<string, TrackClassification>): TrackClassification | null {
  return classMap?.get(track.trackId) ?? null;
}

function trackFamily(track: SurvivalTrack, classMap?: Map<string, TrackClassification>): string | null {
  const classification = trackClassification(track, classMap);
  return normalize(
    classification?.genreFamily ??
    classification?.genrePrimary ??
    track.genreFamily ??
    track.genrePrimary ??
    (Array.isArray(track.genres) ? track.genres[0] : null)
  ).replace(/\s+/g, "_") || null;
}

function trackText(track: SurvivalTrack, classMap?: Map<string, TrackClassification>): string {
  const classification = trackClassification(track, classMap);
  return normalize([
    track.trackName,
    track.artistName,
    track.albumName,
    track.genrePrimary,
    track.genreFamily,
    ...(Array.isArray(track.genres) ? track.genres : []),
    ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres.filter((item): item is string => typeof item === "string") : []),
    ...(Array.isArray(track.albumGenres) ? track.albumGenres.filter((item): item is string => typeof item === "string") : []),
    classification?.genrePrimary,
    classification?.genreFamily,
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
    ...(Array.isArray(track.clusterIds) ? track.clusterIds : []),
  ].filter((item): item is string => typeof item === "string").join(" "));
}

function promptMatches(patterns: RegExp[], prompt: string): boolean {
  return patterns.some((pattern) => pattern.test(prompt));
}

function promptKeys(patterns: Record<string, RegExp[]>, prompt: string): string[] {
  return Object.entries(patterns)
    .filter(([, tests]) => promptMatches(tests, prompt))
    .map(([key]) => key);
}

function scoreDimension(
  dimension: SurvivalDimension,
  explicit: boolean,
  tracks: SurvivalTrack[],
  predicate: (track: SurvivalTrack) => boolean,
  evidence: Record<string, unknown>,
): DimensionSurvivalScore {
  if (!explicit) {
    return {
      dimension,
      score: 100,
      explicit,
      matchedCount: tracks.length,
      totalCount: tracks.length,
      evidence: { ...evidence, inactiveReason: "dimension_not_explicit" },
    };
  }
  const matchedCount = tracks.filter(predicate).length;
  const score = tracks.length > 0 ? roundPercent((matchedCount / tracks.length) * 100) : 0;
  return {
    dimension,
    score,
    explicit,
    matchedCount,
    totalCount: tracks.length,
    evidence,
  };
}

function energyMatch(track: SurvivalTrack, energy: string | null | undefined): boolean {
  if (!energy || typeof track.energy !== "number") return true;
  if (energy === "low") return track.energy <= 0.58;
  if (energy === "high") return track.energy >= 0.55;
  return track.energy >= 0.32 && track.energy <= 0.78;
}

function moodMatch(track: SurvivalTrack, mood: string): boolean {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.4;
  const danceability = track.danceability ?? 0.5;
  if (mood === "melancholic") return valence <= 0.48 || (energy <= 0.52 && valence <= 0.60);
  if (mood === "calm") return energy <= 0.58 && (danceability <= 0.72 || acousticness >= 0.25);
  if (mood === "nostalgic") return acousticness >= 0.28 || (track.releaseYear != null && track.releaseYear < 2010);
  if (mood === "warm") return valence >= 0.48 && acousticness >= 0.20;
  if (mood === "energised") return energy >= 0.60 || danceability >= 0.62;
  if (mood === "dark") return valence <= 0.52 || energy <= 0.48;
  if (mood === "euphoric") return valence >= 0.58 && energy >= 0.48;
  return false;
}

function activityMatch(track: SurvivalTrack, activity: string | null | undefined): boolean {
  if (!activity) return true;
  const energy = track.energy ?? 0.5;
  const tempo = track.tempo ?? 110;
  const danceability = track.danceability ?? 0.5;
  const acousticness = track.acousticness ?? 0.5;
  if (activity === "driving") return energy >= 0.30 && tempo >= 72;
  if (activity === "focus") return energy <= 0.62 && (acousticness >= 0.20 || danceability <= 0.72);
  if (activity === "gym") return energy >= 0.55 || tempo >= 120;
  if (activity === "party") return energy >= 0.58 && danceability >= 0.52;
  if (activity === "walking") return energy >= 0.25 && energy <= 0.78;
  if (activity === "relaxing") return energy <= 0.52 || acousticness >= 0.38;
  return true;
}

function emotionAffinities(track: SurvivalTrack): Record<string, number> {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.4;
  const danceability = track.danceability ?? 0.5;
  const tempoNorm = Math.max(0, Math.min(1, ((track.tempo ?? 110) - 60) / 140));
  return {
    melancholy: roundRatio((1 - valence) * 0.55 + (1 - energy) * 0.25 + acousticness * 0.20),
    nostalgia: roundRatio(acousticness * 0.35 + (track.releaseYear && track.releaseYear < 2010 ? 0.35 : 0.12) + (1 - energy) * 0.15),
    tension: roundRatio((1 - valence) * 0.45 + energy * 0.28 + tempoNorm * 0.16),
    aggression: roundRatio(energy * 0.50 + tempoNorm * 0.22 + (1 - valence) * 0.20),
    anticipation: roundRatio(tempoNorm * 0.30 + energy * 0.30 + danceability * 0.20),
    loneliness: roundRatio((1 - valence) * 0.35 + (1 - danceability) * 0.24 + acousticness * 0.16),
    peace: roundRatio((1 - energy) * 0.45 + acousticness * 0.24 + valence * 0.16),
    euphoria: roundRatio(valence * 0.45 + energy * 0.32 + danceability * 0.18),
    longing: roundRatio((1 - valence) * 0.35 + acousticness * 0.20 + (1 - energy) * 0.18),
    wonder: roundRatio(valence * 0.28 + acousticness * 0.20 + (1 - Math.abs(energy - 0.5)) * 0.24),
  };
}

function dominantEmotionFromPrompt(prompt: string, emotionProfile?: BuildIntentSurvivalDiagnosticsOpts["emotionProfile"]): {
  dominant: string | null;
  scores: Record<string, number>;
} {
  const scores: Record<string, number> = {};
  for (const [emotion, patterns] of Object.entries(EMOTION_TERMS)) {
    scores[emotion] = patterns.filter((pattern) => pattern.test(prompt)).length;
  }
  if (emotionProfile) {
    scores.melancholy += (1 - (emotionProfile.valence ?? 0.5)) * 0.8;
    scores.nostalgia += (emotionProfile.nostalgia ?? 0) * 0.9;
    scores.tension += (emotionProfile.tension ?? 0) * 0.8;
    scores.peace += (emotionProfile.calm ?? 0) * 0.8;
    scores.euphoria += (emotionProfile.energy ?? 0.5) > 0.65 && (emotionProfile.valence ?? 0.5) > 0.55 ? 0.7 : 0;
    scores.loneliness += /alone|empty|lonely/i.test(prompt) ? 1 : 0;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [dominant, value] = ranked[0] ?? [null, 0];
  return { dominant: value > 0.15 ? dominant : null, scores };
}

function finalEmotionDistribution(tracks: SurvivalTrack[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const track of tracks) {
    const ranked = Object.entries(emotionAffinities(track)).sort((a, b) => b[1] - a[1]);
    const emotion = ranked[0]?.[0] ?? "unknown";
    counts[emotion] = (counts[emotion] ?? 0) + 1;
  }
  return counts;
}

function setOverlap(a: string[], b: string[]): number | null {
  if (a.length === 0 || b.length === 0) return null;
  const left = new Set(a);
  const right = new Set(b);
  const intersection = [...left].filter((id) => right.has(id)).length;
  const union = new Set([...left, ...right]).size;
  return roundRatio(intersection / Math.max(1, union));
}

function topTrackIds(value: unknown): string[] {
  const rows = safeArray(value);
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      return typeof record["trackId"] === "string" ? record["trackId"] : null;
    })
    .filter((id): id is string => !!id);
}

function idsFromTracks(tracks: SurvivalTrack[]): string[] {
  return tracks.map((track) => track.trackId).filter(Boolean);
}

function signature(parts: Array<string | null | undefined>): string {
  return unique(parts.map((part) => normalize(part).replace(/\s+/g, "_")).filter(Boolean)).slice(0, 8).join("|") || "none";
}

function expectedFamilies(lockedIntent: BuildIntentSurvivalDiagnosticsOpts["lockedIntent"], constraints?: ConstraintLayerLike | null): string[] {
  return unique([
    ...(lockedIntent?.primaryGenres ?? []),
    ...(lockedIntent?.genreFamilies ?? []),
    ...(constraints?.hard?.genres ?? []),
  ].map((family) => normalize(family).replace(/\s+/g, "_")).filter(Boolean));
}

function expectedEra(lockedIntent: BuildIntentSurvivalDiagnosticsOpts["lockedIntent"], constraints?: ConstraintLayerLike | null): EraRange | null {
  if (lockedIntent?.eraRange) return lockedIntent.eraRange;
  const start = lockedIntent?.eraStart ?? constraints?.hard?.eraStart ?? null;
  const end = lockedIntent?.eraEnd ?? constraints?.hard?.eraEnd ?? null;
  return typeof start === "number" && typeof end === "number" ? { start, end } : null;
}

function buildDimensionScores(opts: BuildIntentSurvivalDiagnosticsOpts, parsedPromptIntent: LockedIntent): Record<SurvivalDimension, DimensionSurvivalScore> {
  const tracks = opts.finalTracks;
  const families = expectedFamilies(opts.lockedIntent, opts.constraintLayer);
  const primarySubgenre = opts.lockedIntent?.primarySubgenre ?? parsedPromptIntent.primarySubgenre ?? null;
  const subgenreTerms = unique([
    primarySubgenre,
    opts.lockedIntent?.secondarySubgenre,
    ...(opts.lockedIntent?.subgenreTerms ?? parsedPromptIntent.subgenreTerms ?? []),
  ].filter((term): term is string => !!term).map((term) => normalize(term).replace(/\s+/g, " ")));
  const moods = opts.lockedIntent?.mood ?? parsedPromptIntent.mood;
  const activity = opts.lockedIntent?.activity ?? parsedPromptIntent.activity;
  const eraRange = expectedEra(opts.lockedIntent, opts.constraintLayer);
  const energy = opts.lockedIntent?.energy ?? opts.lockedIntent?.energyLevel ?? parsedPromptIntent.energy;
  const places = promptKeys(PLACE_PATTERNS, opts.prompt);
  const times = promptKeys(TIME_PATTERNS, opts.prompt);
  const atmospheres = promptKeys(ATMOSPHERE_PATTERNS, opts.prompt);
  const emotion = dominantEmotionFromPrompt(opts.prompt, opts.emotionProfile);

  const dimensions: Record<SurvivalDimension, DimensionSurvivalScore> = {
    genre: scoreDimension("genre", families.length > 0, tracks, (track) => {
      const family = trackFamily(track, opts.classMap);
      return !!family && families.includes(family);
    }, { expectedFamilies: families }),
    subgenre: scoreDimension("subgenre", subgenreTerms.length > 0, tracks, (track) => {
      const text = trackText(track, opts.classMap);
      return subgenreTerms.some((term) => text.includes(term));
    }, { expectedSubgenres: subgenreTerms }),
    mood: scoreDimension("mood", moods.length > 0, tracks, (track) => moods.some((mood) => moodMatch(track, mood)), { expectedMoods: moods }),
    scene: scoreDimension("scene", !!opts.lockedIntent?.sceneIntent || places.length > 0 || times.length > 0 || atmospheres.length > 0, tracks, (track) => {
      const text = trackText(track, opts.classMap);
      const sceneTextFit = [...places, ...times, ...atmospheres].some((item) => text.includes(item.replace(/_/g, " ")));
      const audioFit = (activity ? activityMatch(track, activity) : true) && (energy ? energyMatch(track, energy) : true);
      return sceneTextFit || audioFit;
    }, { sceneIntent: !!opts.lockedIntent?.sceneIntent, places, times, atmospheres }),
    activity: scoreDimension("activity", !!activity, tracks, (track) => activityMatch(track, activity), { expectedActivity: activity }),
    era: scoreDimension("era", !!eraRange, tracks, (track) => !!eraRange && trackHasEraEvidence(track, eraRange), { expectedEra: eraRange }),
    energy: scoreDimension("energy", !!energy, tracks, (track) => energyMatch(track, energy), { expectedEnergy: energy }),
    emotion: scoreDimension("emotion", !!emotion.dominant, tracks, (track) => {
      if (!emotion.dominant) return true;
      return (emotionAffinities(track)[emotion.dominant] ?? 0) >= 0.48;
    }, { dominantEmotion: emotion.dominant, promptEmotions: emotion.scores }),
    place: scoreDimension("place", places.length > 0, tracks, (track) => {
      const text = trackText(track, opts.classMap);
      return places.some((place) => text.includes(place.replace(/_/g, " "))) || (places.includes("car") && activityMatch(track, "driving"));
    }, { expectedPlaces: places }),
    time: scoreDimension("time", times.length > 0, tracks, (track) => {
      const text = trackText(track, opts.classMap);
      const energy = track.energy ?? 0.5;
      const valence = track.valence ?? 0.5;
      return times.some((time) => text.includes(time.replace(/_/g, " "))) ||
        (times.includes("late_night") && energy <= 0.76 && valence <= 0.78);
    }, { expectedTimes: times }),
    atmosphere: scoreDimension("atmosphere", atmospheres.length > 0, tracks, (track) => {
      const text = trackText(track, opts.classMap);
      return atmospheres.some((atmosphere) => text.includes(atmosphere.replace(/_/g, " "))) ||
        (atmospheres.includes("rainy") && moodMatch(track, "melancholic")) ||
        (atmospheres.includes("chill") && moodMatch(track, "calm"));
    }, { expectedAtmospheres: atmospheres }),
  };
  return dimensions;
}

function weightedOverall(dimensions: Record<SurvivalDimension, DimensionSurvivalScore>): number {
  const weights: Record<SurvivalDimension, number> = {
    genre: 1.25,
    subgenre: 1.30,
    mood: 1.10,
    scene: 1.15,
    activity: 1.00,
    era: 1.20,
    energy: 0.85,
    emotion: 1.35,
    place: 0.80,
    time: 0.70,
    atmosphere: 0.85,
  };
  const active = DIMENSIONS.filter((dimension) => dimensions[dimension].explicit);
  const scored = active.length > 0 ? active : DIMENSIONS;
  const totalWeight = scored.reduce((sum, dimension) => sum + weights[dimension], 0);
  return roundPercent(scored.reduce((sum, dimension) => sum + dimensions[dimension].score * weights[dimension], 0) / Math.max(1, totalWeight));
}

function buildScores(dimensions: Record<SurvivalDimension, DimensionSurvivalScore>): IntentSurvivalDiagnostics["scores"] {
  return {
    genreSurvival: dimensions.genre.score,
    subgenreSurvival: dimensions.subgenre.score,
    moodSurvival: dimensions.mood.score,
    sceneSurvival: dimensions.scene.score,
    activitySurvival: dimensions.activity.score,
    eraSurvival: dimensions.era.score,
    energySurvival: dimensions.energy.score,
    emotionSurvival: dimensions.emotion.score,
    placeSurvival: dimensions.place.score,
    timeSurvival: dimensions.time.score,
    atmosphereSurvival: dimensions.atmosphere.score,
    overallIntentSurvival: weightedOverall(dimensions),
  };
}

function dimensionsBelow(dimensions: Record<SurvivalDimension, DimensionSurvivalScore>, threshold: number): SurvivalDimension[] {
  return DIMENSIONS.filter((dimension) => dimensions[dimension].explicit && dimensions[dimension].score < threshold);
}

function stage(
  name: string,
  inputIntent: Record<string, unknown>,
  outputIntent: Record<string, unknown>,
  preservedDimensions: SurvivalDimension[],
  weakenedDimensions: SurvivalDimension[],
  lostDimensions: SurvivalDimension[],
  newlyIntroducedDimensions: SurvivalDimension[],
  potentialDriftVectors: SurvivalDimension[],
  evidence: Record<string, unknown>,
): IntentStageTrace {
  return {
    stage: name,
    inputIntent,
    outputIntent,
    preservedDimensions: unique(preservedDimensions),
    weakenedDimensions: unique(weakenedDimensions),
    lostDimensions: unique(lostDimensions),
    newlyIntroducedDimensions: unique(newlyIntroducedDimensions),
    potentialDriftVectors: unique(potentialDriftVectors),
    evidence,
  };
}

function buildStageTrace(
  opts: BuildIntentSurvivalDiagnosticsOpts,
  parsedPromptIntent: LockedIntent,
  dimensions: Record<SurvivalDimension, DimensionSurvivalScore>,
): IntentStageTrace[] {
  const v3 = opts.v3Diagnostics ?? {};
  const intentContract = getNestedRecord(v3, "intentContract");
  const contractGuard = getNestedRecord(v3, "intentContractGuard");
  const controlled = getNestedRecord(v3, "controlledGeneration");
  const retrievalLatencyGuard = getNestedRecord(controlled, "retrievalLatencyGuard");
  const retrievalCompletion = getNestedRecord(controlled, "retrievalCompletionSafety");
  const finalRelaxed = getNestedRecord(controlled, "selectedRelaxation");
  const waterfall = getNestedRecord(v3, "waterfall");
  const finalValidation = opts.finalValidation ?? {};
  const weakFinal = dimensionsBelow(dimensions, 70);
  const activeDimensions = DIMENSIONS.filter((dimension) => dimensions[dimension].explicit);
  const promptIntent = {
    genreFamilies: parsedPromptIntent.genreFamilies,
    primarySubgenre: parsedPromptIntent.primarySubgenre,
    eraRange: parsedPromptIntent.eraRange,
    mood: parsedPromptIntent.mood,
    activity: parsedPromptIntent.activity,
    energy: parsedPromptIntent.energy,
  };

  return [
    stage("prompt", {}, { rawPrompt: opts.prompt }, activeDimensions, [], [], [], [], {}),
    stage("prompt_parsing", { rawPrompt: opts.prompt }, promptIntent, activeDimensions, [], [], [], ["emotion", "scene"], {
      interpretationBudget: parsedPromptIntent.interpretationBudget ?? null,
    }),
    stage("intent_normalization", promptIntent, {
      lockedIntent: opts.lockedIntent ?? parsedPromptIntent,
      constraintLayer: opts.constraintLayer ?? null,
    }, activeDimensions, compact([
      parsedPromptIntent.interpretationBudget?.droppedDimensions?.length ? "mood" as const : null,
      parsedPromptIntent.interpretationBudget?.droppedDimensions?.includes("era") ? "era" as const : null,
    ]), [], ["scene"], ["subgenre", "emotion"], {
      droppedDimensions: parsedPromptIntent.interpretationBudget?.droppedDimensions ?? [],
    }),
    stage("intent_contract", promptIntent, intentContract ?? {}, activeDimensions, compact([
      numberValue(contractGuard?.["averageFit"]) != null && Number(contractGuard?.["averageFit"]) < 0.65 ? "mood" as const : null,
      numberValue(contractGuard?.["averageFit"]) != null && Number(contractGuard?.["averageFit"]) < 0.65 ? "activity" as const : null,
    ]), [], ["atmosphere"], ["scene", "emotion"], {
      active: contractGuard?.["active"] ?? null,
      relaxed: contractGuard?.["relaxed"] ?? null,
      averageFit: contractGuard?.["averageFit"] ?? null,
    }),
    stage("locked_intent", promptIntent, opts.lockedIntent as Record<string, unknown> ?? {}, activeDimensions, [], [], ["scene"], ["emotion", "scene"], {
      sceneIntent: !!opts.lockedIntent?.sceneIntent,
    }),
    stage("unified_intent", opts.lockedIntent as Record<string, unknown> ?? {}, getNestedRecord(v3, "intentDecomposition") ?? {}, activeDimensions, ["emotion", "scene", "energy"], [], ["emotion", "scene"], ["emotion", "scene"], {
      sceneInfluenceMap: v3["sceneInfluenceMap"] ?? {},
      contextAnchors: v3["contextAnchors"] ?? {},
    }),
    stage("retrieval_query_generation", intentContract ?? {}, { noLibrarySpotify: opts.noLibrarySpotify ?? null }, activeDimensions, [], [], ["atmosphere"], ["subgenre", "scene"], {
      noLibraryMode: !!opts.noLibrarySpotify,
      fallbackReason: opts.noLibrarySpotify?.["fallbackReason"] ?? null,
    }),
    stage("spotify_search", { noLibrarySpotify: opts.noLibrarySpotify ?? null }, { retrievalCompletion: opts.noLibrarySpotify?.["retrievalCompletion"] ?? null }, activeDimensions, compact([
      opts.noLibrarySpotify?.["fallbackReason"] ? "subgenre" as const : null,
      opts.noLibrarySpotify?.["fallbackReason"] ? "genre" as const : null,
    ]), [], [], ["genre", "subgenre", "era"], {
      candidateCount: opts.noLibrarySpotify?.["candidateCount"] ?? null,
      verifiedCandidateCount: opts.noLibrarySpotify?.["verifiedCandidateCount"] ?? null,
    }),
    stage("library_retrieval", promptIntent, { waterfall }, activeDimensions, [], [], ["emotion"], ["genre", "emotion"], {
      libraryCount: waterfall?.["libraryCount"] ?? null,
      scoredCount: waterfall?.["scoredCount"] ?? null,
    }),
    stage("retrieval_ranking", intentContract ?? {}, contractGuard ?? {}, activeDimensions, compact([
      contractGuard?.["subgenrePoolTooSmall"] ? "subgenre" as const : null,
      contractGuard?.["retrievalExpandedDueToStarvation"] ? "genre" as const : null,
    ]), [], ["energy"], ["subgenre", "mood", "scene"], {
      subgenreFallbackMode: contractGuard?.["subgenreFallbackMode"] ?? null,
      fallbackLevelUsed: contractGuard?.["fallbackLevelUsed"] ?? null,
    }),
    stage("retrieval_fallback_ladders", contractGuard ?? {}, retrievalCompletion ?? {}, activeDimensions, compact([
      contractGuard?.["fallbackLevelUsed"] && contractGuard["fallbackLevelUsed"] !== "none" ? "subgenre" as const : null,
      contractGuard?.["fallbackLevelUsed"] === "adjacent" || contractGuard?.["fallbackLevelUsed"] === "global" ? "genre" as const : null,
    ]), compact([
      contractGuard?.["fallbackLevelUsed"] === "global" ? "scene" as const : null,
    ]), [], ["genre", "subgenre", "scene", "emotion"], {
      fallbackExpansionPath: contractGuard?.["fallbackExpansionPath"] ?? retrievalCompletion?.["fallbackExpansionPath"] ?? [],
    }),
    stage("family_expansion", contractGuard ?? {}, contractGuard ?? {}, ["genre"], compact([
      contractGuard?.["subgenreFallbackMode"] === "family" ? "subgenre" as const : null,
    ]), [], [], ["subgenre"], {
      subgenrePrimaryCount: contractGuard?.["subgenrePrimaryCount"] ?? null,
      subgenreFamilyCount: contractGuard?.["subgenreFamilyCount"] ?? null,
    }),
    stage("adjacent_family_expansion", contractGuard ?? {}, contractGuard ?? {}, [], compact([
      contractGuard?.["fallbackLevelUsed"] === "adjacent" || contractGuard?.["fallbackLevelUsed"] === "global" ? "genre" as const : null,
    ]), [], [], ["genre", "scene"], {
      fallbackLevelUsed: contractGuard?.["fallbackLevelUsed"] ?? null,
    }),
    stage("global_expansion", contractGuard ?? {}, contractGuard ?? {}, [], compact([
      contractGuard?.["fallbackLevelUsed"] === "global" ? "genre" as const : null,
      contractGuard?.["fallbackLevelUsed"] === "global" ? "mood" as const : null,
      contractGuard?.["fallbackLevelUsed"] === "global" ? "scene" as const : null,
    ]), compact([
      contractGuard?.["fallbackLevelUsed"] === "global" ? "subgenre" as const : null,
    ]), [], ["genre", "subgenre", "mood", "scene", "emotion"], {
      fallbackLevelUsed: contractGuard?.["fallbackLevelUsed"] ?? null,
    }),
    stage("candidate_pool_construction", contractGuard ?? {}, waterfall ?? {}, activeDimensions, compact([
      stringArray(controlled?.["relaxationSteps"]).some((step) => /genre|mood|era/i.test(step)) ? "mood" as const : null,
    ]), [], ["energy"], ["genre", "era", "mood"], {
      selectedCandidate: controlled?.["selectedCandidate"] ?? null,
      relaxationSteps: controlled?.["relaxationSteps"] ?? [],
    }),
    stage("candidate_filtering", waterfall ?? {}, getNestedRecord(v3, "forensicPoolTrace") ?? {}, activeDimensions, [], [], [], ["era", "genre", "emotion"], {
      removalReasons: v3["removalReasons"] ?? [],
    }),
    stage("scoring_inputs", promptIntent, { playlistQuality: v3["playlistQuality"] ?? null }, activeDimensions, ["emotion", "scene"], [], ["energy"], ["emotion", "scene"], {
      recommendationEngine: v3["recommendationEngine"] ?? null,
    }),
    stage("v3_ranking", { lanes: v3["lanes"] ?? [] }, { selectionTrace: v3["selectionTrace"] ?? [] }, activeDimensions, ["emotion", "scene"], [], ["energy"], ["emotion", "scene", "activity"], {
      lanes: v3["lanes"] ?? [],
    }),
    stage("v3_sampler", { laneContributions: v3["laneContributions"] ?? {} }, { finalDistribution: v3["finalDistribution"] ?? null }, activeDimensions, ["energy", "emotion"], [], ["scene"], ["emotion", "energy"], {
      globalDiversityMetrics: v3["globalDiversityMetrics"] ?? null,
    }),
    stage("diversity_systems", { diversity: controlled?.["diversityPressure"] ?? null }, { artistDiversity: opts.generationDiagnostics?.["artistDiversity"] ?? null }, activeDimensions, ["genre", "subgenre", "emotion"], [], ["energy"], ["genre", "subgenre", "emotion"], {
      diversityPressure: controlled?.["diversityPressure"] ?? null,
      sessionArtistMemory: controlled?.["sessionArtistMemory"] ?? null,
    }),
    stage("artist_penalties", { sessionArtistMemory: controlled?.["sessionArtistMemory"] ?? null }, { finalTracks: opts.finalTracks.length }, activeDimensions, ["genre", "subgenre"], [], [], ["genre", "subgenre"], {
      sessionArtistMemory: controlled?.["sessionArtistMemory"] ?? null,
    }),
    stage("cluster_selection", { clusters: v3["clusters"] ?? [] }, { aggregateClusterSpread: v3["aggregateClusterSpread"] ?? {} }, activeDimensions, ["mood", "emotion"], [], ["scene"], ["mood", "emotion", "scene"], {
      clusterDistributionGraph: v3["clusterDistributionGraph"] ?? {},
    }),
    stage("contract_fit_scoring", intentContract ?? {}, { playlistQuality: v3["playlistQuality"] ?? null }, activeDimensions, weakFinal, [], [], weakFinal, {
      playlistQuality: v3["playlistQuality"] ?? null,
    }),
    stage("coherence_scoring", { finalization: opts.finalizationDiagnostics ?? null }, { finalValidation }, activeDimensions, compact([
      opts.finalizationDiagnostics?.["cohesionRelaxedFillUsed"] ? "genre" as const : null,
      opts.finalizationDiagnostics?.["cohesionRelaxedFillUsed"] ? "scene" as const : null,
    ]), [], [], ["genre", "scene", "emotion"], {
      finalization: opts.finalizationDiagnostics ?? null,
    }),
    stage("recovery_ranking", { generationDiagnostics: opts.generationDiagnostics ?? null }, { finalization: opts.finalizationDiagnostics ?? null }, activeDimensions, compact([
      opts.generationDiagnostics?.["recoveryTriggered"] ? "mood" as const : null,
      opts.generationDiagnostics?.["recoveryTriggered"] ? "emotion" as const : null,
    ]), [], ["energy"], ["mood", "emotion", "scene"], {
      recoveryTriggered: opts.generationDiagnostics?.["recoveryTriggered"] ?? false,
      recoveryRelaxations: opts.generationDiagnostics?.["recoveryRelaxations"] ?? [],
    }),
    stage("recovery_fallback", { finalization: opts.finalizationDiagnostics ?? null }, { finalTracks: opts.finalTracks.length }, activeDimensions, compact([
      opts.finalizationDiagnostics?.["hardSafeFillUsed"] ? "mood" as const : null,
      opts.finalizationDiagnostics?.["artistLimitRelaxed"] ? "subgenre" as const : null,
    ]), [], [], ["mood", "emotion", "scene"], {
      hardSafeFillUsed: opts.finalizationDiagnostics?.["hardSafeFillUsed"] ?? null,
      artistLimitRelaxed: opts.finalizationDiagnostics?.["artistLimitRelaxed"] ?? null,
      albumLimitRelaxed: opts.finalizationDiagnostics?.["albumLimitRelaxed"] ?? null,
    }),
    stage("finalization", { finalTracks: opts.finalTracks.length }, { finalValidation }, activeDimensions, weakFinal, dimensionsBelow(dimensions, 40), [], weakFinal, {
      strictGenreEvidence: opts.strictGenreEvidence ?? null,
      strictEraEvidence: opts.strictEraEvidence ?? null,
      finalValidation,
    }),
    stage("final_playlist", { finalValidation }, { scores: buildScores(dimensions) }, activeDimensions.filter((dimension) => dimensions[dimension].score >= 80), dimensionsBelow(dimensions, 80), dimensionsBelow(dimensions, 50), [], dimensionsBelow(dimensions, 80), {
      finalTrackCount: opts.finalTracks.length,
    }),
  ];
}

function buildEmotionSurvival(opts: BuildIntentSurvivalDiagnosticsOpts): EmotionSurvivalDiagnostics {
  const promptEmotion = dominantEmotionFromPrompt(opts.prompt, opts.emotionProfile);
  const distribution = finalEmotionDistribution(opts.finalTracks);
  const total = Math.max(1, opts.finalTracks.length);
  const dominantCount = promptEmotion.dominant ? distribution[promptEmotion.dominant] ?? 0 : total;
  const survivalPercent = promptEmotion.dominant ? roundPercent((dominantCount / total) * 100) : 100;
  const intensity = promptEmotion.dominant && opts.finalTracks.length > 0
    ? opts.finalTracks.reduce((sum, track) => sum + (emotionAffinities(track)[promptEmotion.dominant!] ?? 0), 0) / opts.finalTracks.length
    : 1;
  const finalDominant = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const polarityFlip =
    (promptEmotion.dominant === "melancholy" && finalDominant === "euphoria") ||
    (promptEmotion.dominant === "peace" && finalDominant === "aggression") ||
    (promptEmotion.dominant === "loneliness" && finalDominant === "euphoria") ||
    (promptEmotion.dominant === "nostalgia" && finalDominant === "aggression");
  const driftWarnings = compact([
    promptEmotion.dominant && survivalPercent < 55 ? `dominant_emotion_${promptEmotion.dominant}_below_55_percent` : null,
    promptEmotion.dominant && roundPercent(intensity * 100) < 50 ? `dominant_emotion_${promptEmotion.dominant}_intensity_weak` : null,
    polarityFlip ? `dominant_emotion_${promptEmotion.dominant}_may_flip_to_${finalDominant}` : null,
    opts.generationDiagnostics?.["recoveryTriggered"] ? "recovery_can_weaken_emotional_consistency" : null,
  ]);
  return {
    dominantEmotion: promptEmotion.dominant,
    promptEmotions: promptEmotion.scores,
    finalEmotionDistribution: distribution,
    survivalPercent,
    intensityRetainedPercent: roundPercent(intensity * 100),
    polarityFlipRisk: polarityFlip ? "critical" : survivalPercent < 55 ? "high" : survivalPercent < 75 ? "medium" : "low",
    driftWarnings,
    stageRisks: [
      {
        stage: "emotion_profile_parsing",
        canDrift: true,
        canMix: true,
        canWeaken: true,
        canFlip: false,
        reason: "Keyword weights can average competing prompt emotions.",
      },
      {
        stage: "unified_intent",
        canDrift: true,
        canMix: true,
        canWeaken: true,
        canFlip: true,
        reason: "Multiple intent vectors are averaged before V3.",
      },
      {
        stage: "v3_lanes",
        canDrift: true,
        canMix: true,
        canWeaken: true,
        canFlip: true,
        reason: "Contrast, motion, and exploration lanes can introduce alternate emotional forces.",
      },
      {
        stage: "recovery",
        canDrift: true,
        canMix: true,
        canWeaken: true,
        canFlip: true,
        reason: "Recovery can rank by broad energy/valence and may relax mood or activity.",
      },
      {
        stage: "finalization",
        canDrift: true,
        canMix: true,
        canWeaken: true,
        canFlip: false,
        reason: "Cohesion and hard-safe fills prioritize completion and safety over nuanced emotion.",
      },
    ],
  };
}

function buildConvergence(opts: BuildIntentSurvivalDiagnosticsOpts, parsedPromptIntent: LockedIntent): ConvergenceDiagnostics {
  const v3 = opts.v3Diagnostics ?? {};
  const retrievalPools = getNestedRecord(v3, "retrievalPoolsDetailed");
  const retrievalIds = [
    ...topTrackIds(getNestedRecord(retrievalPools, "core")?.["top20"]),
    ...topTrackIds(getNestedRecord(retrievalPools, "anchor")?.["top20"]),
    ...topTrackIds(getNestedRecord(retrievalPools, "adjacent")?.["top20"]),
    ...topTrackIds(getNestedRecord(retrievalPools, "bridge")?.["top20"]),
    ...topTrackIds(getNestedRecord(retrievalPools, "discovery")?.["top20"]),
    ...topTrackIds(getNestedRecord(retrievalPools, "energyArc")?.["top20"]),
  ];
  const candidateIds = topTrackIds(v3["preV3TopCandidates"]);
  const selectionTrace = safeArray(v3["selectionTrace"]);
  const samplerIds = selectionTrace
    .map((row) => row && typeof row === "object" ? (row as Record<string, unknown>)["trackId"] : null)
    .filter((id): id is string => typeof id === "string");
  const finalIds = idsFromTracks(opts.finalTracks);
  const overlap = {
    retrievalToCandidate: setOverlap(retrievalIds, candidateIds),
    candidateToSampler: setOverlap(candidateIds, samplerIds),
    samplerToFinal: setOverlap(samplerIds, finalIds),
    retrievalToFinal: setOverlap(retrievalIds, finalIds),
  };
  const likelyConvergencePoints = compact([
    parsedPromptIntent.genreFamilies.length > 0 && !parsedPromptIntent.primarySubgenre ? "family_level_prompt_signature" : null,
    getNestedRecord(v3, "intentContractGuard")?.["subgenreFallbackMode"] === "family" ? "subgenre_to_family_fallback" : null,
    getNestedRecord(v3, "intentContractGuard")?.["fallbackLevelUsed"] === "adjacent" ? "adjacent_family_expansion" : null,
    getNestedRecord(v3, "intentContractGuard")?.["fallbackLevelUsed"] === "global" ? "global_expansion" : null,
    overlap.retrievalToFinal != null && overlap.retrievalToFinal > 0.55 ? "high_retrieval_to_final_overlap" : null,
    Object.keys(opts.finalGenreDistribution ?? {}).length <= 1 ? "single_family_output_signature" : null,
  ]);
  const risk: SurvivalRisk =
    likelyConvergencePoints.includes("global_expansion") ? "critical" :
    likelyConvergencePoints.includes("adjacent_family_expansion") || likelyConvergencePoints.includes("subgenre_to_family_fallback") ? "high" :
    likelyConvergencePoints.length >= 2 ? "medium" :
    "low";
  return {
    promptSignature: signature(opts.prompt.split(/\s+/)),
    intentSignature: signature([
      ...(parsedPromptIntent.genreFamilies ?? []),
      parsedPromptIntent.primarySubgenre,
      parsedPromptIntent.activity,
      parsedPromptIntent.energy,
      ...(parsedPromptIntent.mood ?? []),
      parsedPromptIntent.eraRange ? `${parsedPromptIntent.eraRange.start}-${parsedPromptIntent.eraRange.end}` : null,
    ]),
    retrievalSignature: signature(Object.keys(opts.finalGenreDistribution ?? {}).concat(String(getNestedRecord(v3, "intentContractGuard")?.["fallbackLevelUsed"] ?? "none"))),
    candidateSignature: signature(stringArray(getNestedRecord(v3, "controlledGeneration")?.["relaxationSteps"]).concat(String(getNestedRecord(v3, "controlledGeneration")?.["selectedCandidate"] ?? ""))),
    samplerSignature: signature(Object.keys((v3["laneContributions"] as Record<string, unknown> | undefined) ?? {})),
    finalSignature: signature(Object.keys(opts.finalGenreDistribution ?? {}).concat(Object.keys(opts.finalMoodDistribution ?? {}), Object.keys(opts.finalEraDistribution ?? {}))),
    overlap,
    convergenceRisk: risk,
    likelyConvergencePoints,
  };
}

function buildLeakDetections(opts: BuildIntentSurvivalDiagnosticsOpts, dimensions: Record<SurvivalDimension, DimensionSurvivalScore>): IntentLeakDetection[] {
  const v3 = opts.v3Diagnostics ?? {};
  const contractGuard = getNestedRecord(v3, "intentContractGuard");
  const controlled = getNestedRecord(v3, "controlledGeneration");
  const finalRelaxed = getNestedRecord(controlled, "selectedRelaxation");
  const finalization = opts.finalizationDiagnostics ?? {};
  return compact<IntentLeakDetection>([
    dimensions.subgenre.explicit && dimensions.subgenre.score < 70 ? {
      file: "backend/core/playlist-pipeline.ts",
      functionName: "structuredRetrievalScope",
      reason: "Explicit subgenre survival below threshold; likely subgenre-to-family fallback or weak evidence.",
      severity: dimensions.subgenre.score < 40 ? "critical" : "high",
      affectedDimensions: ["subgenre", "genre"],
      evidence: dimensions.subgenre.evidence,
    } : null,
    contractGuard?.["fallbackLevelUsed"] && contractGuard["fallbackLevelUsed"] !== "none" ? {
      file: "backend/core/playlist-pipeline.ts",
      functionName: "buildPlaylistPipeline",
      reason: "Retrieval starvation expansion widened the candidate pool.",
      severity: contractGuard["fallbackLevelUsed"] === "global" ? "critical" : contractGuard["fallbackLevelUsed"] === "adjacent" ? "high" : "medium",
      affectedDimensions: contractGuard["fallbackLevelUsed"] === "family" ? ["subgenre"] : ["genre", "subgenre", "scene", "emotion"],
      evidence: {
        fallbackLevelUsed: contractGuard["fallbackLevelUsed"],
        fallbackExpansionPath: contractGuard["fallbackExpansionPath"] ?? [],
      },
    } : null,
    finalRelaxed ? {
      file: "backend/core/v3/constraint-relaxation.ts",
      functionName: "relaxedIntentForProfile",
      reason: "V3 selected a relaxed constraint profile.",
      severity: finalRelaxed["genre"] === "relaxed" || finalRelaxed["genre"] === "dropped" ? "critical" : "high",
      affectedDimensions: compact([
        finalRelaxed["era"] !== "strict" ? "era" as const : null,
        finalRelaxed["genre"] !== "strict" ? "genre" as const : null,
        finalRelaxed["mood"] !== "strict" ? "mood" as const : null,
        "emotion" as const,
      ]),
      evidence: finalRelaxed,
    } : null,
    opts.generationDiagnostics?.["recoveryTriggered"] ? {
      file: "backend/controllers/generation.controller.ts",
      functionName: "recoverLowComplexityPlaylist",
      reason: "Recovery path was used, so final output may have been produced under a weakened intent.",
      severity: "critical",
      affectedDimensions: ["mood", "activity", "energy", "emotion", "scene"],
      evidence: {
        recoveryRelaxations: opts.generationDiagnostics["recoveryRelaxations"] ?? [],
        fallbackLevel: opts.generationDiagnostics["fallbackLevel"] ?? null,
      },
    } : null,
    finalization["cohesionRelaxedFillUsed"] ? {
      file: "backend/controllers/generation.controller.ts",
      functionName: "finalizePlaylistTracks",
      reason: "Finalization relaxed cohesion to fill the playlist.",
      severity: "high",
      affectedDimensions: ["genre", "scene", "emotion", "atmosphere"],
      evidence: finalization,
    } : null,
    opts.strictGenreEvidence?.["relaxed"] ? {
      file: "backend/controllers/generation.controller.ts",
      functionName: "strictGenreEvidenceDiagnostics",
      reason: "Explicit genre evidence guard relaxed to best available.",
      severity: "critical",
      affectedDimensions: ["genre", "subgenre"],
      evidence: opts.strictGenreEvidence,
    } : null,
    opts.strictEraEvidence?.["relaxed"] ? {
      file: "backend/controllers/generation.controller.ts",
      functionName: "strictEraEvidenceDiagnostics",
      reason: "Explicit era evidence guard relaxed.",
      severity: "high",
      affectedDimensions: ["era"],
      evidence: opts.strictEraEvidence,
    } : null,
    dimensions.emotion.explicit && dimensions.emotion.score < 60 ? {
      file: "backend/lib/intent-survival-diagnostics.ts",
      functionName: "buildIntentSurvivalDiagnostics",
      reason: "Dominant prompt emotion does not dominate final tracks.",
      severity: dimensions.emotion.score < 40 ? "critical" : "high",
      affectedDimensions: ["emotion", "mood", "scene"],
      evidence: dimensions.emotion.evidence,
    } : null,
  ]);
}

function buildRelaxationAudit(opts: BuildIntentSurvivalDiagnosticsOpts): RelaxationDetection[] {
  const v3 = opts.v3Diagnostics ?? {};
  const contractGuard = getNestedRecord(v3, "intentContractGuard");
  const controlled = getNestedRecord(v3, "controlledGeneration");
  const finalRelaxed = getNestedRecord(controlled, "selectedRelaxation");
  const finalization = opts.finalizationDiagnostics ?? {};
  return compact<RelaxationDetection>([
    contractGuard?.["subgenreFallbackMode"] === "family" ? {
      path: "subgenre -> genre family",
      trigger: "Primary/related subgenre evidence below threshold.",
      maximumExpansion: "All tracks in the same root genre family.",
      dimensionsSacrificed: ["subgenre"],
      riskLevel: "high",
      evidence: {
        subgenrePrimaryCount: contractGuard["subgenrePrimaryCount"] ?? null,
        subgenreRelatedCount: contractGuard["subgenreRelatedCount"] ?? null,
        subgenreFamilyCount: contractGuard["subgenreFamilyCount"] ?? null,
      },
    } : null,
    contractGuard?.["fallbackLevelUsed"] && contractGuard["fallbackLevelUsed"] !== "none" ? {
      path: `contract pool -> ${String(contractGuard["fallbackLevelUsed"])} expansion`,
      trigger: String(contractGuard["starvationTriggerReason"] ?? "pre-ranking pool below safe minimum"),
      maximumExpansion: contractGuard["fallbackLevelUsed"] === "global" ? "Full scored pool" : contractGuard["fallbackLevelUsed"] === "adjacent" ? "Adjacent genre families" : "Same genre family",
      dimensionsSacrificed: contractGuard["fallbackLevelUsed"] === "family" ? ["subgenre"] : ["genre", "subgenre", "scene", "emotion"],
      riskLevel: contractGuard["fallbackLevelUsed"] === "global" ? "critical" : contractGuard["fallbackLevelUsed"] === "adjacent" ? "high" : "medium",
      evidence: contractGuard,
    } : null,
    finalRelaxed ? {
      path: "strict V3 intent -> relaxed V3 intent",
      trigger: "Strict candidate count below minimum candidate count.",
      maximumExpansion: "Era, genre, audio, and mood can be relaxed depending on selected profile.",
      dimensionsSacrificed: compact([
        finalRelaxed["era"] !== "strict" ? "era" as const : null,
        finalRelaxed["genre"] !== "strict" ? "genre" as const : null,
        finalRelaxed["audio"] !== "strict" ? "energy" as const : null,
        finalRelaxed["mood"] !== "strict" ? "mood" as const : null,
        "emotion" as const,
      ]),
      riskLevel: finalRelaxed["genre"] !== "strict" ? "critical" : "high",
      evidence: finalRelaxed,
    } : null,
    opts.noLibrarySpotify?.["fallbackReason"] ? {
      path: "no-library strict search -> family/broad Spotify search",
      trigger: String(opts.noLibrarySpotify["fallbackReason"]),
      maximumExpansion: "Family queries and broad popular searches.",
      dimensionsSacrificed: ["subgenre", "mood", "scene", "era", "emotion"],
      riskLevel: "high",
      evidence: opts.noLibrarySpotify,
    } : null,
    opts.generationDiagnostics?.["recoveryTriggered"] ? {
      path: "main pipeline -> recovery",
      trigger: "Final track count below recovery threshold or completion target.",
      maximumExpansion: "Broad energy recovery and weakened activity/mood/energy intent.",
      dimensionsSacrificed: ["activity", "mood", "energy", "emotion", "scene"],
      riskLevel: "critical",
      evidence: opts.generationDiagnostics,
    } : null,
    finalization["artistLimitRelaxed"] || finalization["albumLimitRelaxed"] || finalization["hardSafeFillUsed"] ? {
      path: "finalization strict fill -> hard-safe/relaxed fill",
      trigger: "Playlist underfilled after normal finalization.",
      maximumExpansion: "Relaxed artist/album/cohesion/repeat constraints while keeping hard safety checks.",
      dimensionsSacrificed: ["genre", "subgenre", "scene", "emotion", "atmosphere"],
      riskLevel: "high",
      evidence: finalization,
    } : null,
  ]);
}

function buildStageByStageLog(stageTrace: IntentStageTrace[], dimensions: Record<SurvivalDimension, DimensionSurvivalScore>): IntentSurvivalDiagnostics["stageByStageLog"] {
  return stageTrace.map((item) => {
    const affected = unique([...item.weakenedDimensions, ...item.lostDimensions, ...item.potentialDriftVectors]);
    const activeScores = affected
      .filter((dimension) => dimensions[dimension]?.explicit)
      .map((dimension) => dimensions[dimension].score);
    return {
      stage: item.stage,
      summary: affected.length > 0
        ? `${item.stage} risk: ${affected.join(", ")}`
        : `${item.stage} preserved explicit intent dimensions`,
      counts: {
        preserved: item.preservedDimensions.length,
        weakened: item.weakenedDimensions.length,
        lost: item.lostDimensions.length,
        driftVectors: item.potentialDriftVectors.length,
      },
      survivalPercent: activeScores.length > 0
        ? roundPercent(activeScores.reduce((sum, value) => sum + value, 0) / activeScores.length)
        : null,
    };
  });
}

function riskRank(risks: SurvivalRisk[]): SurvivalRisk {
  if (risks.includes("critical")) return "critical";
  if (risks.includes("high")) return "high";
  if (risks.includes("medium")) return "medium";
  return "low";
}

function buildTermTrace(
  intentUnderstanding: IntentUnderstandingDiagnostics | null | undefined,
  stageTrace: IntentStageTrace[],
): IntentTermTrace[] {
  if (!intentUnderstanding) return [];

  const traces: IntentTermTrace[] = [];
  for (const term of intentUnderstanding.unrecognizedTerms) {
    traces.push({
      term,
      status: "unrecognized",
      stage: "parse",
      note: "No vocabulary or anchor match",
    });
  }

  for (const assumption of intentUnderstanding.assumptions) {
    const inferred = assumption.split("->")[0]?.trim();
    if (!inferred) continue;
    traces.push({
      term: inferred,
      status: "assumed",
      stage: "parse",
      note: assumption,
    });
  }

  for (const stage of stageTrace) {
    for (const dimension of stage.lostDimensions) {
      traces.push({
        term: dimension,
        status: "lost",
        stage: stage.stage,
        note: `Lost during ${stage.stage}`,
      });
    }
    for (const dimension of stage.weakenedDimensions) {
      traces.push({
        term: dimension,
        status: "drifted",
        stage: stage.stage,
        note: `Weakened during ${stage.stage}`,
      });
    }
  }

  const recognized = [
    ...intentUnderstanding.recognizedConcepts.activity,
    ...intentUnderstanding.recognizedConcepts.atmosphere,
    ...intentUnderstanding.recognizedConcepts.emotion,
    ...intentUnderstanding.recognizedConcepts.time,
    ...intentUnderstanding.recognizedConcepts.place,
    ...intentUnderstanding.recognizedConcepts.genre,
  ];
  for (const concept of recognized.slice(0, 12)) {
    traces.push({
      term: concept,
      status: "recognized",
      stage: "parse",
      note: null,
    });
  }

  return traces.slice(0, 40);
}

function buildIntentLossPipeline(
  intentUnderstanding: IntentUnderstandingDiagnostics | null | undefined,
  opts: BuildIntentSurvivalDiagnosticsOpts,
  parsedPromptIntent: LockedIntent,
): IntentLossStage[] {
  const v3 = opts.v3Diagnostics ?? {};
  const intentDecomposition = (v3["intentDecomposition"] ?? {}) as Record<string, unknown>;
  const retrievalConcepts = [
    ...(Array.isArray(intentDecomposition["genreHints"]) ? intentDecomposition["genreHints"] as string[] : []),
    ...(Array.isArray(intentDecomposition["moodTags"]) ? intentDecomposition["moodTags"] as string[] : []),
    ...(Array.isArray(intentDecomposition["activityTags"]) ? intentDecomposition["activityTags"] as string[] : []),
  ].filter(Boolean);

  const finalGenres = Object.keys(opts.finalGenreDistribution ?? {}).slice(0, 6);
  const finalMoods = Object.keys(opts.finalMoodDistribution ?? {}).slice(0, 4);

  const parseConcepts = intentUnderstanding?.recognizedConcepts ?? {
    activity: parsedPromptIntent.activity ? [parsedPromptIntent.activity] : [],
    atmosphere: [],
    emotion: parsedPromptIntent.mood,
    time: [],
    place: [],
    genre: parsedPromptIntent.genreFamilies,
    era: parsedPromptIntent.eraRange ? [`${parsedPromptIntent.eraRange.start}-${parsedPromptIntent.eraRange.end}`] : [],
  };

  const lostAtParse = intentUnderstanding?.unrecognizedTerms ?? [];

  return [
    {
      stage: "original_prompt",
      summary: opts.prompt,
      concepts: { prompt: [opts.prompt] },
      lostTerms: [],
    },
    {
      stage: "recognized_concepts",
      summary: "Parser output after vocabulary, semantic, and scene analysis",
      concepts: parseConcepts as unknown as Record<string, string[]>,
      lostTerms: lostAtParse,
    },
    {
      stage: "retrieval_concepts",
      summary: "Concepts passed into retrieval and lane scoring",
      concepts: {
        genre: retrievalConcepts.filter((c) => parsedPromptIntent.genreFamilies.includes(c) || /rock|pop|blues|indie|metal|electronic/i.test(c)),
        mood: retrievalConcepts.filter((c) => parsedPromptIntent.mood.includes(c)),
        activity: retrievalConcepts.filter((c) => c === parsedPromptIntent.activity),
        lanes: Object.keys((v3["laneContributions"] ?? {}) as Record<string, unknown>).slice(0, 6),
      },
      lostTerms: lostAtParse,
    },
    {
      stage: "final_playlist",
      summary: "Dominant traits in published playlist",
      concepts: {
        genre: finalGenres,
        mood: finalMoods,
        energy: Object.keys(opts.finalEnergyDistribution ?? {}).slice(0, 3),
      },
      lostTerms: [
        ...lostAtParse,
        ...(intentUnderstanding && intentUnderstanding.confidence < 0.55 ? ["low_intent_confidence"] : []),
      ],
    },
  ];
}

function buildReleaseReadiness(
  dimensions: Record<SurvivalDimension, DimensionSurvivalScore>,
  leaks: IntentLeakDetection[],
  emotion: EmotionSurvivalDiagnostics,
): IntentSurvivalDiagnostics["releaseReadiness"] {
  const can = (dimension: SurvivalDimension, threshold = 75): boolean =>
    !dimensions[dimension].explicit || dimensions[dimension].score >= threshold;
  const risks = [...leaks.map((leak) => leak.severity), emotion.polarityFlipRisk];
  return {
    canPreserveGenre: can("genre", 85),
    canPreserveSubgenre: can("subgenre", 75),
    canPreserveMood: can("mood", 75),
    canPreserveScene: can("scene", 70),
    canPreserveActivity: can("activity", 80),
    canPreserveEra: can("era", 85),
    canPreserveEmotion: can("emotion", 75),
    highestRisk: riskRank(risks),
    highestRiskReasons: [
      ...leaks.filter((leak) => leak.severity === riskRank(risks)).map((leak) => `${leak.functionName}: ${leak.reason}`),
      ...emotion.driftWarnings,
    ].slice(0, 10),
  };
}

export function buildIntentSurvivalDiagnostics(opts: BuildIntentSurvivalDiagnosticsOpts): IntentSurvivalDiagnostics {
  const parsedPromptIntent = buildLockedIntent(opts.prompt);
  const dimensions = buildDimensionScores(opts, parsedPromptIntent);
  const scores = buildScores(dimensions);
  const stageTrace = buildStageTrace(opts, parsedPromptIntent, dimensions);
  const emotionSurvival = buildEmotionSurvival(opts);
  const convergence = buildConvergence(opts, parsedPromptIntent);
  const leakDetections = buildLeakDetections(opts, dimensions);
  const relaxationAudit = buildRelaxationAudit(opts);
  const stageByStageLog = buildStageByStageLog(stageTrace, dimensions);
  const releaseReadiness = buildReleaseReadiness(dimensions, leakDetections, emotionSurvival);
  const termTrace = buildTermTrace(opts.intentUnderstanding, stageTrace);
  const intentLossPipeline = buildIntentLossPipeline(opts.intentUnderstanding, opts, parsedPromptIntent);
  const truthfulMetrics = computeTruthfulMetrics({ prompt: opts.prompt, tracks: opts.finalTracks });
  return {
    prompt: opts.prompt,
    generatedAt: new Date().toISOString(),
    dimensions,
    scores,
    stageTrace,
    emotionSurvival,
    convergence,
    leakDetections,
    relaxationAudit,
    stageByStageLog,
    releaseReadiness,
    intentUnderstanding: opts.intentUnderstanding ?? null,
    termTrace,
    intentLossPipeline,
    truthfulMetrics,
  };
}
