import {
  buildDominantIntentContract,
  deriveMatchQuality,
  intentSurvivalPlainLanguage,
  type DominantIntentContract,
  type MatchQualityLabel,
} from "../core/dominant-intent-contract";
import type { IntentDecodeResult } from "../lib/intent-decoder";

export type GenerationTrustPayload = {
  dominantIntentContract: DominantIntentContract;
  matchQuality: MatchQualityLabel;
  matchQualityLabel: string;
  personalizationSource: "library" | "spotify_discovery";
  recoveryAssisted: boolean;
  retrievalSignature: string;
  intentSignature: string;
  intentSurvivalSummary: string;
  playlistWhy: string;
  sceneContracts: DominantIntentContract["scene"];
  retrievalFallbackLevel: string | null;
  finalizationFallbackLevel: string | null;
  eraRelaxed: boolean;
  genreRelaxed: boolean;
  controlledRecoveryBlocked: boolean;
  controlledRecoveryReason: string | null;
};

const MATCH_LABELS: Record<MatchQualityLabel, string> = {
  strong: "Strong Prompt Match",
  good: "Good Prompt Match",
  best_available: "Best Available Match",
};

export function buildGenerationTrustPayload(opts: {
  vibe: string;
  mode: "strict" | "balanced" | "chaotic";
  noLibraryMode: boolean;
  intentContract: {
    primarySubgenre: string | null;
    genreFamilies: string[];
    activity: string | null;
    places: Array<"rural" | "outdoors" | "city" | "beach" | "bedroom" | "car">;
    eraRange: { start: number; end: number } | null;
    explicitDimensions: string[];
  };
  emotionProfile?: { energy?: number; valence?: number; tension?: number; nostalgia?: number; calm?: number };
  intentSurvival?: {
    scores?: { overallIntentSurvival?: number; emotionSurvival?: number; subgenreSurvival?: number };
    emotionSurvival?: { survivalPercent?: number };
    convergence?: { convergenceRisk?: string };
  } | null;
  generationDiagnostics?: Record<string, unknown>;
  strictGenreEvidence?: { relaxed?: boolean };
  strictEraEvidence?: { relaxed?: boolean };
  intentDecode?: IntentDecodeResult;
  subgenreLadderMode?: DominantIntentContract["subgenreLadderMode"];
  retrievalFallbackLevel?: "none" | "family" | "adjacent" | "global";
  poolSize?: number;
}): GenerationTrustPayload {
  const guard = opts.generationDiagnostics?.["intentContractGuard"] as Record<string, unknown> | undefined;
  const retrievalLevel = (guard?.["fallbackLevelUsed"] as string | undefined) ?? opts.retrievalFallbackLevel ?? "none";
  const finalizationLevel = (opts.generationDiagnostics?.["finalizationFallbackLevel"] as string | undefined)
    ?? (opts.generationDiagnostics?.["fallbackLevel"] as string | undefined)
    ?? "none";

  const dominantIntentContract = buildDominantIntentContract({
    prompt: opts.vibe,
    intentContract: opts.intentContract,
    emotionProfile: opts.emotionProfile,
    mode: opts.mode,
    noLibraryMode: opts.noLibraryMode,
    subgenreLadderMode: opts.subgenreLadderMode ?? (guard?.["subgenreFallbackMode"] as DominantIntentContract["subgenreLadderMode"]) ?? "none",
    retrievalFallbackLevel: retrievalLevel as "none" | "family" | "adjacent" | "global",
    poolSize: opts.poolSize ?? Number(guard?.["finalPoolSizeAtScoringEntry"] ?? 0),
  });

  const recoveryAssisted = !!(
    opts.generationDiagnostics?.["recoveryTriggered"] ||
    opts.generationDiagnostics?.["cohesionRelaxedFillUsed"] ||
    opts.generationDiagnostics?.["hardSafeFillUsed"] ||
    opts.generationDiagnostics?.["controlledRecoveryBlocked"]
  );

  const controlledRecoveryBlocked = opts.generationDiagnostics?.["controlledRecoveryBlocked"] === true;
  const controlledRecoveryReason = typeof opts.generationDiagnostics?.["controlledRecoveryReason"] === "string"
    ? opts.generationDiagnostics["controlledRecoveryReason"] as string
    : null;

  const genreRelaxed = opts.strictGenreEvidence?.relaxed === true;
  const eraRelaxed = opts.strictEraEvidence?.relaxed === true;

  const matchQuality = deriveMatchQuality({
    intentSurvivalOverall: opts.intentSurvival?.scores?.overallIntentSurvival,
    genreRelaxed,
    eraRelaxed,
    recoveryUsed: recoveryAssisted,
    fallbackLevel: retrievalLevel === "global" ? "global" : finalizationLevel === "hardSafe" ? "hardSafe" : "none",
  });

  const playlistWhy = opts.intentDecode
    ? `Built for ${opts.intentDecode.intent} — ${intentSurvivalPlainLanguage(opts.intentSurvival)}`
    : intentSurvivalPlainLanguage(opts.intentSurvival);

  return {
    dominantIntentContract,
    matchQuality,
    matchQualityLabel: MATCH_LABELS[matchQuality],
    personalizationSource: opts.noLibraryMode ? "spotify_discovery" : "library",
    recoveryAssisted,
    retrievalSignature: dominantIntentContract.retrievalSignature,
    intentSignature: dominantIntentContract.intentSignature,
    intentSurvivalSummary: intentSurvivalPlainLanguage(opts.intentSurvival),
    playlistWhy,
    sceneContracts: dominantIntentContract.scene,
    retrievalFallbackLevel: retrievalLevel,
    finalizationFallbackLevel: finalizationLevel,
    eraRelaxed,
    genreRelaxed,
    controlledRecoveryBlocked,
    controlledRecoveryReason,
  };
}
