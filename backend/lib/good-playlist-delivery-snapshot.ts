/**
 * Immutable good-playlist delivery snapshot — written once at goodPlaylistReady.
 * Used by timeout fallback to return the last known good playlist before generic fallback.
 */

import type { PatternScoringTrack } from "../core/editorial/human-playlist-patterns";
import {
  evaluatePlaylistCurationBelievability,
  type PlaylistCurationScoringContext,
} from "../core/editorial/would-i-save-evaluator";
import { isGenuinelyUsablePlaylist } from "./good-playlist-refinement-telemetry";

export type TimeoutFallbackSource =
  | "good_playlist_snapshot"
  | "finalized_playlist"
  | "generic_fallback";

export type GoodPlaylistDeliverableTrack = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  albumArt?: string | null;
  durationMs?: number | null;
  energy: number | null;
  valence: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  score?: number;
  rediscoveryScore?: number;
  laneScore?: number | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  clusterIds?: string[];
  clusterId?: string | null;
};

export type GoodPlaylistDeliverySnapshot = {
  readyAtMs: number;
  elapsedMs: number;
  confidence: number;
  trackIds: readonly string[];
  tracks: readonly GoodPlaylistDeliverableTrack[];
  genuinelyUsable: boolean;
  scoringContext: PlaylistCurationScoringContext;
};

export type GoodPlaylistDeliverySnapshotStore = {
  goodPlaylistDeliverySnapshot?: GoodPlaylistDeliverySnapshot;
};

function confidenceFor(
  tracks: PatternScoringTrack[],
  scoringContext: PlaylistCurationScoringContext,
): number {
  return Math.round(
    evaluatePlaylistCurationBelievability({
      prompt: scoringContext.prompt,
      tracks,
      targetLength: scoringContext.targetLength,
      context: scoringContext.context,
      lockedIntent: scoringContext.lockedIntent,
      libraryFingerprint: scoringContext.libraryFingerprint,
    }).believabilityScore * 1000,
  ) / 1000;
}

function freezeTracks(tracks: GoodPlaylistDeliverableTrack[]): readonly GoodPlaylistDeliverableTrack[] {
  return Object.freeze(tracks.map((track) => Object.freeze({ ...track })));
}

export function persistGoodPlaylistDeliverySnapshot(
  store: GoodPlaylistDeliverySnapshotStore,
  input: {
    readyAtMs: number;
    elapsedMs: number;
    deliverableTracks: GoodPlaylistDeliverableTrack[];
    scoringContext: PlaylistCurationScoringContext;
    targetLength: number;
  },
): GoodPlaylistDeliverySnapshot | null {
  if (store.goodPlaylistDeliverySnapshot) return store.goodPlaylistDeliverySnapshot;
  if (input.deliverableTracks.length === 0) return null;

  const tracks = freezeTracks(input.deliverableTracks);
  const patternTracks: PatternScoringTrack[] = tracks.map((track) => ({
    trackId: track.trackId,
    artistName: track.artistName,
    energy: track.energy,
    valence: track.valence,
    danceability: track.danceability ?? null,
    acousticness: track.acousticness ?? null,
    laneScore: track.laneScore ?? undefined,
    score: track.score,
  }));

  const snapshot: GoodPlaylistDeliverySnapshot = Object.freeze({
    readyAtMs: input.readyAtMs,
    elapsedMs: input.elapsedMs,
    confidence: confidenceFor(patternTracks, input.scoringContext),
    trackIds: Object.freeze(tracks.map((track) => track.trackId)),
    tracks,
    genuinelyUsable: isGenuinelyUsablePlaylist(tracks.length, input.targetLength),
    scoringContext: { ...input.scoringContext },
  });

  store.goodPlaylistDeliverySnapshot = snapshot;
  return snapshot;
}

export function readGoodPlaylistDeliverySnapshot(
  store: GoodPlaylistDeliverySnapshotStore | undefined,
): GoodPlaylistDeliverySnapshot | null {
  return store?.goodPlaylistDeliverySnapshot ?? null;
}

export function resolveTimeoutFallbackDeliverableTracks(
  ctx: Record<string, unknown> | undefined,
): {
  source: Exclude<TimeoutFallbackSource, "generic_fallback">;
  tracks: GoodPlaylistDeliverableTrack[];
} | null {
  const snapshot = readGoodPlaylistDeliverySnapshot(ctx as GoodPlaylistDeliverySnapshotStore | undefined);
  if (snapshot && snapshot.tracks.length > 0) {
    return {
      source: "good_playlist_snapshot",
      tracks: [...snapshot.tracks],
    };
  }

  const finalizedTracks = Array.isArray(ctx?.finalTracks) ? ctx.finalTracks as GoodPlaylistDeliverableTrack[] : [];
  if (finalizedTracks.length > 0) {
    return {
      source: "finalized_playlist",
      tracks: finalizedTracks.map((track) => ({ ...track })),
    };
  }

  return null;
}
