/**
 * Skip risk indicators — proxy for skip-first-3 / early abandonment behaviour.
 */

import { computeHumanPlaylistFeatures } from "../../../core/editorial/human-playlist-patterns";
import type { PatternScoringTrack } from "../../../core/editorial/human-playlist-patterns";
import { resolveActivityProfile } from "../../../lib/activity-profiles";
import type { SkipRiskResult } from "./types";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function textureBucket(track: PatternScoringTrack): string {
  const acoustic = track.acousticness ?? 0.5;
  const dance = track.danceability ?? 0.5;
  if (acoustic >= 0.55) return "acoustic";
  if (dance >= 0.65) return "rhythmic";
  if (acoustic <= 0.25 && dance <= 0.45) return "dense";
  return "balanced";
}

function activityEnergyRisk(prompt: string, tracks: PatternScoringTrack[]): number {
  const profile = resolveActivityProfile(prompt, {});
  if (!profile) return 0;
  const opener = tracks[0]?.energy ?? 0.5;
  if (profile.id === "gym" && opener < 0.52) return 0.85;
  if (profile.id === "party_pregame" && opener < 0.58) return 0.75;
  if ((profile.id === "focus_coding" || profile.id === "study") && opener > 0.58) return 0.8;
  return 0;
}

function artistRepetitionRisk(tracks: PatternScoringTrack[]): number {
  const first3 = tracks.slice(0, 3);
  const artists = first3.map((t) => (t.artistName ?? "unknown").toLowerCase());
  const unique = new Set(artists);
  if (unique.size < artists.length) return 0.75;
  const features = computeHumanPlaylistFeatures(tracks.slice(0, Math.min(10, tracks.length)));
  if (features.maxArtistShare > 0.35) return clamp01(features.maxArtistShare);
  return 0;
}

function genreJumpRisk(tracks: PatternScoringTrack[]): number {
  const window = tracks.slice(0, Math.min(10, tracks.length));
  let shocks = 0;
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]!;
    const curr = window[i]!;
    const textureJump = textureBucket(prev) !== textureBucket(curr);
    const energyJump = Math.abs((curr.energy ?? 0.5) - (prev.energy ?? 0.5));
    if (textureJump && energyJump > 0.22) shocks += 1;
  }
  return clamp01(shocks / Math.max(1, window.length - 1));
}

function emotionalMismatchRisk(prompt: string, tracks: PatternScoringTrack[]): number {
  const lower = prompt.toLowerCase();
  const valences = tracks.slice(0, 5).map((t) => t.valence ?? 0.5);
  const meanValence = valences.reduce((a, b) => a + b, 0) / Math.max(1, valences.length);
  if (/\b(?:sad|melanchol|breakup|grief|rainy)\b/.test(lower) && meanValence > 0.72) return 0.65;
  if (/\b(?:happy|hype|party|gym|workout|boost)\b/.test(lower) && meanValence < 0.35) return 0.6;
  return 0;
}

export function evaluateSkipRisk(opts: {
  prompt: string;
  tracks: PatternScoringTrack[];
  weakOpenerScore?: number;
}): SkipRiskResult {
  const flags: string[] = [];
  if (opts.tracks.length < 3) {
    return { score: 1, firstThreeSkipRisk: 1, flags: ["insufficient_tracks"] };
  }

  const risks = [
    { key: "wrong_activity_energy", value: activityEnergyRisk(opts.prompt, opts.tracks) },
    { key: "unexpected_genre_jump", value: genreJumpRisk(opts.tracks) },
    { key: "artist_repetition", value: artistRepetitionRisk(opts.tracks) },
    { key: "emotional_mismatch", value: emotionalMismatchRisk(opts.prompt, opts.tracks) },
    { key: "weak_opener", value: (opts.weakOpenerScore ?? 0.5) < 0.45 ? 0.7 : 0 },
  ];

  for (const risk of risks) {
    if (risk.value >= 0.55) flags.push(risk.key);
  }

  const firstThree = opts.tracks.slice(0, 3);
  const firstThreeSkipRisk = clamp01(
    Math.max(
      activityEnergyRisk(opts.prompt, firstThree),
      artistRepetitionRisk(firstThree),
      genreJumpRisk(firstThree),
      (opts.weakOpenerScore ?? 0.5) < 0.4 ? 0.8 : 0,
    ),
  );

  const score = clamp01(
    risks.reduce((max, row) => Math.max(max, row.value), 0) * 0.55 +
    firstThreeSkipRisk * 0.45,
  );

  return {
    score: Math.round(score * 1000) / 1000,
    firstThreeSkipRisk: Math.round(firstThreeSkipRisk * 1000) / 1000,
    flags,
  };
}
