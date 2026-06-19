/**
 * Dominant intent contract — shared invariant across parsing, retrieval, V3, recovery, and finalization.
 */
import type { LockedIntent } from "./v3/intent";

export type EmotionProfileLike = {
  energy?: number;
  valence?: number;
  tension?: number;
  nostalgia?: number;
  calm?: number;
};

export type IntentContractLike = {
  primarySubgenre: string | null;
  genreFamilies: string[];
  activity: string | null;
  places: Array<"rural" | "outdoors" | "city" | "beach" | "bedroom" | "car">;
  eraRange: { start: number; end: number } | null;
  explicitDimensions: string[];
};

export type DominantEmotion =
  | "melancholy" | "nostalgia" | "tension" | "aggression" | "anticipation"
  | "loneliness" | "peace" | "euphoria" | "longing" | "wonder" | null;

export type SceneContracts = {
  visual: string[];
  place: string[];
  time: string[];
  atmosphere: string[];
};

export type SubgenreLadderMode = "primary_subgenre" | "related_subgenre" | "family" | "none";

export type RetrievalFallbackLevel = "none" | "family" | "adjacent" | "global";
export type FinalizationFallbackLevel = "none" | "soft" | "hardSafe";

export type DominantIntentContract = {
  rawPrompt: string;
  dominantEmotion: DominantEmotion;
  dominantEmotionExplicit: boolean;
  primarySubgenre: string | null;
  genreFamilies: string[];
  activity: string | null;
  activityPriority: number;
  scene: SceneContracts;
  eraRange: { start: number; end: number } | null;
  explicitDimensions: string[];
  mode: "strict" | "balanced" | "chaotic";
  noLibraryMode: boolean;
  subgenreLadderMode: SubgenreLadderMode;
  allowGlobalFallback: boolean;
  allowAdjacentFallback: boolean;
  allowContrastLanes: boolean;
  allowExplorationLanes: boolean;
  maxTastePullWeight: number;
  retrievalSignature: string;
  intentSignature: string;
};

const EMOTION_PATTERNS: Array<{ emotion: DominantEmotion; pattern: RegExp }> = [
  { emotion: "melancholy", pattern: /\b(melanchol|sad|blue|rainy|grief|heartbreak)\b/i },
  { emotion: "nostalgia", pattern: /\b(nostalg|memory|memories|throwback|retro|vintage)\b/i },
  { emotion: "tension", pattern: /\b(tension|anxious|stress|uneasy|dread|suspense)\b/i },
  { emotion: "aggression", pattern: /\b(aggress|rage|angry|fury|brutal|hard)\b/i },
  { emotion: "anticipation", pattern: /\b(anticipat|buildup|before|waiting|expect)\b/i },
  { emotion: "loneliness", pattern: /\b(lonely|alone|isolation|solitude|empty)\b/i },
  { emotion: "peace", pattern: /\b(peace|calm|serene|still|quiet|zen)\b/i },
  { emotion: "euphoria", pattern: /\b(euphor|ecstatic|bliss|peak|euphoric)\b/i },
  { emotion: "longing", pattern: /\b(longing|yearn|miss you|ache|wistful)\b/i },
  { emotion: "wonder", pattern: /\b(wonder|awe|magical|cosmic|ethereal)\b/i },
];

const VISUAL_PATTERNS = /\b(cinematic|neon|fog|mist|golden hour|sunset|rain|snow|warehouse|bunker|petrol station|empty road)\b/gi;
const PLACE_PATTERNS = /\b(bedroom|kitchen|car|highway|road|beach|city|forest|club|warehouse|station|parking)\b/gi;
const TIME_PATTERNS = /\b(morning|afternoon|evening|night|midnight|2\s?am|3\s?am|late.?night|dawn|sunrise)\b/gi;
const ATMOSPHERE_PATTERNS = /\b(dark|warm|cold|hazy|dreamy|underground|intimate|vast|liminal)\b/gi;

const ACTIVITY_PRIORITY: Record<string, number> = {
  driving: 90,
  gym: 85,
  party: 80,
  focus: 75,
  walking: 70,
  relaxing: 65,
  cleaning: 60,
  sleep: 55,
  travel: 50,
  listening: 10,
};

function uniqueMatches(text: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const value = match[0]?.trim().toLowerCase();
    if (value) found.add(value);
  }
  return [...found];
}

