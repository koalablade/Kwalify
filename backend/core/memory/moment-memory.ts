import type { UnifiedIntent } from "../unified-intent";

export interface MomentState {
  emotionVector: number[];
  sceneVector: number[];
  energyVector: number[];
  genreVector: number[];
  timestamp: number;
  decayWeight: number;
}

export interface MomentMemory {
  recentStates: MomentState[];
  aggregatedState: MomentState;
}

const MAX_MEMORY_STATES = 20;
const HALF_LIFE_MS = 1000 * 60 * 60 * 12;
const DEFAULT_MEMORY_KEY = "default";

const memoryByKey = new Map<string, MomentMemory>();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector.map(() => 0);
  return vector.map((value) => value / magnitude);
}

function resizeVector(vector: number[], width: number): number[] {
  if (width <= 0) return [];
  if (vector.length === width) return vector.slice();
  if (vector.length === 0) return new Array(width).fill(0);
  return new Array(width).fill(0).map((_, index) => vector[index % vector.length] ?? 0);
}

function blendVectors(parts: Array<{ vector: number[]; weight: number }>, width: number): number[] {
  const out = new Array(width).fill(0);
  let totalWeight = 0;
  for (const part of parts) {
    const vector = resizeVector(part.vector, width);
    totalWeight += part.weight;
    for (let i = 0; i < width; i++) {
      out[i] += (vector[i] ?? 0) * part.weight;
    }
  }
  if (totalWeight > 0) {
    for (let i = 0; i < width; i++) out[i] /= totalWeight;
  }
  return normalizeVector(out);
}

function decayWeight(timestamp: number, now: number): number {
  const age = Math.max(0, now - timestamp);
  return Math.pow(0.5, age / HALF_LIFE_MS);
}

function stateFromIntent(
  unifiedIntent: UnifiedIntent,
  finalPlaylistEmbedding: number[] = [],
  now = Date.now(),
): MomentState {
  return {
    emotionVector: blendVectors([
      { vector: unifiedIntent.emotionVector, weight: 0.70 },
      { vector: finalPlaylistEmbedding, weight: 0.30 },
    ], unifiedIntent.emotionVector.length),
    sceneVector: blendVectors([
      { vector: unifiedIntent.sceneVector, weight: 0.70 },
      { vector: finalPlaylistEmbedding, weight: 0.30 },
    ], unifiedIntent.sceneVector.length),
    energyVector: blendVectors([
      { vector: unifiedIntent.energyVector, weight: 0.70 },
      { vector: finalPlaylistEmbedding, weight: 0.30 },
    ], unifiedIntent.energyVector.length),
    genreVector: blendVectors([
      { vector: unifiedIntent.genreVector, weight: 0.70 },
      { vector: finalPlaylistEmbedding, weight: 0.30 },
    ], unifiedIntent.genreVector.length),
    timestamp: now,
    decayWeight: 1,
  };
}

function emptyState(now = Date.now()): MomentState {
  return {
    emotionVector: [],
    sceneVector: [],
    energyVector: [],
    genreVector: [],
    timestamp: now,
    decayWeight: 0,
  };
}

function aggregateStates(states: MomentState[], now = Date.now()): MomentState {
  if (states.length === 0) return emptyState(now);
  const weightedStates = states.map((state, index) => {
    const recencyBoost = index >= states.length - 5 ? 1.25 : 0.85;
    return {
      ...state,
      decayWeight: decayWeight(state.timestamp, now) * recencyBoost,
    };
  });
  const totalWeight = weightedStates.reduce((sum, state) => sum + state.decayWeight, 0) || 1;
  const latest = weightedStates[weightedStates.length - 1]!;
  return {
    emotionVector: blendVectors(weightedStates.map((state) => ({
      vector: state.emotionVector,
      weight: state.decayWeight / totalWeight,
    })), latest.emotionVector.length),
    sceneVector: blendVectors(weightedStates.map((state) => ({
      vector: state.sceneVector,
      weight: state.decayWeight / totalWeight,
    })), latest.sceneVector.length),
    energyVector: blendVectors(weightedStates.map((state) => ({
      vector: state.energyVector,
      weight: state.decayWeight / totalWeight,
    })), latest.energyVector.length),
    genreVector: blendVectors(weightedStates.map((state) => ({
      vector: state.genreVector,
      weight: state.decayWeight / totalWeight,
    })), latest.genreVector.length),
    timestamp: now,
    decayWeight: Math.min(1, totalWeight / Math.max(1, weightedStates.length)),
  };
}

