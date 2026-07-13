/**
 * Human Expectation Layer — Expectation Contract derivation.
 *
 * Produces ONE per-moment contract from the compositional interpretation. This
 * unifies what four legacy structures express separately (SonicProfile,
 * ScenePrototype.blueprint, MusicSemanticConstraints, PlaylistArchetype) into a
 * single derived object. Bands are *composed from dimensions* rather than read
 * from a per-scene table, so the contract exists for arbitrary prompts.
 *
 * Genre is expressed only as musical *function* (fits / failures). Genres stay a
 * consequence of the moment; they are never a primary input here.
 */

import type { JourneyArc } from "../../lib/emotion-destination";
import type {
  Band,
  DimensionGroup,
  DiscoveryExpectation,
  ExpectationContract,
  LyricalExpectation,
  MomentDimensions,
  MomentInterpretation,
  SonicBands,
} from "./types";

export interface ContractEngineSeed {
  /** Reused EmotionProfile fields from analyzeMomentPipeline (never recomputed). */
  energy?: number;
  valence?: number;
  tension?: number;
  nostalgia?: number;
  calm?: number;
  /** Reused journey arc chosen by the moment pipeline. */
  journeyArc?: JourneyArc;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function groupScore(dims: MomentDimensions, group: DimensionGroup, key: string): number {
  return dims.scores[key] ?? 0;
}

function topKeys(dims: MomentDimensions, group: DimensionGroup, n: number): string[] {
  return dims.byGroup[group].slice(0, n).map((d) => d.key);
}

function band(center: number, halfWidth: number): Band {
  return [clamp01(center - halfWidth), clamp01(center + halfWidth)];
}

/**
 * Asymmetric band around a center: a calm moment (center < 0.5) tolerates
 * quieter tracks but rejects loud ones; an energetic moment (center > 0.5) does
 * the reverse. This encodes that "wrongness" is directional.
 */
function asymmetricBand(center: number, base: number): Band {
  const lowBias = clamp01((0.5 - center) / 0.5); // 1 when very calm
  const highBias = clamp01((center - 0.5) / 0.5); // 1 when very energetic
  const lo = clamp01(center - (base + lowBias * 0.22));
  const hi = clamp01(center + (base + highBias * 0.22));
  return [lo, hi];
}

/**
 * Compose expected energy/valence when the engine did not seed them, using the
 * emotional dimension composition (positive vs heavy affect, activation).
 */
function composeAffect(dims: MomentDimensions): { energy: number; valence: number; tension: number } {
  const s = dims.scores;
  const positive =
    (s["joy"] ?? 0) + (s["hope"] ?? 0) + (s["confidence"] ?? 0) + (s["romance"] ?? 0) + (s["gratitude"] ?? 0);
  const heavy =
    (s["sadness"] ?? 0) + (s["melancholy"] ?? 0) + (s["loneliness"] ?? 0) + (s["fear"] ?? 0) + (s["anger"] ?? 0);
  const activation =
    (s["confidence"] ?? 0) + (s["anger"] ?? 0) + (s["anticipation"] ?? 0) +
    (s["explosive"] ?? 0) + (s["celebration"] ?? 0) + (s["exercising"] ?? 0) + (s["running"] ?? 0);
  const stillness =
    (s["comfort"] ?? 0) + (s["acceptance"] ?? 0) + (s["relaxing"] ?? 0) + (s["intimate"] ?? 0) +
    (s["minimal"] ?? 0) + (s["calm"] ?? 0) +
    // Sleep / meditation are strong low-arousal signals (kept below the level
    // that would collapse the center to literally zero).
    (s["sleeping"] ?? 0) * 1.1 + (s["meditating"] ?? 0) * 0.9 + (s["ambient_prod"] ?? 0) * 0.5;

  const valence = clamp01(0.5 + (positive - heavy) * 0.35);
  const energy = clamp01(0.5 + (activation - stillness) * 0.35);
  const tension = clamp01((s["fear"] ?? 0) * 0.6 + (s["anger"] ?? 0) * 0.6 + (s["restlessness"] ?? 0) * 0.5);
  return { energy, valence, tension };
}

function deriveSonicBands(
  dims: MomentDimensions,
  seed: ContractEngineSeed,
  interpretationConfidence: number,
  novelPrompt: boolean,
): SonicBands {
  const composed = composeAffect(dims);
  const energy = clamp01(seed.energy ?? composed.energy);
  const valence = clamp01(seed.valence ?? composed.valence);

  // Slightly wider bands when interpretation is uncertain / novel — but kept
  // tight enough that extreme tracks (e.g. a 0.98-energy rave) never read as a
  // mere borderline case for a calm moment.
  const uncertainty = novelPrompt ? 0.06 : 0;
  const conf = clamp01(interpretationConfidence);
  const half = 0.12 + (1 - conf) * 0.06 + uncertainty;

  // Tempo proxy tracks energy but is pulled down by explicitly slow trajectories.
  const slow = groupScore(dims, "energyTrajectory", "slow_fall") + groupScore(dims, "atmosphere", "minimal");
  const fast = groupScore(dims, "energyTrajectory", "explosive") + groupScore(dims, "activity", "exercising");
  const tempoCenter = clamp01(energy * 0.7 + 0.15 + fast * 0.2 - slow * 0.2);

  // Acoustic vs electronic leaning from the production dimension.
  const acousticLean =
    groupScore(dims, "production", "acoustic_prod") + groupScore(dims, "production", "analogue_prod") +
    groupScore(dims, "atmosphere", "natural_atmos");
  const electronicLean =
    groupScore(dims, "production", "electronic_prod") + groupScore(dims, "atmosphere", "urban_atmos");
  const acousticCenter = clamp01(0.5 + (acousticLean - electronicLean) * 0.3);

  const instrumentalLean =
    groupScore(dims, "lyrical", "instrumental_lyric") + groupScore(dims, "production", "ambient_prod") +
    groupScore(dims, "activity", "focus") + groupScore(dims, "activity", "studying");
  const vocalLean =
    groupScore(dims, "lyrical", "vocal_forward") + groupScore(dims, "lyrical", "storytelling_lyric");
  const instrumentalCenter = clamp01(0.35 + (instrumentalLean - vocalLean) * 0.3);

  return {
    energy: asymmetricBand(energy, half),
    valence: asymmetricBand(valence, half),
    tempo: band(tempoCenter, half + 0.05),
    acoustic: band(acousticCenter, half + 0.08),
    instrumental: band(instrumentalCenter, half + 0.08),
  };
}

/**
 * Derive "avoid" characteristics from the poles of the dominant dimensions —
 * principled opposites, not a hardcoded per-scene exclusion table.
 */
function deriveAvoid(dims: MomentDimensions, bands: SonicBands): string[] {
  const avoid = new Set<string>();
  const energyCenter = (bands.energy[0] + bands.energy[1]) / 2;
  const valenceCenter = (bands.valence[0] + bands.valence[1]) / 2;

  if (energyCenter < 0.4) {
    avoid.add("aggressive");
    avoid.add("high-energy peak-time");
    avoid.add("hype/anthemic");
  }
  if (energyCenter > 0.65) {
    avoid.add("sleepy/ambient drift");
  }
  if (valenceCenter < 0.4) {
    avoid.add("bubbly/upbeat pop");
    avoid.add("motivational recovery clichés");
  }
  if (valenceCenter > 0.65) {
    avoid.add("bleak/despairing");
  }
  if ((dims.scores["intimate"] ?? 0) > 0.3 || (dims.scores["minimal"] ?? 0) > 0.3) {
    avoid.add("wall-of-sound density");
  }
  // Universal breakers unless explicitly invited.
  if ((dims.scores["celebration"] ?? 0) < 0.3 && (dims.scores["joy"] ?? 0) < 0.3) {
    avoid.add("novelty/comedy tracks");
  }
  return Array.from(avoid);
}

/**
 * Map dominant dimensions to musical FUNCTION descriptors. Deliberately avoids
 * genre names so that many genres can satisfy the same expectation.
 */
function deriveGenreFunction(
  dims: MomentDimensions,
  bands: SonicBands,
): { fits: string[]; failures: string[] } {
  const fits = new Set<string>();
  const failures = new Set<string>();
  const energyCenter = (bands.energy[0] + bands.energy[1]) / 2;
  const s = dims.scores;

  const introspective =
    (s["loneliness"] ?? 0) + (s["melancholy"] ?? 0) + (s["nostalgia"] ?? 0) + (s["acceptance"] ?? 0) + (s["intimate"] ?? 0);
  const dreamy = (s["dreamlike"] ?? 0) + (s["ambient_prod"] ?? 0) + (s["airy"] ?? 0);
  const driving = (s["driving"] ?? 0) + (s["explosive"] ?? 0) + (s["confidence"] ?? 0);
  const acousticLean = (s["acoustic_prod"] ?? 0) + (s["natural_atmos"] ?? 0);

  if (introspective > 0.3) {
    fits.add("atmospheric");
    fits.add("emotionally spacious");
    fits.add("slow-to-mid build");
  }
  if (dreamy > 0.3) {
    fits.add("hazy/textured");
    fits.add("reverb-forward");
  }
  if (acousticLean > 0.3) {
    fits.add("organic/acoustic-leaning");
    fits.add("warm timbre");
  }
  if (driving > 0.3 && energyCenter > 0.55) {
    fits.add("propulsive/steady pulse");
    fits.add("forward momentum");
  }
  if (energyCenter > 0.7) {
    fits.add("high-intensity");
  }
  if (fits.size === 0) {
    fits.add("mood-consistent, moment-appropriate");
  }

  if (energyCenter < 0.4) {
    failures.add("four-on-the-floor peak-time");
    failures.add("aggressive/abrasive");
  }
  if (introspective > 0.3) {
    failures.add("bright party pop");
  }
  failures.add("tonally random / genre-tourist picks");
  return { fits: Array.from(fits), failures: Array.from(failures) };
}

function deriveArc(dims: MomentDimensions, seed: ContractEngineSeed): JourneyArc {
  if (seed.journeyArc && seed.journeyArc !== "default") return seed.journeyArc;
  const t = dims.byGroup.energyTrajectory[0]?.key;
  switch (t) {
    case "slow_rise":
      return "linear_rise";
    case "slow_fall":
      return "linear_fall";
    case "wave":
      return "wave";
    case "explosive":
      return "peak_release";
    case "steady_focus":
    case "constant":
      return "flat";
    default:
      return "default";
  }
}

function deriveEra(dims: MomentDimensions): { label: string; strictness: number } | null {
  const top = dims.byGroup.era[0];
  if (!top) return null;
  const explicit = ["eighties_era", "nineties_era", "y2k_era"].includes(top.key);
  return { label: top.key.replace(/_era$/, ""), strictness: explicit ? Math.min(1, top.weight + 0.2) : top.weight };
}

function deriveLyrical(dims: MomentDimensions): LyricalExpectation {
  const s = dims.scores;
  if ((s["instrumental_lyric"] ?? 0) > 0.3 || (s["focus"] ?? 0) > 0.4 || (s["studying"] ?? 0) > 0.4) {
    return "instrumental";
  }
  if ((s["storytelling_lyric"] ?? 0) > 0.3) return "storytelling";
  if ((s["vocal_forward"] ?? 0) > 0.3) return "vocal_forward";
  if ((s["minimal_lyric"] ?? 0) > 0.3 || (s["minimal"] ?? 0) > 0.4) return "minimal";
  return "any";
}

function deriveDiscovery(dims: MomentDimensions): DiscoveryExpectation {
  const s = dims.scores;
  if ((s["exploration_disc"] ?? 0) > 0.3) return "exploration";
  if ((s["comfort_disc"] ?? 0) > 0.3 || (s["nostalgia"] ?? 0) > 0.4) return "comfort";
  return "mixed";
}

/**
 * Build the unified expectation contract for a moment.
 */
export function deriveExpectationContract(
  interpretation: MomentInterpretation,
  seed: ContractEngineSeed = {},
): ExpectationContract {
  const dims = interpretation.dimensions;
  const interpretationConfidence = interpretation.candidates[0]?.confidence ?? 0;

  const sonicBands = deriveSonicBands(
    dims,
    seed,
    interpretationConfidence,
    interpretation.novelPrompt,
  );

  const atmosphere = [
    ...topKeys(dims, "atmosphere", 3),
    ...topKeys(dims, "emotional", 2),
  ];

  return {
    atmosphere,
    avoid: deriveAvoid(dims, sonicBands),
    sonicBands,
    genreFunction: deriveGenreFunction(dims, sonicBands),
    arc: deriveArc(dims, seed),
    era: deriveEra(dims),
    lyrical: deriveLyrical(dims),
    discovery: deriveDiscovery(dims),
    source: "derived",
    interpretationConfidence,
  };
}