export function detectDominantEmotion(prompt: string, profile?: EmotionProfileLike): {
  emotion: DominantEmotion;
  explicit: boolean;
} {
  const lower = prompt.toLowerCase();
  for (const { emotion, pattern } of EMOTION_PATTERNS) {
    if (pattern.test(lower)) return { emotion, explicit: true };
  }
  if (profile) {
    const scores: Array<{ emotion: DominantEmotion; score: number }> = [
      { emotion: "melancholy", score: (1 - (profile.valence ?? 0.5)) * (profile.tension ?? 0.3) },
      { emotion: "nostalgia", score: profile.nostalgia ?? 0.2 },
      { emotion: "peace", score: profile.calm ?? 0.5 },
      { emotion: "euphoria", score: (profile.valence ?? 0.5) * (profile.energy ?? 0.5) },
      { emotion: "tension", score: profile.tension ?? 0.3 },
    ];
    const top = scores.sort((a, b) => b.score - a.score)[0];
    if (top && top.score >= 0.45) return { emotion: top.emotion, explicit: false };
  }
  return { emotion: null, explicit: false };
}

export function splitSceneContracts(prompt: string, places: string[] = []): SceneContracts {
  return {
    visual: uniqueMatches(prompt, VISUAL_PATTERNS),
    place: [...new Set([...places, ...uniqueMatches(prompt, PLACE_PATTERNS)])],
    time: uniqueMatches(prompt, TIME_PATTERNS),
    atmosphere: uniqueMatches(prompt, ATMOSPHERE_PATTERNS),
  };
}

export function resolveActivityPriority(activity: string | null, prompt: string): string | null {
  const lower = prompt.toLowerCase();
  const candidates: string[] = [];
  if (activity) candidates.push(activity);
  for (const key of Object.keys(ACTIVITY_PRIORITY)) {
    if (key === "listening") continue;
    const re = new RegExp(`\\b${key}\\b`, "i");
    if (re.test(lower)) candidates.push(key);
  }
  if (candidates.length === 0) return activity;
  return candidates.sort((a, b) => (ACTIVITY_PRIORITY[b] ?? 0) - (ACTIVITY_PRIORITY[a] ?? 0))[0] ?? activity;
}

function signatureParts(parts: Array<string | number | null | undefined>): string {
  return parts.filter((p) => p != null && `${p}`.length > 0).join("|");
}

export function buildRetrievalSignature(opts: {
  genreFamilies: string[];
  primarySubgenre: string | null;
  subgenreMode: SubgenreLadderMode;
  fallbackLevel: RetrievalFallbackLevel;
  poolSize: number;
}): string {
  return signatureParts([
    "r",
    opts.genreFamilies.sort().join(","),
    opts.primarySubgenre,
    opts.subgenreMode,
    opts.fallbackLevel,
    opts.poolSize,
  ]);
}

export function buildIntentSignature(contract: Pick<DominantIntentContract, "genreFamilies" | "primarySubgenre" | "dominantEmotion" | "activity" | "eraRange">): string {
  return signatureParts([
    "i",
    contract.genreFamilies.sort().join(","),
    contract.primarySubgenre,
    contract.dominantEmotion,
    contract.activity,
    contract.eraRange ? `${contract.eraRange.start}-${contract.eraRange.end}` : null,
  ]);
}

