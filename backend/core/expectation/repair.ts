/**
 * Human Expectation Layer — repair loop.
 *
 * When the critic says a playlist fails, don't just reject it. Explain why,
 * remove the trust-breaking / off-vibe / duplicate tracks, and backfill from
 * the candidate reservoir (liked songs only) with closer emotional matches.
 * Iterate until acceptable or no further improvement is possible. Deterministic.
 */

import { detectFailureModes } from "./failure-taxonomy";
import { findingsToRepair } from "./playlist-critic";
import { evaluateTrackAdmissibility } from "./track-admissibility";
import type { ExpectationContract, ExpectationTrack, MomentInterpretation, RepairResult } from "./types";

export interface RepairOptions {
  /** Never shrink below this many tracks (falls back to keeping least-bad). */
  minLength?: number;
  maxIterations?: number;
  /** Max tracks per artist during backfill. */
  artistCap?: number;
  now?: Date;
}

function artistKey(t: ExpectationTrack): string {
  return (t.artistName ?? "").trim().toLowerCase();
}

export function repairPlaylist(
  current: ExpectationTrack[],
  reservoir: ExpectationTrack[],
  contract: ExpectationContract,
  interpretation: MomentInterpretation,
  opts: RepairOptions = {},
): RepairResult {
  const target = current.length;
  const minLength = Math.max(1, opts.minLength ?? Math.max(8, Math.floor(target * 0.6)));
  const maxIterations = opts.maxIterations ?? 3;
  const artistCap = opts.artistCap ?? Math.max(3, Math.ceil(target / 8));
  const now = opts.now ?? new Date();

  const explanation: string[] = [];
  const removedIds = new Set<string>();
  const addedIds = new Set<string>();

  // De-duplicate up front (repairs the thin-supply cloning bug too).
  const seen = new Set<string>();
  let working: ExpectationTrack[] = [];
  for (const t of current) {
    if (seen.has(t.trackId)) {
      removedIds.add(t.trackId);
      explanation.push(`Removed duplicate track ${t.trackId}.`);
      continue;
    }
    seen.add(t.trackId);
    working.push(t);
  }

  // Reservoir keyed by id, admissible-only, best first (deterministic).
  const workingIds = new Set(working.map((t) => t.trackId));
  const backfillPool = reservoir
    .filter((t) => !workingIds.has(t.trackId))
    .map((t) => ({ t, a: evaluateTrackAdmissibility(t, contract) }))
    .filter((x) => x.a.admissible && x.a.severity === "none")
    .sort((p, q) => q.a.score - p.a.score || p.t.trackId.localeCompare(q.t.trackId));
  let poolCursor = 0;

  const artistCounts = new Map<string, number>();
  for (const t of working) artistCounts.set(artistKey(t), (artistCounts.get(artistKey(t)) ?? 0) + 1);

  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const findings = detectFailureModes(working, contract, interpretation, now);
    const repairFindings = findingsToRepair(findings);

    // Collect removal candidates: taxonomy targets + individually inadmissible.
    const toRemove = new Set<string>();
    for (const f of repairFindings) for (const id of f.trackIds) toRemove.add(id);
    for (const t of working) {
      if (!evaluateTrackAdmissibility(t, contract).admissible) toRemove.add(t.trackId);
    }
    if (toRemove.size === 0) break;

    // Worst-first so we respect minLength when we can't remove everything.
    const ranked = working
      .filter((t) => toRemove.has(t.trackId))
      .map((t) => ({ t, a: evaluateTrackAdmissibility(t, contract) }))
      .sort((p, q) => p.a.score - q.a.score || p.t.trackId.localeCompare(q.t.trackId));

    const maxRemovable = Math.max(0, working.length - minLength);
    const removeThisPass = ranked.slice(0, Math.max(0, Math.min(ranked.length, maxRemovable + backfillEligible(backfillPool, poolCursor))));
    if (removeThisPass.length === 0) {
      explanation.push(`Cannot repair further without dropping below ${minLength} tracks.`);
      break;
    }

    const removeSet = new Set(removeThisPass.map((x) => x.t.trackId));
    for (const x of removeThisPass) {
      removedIds.add(x.t.trackId);
      const k = artistKey(x.t);
      artistCounts.set(k, Math.max(0, (artistCounts.get(k) ?? 0) - 1));
    }
    working = working.filter((t) => !removeSet.has(t.trackId));
    explanation.push(`Removed ${removeThisPass.length} off-vibe track(s): ${summarise(removeThisPass.map((x) => x.a.violations[0] ?? "identity mismatch"))}.`);

    // Backfill to target with admissible reservoir tracks respecting artist cap.
    let added = 0;
    while (working.length < target && poolCursor < backfillPool.length) {
      const cand = backfillPool[poolCursor++]!;
      const k = artistKey(cand.t);
      if ((artistCounts.get(k) ?? 0) >= artistCap) continue;
      if (working.some((t) => t.trackId === cand.t.trackId)) continue;
      working.push(cand.t);
      addedIds.add(cand.t.trackId);
      artistCounts.set(k, (artistCounts.get(k) ?? 0) + 1);
      added += 1;
    }
    if (added > 0) explanation.push(`Added ${added} closer emotional match(es) from the candidate pool.`);
    else if (working.length < target) explanation.push(`Candidate pool exhausted; delivering ${working.length} honest matches.`);
  }

  if (explanation.length === 0) explanation.push("Playlist already satisfies the expectation contract.");

  return {
    orderedIds: working.map((t) => t.trackId),
    removedIds: Array.from(removedIds),
    addedIds: Array.from(addedIds),
    explanation,
    iterations,
  };
}

function backfillEligible(pool: Array<{ t: ExpectationTrack }>, cursor: number): number {
  return Math.max(0, pool.length - cursor);
}

function summarise(reasons: string[]): string {
  const uniq = Array.from(new Set(reasons)).slice(0, 3);
  return uniq.join("; ");
}
