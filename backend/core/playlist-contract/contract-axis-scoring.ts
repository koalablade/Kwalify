/**
 * V41 — Generic contract dimension scoring from track features (not prompt regexes).
 * V46 — Semantic moment evidence blended with audio features for compound axes.
 */

import type { ContractAuthoritativeTrack } from "./contract-authoritative-retrieval";
import type { ContractTension, PlaylistContract } from "./types";
import { scoreTrackAgainstContract } from "./constraint-aware-retrieval";
import {
  blendAxisWithSemanticMoment,
  buildTrackSemanticProfileForContract,
  compoundEmotionalBangerAntiPatternPenalty,
  compoundIntersectionStrength,
  contrastiveNegationPenalty,
  isEmotionalBangerAudioProfile,
  scoreSemanticAxisEvidence,
  scoreUnwantedPoleForAxis,
} from "./contract-semantic-moment";
import type { TrackSemanticProfile } from "../../lib/track-semantic-types";

export const CONTRACT_AXIS_ACTIVATION_THRESHOLD = 0.42;
const ACTIVATION_THRESHOLD = CONTRACT_AXIS_ACTIVATION_THRESHOLD;

function trackTextForAxis(
  track: ContractAuthoritativeTrack,
  classification: { genreFamily?: string | null; genrePrimary?: string | null } | null,
): string {
  return [
    track.trackName,
    track.artistName,
    classification?.genreFamily ?? track.genreFamily,
    classification?.genrePrimary,
    ...(track.genres ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** V44/V45 — semantic spam/novelty penalty from track text (not audio alone). */
export function semanticSpamPenalty(text: string): number {
  if (/\bcheesy|cheesey|novelty|eurovision|kidz bop|gummy bear|party all the time\b/.test(text)) {
    return 0.55;
  }
  if (/\bstorm\s+queen\b|\blook right through\b.*\b(?:edit|vip|mix)\b/.test(text)) {
    return 0.42;
  }
  if (/\bsped up|slowed \+ reverb|phonk|stutter techno|tiktok|vip mix|club mix|\bvip\b|on sp33d|sp33d|\btechno\b.*\bremix\b/.test(text)) {
    return 0.38;
  }
  return 0;
}

function cheesySemanticPenalty(text: string): number {
  return semanticSpamPenalty(text);
}

/** Score a named contract dimension using audio + semantic profile + classification. */
export function scoreContractDimension(
  track: ContractAuthoritativeTrack,
  dimensionId: string,
  classification: { genreFamily?: string | null; genrePrimary?: string | null } | null,
  semanticProfile?: TrackSemanticProfile | null,
): number {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const dance = track.danceability ?? energy;
  const family = (classification?.genreFamily ?? track.genreFamily ?? "").toLowerCase();
  const primary = (classification?.genrePrimary ?? "").toLowerCase();
  const text = trackTextForAxis(track, classification);

  if (dimensionId.startsWith("must:")) {
    const token = dimensionId.slice(5).replace(/_/g, " ");
    if (family.includes(token.replace(/ /g, "")) || primary.includes(token.replace(/ /g, ""))) return 0.85;
    return 0.15;
  }
  if (dimensionId.startsWith("prefer:mood:")) {
    const mood = dimensionId.slice(12);
    if (/sad|melanchol|heartbreak/.test(mood)) return valence < 0.45 ? 0.7 + (0.45 - valence) * 0.5 : 0.2;
    if (/warm|cozy|tender/.test(mood)) {
      return valence >= 0.35 && valence <= 0.72 && energy >= 0.32 && energy <= 0.68 ? 0.72 : 0.32;
    }
    if (/nostalgic|retro|throwback/.test(mood)) {
      return valence <= 0.65 && energy >= 0.38 && energy <= 0.82 ? 0.68 : 0.3;
    }
    if (/chill|calm|relaxed/.test(mood)) return energy < 0.5 ? 0.65 : 0.25;
    if (/happy|feel.?good|uplift/.test(mood)) return valence > 0.55 && energy > 0.45 ? 0.7 : 0.25;
    return 0.4;
  }
  if (dimensionId.startsWith("prefer:energy:")) {
    const band = dimensionId.slice(15);
    if (band === "high") return energy > 0.68 ? 0.75 : energy > 0.55 ? 0.4 : 0.15;
    if (band === "low") return energy < 0.45 ? 0.7 : 0.2;
    return energy > 0.45 && energy < 0.72 ? 0.6 : 0.3;
  }

  let audioScore = 0.35;
  switch (dimensionId) {
    case "melancholy": {
      if (valence >= 0.55) {
        audioScore = valence < 0.65 ? 0.15 : 0.1;
        break;
      }
      const spamPenalty = semanticSpamPenalty(text);
      // High-energy club/drill production is not emotional melancholy.
      if (
        (energy > 0.78 && valence > 0.28 && valence < 0.48) ||
        (energy > 0.74 && spamPenalty > 0)
      ) {
        audioScore = Math.max(0.08, 0.2 - spamPenalty * 0.55);
        break;
      }
      const emotionalBase = valence < 0.42 ? 0.55 + (0.42 - valence) : 0.35;
      const emotionalBanger = isEmotionalBangerAudioProfile(energy, valence, dance);
      const energyDampen = emotionalBanger
        ? (energy > 0.84 ? Math.min(0.1, (energy - 0.84) * 0.4) : 0)
        : energy > 0.72
          ? Math.min(0.45, (energy - 0.72) * 1.35)
          : 0;
      audioScore = Math.max(0.08, emotionalBase - energyDampen - spamPenalty * 0.62);
      if (emotionalBanger && !spamPenalty) audioScore = Math.min(0.82, audioScore + 0.08);
      break;
    }
    case "party_energy": {
      const emotionalBanger = isEmotionalBangerAudioProfile(energy, valence, dance);
      if (energy > 0.72) audioScore = 0.58 + Math.min(0.35, (energy - 0.72) * 1.2);
      else if (energy > 0.68 && dance > 0.5) audioScore = 0.48 + Math.min(0.4, (energy - 0.68) * 1.2);
      else if (energy > 0.62 && dance > 0.55) audioScore = 0.35 + (energy - 0.62) * 0.4;
      else if (emotionalBanger && energy > 0.58 && dance > 0.46) {
        audioScore = 0.38 + (energy - 0.58) * 0.55 + (dance - 0.46) * 0.35;
      } else audioScore = energy > 0.55 ? 0.22 : 0.08;
      break;
    }
    case "high_energy":
      audioScore = energy > 0.68 ? 0.55 + Math.min(0.45, (energy - 0.68) * 1.5) : energy > 0.55 ? 0.28 : 0.1;
      break;
    case "not_cheesy": {
      const featureBase =
        energy > 0.5 && valence > 0.35 && valence < 0.85 ? 0.52 : energy > 0.45 ? 0.28 : 0.14;
      const genreCredibility =
        /indie|alternative|rock|electronic|hip_hop|soul|punk|metal/.test(family) ||
        /indie|alternative|rock|electronic|hip_hop|soul|punk|metal/.test(primary)
          ? 0.14
          : 0;
      audioScore = Math.max(0.08, Math.min(0.88, featureBase + genreCredibility - cheesySemanticPenalty(text)));
      break;
    }
    case "low_energy":
      audioScore = energy < 0.48 ? 0.55 + (0.48 - energy) : energy < 0.58 ? 0.3 : 0.12;
      break;
    case "not_boring": {
      const interest = Math.max(energy, dance * 0.92, valence * 0.78);
      if (interest < 0.34) audioScore = 0.1;
      else {
        const titleInterest = /\blive\b|\bacoustic\b|\bremix\b/.test(text) ? 0.08 : 0;
        audioScore = Math.min(0.82, 0.28 + interest * 0.48 + titleInterest);
      }
      break;
    }
    default:
      audioScore = 0.35;
  }

  const profile =
    semanticProfile ??
    buildTrackSemanticProfileForContract(track, classification);
  const semanticScore = scoreSemanticAxisEvidence(profile, dimensionId);
  const unwantedPole = scoreUnwantedPoleForAxis(profile, dimensionId);
  let blended = blendAxisWithSemanticMoment(audioScore, semanticScore, dimensionId, unwantedPole);

  for (const neg of ["cheesy", "boring"]) {
    if (dimensionId === `not_${neg}`) {
      const penalty = contrastiveNegationPenalty(profile, text, neg);
      blended = Math.max(0.06, blended - penalty * 0.35);
    }
  }

  return blended;
}

export function buildContractCompositionMeta(
  track: ContractAuthoritativeTrack,
  contract: PlaylistContract,
  classification: { genreFamily?: string | null; genrePrimary?: string | null } | null,
): import("./contract-composition-types").ContractCompositionMeta {
  const scored = scoreTrackAgainstContract(track, contract);
  const axisScores: Record<string, number> = {};
  const dims = new Set<string>();
  for (const t of contract.tension) {
    if (t.resolution === "preserve_both") {
      dims.add(t.axes[0]);
      dims.add(t.axes[1]);
    }
  }
  for (const g of contract.must.genres) {
    if (g.confidence >= 0.55) dims.add(`must:${g.value}`);
  }
  for (const e of contract.prefer.energy) dims.add(`prefer:energy:${e.value}`);
  for (const m of contract.prefer.moods) dims.add(`prefer:mood:${m.value}`);

  const semanticProfile = buildTrackSemanticProfileForContract(track, classification);

  for (const dim of dims) {
    axisScores[dim] = scoreContractDimension(track, dim, classification, semanticProfile);
  }

  const preserveBoth = contract.tension.filter((t) => t.resolution === "preserve_both");
  let intersectionStrength = 0;
  const emotionalBanger = isEmotionalBangerAudioProfile(
    track.energy ?? 0.5,
    track.valence ?? 0.5,
    track.danceability ?? track.energy ?? 0.5,
  );
  for (const t of preserveBoth) {
    const a = axisScores[t.axes[0]] ?? scoreContractDimension(track, t.axes[0], classification, semanticProfile);
    const b = axisScores[t.axes[1]] ?? scoreContractDimension(track, t.axes[1], classification, semanticProfile);
    axisScores[t.axes[0]] = a;
    axisScores[t.axes[1]] = b;
    intersectionStrength = Math.max(
      intersectionStrength,
      compoundIntersectionStrength(a, b, { emotionalBanger }),
    );
  }

  const antiPattern = compoundEmotionalBangerAntiPatternPenalty(track, contract);
  if (antiPattern > 0) {
    intersectionStrength = Math.max(0, intersectionStrength - antiPattern);
    for (const key of ["melancholy", "party_energy"]) {
      if (axisScores[key] != null) {
        axisScores[key] = Math.max(0.06, axisScores[key]! - antiPattern * 0.35);
      }
    }
  }

  const axesActive = Object.entries(axisScores)
    .filter(([, v]) => v >= ACTIVATION_THRESHOLD)
    .map(([k]) => k);

  return {
    contractScore: scored.score,
    admissible: scored.admissible,
    axisScores,
    axesActive,
    intersectionStrength,
    mustMatches: scored.satisfies.filter((s) => s.startsWith("MUST")),
    preferMatches: scored.satisfies.filter((s) => s.startsWith("PREFER")),
    violations: scored.violations,
  };
}

export function intersectionThreshold(_tension: ContractTension): number {
  return 0.32;
}
