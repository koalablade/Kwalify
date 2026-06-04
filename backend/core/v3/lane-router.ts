/**
 * V3 Lane Router — spec §3
 *
 * Converts a DecomposedIntent into 2–5 independent "lanes".
 * Each lane is a mini recommender with its own scoring bias.
 *
 * Standard 4-lane layout (weights: 40 / 25 / 20 / 15):
 *   CORE      — primary theme + dominant genre affinity
 *   EMOTIONAL — mood shadow (nostalgia, melancholy, introspection…)
 *   MOTION    — tempo / energy / rhythm (only when motionLevel > 0.25)
 *   CONTRAST  — genre distance + novelty (always present)
 *
 * Fallback 4-lane ensemble when intent is unclear:
 *   MAINSTREAM  — safe coherence
 *   NOSTALGIA   — pre-2010 injection
 *   DISCOVERY   — novelty / freshness
 *   AMBIENT     — low-energy, calm
 */

import type { DecomposedIntent, SceneInfluenceMap } from "./intent-decomposer";
import { isUnclearIntent } from "./intent-decomposer";

// ── Types ──────────────────────────────────────────────────────────────────

export type LaneType = "core" | "emotional" | "motion" | "contrast"
  | "mainstream" | "nostalgia" | "discovery" | "ambient";

export interface LaneScoringBias {
  weights: { ES: number; SA: number; EM: number; Era: number; Act: number; Nov: number };
  genreBonus: Partial<Record<string, number>>;
  energyTarget?: { center: number; bandwidth: number };
  eraBonus?: { preferBefore: number; bonus: number };
  noveltyMultiplier?: number;
  coreGenrePenalty?: string[];
}

export interface Lane {
  id: string;
  type: LaneType;
  label: string;
  weight: number;
  targetInfluences: string[];
  scoringBias: LaneScoringBias;
}

