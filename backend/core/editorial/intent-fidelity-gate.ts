/**
 * Intent fidelity — does the delivered playlist belong to the committed world?
 * Opener tracks 1–3 must prove the prompt before the user hears anything else.
 */

import type { CommittedWorld } from "../committed-world";
import {
  isSafetyBlanketOutsideWorld,
  passesWorldIdentity,
  worldIdentityProfilesForLock,
  type WorldIdentityProfile,
} from "./world-identity-gate";

export type IntentFidelityTrack = {
  trackId?: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  instrumentalness?: number | null;
  popularity?: number | null;
  acousticness?: number | null;
};

export type IntentFidelityResult = {
  passed: boolean;
  openerPassed: boolean;
  fidelityScore: number;
  openerFailures: string[];
  sampleFailures: string[];
  worldVerifiedCount: number;
  salvageableTracks: IntentFidelityTrack[];
  honestPartialCap: number;
};

const GYM_WORLD_IDS = new Set([
  "gym_rock_world",
  "angry_rock_world",
  "gym_energy_world",
  "boss_fight",
]);

const OPENER_SLOTS = 3;
const SAMPLE_INDICES = [0, 1, 2, 4, 9];

function trackLabel(track: IntentFidelityTrack): string {
  const artist = track.artistName?.trim() || "?";
  const title = track.trackName?.trim() || "?";
  return `${artist} — ${title}`;
}

function profilesForCommitted(committed: CommittedWorld, prompt: string): WorldIdentityProfile[] {
  const anchors = committed.worldIds.length > 0 ? committed.worldIds : [committed.id];
  return worldIdentityProfilesForLock({
    prompt,
    reason: committed.reason,
    anchors,
  });
}

function trackPasses(
  track: IntentFidelityTrack,
  profiles: WorldIdentityProfile[],
  hardLock: boolean,
  worldIds: string[],
): boolean {
  if (isSafetyBlanketOutsideWorld(track.artistName, worldIds)) return false;
  return passesWorldIdentity(
    {
      trackName: track.trackName ?? null,
      artistName: track.artistName ?? null,
      albumName: track.albumName ?? null,
      genreFamily: track.genreFamily ?? null,
      genrePrimary: track.genrePrimary ?? null,
      genres: track.genres ?? null,
      spotifyArtistGenres: track.spotifyArtistGenres,
      albumGenres: track.albumGenres,
      energy: track.energy ?? null,
      valence: track.valence ?? null,
      danceability: track.danceability ?? null,
      instrumentalness: track.instrumentalness ?? null,
      popularity: track.popularity ?? null,
    },
    profiles,
    { hardLock },
  );
}

function gymEnergyOk(track: IntentFidelityTrack, worldIds: string[]): boolean {
  if (!worldIds.some((id) => GYM_WORLD_IDS.has(id))) return true;
  const energy = track.energy;
  if (typeof energy !== "number" || !Number.isFinite(energy)) return true;
  const acoustic = track.acousticness;
  if (typeof acoustic === "number" && acoustic > 0.72 && energy < 0.55) return false;
  const minEnergy = worldIds.includes("angry_rock_world") || worldIds.includes("gym_rock_world")
    ? 0.72
    : 0.65;
  return energy >= minEnergy;
}

function openerTitleRejected(track: IntentFidelityTrack, worldIds: string[]): boolean {
  const title = String(track.trackName ?? "").trim();
  if (!title) return false;
  const driveWorld = worldIds.some((id) => id === "rainy_drive_world" || id === "night_drive_world");
  const gymWorld = worldIds.some((id) => GYM_WORLD_IDS.has(id));
  if (!driveWorld && !gymWorld) return false;
  return /\b(?:commentary|commentaries|rehearsal|soundcheck|karaoke|instrumental\s+version)\b/i.test(title);
}

export function evaluateIntentFidelity(opts: {
  tracks: IntentFidelityTrack[];
  committed: CommittedWorld | null;
  prompt: string;
  requestedLength: number;
}): IntentFidelityResult {
  const { tracks, committed, prompt, requestedLength } = opts;
  const honestPartialCap = Math.min(12, Math.max(6, Math.ceil(requestedLength * 0.4)));

  if (!committed || tracks.length === 0) {
    return {
      passed: tracks.length > 0,
      openerPassed: tracks.length > 0,
      fidelityScore: tracks.length > 0 ? 0.5 : 0,
      openerFailures: [],
      sampleFailures: [],
      worldVerifiedCount: tracks.length,
      salvageableTracks: tracks,
      honestPartialCap,
    };
  }

  const profiles = profilesForCommitted(committed, prompt);
  const hardLock = committed.hardLock;
  const worldIds = committed.worldIds;

  const openerFailures: string[] = [];
  const sampleFailures: string[] = [];

  for (let i = 0; i < Math.min(OPENER_SLOTS, tracks.length); i++) {
    const track = tracks[i]!;
    if (!trackPasses(track, profiles, hardLock, worldIds) || !gymEnergyOk(track, worldIds) || openerTitleRejected(track, worldIds)) {
      openerFailures.push(trackLabel(track));
    }
  }

  for (const idx of SAMPLE_INDICES) {
    if (idx >= tracks.length) continue;
    const track = tracks[idx]!;
    if (!trackPasses(track, profiles, hardLock, worldIds) || !gymEnergyOk(track, worldIds) || openerTitleRejected(track, worldIds)) {
      sampleFailures.push(trackLabel(track));
    }
  }

  const verified = tracks.filter(
    (t) => trackPasses(t, profiles, hardLock, worldIds) && gymEnergyOk(t, worldIds),
  );
  const openerPassed = openerFailures.length === 0;
  const samplePassRate =
    SAMPLE_INDICES.filter((i) => i < tracks.length).length > 0
      ? 1 - sampleFailures.length / SAMPLE_INDICES.filter((i) => i < tracks.length).length
      : 1;
  const verifiedShare = tracks.length > 0 ? verified.length / tracks.length : 0;
  const fidelityScore = openerPassed
    ? verifiedShare * 0.6 + samplePassRate * 0.4
    : Math.max(0, verifiedShare * 0.4);

  const passed =
    !hardLock ||
    (openerPassed && verifiedShare >= 0.55 && samplePassRate >= 0.6);

  const salvageableTracks =
    verified.length >= 3
      ? verified.slice(0, honestPartialCap)
      : verified;

  return {
    passed,
    openerPassed,
    fidelityScore,
    openerFailures,
    sampleFailures,
    worldVerifiedCount: verified.length,
    salvageableTracks,
    honestPartialCap,
  };
}

/** World-verified honest partial — never keep opener fillers when hard-locked. */
export function selectIntentFidelityHonestPartialTracks<
  T extends IntentFidelityTrack & { trackId?: string },
>(tracks: T[], result: IntentFidelityResult, committed: CommittedWorld | null): T[] {
  if (!committed?.hardLock || (result.passed && result.openerPassed)) {
    return tracks;
  }
  const cap = result.honestPartialCap;
  const verifiedIds = new Set(
    result.salvageableTracks
      .map((t) => t.trackId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  if (verifiedIds.size > 0) {
    const verified = tracks.filter((t) => t.trackId != null && verifiedIds.has(t.trackId));
    if (verified.length > 0) {
      return verified.slice(0, cap);
    }
  }
  if (result.salvageableTracks.length > 0) {
    return (result.salvageableTracks as T[]).slice(0, cap);
  }
  return tracks.slice(0, Math.min(cap, tracks.length));
}
