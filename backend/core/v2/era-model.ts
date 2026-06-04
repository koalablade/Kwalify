/**
 * V2 Era Model — era detection and audio characteristic profiles by decade.
 *
 * Each era has distinctive audio fingerprint characteristics.
 * These drive: Context score, bucket grouping, sequencing.
 */

import type { EraBucket } from "../../lib/intent-parser";

// ─── Era audio profiles ──────────────────────────────────────────────────────

/**
 * Audio characteristic profiles per era.
 * Used to compute era match when the track has release year data,
 * and as fallback hints when classifying by audio features alone.
 */
export const ERA_AUDIO_PROFILES: Record<EraBucket, {
  energyCenter: number;
  valenceCenter: number;
  acousticnessCenter: number;
  tempoCenter: number;
  description: string;
}> = {
  "60s": {
    energyCenter: 0.52,
    valenceCenter: 0.70,
    acousticnessCenter: 0.65,
    tempoCenter: 118,
    description: "Warm, vocal-led, moderate energy, high valence",
  },
  "70s": {
    energyCenter: 0.55,
    valenceCenter: 0.60,
    acousticnessCenter: 0.50,
    tempoCenter: 115,
    description: "Analog warmth, disco / rock split, mid energy",
  },
  "80s": {
    energyCenter: 0.62,
    valenceCenter: 0.55,
    acousticnessCenter: 0.20,
    tempoCenter: 124,
    description: "Synth-heavy, new wave, compressed reverb, mid-high energy",
  },
  "90s": {
    energyCenter: 0.65,
    valenceCenter: 0.50,
    acousticnessCenter: 0.30,
    tempoCenter: 122,
    description: "Guitar-heavy / acoustic split, mid energy, diverse valence",
  },
  "00s": {
    energyCenter: 0.68,
    valenceCenter: 0.58,
    acousticnessCenter: 0.22,
    tempoCenter: 126,
    description: "Compressed pop / post-grunge, high energy mastering",
  },
  "10s": {
    energyCenter: 0.72,
    valenceCenter: 0.52,
    acousticnessCenter: 0.15,
    tempoCenter: 128,
    description: "EDM / trap / loud mastering, high BPM, low acousticness",
  },
  "20s": {
    energyCenter: 0.60,
    valenceCenter: 0.55,
    acousticnessCenter: 0.28,
    tempoCenter: 120,
    description: "Hybrid / algorithmic / genre-blended, diverse across all dims",
  },
  "any": {
    energyCenter: 0.55,
    valenceCenter: 0.55,
    acousticnessCenter: 0.35,
    tempoCenter: 120,
    description: "Genre-neutral fallback centroid",
  },
};

// ─── Era detection from release year ─────────────────────────────────────────

/**
 * Classify a track's era from its release year.
 * Returns "any" when unknown.
 */
export function detectEraFromYear(releaseYear: number | null | undefined): EraBucket {
  if (!releaseYear) return "any";
  if (releaseYear < 1970) return "60s";
  if (releaseYear < 1980) return "70s";
  if (releaseYear < 1990) return "80s";
  if (releaseYear < 2000) return "90s";
  if (releaseYear < 2010) return "00s";
  if (releaseYear < 2020) return "10s";
  return "20s";
}

/**
 * Estimate a track's probable era from audio features alone.
 * Uses a nearest-centroid classifier over the era audio profiles.
 *
 * Used when no release year is available.
 */
export function estimateEraFromAudio(track: {
  energy: number | null;
  acousticness: number | null;
  tempo: number | null;
}): EraBucket {
  const e = track.energy ?? 0.55;
  const a = track.acousticness ?? 0.35;
  const t = (track.tempo ?? 120) / 200; // normalize

  let bestEra: EraBucket = "any";
  let bestDist = Infinity;

  for (const [era, profile] of Object.entries(ERA_AUDIO_PROFILES) as [EraBucket, typeof ERA_AUDIO_PROFILES[EraBucket]][]) {
    if (era === "any") continue;
    const dist =
      Math.pow(e - profile.energyCenter, 2) +
      Math.pow(a - profile.acousticnessCenter, 2) +
      Math.pow(t - profile.tempoCenter / 200, 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestEra = era;
    }
  }

  return bestEra;
}

// ─── Era match scoring ────────────────────────────────────────────────────────

/**
 * Compute how well a track's era matches the intent era.
 * Returns 0–1 where 1 = perfect match.
 *
 * Graded adjacency: adjacent decades score 0.6, two-apart score 0.3.
 * "any" intent = 0.7 neutral (no penalty, no boost).
 */
const ERA_ORDER: EraBucket[] = ["60s", "70s", "80s", "90s", "00s", "10s", "20s"];

export function computeEraMatch(trackEra: EraBucket, intentEra: EraBucket): number {
  if (intentEra === "any") return 0.70;
  if (trackEra === "any") return 0.65;
  if (trackEra === intentEra) return 1.0;

  const trackIdx = ERA_ORDER.indexOf(trackEra);
  const intentIdx = ERA_ORDER.indexOf(intentEra);

  if (trackIdx === -1 || intentIdx === -1) return 0.50;

  const delta = Math.abs(trackIdx - intentIdx);
  if (delta === 1) return 0.65; // adjacent decade
  if (delta === 2) return 0.35; // two decades apart
  return 0.15;                   // far from intent era
}
