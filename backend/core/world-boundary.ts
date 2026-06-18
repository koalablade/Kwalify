/**
 * World boundary enforcement — hard scene cluster lock before retrieval completes,
 * pre-coherence candidate filtering, and constraint-driven playlist construction.
 */

import type { SceneLockStatus } from "./scene-lock-mode";
import type { LockedIntent } from "./v3/intent";
import {
  auditPlaylistCoherence,
  scorePlaylistCoherence,
  type CoherenceAuditTrack,
  type PlaylistCoherenceScore,
} from "./playlist-coherence-audit";

export type WorldBoundary = {
  active: boolean;
  hardLock: boolean;
  dominantScene: string | null;
  allowedGenreFamilies: string[];
  offSceneGenreFamilies: string[];
  scenePrediction: Record<string, number>;
  reason: string | null;
};

export type WorldBoundaryDiagnostics = {
  inputCount: number;
  keptCount: number;
  rejectedCount: number;
  rejectedOffScene: number;
  rejectedDrift: number;
  hardLock: boolean;
  dominantScene: string | null;
};

export type WorldCandidateFit = {
  sceneMatch: number;
  atmosphereMatch: number;
  worldDriftRisk: number;
  total: number;
};

const POP_CROSSOVER_FAMILIES = new Set(["pop", "hip_hop", "rap", "trap", "dance", "house", "edm"]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeFamily(value?: string | null): string | null {
  if (!value || value === "unknown") return null;
  return value.toLowerCase().trim().replace(/[\s-]+/g, "_");
}

export function resolveWorldBoundary(opts: {
  sceneLock?: SceneLockStatus | null;
  sceneAliases?: string[];
  scenePrediction?: Record<string, number>;
}): WorldBoundary {
  const sceneLock = opts.sceneLock ?? null;
  const sceneAliases = opts.sceneAliases ?? [];
  const scenePrediction = opts.scenePrediction ?? {};
  const predictionEntries = Object.entries(scenePrediction).sort((a, b) => b[1] - a[1]);
  const dominantScene = predictionEntries[0]?.[0] ?? sceneAliases[0] ?? null;

  if (sceneLock?.active) {
    const allowed = [...new Set([
      ...sceneLock.allowedGenreFamilies,
      ...sceneAliases.slice(0, 4),
    ])].map((f) => normalizeFamily(f)).filter((f): f is string => !!f);
    const offScene = [...new Set(sceneLock.offSceneGenreFamilies)]
      .map((f) => normalizeFamily(f))
      .filter((f): f is string => !!f && !allowed.includes(f));

    return {
      active: true,
      hardLock: true,
      dominantScene,
      allowedGenreFamilies: allowed,
      offSceneGenreFamilies: offScene,
      scenePrediction,
      reason: sceneLock.reason,
    };
  }

  if (sceneAliases.length >= 2 && predictionEntries[0]?.[1] != null && predictionEntries[0][1] >= 0.22) {
    const allowed = [...new Set(sceneAliases.slice(0, 5))]
      .map((f) => normalizeFamily(f))
      .filter((f): f is string => !!f);
    const offScene = POP_CROSSOVER_FAMILIES.has(allowed[0] ?? "")
      ? []
      : [...POP_CROSSOVER_FAMILIES].filter((f) => !allowed.includes(f));

    return {
      active: true,
      hardLock: predictionEntries[0][1] >= 0.30,
      dominantScene,
      allowedGenreFamilies: allowed,
      offSceneGenreFamilies: offScene,
      scenePrediction,
      reason: "scene_prediction_dominance",
    };
  }

  return {
    active: false,
    hardLock: false,
    dominantScene: null,
    allowedGenreFamilies: [],
    offSceneGenreFamilies: [],
    scenePrediction,
    reason: null,
  };
}

export function trackGenreFamilyForBoundary(
  track: { trackId: string; genreFamily?: string | null; genrePrimary?: string | null },
  classMap?: Map<string, { genreFamily?: string; genrePrimary?: string }>,
): string | null {
  const fromTrack = normalizeFamily(track.genreFamily ?? track.genrePrimary);
  if (fromTrack) return fromTrack;
  const classified = classMap?.get(track.trackId);
  return normalizeFamily(classified?.genreFamily ?? classified?.genrePrimary ?? null);
}

export function isTrackInWorld(
  track: { trackId: string; genreFamily?: string | null; genrePrimary?: string | null; danceability?: number | null },
  world: WorldBoundary,
  genreFamily?: string | null,
): boolean {
  if (!world.active) return true;

  const family = normalizeFamily(genreFamily ?? track.genreFamily ?? track.genrePrimary);
  if (!family) return !world.hardLock;

  if (world.offSceneGenreFamilies.includes(family)) return false;
  if (world.allowedGenreFamilies.includes(family)) return true;

  if (world.hardLock) {
    if (POP_CROSSOVER_FAMILIES.has(family)) return false;
    if (family === "electronic" && world.allowedGenreFamilies.every((f) => !["electronic", "synth", "ambient"].includes(f))) {
      return false;
    }
    return false;
  }

  return true;
}

export function scoreWorldCandidateFit(
  track: CoherenceAuditTrack,
  world: WorldBoundary,
  intent?: LockedIntent,
): WorldCandidateFit {
  const family = normalizeFamily(track.genreFamily ?? track.genrePrimary);
  let sceneMatch = 0.35;
  if (family && world.allowedGenreFamilies.includes(family)) {
    const rank = world.allowedGenreFamilies.indexOf(family);
    sceneMatch = clamp01(0.92 - rank * 0.08);
  } else if (family && world.offSceneGenreFamilies.includes(family)) {
    sceneMatch = 0.05;
  } else if (!family) {
    sceneMatch = 0.4;
  } else {
    sceneMatch = 0.22;
  }

  let atmosphereMatch = 0.55;
  if (intent) {
    const energy = typeof track.energy === "number" ? track.energy : 0.5;
    const valence = typeof track.valence === "number" ? track.valence : 0.5;
    const dance = typeof track.danceability === "number" ? track.danceability : 0.5;
    const introspective = intent.mood.some((m) => /melanchol|calm|rain|sad|night/i.test(m));
    const highEnergy = intent.energy === "high";
    if (introspective) {
      atmosphereMatch = clamp01(1 - Math.abs(energy - 0.42) * 1.4 - Math.abs(dance - 0.35) * 1.1);
    } else if (highEnergy) {
      atmosphereMatch = clamp01(1 - Math.abs(energy - 0.72) * 1.2);
    } else {
      atmosphereMatch = clamp01(1 - Math.abs(valence - 0.48) * 0.9 - Math.abs(dance - 0.45) * 0.7);
    }
  }

  let worldDriftRisk = 0.2;
  if (family && world.offSceneGenreFamilies.includes(family)) worldDriftRisk = 0.95;
  else if (family && !world.allowedGenreFamilies.includes(family)) worldDriftRisk = 0.72;
  else if (family && POP_CROSSOVER_FAMILIES.has(family) && !world.allowedGenreFamilies.includes(family)) {
    worldDriftRisk = 0.88;
  }

  const total = clamp01(sceneMatch * 0.50 + atmosphereMatch * 0.30 + (1 - worldDriftRisk) * 0.20);
  return { sceneMatch, atmosphereMatch, worldDriftRisk, total };
}

export function hardRejectOffWorldTracks<T extends {
  trackId: string;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  danceability?: number | null;
}>(
  tracks: T[],
  world: WorldBoundary,
  classMap?: Map<string, { genreFamily?: string; genrePrimary?: string }>,
): { kept: T[]; rejected: T[]; diagnostics: WorldBoundaryDiagnostics } {
  if (!world.active) {
    return {
      kept: tracks,
      rejected: [],
      diagnostics: {
        inputCount: tracks.length,
        keptCount: tracks.length,
        rejectedCount: 0,
        rejectedOffScene: 0,
        rejectedDrift: 0,
        hardLock: false,
        dominantScene: null,
      },
    };
  }

  const kept: T[] = [];
  const rejected: T[] = [];
  let rejectedOffScene = 0;
  let rejectedDrift = 0;

  for (const track of tracks) {
    const family = trackGenreFamilyForBoundary(track, classMap);
    if (!isTrackInWorld(track, world, family)) {
      rejected.push(track);
      if (family && world.offSceneGenreFamilies.includes(family)) rejectedOffScene += 1;
      else rejectedDrift += 1;
      continue;
    }
    kept.push(track);
  }

  return {
    kept,
    rejected,
    diagnostics: {
      inputCount: tracks.length,
      keptCount: kept.length,
      rejectedCount: rejected.length,
      rejectedOffScene,
      rejectedDrift,
      hardLock: world.hardLock,
      dominantScene: world.dominantScene,
    },
  };
}

export function preCoherenceWorldFilter<T extends CoherenceAuditTrack>(
  tracks: T[],
  world: WorldBoundary,
  intent: LockedIntent,
  opts?: { maxPerCluster?: number; minFitScore?: number },
): T[] {
  if (!world.active || tracks.length === 0) return tracks;

  const maxPerCluster = opts?.maxPerCluster ?? Math.max(12, Math.ceil(tracks.length * 0.35));
  const minFitScore = opts?.minFitScore ?? (world.hardLock ? 0.48 : 0.38);

  const scored = tracks
    .map((track) => ({
      track,
      fit: scoreWorldCandidateFit(track, world, intent),
      family: trackGenreFamilyForBoundary(track) ?? "unknown",
    }))
    .filter(({ fit }) => fit.total >= minFitScore && fit.worldDriftRisk < 0.62)
    .sort((a, b) => b.fit.total - a.fit.total);

  const clusterCounts = new Map<string, number>();
  const out: T[] = [];

  for (const entry of scored) {
    const count = clusterCounts.get(entry.family) ?? 0;
    if (count >= maxPerCluster) continue;
    clusterCounts.set(entry.family, count + 1);
    out.push(entry.track);
  }

  return out.length >= Math.min(tracks.length, 8) ? out : scored.slice(0, Math.max(8, Math.floor(tracks.length * 0.65))).map((e) => e.track);
}

function marginalCoherenceGain(
  playlist: CoherenceAuditTrack[],
  candidate: CoherenceAuditTrack,
  intent: LockedIntent,
  scenePrediction?: Record<string, number>,
): number {
  if (playlist.length === 0) {
    return auditPlaylistCoherence([candidate], intent, scenePrediction).overallCoherence;
  }
  const base = auditPlaylistCoherence(playlist, intent, scenePrediction).overallCoherence;
  const withCandidate = auditPlaylistCoherence([...playlist, candidate], intent, scenePrediction).overallCoherence;
  return withCandidate - base;
}

export function buildPlaylistByWorldConstraints<T extends CoherenceAuditTrack>(opts: {
  candidates: T[];
  intent: LockedIntent;
  world: WorldBoundary;
  playlistLength: number;
  scenePrediction?: Record<string, number>;
  maxPerArtist?: number;
}): { tracks: T[]; coherenceScore: PlaylistCoherenceScore; diagnostics: Record<string, unknown> } {
  const maxPerArtist = opts.maxPerArtist ?? 3;
  const filtered = preCoherenceWorldFilter(
    hardRejectOffWorldTracks(opts.candidates, opts.world).kept,
    opts.world,
    opts.intent,
    { maxPerCluster: Math.max(10, Math.ceil(opts.playlistLength * 1.5)) },
  );

  if (filtered.length === 0) {
    return {
      tracks: [],
      coherenceScore: scorePlaylistCoherence([], opts.intent, opts.scenePrediction),
      diagnostics: { reason: "empty_world_filtered_pool" },
    };
  }

  const artistCounts = new Map<string, number>();
  const seed = [...filtered].sort((a, b) => {
    const fitA = scoreWorldCandidateFit(a, opts.world, opts.intent).total;
    const fitB = scoreWorldCandidateFit(b, opts.world, opts.intent).total;
    return fitB - fitA;
  })[0]!;

  const playlist: T[] = [seed];
  const used = new Set<string>([seed.trackId]);
  const seedArtist = seed.artistName?.toLowerCase().trim();
  if (seedArtist) artistCounts.set(seedArtist, 1);

  const remaining = filtered.filter((t) => t.trackId !== seed.trackId);

  while (playlist.length < opts.playlistLength && remaining.length > 0) {
    let bestIndex = -1;
    let bestGain = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const artist = candidate.artistName?.toLowerCase().trim();
      if (artist && (artistCounts.get(artist) ?? 0) >= maxPerArtist) continue;

      const worldFit = scoreWorldCandidateFit(candidate, opts.world, opts.intent);
      if (worldFit.worldDriftRisk > 0.55) continue;

      const gain = marginalCoherenceGain(playlist, candidate, opts.intent, opts.scenePrediction);
      const combined = gain + worldFit.total * 0.12;
      if (combined > bestGain) {
        bestGain = combined;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) break;

    const chosen = remaining.splice(bestIndex, 1)[0]!;
    playlist.push(chosen);
    used.add(chosen.trackId);
    const artist = chosen.artistName?.toLowerCase().trim();
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
  }

  const coherenceScore = scorePlaylistCoherence(playlist, opts.intent, opts.scenePrediction);
  return {
    tracks: playlist,
    coherenceScore,
    diagnostics: {
      candidateCount: opts.candidates.length,
      filteredCount: filtered.length,
      builtCount: playlist.length,
      hardLock: opts.world.hardLock,
      dominantScene: opts.world.dominantScene,
    },
  };
}
