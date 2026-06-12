import type { EmotionProfile } from "../lib/emotion";
import type { IntentDecodeResult } from "../lib/intent-decoder";
import type { UserIntent } from "../lib/intent-parser";
import { decomposeIntent, type DecomposedIntent } from "./v3/intent-decomposer";
import {
  buildLockedIntent,
  completeLockedIntent,
  ROOT_GENRE_FAMILIES,
  type LockedIntent,
  type LockedIntentFallbacks,
  type SceneIntent,
} from "./v3/intent";

export interface UnifiedIntent {
  momentCore: MomentCore;
  semantic: UnifiedSemanticFields;
  latentContext: LatentContextField;
  genreVector: number[];
  sceneVector: number[];
  emotionVector: number[];
  energyVector: number[];
  timeOfDayVector: number[];
}

export interface MomentCore {
  type: string;
  description: string;
  confidence: number;
}

export interface UnifiedSemanticFields {
  genres: number[];
  emotions: number[];
  energyCurve: number[];
  timeOfDay: number[];
  activity: number[];
}

export interface LatentContextField {
  ambiguity: number;
  introspectionDepth: number;
  motionState: number;
  socialIsolation: number;
  memoryActivation: number;
}

export interface UnifiedIntentSnapshot {
  source: "controller" | "v11" | "v3_locked" | "v3_scene" | "v3_decomposed" | "resolver";
  confidence: number;
  intent: UnifiedIntent;
}

export interface UnifiedIntentDiagnostics {
  snapshots: UnifiedIntentSnapshot[];
  resolver: UnifiedIntentSnapshot;
  disagreement: {
    genre: number;
    scene: number;
    emotion: number;
    energy: number;
    timeOfDay: number;
  };
}

export interface UnifiedIntentContext {
  unifiedIntent: UnifiedIntent;
  diagnostics: UnifiedIntentDiagnostics;
  lockedIntent: LockedIntent;
  decomposedIntent: DecomposedIntent;
}

const DEFAULT_EMOTION_PROFILE: EmotionProfile = {
  energy: 0.5,
  valence: 0.5,
  tension: 0.3,
  nostalgia: 0.2,
  calm: 0.5,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector.map(() => 0);
  return vector.map((value) => Math.round((value / magnitude) * 1000) / 1000);
}

function cosineDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  if (aMag === 0 || bMag === 0) return 0;
  return Math.round((1 - dot / (Math.sqrt(aMag) * Math.sqrt(bMag))) * 1000) / 1000;
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const width = Math.max(...vectors.map((vector) => vector.length));
  const out = new Array(width).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < width; i++) out[i] += vector[i] ?? 0;
  }
  return normalizeVector(out.map((value) => value / vectors.length));
}

function genreVector(families: string[]): number[] {
  const normalized = new Set(families.map((family) => family.toLowerCase()));
  return normalizeVector(ROOT_GENRE_FAMILIES.map((family) => normalized.has(family) ? 1 : 0));
}

function emotionVectorFromProfile(profile: EmotionProfile): number[] {
  return normalizeVector([
    profile.energy ?? 0.5,
    profile.valence ?? 0.5,
    profile.tension ?? 0.3,
    profile.nostalgia ?? 0.2,
    profile.calm ?? 0.5,
  ]);
}

function energyVector(value: number | "low" | "medium" | "high" | null | undefined): number[] {
  const energy =
    value === "high" ? 0.85 :
    value === "medium" ? 0.55 :
    value === "low" ? 0.25 :
    typeof value === "number" ? value :
    0.5;
  return normalizeVector([1 - energy, energy, Math.abs(energy - 0.5)]);
}

function timeOfDayVector(time?: string | null): number[] {
  return normalizeVector([
    time === "morning" ? 1 : 0,
    time === "afternoon" ? 1 : 0,
    time === "evening" ? 1 : 0,
    time === "late_night" ? 1 : 0,
  ]);
}

