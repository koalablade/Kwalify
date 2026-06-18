/**
 * Playlist Coherence Audit — scores playlist-level unity and swap-repairs outliers.
 */

import type { LockedIntent } from "./v3/intent";
import type { SceneLockStatus } from "./scene-lock-mode";
import { sceneLockTrackAdjustment } from "./scene-lock-mode";
import { buildCoherentPlaylist } from "./playlist-coherence-engine";

export type CoherenceAuditTrack = {
  trackId: string;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  artistName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  score?: number;
};

export type CoherenceSwapRecord = {
  fromTrackId: string;
  toTrackId: string;
  reason: string;
  marginalGain: number;
};

export type PlaylistCoherenceAudit = {
  atmosphere: number;
  scene: number;
  energy: number;
  narrative: number;
  overallCoherence: number;
  reasons: string[];
  swaps: CoherenceSwapRecord[];
  repairApplied: boolean;
  beforeOverall: number;
  afterOverall: number;
};

/** Prompt 3 canonical score shape (diagnostics). */
export type PlaylistCoherenceScore = {
  atmosphereScore: number;
  sceneScore: number;
  energyScore: number;
  narrativeScore: number;
  overallScore: number;
  reasons: string[];
};

export const COHERENCE_REPAIR_THRESHOLD = 0.75;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function feature(track: CoherenceAuditTrack, key: "energy" | "valence" | "danceability" | "acousticness", fallback = 0.5): number {
  const value = track[key];
  return isNumber(value) ? clamp01(value) : fallback;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0.5;
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = average(values);
  return average(values.map((v) => Math.abs(v - mean)));
}

function scoreAtmosphere(tracks: CoherenceAuditTrack[], intent: LockedIntent): { score: number; reasons: string[] } {
  if (tracks.length === 0) return { score: 0, reasons: ["empty_playlist"] };
  const dance = tracks.map((t) => feature(t, "danceability"));
  const acoustic = tracks.map((t) => feature(t, "acousticness"));
  const valence = tracks.map((t) => feature(t, "valence"));
  const energy = tracks.map((t) => feature(t, "energy"));

  const danceSpread = variance(dance);
  const acousticMean = average(acoustic);
  const valenceMean = average(valence);
  const energyMean = average(energy);

  const introspective = intent.mood.some((m) => /melanchol|calm|introspect|sad|rain/i.test(m));
  const highEnergy = intent.energy === "high";

  let targetDance = 0.45;
  let targetAcoustic = 0.45;
  let targetValence = 0.5;
  let targetEnergy = 0.5;

  if (introspective) {
    targetDance = 0.32;
    targetAcoustic = 0.58;
    targetValence = 0.38;
    targetEnergy = 0.38;
  } else if (highEnergy) {
    targetDance = 0.68;
    targetAcoustic = 0.25;
    targetValence = 0.62;
    targetEnergy = 0.72;
  }

  const danceFit = clamp01(1 - danceSpread * 2.2);
  const acousticFit = clamp01(1 - Math.abs(acousticMean - targetAcoustic) * 1.6);
  const valenceFit = clamp01(1 - Math.abs(valenceMean - targetValence) * 1.8);
  const energyFit = clamp01(1 - Math.abs(energyMean - targetEnergy) * 1.6);
  const score = clamp01(danceFit * 0.28 + acousticFit * 0.24 + valenceFit * 0.24 + energyFit * 0.24);

  const reasons: string[] = [];
  if (danceSpread > 0.28) reasons.push("inconsistent_danceability");
  if (Math.abs(valenceMean - targetValence) > 0.22) reasons.push("valence_world_mismatch");
  if (Math.abs(energyMean - targetEnergy) > 0.24) reasons.push("energy_world_mismatch");

  return { score: round2(score), reasons };
}

function scoreSceneMembership(
  tracks: CoherenceAuditTrack[],
  expectedFamilies: string[],
): { score: number; reasons: string[] } {
  if (tracks.length === 0) return { score: 0, reasons: ["empty_playlist"] };
  if (expectedFamilies.length === 0) return { score: 0.72, reasons: [] };

  const expected = new Set(expectedFamilies.map((f) => f.toLowerCase()));
  let inFamily = 0;
  let known = 0;
  for (const track of tracks) {
    const family = track.genreFamily?.toLowerCase() ?? track.genrePrimary?.toLowerCase();
    if (!family || family === "unknown") continue;
    known++;
    if (expected.has(family)) inFamily++;
  }

  const ratio = known > 0 ? inFamily / known : 0.55;
  const score = round2(clamp01(0.35 + ratio * 0.65));
  const reasons = ratio < 0.62 ? ["scene_family_outliers"] : [];
  return { score, reasons };
}

