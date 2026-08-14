/**
 * V41 — Preserve contract-authoritative retrieval through hybrid scoring.
 * Mirrors hard-lock world seeding: contract tracks must survive generic emotion ranking.
 */

import type { UserGenreProfile } from "../../lib/user-genre-profile";
import type { ScoredLibraryTrack } from "../scoring-engine/types";
import { buildContractCompositionMeta } from "./contract-axis-scoring";
import type { ContractAuthoritativeTrack } from "./contract-authoritative-retrieval";
import {
  getContractCompositionMeta,
  requiredContractDimensions,
  type ContractCompositionTrack,
} from "./contract-composition-types";
import type { PlaylistContract } from "./types";

const ACTIVATION_THRESHOLD = 0.42;

export type ContractRetrievalSeedDiagnostics = {
  retrievalPoolCount: number;
  seededNew: number;
  metaAttached: number;
  admissibleCount: number;
  dimensionCoverage: Record<string, number>;
  intersectionCount: number;
};

function toAuthoritativeTrack<T extends {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  releaseYear?: number | null;
  genreFamily?: string | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
): ContractAuthoritativeTrack {
  const classification = classMap.get(track.trackId) ?? null;
  return {
    trackId: track.trackId,
    trackName: track.trackName ?? null,
    artistName: track.artistName ?? null,
    energy: track.energy ?? null,
    valence: track.valence ?? null,
    danceability: track.danceability ?? null,
    acousticness: track.acousticness ?? null,
    releaseYear: (track as { releaseYear?: number | null }).releaseYear ?? null,
    genreFamily: classification?.genreFamily ?? (track as { genreFamily?: string | null }).genreFamily ?? null,
  };
}

function countAxisCoverage<T extends ContractCompositionTrack>(
  tracks: T[],
  dimension: string,
): number {
  return tracks.filter((t) => (getContractCompositionMeta(t)?.axisScores[dimension] ?? 0) >= ACTIVATION_THRESHOLD).length;
}

/** Merge contract retrieval pool into scored output; prepend missing admissible tracks. */
export function seedContractRetrievalIntoScoredPool<T extends {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  tempo?: number | null;
  acousticness?: number | null;
}>(
  scoring: {
    sorted: ScoredLibraryTrack<T>[];
    scored: ScoredLibraryTrack<T>[];
  },
  contractRetrievalPool: T[],
  contract: PlaylistContract,
  classMap: UserGenreProfile["trackClassifications"],
): ContractRetrievalSeedDiagnostics {
  if (contractRetrievalPool.length === 0) {
    return {
      retrievalPoolCount: 0,
      seededNew: 0,
      metaAttached: 0,
      admissibleCount: 0,
      dimensionCoverage: {},
      intersectionCount: 0,
    };
  }

  const sortedById = new Map(scoring.sorted.map((track) => [track.trackId, track]));
  const scoredById = new Map(scoring.scored.map((track) => [track.trackId, track]));
  let seededNew = 0;
  let metaAttached = 0;
  const enrichedPool: Array<ScoredLibraryTrack<T> & ContractCompositionTrack> = [];

  for (const raw of contractRetrievalPool) {
    const existing = sortedById.get(raw.trackId);
    const base = existing ?? raw;
    let meta = getContractCompositionMeta(raw) ?? getContractCompositionMeta(base);
    if (!meta) {
      meta = buildContractCompositionMeta(
        toAuthoritativeTrack(raw, classMap),
        contract,
        classMap.get(raw.trackId) ?? null,
      );
    }
    metaAttached += 1;
    if (!meta.admissible) continue;

    const contractRank = meta.contractScore * 0.45 + meta.intersectionStrength * 0.4;
    const scoredBase = existing as ScoredLibraryTrack<T> | undefined;
    const enriched = {
      ...base,
      contractCompositionMeta: meta,
      score: Math.max(scoredBase?.score ?? 0, contractRank),
      scoringDebug: scoredBase?.scoringDebug ?? {
        trackId: raw.trackId,
        sceneScore: contractRank,
        libraryFitScore: meta.contractScore,
        genreBalanceScore: 0.5,
        sceneMatch: 0.5,
        emotionMatch: 0.5,
        genreMatch: 0.5,
        memoryMatch: 0.5,
        noveltyScore: 0,
        seasonalMatch: 0.5,
        moodPurity: 0.5,
        genrePrimary: classMap.get(raw.trackId)?.genrePrimary ?? "unknown",
        genreConfidence: 0.5,
        genreLocked: false,
        excludedBy: null,
        finalScore: contractRank,
      },
    } as ScoredLibraryTrack<T> & ContractCompositionTrack;

    enrichedPool.push(enriched);
    if (!existing) seededNew += 1;
    sortedById.set(raw.trackId, enriched);
    scoredById.set(raw.trackId, enriched);
  }

  enrichedPool.sort((a, b) => {
    const ma = getContractCompositionMeta(a);
    const mb = getContractCompositionMeta(b);
    const sa = (ma?.contractScore ?? 0) + (ma?.intersectionStrength ?? 0) * 0.5;
    const sb = (mb?.contractScore ?? 0) + (mb?.intersectionStrength ?? 0) * 0.5;
    return sb - sa;
  });

  const enrichedIds = new Set(enrichedPool.map((t) => t.trackId));
  const remainder = scoring.sorted.filter((t) => !enrichedIds.has(t.trackId));
  scoring.sorted = [...enrichedPool, ...remainder];
  scoring.scored = [...enrichedPool, ...scoring.scored.filter((t) => !enrichedIds.has(t.trackId))];

  const required = requiredContractDimensions(contract);
  const dimensionCoverage: Record<string, number> = {};
  for (const dim of required) {
    dimensionCoverage[dim] = countAxisCoverage(enrichedPool, dim);
  }
  const intersectionCount = enrichedPool.filter(
    (t) => (getContractCompositionMeta(t)?.intersectionStrength ?? 0) >= 0.32,
  ).length;

  return {
    retrievalPoolCount: contractRetrievalPool.length,
    seededNew,
    metaAttached,
    admissibleCount: enrichedPool.length,
    dimensionCoverage,
    intersectionCount,
  };
}
