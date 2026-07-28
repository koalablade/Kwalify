/**
 * Playlist Confidence & Retrieval Orchestrator — decision layer before candidate retrieval.
 * Analyses library capability, selects retrieval strategy, validates pool sufficiency,
 * and elects a human opener. Never silently widens to Spotify catalogue mode.
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
import {
  buildPromptRetrievalProfile,
  retrieveScoringCandidates,
  type RetrievalDiagnostics,
  type RetrievalProfile,
  type RetrievalSourceId,
  type RetrievalStrategyId,
  type RetrievalTrackInput,
} from "./candidate-retrieval-pipeline";
import { inferWorldIdentityIdsFromPrompt } from "../core/editorial/world-identity-gate";
import { resolveCommittedWorld } from "../core/committed-world";
import type { WorldCoverageAssessment } from "../core/editorial/world-coverage";
import type { LibrarySignals } from "./library-signals";
import {
  buildPromptSonicTarget,
  buildSonicTasteProfile,
  scoreTrackSonicPromptFit,
  scoreUserSonicAffinity,
  type SonicTasteProfile,
} from "./sonic-taste-profile";
import {
  estimateValidCandidateSupply,
  minRequiredValidCandidates,
  type ValidCandidateSupply,
} from "./library-valid-candidate-supply";
import {
  buildBlendedIntentPool,
  isCompoundPromptIntent,
  strictSupplyStarved,
  type BlendedPoolDiagnostics,
} from "./blended-intent-pool";
import type { LockedIntent } from "../core/v3/intent";

export type { RetrievalStrategyId };

export type LibraryCapability = {
  score: number;
  activityScore: number;
  genreScore: number;
  energyScore: number;
  sonicScore: number;
  promptFitScore: number;
  openerScore: number;
  diversityScore: number;
  limitingFactors: string[];
};

export type CandidateSufficiency = {
  score: number;
  genrePurity: number;
  activitySuitability: number;
  energySpread: number;
  openerQuality: number;
  diversity: number;
  emotionalCoherence: number;
};

export type HumanOpenerElection = {
  trackId: string | null;
  confidence: number;
  activityFit: number;
  emotionalIdentity: number;
  recognisability: number;
  momentum: number;
};

export type RetrievalStrategyPlan = {
  strategy: RetrievalStrategyId;
  libraryGravityWeight: number;
  exploratoryQuotaBoost: number;
  adaptivePromptWeightShift: number;
  reason: string;
};

export type OrchestratorFailure = {
  code: "LIBRARY_INSUFFICIENT_FOR_PROMPT";
  message: string;
  suggestDiscoveryMode: true;
  suggestRefinePrompt: true;
  libraryCapability: LibraryCapability;
  combinedConfidence: number;
  limitingFactors: string[];
};

export type OrchestratorDiagnostics = {
  libraryCapability: LibraryCapability;
  validCandidateSupply: ValidCandidateSupply;
  strategy: RetrievalStrategyId;
  strategyPlan: RetrievalStrategyPlan;
  retrievalAttempts: number;
  candidateSufficiency: CandidateSufficiency;
  combinedConfidence: number;
  humanOpener: HumanOpenerElection;
  librarySufficient: boolean;
  integrityPolicy: "liked_library_only" | "spotify_discovery";
  adaptivePromptWeightShift: number;
  retrievalDiagnostics?: RetrievalDiagnostics | Record<string, unknown>;
  blendedIntentPool?: BlendedPoolDiagnostics | null;
};

export type OrchestratePlaylistRetrievalOpts<T extends RetrievalTrackInput> = {
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
  requestedLength: number;
  sceneActive?: boolean;
  debugRetrieval?: boolean;
  noLibraryMode?: boolean;
  promptConfidence?: number;
  recentTrackPenalty?: Map<string, number>;
  sessionMemory?: {
    artistFrequencyMap?: Record<string, number>;
    usedTracks?: Set<string>;
  };
  librarySignals?: LibrarySignals;
  sonicTasteProfile?: SonicTasteProfile | null;
  /** V10: anchor expansion candidates from world-anchor-retrieval. */
  expansionCandidates?: RetrievalTrackInput[];
  /** V10: pre-computed world coverage assessment. */
  worldCoverage?: WorldCoverageAssessment | null;
};

export type OrchestratePlaylistRetrievalResult<T extends RetrievalTrackInput> = {
  tracks: T[];
  diagnostics: OrchestratorDiagnostics;
  failure?: OrchestratorFailure;
};

const FUNCTIONAL_ACTIVITIES = new Set(["focus_coding", "study", "gym", "party_pregame"]);
const CAPABILITY_SAMPLE = 1800;
/** Minimum synced liked tracks for library-only generation (orchestrator hard gate). */
export const MIN_LIBRARY_TRACKS = 40;

function classifyFor<T extends RetrievalTrackInput>(
  track: T,
  classMap: OrchestratePlaylistRetrievalOpts<T>["classMap"],
): ActivityClassificationInput {
  return classMap.get(track.trackId) ?? null;
}

