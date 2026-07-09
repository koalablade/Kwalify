/**
 * Playlist Identity Distance Penalty (IDP) — post-assembly perceptual layer.
 *
 * Lightweight fingerprint + distance scoring against locked intent. Swaps at most
 * two high-distance cross-session winners when a constrained replacement exists.
 * No retrieval, scoring, recovery, or upstream pipeline changes.
 */

import type { CuratorIdentity, CuratorIdentityType } from "./curator-identity";
import { detectPromptCentralArtists, normalizeSessionArtist } from "./session-artist-gravity";

export const IDP_MAX_SWAPS_PER_PLAYLIST = 2;
export const IDP_HIGH_DISTANCE_THRESHOLD = 0.45;

export type CrossSessionTrackHistory = {
  trackPlaylistCount: Map<string, number>;
  crossSessionHistorySize: number;
};

export type IdentityIntentLike = {
  genreFamilies: string[];
  primaryGenre?: string | null;
  primarySubgenre?: string | null;
  secondarySubgenre?: string | null;
  subgenreTerms?: string[];
  eraRange?: { start: number; end: number } | null;
  mood?: string[];
  activity?: string | null;
  energy?: "low" | "medium" | "high" | null;
};

export type IdentityTrackLike = {
  trackId: string;
  artistName?: string | null;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  genres?: string[] | null;
  releaseYear?: number | null;
  energy?: number | null;
  valence?: number | null;
  clusterId?: string | null;
  clusterIds?: string[] | null;
  score?: number;
};

export type PlaylistFingerprintSummary = {
  lockedIntentFamilies: string[];
  genreFamilyDistribution: Record<string, number>;
  eraRange: { start: number; end: number } | null;
  primarySubgenre: string | null;
  mood: string[];
  activity: string | null;
  energyTarget: number | null;
  curatorIdentityType: CuratorIdentityType | "unknown";
  dominantClusterId: string | null;
  meanPlaylistEnergy: number | null;
};

export type PenalisedTrackDiagnostic = {
  trackId: string;
  artistName: string | null;
  identityDistance: number;
  crossSessionWinCount: number;
  replaced: boolean;
  replacementTrackId?: string;
  bypassReason?: string;
};

export type IdentityDistanceDiagnostics = {
  fingerprint: PlaylistFingerprintSummary;
  penalisedTracks: PenalisedTrackDiagnostic[];
  replacementCount: number;
  distanceScores: Record<string, number>;
  bypassReasons: string[];
  tracksConsidered: number;
  swapsBlockedByConstraints: number;
  relaxedDueToSupply: boolean;
  crossSessionHistorySize: number;
};

export type ClusterContext = {
  selectedClusterId?: string | null;
  dominantClusterId?: string | null;
};

export type PlaylistIdentityDistanceOpts<T extends IdentityTrackLike> = {
  thinLibraryRelaxed?: boolean;
  auditDeterministic?: boolean;
  promptCentralArtists?: ReadonlySet<string>;
  explicitAlbumPrompt?: boolean;
  scoreFn?: (track: T) => number;
  canReplaceWith?: (current: T, candidate: T, position: number) => boolean;
  minAlternativesForSwap?: number;
  maxSwaps?: number;
  highDistanceThreshold?: number;
};

function defaultScore(track: { score?: number }): number {
  return typeof track.score === "number" ? track.score : 0.5;
}

function energyLevelToTarget(energy: IdentityIntentLike["energy"]): number | null {
  if (energy === "low") return 0.35;
  if (energy === "medium") return 0.55;
  if (energy === "high") return 0.75;
  return null;
}

