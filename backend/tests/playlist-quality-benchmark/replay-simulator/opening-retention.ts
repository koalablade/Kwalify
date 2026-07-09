/**
 * Opening retention — first-track fit, opening coherence, early energy, genre shock.
 */

import { humanPlausibilityScore } from "../../../core/editorial/human-playlist-patterns";
import type { PatternScoringTrack } from "../../../core/editorial/human-playlist-patterns";
import { resolveActivityProfile } from "../../../lib/activity-profiles";
import type { OpeningRetentionResult } from "./types";

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

function targetEnergyForPrompt(prompt: string): number | null {
  const profile = resolveActivityProfile(prompt, {});
  if (!profile) return null;
  if (profile.id === "gym") return 0.72;
  if (profile.id === "party_pregame") return 0.68;
  if (profile.id === "focus_coding" || profile.id === "study") return 0.38;
  return null;
}

export function evaluateOpeningRetention(opts: {
  prompt: string;
  tracks: PatternScoringTrack[];
}): OpeningRetentionResult {
  const flags: string[] = [];
  if (opts.tracks.length < 3) {
    return {
      score: 0,
      firstTrackFit: 0,
      firstFiveCoherence: 0,
      earlyEnergyMismatch: 1,
      genreShock: 1,
      flags: ["insufficient_tracks"],
    };
  }

  const opening5 = opts.tracks.slice(0, Math.min(5, opts.tracks.length));
  const opener = opening5[0]!;
  const openerEnergy = opener.energy ?? 0.5;

  const targetEnergy = targetEnergyForPrompt(opts.prompt);
  let firstTrackFit = 0.75;
  if (targetEnergy != null) {
    const delta = Math.abs(openerEnergy - targetEnergy);
    firstTrackFit = clamp01(1 - delta * 1.6);
    if (delta > 0.22) flags.push("wrong_activity_energy_opener");
  } else {
    firstTrackFit = clamp01(humanPlausibilityScore([opener]) * 0.9 + 0.1);
  }

  const firstFiveCoherence = humanPlausibilityScore(opening5);
  if (firstFiveCoherence < 0.45) flags.push("weak_opening_coherence");

  const earlyMean = opening5.slice(1).reduce((s, t) => s + (t.energy ?? 0.5), 0) / Math.max(1, opening5.length - 1);
  const earlyEnergyMismatch = clamp01(Math.abs(openerEnergy - earlyMean) * 1.4);
  if (earlyEnergyMismatch > 0.35) flags.push("early_energy_mismatch");

  let genreShock = 0;
  for (let i = 1; i < opening5.length; i++) {
    const prev = opening5[i - 1]!;
    const curr = opening5[i]!;
    const textureJump = textureBucket(prev) !== textureBucket(curr);
    const energyJump = Math.abs((curr.energy ?? 0.5) - (prev.energy ?? 0.5));
    if (textureJump && energyJump > 0.25) genreShock += 0.25;
    else if (textureJump) genreShock += 0.12;
  }
  genreShock = clamp01(genreShock);
  if (genreShock > 0.4) flags.push("genre_shock_opening");

  const score = clamp01(
    firstTrackFit * 0.35 +
    firstFiveCoherence * 0.35 +
    (1 - earlyEnergyMismatch) * 0.15 +
    (1 - genreShock) * 0.15,
  );

  if (firstTrackFit < 0.45) flags.push("weak_opener");

  return {
    score: Math.round(score * 1000) / 1000,
    firstTrackFit: Math.round(firstTrackFit * 1000) / 1000,
    firstFiveCoherence: Math.round(firstFiveCoherence * 1000) / 1000,
    earlyEnergyMismatch: Math.round(earlyEnergyMismatch * 1000) / 1000,
    genreShock: Math.round(genreShock * 1000) / 1000,
    flags,
  };
}
