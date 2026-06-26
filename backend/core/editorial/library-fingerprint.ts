/**
 * Library fingerprint — biases editorial structures toward the user's taste
 * without widening genre-family filters.
 */

import { classifyTrack } from "../../lib/genre-taxonomy";
import type { IntentCollapseTrack } from "./intent-collapse-layer";

export type LibraryFingerprint = {
  dominantFamilies: Array<{ family: string; share: number }>;
  medianEnergy: number;
  medianValence: number;
  discoveryAffinity: number;
  artistDiversity: number;
  trackCount: number;
};

type FingerprintRow = IntentCollapseTrack & {
  trackName?: string;
  artistName?: string | null;
  albumName?: string;
  popularity?: number | null;
  rediscoveryScore?: number | null;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function computeLibraryFingerprint(
  tracks: FingerprintRow[],
  classMap?: Map<string, { genreFamily?: string; genrePrimary?: string }>,
): LibraryFingerprint {
  if (tracks.length === 0) {
    return {
      dominantFamilies: [],
      medianEnergy: 0.5,
      medianValence: 0.5,
      discoveryAffinity: 0.3,
      artistDiversity: 0.5,
      trackCount: 0,
    };
  }

  const familyCounts = new Map<string, number>();
  const artists = new Set<string>();
  const energies: number[] = [];
  const valences: number[] = [];
  const discoverySignals: number[] = [];

  const sampleStep = Math.max(1, Math.floor(tracks.length / 1200));
  for (let i = 0; i < tracks.length; i += sampleStep) {
    const track = tracks[i]!;
    const classification = classMap?.get(track.trackId);
    let family = track.genreFamily ?? classification?.genreFamily ?? null;
    if (!family && track.trackName && track.artistName) {
      family = classifyTrack({
        trackName: track.trackName,
        artistName: track.artistName,
        albumName: track.albumName ?? "",
        energy: track.energy,
        valence: track.valence,
        acousticness: track.acousticness,
        danceability: track.danceability,
        tempo: track.tempo,
      }).genreFamily;
    }
    if (family && family !== "unknown") {
      familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    }
    if (track.artistName) artists.add(track.artistName.toLowerCase());
    if (typeof track.energy === "number") energies.push(track.energy);
    if (typeof track.valence === "number") valences.push(track.valence);
    if (typeof track.rediscoveryScore === "number") {
      discoverySignals.push(track.rediscoveryScore);
    } else if (typeof track.popularity === "number") {
      discoverySignals.push(clamp01(1 - track.popularity / 100));
    }
  }

  const totalFamilies = [...familyCounts.values()].reduce((s, v) => s + v, 0) || 1;
  const dominantFamilies = [...familyCounts.entries()]
    .map(([family, count]) => ({ family, share: count / totalFamilies }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 6);

  return {
    dominantFamilies,
    medianEnergy: median(energies),
    medianValence: median(valences),
    discoveryAffinity: discoverySignals.length > 0 ? median(discoverySignals) : 0.3,
    artistDiversity: clamp01(artists.size / Math.max(1, tracks.length / 3)),
    trackCount: tracks.length,
  };
}

export function fingerprintBiasForTrack(
  track: IntentCollapseTrack,
  fingerprint: LibraryFingerprint,
): number {
  if (fingerprint.dominantFamilies.length === 0) return 0.5;

  const family = (track.genreFamily ?? "unknown").toLowerCase();
  const familyRow = fingerprint.dominantFamilies.find((row) => row.family === family);
  let score = familyRow ? clamp01(0.45 + familyRow.share * 0.55) : 0.38;

  if (typeof track.energy === "number") {
    score = clamp01(score * 0.7 + (1 - Math.abs(track.energy - fingerprint.medianEnergy)) * 0.3);
  }
  if (typeof track.valence === "number") {
    score = clamp01(score * 0.85 + (1 - Math.abs(track.valence - fingerprint.medianValence)) * 0.15);
  }

  return score;
}

export function buildFingerprintBiasMap(
  tracks: IntentCollapseTrack[],
  fingerprint: LibraryFingerprint,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const track of tracks) {
    map.set(track.trackId, fingerprintBiasForTrack(track, fingerprint));
  }
  return map;
}

export function biasEnergyRangeForFingerprint(
  energyRange: [number, number],
  fingerprint: LibraryFingerprint,
): [number, number] {
  const [lo, hi] = energyRange;
  const target = fingerprint.medianEnergy;
  const mid = (lo + hi) / 2;
  const shift = (target - mid) * 0.35;
  return [clamp01(lo + shift), clamp01(hi + shift)];
}
