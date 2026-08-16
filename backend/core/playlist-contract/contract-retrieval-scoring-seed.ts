/**
 * V41 — Preserve contract-authoritative retrieval through hybrid scoring.
 * Mirrors hard-lock world seeding: contract tracks must survive generic emotion ranking.
 */

import type { UserGenreProfile } from "../../lib/user-genre-profile";
import type { ScoredLibraryTrack } from "../scoring-engine/types";
import { buildContractCompositionMeta, CONTRACT_AXIS_ACTIVATION_THRESHOLD } from "./contract-axis-scoring";
import { computeCompoundIntentScore } from "./contract-composition-select";
import { passesCompoundRetrievalEligibility } from "./contract-compound-eligibility";
import type { ContractAuthoritativeTrack } from "./contract-authoritative-retrieval";
import {
  getContractCompositionMeta,
  requiredContractDimensions,
  type ContractCompositionMeta,
  type ContractCompositionTrack,
} from "./contract-composition-types";
import type { PlaylistContract } from "./types";

const ACTIVATION_THRESHOLD = CONTRACT_AXIS_ACTIVATION_THRESHOLD;

/** Lookup table for V40 meta — survives scoring / intent filters that strip fields. */
export function buildContractMetaLookup(
  tracks: ContractCompositionTrack[],
): Map<string, ContractCompositionMeta> {
  const map = new Map<string, ContractCompositionMeta>();
  for (const track of tracks) {
    const meta = getContractCompositionMeta(track);
    if (meta) map.set(track.trackId, meta);
  }
  return map;
}

/** Prepend contract retrieval universe; preserve axis meta from retrieval onto scored shapes. */
export function mergeContractRetrievalUniverse<T extends { trackId: string } & ContractCompositionTrack>(
  primary: T[],
  retrievalPool: Array<T & ContractCompositionTrack>,
): T[] {
  if (retrievalPool.length === 0) return primary;
  const byId = new Map(primary.map((track) => [track.trackId, track]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const raw of retrievalPool) {
    const existing = byId.get(raw.trackId);
    const meta = getContractCompositionMeta(raw) ?? (existing ? getContractCompositionMeta(existing) : undefined);
    if (existing) {
      out.push(meta ? { ...existing, contractCompositionMeta: meta } : existing);
    } else {
      out.push(raw as T);
    }
    seen.add(raw.trackId);
  }
  for (const track of primary) {
    if (!seen.has(track.trackId)) out.push(track);
  }
  return out;
}

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

  const preserveBoth = contract.tension.some((t) => t.resolution === "preserve_both");
  let compoundFiltered = 0;
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
    if (preserveBoth && !passesCompoundRetrievalEligibility(meta, contract, { relaxed: true })) {
      compoundFiltered += 1;
      continue;
    }

    const compound = computeCompoundIntentScore(meta, contract);
    const contractRank = compound * 0.68 + meta.contractScore * 0.18 + meta.intersectionStrength * 0.14;
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

  // Graceful degradation: never zero the seeded pool when admissible supply exists.
  if (preserveBoth && enrichedPool.length === 0 && compoundFiltered > 0) {
    const fallbackCandidates: Array<{ raw: T; meta: ContractCompositionMeta; compound: number }> = [];
    for (const raw of contractRetrievalPool) {
      let meta = getContractCompositionMeta(raw);
      if (!meta) {
        meta = buildContractCompositionMeta(
          toAuthoritativeTrack(raw, classMap),
          contract,
          classMap.get(raw.trackId) ?? null,
        );
      }
      if (!meta.admissible) continue;
      fallbackCandidates.push({
        raw,
        meta,
        compound: computeCompoundIntentScore(meta, contract),
      });
    }
    fallbackCandidates.sort((a, b) => b.compound - a.compound);
    for (const row of fallbackCandidates.slice(0, Math.min(120, fallbackCandidates.length))) {
      const existing = sortedById.get(row.raw.trackId);
      const base = existing ?? row.raw;
      const contractRank =
        row.compound * 0.68 + row.meta.contractScore * 0.18 + row.meta.intersectionStrength * 0.14;
      const enriched = {
        ...base,
        contractCompositionMeta: row.meta,
        score: Math.max((existing as ScoredLibraryTrack<T> | undefined)?.score ?? 0, contractRank),
      } as ScoredLibraryTrack<T> & ContractCompositionTrack;
      enrichedPool.push(enriched);
      if (!existing) seededNew += 1;
      sortedById.set(row.raw.trackId, enriched);
      scoredById.set(row.raw.trackId, enriched);
    }
  }

  enrichedPool.sort((a, b) => {
    const ma = getContractCompositionMeta(a);
    const mb = getContractCompositionMeta(b);
    const sa = ma ? computeCompoundIntentScore(ma, contract) : 0;
    const sb = mb ? computeCompoundIntentScore(mb, contract) : 0;
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
