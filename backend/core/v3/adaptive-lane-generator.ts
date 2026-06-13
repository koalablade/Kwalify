/**
 * V3.1+ Adaptive Lane Generator
 *
 * Replaces the fixed 4-lane layout with a dynamic, intent-driven lane set.
 * Weights are continuously variable (float), shaped by the intent vector —
 * not hardcoded enumerations.
 *
 * Lane catalogue:
 *   CORE           — always present; primary theme + dominant forces
 *   MOTION_HIGH    — when motionLevel > 0.65
 *   NOSTALGIA_DEEP — when nostalgia influence > 0.50
 *   EMOTIONAL_SPLIT— when ≥ 2 emotional forces with similar weights (variance < 0.10)
 *   EXPLORATION    — when genre ambiguity high (top force weight < 0.30)
 *   AMBIENT_FALLBACK — when overall confidence low (< 2 forces or top < 0.25)
 *   ERA_SPLIT      — when two distinct era anchors detected in the vibe
 *   CONTRAST       — always present; genre distance + novelty push
 *
 * Routing rules:
 *   - Probabilistic: weights vary with confidence + ambiguity, not fixed
 *   - Sum of weights always normalised to 1.0
 *   - diversityPressure [0–1]: how hard this lane fights homogeneity
 */

import type { DecomposedIntent, SceneInfluenceMap } from "./intent-decomposer";
import type { Lane, LaneScoringBias } from "./lane-router";

export type AdaptiveLaneType =
  | "core"
  | "motion_high"
  | "nostalgia_deep"
  | "emotional_split"
  | "exploration"
  | "ambient_fallback"
  | "era_split"
  | "contrast";

export interface AdaptiveLane extends Lane {
  adaptiveType: AdaptiveLaneType;
  diversityPressure: number;
  confidenceScore: number;
}

const EMOTIONAL_FORCES = new Set([
  "nostalgia", "melancholy", "dark", "introspective", "hopeful",
  "romantic", "calm", "euphoric", "warmth",
]);

const MOTION_FORCES = new Set(["driving", "energy", "party", "rhythm", "freedom"]);

const ERA_PATTERNS: Array<{ pattern: RegExp; year: number }> = [
  { pattern: /\b(60s|sixties|1960s)\b/i,   year: 1969 },
  { pattern: /\b(70s|seventies|1970s)\b/i, year: 1979 },
  { pattern: /\b(80s|eighties|1980s)\b/i,  year: 1989 },
  { pattern: /\b(90s|nineties|1990s)\b/i,  year: 1999 },
  { pattern: /\b(00s|2000s|aughts|noughties)\b/i, year: 2009 },
  { pattern: /\b(10s|2010s)\b/i,           year: 2019 },
  { pattern: /\b(20s|2020s)\b/i,           year: 2029 },
];

const ERA_ANCHOR_YEAR: Record<string, number> = {
  "60s": 1969,
  "1960s": 1969,
  "70s": 1979,
  "1970s": 1979,
  "80s": 1989,
  "1980s": 1989,
  "90s": 1999,
  "1990s": 1999,
  "00s": 2009,
  "2000s": 2009,
  "10s": 2019,
  "2010s": 2019,
  "20s": 2029,
  "2020s": 2029,
};

const INFLUENCE_GENRES: Record<string, string[]> = {
  rural:         ["country", "folk", "blues", "rock"],
  freedom:       ["country", "folk", "rock", "indie"],
  warmth:        ["country", "folk", "soul", "blues"],
  driving:       ["rock", "country", "indie", "americana"],
  nostalgia:     ["rock", "folk", "soul", "pop", "rnb"],
  night:         ["indie", "alternative", "jazz", "electronic"],
  urban:         ["hip_hop", "rnb", "electronic", "pop"],
  calm:          ["folk", "indie", "classical", "ambient"],
  focus:         ["classical", "electronic", "indie", "ambient"],
  cinematic:     ["classical", "electronic", "indie", "ambient"],
  party:         ["pop", "electronic", "hip_hop", "rnb"],
  euphoric:      ["electronic", "pop", "dance"],
  melancholy:    ["indie", "folk", "alternative", "blues"],
  dark:          ["metal", "alternative", "electronic", "gothic"],
  introspective: ["indie", "folk", "alternative", "singer_songwriter"],
  romantic:      ["soul", "rnb", "pop", "jazz"],
  hopeful:       ["pop", "indie", "folk", "rock"],
  acoustic:      ["folk", "country", "indie", "singer_songwriter"],
  electronic:    ["electronic", "synth", "edm", "ambient"],
  rhythm:        ["hip_hop", "rnb", "funk", "soul"],
  energy:        ["rock", "electronic", "hip_hop", "pop"],
};

