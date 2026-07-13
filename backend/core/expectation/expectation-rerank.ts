/**
 * Human Expectation Layer — contract-aware candidate re-ranking.
 *
 * This is the "connect the engine to retrieval" step. Given the tracks V3
 * already selected plus the larger pre-truncation candidate pool, it blends an
 * expectation-admissibility signal into the existing relevance score and
 * re-selects the top N. Effect: tracks that fit the imagined moment are
 * promoted, mood/energy inversions are demoted, and admissible alternatives
 * from the pool replace off-vibe picks — all from liked songs only.
 *
 * It NEVER adds a track that inverts the moment, respects an artist cap and
 * de-dup, and (in enforce) only applies when it does not reduce average
 * admissibility, so it can only preserve or improve selection quality.
 */

import { evaluateTrackAdmissibility } from "./track-admissibility";
import type { ExpectationContract, ExpectationTrack } from "./types";

export interface RerankCandidate extends ExpectationTrack {
  /** Existing relevance score from the hybrid scorer (roughly 0..1.25). */
  score?: number | null;
}

export interface RerankDiagnostics {
  executed: boolean;
  applied: boolean;
  mode: "shadow" | "enforce";
  weight: number;
  candidatePoolSize: number;
  selectedSize: number;
  promoted: Array<{ trackId: string; title: string | null; artist: string | null }>;
  demoted: Array<{ trackId: string; title: string | null; artist: string | null; reason: string }>;
  droppedInadmissible: number;
  avgAdmissibilityBefore: number;
  avgAdmissibilityAfter: number;
  /**
   * Candidate-pool recall/diversity signals (P3/P7): how much admissible supply
   * the retrieval pool actually offered, and how varied it was. These explain
   * WHY a re-rank could or could not improve a playlist.
   */
  pool: {
    size: number;
    admissibleCount: number;
    admissibleRate: number;
    distinctArtists: number;
    distinctGenreFamilies: number;
    energySpread: number;
    eraSpreadYears: number;
  };
}

export interface RerankOptions {
  playlistLength: number;
  maxPerArtist?: number;
  mode: "shadow" | "enforce";
  /** Blend weight for the expectation channel (0..1). Default 0.4. */
  weight?: number;
}

