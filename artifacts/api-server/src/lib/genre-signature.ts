/**
 * Stylistic anchors — country is acoustic + storytelling + twang, not just a label.
 */

import type { TrackGenreClassification } from "./genre-taxonomy";
import type { RootGenre } from "./genre-taxonomy";

export interface GenreSignature {
  acoustic: number;
  storytelling: number;
  twang: number;
  synth: number;
  rhythm: number;
  brightness: number;
  warmth: number;
}

export function computeGenreSignature(
  track: {
    energy: number | null;
    valence: number | null;
    acousticness: number | null;
    danceability: number | null;
    instrumentalness: number | null;
    speechiness: number | null;
    tempo: number | null;
  },
  classification: TrackGenreClassification
): GenreSignature {
  const a = track.acousticness ?? 0.5;
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  const d = track.danceability ?? 0.5;
  const inst = track.instrumentalness ?? 0.1;
  const sp = track.speechiness ?? 0.2;

  let acoustic = a;
  let storytelling = sp * 0.4 + (1 - d) * 0.25 + a * 0.2;
  let twang = 0;
  let synth = (1 - a) * (d * 0.5 + e * 0.3);
  let rhythm = d * 0.6 + sp * 0.4;
  let brightness = v * 0.5 + e * 0.35;
  const tempoNorm =
    track.tempo != null ? Math.max(0, Math.min(1, (track.tempo - 60) / 140)) : 0.5;
  let warmth = v * 0.4 + a * 0.35 + (1 - tempoNorm) * 0.1;

  switch (classification.genrePrimary) {
    case "country":
      twang = 0.75 + a * 0.2;
      storytelling = Math.max(storytelling, 0.7);
      acoustic = Math.max(acoustic, 0.55);
      synth *= 0.3;
      break;
    case "folk":
      acoustic = Math.max(acoustic, 0.65);
      storytelling = Math.max(storytelling, 0.65);
      twang = 0.35;
      break;
    case "christmas":
      warmth = Math.max(warmth, 0.6);
      brightness = Math.max(brightness, 0.55);
      synth = Math.max(synth, 0.35);
      break;
    case "electronic":
      synth = Math.max(synth, 0.75);
      acoustic *= 0.5;
      break;
    case "hip_hop":
      rhythm = Math.max(rhythm, 0.7);
      storytelling = Math.max(storytelling, 0.55);
      break;
    case "jazz":
      acoustic = Math.max(acoustic, 0.45);
      warmth = Math.max(warmth, 0.5);
      break;
    case "rock":
      brightness = Math.max(brightness, 0.45);
      break;
    default:
      break;
  }

  if (classification.holidayBound) warmth += 0.15;

  return clampSignature({ acoustic, storytelling, twang, synth, rhythm, brightness, warmth });
}

function clampSignature(s: GenreSignature): GenreSignature {
  const c = (n: number) => Math.max(0, Math.min(1, n));
  return {
    acoustic: c(s.acoustic),
    storytelling: c(s.storytelling),
    twang: c(s.twang),
    synth: c(s.synth),
    rhythm: c(s.rhythm),
    brightness: c(s.brightness),
    warmth: c(s.warmth),
  };
}

/** Dot-style affinity vs scene instrumentation bias */
export function signatureSceneAffinity(
  signature: GenreSignature,
  instrumentationBias: Partial<GenreSignature>
): number {
  const keys: (keyof GenreSignature)[] = ["acoustic", "storytelling", "twang", "synth", "rhythm", "brightness", "warmth"];
  let sum = 0;
  let n = 0;
  for (const k of keys) {
    const target = instrumentationBias[k];
    if (target == null) continue;
    sum += 1 - Math.abs(signature[k] - target);
    n++;
  }
  return n === 0 ? 0.5 : sum / n;
}

export function signatureMatchesGenres(
  signature: GenreSignature,
  roots: RootGenre[]
): number {
  if (roots.includes("country") || roots.includes("folk")) {
    return signature.acoustic * 0.35 + signature.storytelling * 0.35 + signature.twang * 0.3;
  }
  if (roots.includes("electronic")) return signature.synth * 0.6 + signature.rhythm * 0.4;
  if (roots.includes("hip_hop")) return signature.rhythm * 0.55 + signature.storytelling * 0.25;
  return 0.45;
}