function activityVector(activity?: string | null): number[] {
  return normalizeVector([
    activity === "driving" ? 1 : 0,
    activity === "focus" || activity === "working" || activity === "studying" ? 1 : 0,
    activity === "party" ? 1 : 0,
    activity === "chill" || activity === "relaxing" ? 1 : 0,
    activity === "walking" || activity === "cleaning" ? 1 : 0,
  ]);
}

function sceneVectorFromScene(scene?: SceneIntent | null): number[] {
  if (!scene) return normalizeVector(new Array(10).fill(0.5));
  return normalizeVector([
    scene.sceneVector.energy,
    scene.sceneVector.valence,
    scene.sceneVector.nostalgia,
    scene.sceneVector.tension,
    scene.sceneVector.motion,
    scene.sceneVector.introspection,
    scene.sceneVector.warmth,
    scene.sceneVector.darkness,
    scene.sceneVector.socialness,
    scene.sceneVector.clarity,
  ]);
}

function sceneVectorFromInfluences(influences: Record<string, number>): number[] {
  return normalizeVector([
    influences["energy"] ?? 0,
    influences["hopeful"] ?? influences["euphoric"] ?? 0,
    influences["nostalgia"] ?? 0,
    influences["melancholy"] ?? influences["dark"] ?? 0,
    influences["driving"] ?? influences["rhythm"] ?? 0,
    influences["introspective"] ?? influences["focus"] ?? 0,
    influences["warmth"] ?? 0,
    influences["night"] ?? influences["dark"] ?? 0,
    influences["party"] ?? influences["romantic"] ?? 0,
    influences["calm"] ?? influences["focus"] ?? 0,
  ]);
}

function defaultMomentCore(): MomentCore {
  return {
    type: "general_listening_moment",
    description: "a balanced listening moment without a dominant contextual scene",
    confidence: 0.45,
  };
}

function defaultLatentContext(): LatentContextField {
  return {
    ambiguity: 0.35,
    introspectionDepth: 0.35,
    motionState: 0.25,
    socialIsolation: 0.25,
    memoryActivation: 0.20,
  };
}