function meanEnergy(tracks: IdentityTrackLike[]): number | null {
  const values = tracks
    .map((track) => (typeof track.energy === "number" && Number.isFinite(track.energy) ? track.energy : null))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trackClusterId(track: IdentityTrackLike): string | null {
  if (typeof track.clusterId === "string" && track.clusterId.trim()) return track.clusterId.trim();
  if (Array.isArray(track.clusterIds) && track.clusterIds.length > 0) {
    const first = track.clusterIds[0];
    return typeof first === "string" && first.trim() ? first.trim() : null;
  }
  return null;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function trackMatchesSubgenre(track: IdentityTrackLike, fingerprint: PlaylistFingerprintSummary): boolean {
  if (!fingerprint.primarySubgenre) return true;
  const target = normalizeToken(fingerprint.primarySubgenre);
  const candidates = [
    track.genrePrimary,
    track.genreFamily,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(normalizeToken);
  return candidates.some((value) => value.includes(target) || target.includes(value));
}

function trackInEraRange(year: number | null, eraRange: { start: number; end: number } | null): boolean {
  if (!eraRange || year === null) return true;
  return year >= eraRange.start && year <= eraRange.end;
}

export function buildGenreFamilyDistribution(tracks: IdentityTrackLike[]): Record<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const track of tracks) {
    const family = (track.genreFamily ?? track.genrePrimary ?? "unknown").toLowerCase().trim() || "unknown";
    counts.set(family, (counts.get(family) ?? 0) + 1);
    total += 1;
  }
  const distribution: Record<string, number> = {};
  for (const [family, count] of counts.entries()) {
    distribution[family] = total > 0 ? count / total : 0;
  }
  return distribution;
}

export function buildPlaylistFingerprint(
  tracks: IdentityTrackLike[],
  intent: IdentityIntentLike,
  curatorIdentity: Pick<CuratorIdentity, "type"> | null | undefined,
  cluster?: ClusterContext,
): PlaylistFingerprintSummary {
  const lockedIntentFamilies = intent.genreFamilies.length > 0
    ? [...intent.genreFamilies]
    : (intent.primaryGenre ? [intent.primaryGenre] : []);
  return {
    lockedIntentFamilies,
    genreFamilyDistribution: buildGenreFamilyDistribution(tracks),
    eraRange: intent.eraRange ?? null,
    primarySubgenre: intent.primarySubgenre ?? intent.secondarySubgenre ?? null,
    mood: [...(intent.mood ?? [])],
    activity: intent.activity ?? null,
    energyTarget: energyLevelToTarget(intent.energy ?? null) ?? meanEnergy(tracks),
    curatorIdentityType: curatorIdentity?.type ?? "unknown",
    dominantClusterId: cluster?.selectedClusterId ?? cluster?.dominantClusterId ?? null,
    meanPlaylistEnergy: meanEnergy(tracks),
  };
}

export function calculateTrackIdentityDistance(
  track: IdentityTrackLike,
  fingerprint: PlaylistFingerprintSummary,
  curatorIdentity: Pick<CuratorIdentity, "energyBias"> | null | undefined,
): number {
  let distance = 0;

  const trackFamily = (track.genreFamily ?? track.genrePrimary ?? "unknown").toLowerCase().trim() || "unknown";
  const families = fingerprint.lockedIntentFamilies.map((family) => family.toLowerCase());
  const distributionWeight = fingerprint.genreFamilyDistribution[trackFamily] ?? 0;
  if (families.length > 0 && !families.includes(trackFamily)) {
    distance += 0.28;
  } else if (distributionWeight < 0.08 && families.length > 0) {
    distance += 0.12;
  }

  const clusterId = fingerprint.dominantClusterId;
  if (clusterId) {
    const trackCluster = trackClusterId(track);
    if (trackCluster && trackCluster !== clusterId) {
      distance += 0.2;
    }
  }

  const energyTarget = fingerprint.energyTarget;
  if (energyTarget !== null && typeof track.energy === "number" && Number.isFinite(track.energy)) {
    const energyGap = Math.abs(track.energy - energyTarget);
    distance += Math.min(0.22, energyGap * 0.35);
  }

  if (curatorIdentity && typeof track.energy === "number" && Number.isFinite(track.energy)) {
    const bias = curatorIdentity.energyBias;
    const expected = Math.max(0, Math.min(1, 0.5 + bias * 0.25));
    const biasGap = Math.abs(track.energy - expected);
    distance += Math.min(0.1, biasGap * 0.2);
  }

  if (!trackMatchesSubgenre(track, fingerprint)) {
    distance += 0.14;
  }

  const year = typeof track.releaseYear === "number" && Number.isFinite(track.releaseYear)
    ? track.releaseYear
    : null;
  if (!trackInEraRange(year, fingerprint.eraRange)) {
    distance += 0.16;
  }

  return Math.min(1, Math.max(0, distance));
}

export function buildCrossSessionTrackHistory(priorPlaylistTrackLists: string[][]): CrossSessionTrackHistory {
  const trackPlaylistCount = new Map<string, number>();
  let crossSessionHistorySize = 0;

  for (const ids of priorPlaylistTrackLists) {
    const playlistIds = ids.filter((id) => id.trim().length > 0);
    if (playlistIds.length === 0) continue;
    crossSessionHistorySize += 1;
    const seen = new Set<string>();
    for (const id of playlistIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      trackPlaylistCount.set(id, (trackPlaylistCount.get(id) ?? 0) + 1);
    }
  }

  return { trackPlaylistCount, crossSessionHistorySize };
}

export function detectPromptExplicitAlbum(vibe: string): boolean {
  const patterns = [
    /\b(?:full|entire)\s+album\b/i,
    /\bsoundtrack\b/i,
    /\bost\b/i,
    /\b([a-z0-9&'.-]+(?:\s+[a-z0-9&'.-]+){0,5})\s+album\b/i,
    /\balbum\s+(?:by|from)\s+([a-z0-9&'.-]+(?:\s+[a-z0-9&'.-]+){0,4})\b/i,
  ];
  return patterns.some((pattern) => pattern.test(vibe));
}