function genreBonusFromForces(
  forces: string[],
  bonus: number,
): Partial<Record<string, number>> {
  const result: Partial<Record<string, number>> = {};
  for (const f of forces) {
    for (const g of INFLUENCE_GENRES[f] ?? []) {
      result[g] = Math.max(result[g] ?? 0, bonus);
    }
  }
  return result;
}

function topForces(map: SceneInfluenceMap, n: number): string[] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([f]) => f);
}

function emotionalForceVariance(map: SceneInfluenceMap): number {
  const emotionalWeights = Object.entries(map)
    .filter(([f]) => EMOTIONAL_FORCES.has(f))
    .map(([, w]) => w);
  if (emotionalWeights.length < 2) return 1.0;
  const mean = emotionalWeights.reduce((s, v) => s + v, 0) / emotionalWeights.length;
  return emotionalWeights.reduce((s, v) => s + (v - mean) ** 2, 0) / emotionalWeights.length;
}

function detectEraSplit(vibe: string): { years: number[]; detected: boolean } {
  const years: number[] = [];
  for (const { pattern, year } of ERA_PATTERNS) {
    if (pattern.test(vibe)) years.push(year);
  }
  return { years, detected: years.length >= 2 };
}

function computeConfidence(map: SceneInfluenceMap): number {
  const forces = Object.keys(map);
  if (forces.length === 0) return 0;
  const top = Math.max(...Object.values(map));
  const count = forces.length;
  return Math.min(1, top * 1.5 + (count >= 2 ? 0.15 : 0));
}

function isCountryAmericanaIntent(intent: DecomposedIntent): boolean {
  const text = `${intent.primary} ${intent.secondaryIntents.join(" ")}`.toLowerCase();
  return (
    /\b(country|americana|alt.?country|western|cowboy|honky.?tonk|bluegrass|appalachian|roots?)\b/.test(text) ||
    ((intent.sceneInfluenceMap["rural"] ?? 0) +
      (intent.sceneInfluenceMap["acoustic"] ?? 0) +
      (intent.sceneInfluenceMap["warmth"] ?? 0) >
      0.48)
  );
}

// ── Core lane builder ────────────────────────────────────────────────────────

function buildCoreLane(
  intent: DecomposedIntent,
  coreWeight: number,
  confidence: number,
): AdaptiveLane {
  const map = intent.sceneInfluenceMap;
  const top3 = topForces(map, 3);

  const bias: LaneScoringBias = {
    weights: {
      ES: 0.25 + confidence * 0.05,
      SA: 0.30,
      EM: 0.20,
      Era: 0.12,
      Act: 0.08,
      Nov: 0.02,
    },
    genreBonus: {
      ...genreBonusFromForces(top3, isCountryAmericanaIntent(intent) ? 0.22 : 0.14),
      ...(isCountryAmericanaIntent(intent) ? { country: 0.26, folk: 0.20, blues: 0.14, rock: 0.08 } : {}),
    },
    ...(intent.contextAnchors.era !== "any"
      ? {
          eraBonus: {
            preferBefore: (ERA_ANCHOR_YEAR[intent.contextAnchors.era] ?? 2029) + 5,
            bonus: 0.08,
          },
        }
      : {}),
  };

  return {
    id: "lane_core",
    type: "core",
    adaptiveType: "core",
    label: `Core: ${top3.join(" / ")}`,
    weight: coreWeight,
    targetInfluences: top3,
    scoringBias: bias,
    diversityPressure: isCountryAmericanaIntent(intent) ? 0.18 : 0.30,
    confidenceScore: confidence,
  };
}

// ── Adaptive lane builders ───────────────────────────────────────────────────

