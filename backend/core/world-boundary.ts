/**
 * World boundary enforcement — hard scene cluster lock before retrieval completes,
 * pre-coherence candidate filtering, and constraint-driven playlist construction.
 */

import type { SceneLockStatus } from "./scene-lock-mode";
import type { LockedIntent } from "./v3/intent";
import {
  detectUkHipHopScene,
  passesUkHipHopWorldGate,
  ukHipHopEvidenceScore,
  usHipHopDriftScore,
  type UkHipHopScene,
} from "../lib/uk-hip-hop-scene";
import {
  auditPlaylistCoherence,
  scorePlaylistCoherence,
  type CoherenceAuditTrack,
  type PlaylistCoherenceScore,
} from "./playlist-coherence-audit";
import {
  estimateWorldMembership,
  inferWorldIdentityIdsFromPrompt,
  passesWorldIdentity,
  worldIdentityProfilesForLock,
} from "./editorial/world-identity-gate";

export type WorldBoundary = {
  active: boolean;
  hardLock: boolean;
  dominantScene: string | null;
  allowedGenreFamilies: string[];
  offSceneGenreFamilies: string[];
  scenePrediction: Record<string, number>;
  reason: string | null;
  ukHipHopScene: UkHipHopScene | null;
  /** Cultural lock anchors (goth_world, boss_fight, …) for identity gates. */
  lockAnchors: string[];
  prompt: string | null;
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

function ukSceneFromLock(sceneLock: SceneLockStatus | null): UkHipHopScene | null {
  if (!sceneLock?.active || !sceneLock.reason?.startsWith("uk_hip_hop_scene_lock:")) return null;
  const id = sceneLock.anchors[0];
  if (id !== "uk_grime" && id !== "uk_rap" && id !== "uk_drill" && id !== "uk_garage_grime") return null;
  return {
    active: true,
    id,
    allowsElectronic: id === "uk_garage_grime",
    anchor: id,
  };
}

export function resolveWorldBoundary(opts: {
  sceneLock?: SceneLockStatus | null;
  sceneAliases?: string[];
  scenePrediction?: Record<string, number>;
  prompt?: string;
}): WorldBoundary {
  const sceneLock = opts.sceneLock ?? null;
  const sceneAliases = opts.sceneAliases ?? [];
  const scenePrediction = opts.scenePrediction ?? {};
  const ukHipHopScene = ukSceneFromLock(sceneLock) ?? (opts.prompt ? detectUkHipHopScene(opts.prompt) : null);
  const predictionEntries = Object.entries(scenePrediction).sort((a, b) => b[1] - a[1]);
  const dominantScene = predictionEntries[0]?.[0] ?? sceneAliases[0] ?? null;
  const inferredWorldIds = inferWorldIdentityIdsFromPrompt(opts.prompt);

  if (sceneLock?.active) {
    const allowed = [...new Set([
      ...sceneLock.allowedGenreFamilies,
      ...sceneAliases.slice(0, 4),
    ])].map((f) => normalizeFamily(f)).filter((f): f is string => !!f);
    const offScene = [...new Set(sceneLock.offSceneGenreFamilies)]
      .map((f) => normalizeFamily(f))
      .filter((f): f is string => !!f && !allowed.includes(f));

    const ukOnlyLock = ukHipHopScene?.active === true;
    return {
      active: true,
      hardLock: true,
      dominantScene,
      allowedGenreFamilies: allowed,
      offSceneGenreFamilies: offScene,
      scenePrediction,
      reason: sceneLock.reason,
      ukHipHopScene,
      lockAnchors: ukOnlyLock
        ? [ukHipHopScene.id]
        : [...new Set([...sceneLock.anchors, ...inferredWorldIds])],
      prompt: opts.prompt ?? null,
    };
  }

  // Prompt-inferred musical worlds (gym rock, pop punk, …) without cultural lock.
  if (inferredWorldIds.length > 0) {
    const profileFamilies: Record<string, { allowed: string[]; off: string[] }> = {
      goth_world: {
        allowed: ["rock", "indie", "electronic", "metal"],
        off: ["reggae", "hip_hop", "country", "latin", "pop", "rnb", "soul", "blues"],
      },
      grunge_world: {
        allowed: ["rock", "metal", "indie"],
        off: ["pop", "reggae", "hip_hop", "country", "electronic", "latin", "rnb", "soul"],
      },
      pop_punk_world: {
        allowed: ["rock", "indie", "pop"],
        off: ["electronic", "hip_hop", "country", "latin", "reggae", "jazz", "classical", "soul"],
      },
      gym_rock_world: {
        allowed: ["rock", "metal", "indie"],
        off: ["electronic", "hip_hop", "country", "latin", "reggae", "rnb", "soul", "jazz", "classical"],
      },
      angry_rock_world: {
        allowed: ["rock", "metal", "indie"],
        off: ["pop", "electronic", "hip_hop", "country", "latin", "reggae", "rnb", "soul", "jazz"],
      },
      sleepy_gym_world: {
        allowed: ["indie", "electronic", "pop", "rnb"],
        off: ["metal", "country", "latin", "reggae", "classical"],
      },
      classic_rock_world: {
        allowed: ["rock", "blues", "metal"],
        off: ["pop", "hip_hop", "electronic", "country", "latin", "reggae", "rnb"],
      },
      lofi_world: {
        allowed: ["indie", "electronic", "jazz", "hip_hop", "soul"],
        off: ["metal", "rock", "country", "reggae", "latin", "pop"],
      },
      ambient_world: {
        allowed: ["electronic", "classical", "jazz", "soundtrack", "indie"],
        off: ["hip_hop", "metal", "rock", "pop", "reggae", "country", "latin", "rnb"],
      },
      quiet_rage: {
        allowed: ["rock", "indie", "metal", "electronic"],
        off: ["pop", "reggae", "country", "latin", "soul"],
      },
      rave_comedown: {
        allowed: ["electronic", "indie", "soul", "jazz"],
        off: ["metal", "country", "latin", "reggae", "pop", "hip_hop"],
      },
      neon_tek_drive: {
        allowed: ["electronic", "indie", "rock"],
        off: ["country", "folk", "reggae", "classical", "blues", "latin", "hip_hop", "rnb"],
      },
      melancholy_drive: {
        allowed: ["indie", "electronic", "rock", "rnb", "soul"],
        off: ["metal", "country", "reggae", "latin"],
      },
      disco_party_world: {
        allowed: ["soul", "rnb", "pop", "electronic"],
        off: ["metal", "rock", "hip_hop", "country", "folk", "reggae"],
      },
      rainy_drive_world: {
        allowed: ["indie", "electronic", "rock", "rnb"],
        off: ["metal", "country", "folk", "hip_hop", "latin"],
      },
      chill_rainy_world: {
        allowed: ["indie", "folk", "electronic", "soul"],
        off: ["metal", "hip_hop", "country", "latin", "reggae"],
      },
      focus_study_world: {
        allowed: ["electronic", "classical", "jazz", "indie", "soundtrack"],
        off: ["hip_hop", "metal", "rock", "pop", "reggae", "country", "latin", "rnb"],
      },
      sunday_chill_world: {
        allowed: ["indie", "folk", "soul", "jazz", "electronic"],
        off: ["metal", "hip_hop", "latin", "reggae"],
      },
      feel_good_world: {
        allowed: ["pop", "soul", "rnb", "electronic"],
        off: ["metal", "classical", "rock", "indie", "hip_hop"],
      },
      soft_sad_world: {
        allowed: ["indie", "folk", "soul"],
        off: ["metal", "hip_hop", "electronic", "latin", "reggae"],
      },
      social_kitchen_world: {
        allowed: ["soul", "pop", "indie", "electronic", "rnb"],
        off: ["metal", "classical"],
      },
      coffee_soft_focus_world: {
        allowed: ["indie", "folk", "jazz", "classical", "electronic"],
        off: ["metal", "hip_hop", "latin", "reggae"],
      },
      evening_drive_world: {
        allowed: ["indie", "electronic", "rock", "soul"],
        off: ["metal", "country", "latin"],
      },
      upbeat_chore_world: {
        allowed: ["pop", "indie", "electronic", "soul"],
        off: ["metal", "classical", "country"],
      },
      gym_energy_world: {
        allowed: ["hip_hop", "electronic", "pop", "indie"],
        off: ["classical", "jazz", "country", "folk", "metal", "rock"],
      },
      indie_dream_world: {
        allowed: ["indie", "electronic", "folk"],
        off: ["metal", "hip_hop", "country", "latin", "reggae"],
      },
      nostalgia_warm_world: {
        allowed: ["indie", "rock", "pop", "electronic"],
        off: ["classical", "metal"],
      },
      party_prep_world: {
        allowed: ["pop", "soul", "electronic", "rnb"],
        off: ["metal", "folk", "country", "classical"],
      },
      rainy_reading_world: {
        allowed: ["folk", "indie", "classical"],
        off: ["metal", "hip_hop", "electronic", "latin", "reggae"],
      },
      beach_sunset_world: {
        allowed: ["indie", "electronic", "pop", "folk"],
        off: ["metal", "hip_hop", "country"],
      },
      summer_warm_world: {
        allowed: ["pop", "indie", "electronic", "soul"],
        off: ["metal", "classical", "country"],
      },
      acoustic_sunday_world: {
        allowed: ["folk", "indie", "country"],
        off: ["metal", "hip_hop", "electronic", "latin"],
      },
      late_night_calm_world: {
        allowed: ["indie", "electronic", "folk", "soul"],
        off: ["metal", "hip_hop", "country", "latin"],
      },
      rnb_night_world: {
        allowed: ["rnb", "soul", "pop"],
        off: ["metal", "rock", "country", "folk"],
      },
      britpop_world: {
        allowed: ["indie", "rock"],
        off: ["metal", "hip_hop", "country", "latin"],
      },
      film_ending_world: {
        allowed: ["indie", "electronic", "rock", "classical", "soundtrack"],
        off: ["hip_hop", "metal", "country", "latin", "reggae"],
      },
      dad_secret_world: {
        allowed: ["rock", "pop", "soul", "rnb"],
        off: ["metal", "hip_hop", "electronic", "latin", "reggae"],
      },
      older_sibling_world: {
        allowed: ["indie", "rock", "electronic"],
        off: ["metal", "country", "latin", "reggae", "classical"],
      },
      latin_summer_rooftop_world: {
        allowed: ["latin", "pop", "rnb", "reggae"],
        off: ["metal", "rock", "country", "classical", "indie"],
      },
      commute_world: {
        allowed: ["pop", "indie", "electronic", "rnb"],
        off: ["metal", "country", "classical", "latin"],
      },
      first_date_world: {
        allowed: ["indie", "pop", "soul", "rnb"],
        off: ["metal", "hip_hop", "country", "latin"],
      },
    };
    const allowed = new Set<string>();
    const off = new Set<string>();
    for (const id of inferredWorldIds) {
      const families = profileFamilies[id];
      if (!families) continue;
      for (const f of families.allowed) allowed.add(f);
      for (const f of families.off) off.add(f);
    }
    for (const f of allowed) off.delete(f);
    if (allowed.size > 0) {
      return {
        active: true,
        hardLock: true,
        dominantScene: inferredWorldIds[0] ?? dominantScene,
        allowedGenreFamilies: [...allowed],
        offSceneGenreFamilies: [...off],
        scenePrediction,
        reason: `world_purity_lock:${inferredWorldIds[0]}`,
        ukHipHopScene,
        lockAnchors: inferredWorldIds,
        prompt: opts.prompt ?? null,
      };
    }
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
      ukHipHopScene,
      lockAnchors: inferredWorldIds,
      prompt: opts.prompt ?? null,
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
    ukHipHopScene: ukHipHopScene?.active ? ukHipHopScene : null,
    lockAnchors: [],
    prompt: opts.prompt ?? null,
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
  track: {
    trackId: string;
    genreFamily?: string | null;
    genrePrimary?: string | null;
    danceability?: number | null;
    energy?: number | null;
    valence?: number | null;
    instrumentalness?: number | null;
    popularity?: number | null;
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    /** Serialized API / Spotify shapes sometimes use these aliases. */
    name?: string | null;
    artist?: string | null;
    album?: string | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
    genres?: string[] | null;
  },
  world: WorldBoundary,
  genreFamily?: string | null,
): boolean {
  if (!world.active) return true;

  const normalized = {
    ...track,
    trackName: track.trackName ?? track.name ?? null,
    artistName: track.artistName ?? track.artist ?? null,
    albumName: track.albumName ?? track.album ?? null,
  };

  const family = normalizeFamily(genreFamily ?? normalized.genreFamily ?? normalized.genrePrimary);
  const ukScene = world.ukHipHopScene;
  const profiles = worldIdentityProfilesForLock({
    reason: world.reason,
    anchors: world.lockAnchors,
    prompt: world.prompt,
  });

  // World identity outranks family/energy: reject blankets + off-world artists first.
  if (profiles.length > 0) {
    const identityOk = passesWorldIdentity(
      normalized,
      profiles,
      { hardLock: world.hardLock || profiles.length > 0 },
    );
    if (!identityOk) return false;
    // UK grime/UKG locks must still pass scene evidence — party_prep identity must not bypass.
    if (world.hardLock && !ukScene?.active) return true;
  }

  if (ukScene?.active) {
    if (!passesUkHipHopWorldGate(normalized, ukScene, { hardLock: world.hardLock })) return false;
  }

  if (!family) return !world.hardLock;

  if (world.offSceneGenreFamilies.includes(family)) return false;
  if (world.allowedGenreFamilies.includes(family)) {
    return true;
  }

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
  const identityProfiles = worldIdentityProfilesForLock({
    reason: world.reason,
    anchors: world.lockAnchors,
    prompt: world.prompt,
  });
  const worldMembership = estimateWorldMembership(track, identityProfiles);

  // World identity outranks energy: off-world tracks get zeroed before atmosphere.
  if (world.active && identityProfiles.length > 0 && worldMembership <= 0) {
    return {
      sceneMatch: 0.02,
      atmosphereMatch: 0.1,
      worldDriftRisk: 0.98,
      total: 0.02,
    };
  }

  let sceneMatch = 0.35;
  if (world.ukHipHopScene?.active) {
    const uk = ukHipHopEvidenceScore(track);
    const us = usHipHopDriftScore(track);
    sceneMatch = clamp01(0.25 + uk * 0.65 - us * 0.35);
  } else if (family && world.allowedGenreFamilies.includes(family)) {
    const rank = world.allowedGenreFamilies.indexOf(family);
    sceneMatch = clamp01(0.92 - rank * 0.08);
  } else if (family && world.offSceneGenreFamilies.includes(family)) {
    sceneMatch = 0.05;
  } else if (!family) {
    sceneMatch = 0.4;
  } else {
    sceneMatch = 0.22;
  }
  if (identityProfiles.length > 0) {
    sceneMatch = clamp01(sceneMatch * 0.45 + worldMembership * 0.55);
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
  // Energy is supporting evidence only — never outweigh world membership.
  const atmosphereWeight = identityProfiles.length > 0 ? 0.12 : 0.30;
  const sceneWeight = identityProfiles.length > 0 ? 0.68 : 0.50;
  const driftWeight = 1 - sceneWeight - atmosphereWeight;

  let worldDriftRisk = 0.2;
  if (family && world.offSceneGenreFamilies.includes(family)) worldDriftRisk = 0.95;
  else if (family && !world.allowedGenreFamilies.includes(family)) worldDriftRisk = 0.72;
  else if (family && POP_CROSSOVER_FAMILIES.has(family) && !world.allowedGenreFamilies.includes(family)) {
    worldDriftRisk = 0.88;
  }
  if (identityProfiles.length > 0 && worldMembership < 0.5) {
    worldDriftRisk = Math.max(worldDriftRisk, 0.75);
  }

  const total = clamp01(
    sceneMatch * sceneWeight + atmosphereMatch * atmosphereWeight + (1 - worldDriftRisk) * driftWeight,
  );
  return { sceneMatch, atmosphereMatch, worldDriftRisk, total };
}

export function hardRejectOffWorldTracks<T extends {
  trackId?: string;
  id?: string | number;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  danceability?: number | null;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  name?: string | null;
  artist?: string | null;
  album?: string | null;
  energy?: number | null;
  valence?: number | null;
  popularity?: number | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  genres?: string[] | null;
}>(
  tracks: T[],
  world: WorldBoundary,
  classMap?: Map<string, { genreFamily?: string; genrePrimary?: string; subGenres?: string[] }>,
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
    const trackId = String(track.trackId ?? track.id ?? "");
    const family = trackGenreFamilyForBoundary(
      { trackId, genreFamily: track.genreFamily, genrePrimary: track.genrePrimary },
      classMap,
    );
    const classification = trackId ? classMap?.get(trackId) : undefined;
    const enriched = {
      ...track,
      trackId,
      trackName: track.trackName ?? track.name ?? null,
      artistName: track.artistName ?? track.artist ?? null,
      albumName: track.albumName ?? track.album ?? null,
      genreFamily: family ?? track.genreFamily ?? classification?.genreFamily ?? null,
      genrePrimary: track.genrePrimary ?? classification?.genrePrimary ?? null,
      genres: track.genres ?? classification?.subGenres ?? null,
    };
    if (!isTrackInWorld(enriched, world, family)) {
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
