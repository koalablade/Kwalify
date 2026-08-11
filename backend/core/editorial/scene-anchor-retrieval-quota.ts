/**
 * V19 Experiment B — generic bounded scene-anchor retrieval quota.
 * Injects priority-scene anchors from the eligible library pool when they are
 * absent from the post-retrieval candidate set but present in liked/eligible supply.
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { getPriorityAnchorOrder } from "./cultural-identity-profile";
import {
  matchPriorityAnchor,
  missingPriorityAnchors,
  sceneAnchorTier,
} from "./scene-anchor-spine";
import { passesMomentFitForRefill } from "./song-moment-fit";
import {
  isAnchorArtistForProfile,
  scoreTrackWorldIdentity,
  type WorldIdentityTrack,
} from "./world-identity-score";

/** Max library rows scanned when searching for missing anchors. */
export const SCENE_ANCHOR_RETRIEVAL_POOL_SCAN_CAP = 512;

/** Max tracks injected into retrieval per pipeline run. */
export const SCENE_ANCHOR_RETRIEVAL_INJECT_MAX = 3;

/** Top-N priority anchor names considered per run. */
export const SCENE_ANCHOR_SPINE_DEPTH = 2;

const MIN_WORLD_SCORE = 0.72;

export type SceneAnchorRetrievalInjection = {
  anchorName: string;
  trackId: string;
  artistName: string;
  trackName: string;
  worldScore: number;
  anchorTier: number;
};

export type SceneAnchorRetrievalDiagnostics = {
  attempted: boolean;
  missingAnchorNames: string[];
  poolScanSize: number;
  eligibleCandidates: number;
  momentFitCandidates: number;
  injected: SceneAnchorRetrievalInjection[];
  skippedReason?: string;
};

export type SceneAnchorRetrievalTrack = WorldIdentityTrack & {
  trackId: string;
};

function trackKey(track: SceneAnchorRetrievalTrack): string {
  return String(track.trackId ?? "").trim();
}

function normTitle(track: SceneAnchorRetrievalTrack): string {
  return `${track.artistName ?? ""}|${track.trackName ?? ""}`.toLowerCase();
}

/** Generic retrieval-side quota: add missing priority anchors from bounded eligible library. */
export function applySceneAnchorRetrievalQuota<T extends SceneAnchorRetrievalTrack>(
  retrievedTracks: T[],
  eligibleLibrary: T[],
  profile: CulturalWorldProfile,
  opts: { prompt?: string; spineDepth?: number; injectMax?: number; scanCap?: number } = {},
): { tracks: T[]; diagnostics: SceneAnchorRetrievalDiagnostics } {
  const spineDepth = opts.spineDepth ?? SCENE_ANCHOR_SPINE_DEPTH;
  const injectMax = opts.injectMax ?? SCENE_ANCHOR_RETRIEVAL_INJECT_MAX;
  const scanCap = opts.scanCap ?? SCENE_ANCHOR_RETRIEVAL_POOL_SCAN_CAP;
  const prompt = opts.prompt ?? "";

  const emptyDiagnostics = (skippedReason?: string): SceneAnchorRetrievalDiagnostics => ({
    attempted: false,
    missingAnchorNames: [],
    poolScanSize: 0,
    eligibleCandidates: 0,
    momentFitCandidates: 0,
    injected: [],
    skippedReason,
  });

  if (getPriorityAnchorOrder(profile).length === 0) {
    return { tracks: retrievedTracks.slice(), diagnostics: emptyDiagnostics("no_priority_anchors") };
  }
  if (retrievedTracks.length === 0 || eligibleLibrary.length === 0) {
    return { tracks: retrievedTracks.slice(), diagnostics: emptyDiagnostics("empty_pool") };
  }

  const scannedLibrary = eligibleLibrary.slice(0, scanCap);
  const missingNames = missingPriorityAnchors(retrievedTracks, scannedLibrary, profile, spineDepth);
  if (missingNames.length === 0) {
    return {
      tracks: retrievedTracks.slice(),
      diagnostics: {
        attempted: true,
        missingAnchorNames: [],
        poolScanSize: scannedLibrary.length,
        eligibleCandidates: 0,
        momentFitCandidates: 0,
        injected: [],
        skippedReason: "anchors_already_represented_or_absent_from_library",
      },
    };
  }

  const presentIds = new Set(retrievedTracks.map(trackKey).filter(Boolean));
  const presentTitles = new Set(retrievedTracks.map(normTitle));
  const working = retrievedTracks.slice();
  const injected: SceneAnchorRetrievalInjection[] = [];
  let eligibleCandidates = 0;
  let momentFitCandidates = 0;

  for (const anchorName of missingNames) {
    if (injected.length >= injectMax) break;

    let bestTrack: T | null = null;
    let bestScore = -1;
    let bestTier = 0;

    for (const candidate of scannedLibrary) {
      const id = trackKey(candidate);
      if (!id || presentIds.has(id)) continue;
      if (presentTitles.has(normTitle(candidate))) continue;
      if (!matchPriorityAnchor(String(candidate.artistName ?? ""), anchorName)) continue;

      const worldScore = scoreTrackWorldIdentity(candidate, profile);
      const anchorArtist = isAnchorArtistForProfile(String(candidate.artistName ?? ""), profile);
      if (!anchorArtist && worldScore < MIN_WORLD_SCORE) continue;
      eligibleCandidates += 1;

      if (!passesMomentFitForRefill(candidate, prompt)) continue;
      momentFitCandidates += 1;

      const tier = sceneAnchorTier(profile, String(candidate.artistName ?? ""));
      const rank = tier * 10 + worldScore;
      if (rank > bestScore || (rank === bestScore && tier > bestTier)) {
        bestScore = rank;
        bestTier = tier;
        bestTrack = candidate;
      }
    }

    if (!bestTrack) continue;

    working.push(bestTrack);
    presentIds.add(trackKey(bestTrack)!);
    presentTitles.add(normTitle(bestTrack));
    injected.push({
      anchorName,
      trackId: trackKey(bestTrack),
      artistName: String(bestTrack.artistName ?? ""),
      trackName: String(bestTrack.trackName ?? ""),
      worldScore: scoreTrackWorldIdentity(bestTrack, profile),
      anchorTier: bestTier,
    });
  }

  return {
    tracks: working,
    diagnostics: {
      attempted: true,
      missingAnchorNames: missingNames,
      poolScanSize: scannedLibrary.length,
      eligibleCandidates,
      momentFitCandidates,
      injected,
    },
  };
}
