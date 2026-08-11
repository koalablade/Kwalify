/**
 * V18 checkpoint backfill — replace-not-truncate after H1/H2 checkpoint failure.
 */

import type { CommittedWorld } from "../committed-world";
import type { CulturalWorldProfile } from "./cultural-identity-profile";
import type { WorldIdentityTrack } from "./world-identity-score";
import {
  evaluateCheckpointDecisions,
} from "./world-purity-gate";
import { scoreTrackWorldIdentity } from "./world-identity-score";
import { passesMomentFitForRefill } from "./song-moment-fit";

const CHECKPOINT_POSITIONS = [0, 1, 4, 9, 14] as const;

function passesWorldAndMoment<T extends WorldIdentityTrack>(
  track: T,
  profile: CulturalWorldProfile,
  prompt: string,
  minWorld = 0.72,
): boolean {
  const world = scoreTrackWorldIdentity(track, profile);
  if (world < minWorld) return false;
  return passesMomentFitForRefill(track, prompt);
}

/**
 * When checkpoint strip would truncate, try replacing failing slots from tail/removal pool.
 * Generic — uses world profile + moment fit, not prompt hacks.
 */
export function replaceCheckpointFailures<T extends WorldIdentityTrack>(
  tracks: T[],
  replacementPool: T[],
  committed: CommittedWorld | null,
  profile: CulturalWorldProfile | null,
  opts: { prompt?: string; compositionPositions?: readonly number[]; maxReplacements?: number } = {},
): { tracks: T[]; replacements: number; truncated: number } {
  if (!committed?.hardLock || !profile || tracks.length === 0) {
    return { tracks: tracks.slice(), replacements: 0, truncated: 0 };
  }

  const prompt = opts.prompt ?? "";
  const maxReplacements = opts.maxReplacements ?? 8;
  const compositionPositions =
    opts.compositionPositions ??
    tracks.map((_, i) => (CHECKPOINT_POSITIONS.includes(i as (typeof CHECKPOINT_POSITIONS)[number]) ? i : -1));

  let working = tracks.slice();
  let replacements = 0;
  const usedIds = new Set(working.map((t) => String((t as { trackId?: string }).trackId ?? `${t.artistName}:${t.trackName}`)));

  const pool = replacementPool.filter((t) => {
    const id = String((t as { trackId?: string }).trackId ?? `${t.artistName}:${t.trackName}`);
    return !usedIds.has(id) && passesWorldAndMoment(t, profile, prompt);
  });

  for (let attempt = 0; attempt < maxReplacements; attempt += 1) {
    const decisions = evaluateCheckpointDecisions(working, profile, compositionPositions);
    const failed = decisions.find((d) => !d.passed);
    if (!failed) break;

    const failIdx = failed.checkpointSurvivorIndex;
    if (failIdx < 0 || failIdx >= working.length) break;

    let bestPoolIdx = -1;
    let bestWorld = 0;
    for (let p = 0; p < pool.length; p += 1) {
      const candidate = pool[p]!;
      const w = scoreTrackWorldIdentity(candidate, profile);
      if (w > bestWorld) {
        bestWorld = w;
        bestPoolIdx = p;
      }
    }
    if (bestPoolIdx < 0) break;

    const replacement = pool.splice(bestPoolIdx, 1)[0]!;
    const id = String((replacement as { trackId?: string }).trackId ?? `${replacement.artistName}:${replacement.trackName}`);
    usedIds.add(id);
    working[failIdx] = replacement;
    replacements += 1;
  }

  const finalDecisions = evaluateCheckpointDecisions(working, profile, compositionPositions);
  const stillFailed = finalDecisions.some((d) => !d.passed);
  let truncated = 0;
  if (stillFailed) {
    let cutIndex = working.length;
    for (const d of finalDecisions) {
      if (!d.passed) {
        cutIndex = Math.min(cutIndex, d.checkpointSurvivorIndex);
        break;
      }
    }
    if (cutIndex < working.length && cutIndex >= 3) {
      truncated = working.length - cutIndex;
      working = working.slice(0, cutIndex);
    }
  }

  return { tracks: working, replacements, truncated };
}