function sampleTracks<T>(tracks: T[], max: number): T[] {
  if (tracks.length <= max) return tracks;
  const step = tracks.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) {
    out.push(tracks[Math.floor(i * step)]!);
  }
  return out;
}

function genreFamilyEntropy(
  tracks: RetrievalTrackInput[],
  classMap: OrchestratePlaylistRetrievalOpts<RetrievalTrackInput>["classMap"],
): number {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const family = classMap.get(track.trackId)?.genreFamily ?? "unknown";
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  const total = tracks.length || 1;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(Math.max(2, counts.size));
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

function quickEmotionFit(track: ActivityTrackInput, profile: EmotionProfile): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return Math.max(0, 1 - (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2);
}

function genreMatchScore(
  track: RetrievalTrackInput,
  classification: ActivityClassificationInput,
  expectations: string[],
): number {
  if (expectations.length === 0) return 0.55;
  const family = classification?.genreFamily ?? "unknown";
  const primary = classification?.genrePrimary ?? "";
  const sub = classification?.primarySubgenre ?? "";
  for (const expected of expectations) {
    if (family === expected || primary === expected || sub === expected) return 1;
  }
  return 0.2;
}

function energyInBand(track: ActivityTrackInput, profile: ActivityProfile | null, emotion: EmotionProfile): boolean {
  const energy = track.energy ?? 0.5;
  if (profile) return energy >= profile.energyMin && energy <= profile.energyMax;
  return Math.abs(energy - emotion.energy) <= 0.22;
}

function tempoInBand(track: ActivityTrackInput, profile: ActivityProfile | null): boolean {
  if (!profile || profile.tempoMin == null || profile.tempoMax == null) return true;
  const tempo = track.tempo;
  if (tempo == null) return true;
  return tempo >= profile.tempoMin && tempo <= profile.tempoMax;
}

function scoreOpenerCandidate(
  track: RetrievalTrackInput,
  classification: ActivityClassificationInput,
  activityProfile: ActivityProfile | null,
  vibe: string,
  emotionProfile: EmotionProfile,
): number {
  if (activityProfile) {
    if (trackFailsActivityHardGate(track, classification, activityProfile, vibe)) return -1;
    return activityOpeningBoost(track, classification, activityProfile, vibe, 0);
  }
  const pop = typeof track.popularity === "number" ? Math.min(1, track.popularity / 100) : 0.45;
  return pop * 0.35 + quickEmotionFit(track, emotionProfile) * 0.65;
}

function detectLibraryPromptConflict(
  sample: RetrievalTrackInput[],
  activityProfile: ActivityProfile | null,
  classMap: OrchestratePlaylistRetrievalOpts<RetrievalTrackInput>["classMap"],
): boolean {
  if (!activityProfile || sample.length < 20) return false;
  const energies = sample.map((t) => t.energy ?? 0.5);
  const dances = sample.map((t) => t.danceability ?? 0.5);
  const instrumentals = sample.map((t) => t.instrumentalness ?? 0.2);
  const meanEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
  const meanDance = dances.reduce((a, b) => a + b, 0) / dances.length;
  const meanInstrumental = instrumentals.reduce((a, b) => a + b, 0) / instrumentals.length;

  const familyCounts = new Map<string, number>();
  for (const track of sample) {
    const family = classMap.get(track.trackId)?.genreFamily ?? "unknown";
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }
  const topFamily = [...familyCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topFamilyShare = topFamily ? topFamily[1] / sample.length : 0;

  if (activityProfile.id === "gym" && meanEnergy < 0.52 && topFamilyShare >= 0.45) return true;
  if (
    (activityProfile.id === "focus_coding" || activityProfile.id === "study") &&
    meanDance >= 0.62 &&
    meanInstrumental < 0.28
  ) {
    return true;
  }
  if (activityProfile.id === "party_pregame" && meanEnergy < 0.5 && meanDance < 0.52) return true;
  return false;
}

export function analyzeLibraryCapability<T extends RetrievalTrackInput>(
  opts: Pick<
    OrchestratePlaylistRetrievalOpts<T>,
    "tracks" | "vibe" | "intent" | "emotionProfile" | "classMap" | "requestedLength" | "sonicTasteProfile"
  >,
): LibraryCapability {
  const sample = sampleTracks(opts.tracks, CAPABILITY_SAMPLE);
  const retrievalProfile = buildPromptRetrievalProfile(
    opts.vibe,
    opts.intent,
    opts.emotionProfile,
    [],
  );
  const activityProfile = retrievalProfile.activityProfile;
  const limitingFactors: string[] = [];

  if (opts.tracks.length < MIN_LIBRARY_TRACKS) {
    limitingFactors.push("library_too_small");
  }

  let activityHits = 0;
  let genreHits = 0;
  let energyHits = 0;
  let sonicHits = 0;
  let strongOpeners = 0;
  const activityThreshold = activityProfile ? 0.52 : 0.45;
  const promptSonicTarget = buildPromptSonicTarget(opts.vibe, opts.emotionProfile, activityProfile);
  const userSonicProfile = opts.sonicTasteProfile ?? buildSonicTasteProfile(sample);

  for (const track of sample) {
    const classification = classifyFor(track, opts.classMap);
    const activityFit = activityProfile
      ? scoreActivityCandidateFit(track, classification, activityProfile, opts.vibe)
      : quickEmotionFit(track, opts.emotionProfile);
    if (activityFit >= activityThreshold) activityHits += 1;
    if (genreMatchScore(track, classification, retrievalProfile.genreExpectations) >= 0.8) genreHits += 1;
    if (energyInBand(track, activityProfile, opts.emotionProfile) && tempoInBand(track, activityProfile)) {
      energyHits += 1;
    }
    const sonicFit = scoreTrackSonicPromptFit(track, promptSonicTarget, userSonicProfile);
    if (sonicFit >= 0.58) sonicHits += 1;
    const opener = scoreOpenerCandidate(track, classification, activityProfile, opts.vibe, opts.emotionProfile);
    if (opener >= 0.58) strongOpeners += 1;
  }

  const denom = Math.max(1, sample.length);
  const activityScore = Math.round((activityHits / denom) * 100);
  const genreScore = Math.round((genreHits / denom) * 100);
  const energyScore = Math.round((energyHits / denom) * 100);
  const sonicScore = Math.round((sonicHits / denom) * 100);
  const openerScore = Math.round(Math.min(100, (strongOpeners / Math.max(8, opts.requestedLength * 0.3)) * 100));
  const diversityScore = Math.round(genreFamilyEntropy(sample, opts.classMap) * 100);
  const promptFitScore = Math.round(activityScore * 0.38 + genreScore * 0.22 + energyScore * 0.2 + sonicScore * 0.2);

  if (activityScore < 35) limitingFactors.push("low_activity_match");
  if (genreScore < 30 && retrievalProfile.genreExpectations.length > 0) limitingFactors.push("genre_gap");
  if (energyScore < 40) limitingFactors.push("energy_distribution_mismatch");
  if (sonicScore < 32) limitingFactors.push("low_sonic_match");
  if (openerScore < 45) limitingFactors.push("weak_opening_candidates");
  if (diversityScore < 25) limitingFactors.push("low_genre_diversity");
  if (detectLibraryPromptConflict(sample, activityProfile, opts.classMap)) {
    limitingFactors.push("library_prompt_conflict");
  }

  const weights = activityProfile
    ? { activity: 0.26, genre: 0.14, energy: 0.16, sonic: 0.14, opener: 0.18, diversity: 0.12 }
    : { activity: 0.16, genre: 0.18, energy: 0.14, sonic: 0.18, opener: 0.18, diversity: 0.16 };
  let score = Math.round(
    activityScore * weights.activity +
    genreScore * weights.genre +
    energyScore * weights.energy +
    sonicScore * weights.sonic +
    openerScore * weights.opener +
    diversityScore * weights.diversity,
  );
  if (limitingFactors.includes("library_prompt_conflict")) {
    score = Math.min(score, 28);
  }

  return {
    score,
    activityScore,
    genreScore,
    energyScore,
    sonicScore,
    promptFitScore,
    openerScore,
    diversityScore,
    limitingFactors,
  };
}

export function selectRetrievalStrategy(
  capability: LibraryCapability,
  retrievalProfile: RetrievalProfile,
  opts: {
    noLibraryMode?: boolean;
    promptConfidence?: number;
    functionalPrompt: boolean;
    retryAttempt?: number;
  },
): RetrievalStrategyPlan {
  if (opts.noLibraryMode) {
    return {
      strategy: "D_spotify_catalogue",
      libraryGravityWeight: 0,
      exploratoryQuotaBoost: 0,
      adaptivePromptWeightShift: 0.14,
      reason: "user_opted_discovery_mode",
    };
  }

  if (opts.retryAttempt && opts.retryAttempt >= 2) {
    return {
      strategy: "B_liked_exploratory",
      libraryGravityWeight: opts.functionalPrompt ? 0.04 : 0.16,
      exploratoryQuotaBoost: opts.functionalPrompt ? 0.18 : 0.12,
      adaptivePromptWeightShift: opts.functionalPrompt ? 0.14 : 0.08,
      reason: "low_valid_candidate_supply_retry",
    };
  }

  if (opts.retryAttempt && opts.retryAttempt >= 1) {
    return {
      strategy: "B_liked_exploratory",
      libraryGravityWeight: opts.functionalPrompt ? 0.06 : 0.22,
      exploratoryQuotaBoost: opts.functionalPrompt ? 0.14 : 0.08,
      adaptivePromptWeightShift: opts.functionalPrompt ? 0.12 : 0.05,
      reason: "candidate_sufficiency_retry",
    };
  }

  const highCapability = capability.score >= (opts.functionalPrompt ? 58 : 48);
  if (highCapability) {
    return {
      strategy: "A_liked_only",
      libraryGravityWeight: opts.functionalPrompt ? 0.1 : 0.38,
      exploratoryQuotaBoost: 0,
      adaptivePromptWeightShift: opts.functionalPrompt ? 0.1 : 0.03,
      reason: "library_capability_sufficient",
    };
  }

  const moderateCapability = capability.score >= (opts.functionalPrompt ? 36 : 28);
  if (moderateCapability) {
    return {
      strategy: "B_liked_exploratory",
      libraryGravityWeight: opts.functionalPrompt ? 0.08 : 0.28,
      exploratoryQuotaBoost: opts.functionalPrompt ? 0.12 : 0.07,
      adaptivePromptWeightShift: opts.functionalPrompt ? 0.11 : 0.04,
      reason: "library_capability_moderate",
    };
  }

  return {
    strategy: "A_liked_only",
    libraryGravityWeight: opts.functionalPrompt ? 0.05 : 0.2,
    exploratoryQuotaBoost: opts.functionalPrompt ? 0.1 : 0.05,
    adaptivePromptWeightShift: opts.functionalPrompt ? 0.13 : 0.06,
    reason: "low_capability_last_attempt",
  };
}

export function evaluateCandidateSufficiency<T extends RetrievalTrackInput>(
  pool: T[],
  opts: Pick<OrchestratePlaylistRetrievalOpts<T>, "vibe" | "intent" | "emotionProfile" | "classMap">,
): CandidateSufficiency {
  const retrievalProfile = buildPromptRetrievalProfile(opts.vibe, opts.intent, opts.emotionProfile, []);
  const activityProfile = retrievalProfile.activityProfile;
  const sample = pool.slice(0, Math.min(pool.length, 240));

  let genreHits = 0;
  const activityFits: number[] = [];
  const energies: number[] = [];
  const emotionFits: number[] = [];
  const openerScores: number[] = [];

  for (const track of sample) {
    const classification = classifyFor(track, opts.classMap);
    if (genreMatchScore(track, classification, retrievalProfile.genreExpectations) >= 0.8) genreHits += 1;
    const activityFit = activityProfile
      ? scoreActivityCandidateFit(track, classification, activityProfile, opts.vibe)
      : quickEmotionFit(track, opts.emotionProfile);
    activityFits.push(activityFit);
    energies.push(track.energy ?? 0.5);
    emotionFits.push(quickEmotionFit(track, opts.emotionProfile));
    const opener = scoreOpenerCandidate(track, classification, activityProfile, opts.vibe, opts.emotionProfile);
    if (opener >= 0) openerScores.push(opener);
  }

  const genrePurity = sample.length ? genreHits / sample.length : 0;
  const activitySuitability = activityFits.length
    ? activityFits.reduce((a, b) => a + b, 0) / activityFits.length
    : 0;
  const energyMean = energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : 0.5;
  const energySpread = energies.length
    ? Math.sqrt(energies.reduce((s, e) => s + (e - energyMean) ** 2, 0) / energies.length)
    : 0;
  const openerQuality = openerScores.length
    ? openerScores.sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0) / Math.min(8, openerScores.length)
    : 0;
  const diversity = genreFamilyEntropy(sample, opts.classMap);
  const emotionMean = emotionFits.length ? emotionFits.reduce((a, b) => a + b, 0) / emotionFits.length : 0;
  const emotionVar = emotionFits.length
    ? emotionFits.reduce((s, f) => s + (f - emotionMean) ** 2, 0) / emotionFits.length
    : 0;
  const emotionalCoherence = Math.max(0, 1 - Math.sqrt(emotionVar) * 1.4);

  const spreadScore = energySpread >= 0.07 && energySpread <= 0.2 ? 1 : energySpread < 0.05 ? 0.35 : 0.7;
  const score = Math.round(
    (genrePurity * 0.18 +
      activitySuitability * 0.28 +
      spreadScore * 0.1 +
      openerQuality * 0.22 +
      diversity * 0.12 +
      emotionalCoherence * 0.1) *
      100,
  );

  return {
    score,
    genrePurity: Math.round(genrePurity * 100) / 100,
    activitySuitability: Math.round(activitySuitability * 100) / 100,
    energySpread: Math.round(energySpread * 100) / 100,
    openerQuality: Math.round(openerQuality * 100) / 100,
    diversity: Math.round(diversity * 100) / 100,
    emotionalCoherence: Math.round(emotionalCoherence * 100) / 100,
  };
}

export function electHumanOpener<T extends RetrievalTrackInput>(
  pool: T[],
  opts: Pick<
    OrchestratePlaylistRetrievalOpts<T>,
    "vibe" | "intent" | "emotionProfile" | "classMap" | "sonicTasteProfile"
  >,
): HumanOpenerElection {
  const retrievalProfile = buildPromptRetrievalProfile(opts.vibe, opts.intent, opts.emotionProfile, []);
  const activityProfile = retrievalProfile.activityProfile;
  const promptSonicTarget = buildPromptSonicTarget(opts.vibe, opts.emotionProfile, activityProfile);
  const userSonicProfile = opts.sonicTasteProfile ?? buildSonicTasteProfile(pool);
  const candidates = pool.slice(0, Math.min(pool.length, 48));

  let best: {
    track: T;
    composite: number;
    activityFit: number;
    emotionalIdentity: number;
    recognisability: number;
    momentum: number;
    sonicFit: number;
  } | null = null;

  for (const track of candidates) {
    const classification = classifyFor(track, opts.classMap);
    const activityFit = activityProfile
      ? scoreActivityCandidateFit(track, classification, activityProfile, opts.vibe)
      : quickEmotionFit(track, opts.emotionProfile);
    if (activityProfile && trackFailsActivityHardGate(track, classification, activityProfile, opts.vibe)) continue;

    const emotionalIdentity = quickEmotionFit(track, opts.emotionProfile);
    const recognisability = typeof track.popularity === "number"
      ? Math.min(1, track.popularity / 100)
      : 0.42;
    const energy = track.energy ?? 0.5;
    const targetEnergy = activityProfile
      ? (activityProfile.energyMin + activityProfile.energyMax) / 2
      : opts.emotionProfile.energy;
    const momentum = Math.max(0, 1 - Math.abs(energy - targetEnergy) * 1.6);
    const sonicFit = scoreTrackSonicPromptFit(track, promptSonicTarget, userSonicProfile);
    const userAffinity = userSonicProfile ? scoreUserSonicAffinity(track, userSonicProfile) : 0.5;
    const composite =
      activityFit * 0.32 +
      emotionalIdentity * 0.22 +
      recognisability * 0.18 +
      momentum * 0.18 +
      sonicFit * 0.06 +
      userAffinity * 0.04;

    if (
      !best ||
      composite > best.composite ||
      (Math.abs(composite - best.composite) < 0.025 && sonicFit > best.sonicFit)
    ) {
      best = { track, composite, activityFit, emotionalIdentity, recognisability, momentum, sonicFit };
    }
  }

  if (!best) {
    return {
      trackId: null,
      confidence: 0,
      activityFit: 0,
      emotionalIdentity: 0,
      recognisability: 0,
      momentum: 0,
    };
  }

  return {
    trackId: best.track.trackId,
    confidence: Math.round(best.composite * 100) / 100,
    activityFit: Math.round(best.activityFit * 100) / 100,
    emotionalIdentity: Math.round(best.emotionalIdentity * 100) / 100,
    recognisability: Math.round(best.recognisability * 100) / 100,
    momentum: Math.round(best.momentum * 100) / 100,
  };
}

function combinedGenerationConfidence(
  capability: LibraryCapability,
  sufficiency: CandidateSufficiency,
  opener: HumanOpenerElection,
  retrievalProfile: RetrievalProfile,
  opts?: {
    promptConfidence?: number;
    validCandidateSupply?: ValidCandidateSupply;
    requestedLength?: number;
  },
): number {
  let score = Math.round(
    capability.score * 0.24 +
    capability.promptFitScore * 0.12 +
    sufficiency.score * 0.3 +
    opener.confidence * 100 * 0.16 +
    retrievalProfile.activityConfidence * 100 * 0.1 +
    retrievalProfile.genreConfidence * 100 * 0.08,
  );

  const promptConfidencePct = typeof opts?.promptConfidence === "number"
    ? Math.round(opts.promptConfidence * 100)
    : null;
  if (promptConfidencePct != null && promptConfidencePct < 42) {
    score = Math.min(score, 34);
  } else if (promptConfidencePct != null && promptConfidencePct < 52) {
    score = Math.min(score, 42);
  }

  const supply = opts?.validCandidateSupply;
  const requestedLength = opts?.requestedLength ?? 25;
  if (supply && supply.strictValidCount < Math.max(5, Math.ceil(requestedLength * 0.45))) {
    score = Math.min(score, 36);
  }
  if (supply && !supply.sufficient) {
    score = Math.min(score, 30);
  }

  return score;
}

function activityLabel(profile: ActivityProfile | null): string {
  if (!profile) return "playlist";
  const labels: Record<string, string> = {
    focus_coding: "Focus Coding",
    study: "Study",
    gym: "Gym",
    party_pregame: "Party Pregame",
  };
  return labels[profile.id] ?? profile.id;
}

function buildFailureMessage(
  capability: LibraryCapability,
  activityProfile: ActivityProfile | null,
): string {
  const label = activityLabel(activityProfile);
  return `Your liked songs don't contain enough high-confidence tracks for a convincing ${label} playlist. You can either try a different prompt or switch to Discovery Mode to search beyond your liked music.`;
}

function applyStrategyQuotas(
  profile: RetrievalProfile,
  plan: RetrievalStrategyPlan,
): RetrievalProfile {
  const quotas = { ...profile.sourceQuotas };
  if (plan.exploratoryQuotaBoost > 0) {
    const boost = plan.exploratoryQuotaBoost;
    quotas.exploratory = Math.min(0.42, quotas.exploratory + boost);
    quotas.forgotten_favourites = Math.min(0.32, quotas.forgotten_favourites + boost * 0.45);
    quotas.sonic_match = Math.min(0.22, quotas.sonic_match + boost * 0.25);
    const favouriteCut = Math.min(quotas.favourite_artists, boost * 0.55);
    quotas.favourite_artists = Math.max(0.02, quotas.favourite_artists - favouriteCut);
    if (profile.highConfidenceActivity) {
      quotas.activity_match = Math.min(0.58, quotas.activity_match + boost * 0.35);
    }
  }
  const normalised = normaliseQuotas(quotas);
  return {
    ...profile,
    libraryGravityWeight: plan.libraryGravityWeight,
    sourceQuotas: normalised,
  };
}

function normaliseQuotas(quotas: Record<RetrievalSourceId, number>): Record<RetrievalSourceId, number> {
  const total = Object.values(quotas).reduce((a, b) => a + b, 0) || 1;
  const out = { ...quotas };
  for (const key of Object.keys(out) as RetrievalSourceId[]) {
    out[key] = out[key]! / total;
  }
  return out;
}

function blendedPoolRescueThreshold(minRequired: number): number {
  return Math.max(8, Math.min(minRequired, Math.ceil(minRequired * 0.55)));
}

function tryBlendedIntentPoolRescue<T extends RetrievalTrackInput>(
  opts: OrchestratePlaylistRetrievalOpts<T>,
  sonicTasteProfile: SonicTasteProfile | null,
  minRequired: number,
): { tracks: T[]; diagnostics: BlendedPoolDiagnostics } | null {
  const profile = sonicTasteProfile ?? buildSonicTasteProfile(opts.tracks);
  const blended = buildBlendedIntentPool({
    tracks: opts.tracks,
    vibe: opts.vibe,
    intent: opts.intent as LockedIntent,
    emotionProfile: opts.emotionProfile,
    classMap: opts.classMap,
    requestedLength: opts.requestedLength,
    sonicTasteProfile: profile,
    mode: "balanced",
  });
  if (blended.diagnostics.outputCount < blendedPoolRescueThreshold(minRequired)) return null;
  return blended;
}

export function orchestratePlaylistRetrieval<T extends RetrievalTrackInput>(
  opts: OrchestratePlaylistRetrievalOpts<T>,
): OrchestratePlaylistRetrievalResult<T> {
  const retrievalProfile = buildPromptRetrievalProfile(
    opts.vibe,
    opts.intent,
    opts.emotionProfile,
    [],
  );
  const functionalPrompt =
    !!retrievalProfile.activityProfile &&
    FUNCTIONAL_ACTIVITIES.has(retrievalProfile.activityProfile.id);

  const sonicTasteProfile = opts.sonicTasteProfile ?? buildSonicTasteProfile(opts.tracks);
  const libraryCapability = analyzeLibraryCapability({ ...opts, sonicTasteProfile });
  const validCandidateSupply = estimateValidCandidateSupply({
    tracks: opts.tracks,
    vibe: opts.vibe,
    intent: opts.intent,
    emotionProfile: opts.emotionProfile,
    classMap: opts.classMap,
    requestedLength: opts.requestedLength,
  });
  const minRequired = minRequiredValidCandidates(opts.requestedLength);
  let sourceTracks = opts.tracks;
  let blendedIntentPoolDiagnostics: BlendedPoolDiagnostics | null = null;
  let blendedPoolApplied = false;

  const attemptBlendedRescue = (): boolean => {
    if (opts.noLibraryMode || blendedPoolApplied) return false;
    const rescue = tryBlendedIntentPoolRescue(opts, sonicTasteProfile, minRequired);
    if (!rescue) return false;
    sourceTracks = rescue.tracks;
    blendedIntentPoolDiagnostics = rescue.diagnostics;
    blendedPoolApplied = true;
    return true;
  };

  // Strict filters can yield 0 valid candidates while relaxed library supply exists.
  // Reshape retrieval input with blended lanes before any early-exit blocking.
  if (
    !opts.noLibraryMode &&
    opts.tracks.length > 0 &&
    isCompoundPromptIntent(opts.intent as LockedIntent) &&
    strictSupplyStarved(validCandidateSupply.strictValidCount, opts.requestedLength)
  ) {
    attemptBlendedRescue();
  }

  const emptyDiagnosticsBase = (
    strategyPlan: RetrievalStrategyPlan,
    retrievalAttempts: number,
  ): OrchestratorDiagnostics => ({
    libraryCapability,
    validCandidateSupply,
    strategy: strategyPlan.strategy,
    strategyPlan,
    retrievalAttempts,
    candidateSufficiency: {
      score: 0,
      genrePurity: 0,
      activitySuitability: 0,
      energySpread: 0,
      openerQuality: 0,
      diversity: 0,
      emotionalCoherence: 0,
    },
    combinedConfidence: libraryCapability.score,
    humanOpener: {
      trackId: null,
      confidence: 0,
      activityFit: 0,
      emotionalIdentity: 0,
      recognisability: 0,
      momentum: 0,
    },
    librarySufficient: false,
    integrityPolicy: "liked_library_only",
    adaptivePromptWeightShift: 0,
  });

  if (!opts.noLibraryMode && opts.tracks.length < MIN_LIBRARY_TRACKS) {
    const strategyPlan = selectRetrievalStrategy(libraryCapability, retrievalProfile, { functionalPrompt });
    return {
      tracks: [],
      diagnostics: emptyDiagnosticsBase(strategyPlan, 0),
      failure: {
        code: "LIBRARY_INSUFFICIENT_FOR_PROMPT",
        message: buildFailureMessage(libraryCapability, retrievalProfile.activityProfile),
        suggestDiscoveryMode: true,
        suggestRefinePrompt: true,
        libraryCapability,
        combinedConfidence: libraryCapability.score,
        limitingFactors: [
          ...libraryCapability.limitingFactors,
          ...validCandidateSupply.limitingDimensions,
        ],
      },
    };
  }

  const conflictBlocksRetrieval =
    libraryCapability.limitingFactors.includes("library_prompt_conflict") &&
    validCandidateSupply.relaxedValidCount < minRequired;

  if (!opts.noLibraryMode && conflictBlocksRetrieval && !attemptBlendedRescue()) {
    const strategyPlan = selectRetrievalStrategy(libraryCapability, retrievalProfile, { functionalPrompt });
    return {
      tracks: [],
      diagnostics: emptyDiagnosticsBase(strategyPlan, 0),
      failure: {
        code: "LIBRARY_INSUFFICIENT_FOR_PROMPT",
        message: buildFailureMessage(libraryCapability, retrievalProfile.activityProfile),
        suggestDiscoveryMode: true,
        suggestRefinePrompt: true,
        libraryCapability,
        combinedConfidence: libraryCapability.score,
        limitingFactors: [
          ...libraryCapability.limitingFactors,
          ...validCandidateSupply.limitingDimensions,
        ],
      },
    };
  }

  const preRetrievalMin = functionalPrompt ? 34 : 22;
  const capabilityBlocksRetrieval =
    libraryCapability.score < preRetrievalMin &&
    validCandidateSupply.relaxedValidCount < minRequired;

  if (!opts.noLibraryMode && capabilityBlocksRetrieval && !attemptBlendedRescue()) {
    const strategyPlan = selectRetrievalStrategy(libraryCapability, retrievalProfile, { functionalPrompt });
    return {
      tracks: [],
      diagnostics: emptyDiagnosticsBase(strategyPlan, 0),
      failure: {
        code: "LIBRARY_INSUFFICIENT_FOR_PROMPT",
        message: buildFailureMessage(libraryCapability, retrievalProfile.activityProfile),
        suggestDiscoveryMode: true,
        suggestRefinePrompt: true,
        libraryCapability,
        combinedConfidence: libraryCapability.score,
        limitingFactors: [
          ...libraryCapability.limitingFactors,
          ...validCandidateSupply.limitingDimensions,
        ],
      },
    };
  }

  let strategyPlan = selectRetrievalStrategy(libraryCapability, retrievalProfile, {
    noLibraryMode: opts.noLibraryMode,
    promptConfidence: opts.promptConfidence,
    functionalPrompt,
  });
  let retrievalAttempts = 0;
  let retrievalResult: { tracks: T[]; diagnostics: RetrievalDiagnostics | Record<string, unknown> } | null = null;
  let candidateSufficiency: CandidateSufficiency = {
    score: 0,
    genrePurity: 0,
    activitySuitability: 0,
    energySpread: 0,
    openerQuality: 0,
    diversity: 0,
    emotionalCoherence: 0,
  };

  const sufficiencyMin = functionalPrompt ? 42 : 30;
  const maxAttempts = validCandidateSupply.strictValidCount < minRequired ? 3 : 2;
  const activeWorldIds = inferWorldIdentityIdsFromPrompt(opts.vibe);
  const committedWorld = resolveCommittedWorld({ prompt: opts.vibe, lockedIntent: opts.intent });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    retrievalAttempts += 1;
    if (attempt > 0) {
      strategyPlan = selectRetrievalStrategy(libraryCapability, retrievalProfile, {
        functionalPrompt,
        retryAttempt: attempt,
      });
    }

    const profileOverride = applyStrategyQuotas(retrievalProfile, strategyPlan);
    retrievalResult = retrieveScoringCandidates({
      ...opts,
      tracks: sourceTracks,
      sonicTasteProfile,
      recentTrackPenalty: opts.recentTrackPenalty,
      activeWorldIds,
      expansionCandidates: opts.expansionCandidates,
      worldCoverage: opts.worldCoverage,
      retrievalOverrides: {
        strategyId: strategyPlan.strategy,
        libraryGravityWeight: profileOverride.libraryGravityWeight,
        exploratoryQuotaBoost: strategyPlan.exploratoryQuotaBoost,
        sourceQuotas: profileOverride.sourceQuotas,
      },
    });

    candidateSufficiency = evaluateCandidateSufficiency(retrievalResult.tracks, opts);
    if (candidateSufficiency.score >= sufficiencyMin) break;
    if (opts.noLibraryMode) break;
  }

  const tracks = retrievalResult?.tracks ?? opts.tracks;
  const humanOpener = electHumanOpener(tracks, { ...opts, sonicTasteProfile });
  const combinedConfidence = combinedGenerationConfidence(
    libraryCapability,
    candidateSufficiency,
    humanOpener,
    retrievalProfile,
    {
      promptConfidence: opts.promptConfidence,
      validCandidateSupply,
      requestedLength: opts.requestedLength,
    },
  );

  const postMin = functionalPrompt ? 40 : 28;
  const retrievalPoolSize = retrievalResult?.tracks.length ?? 0;
  const retrievalPoolSufficient = retrievalPoolSize >= Math.max(3, Math.ceil(minRequired * 0.3));
  let confidenceBlocksRetrieval =
    combinedConfidence < postMin &&
    validCandidateSupply.relaxedValidCount < minRequired;
  // Pre-retrieval supply heuristics can read 0 (e.g. era-locked disco + modern library)
  // while layered retrieval already assembled a valid pool — trust retrieval output.
  if (retrievalPoolSufficient) {
    confidenceBlocksRetrieval = false;
  }

  if (!opts.noLibraryMode && confidenceBlocksRetrieval) {
    if (attemptBlendedRescue()) {
      retrievalAttempts += 1;
      const profileOverride = applyStrategyQuotas(retrievalProfile, strategyPlan);
      retrievalResult = retrieveScoringCandidates({
        ...opts,
        tracks: sourceTracks,
        sonicTasteProfile,
        recentTrackPenalty: opts.recentTrackPenalty,
        activeWorldIds,
        expansionCandidates: opts.expansionCandidates,
        worldCoverage: opts.worldCoverage,
        retrievalOverrides: {
          strategyId: strategyPlan.strategy,
          libraryGravityWeight: profileOverride.libraryGravityWeight,
          exploratoryQuotaBoost: strategyPlan.exploratoryQuotaBoost,
          sourceQuotas: profileOverride.sourceQuotas,
        },
      });
      candidateSufficiency = evaluateCandidateSufficiency(retrievalResult.tracks, opts);
      const retryConfidence = combinedGenerationConfidence(
        libraryCapability,
        candidateSufficiency,
        electHumanOpener(retrievalResult.tracks, { ...opts, sonicTasteProfile }),
        retrievalProfile,
        {
          promptConfidence: opts.promptConfidence,
          validCandidateSupply,
          requestedLength: opts.requestedLength,
        },
      );
      if (retryConfidence >= postMin) {
        const retryTracks = retrievalResult.tracks;
        const retryOpener = electHumanOpener(retryTracks, { ...opts, sonicTasteProfile });
        return {
          tracks: retryTracks,
          diagnostics: {
            libraryCapability,
            validCandidateSupply,
            strategy: strategyPlan.strategy,
            strategyPlan,
            retrievalAttempts,
            candidateSufficiency,
            combinedConfidence: retryConfidence,
            humanOpener: retryOpener,
            librarySufficient: true,
            integrityPolicy: "liked_library_only",
            adaptivePromptWeightShift: strategyPlan.adaptivePromptWeightShift,
            retrievalDiagnostics: retrievalResult.diagnostics,
            blendedIntentPool: blendedIntentPoolDiagnostics,
          },
        };
      }
    }
    return {
      tracks: [],
      diagnostics: {
        libraryCapability,
        validCandidateSupply,
        strategy: strategyPlan.strategy,
        strategyPlan,
        retrievalAttempts,
        candidateSufficiency,
        combinedConfidence,
        humanOpener,
        librarySufficient: false,
        integrityPolicy: "liked_library_only",
        adaptivePromptWeightShift: strategyPlan.adaptivePromptWeightShift,
        retrievalDiagnostics: retrievalResult?.diagnostics,
        blendedIntentPool: blendedIntentPoolDiagnostics,
      },
      failure: {
        code: "LIBRARY_INSUFFICIENT_FOR_PROMPT",
        message: buildFailureMessage(libraryCapability, retrievalProfile.activityProfile),
        suggestDiscoveryMode: true,
        suggestRefinePrompt: true,
        libraryCapability,
        combinedConfidence,
        limitingFactors: [
          ...libraryCapability.limitingFactors,
          ...validCandidateSupply.limitingDimensions,
          ...(candidateSufficiency.score < sufficiencyMin ? ["weak_candidate_pool"] : []),
          ...(humanOpener.confidence < 0.45 ? ["weak_opener_confidence"] : []),
        ],
      },
    };
  }

  return {
    tracks,
    diagnostics: {
      libraryCapability,
      validCandidateSupply,
      blendedIntentPool: blendedIntentPoolDiagnostics,
      strategy: strategyPlan.strategy,
      strategyPlan,
      retrievalAttempts,
      candidateSufficiency,
      combinedConfidence,
      humanOpener,
      librarySufficient: true,
      integrityPolicy: opts.noLibraryMode ? "spotify_discovery" : "liked_library_only",
      adaptivePromptWeightShift: strategyPlan.adaptivePromptWeightShift,
      retrievalDiagnostics: retrievalResult?.diagnostics,
    },
  };
}