function buildMotionHighLane(
  intent: DecomposedIntent,
  weight: number,
): AdaptiveLane {
  const motionForces = Object.keys(intent.sceneInfluenceMap)
    .filter((f) => MOTION_FORCES.has(f));
  const mv = motionForces.length > 0 ? motionForces : ["energy", "driving"];
  const energyCenter = Math.max(0.55, Math.min(0.90, intent.contextAnchors.motionLevel * 0.85));

  return {
    id: "lane_motion_high",
    type: "motion",
    adaptiveType: "motion_high",
    label: `Motion High: ${mv.slice(0, 2).join(" / ")}`,
    weight,
    targetInfluences: mv,
    scoringBias: {
      weights: { ES: 0.20, SA: 0.24, EM: 0.20, Era: 0.12, Act: 0.18, Nov: 0.06 },
      genreBonus: genreBonusFromForces(mv, 0.12),
      energyTarget: { center: energyCenter, bandwidth: 0.22 },
    },
    diversityPressure: 0.35,
    confidenceScore: intent.contextAnchors.motionLevel,
  };
}

function buildNostalgiaDeepLane(
  intent: DecomposedIntent,
  weight: number,
): AdaptiveLane {
  const nostalgiaStrength = intent.sceneInfluenceMap["nostalgia"] ?? 0;
  const cutoffYear = nostalgiaStrength > 0.70 ? 2000 : 2007;

  return {
    id: "lane_nostalgia_deep",
    type: "nostalgia",
    adaptiveType: "nostalgia_deep",
    label: "Nostalgia Deep: pre-2000s era immersion",
    weight,
    targetInfluences: ["nostalgia", "warmth", "acoustic"],
    scoringBias: {
      weights: { ES: 0.13, SA: 0.20, EM: 0.28, Era: 0.30, Act: 0.06, Nov: 0.03 },
      genreBonus: { folk: 0.12, rock: 0.10, soul: 0.09, blues: 0.07, country: 0.08 },
      eraBonus: { preferBefore: cutoffYear, bonus: 0.15 },
    },
    diversityPressure: 0.40,
    confidenceScore: nostalgiaStrength,
  };
}

function buildEmotionalSplitLane(
  intent: DecomposedIntent,
  weight: number,
): AdaptiveLane {
  const emForces = Object.keys(intent.sceneInfluenceMap)
    .filter((f) => EMOTIONAL_FORCES.has(f))
    .slice(0, 4);
  const splitForces = emForces.length >= 2 ? emForces : ["melancholy", "hopeful"];

  return {
    id: "lane_emotional_split",
    type: "emotional",
    adaptiveType: "emotional_split",
    label: `Emotional Split: ${splitForces.slice(0, 2).join(" ↔ ")}`,
    weight,
    targetInfluences: splitForces,
    scoringBias: {
      weights: { ES: 0.14, SA: 0.20, EM: 0.40, Era: 0.15, Act: 0.07, Nov: 0.04 },
      genreBonus: genreBonusFromForces(splitForces, 0.10),
    },
    diversityPressure: 0.45,
    confidenceScore: 1 - emotionalForceVariance(intent.sceneInfluenceMap),
  };
}

function buildExplorationLane(
  intent: DecomposedIntent,
  weight: number,
  coreGenres: string[],
): AdaptiveLane {
  return {
    id: "lane_exploration",
    type: "discovery",
    adaptiveType: "exploration",
    label: "Exploration: genre ambiguity + novelty",
    weight,
    targetInfluences: ["acoustic", "cinematic", "introspective", "electronic"],
    scoringBias: {
      weights: { ES: 0.14, SA: 0.16, EM: 0.24, Era: 0.12, Act: 0.06, Nov: 0.28 },
      genreBonus: {},
      noveltyMultiplier: 1.6,
      coreGenrePenalty: coreGenres.slice(0, 3),
    },
    diversityPressure: 0.55,
    confidenceScore: 0.50,
  };
}

function buildAmbientFallbackLane(
  intent: DecomposedIntent,
  weight: number,
): AdaptiveLane {
  const hasCalm =
    (intent.sceneInfluenceMap["calm"] ?? 0) > 0 ||
    (intent.sceneInfluenceMap["focus"] ?? 0) > 0;

  return {
    id: "lane_ambient_fallback",
    type: "ambient",
    adaptiveType: "ambient_fallback",
    label: "Ambient Fallback: low-confidence low-energy",
    weight,
    targetInfluences: ["calm", "cinematic", "focus", "introspective"],
    scoringBias: {
      weights: { ES: 0.18, SA: 0.22, EM: 0.30, Era: 0.15, Act: 0.10, Nov: 0.05 },
      genreBonus: { classical: 0.10, ambient: 0.10, indie: 0.07, electronic: 0.05 },
      energyTarget: { center: hasCalm ? 0.22 : 0.32, bandwidth: 0.20 },
    },
    diversityPressure: 0.40,
    confidenceScore: 0.30,
  };
}