export function buildDominantIntentContract(opts: {
  prompt: string;
  intentContract: IntentContractLike;
  lockedIntent?: LockedIntent;
  emotionProfile?: EmotionProfileLike;
  mode?: "strict" | "balanced" | "chaotic";
  noLibraryMode?: boolean;
  subgenreLadderMode?: SubgenreLadderMode;
  retrievalFallbackLevel?: RetrievalFallbackLevel;
  poolSize?: number;
}): DominantIntentContract {
  const { emotion, explicit } = detectDominantEmotion(opts.prompt, opts.emotionProfile);
  const activity = resolveActivityPriority(opts.intentContract.activity, opts.prompt);
  const mode = opts.mode ?? "balanced";
  const noLibraryMode = !!opts.noLibraryMode;
  const subgenreLadderMode = opts.subgenreLadderMode ?? "none";
  const strict = mode === "strict";

  const base: DominantIntentContract = {
    rawPrompt: opts.prompt,
    dominantEmotion: emotion,
    dominantEmotionExplicit: explicit,
    primarySubgenre: opts.intentContract.primarySubgenre,
    genreFamilies: opts.intentContract.genreFamilies,
    activity,
    activityPriority: ACTIVITY_PRIORITY[activity ?? "listening"] ?? 10,
    scene: splitSceneContracts(opts.prompt, opts.intentContract.places),
    eraRange: opts.intentContract.eraRange,
    explicitDimensions: opts.intentContract.explicitDimensions,
    mode,
    noLibraryMode,
    subgenreLadderMode,
    allowGlobalFallback: !strict && !explicit,
    allowAdjacentFallback: subgenreLadderMode === "family",
    allowContrastLanes: !explicit || mode === "chaotic",
    allowExplorationLanes: !explicit && mode !== "strict",
    maxTastePullWeight: explicit || opts.intentContract.places.length > 0 ? 0.12 : 0.22,
    retrievalSignature: "",
    intentSignature: "",
  };

  base.intentSignature = buildIntentSignature(base);
  base.retrievalSignature = buildRetrievalSignature({
    genreFamilies: base.genreFamilies,
    primarySubgenre: base.primarySubgenre,
    subgenreMode: subgenreLadderMode,
    fallbackLevel: opts.retrievalFallbackLevel ?? "none",
    poolSize: opts.poolSize ?? 0,
  });

  return base;
}

export function adaptiveRetrievalThresholds(librarySize: number, playlistLength: number): {
  strictMinimum: number;
  relatedMinimum: number;
} {
  const scale = librarySize <= 500 ? 0.7 : librarySize <= 2000 ? 0.85 : librarySize <= 5000 ? 1.0 : 1.15;
  return {
    strictMinimum: Math.max(8, Math.ceil((playlistLength + 5) * scale)),
    relatedMinimum: Math.max(6, Math.ceil(playlistLength * 0.5 * scale)),
  };
}

export type PoolHealthResult = {
  healthy: boolean;
  score: number;
  reason: string | null;
  minRequired: number;
  actual: number;
};

export function assessCandidatePoolHealth(poolSize: number, playlistLength: number, mode: SubgenreLadderMode): PoolHealthResult {
  const minRequired = mode === "primary_subgenre"
    ? Math.max(12, Math.ceil(playlistLength * 0.8))
    : mode === "related_subgenre"
      ? Math.max(8, Math.ceil(playlistLength * 0.5))
      : Math.max(6, Math.ceil(playlistLength * 0.35));
  const score = minRequired > 0 ? Math.min(100, Math.round((poolSize / minRequired) * 100)) : 100;
  return {
    healthy: poolSize >= minRequired,
    score,
    reason: poolSize < minRequired ? `candidate_pool_below_minimum:${poolSize}<${minRequired}` : null,
    minRequired,
    actual: poolSize,
  };
}

export type RecoveryPreCheck = {
  allowed: boolean;
  reason: string | null;
  preserveEmotion: boolean;
  preserveSubgenre: boolean;
  controlledFailureRecommended: boolean;
};

export function recoveryIntentPreCheck(
  contract: DominantIntentContract,
  opts: {
    currentEmotionSurvival?: number;
    currentSubgenreSurvival?: number;
    fallbackLevel: RetrievalFallbackLevel | FinalizationFallbackLevel;
    underfillRatio: number;
  },
): RecoveryPreCheck {
  const emotionAtRisk = contract.dominantEmotionExplicit &&
    typeof opts.currentEmotionSurvival === "number" &&
    opts.currentEmotionSurvival < 55;
  const subgenreAtRisk = !!contract.primarySubgenre &&
    typeof opts.currentSubgenreSurvival === "number" &&
    opts.currentSubgenreSurvival < 50;
  const globalWithoutDowngrade = opts.fallbackLevel === "global" && contract.mode === "strict";
  const hardSafeInStrict = opts.fallbackLevel === "hardSafe" && contract.mode === "strict";

  if (hardSafeInStrict && !!contract.primarySubgenre) {
    return {
      allowed: false,
      reason: "hard_safe_blocked_in_strict_mode",
      preserveEmotion: true,
      preserveSubgenre: true,
      controlledFailureRecommended: true,
    };
  }

  if (globalWithoutDowngrade) {
    return {
      allowed: false,
      reason: "global_fallback_blocked_in_strict_mode",
      preserveEmotion: true,
      preserveSubgenre: true,
      controlledFailureRecommended: true,
    };
  }

  if (subgenreAtRisk && opts.underfillRatio < 0.5) {
    return {
      allowed: false,
      reason: "recovery_would_erase_subgenre",
      preserveEmotion: contract.dominantEmotionExplicit,
      preserveSubgenre: true,
      controlledFailureRecommended: true,
    };
  }

  return {
    allowed: !emotionAtRisk || opts.underfillRatio >= 0.6,
    reason: emotionAtRisk ? "dominant_emotion_at_risk" : null,
    preserveEmotion: contract.dominantEmotionExplicit,
    preserveSubgenre: !!contract.primarySubgenre,
    controlledFailureRecommended: emotionAtRisk && opts.underfillRatio < 0.6,
  };
}

