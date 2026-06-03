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
import { isHardAntiGenre } from "../../lib/semantic-scene-engine";

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

  // ── Phase 3: Retrieval Before Scoring (ecosystem pre-filter) ────────────────
  // When a semantic scene is locked with sufficient confidence, remove hard
  // anti-genre tracks BEFORE the expensive tri-score. This is the most
  // impactful change: "outlaw country" with a rap-heavy library should never
  // produce a rap playlist regardless of the pool cap heuristics.
  let workingTracks = tracks;
  if (opts.ecosystemPreFilter && opts.ecosystemPreFilter.sceneConfidence >= 0.55) {
    const { vector } = opts.ecosystemPreFilter;
    const classMap = opts.classifications;
    const filtered = tracks.filter((t) => {
      const c = classMap.get(t.trackId);
      if (!c) return true; // no classification → keep
      return !isHardAntiGenre(c, vector);
    });
    // Only apply the pre-filter if it leaves at least 30% of the requested cap
    // (prevents empty pools for users whose libraries are 100% anti-genre)
    if (filtered.length >= Math.max(Math.floor(max * 0.30), 15)) {
      workingTracks = filtered;
    }
  }

  if (workingTracks.length <= max) {
    return { pool: workingTracks, originalCount, poolCapped: false, candidateCount: workingTracks.length };
  }

  // Swap to filtered list for the rest of the function
  const tracksForRanking = workingTracks;

  if (tracksForRanking.length === 0) {
    return { pool: tracks.slice(0, max), originalCount, poolCapped: true, candidateCount: tracks.length };
  }

  if (originalCount <= max && workingTracks === tracks) {
    return { pool: tracks, originalCount, poolCapped: false, candidateCount: originalCount };
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
  };
}