function buildEraSplitLane(
  intent: DecomposedIntent,
  weight: number,
  splitYears: number[],
): AdaptiveLane {
  const earlierYear = Math.min(...splitYears);
  const top2 = topForces(intent.sceneInfluenceMap, 2);

  return {
    id: "lane_era_split",
    type: "nostalgia",
    adaptiveType: "era_split",
    label: `Era Split: ${earlierYear}s era bridge`,
    weight,
    targetInfluences: [...top2, "nostalgia"],
    scoringBias: {
      weights: { ES: 0.15, SA: 0.20, EM: 0.20, Era: 0.35, Act: 0.05, Nov: 0.05 },
      genreBonus: genreBonusFromForces(top2, 0.08),
      eraBonus: { preferBefore: earlierYear + 5, bonus: 0.14 },
    },
    diversityPressure: 0.65,
    confidenceScore: 0.75,
  };
}

function buildContrastLane(
  intent: DecomposedIntent,
  weight: number,
  coreGenres: string[],
): AdaptiveLane {
  return {
    id: "lane_contrast",
    type: "contrast",
    adaptiveType: "contrast",
    label: "Contrast: genre distance + novelty",
    weight,
    targetInfluences: ["acoustic", "cinematic", "calm", "introspective"],
    scoringBias: {
      weights: { ES: 0.16, SA: 0.18, EM: 0.26, Era: 0.12, Act: 0.06, Nov: 0.22 },
      genreBonus: {
        indie: 0.08, folk: 0.08, singer_songwriter: 0.07,
        acoustic: 0.09, alternative: 0.06,
      },
      noveltyMultiplier: isCountryAmericanaIntent(intent) ? 1.2 : 1.6,
      coreGenrePenalty: isCountryAmericanaIntent(intent) ? [] : coreGenres.slice(0, 2),
    },
    diversityPressure: isCountryAmericanaIntent(intent) ? 0.35 : 0.55,
    confidenceScore: 0.50,
  };
}

// ── Weight allocation ────────────────────────────────────────────────────────

/**
 * Allocates a lane-weight budget dynamically based on which optional lanes
 * are present. CORE always gets 35–55%, CONTRAST always gets 12–20%.
 * Remaining budget is split across optional lanes proportional to their
 * confidence scores.
 */
