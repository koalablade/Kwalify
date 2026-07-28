/**
 * Light world-aware sequencing — no shuffle post-ranking.
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

/** V13 post-purity sequence: anchor → statement → deep cuts → development → cooldown. */
export function sequenceAfterPurityFilter<T extends SequencedTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  profile: CulturalWorldProfile | null,
): T[] {
  if (!profile || tracks.length <= 2) return tracks;

  const opener = tracks[0]!;
  const rest = tracks.slice(1);

  const iconic: T[] = [];
  const statement: T[] = [];
  const deepCuts: T[] = [];
  const development: T[] = [];
  const experimental: T[] = [];

  for (const track of rest) {
    const score = worldScoreOf(track, profile);
    const artist = String(track.artistName ?? "").trim();
    const anchor = artist && isAnchorArtistForProfile(artist, profile);
    const adjacent = artist && matchesAdjacentArtist(artist, profile);
    const pop = popularityOf(track);

    if (anchor && score >= 0.9) {
      iconic.push(track);
    } else if ((anchor || adjacent) && score >= 0.75) {
      statement.push(track);
    } else if (pop < 45 || score < 0.8) {
      if (score >= 0.7) deepCuts.push(track);
      else experimental.push(track);
    } else if (score >= 0.7) {
      development.push(track);
    } else {
      experimental.push(track);
    }
  }

  const sortByScore = (a: T, b: T) => worldScoreOf(b, profile) - worldScoreOf(a, profile);
  iconic.sort(sortByScore);
  statement.sort(sortByScore);
  deepCuts.sort((a, b) => popularityOf(a) - popularityOf(b));
  development.sort((a, b) => energyOf(b) - energyOf(a));
  experimental.sort(sortByScore);

  const body = [...iconic, ...statement, ...deepCuts, ...development, ...experimental];
  const cooldownTail = body.length > 3
    ? body.slice(-2).sort((a, b) => energyOf(a) - energyOf(b))
    : [];
  const maintain = body.length > 3 ? body.slice(0, body.length - 2) : body;

  const sequenced = [opener, ...maintain, ...cooldownTail];
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
  const rule = profile?.openerRules.sequencing;
  if (rule === "cinematic_to_reflective") return sequenceCinematicToReflective(tracks);
  if (rule === "high_energy_cooldown") return sequenceHighEnergyCooldown(tracks);
  return tracks;
}

export function sequencingRuleForProfile(profile: CulturalWorldProfile | null): string | null {
  return profile?.openerRules.sequencing ?? null;
}