export type MatchQualityLabel = "strong" | "good" | "best_available";

export function deriveMatchQuality(opts: {
  intentSurvivalOverall?: number;
  genreRelaxed?: boolean;
  eraRelaxed?: boolean;
  recoveryUsed?: boolean;
  fallbackLevel?: RetrievalFallbackLevel | FinalizationFallbackLevel;
}): MatchQualityLabel {
  if (opts.recoveryUsed || opts.genreRelaxed || opts.eraRelaxed || opts.fallbackLevel === "global" || opts.fallbackLevel === "hardSafe") {
    return "best_available";
  }
  const score = opts.intentSurvivalOverall ?? 0;
  if (score >= 78) return "strong";
  if (score >= 58) return "good";
  return "best_available";
}

export function intentSurvivalPlainLanguage(survival: {
  scores?: { overallIntentSurvival?: number; emotionSurvival?: number; subgenreSurvival?: number };
  emotionSurvival?: { dominantEmotion?: string; survivalPercent?: number };
} | null | undefined): string {
  if (!survival) return "Playlist built to match your prompt.";
  const overall = survival.scores?.overallIntentSurvival;
  const emotion = survival.emotionSurvival?.survivalPercent ?? survival.scores?.emotionSurvival;
  if (typeof overall === "number" && overall >= 80) {
    return "Strong match to your prompt across mood, genre, and scene.";
  }
  if (typeof emotion === "number" && emotion < 50) {
    return "Best available match — the feeling shifted slightly while filling the playlist.";
  }
  if (typeof overall === "number" && overall >= 60) {
    return "Good prompt match with your library's strongest options.";
  }
  return "Best available match from your library after quality checks.";
}

export function electronicSubgenreGuard(families: string[], subgenre: string | null): boolean {
  if (!families.includes("electronic") && !subgenre) return false;
  const electronicSubs = ["dnb", "dnb_rollers", "hard_techno", "industrial_techno", "techno", "trance", "house", "schranz", "rave"];
  return families.includes("electronic") || (!!subgenre && electronicSubs.some((s) => subgenre.includes(s)));
}

export function capArtistAlbumRelaxation(mode: "strict" | "balanced" | "chaotic"): {
  allowArtistRelax: boolean;
  allowAlbumRelax: boolean;
} {
  return {
    allowArtistRelax: mode !== "strict",
    allowAlbumRelax: mode === "chaotic",
  };
}

export function narrowSceneDiversityPressure(scene: SceneContracts): number {
  const specificity = scene.visual.length + scene.place.length + scene.atmosphere.length;
  if (specificity >= 4) return 0.35;
  if (specificity >= 2) return 0.55;
  return 1.0;
}

export function minimumGenreEvidenceInTail(
  tracks: Array<{ genreFamily?: string | null; genrePrimary?: string | null }>,
  expectedFamilies: string[],
  tailFraction = 0.25,
): { satisfied: boolean; tailEvidenceRatio: number } {
  if (expectedFamilies.length === 0) return { satisfied: true, tailEvidenceRatio: 1 };
  const tailStart = Math.max(0, Math.floor(tracks.length * (1 - tailFraction)));
  const tail = tracks.slice(tailStart);
  if (tail.length === 0) return { satisfied: true, tailEvidenceRatio: 1 };
  const evidenced = tail.filter((t) => {
    const family = t.genreFamily ?? t.genrePrimary;
    return !!family && expectedFamilies.includes(family);
  }).length;
  const ratio = evidenced / tail.length;
  return { satisfied: ratio >= 0.6, tailEvidenceRatio: ratio };
}
