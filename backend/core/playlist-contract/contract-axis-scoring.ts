/**
 * V41 — Generic contract dimension scoring from track features (not prompt regexes).
 */

import type { ContractAuthoritativeTrack } from "./contract-authoritative-retrieval";
import type { ContractTension, PlaylistContract } from "./types";
import { scoreTrackAgainstContract } from "./constraint-aware-retrieval";

const ACTIVATION_THRESHOLD = 0.42;

/** Score a named contract dimension using audio + classification, not title tokens alone. */
export function scoreContractDimension(
  track: ContractAuthoritativeTrack,
  dimensionId: string,
  classification: { genreFamily?: string | null; genrePrimary?: string | null } | null,
): number {
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const dance = track.danceability ?? energy;
  const family = (classification?.genreFamily ?? track.genreFamily ?? "").toLowerCase();
  const primary = (classification?.genrePrimary ?? "").toLowerCase();

  if (dimensionId.startsWith("must:")) {
    const token = dimensionId.slice(5).replace(/_/g, " ");
    if (family.includes(token.replace(/ /g, "")) || primary.includes(token.replace(/ /g, ""))) return 0.85;
    return 0.15;
  }
  if (dimensionId.startsWith("prefer:mood:")) {
    const mood = dimensionId.slice(12);
    if (/sad|melanchol|heartbreak/.test(mood)) return valence < 0.45 ? 0.7 + (0.45 - valence) * 0.5 : 0.2;
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

  switch (dimensionId) {
    case "melancholy":
      return valence < 0.42 ? 0.55 + (0.42 - valence) : valence < 0.55 ? 0.35 : 0.1;
    case "party_energy":
      return energy > 0.68 && dance > 0.55 ? 0.5 + Math.min(0.45, (energy - 0.68) * 1.2) : energy > 0.55 ? 0.25 : 0.08;
    case "high_energy":
      return energy > 0.72 ? 0.55 + (energy - 0.72) : energy > 0.58 ? 0.3 : 0.1;
    case "not_cheesy":
      return energy > 0.5 && valence > 0.35 && valence < 0.85 ? 0.65 : 0.25;
    case "low_energy":
      return energy < 0.48 ? 0.55 + (0.48 - energy) : energy < 0.58 ? 0.3 : 0.12;
    case "not_boring":
      return energy > 0.38 || valence > 0.42 || dance > 0.45 ? 0.55 : 0.15;
    default:
      return 0.35;
  }
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

  for (const dim of dims) {
    axisScores[dim] = scoreContractDimension(track, dim, classification);
  }

  const preserveBoth = contract.tension.filter((t) => t.resolution === "preserve_both");
  let intersectionStrength = 0;
  for (const t of preserveBoth) {
    const a = axisScores[t.axes[0]] ?? scoreContractDimension(track, t.axes[0], classification);
    const b = axisScores[t.axes[1]] ?? scoreContractDimension(track, t.axes[1], classification);
    axisScores[t.axes[0]] = a;
    axisScores[t.axes[1]] = b;
    intersectionStrength = Math.max(intersectionStrength, Math.sqrt(a * b));
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