export function resolveMomentCore(input: string): MomentCore {
  const lower = input.toLowerCase();
  const night = /\b(2\s?am|3\s?am|late.?night|midnight|after.?dark)\b/.test(lower);
  const liminal = /\b(petrol station|gas station|service station|parking lot|empty road|terminal|platform|between|nowhere)\b/.test(lower);
  const reflection = /\b(existential|thinking about everything|overthinking|reflect|introspect|crisis|spiral)\b/.test(lower);
  const driving = /\b(drive|driving|road|highway|car|cruise)\b/.test(lower);
  const memory = /\b(memory|memories|nostalg|remember|old photos?|throwback)\b/.test(lower);
  const cleaning = /\b(cleaning|clean room|bedroom|room|laundry)\b/.test(lower);
  const warmChange = /\b(first warm day|after winter|spring|sun comes back|fresh start|new chapter)\b/.test(lower);
  const overload = /\b(overload|too much|panic|argument|fight|breakdown|can't sleep|cant sleep)\b/.test(lower);

  if (liminal && reflection && night) {
    return {
      type: "liminal_isolation_reflection",
      description: "stopped between motion and thought in an empty transitional space",
      confidence: 0.86,
    };
  }
  if (driving && night && reflection) {
    return {
      type: "late_night_drive_reflection",
      description: "moving through darkness while processing private thoughts",
      confidence: 0.82,
    };
  }
  if (cleaning && memory) {
    return {
      type: "nostalgic_memory_cleaning_room",
      description: "rediscovering memories while resetting a private space",
      confidence: 0.80,
    };
  }
  if (warmChange) {
    return {
      type: "first_warm_day_transformation",
      description: "a seasonal shift that feels like emotional renewal",
      confidence: 0.78,
    };
  }
  if (overload || (reflection && !driving)) {
    return {
      type: "emotional_overload_static_moment",
      description: "a still moment of emotional pressure and internal processing",
      confidence: 0.74,
    };
  }
  if (driving) {
    return {
      type: "motion_escape",
      description: "a moving scene shaped by escape, rhythm, and forward motion",
      confidence: 0.68,
    };
  }
  if (memory) {
    return {
      type: "memory_revisit",
      description: "a reflective return to emotionally charged memories",
      confidence: 0.66,
    };
  }
  return defaultMomentCore();
}

function latentContextFromMoment(input: string, momentCore: MomentCore, scene?: SceneIntent | null): LatentContextField {
  const lower = input.toLowerCase();
  const ambiguitySignals = [
    /\b(and|but|while|\+|,)\b/.test(lower),
    /\b(existential|liminal|somewhere|nowhere|everything)\b/.test(lower),
    momentCore.confidence < 0.7,
  ].filter(Boolean).length;
  return {
    ambiguity: clamp01(0.18 + ambiguitySignals * 0.20),
    introspectionDepth: clamp01(
      (scene?.sceneVector.introspection ?? 0.35) +
      (/\b(existential|thinking|reflect|overthinking|alone|crisis)\b/.test(lower) ? 0.35 : 0)
    ),
    motionState: clamp01(
      (scene?.sceneVector.motion ?? 0.25) +
      (/\b(drive|driving|road|car|moving|between)\b/.test(lower) ? 0.25 : 0)
    ),
    socialIsolation: clamp01(
      (scene ? 1 - scene.sceneVector.socialness : 0.35) +
      (/\b(alone|empty|isolated|petrol station|2\s?am|late.?night)\b/.test(lower) ? 0.25 : 0)
    ),
    memoryActivation: clamp01(
      (scene?.sceneVector.nostalgia ?? 0.20) +
      (/\b(memory|memories|nostalg|remember|old)\b/.test(lower) ? 0.35 : 0)
    ),
  };
}

function semanticFieldsFromVectors(
  genre: number[],
  emotion: number[],
  energy: number[],
  timeOfDay: number[],
  activity: number[] = activityVector(null),
): UnifiedSemanticFields {
  return {
    genres: genre,
    emotions: emotion,
    energyCurve: energy,
    timeOfDay,
    activity,
  };
}

function emptyUnifiedIntent(): UnifiedIntent {
  const genre = genreVector([]);
  const emotion = normalizeVector([0.5, 0.5, 0.3, 0.2, 0.5]);
  const energy = energyVector(null);
  const time = timeOfDayVector(null);
  return withMomentModel({
    genreVector: genre,
    sceneVector: normalizeVector(new Array(10).fill(0.5)),
    emotionVector: emotion,
    energyVector: energy,
    timeOfDayVector: time,
  }, defaultMomentCore(), defaultLatentContext(), activityVector(null));
}

function withMomentModel(
  base: Omit<UnifiedIntent, "momentCore" | "semantic" | "latentContext">,
  momentCore: MomentCore,
  latentContext: LatentContextField,
  activity: number[],
): UnifiedIntent {
  return {
    momentCore,
    semantic: semanticFieldsFromVectors(
      base.genreVector,
      base.emotionVector,
      base.energyVector,
      base.timeOfDayVector,
      activity,
    ),
    latentContext,
    ...base,
  };
}

export function unifiedIntentFromControllerIntent(
  intent: IntentDecodeResult,
  profile: EmotionProfile,
): UnifiedIntentSnapshot {
  return {
    source: "controller",
    confidence: clamp01(intent.confidence),
    intent: {
      ...emptyUnifiedIntent(),
      emotionVector: emotionVectorFromProfile(profile),
      energyVector: energyVector(profile.energy + intent.scoringOverrides.energyBias * intent.confidence),
    },
  };
}

export function unifiedIntentFromV11Intent(
  intent: IntentDecodeResult,
  profile: EmotionProfile,
): UnifiedIntentSnapshot {
  return {
    source: "v11",
    confidence: clamp01(intent.confidence),
    intent: {
      ...emptyUnifiedIntent(),
      emotionVector: emotionVectorFromProfile(profile),
      energyVector: energyVector(profile.energy),
    },
  };
}

export function unifiedIntentFromLockedIntent(intent: LockedIntent): UnifiedIntentSnapshot {
  const genre = genreVector(intent.genreFamilies);
  const scene = sceneVectorFromScene(intent.sceneIntent);
  const emotion = normalizeVector([
    intent.sceneIntent?.emotionVector.joy ?? 0.5,
    intent.sceneIntent?.emotionVector.tension ?? 0.3,
    intent.sceneIntent?.emotionVector.nostalgia ?? 0.2,
    intent.sceneIntent?.emotionVector.restlessness ?? 0.2,
    intent.sceneIntent?.emotionVector.calm ?? 0.5,
  ]);
  const energy = energyVector(intent.energy);
  const time = timeOfDayVector(intent.sceneIntent?.contextWorld.time);
  return {
    source: "v3_locked",
    confidence: intent.sceneIntent?.sceneConfidence ?? 0.65,
    intent: withMomentModel({
      genreVector: genre,
      sceneVector: scene,
      emotionVector: emotion,
      energyVector: energy,
      timeOfDayVector: time,
    }, defaultMomentCore(), defaultLatentContext(), activityVector(intent.activity)),
  };
}

export function unifiedIntentFromSceneIntent(scene: SceneIntent | null | undefined): UnifiedIntentSnapshot {
  return {
    source: "v3_scene",
    confidence: scene?.sceneConfidence ?? 0,
    intent: {
      ...emptyUnifiedIntent(),
      genreVector: genreVector([scene?.genreRoles.anchor ?? "", ...(scene?.genreRoles.satellites ?? [])]),
      sceneVector: sceneVectorFromScene(scene),
      emotionVector: normalizeVector([
        scene?.emotionVector.joy ?? 0.5,
        scene?.emotionVector.tension ?? 0.3,
        scene?.emotionVector.nostalgia ?? 0.2,
        scene?.emotionVector.restlessness ?? 0.2,
        scene?.emotionVector.calm ?? 0.5,
      ]),
      energyVector: energyVector(scene ? (scene.energyArc.start + scene.energyArc.mid + scene.energyArc.end) / 3 : null),
      timeOfDayVector: timeOfDayVector(scene?.contextWorld.time),
    },
  };
}

export function unifiedIntentFromDecomposedIntent(intent: DecomposedIntent): UnifiedIntentSnapshot {
  const baseIntent: UserIntent = intent.baseIntent;
  return {
    source: "v3_decomposed",
    confidence: clamp01(intent.confidence),
    intent: {
      ...emptyUnifiedIntent(),
      sceneVector: sceneVectorFromInfluences(intent.sceneInfluenceMap),
      emotionVector: normalizeVector([
        baseIntent.mood.includes("happy") ? 1 : 0.5,
        baseIntent.mood.includes("sad") ? 1 : 0.3,
        baseIntent.mood.includes("nostalgic") ? 1 : 0.2,
        intent.contextAnchors.motionLevel,
        baseIntent.mood.includes("calm") ? 1 : 0.5,
      ]),
      energyVector: energyVector(baseIntent.energy),
      timeOfDayVector: timeOfDayVector(intent.contextAnchors.environment === "night" ? "late_night" : null),
    },
  };
}

export function resolveUnifiedIntent(snapshots: UnifiedIntentSnapshot[]): UnifiedIntentDiagnostics {
  const active = snapshots.length > 0 ? snapshots : [{
    source: "resolver" as const,
    confidence: 1,
    intent: emptyUnifiedIntent(),
  }];
  const resolvedVectors = {
    genreVector: averageVectors(active.map((snapshot) => snapshot.intent.genreVector)),
    sceneVector: averageVectors(active.map((snapshot) => snapshot.intent.sceneVector)),
    emotionVector: averageVectors(active.map((snapshot) => snapshot.intent.emotionVector)),
    energyVector: averageVectors(active.map((snapshot) => snapshot.intent.energyVector)),
    timeOfDayVector: averageVectors(active.map((snapshot) => snapshot.intent.timeOfDayVector)),
  };
  const primarySnapshot = [...active].sort((a, b) => b.confidence - a.confidence)[0];
  const resolver: UnifiedIntentSnapshot = {
    source: "resolver",
    confidence: Math.round((active.reduce((sum, snapshot) => sum + snapshot.confidence, 0) / active.length) * 1000) / 1000,
    intent: withMomentModel(
      resolvedVectors,
      primarySnapshot?.intent.momentCore ?? defaultMomentCore(),
      primarySnapshot?.intent.latentContext ?? defaultLatentContext(),
      averageVectors(active.map((snapshot) => snapshot.intent.semantic.activity)),
    ),
  };

  return {
    snapshots: active,
    resolver,
    disagreement: {
      genre: Math.max(...active.map((snapshot) => cosineDistance(snapshot.intent.genreVector, resolver.intent.genreVector)), 0),
      scene: Math.max(...active.map((snapshot) => cosineDistance(snapshot.intent.sceneVector, resolver.intent.sceneVector)), 0),
      emotion: Math.max(...active.map((snapshot) => cosineDistance(snapshot.intent.emotionVector, resolver.intent.emotionVector)), 0),
      energy: Math.max(...active.map((snapshot) => cosineDistance(snapshot.intent.energyVector, resolver.intent.energyVector)), 0),
      timeOfDay: Math.max(...active.map((snapshot) => cosineDistance(snapshot.intent.timeOfDayVector, resolver.intent.timeOfDayVector)), 0),
    },
  };
}

export function buildUnifiedIntentContext(
  prompt: string,
  profile: EmotionProfile = DEFAULT_EMOTION_PROFILE,
  fallbacks: LockedIntentFallbacks = {},
  comparisonSnapshots: UnifiedIntentSnapshot[] = [],
): UnifiedIntentContext {
  const lockedIntent = completeLockedIntent(buildLockedIntent(prompt), fallbacks);
  const decomposedIntent = decomposeIntent(prompt, profile);
  const diagnosticsBase = resolveUnifiedIntent([
    ...comparisonSnapshots,
    unifiedIntentFromLockedIntent(lockedIntent),
    unifiedIntentFromSceneIntent(lockedIntent.sceneIntent),
    unifiedIntentFromDecomposedIntent(decomposedIntent),
  ]);
  const momentCore = resolveMomentCore(prompt);
  const latentContext = latentContextFromMoment(prompt, momentCore, lockedIntent.sceneIntent);
  const unifiedIntent = withMomentModel(
    {
      genreVector: diagnosticsBase.resolver.intent.genreVector,
      sceneVector: diagnosticsBase.resolver.intent.sceneVector,
      emotionVector: diagnosticsBase.resolver.intent.emotionVector,
      energyVector: diagnosticsBase.resolver.intent.energyVector,
      timeOfDayVector: diagnosticsBase.resolver.intent.timeOfDayVector,
    },
    momentCore,
    latentContext,
    activityVector(lockedIntent.activity),
  );
  const diagnostics: UnifiedIntentDiagnostics = {
    ...diagnosticsBase,
    resolver: {
      ...diagnosticsBase.resolver,
      confidence: Math.max(diagnosticsBase.resolver.confidence, momentCore.confidence),
      intent: unifiedIntent,
    },
  };

  return {
    unifiedIntent,
    diagnostics,
    lockedIntent,
    decomposedIntent,
  };
}

export function buildUnifiedIntent(prompt: string): UnifiedIntent {
  return buildUnifiedIntentContext(prompt).unifiedIntent;
}