function scoreEnergyCoherence(tracks: CoherenceAuditTrack[]): { score: number; reasons: string[] } {
  if (tracks.length <= 1) return { score: 0.7, reasons: [] };
  const energies = tracks.map((t) => feature(t, "energy"));
  const energyVariance = variance(energies);
  const transitionPenalties: number[] = [];
  for (let i = 1; i < tracks.length; i++) {
    const jump = Math.abs(energies[i]! - energies[i - 1]!);
    transitionPenalties.push(Math.max(0, jump - 0.28));
  }
  const consistency = clamp01(1 - energyVariance * 2.8);
  const smoothness = clamp01(1 - average(transitionPenalties) * 2.2);
  const score = round2(clamp01(consistency * 0.55 + smoothness * 0.45));
  const reasons: string[] = [];
  if (consistency < 0.55) reasons.push("energy_inconsistent");
  if (smoothness < 0.55) reasons.push("jumpy_energy_transitions");
  return { score, reasons };
}

function targetEnergyAt(position: number, total: number, intent: LockedIntent): number {
  if (intent.energy === "low") return 0.32;
  if (intent.energy === "high") return position < total * 0.72 ? 0.76 : 0.52;
  const progress = total <= 1 ? 0 : position / Math.max(1, total - 1);
  if (progress < 0.18) return 0.38;
  if (progress < 0.45) return 0.55;
  if (progress < 0.72) return 0.7;
  if (progress < 0.88) return 0.5;
  return 0.36;
}

function scoreNarrativeFlow(tracks: CoherenceAuditTrack[], intent: LockedIntent): { score: number; reasons: string[] } {
  if (tracks.length <= 2) return { score: 0.65, reasons: [] };
  const fits = tracks.map((track, index) => {
    if (!isNumber(track.energy)) return 0.6;
    const target = targetEnergyAt(index, tracks.length, intent);
    return clamp01(1 - Math.abs(track.energy - target) * 1.4);
  });
  const score = round2(average(fits));
  const reasons = score < 0.58 ? ["weak_narrative_arc"] : [];
  return { score, reasons };
}

export function auditPlaylistCoherence(
  tracks: CoherenceAuditTrack[],
  intent: LockedIntent,
  scenePrediction?: Record<string, number>,
): PlaylistCoherenceAudit {
  const expectedFamilies = [
    ...intent.genreFamilies,
    intent.primaryGenre,
    ...Object.entries(scenePrediction ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => key),
  ].filter((value): value is string => !!value);

  const atmosphere = scoreAtmosphere(tracks, intent);
  const scene = scoreSceneMembership(tracks, [...new Set(expectedFamilies)]);
  const energy = scoreEnergyCoherence(tracks);
  const narrative = scoreNarrativeFlow(tracks, intent);

  const overallCoherence = round2(clamp01(
    atmosphere.score * 0.30 +
    scene.score * 0.30 +
    energy.score * 0.22 +
    narrative.score * 0.18,
  ));

  const reasons = [...new Set([
    ...atmosphere.reasons,
    ...scene.reasons,
    ...energy.reasons,
    ...narrative.reasons,
  ])];

  return {
    atmosphere: atmosphere.score,
    scene: scene.score,
    energy: energy.score,
    narrative: narrative.score,
    overallCoherence,
    reasons,
    swaps: [],
    repairApplied: false,
    beforeOverall: overallCoherence,
    afterOverall: overallCoherence,
  };
}

export function toCoherenceScore(audit: Pick<PlaylistCoherenceAudit, "atmosphere" | "scene" | "energy" | "narrative" | "overallCoherence" | "reasons">): PlaylistCoherenceScore {
  return {
    atmosphereScore: audit.atmosphere,
    sceneScore: audit.scene,
    energyScore: audit.energy,
    narrativeScore: audit.narrative,
    overallScore: audit.overallCoherence,
    reasons: audit.reasons,
  };
}

export function scorePlaylistCoherence(
  tracks: CoherenceAuditTrack[],
  intent: LockedIntent,
  scenePrediction?: Record<string, number>,
): PlaylistCoherenceScore {
  return toCoherenceScore(auditPlaylistCoherence(tracks, intent, scenePrediction));
}

function trackMembershipScore(
  track: CoherenceAuditTrack,
  playlist: CoherenceAuditTrack[],
  intent: LockedIntent,
  expectedFamilies: Set<string>,
): number {
  const without = playlist.filter((t) => t.trackId !== track.trackId);
  const withTrack = auditPlaylistCoherence([...without, track], intent);
  const base = auditPlaylistCoherence(without, intent);
  return withTrack.overallCoherence - base.overallCoherence;
}