function artistIsCentral(
  artist: string,
  promptCentralArtists: ReadonlySet<string> | undefined,
): boolean {
  if (!promptCentralArtists || promptCentralArtists.size === 0) return false;
  if (promptCentralArtists.has(artist)) return true;
  for (const central of promptCentralArtists) {
    if (artist.includes(central) || central.includes(artist)) return true;
  }
  return false;
}

function positionSwapUrgency(index: number): number {
  if (index < 5) return 1.0;
  if (index < 10) return 0.85;
  if (index < 20) return 0.6;
  return 0.4;
}

function maxQualityGap(crossSessionWins: number, hardSwap: boolean): number {
  if (hardSwap) return crossSessionWins >= 3 ? 0.2 : 0.12;
  if (crossSessionWins === 1) return 0.05;
  return 0.08;
}

function compareAlternatives<T extends IdentityTrackLike>(
  a: { index: number; track: T; score: number; distance: number; crossSessionWins: number },
  b: { index: number; track: T; score: number; distance: number; crossSessionWins: number },
  deterministic: boolean,
): number {
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.crossSessionWins !== b.crossSessionWins) return a.crossSessionWins - b.crossSessionWins;
  if (b.score !== a.score) return b.score - a.score;
  if (deterministic) return a.track.trackId.localeCompare(b.track.trackId);
  return a.index - b.index;
}