export function getMomentMemory(memoryKey = DEFAULT_MEMORY_KEY): MomentMemory | null {
  return memoryByKey.get(memoryKey) ?? null;
}

export function updateMomentMemory(input: {
  unifiedIntent: UnifiedIntent;
  finalPlaylistEmbedding: number[];
  memoryKey?: string;
  now?: number;
}): MomentMemory {
  const now = input.now ?? Date.now();
  const key = input.memoryKey ?? DEFAULT_MEMORY_KEY;
  const previous = memoryByKey.get(key);
  const nextState = stateFromIntent(input.unifiedIntent, input.finalPlaylistEmbedding, now);
  const recentStates = [
    ...(previous?.recentStates ?? []),
    nextState,
  ].slice(-MAX_MEMORY_STATES);
  const memory: MomentMemory = {
    recentStates,
    aggregatedState: aggregateStates(recentStates, now),
  };
  memoryByKey.set(key, memory);
  return memory;
}

function dampenRepeatedVector(current: number[], memory: number[], strength: number): number[] {
  const width = current.length;
  if (width === 0 || memory.length === 0) return current;
  const resizedMemory = resizeVector(memory, width);
  return normalizeVector(current.map((value, index) => {
    const repeatedPressure = Math.max(0, resizedMemory[index] ?? 0);
    return clamp01(value * (1 - repeatedPressure * strength));
  }));
}

export function injectMomentContext(
  currentIntent: UnifiedIntent,
  memory: MomentMemory | null,
): UnifiedIntent {
  if (!memory || memory.recentStates.length === 0 || memory.aggregatedState.decayWeight <= 0) {
    return currentIntent;
  }

  const memoryStrength = Math.min(0.14, memory.aggregatedState.decayWeight * 0.14);
  const sceneVector = blendVectors([
    { vector: currentIntent.sceneVector, weight: 1 - memoryStrength },
    { vector: memory.aggregatedState.sceneVector, weight: memoryStrength },
  ], currentIntent.sceneVector.length);
  const emotionVector = blendVectors([
    { vector: currentIntent.emotionVector, weight: 1 - memoryStrength },
    { vector: memory.aggregatedState.emotionVector, weight: memoryStrength },
  ], currentIntent.emotionVector.length);
  const energyVector = blendVectors([
    { vector: currentIntent.energyVector, weight: 1 - memoryStrength },
    { vector: memory.aggregatedState.energyVector, weight: memoryStrength },
  ], currentIntent.energyVector.length);
  const genreVector = dampenRepeatedVector(
    blendVectors([
      { vector: currentIntent.genreVector, weight: 1 - memoryStrength * 0.6 },
      { vector: memory.aggregatedState.genreVector, weight: memoryStrength * 0.6 },
    ], currentIntent.genreVector.length),
    memory.aggregatedState.genreVector,
    0.08,
  );

  return {
    ...currentIntent,
    genreVector,
    sceneVector,
    emotionVector,
    energyVector,
    semantic: {
      ...currentIntent.semantic,
      genres: genreVector,
      emotions: emotionVector,
      energyCurve: energyVector,
    },
    latentContext: {
      ...currentIntent.latentContext,
      memoryActivation: clamp01(currentIntent.latentContext.memoryActivation + memoryStrength),
      ambiguity: clamp01(currentIntent.latentContext.ambiguity * (1 - memoryStrength * 0.4)),
    },
  };
}
