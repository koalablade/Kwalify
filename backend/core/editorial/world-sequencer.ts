/**
 * V14 world-aware sequencing — Thesis → Confirmation → Expansion → Deep cuts → Peak → Cruise → Landing.
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { matchesAdjacentArtist } from "./cultural-identity-profile";
import {
  resolveCulturalProfileForCommitted,
  scoreTrackWorldIdentity,
  isAnchorArtistForProfile,
} from "./world-identity-score";
import type { CommittedWorld } from "../committed-world";
import type { WorldIdentityTrack } from "./world-identity-score";

type SequencedTrack = WorldIdentityTrack & { energy?: number | null; popularity?: number | null };

function energyOf(track: SequencedTrack): number {
  const e = track.energy;
  return typeof e === "number" && Number.isFinite(e) ? e : 0.5;
}

function popularityOf(track: SequencedTrack): number {
  const p = track.popularity;
  return typeof p === "number" && Number.isFinite(p) ? p : 0.5;
}

function worldScoreOf(track: SequencedTrack, profile: CulturalWorldProfile): number {
  return scoreTrackWorldIdentity(track, profile);
}

/** Cinematic anchor first, atmospheric mid, reflective tail. */
function sequenceCinematicToReflective<T extends SequencedTrack>(tracks: T[]): T[] {
  if (tracks.length <= 3) return tracks;
  const head = tracks[0]!;
  const rest = tracks.slice(1);
  const sorted = rest.slice().sort((a, b) => energyOf(b) - energyOf(a));
  const mid = sorted.slice(0, Math.ceil(sorted.length * 0.6));
  const tail = sorted.slice(Math.ceil(sorted.length * 0.6)).sort((a, b) => energyOf(a) - energyOf(b));
  return [head, ...mid, ...tail];
}

/** Highest energy first, maintain mid, cooldown at end. */
function sequenceHighEnergyCooldown<T extends SequencedTrack>(tracks: T[]): T[] {
  if (tracks.length <= 3) return tracks;
  const opener = tracks[0]!;
  const rest = tracks.slice(1).sort((a, b) => energyOf(b) - energyOf(a));
  const maintain = rest.slice(0, Math.max(1, rest.length - 2));
  const cooldown = rest.slice(Math.max(1, rest.length - 2)).sort((a, b) => energyOf(a) - energyOf(b));
  return [opener, ...maintain, ...cooldown];
}

/**
 * V14 believable-world arc:
 * Thesis (fixed opener) → Confirmation → Expansion → Deep cuts → Peak → Cruise → Landing.
 */
export function sequenceV14BelievableWorld<T extends SequencedTrack>(
  tracks: T[],
  profile: CulturalWorldProfile,
): T[] {
  if (tracks.length <= 2) return tracks;

  const thesis = tracks[0]!;
  const rest = tracks.slice(1);

  const confirmation: T[] = [];
  const expansion: T[] = [];
  const deepCuts: T[] = [];
  const peakPool: T[] = [];
  const cruisePool: T[] = [];
  const landingPool: T[] = [];

  for (const track of rest) {
    const score = worldScoreOf(track, profile);
    const artist = String(track.artistName ?? "").trim();
    const anchor = artist && isAnchorArtistForProfile(artist, profile);
    const adjacent = artist && matchesAdjacentArtist(artist, profile);
    const pop = popularityOf(track);
    const energy = energyOf(track);

    if (anchor && score >= 0.9) {
      confirmation.push(track);
    } else if ((anchor || adjacent) && score >= 0.82) {
      expansion.push(track);
    } else if (pop < 45 || score < 0.85) {
      if (score >= 0.78) deepCuts.push(track);
      else if (energy <= 0.42) landingPool.push(track);
      else cruisePool.push(track);
    } else if (energy >= 0.72) {
      peakPool.push(track);
    } else if (energy <= 0.45) {
      landingPool.push(track);
    } else {
      cruisePool.push(track);
    }
  }

  const byScore = (a: T, b: T) => worldScoreOf(b, profile) - worldScoreOf(a, profile);
  confirmation.sort(byScore);
  expansion.sort(byScore);
  deepCuts.sort((a, b) => popularityOf(a) - popularityOf(b));
  peakPool.sort((a, b) => energyOf(b) - energyOf(a));
  cruisePool.sort((a, b) => energyOf(b) - energyOf(a));
  landingPool.sort((a, b) => energyOf(a) - energyOf(b));

  const peak = peakPool.slice(0, Math.max(1, Math.ceil(rest.length * 0.15)));
  const peakIds = new Set(peak);
  const cruise = cruisePool.filter((t) => !peakIds.has(t));
  const landing = landingPool.slice(-Math.min(3, Math.max(2, Math.ceil(rest.length * 0.12))));

  const used = new Set([thesis, ...confirmation, ...expansion, ...deepCuts, ...peak, ...cruise, ...landing]);
  const overflow = rest.filter((t) => !used.has(t)).sort(byScore);

  return [
    thesis,
    ...confirmation,
    ...expansion,
    ...deepCuts,
    ...overflow,
    ...peak,
    ...cruise,
    ...landing,
  ];
}

/** V14 post-purity sequence: believable-world arc with profile-specific tail rules. */
export function sequenceAfterPurityFilter<T extends SequencedTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  profile: CulturalWorldProfile | null,
): T[] {
  if (!profile || tracks.length <= 2) return tracks;

  const sequenced = sequenceV14BelievableWorld(tracks, profile);
  if (committed?.hardLock) {
    const rule = profile.openerRules.sequencing;
    if (rule === "cinematic_to_reflective") return sequenceCinematicToReflective(sequenced);
    if (rule === "high_energy_cooldown") return sequenceHighEnergyCooldown(sequenced);
  }
  return sequenced;
}

/** Apply world sequencing rules without reshuffling the thesis opener. */
export function applyWorldSequencing<T extends SequencedTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
): T[] {
  if (!committed?.hardLock || tracks.length <= 2) return tracks;
  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) return tracks;
  return sequenceAfterPurityFilter(tracks, committed, profile);
}

export function sequencingRuleForProfile(profile: CulturalWorldProfile | null): string | null {
  return profile?.openerRules.sequencing ?? null;
}
