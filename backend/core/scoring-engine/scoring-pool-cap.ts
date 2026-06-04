/**
 * Cap hybrid scoring pool — full-library tri-score on 10k+ tracks is too slow for HTTP.
 *
 * Phase 3 — Retrieval Before Scoring:
 * When a semantic scene is locked (confidence >= threshold), anti-genre tracks are
 * pre-filtered from the candidate pool BEFORE the expensive tri-score runs.
 * This ensures "outlaw country" never retrieves a rap-heavy pool regardless of library size.
 */

import type { EmotionProfile, VibeKind } from "../../lib/emotion";
import { passesSunnyGate } from "../../lib/emotion";
import type { TrackGenreClassification, RootGenre } from "../../lib/genre-taxonomy";
import {
  detectLibraryEraMode,
  libraryEraScoreBoost,
  type LibraryEraMode,
} from "../../lib/vibe-match-guards";
import {
  MINIMAL_GENRE_STACK_THRESHOLD,
  resolveHybridPoolCap,
} from "../../lib/production-limits";
import type { SemanticSceneVector } from "../../lib/semantic-scene-engine";
import {
  isHardAntiGenre,
  isEcosystemWhitelisted,
  isEcosystemAdjacent,
  ECOSYSTEM_HARD_GATE_CONFIDENCE,
} from "../../lib/semantic-scene-engine";

function seededJitter(trackId: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < trackId.length; i++) h = (h * 31 + trackId.charCodeAt(i)) | 0;
  return (h & 0xffff) / 0xffff;
}