export function repairPlaylistCoherence<T extends CoherenceAuditTrack>(opts: {
  tracks: T[];
  candidates: T[];
  intent: LockedIntent;
  scenePrediction?: Record<string, number>;
  sceneLock?: SceneLockStatus | null;
  maxSwaps?: number;
  maxIterations?: number;
  minOverall?: number;
}): { tracks: T[]; audit: PlaylistCoherenceAudit } {
  const maxSwaps = opts.maxSwaps ?? 5;
  const maxIterations = opts.maxIterations ?? 1;
  const minOverall = opts.minOverall ?? COHERENCE_REPAIR_THRESHOLD;
  const sceneLock = opts.sceneLock ?? null;

  let working = [...opts.tracks];
  const usedIds = new Set(working.map((t) => t.trackId));
  const pool = opts.candidates.filter((c) => !usedIds.has(c.trackId));

  let audit = auditPlaylistCoherence(working, opts.intent, opts.scenePrediction);
  const beforeOverall = audit.overallCoherence;
  const swaps: CoherenceSwapRecord[] = [];

  if (audit.overallCoherence >= minOverall || working.length < 4 || pool.length === 0) {
    return { tracks: working, audit: { ...audit, beforeOverall, afterOverall: audit.overallCoherence } };
  }

  const expectedFamilies = new Set([
    ...opts.intent.genreFamilies,
    opts.intent.primaryGenre,
    ...Object.entries(opts.scenePrediction ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => key),
  ].filter((value): value is string => !!value));

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const marginal = working
      .map((track) => ({
        track,
        marginal: trackMembershipScore(track, working, opts.intent, expectedFamilies),
      }))
      .sort((a, b) => a.marginal - b.marginal);

    let improved = false;
    for (const candidate of marginal.slice(0, maxSwaps)) {
      if (candidate.marginal >= -0.02) break;

      let bestReplacement: { track: T; gain: number } | null = null;
      for (const replacement of pool) {
        if (usedIds.has(replacement.trackId)) continue;
        const trial = working.map((t) => (t.trackId === candidate.track.trackId ? replacement : t));
        const trialAudit = auditPlaylistCoherence(trial, opts.intent, opts.scenePrediction);
        const sceneAdj = sceneLock ? sceneLockTrackAdjustment(replacement, sceneLock) : 0;
        const gain = trialAudit.overallCoherence - audit.overallCoherence + sceneAdj;
        if (!bestReplacement || gain > bestReplacement.gain) {
          bestReplacement = { track: replacement, gain };
        }
      }

      if (!bestReplacement || bestReplacement.gain <= 0.015) continue;

      const fromId = candidate.track.trackId;
      const toId = bestReplacement.track.trackId;
      working = working.map((t) => (t.trackId === fromId ? bestReplacement!.track : t));
      usedIds.delete(fromId);
      usedIds.add(toId);
      pool.splice(pool.findIndex((t) => t.trackId === toId), 1);
      pool.push(candidate.track as T);

      swaps.push({
        fromTrackId: fromId,
        toTrackId: toId,
        reason: audit.reasons[0] ?? "coherence_outlier",
        marginalGain: round2(bestReplacement.gain),
      });
      audit = auditPlaylistCoherence(working, opts.intent, opts.scenePrediction);
      improved = true;
      if (audit.overallCoherence >= minOverall) break;
    }
    if (!improved || audit.overallCoherence >= minOverall) break;
  }

  const reordered = buildCoherentPlaylist(
    working.map((track) => ({
      trackId: track.trackId,
      energy: track.energy ?? null,
      valence: track.valence ?? null,
      tempo: track.tempo ?? null,
      danceability: track.danceability ?? null,
      acousticness: track.acousticness ?? null,
      artistName: track.artistName ?? null,
      genrePrimary: track.genrePrimary ?? null,
      score: track.score,
    })),
    opts.intent,
  ).reorderedTracks;
  const finalOrdered = reordered
    .map((track) => working.find((item) => item.trackId === track.trackId))
    .filter((track): track is T => !!track);
  const finalAudit = auditPlaylistCoherence(finalOrdered, opts.intent, opts.scenePrediction);

  return {
    tracks: finalOrdered.length === working.length ? finalOrdered : working,
    audit: {
      ...finalAudit,
      swaps,
      repairApplied: swaps.length > 0,
      beforeOverall,
      afterOverall: finalAudit.overallCoherence,
    },
  };
}

/** Prompt 4 — repair only when overall coherence is below threshold. */
export function repairPlaylistIfNeeded<T extends CoherenceAuditTrack>(opts: {
  tracks: T[];
  candidates: T[];
  intent: LockedIntent;
  coherenceScore: PlaylistCoherenceScore;
  scenePrediction?: Record<string, number>;
  sceneLock?: SceneLockStatus | null;
}): {
  tracks: T[];
  coherenceScore: PlaylistCoherenceScore;
  swapRepairActions: CoherenceSwapRecord[];
} {
  if (
    opts.coherenceScore.overallScore >= COHERENCE_REPAIR_THRESHOLD ||
    opts.tracks.length < 4 ||
    opts.candidates.length === 0
  ) {
    return {
      tracks: opts.tracks,
      coherenceScore: opts.coherenceScore,
      swapRepairActions: [],
    };
  }

  const repaired = repairPlaylistCoherence({
    tracks: opts.tracks,
    candidates: opts.candidates,
    intent: opts.intent,
    scenePrediction: opts.scenePrediction,
    sceneLock: opts.sceneLock,
    maxIterations: 1,
    maxSwaps: 5,
    minOverall: COHERENCE_REPAIR_THRESHOLD,
  });

  return {
    tracks: repaired.tracks,
    coherenceScore: toCoherenceScore(repaired.audit),
    swapRepairActions: repaired.audit.swaps,
  };
}
