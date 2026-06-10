/**
 * V3 Lane Scorer — spec §4 (per-lane variant)
 *
 * Scores every track for a specific lane using:
 *   - Lane-specific signal weights
 *   - Influence affinity (replaces single-scene ecosystem scoring)
 *   - Genre bonus / era bonus / energy-band bonus from LaneScoringBias
 *   - Novelty multiplier for contrast lanes
 *   - Core-genre penalty for contrast lanes
 */

import {
  buildTrackEmbedding,
  type AudioVector,
} from "../../shared/embeddings/track-embeddings";
import { buildIntentEmbedding, computeActivityMatch } from "../../lib/intent-parser";
import { computeR, computeEmotionMatch } from "../v2/triple-signal-scorer";
import { computeEraMatch, detectEraFromYear, estimateEraFromAudio } from "../v2/era-model";
import type { EraBucket } from "../../lib/intent-parser";
import type { DecomposedIntent } from "./intent-decomposer";
import type { Lane } from "./lane-router";

// ── Track shape ────────────────────────────────────────────────────────────

export interface ScorerTrack {
  trackId: string;
  artistName: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}

export interface LaneScoredTrack<T extends ScorerTrack> {
  track: T;
  laneScore: number;
  signals: {
    ES: number;
    SA: number;
    EM: number;
    Era: number;
    Act: number;
    Nov: number;
    genreBonus: number;
    eraBonus: number;
    energyBandBonus: number;
    coreGenrePenalty: number;
  };
  era: EraBucket;
  genrePrimary: string;
}

// ── Influence affinity ─────────────────────────────────────────────────────

/**
 * How well a track's audio profile matches a named influence force.
 * Returns 0–1 (clipped).
 */
function forceAffinity(
  force: string,
  e: number,
  v: number,
  d: number,
  a: number,
  t: number
): number {
  switch (force) {
    case "driving":       return Math.max(0, 1 - Math.abs(e - 0.62) * 1.5);
    case "nostalgia":     return Math.max(0, 0.40 + v * 0.30 + a * 0.15 - Math.abs(e - 0.45) * 0.50);
    case "night":         return Math.max(0, 1 - Math.abs(e - 0.38) * 1.40 + (v < 0.45 ? 0.10 : -0.05));
    case "freedom":       return Math.max(0, 0.30 + (1 - Math.abs(e - 0.52)) * 0.40 + a * 0.20);
    case "melancholy":    return Math.max(0, 1 - Math.abs(v - 0.28) * 2.00 - Math.abs(e - 0.40) * 0.80);
    case "energy":        return Math.max(0, e * 0.60 + (t > 0.55 ? 0.30 : 0) + d * 0.10);
    case "calm":          return Math.max(0, 1 - Math.abs(e - 0.25) * 2.00 + a * 0.10);
    case "warmth":        return Math.max(0, (v > 0.50 ? 0.30 : 0) + a * 0.30 + (1 - Math.abs(e - 0.45)) * 0.30);
    case "urban":         return Math.max(0, d * 0.40 + (1 - a) * 0.30 + Math.min(1, e * 1.2) * 0.30);
    case "rural":         return Math.max(0, a * 0.40 + (1 - Math.abs(e - 0.42)) * 0.30 + v * 0.20);
    case "focus":         return Math.max(0, 1 - Math.abs(e - 0.35) * 1.80 + (d < 0.40 ? 0.10 : -0.05));
    case "party":         return Math.max(0, d * 0.50 + e * 0.30 + v * 0.20);
    case "cinematic":     return Math.max(0, (1 - d) * 0.30 + a * 0.20 + (1 - Math.abs(e - 0.50)) * 0.40);
    case "introspective": return Math.max(0, 1 - Math.abs(e - 0.32) * 1.50 + a * 0.20 - d * 0.15);
    case "euphoric":      return Math.max(0, v * 0.50 + e * 0.30 + d * 0.20);
    case "dark":          return Math.max(0, (v < 0.40 ? 0.40 : 0.05) + (1 - a) * 0.20 + e * 0.20);
    case "romantic":      return Math.max(0, 1 - Math.abs(v - 0.62) * 1.50 + (1 - Math.abs(e - 0.42)) * 0.30);
    case "hopeful":       return Math.max(0, 1 - Math.abs(v - 0.68) * 1.40 + (1 - Math.abs(e - 0.52)) * 0.30);
    case "acoustic":      return Math.max(0, a * 0.60 + (1 - Math.abs(e - 0.40)) * 0.30);
    case "electronic":    return Math.max(0, (1 - a) * 0.50 + e * 0.30 + d * 0.20);
    case "rhythm":        return Math.max(0, d * 0.50 + e * 0.30 + t * 0.20);
    default:              return 0.50;
  }
}

/**
 * Weighted influence affinity for a lane's target forces.
 * Returns 0–1.
 */
