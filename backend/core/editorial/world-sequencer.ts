/**
 * Light world-aware sequencing — no shuffle post-ranking.
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { resolveCulturalProfileForCommitted } from "./world-identity-score";
import type { CommittedWorld } from "../committed-world";
import type { WorldIdentityTrack } from "./world-identity-score";

type SequencedTrack = WorldIdentityTrack & { energy?: number | null };

function energyOf(track: SequencedTrack): number {
  const e = track.energy;
  return typeof e === "number" && Number.isFinite(e) ? e : 0.5;
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