export interface RerankResult<T> {
  tracks: T[];
  diagnostics: RerankDiagnostics;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function artistKey(t: RerankCandidate): string {
  return (t.artistName ?? "").trim().toLowerCase();
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Re-rank a selection against a candidate pool using the expectation contract.
 * `T` must structurally provide track id, audio features, artist and an
 * existing `score` (the pipeline's tracks and plain test objects both satisfy
 * this).
 */
export function rerankByExpectation<T extends RerankCandidate>(
  selected: T[],
  pool: T[],
  contract: ExpectationContract,
  opts: RerankOptions,
): RerankResult<T> {
  const weight = clamp01(opts.weight ?? 0.4);
  const targetLength = Math.min(opts.playlistLength, Math.max(selected.length, 1));
  const artistCap = opts.maxPerArtist && opts.maxPerArtist > 0 ? opts.maxPerArtist : Infinity;

  const selectedIds = new Set(selected.map((t) => t.trackId));

  // De-duplicated union: current selection first, then novel pool tracks.
  const union: T[] = [];
  const seen = new Set<string>();
  for (const t of [...selected, ...pool]) {
    if (seen.has(t.trackId)) continue;
    seen.add(t.trackId);
    union.push(t);
  }

  const maxScore = Math.max(0.0001, ...union.map((t) => (typeof t.score === "number" ? t.score : 0)));

  interface Ranked {
    track: T;
    admissible: boolean;
    admScore: number;
    combined: number;
    wasSelected: boolean;
  }

  const ranked: Ranked[] = union.map((t) => {
    const a = evaluateTrackAdmissibility(t, contract);
    const norm = clamp01((typeof t.score === "number" ? t.score : 0) / maxScore);
    let combined = norm * (1 - weight) + a.score * weight;
    // Mood/energy inversions sink hard: never let a strong relevance score
    // drag a trust-breaking track into the playlist.
    if (!a.admissible) combined *= 0.4;
    return { track: t, admissible: a.admissible, admScore: a.score, combined, wasSelected: selectedIds.has(t.trackId) };
  });

  ranked.sort((p, q) => q.combined - p.combined || p.track.trackId.localeCompare(q.track.trackId));

  // Greedy pick respecting artist cap and length. Never introduce a *new*
  // inadmissible track (only keep an inadmissible one if it was already picked
  // and nothing better is available).
  const artistCounts = new Map<string, number>();
  const picked: Ranked[] = [];
  const canTake = (r: Ranked): boolean => {
    const k = artistKey(r.track);
    if (!k) return true;
    return (artistCounts.get(k) ?? 0) < artistCap;
  };
  const take = (r: Ranked) => {
    picked.push(r);
    const k = artistKey(r.track);
    if (k) artistCounts.set(k, (artistCounts.get(k) ?? 0) + 1);
  };

  for (const r of ranked) {
    if (picked.length >= targetLength) break;
    if (!r.admissible && !r.wasSelected) continue; // don't import inversions
    if (!canTake(r)) continue;
    take(r);
  }
  // Backfill length from anything remaining (incl. previously-skipped) so we
  // never deliver short purely due to caps.
  if (picked.length < targetLength) {
    const pickedIds = new Set(picked.map((r) => r.track.trackId));
    for (const r of ranked) {
      if (picked.length >= targetLength) break;
      if (pickedIds.has(r.track.trackId)) continue;
      if (!canTake(r)) continue;
      take(r);
      pickedIds.add(r.track.trackId);
    }
  }

  const beforeAdm = selected.map((t) => evaluateTrackAdmissibility(t, contract).score);
  const afterAdm = picked.map((r) => r.admScore);
  const avgBefore = mean(beforeAdm);
  const avgAfter = mean(afterAdm);

  const pickedIds = new Set(picked.map((r) => r.track.trackId));
  const promoted = picked
    .filter((r) => !r.wasSelected)
    .map((r) => ({ trackId: r.track.trackId, title: r.track.trackName ?? null, artist: r.track.artistName ?? null }));
  const demoted = selected
    .filter((t) => !pickedIds.has(t.trackId))
    .map((t) => {
      const a = evaluateTrackAdmissibility(t, contract);
      return {
        trackId: t.trackId,
        title: t.trackName ?? null,
        artist: t.artistName ?? null,
        reason: a.violations[0] ?? "lower expectation fit",
      };
    });
  const droppedInadmissible = selected.filter((t) => {
    const a = evaluateTrackAdmissibility(t, contract);
    return !a.admissible && !pickedIds.has(t.trackId);
  }).length;

  // Enforce only when it does not worsen average admissibility and actually
  // changes the set; shadow computes the same diagnostics but never mutates.
  const changed = promoted.length > 0 || demoted.length > 0;
  const improvesOrHolds = avgAfter >= avgBefore - 1e-9;
  const usable = picked.length >= Math.min(selected.length, targetLength);
  const applied = opts.mode === "enforce" && changed && improvesOrHolds && usable;

  const poolAdmissible = ranked.filter((r) => r.admissible).length;
  const energies = union.map((t) => t.energy).filter((e): e is number => typeof e === "number");
  const years = union.map((t) => t.releaseYear).filter((y): y is number => typeof y === "number");
  const energyMean = mean(energies);
  const energySpread = energies.length ? Math.sqrt(mean(energies.map((e) => (e - energyMean) ** 2))) : 0;
  const eraSpreadYears = years.length ? Math.max(...years) - Math.min(...years) : 0;

  const diagnostics: RerankDiagnostics = {
    executed: true,
    applied,
    mode: opts.mode,
    weight,
    candidatePoolSize: pool.length,
    selectedSize: selected.length,
    promoted,
    demoted,
    droppedInadmissible,
    avgAdmissibilityBefore: Math.round(avgBefore * 1000) / 1000,
    avgAdmissibilityAfter: Math.round(avgAfter * 1000) / 1000,
    pool: {
      size: union.length,
      admissibleCount: poolAdmissible,
      admissibleRate: Math.round((union.length ? poolAdmissible / union.length : 0) * 1000) / 1000,
      distinctArtists: new Set(union.map((t) => artistKey(t)).filter(Boolean)).size,
      distinctGenreFamilies: new Set(union.map((t) => (t.genreFamily ?? "").toLowerCase()).filter(Boolean)).size,
      energySpread: Math.round(energySpread * 1000) / 1000,
      eraSpreadYears,
    },
  };

  return { tracks: applied ? picked.map((r) => r.track) : selected, diagnostics };
}