// ── Influence → genre mapping ──────────────────────────────────────────────

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
  bonus: number
): Partial<Record<string, number>> {
  const result: Partial<Record<string, number>> = {};
  for (const force of forces) {
    for (const genre of INFLUENCE_GENRES[force] ?? []) {
      result[genre] = Math.max(result[genre] ?? 0, bonus);
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

const ERA_YEAR: Record<string, number> = {
  "60s": 1969, "70s": 1979, "80s": 1989, "90s": 1999,
  "00s": 2009, "10s": 2019, "20s": 2029, "any": 2099,
};

// ── Standard 4-lane builder ────────────────────────────────────────────────

function buildStandardLanes(intent: DecomposedIntent): Lane[] {
  const map = intent.sceneInfluenceMap;
  const all = topForces(map, 8);
  const motion = intent.contextAnchors.motionLevel;

  // CORE lane — top 3 forces, primary genre bias
  const coreForces = all.slice(0, 3);
  const coreGenres = Object.keys(genreBonusFromForces(coreForces, 0.15));

  const coreLane: Lane = {
    id: "lane_core",
    type: "core",
    label: `Core: ${coreForces.join(" / ")}`,
    weight: 0.40,
    targetInfluences: coreForces,
    scoringBias: {
      weights: { ES: 0.25, SA: 0.30, EM: 0.20, Era: 0.12, Act: 0.08, Nov: 0.05 },
      genreBonus: genreBonusFromForces(coreForces, 0.15),
      ...(intent.contextAnchors.era !== "any"
        ? { eraBonus: { preferBefore: (ERA_YEAR[intent.contextAnchors.era] ?? 2029) + 5, bonus: 0.08 } }
        : {}),
    },
  };

  // EMOTIONAL lane — mood-heavy forces, era-biased toward nostalgia
  const emotionalForces = all
    .filter((f) =>
      ["nostalgia", "melancholy", "dark", "introspective", "hopeful",
       "romantic", "calm", "euphoric", "warmth"].includes(f)
    )
    .slice(0, 3);
  const emForces = emotionalForces.length > 0
    ? emotionalForces
    : all.filter((f) => !coreForces.includes(f)).slice(0, 2);

  const hasNostalgia =
    emForces.includes("nostalgia") || (map["nostalgia"] ?? 0) > 0.08;

  const emotionalLane: Lane = {
    id: "lane_emotional",
    type: "emotional",
    label: `Emotional: ${emForces.join(" / ")}`,
    weight: 0.25,
    targetInfluences: emForces,
    scoringBias: {
      weights: { ES: 0.15, SA: 0.20, EM: 0.35, Era: 0.18, Act: 0.07, Nov: 0.05 },
      genreBonus: genreBonusFromForces(emForces, 0.12),
      ...(hasNostalgia ? { eraBonus: { preferBefore: 2010, bonus: 0.12 } } : {}),
    },
  };

  const lanes: Lane[] = [coreLane, emotionalLane];

  // MOTION lane — only when motionLevel > 0.25
  if (motion > 0.25) {
    const motionForces = all
      .filter((f) => ["driving", "energy", "party", "rhythm", "freedom"].includes(f))
      .slice(0, 3);
    const mvForces = motionForces.length > 0 ? motionForces : ["driving", "energy"];
    const energyCenter = Math.max(0.35, Math.min(0.85, 0.35 + motion * 0.50));

    lanes.push({
      id: "lane_motion",
      type: "motion",
      label: `Motion: ${mvForces.join(" / ")}`,
      weight: 0.20,
      targetInfluences: mvForces,
      scoringBias: {
        weights: { ES: 0.20, SA: 0.20, EM: 0.25, Era: 0.12, Act: 0.15, Nov: 0.08 },
        genreBonus: genreBonusFromForces(mvForces, 0.10),
        energyTarget: { center: energyCenter, bandwidth: 0.28 },
      },
    });
  }

  // CONTRAST lane — always present: genre distance + high novelty
  const contrastLane: Lane = {
    id: "lane_contrast",
    type: "contrast",
    label: "Contrast: genre distance + novelty",
    weight: 0.15,
    targetInfluences: ["acoustic", "cinematic", "calm", "introspective"],
    scoringBias: {
      weights: { ES: 0.10, SA: 0.10, EM: 0.20, Era: 0.10, Act: 0.05, Nov: 0.45 },
      genreBonus: {
        indie: 0.08, folk: 0.08, singer_songwriter: 0.07,
        acoustic: 0.09, alternative: 0.06,
      },
      noveltyMultiplier: 2.5,
      coreGenrePenalty: coreGenres.slice(0, 3),
    },
  };
  lanes.push(contrastLane);

  // Normalize weights (motion lane may be absent → 3 lanes only)
  const totalWeight = lanes.reduce((s, l) => s + l.weight, 0);
  if (Math.abs(totalWeight - 1.0) > 0.005) {
    const factor = 1.0 / totalWeight;
    for (const lane of lanes) {
      lane.weight = Math.round(lane.weight * factor * 1000) / 1000;
    }
  }

  return lanes;
}

// ── Fallback 4-lane ensemble (spec §8) ────────────────────────────────────

function buildFallbackLanes(): Lane[] {
  return [
    {
      id: "lane_mainstream",
      type: "mainstream",
      label: "Fallback: mainstream coherence",
      weight: 0.40,
      targetInfluences: ["energy", "calm", "rhythm"],
      scoringBias: {
        weights: { ES: 0.35, SA: 0.20, EM: 0.25, Era: 0.10, Act: 0.05, Nov: 0.05 },
        genreBonus: { pop: 0.10, rock: 0.08, indie: 0.06 },
      },
    },
    {
      id: "lane_nostalgia",
      type: "nostalgia",
      label: "Fallback: nostalgia injection",
      weight: 0.25,
      targetInfluences: ["nostalgia", "warmth"],
      scoringBias: {
        weights: { ES: 0.15, SA: 0.15, EM: 0.30, Era: 0.30, Act: 0.05, Nov: 0.05 },
        genreBonus: { folk: 0.10, rock: 0.08, soul: 0.07, blues: 0.06 },
        eraBonus: { preferBefore: 2005, bonus: 0.12 },
      },
    },
    {
      id: "lane_discovery",
      type: "discovery",
      label: "Fallback: discovery / novelty",
      weight: 0.20,
      targetInfluences: ["acoustic", "introspective"],
      scoringBias: {
        weights: { ES: 0.10, SA: 0.10, EM: 0.20, Era: 0.10, Act: 0.05, Nov: 0.45 },
        genreBonus: {},
        noveltyMultiplier: 2.8,
      },
    },
    {
      id: "lane_ambient",
      type: "ambient",
      label: "Fallback: low-energy ambient",
      weight: 0.15,
      targetInfluences: ["calm", "cinematic", "focus"],
      scoringBias: {
        weights: { ES: 0.20, SA: 0.20, EM: 0.30, Era: 0.15, Act: 0.10, Nov: 0.05 },
        genreBonus: { classical: 0.10, ambient: 0.10, indie: 0.06, electronic: 0.05 },
        energyTarget: { center: 0.28, bandwidth: 0.22 },
      },
    },
  ];
}

// ── Public API ─────────────────────────────────────────────────────────────

export function buildLanes(intent: DecomposedIntent): Lane[] {
  if (isUnclearIntent(intent)) {
    return buildFallbackLanes();
  }
  return buildStandardLanes(intent);
}
