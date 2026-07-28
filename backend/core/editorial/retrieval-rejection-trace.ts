/**
 * V14 retrieval rejection tracing — diagnostics when purity leaves thin playlists.
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { getNeighbourWorlds } from "./world-neighbour-graph";

export type RejectionStage =
  | "purity_gate"
  | "anchor_retrieval"
  | "retrieval_pipeline"
  | "expansion_filter"
  | "neighbour_expansion"
  | "artist_diversity_cap";

export type RejectionRecord = {
  worldId: string;
  artistName: string;
  trackName: string;
  reason: string;
  stage: RejectionStage;
  worldIdentityScore?: number;
  retrievalSource?: string;
  expansionSource?: string;
};

export type RejectionStats = {
  worldId: string;
  total: number;
  byStage: Record<string, number>;
  byReason: Record<string, number>;
  topArtists: Array<{ artist: string; count: number }>;
};

let activeTrace: RejectionRecord[] = [];

export function beginRejectionTrace(): void {
  activeTrace = [];
}

export function recordRetrievalRejection(record: RejectionRecord): void {
  activeTrace.push(record);
}

export function getRejectionTrace(): RejectionRecord[] {
  return [...activeTrace];
}

export function getRejectionStats(worldId: string): RejectionStats {
  const records = activeTrace.filter((r) => r.worldId === worldId);
  const byStage: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const artistCounts = new Map<string, number>();

  for (const r of records) {
    byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
    byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    const artist = r.artistName.trim().toLowerCase();
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
  }

  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([artist, count]) => ({ artist, count }));

  return {
    worldId,
    total: records.length,
    byStage,
    byReason,
    topArtists,
  };
}

export function summarizeRejectionTrace(worldId: string): {
  stats: RejectionStats;
  suggestions: string[];
} {
  const stats = getRejectionStats(worldId);
  const suggestions = diagnoseRetrievalShortfall(worldId, activeTrace, 0, 25).suggestions;
  return { stats, suggestions };
}

export function diagnoseRetrievalShortfall(
  worldId: string,
  rejections: RejectionRecord[],
  currentCount: number,
  targetCount: number,
  profile?: CulturalWorldProfile | null,
): { suggestions: string[]; gap: number } {
  const gap = Math.max(0, targetCount - currentCount);
  const suggestions: string[] = [];
  const worldRejections = rejections.filter((r) => r.worldId === worldId);

  if (gap === 0) return { suggestions, gap };

  const purityRejections = worldRejections.filter((r) => r.stage === "purity_gate").length;
  const expansionRejections = worldRejections.filter(
    (r) => r.stage === "expansion_filter" || r.stage === "anchor_retrieval",
  ).length;
  const diversityRejections = worldRejections.filter((r) => r.stage === "artist_diversity_cap").length;

  if (purityRejections > expansionRejections) {
    suggestions.push("purity_gate_removed_candidates — expand culturally-valid pool before sequencing");
  }
  if (profile?.deepCuts?.length) {
    suggestions.push(`expand_deep_cuts — search ${profile.deepCuts.slice(0, 4).join(", ")}`);
  }
  if (profile?.forgottenArtists?.length) {
    suggestions.push(`search_forgotten_artists — ${profile.forgottenArtists.slice(0, 4).join(", ")}`);
  }
  if (profile?.cultArtists?.length) {
    suggestions.push(`search_cult_artists — ${profile.cultArtists.slice(0, 4).join(", ")}`);
  }
  const neighbours = getNeighbourWorlds(worldId);
  if (neighbours.length > 0 && currentCount < targetCount * 0.5) {
    suggestions.push(`neighbour_world_expansion — try ${neighbours.slice(0, 3).join(", ")} anchor/deepCut lists`);
  }
  if (diversityRejections > 0) {
    suggestions.push("artist_diversity_cap_hit — widen artist tiers before capping duplicates");
  }
  if (expansionRejections > purityRejections && currentCount < 8) {
    suggestions.push("spotify_anchor_exhausted — batch more anchor + major + deepCut artist searches");
  }
  if (suggestions.length === 0) {
    suggestions.push("library_thin_for_world — honest partial is correct; no safe expansion left");
  }

  return { suggestions, gap };
}
