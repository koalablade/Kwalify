import type { TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { MomentMemory } from "../memory/moment-memory";
import type { UnifiedIntent } from "../unified-intent";
import type { ScorerTrack } from "../v3/lane-scorer";
import { withDecisionFinalScore, type TrackDecision } from "../v3/track-decision";

export interface SignalBundle {
  trackId: string;
  embeddingAffinity: number;
  sceneAffinity: number;
  tasteAffinity: number;
  memoryAffinity: number;
  freshnessScore: number;
  repetitionPressure: number;
  genreAlignment: number;
}

export interface NormalizedSignalBundle extends SignalBundle {
  normalizedEmbedding: number;
  normalizedScene: number;
  normalizedTaste: number;
  normalizedMemory: number;
  normalizedFreshness: number;
  normalizedRepetition: number;
  normalizedGenre: number;
}

export interface DecisionScore {
  trackId: string;
  finalScore: number;
  normalizedSignals: NormalizedSignalBundle;
}

export interface RecommendationEngineResult<T extends ScorerTrack> {
  decisions: Array<TrackDecision<T>>;
  scores: DecisionScore[];
  diagnostics: {
    signalCount: number;
    weights: Record<string, number>;
    topDecisions: DecisionScore[];
  };
}

const BASE_DECISION_WEIGHTS = {
  embeddingAffinity: 0.40,
  sceneAffinity: 0.25,
  tasteAffinity: 0.20,
  memoryAffinity: 0.10,
  freshnessPenalty: 0.05,
} as const;

type DecisionWeightKey = keyof typeof BASE_DECISION_WEIGHTS;

/** Scale taste/memory pull down when explicit intent should dominate retrieval. */
export function buildDecisionWeights(maxTastePullWeight = 0.22): Record<DecisionWeightKey, number> {
  const scale = Math.max(0.35, Math.min(1, maxTastePullWeight / 0.22));
  const tasteAffinity = BASE_DECISION_WEIGHTS.tasteAffinity * scale;
  const memoryAffinity = BASE_DECISION_WEIGHTS.memoryAffinity * scale;
  const redistributed = (BASE_DECISION_WEIGHTS.tasteAffinity + BASE_DECISION_WEIGHTS.memoryAffinity) - (tasteAffinity + memoryAffinity);
  return {
    embeddingAffinity: BASE_DECISION_WEIGHTS.embeddingAffinity + redistributed * 0.55,
    sceneAffinity: BASE_DECISION_WEIGHTS.sceneAffinity + redistributed * 0.45,
    tasteAffinity,
    memoryAffinity,
    freshnessPenalty: BASE_DECISION_WEIGHTS.freshnessPenalty,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function vectorEnergy(vector: number[] | undefined): number {
  if (!vector || vector.length === 0) return 0;
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return clamp01(magnitude / Math.sqrt(vector.length));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0.5;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeDomain(value: number, values: number[]): number {
  if (values.length <= 1) return clamp01(value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(max - min) < 0.0001) return clamp01(value);
  return clamp01((value - min) / (max - min));
}

export function normalizeEmbeddingScore(value: number, values: number[]): number {
  return normalizeDomain(value, values);
}

export function normalizeSceneScore(value: number, values: number[]): number {
  return normalizeDomain(value, values);
}

export function normalizeTasteScore(value: number, values: number[]): number {
  return normalizeDomain(value, values);
}

export function normalizeMemoryScore(value: number, values: number[]): number {
  return normalizeDomain(value, values);
}

function normalizeFreshnessScore(value: number, values: number[]): number {
  return normalizeDomain(value, values);
}

function normalizeRepetitionPressure(value: number, values: number[]): number {
  return normalizeDomain(value, values);
}

function normalizeGenreAlignment(value: number, values: number[]): number {
  return normalizeDomain(value, values);
}

function memoryResonance(unifiedIntent: UnifiedIntent, memory: MomentMemory | null | undefined): number {
  if (!memory || memory.recentStates.length === 0) {
    return clamp01(0.5 + unifiedIntent.latentContext.memoryActivation * 0.25);
  }
  const memoryStrength = memory.aggregatedState.decayWeight;
  const sceneLift = vectorEnergy(memory.aggregatedState.sceneVector) * 0.35;
  const emotionLift = vectorEnergy(memory.aggregatedState.emotionVector) * 0.25;
  const activationLift = unifiedIntent.latentContext.memoryActivation * 0.40;
  return clamp01(0.35 + memoryStrength * (sceneLift + emotionLift + activationLift));
}

function repetitionPressure(
  decision: TrackDecision<ScorerTrack>,
  classification: TrackGenreClassification | undefined,
  memory: MomentMemory | null | undefined,
): number {
  if (!memory || memory.recentStates.length === 0) return 0;
  const genreEnergy = vectorEnergy(memory.aggregatedState.genreVector);
  const sceneEnergy = vectorEnergy(memory.aggregatedState.sceneVector);
  const familySpecificity = classification?.genreFamily || classification?.genrePrimary || decision.genrePrimary
    ? 0.15
    : 0;
  return clamp01(memory.aggregatedState.decayWeight * (genreEnergy * 0.45 + sceneEnergy * 0.40 + familySpecificity));
}

function genreAlignment(
  decision: TrackDecision<ScorerTrack>,
  classification: TrackGenreClassification | undefined,
  unifiedIntent: UnifiedIntent,
): number {
  const explicitGenreSignal = vectorEnergy(unifiedIntent.genreVector);
  if (!classification?.genreFamily && !classification?.genrePrimary && !decision.genrePrimary) {
    return clamp01(0.5 - explicitGenreSignal * 0.15);
  }
  return clamp01(0.55 + explicitGenreSignal * 0.35);
}

export function collectSignals<T extends ScorerTrack>(input: {
  decision: TrackDecision<T>;
  unifiedIntent: UnifiedIntent;
  memory?: MomentMemory | null;
  classification?: TrackGenreClassification;
}): SignalBundle {
  return {
    trackId: input.decision.track.trackId,
    embeddingAffinity: clamp01(input.decision.embeddingAffinity),
    sceneAffinity: clamp01(input.decision.sceneAffinity),
    tasteAffinity: clamp01(input.decision.tasteAffinity),
    memoryAffinity: memoryResonance(input.unifiedIntent, input.memory),
    freshnessScore: clamp01(input.decision.freshnessAffinity),
    repetitionPressure: repetitionPressure(input.decision, input.classification, input.memory),
    genreAlignment: genreAlignment(input.decision, input.classification, input.unifiedIntent),
  };
}

export function computeFinalDecision(
  signal: NormalizedSignalBundle,
  weights: Record<DecisionWeightKey, number> = BASE_DECISION_WEIGHTS,
): DecisionScore {
  const memorySignal = clamp01(signal.normalizedMemory * 0.85 + signal.normalizedGenre * 0.15);
  const freshnessSignal = clamp01(signal.normalizedFreshness * 0.65 + (1 - signal.normalizedRepetition) * 0.35);
  const finalScore = clamp01(
    signal.normalizedEmbedding * weights.embeddingAffinity +
    signal.normalizedScene * weights.sceneAffinity +
    signal.normalizedTaste * weights.tasteAffinity +
    memorySignal * weights.memoryAffinity +
    freshnessSignal * weights.freshnessPenalty,
  );

  return {
    trackId: signal.trackId,
    finalScore,
    normalizedSignals: signal,
  };
}

function normalizeSignals(signals: SignalBundle[]): NormalizedSignalBundle[] {
  const embeddingValues = signals.map((signal) => signal.embeddingAffinity);
  const sceneValues = signals.map((signal) => signal.sceneAffinity);
  const tasteValues = signals.map((signal) => signal.tasteAffinity);
  const memoryValues = signals.map((signal) => signal.memoryAffinity);
  const freshnessValues = signals.map((signal) => signal.freshnessScore);
  const repetitionValues = signals.map((signal) => signal.repetitionPressure);
  const genreValues = signals.map((signal) => signal.genreAlignment);

  return signals.map((signal) => ({
    ...signal,
    normalizedEmbedding: normalizeEmbeddingScore(signal.embeddingAffinity, embeddingValues),
    normalizedScene: normalizeSceneScore(signal.sceneAffinity, sceneValues),
    normalizedTaste: normalizeTasteScore(signal.tasteAffinity, tasteValues),
    normalizedMemory: normalizeMemoryScore(signal.memoryAffinity, memoryValues),
    normalizedFreshness: normalizeFreshnessScore(signal.freshnessScore, freshnessValues),
    normalizedRepetition: normalizeRepetitionPressure(signal.repetitionPressure, repetitionValues),
    normalizedGenre: normalizeGenreAlignment(signal.genreAlignment, genreValues),
  }));
}

export function runRecommendationEngine<T extends ScorerTrack>(input: {
  decisions: Array<TrackDecision<T>>;
  unifiedIntent: UnifiedIntent;
  memory?: MomentMemory | null;
  classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  maxTastePullWeight?: number;
}): RecommendationEngineResult<T> {
  const weights = buildDecisionWeights(input.maxTastePullWeight ?? 0.22);
  const signals = input.decisions.map((decision) => collectSignals({
    decision,
    unifiedIntent: input.unifiedIntent,
    memory: input.memory,
    classification: input.classificationByTrack?.(decision.track.trackId),
  }));
  const normalized = normalizeSignals(signals);
  const scores = normalized.map((signal) => computeFinalDecision(signal, weights));
  const scoreByTrack = new Map(scores.map((score) => [score.trackId, score]));
  const decisions = input.decisions.map((decision) =>
    withDecisionFinalScore(decision, scoreByTrack.get(decision.track.trackId)?.finalScore ?? decision.finalScore)
  );

  return {
    decisions,
    scores,
    diagnostics: {
      signalCount: signals.length,
      weights,
      topDecisions: [...scores]
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, 10)
        .map((score) => ({
          ...score,
          finalScore: Math.round(score.finalScore * 1000) / 1000,
          normalizedSignals: {
            ...score.normalizedSignals,
            embeddingAffinity: Math.round(score.normalizedSignals.embeddingAffinity * 1000) / 1000,
            sceneAffinity: Math.round(score.normalizedSignals.sceneAffinity * 1000) / 1000,
            tasteAffinity: Math.round(score.normalizedSignals.tasteAffinity * 1000) / 1000,
            memoryAffinity: Math.round(score.normalizedSignals.memoryAffinity * 1000) / 1000,
          },
        })),
    },
  };
}