function computeInfluenceAffinity(
  track: ScorerTrack,
  targetInfluences: string[],
  influenceMap: Record<string, number>
): number {
  if (targetInfluences.length === 0) return 0.50;

  const e = track.energy ?? 0.50;
  const v = track.valence ?? 0.50;
  const d = track.danceability ?? 0.50;
  const a = track.acousticness ?? 0.30;
  const t = Math.min(1, (track.tempo ?? 120) / 200);

  let totalAffinity = 0;
  let totalWeight = 0;

  for (const force of targetInfluences) {
    const w = influenceMap[force] ?? (1 / targetInfluences.length);
    totalAffinity += forceAffinity(force, e, v, d, a, t) * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? Math.min(1, totalAffinity / totalWeight) : 0.50;
}

function isCountryAmericanaIntent(intent: DecomposedIntent): boolean {
  const text = `${intent.primary} ${intent.secondaryIntents.join(" ")}`.toLowerCase();
  const countryText =
    /\b(country|americana|alt.?country|western|cowboy|honky.?tonk|bluegrass|appalachian|roots?)\b/.test(text);
  const ruralAcoustic =
    (intent.sceneInfluenceMap["rural"] ?? 0) +
    (intent.sceneInfluenceMap["acoustic"] ?? 0) +
    (intent.sceneInfluenceMap["warmth"] ?? 0) >
    0.48;
  return countryText || ruralAcoustic;
}

function countryAmericanaGenreModifier(genre: string): number {
  switch (genre) {
    case "country":
    case "folk":
    case "blues":
      return 0.22;
    case "rock":
    case "indie":
      return 0.08;
    case "pop":
      return -0.16;
    case "electronic":
    case "hip_hop":
    case "rnb":
    case "metal":
    case "latin":
      return -0.28;
    default:
      return -0.08;
  }
}

function acousticContinuityBonus(track: ScorerTrack, intent: DecomposedIntent): number {
  const acousticIntent =
    (intent.sceneInfluenceMap["acoustic"] ?? 0) +
    (intent.sceneInfluenceMap["rural"] ?? 0) +
    (intent.sceneInfluenceMap["warmth"] ?? 0);
  if (acousticIntent < 0.30) return 0;
  const acousticness = track.acousticness ?? 0.35;
  return Math.max(0, Math.min(0.10, (acousticness - 0.35) * 0.20));
}

// ── Main scorer ────────────────────────────────────────────────────────────

export function scoreLane<T extends ScorerTrack>(
  tracks: T[],
  lane: Lane,
  intent: DecomposedIntent,
  opts: {
    genreByTrack?: (trackId: string) => string;
    noveltyByTrack?: (trackId: string) => number;
  } = {}
): LaneScoredTrack<T>[] {
  const intentEmbedding: AudioVector = buildIntentEmbedding(intent.baseIntent);
  const bias = lane.scoringBias;
  const w = bias.weights;

  return tracks
    .map((track) => {
      const embedding = buildTrackEmbedding(track);

      const era: EraBucket = track.releaseYear
        ? detectEraFromYear(track.releaseYear)
        : estimateEraFromAudio(track);

      // ── Six base signals ───────────────────────────────────────────────
      const ES  = computeR(embedding, intentEmbedding);
      const SA  = computeInfluenceAffinity(track, lane.targetInfluences, intent.sceneInfluenceMap);
      const EM  = computeEmotionMatch(track, intent.baseIntent);
      const Era = computeEraMatch(era, intent.baseIntent.era);
      const Act = computeActivityMatch(track, intent.baseIntent.activity);
      const baseNov = opts.noveltyByTrack?.(track.trackId) ?? 0.50;
      const Nov = Math.min(1, baseNov * (bias.noveltyMultiplier ?? 1.0));

      // ── Lane modifiers ─────────────────────────────────────────────────
      const genre = opts.genreByTrack?.(track.trackId) ?? "unknown";

      const genreBonus = bias.genreBonus[genre] ?? 0;
      const intentGenreModifier = isCountryAmericanaIntent(intent)
        ? countryAmericanaGenreModifier(genre)
        : 0;

      const coreGenrePenalty =
        (bias.coreGenrePenalty?.includes(genre) && genre !== "unknown") ? -0.12 : 0;

      let eraBonus = 0;
      if (bias.eraBonus && track.releaseYear) {
        if (track.releaseYear <= bias.eraBonus.preferBefore) {
          eraBonus = bias.eraBonus.bonus;
        }
      }

      let energyBandBonus = 0;
      if (bias.energyTarget && track.energy !== null) {
        const dist = Math.abs(track.energy - bias.energyTarget.center);
        energyBandBonus =
          Math.max(0, 1 - dist / bias.energyTarget.bandwidth) * 0.08;
      }

      const acousticBonus = acousticContinuityBonus(track, intent);

      const rawScore =
        w.ES  * ES  +
        w.SA  * SA  +
        w.EM  * EM  +
        w.Era * Era +
        w.Act * Act +
        w.Nov * Nov;

      const laneScore = Math.max(0, Math.min(1.5,
        rawScore + genreBonus + intentGenreModifier + coreGenrePenalty + eraBonus + energyBandBonus + acousticBonus
      ));

      return {
        track,
        laneScore,
        signals: { ES, SA, EM, Era, Act, Nov, genreBonus: genreBonus + intentGenreModifier, eraBonus, energyBandBonus: energyBandBonus + acousticBonus, coreGenrePenalty },
        era,
        genrePrimary: genre,
      };
    })
    .sort((a, b) => b.laneScore - a.laneScore);
}