function quickEmotionFit(
  track: { energy: number | null; valence: number | null },
  profile: EmotionProfile
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return (
    1 -
    (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2
  );
}

export function capTracksForHybridScoring<T extends {
  trackId: string;
  energy: number | null;
  valence: number | null;
  acousticness?: number | null;
  addedAt?: Date | null;
}>(
  tracks: T[],
  opts: {
    emotionProfile: EmotionProfile;
    vibeKind: VibeKind;
    classifications: Map<string, TrackGenreClassification>;
    maxTracks?: number;
    librarySize?: number;
    referencePlaylist?: boolean;
    promptWordCount?: number;
    seedMs?: number;
    recentTrackPenalty?: Map<string, number>;
    libraryEraMode?: LibraryEraMode;
    vibe?: string;
    /**
     * Phase 3 — Retrieval Before Scoring:
     * When provided, tracks whose primary genre is a hard anti-genre for this
     * scene are removed from the pool BEFORE scoring begins.
     * The ecosystem filter only activates when we have enough ecosystem-matching
     * tracks (at least 30% of the target cap) to fill the pool.
     */
    ecosystemPreFilter?: {
      vector: SemanticSceneVector;
      sceneConfidence: number;
    };
  }
): {
  pool: T[];
  originalCount: number;
  poolCapped: boolean;
  candidateCount: number;
  preFilterRejectedCount: number;
  /** 0 = no scene, 1 = full gate (L1), 2 = adjacency bridges (L2), 3 = emergency anti-genre-only (L3) */
  adjacencyLevelUsed: 0 | 1 | 2 | 3;
} {
  const originalCount = tracks.length;
  const libSize = opts.librarySize ?? originalCount;
  const max =
    opts.maxTracks ??
    resolveHybridPoolCap(libSize, {
      referencePlaylist: opts.referencePlaylist,
      vibeKind: opts.vibeKind,
      promptWordCount: opts.promptWordCount,
    });

  // ── Phase 3: Retrieval Before Scoring (V5 hard constraint gate) ─────────────
  //
  // Two-tier scene pre-filter — tracks are REMOVED, never penalised:
  //
  //   Tier 1 (confidence ≥ 0.55):  Remove tracks whose primary genre is in
  //     the scene's explicit anti-genre list (e.g. hip-hop for OUTLAW_COUNTRY).
  //     Protects against the most egregious cross-genre leaks.
  //
  //   Tier 2 (confidence ≥ ECOSYSTEM_HARD_GATE_CONFIDENCE / 0.70):  Full
  //     ecosystem whitelist — remove every track whose primary genre is NOT
  //     present in the scene ecosystem with weight ≥ ECOSYSTEM_HARD_GATE_MIN_WEIGHT.
  //     This is the structural impossibility V5 requires: genre leakage cannot
  //     happen because out-of-ecosystem tracks never enter the scoring pool.
  //
  // Failsafe — adjacency expansion (V5 §7 / §10):
  //   If the full-gate pool < 30% of cap, relax to anti-genre-only removal (Tier 1).
  //   If even that is too small, keep the anti-genre-only set and let the
  //   scoring engine's own hard gate handle residual violations.
  //   Global unfiltered fallback is NEVER used — coherence over variety.
  let workingTracks = tracks;
  let preFilterRejectedCount = 0;
  let adjacencyLevelUsed: 0 | 1 | 2 | 3 = 0;

  if (opts.ecosystemPreFilter) {
    const { vector, sceneConfidence } = opts.ecosystemPreFilter;
    const classMap = opts.classifications;
    const minPool = Math.max(Math.floor(max * 0.30), 15);

    if (sceneConfidence >= 0.55) {
      // ── Level 1: Full ecosystem whitelist (weight ≥ 0.50) ─────────────────────
      // The ideal case — only genres explicitly in the scene ecosystem above the
      // hard gate minimum enter the pool. This is the V5.1 "global invariant".
      const useFullGate = sceneConfidence >= ECOSYSTEM_HARD_GATE_CONFIDENCE;
      if (useFullGate) {
        const l1 = tracks.filter((t) => {
          const c = classMap.get(t.trackId);
          if (!c) return true;
          return isEcosystemWhitelisted(c, vector, sceneConfidence);
        });
        if (l1.length >= minPool) {
          preFilterRejectedCount = tracks.length - l1.length;
          workingTracks = l1;
          adjacencyLevelUsed = 1;
        } else {
          // ── Level 2: Adjacency bridges (weight ≥ 0.30, NOT anti-genre) ─────────
          // Direct bridges only — genre must appear in the ecosystem graph.
          // Fuzzy similarity / absent genres are still excluded.
          const l2 = tracks.filter((t) => {
            const c = classMap.get(t.trackId);
            if (!c) return true;
            return isEcosystemAdjacent(c, vector);
          });
          if (l2.length >= minPool) {
            preFilterRejectedCount = tracks.length - l2.length;
            workingTracks = l2;
            adjacencyLevelUsed = 2;
          } else if (tracks.length < 20) {
            // ── Level 3: Emergency (anti-genre-only) — ONLY when library < 20 tracks
            // Never expand to unfiltered original library. Coherence over variety.
            const l3 = tracks.filter((t) => {
              const c = classMap.get(t.trackId);
              if (!c) return true;
              return !isHardAntiGenre(c, vector);
            });
            preFilterRejectedCount = tracks.length - l3.length;
            workingTracks = l3.length > 0 ? l3 : tracks;
            adjacencyLevelUsed = 3;
          } else {
            // Pool is small but we have tracks — use L2 result even if below minPool.
            // A coherent small pool beats an incoherent large one.
            preFilterRejectedCount = tracks.length - l2.length;
            workingTracks = l2.length > 0 ? l2 : tracks.filter((t) => {
              const c = classMap.get(t.trackId);
              if (!c) return true;
              return !isHardAntiGenre(c, vector);
            });
            adjacencyLevelUsed = 2;
          }
        }
      } else {
        // sceneConfidence ≥ 0.55 but < 0.70 — use L2 adjacency bridges directly
        const l2 = tracks.filter((t) => {
          const c = classMap.get(t.trackId);
          if (!c) return true;
          return isEcosystemAdjacent(c, vector);
        });
        if (l2.length >= minPool) {
          preFilterRejectedCount = tracks.length - l2.length;
          workingTracks = l2;
          adjacencyLevelUsed = 2;
        }
      }
    }
  }

  if (workingTracks.length <= max) {
    return {
      pool: workingTracks,
      originalCount,
      poolCapped: false,
      candidateCount: workingTracks.length,
      preFilterRejectedCount,
      adjacencyLevelUsed,
    };
  }

  // Swap to filtered list for the rest of the function
  const tracksForRanking = workingTracks;

  if (tracksForRanking.length === 0) {
    // Pool is empty after filtering — return empty rather than leaking unfiltered tracks.
    // The scoring engine will handle the empty-pool gracefully.
    return {
      pool: [],
      originalCount,
      poolCapped: false,
      candidateCount: 0,
      preFilterRejectedCount,
      adjacencyLevelUsed,
    };
  }

  if (originalCount <= max && workingTracks === tracks) {
    return { pool: tracks, originalCount, poolCapped: false, candidateCount: originalCount, preFilterRejectedCount, adjacencyLevelUsed };
  }

  // Fast path for 500+ libraries — skip era-balanced reshuffle (maps/sorts entire library).
  if (tracksForRanking.length >= MINIMAL_GENRE_STACK_THRESHOLD) {
    let candidates = tracksForRanking;
    if (opts.vibeKind === "sunny") {
      const sunny = tracksForRanking.filter((t) =>
        passesSunnyGate({
          valence: t.valence,
          energy: t.energy,
          acousticness: t.acousticness ?? null,
        })
      );
      if (sunny.length >= Math.min(max, Math.floor(tracksForRanking.length * 0.25))) {
        candidates = sunny;
      }
    }
    const seed = opts.seedMs ?? 0;
    const ranked = candidates
      .map((t) => {
        const recentPen = opts.recentTrackPenalty?.get(t.trackId) ?? 0;
        return {
          t,
          fit: quickEmotionFit(t, opts.emotionProfile) + seededJitter(t.trackId, seed) * 0.05 - recentPen,
        };
      })
      .sort((a, b) => b.fit - a.fit);
    return {
      pool: ranked.slice(0, max).map((x) => x.t),
      originalCount,
      poolCapped: true,
      candidateCount: candidates.length,
      preFilterRejectedCount,
      adjacencyLevelUsed,
    };
  }

  let candidates = tracksForRanking;
  if (opts.vibeKind === "sunny") {
    const sunny = tracksForRanking.filter((t) =>
      passesSunnyGate({
        valence: t.valence,
        energy: t.energy,
        acousticness: t.acousticness ?? null,
      })
    );
    if (sunny.length >= Math.min(max, Math.floor(tracksForRanking.length * 0.25))) {
      candidates = sunny;
    }
  }

  const seed = opts.seedMs ?? 0;
  const eraMode =
    opts.libraryEraMode ?? detectLibraryEraMode(opts.vibe ?? "");
  const ranked = candidates.map((t) => {
    const recentPen = opts.recentTrackPenalty?.get(t.trackId) ?? 0;
    const eraBoost = libraryEraScoreBoost(t.addedAt ?? null, eraMode);
    return {
      t,
      fit:
        quickEmotionFit(t, opts.emotionProfile) +
        seededJitter(t.trackId, seed) * 0.05 -
        recentPen +
        eraBoost,
    };
  });
  ranked.sort((a, b) => b.fit - a.fit);

  let head = ranked.slice(0, Math.min(ranked.length, max * 2));
  if (eraMode === "balanced" && candidates.some((t) => t.addedAt)) {
    const now = Date.now();
    const withAge = candidates
      .map((t) => ({
        t,
        age: t.addedAt ? now - t.addedAt.getTime() : now,
      }))
      .sort((a, b) => a.age - b.age);
    const mid = Math.floor(withAge.length / 2);
    const olderHalf = new Set(
      withAge.slice(0, Math.max(mid, Math.floor(withAge.length * 0.45))).map((x) => x.t.trackId)
    );
    const olderInHead = head.filter((x) => olderHalf.has(x.t.trackId));
    const rest = head.filter((x) => !olderHalf.has(x.t.trackId));
    const olderQuota = Math.min(
      Math.floor(max * 0.4),
      olderInHead.length,
      Math.max(8, Math.floor(max * 0.25))
    );
    head = [
      ...olderInHead.slice(0, olderQuota),
      ...rest.slice(0, Math.max(0, max * 2 - olderQuota)),
    ];
  }

  const byFamily = new Map<RootGenre, typeof ranked>();
  for (const item of head) {
    const fam =
      opts.classifications.get(item.t.trackId)?.genreFamily ?? ("unknown" as RootGenre);
    const list = byFamily.get(fam) ?? [];
    list.push(item);
    byFamily.set(fam, list);
  }

  const picked: T[] = [];
  const seen = new Set<string>();
  const families = [...byFamily.keys()].filter((f) => f !== "unknown");

  while (picked.length < max && families.some((f) => (byFamily.get(f)?.length ?? 0) > 0)) {
    for (const fam of families) {
      const list = byFamily.get(fam);
      if (!list?.length) continue;
      const next = list.shift()!;
      if (seen.has(next.t.trackId)) continue;
      seen.add(next.t.trackId);
      picked.push(next.t);
      if (picked.length >= max) break;
    }
  }

  if (picked.length < max) {
    for (const item of ranked) {
      if (picked.length >= max) break;
      if (seen.has(item.t.trackId)) continue;
      seen.add(item.t.trackId);
      picked.push(item.t);
    }
  }

  return {
    pool: picked,
    originalCount,
    poolCapped: true,
    candidateCount: candidates.length,
    preFilterRejectedCount,
    adjacencyLevelUsed,
  };
}