export function applyPlaylistIdentityDistance<T extends IdentityTrackLike>(
  tracks: T[],
  replacementPool: T[],
  history: CrossSessionTrackHistory,
  intent: IdentityIntentLike,
  curatorIdentity: Pick<CuratorIdentity, "type" | "energyBias"> | null | undefined,
  cluster: ClusterContext | undefined,
  opts?: PlaylistIdentityDistanceOpts<T>,
): { tracks: T[]; diagnostics: IdentityDistanceDiagnostics } {
  const scoreFn = opts?.scoreFn ?? defaultScore;
  const deterministic = opts?.auditDeterministic === true;
  const thinRelaxed = opts?.thinLibraryRelaxed === true;
  const explicitAlbumPrompt = opts?.explicitAlbumPrompt === true;
  const minAlternatives = opts?.minAlternativesForSwap ?? 2;
  const maxSwaps = opts?.maxSwaps ?? IDP_MAX_SWAPS_PER_PLAYLIST;
  const highDistanceThreshold = opts?.highDistanceThreshold ?? IDP_HIGH_DISTANCE_THRESHOLD;
  const canReplaceWith = opts?.canReplaceWith ?? (() => true);
  const promptCentralArtists = opts?.promptCentralArtists;

  const fingerprint = buildPlaylistFingerprint(tracks, intent, curatorIdentity, cluster);
  const distanceScores: Record<string, number> = {};
  for (const track of tracks) {
    distanceScores[track.trackId] = calculateTrackIdentityDistance(track, fingerprint, curatorIdentity);
  }

  const bypassReasons: string[] = [];
  const penalisedTracks: PenalisedTrackDiagnostic[] = [];

  if (thinRelaxed) bypassReasons.push("thin_library_relaxed");
  if (explicitAlbumPrompt) bypassReasons.push("explicit_album_prompt");
  if (promptCentralArtists && promptCentralArtists.size > 0) {
    bypassReasons.push("explicit_artist_prompt_guard");
  }
  if (history.crossSessionHistorySize === 0) bypassReasons.push("no_session_memory");

  const emptyDiagnostics: IdentityDistanceDiagnostics = {
    fingerprint,
    penalisedTracks,
    replacementCount: 0,
    distanceScores,
    bypassReasons,
    tracksConsidered: 0,
    swapsBlockedByConstraints: 0,
    relaxedDueToSupply: thinRelaxed,
    crossSessionHistorySize: history.crossSessionHistorySize,
  };

  if (
    tracks.length < 2
    || thinRelaxed
    || explicitAlbumPrompt
    || history.crossSessionHistorySize === 0
  ) {
    return { tracks: [...tracks], diagnostics: emptyDiagnostics };
  }

  const result = [...tracks];
  const poolById = new Map<string, T>();
  for (const track of replacementPool) poolById.set(track.trackId, track);
  for (const track of result) poolById.set(track.trackId, track);

  const freshTrackCount = [...poolById.values()].filter(
    (track) => (history.trackPlaylistCount.get(track.trackId) ?? 0) === 0,
  ).length;
  const relaxedDueToSupply = result.length < 12 || freshTrackCount < minAlternatives;
  if (relaxedDueToSupply) bypassReasons.push("insufficient_alternatives");

  let tracksConsidered = 0;
  let replacementCount = 0;
  let swapsBlockedByConstraints = 0;

  const penalizedIndices = result
    .map((track, index) => ({
      index,
      track,
      distance: distanceScores[track.trackId] ?? 0,
      crossSessionWins: history.trackPlaylistCount.get(track.trackId) ?? 0,
    }))
    .filter((row) => row.crossSessionWins > 0)
    .sort((a, b) => {
      const urgencyA = a.distance * positionSwapUrgency(a.index) + a.crossSessionWins * 0.05;
      const urgencyB = b.distance * positionSwapUrgency(b.index) + b.crossSessionWins * 0.05;
      return urgencyB - urgencyA || b.index - a.index;
    });

  for (const row of penalizedIndices) {
    if (replacementCount >= maxSwaps) {
      bypassReasons.push("max_swaps_reached");
      break;
    }

    const current = result[row.index]!;
    const artist = normalizeSessionArtist(current.artistName ?? "");
    if (artistIsCentral(artist, promptCentralArtists)) {
      penalisedTracks.push({
        trackId: current.trackId,
        artistName: current.artistName ?? null,
        identityDistance: row.distance,
        crossSessionWinCount: row.crossSessionWins,
        replaced: false,
        bypassReason: "explicit_artist_prompt",
      });
      continue;
    }

    if (row.distance < highDistanceThreshold) {
      penalisedTracks.push({
        trackId: current.trackId,
        artistName: current.artistName ?? null,
        identityDistance: row.distance,
        crossSessionWinCount: row.crossSessionWins,
        replaced: false,
        bypassReason: "distance_below_threshold",
      });
      continue;
    }

    tracksConsidered += 1;
    const currentScore = scoreFn(current);
    const hardSwap = !relaxedDueToSupply && row.crossSessionWins >= 2 && freshTrackCount >= minAlternatives;
    const gap = maxQualityGap(row.crossSessionWins, hardSwap);

    const alternatives: Array<{
      index: number;
      track: T;
      score: number;
      distance: number;
      crossSessionWins: number;
      fromPoolOnly: boolean;
    }> = [];

    const considerCandidate = (candidate: T, candidateIndex: number, fromPoolOnly: boolean): void => {
      if (candidate.trackId === current.trackId) return;
      const candidateArtist = normalizeSessionArtist(candidate.artistName ?? "");
      if (artistIsCentral(candidateArtist, promptCentralArtists)) return;

      const candidateWins = history.trackPlaylistCount.get(candidate.trackId) ?? 0;
      if (candidateWins >= row.crossSessionWins) return;

      const candidateDistance = calculateTrackIdentityDistance(candidate, fingerprint, curatorIdentity);
      if (candidateDistance >= row.distance) return;

      if (!canReplaceWith(current, candidate, row.index)) {
        swapsBlockedByConstraints += 1;
        return;
      }

      const score = scoreFn(candidate);
      if (score < currentScore - gap) return;

      alternatives.push({
        index: candidateIndex,
        track: candidate,
        score,
        distance: candidateDistance,
        crossSessionWins: candidateWins,
        fromPoolOnly,
      });
    };

    for (let j = row.index + 1; j < result.length; j += 1) {
      considerCandidate(result[j]!, j, false);
    }

    const inPlaylist = new Set(result.map((track) => track.trackId));
    for (const candidate of poolById.values()) {
      if (inPlaylist.has(candidate.trackId)) continue;
      considerCandidate(candidate, -1, true);
    }

    if (alternatives.length === 0) {
      penalisedTracks.push({
        trackId: current.trackId,
        artistName: current.artistName ?? null,
        identityDistance: row.distance,
        crossSessionWinCount: row.crossSessionWins,
        replaced: false,
        bypassReason: "no_valid_replacement",
      });
      continue;
    }

    alternatives.sort((a, b) => compareAlternatives(a, b, deterministic));
    const best = alternatives[0]!;

    if (!hardSwap && row.crossSessionWins === 1 && best.score < currentScore - 0.05) {
      penalisedTracks.push({
        trackId: current.trackId,
        artistName: current.artistName ?? null,
        identityDistance: row.distance,
        crossSessionWinCount: row.crossSessionWins,
        replaced: false,
        bypassReason: "soft_swap_quality_guard",
      });
      continue;
    }

    if (best.fromPoolOnly) {
      result[row.index] = best.track;
    } else {
      const swapIndex = best.index;
      result[row.index] = best.track;
      result[swapIndex] = current;
    }

    replacementCount += 1;
    penalisedTracks.push({
      trackId: current.trackId,
      artistName: current.artistName ?? null,
      identityDistance: row.distance,
      crossSessionWinCount: row.crossSessionWins,
      replaced: true,
      replacementTrackId: best.track.trackId,
    });
    distanceScores[best.track.trackId] = best.distance;
  }

  return {
    tracks: result,
    diagnostics: {
      fingerprint,
      penalisedTracks,
      replacementCount,
      distanceScores,
      bypassReasons: [...new Set(bypassReasons)],
      tracksConsidered,
      swapsBlockedByConstraints,
      relaxedDueToSupply,
      crossSessionHistorySize: history.crossSessionHistorySize,
    },
  };
}

export { detectPromptCentralArtists };