function allocateWeights(
  activeLaneTypes: AdaptiveLaneType[],
  confidenceMap: Record<AdaptiveLaneType, number>,
  overallConfidence: number,
): Record<AdaptiveLaneType, number> {
  const coreShare   = 0.42 + overallConfidence * 0.26;
  const contrastShare = 0.08 + (1 - overallConfidence) * 0.06;
  const remaining   = Math.max(0, 1 - coreShare - contrastShare);

  const optionals = activeLaneTypes.filter(
    (t) => t !== "core" && t !== "contrast",
  );

  const weights: Record<AdaptiveLaneType, number> = {} as Record<AdaptiveLaneType, number>;
  weights["core"]     = coreShare;
  weights["contrast"] = contrastShare;

  if (optionals.length === 0) {
    weights["core"] = 1 - contrastShare;
  } else {
    const totalConf = optionals.reduce(
      (s, t) => s + (confidenceMap[t] ?? 0.50),
      0,
    );
    for (const t of optionals) {
      const share = totalConf > 0
        ? ((confidenceMap[t] ?? 0.50) / totalConf) * remaining
        : remaining / optionals.length;
      weights[t] = share;
    }
  }

  return weights;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface AdaptiveLaneGeneratorResult {
  lanes: AdaptiveLane[];
  activeLaneTypes: AdaptiveLaneType[];
  generatorDiagnostics: {
    confidence: number;
    motionLevel: number;
    nostalgiaStrength: number;
    emotionalVariance: number;
    topForceWeight: number;
    eraSplit: boolean;
    splitYears: number[];
  };
}

export function generateAdaptiveLanes(
  intent: DecomposedIntent,
): AdaptiveLaneGeneratorResult {
  const map = intent.sceneInfluenceMap;
  const countryAmericanaIntent = isCountryAmericanaIntent(intent);
  const motionLevel = intent.contextAnchors.motionLevel;
  const nostalgiaStrength = map["nostalgia"] ?? 0;
  const topForceWeight = Math.max(...Object.values(map), 0);
  const confidence = computeConfidence(map);
  const emVariance = emotionalForceVariance(map);
  const { years: splitYears, detected: eraSplit } = detectEraSplit(
    intent.primary + " " + intent.secondaryIntents.join(" "),
  );

  const coreTop3 = topForces(map, 3);
  const coreGenres = Object.keys(genreBonusFromForces(coreTop3, 0.10));

  const activeLaneTypes: AdaptiveLaneType[] = ["core"];
  const confidenceMap: Record<AdaptiveLaneType, number> = {
    core: confidence,
    contrast: 0.50,
    motion_high: 0,
    nostalgia_deep: 0,
    emotional_split: 0,
    exploration: 0,
    ambient_fallback: 0,
    era_split: 0,
  };

  if (motionLevel > 0.65) {
    activeLaneTypes.push("motion_high");
    confidenceMap["motion_high"] = motionLevel;
  }

  if (nostalgiaStrength > 0.50) {
    activeLaneTypes.push("nostalgia_deep");
    confidenceMap["nostalgia_deep"] = nostalgiaStrength;
  }

  const emForceCount = Object.keys(map).filter((f) => EMOTIONAL_FORCES.has(f)).length;
  if (emForceCount >= 2 && emVariance < 0.10) {
    activeLaneTypes.push("emotional_split");
    confidenceMap["emotional_split"] = 1 - emVariance;
  }

  if (!countryAmericanaIntent && topForceWeight < 0.30) {
    activeLaneTypes.push("exploration");
    confidenceMap["exploration"] = 1 - topForceWeight;
  }

  if (confidence < 0.45) {
    activeLaneTypes.push("ambient_fallback");
    confidenceMap["ambient_fallback"] = 1 - confidence;
  }

  if (eraSplit) {
    activeLaneTypes.push("era_split");
    confidenceMap["era_split"] = 0.75;
  }

  activeLaneTypes.push("contrast");

  const alloc = allocateWeights(activeLaneTypes, confidenceMap, confidence);

  if (countryAmericanaIntent) {
    alloc["core"] = Math.max(alloc["core"] ?? 0, 0.72);
    alloc["contrast"] = Math.min(alloc["contrast"] ?? 0, 0.08);
    const total = Object.values(alloc).reduce((s, v) => s + v, 0);
    for (const key of Object.keys(alloc) as AdaptiveLaneType[]) {
      alloc[key] = alloc[key]! / total;
    }
  }

  const lanes: AdaptiveLane[] = [];

  for (const type of activeLaneTypes) {
    const w = alloc[type] ?? 0;
    switch (type) {
      case "core":
        lanes.push(buildCoreLane(intent, w, confidence));
        break;
      case "motion_high":
        lanes.push(buildMotionHighLane(intent, w));
        break;
      case "nostalgia_deep":
        lanes.push(buildNostalgiaDeepLane(intent, w));
        break;
      case "emotional_split":
        lanes.push(buildEmotionalSplitLane(intent, w));
        break;
      case "exploration":
        lanes.push(buildExplorationLane(intent, w, coreGenres));
        break;
      case "ambient_fallback":
        lanes.push(buildAmbientFallbackLane(intent, w));
        break;
      case "era_split":
        lanes.push(buildEraSplitLane(intent, w, splitYears));
        break;
      case "contrast":
        lanes.push(buildContrastLane(intent, w, coreGenres));
        break;
    }
  }

  const totalWeight = lanes.reduce((s, l) => s + l.weight, 0);
  if (Math.abs(totalWeight - 1.0) > 0.001 && totalWeight > 0) {
    const factor = 1.0 / totalWeight;
    for (const lane of lanes) {
      lane.weight = Math.round(lane.weight * factor * 1000) / 1000;
    }
  }

  return {
    lanes,
    activeLaneTypes,
    generatorDiagnostics: {
      confidence,
      motionLevel,
      nostalgiaStrength,
      emotionalVariance: emVariance,
      topForceWeight,
      eraSplit,
      splitYears,
    },
  };
}
