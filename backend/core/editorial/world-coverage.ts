/**
 * World coverage assessment — measures how well the user library supports a committed world.
 * Drives anchor expansion and honest coverage UX states.
 */

import type { CommittedWorld } from "../committed-world";
import type { CulturalWorldProfile } from "./cultural-identity-profile";
import {
  isAnchorArtistForProfile,
  scoreTrackWorldIdentity,
  type WorldIdentityTrack,
} from "./world-identity-score";
import { matchesAdjacentArtist } from "./cultural-identity-profile";

export type CoverageLevel = "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";

export type WorldCoverageAssessment = {
  score: CoverageLevel;
  anchorHits: number;
  adjacentHits: number;
  weakHits: number;
  numericScore: number;
};

export function coverageLevelToMaxTracks(level: CoverageLevel, requestedLength: number): number {
  const requested = Math.max(1, requestedLength);
  switch (level) {
    case "HIGH":
      return Math.min(25, requested);
    case "MEDIUM":
      return Math.min(20, Math.max(15, Math.ceil(requested * 0.7)));
    case "LOW":
      return Math.min(12, Math.max(8, Math.ceil(requested * 0.4)));
    case "VERY_LOW":
      return Math.min(8, Math.max(3, Math.ceil(requested * 0.25)));
    default:
      return requested;
  }
}

export function coverageUserMessage(level: CoverageLevel): string {
  switch (level) {
    case "HIGH":
      return "Built from your library.";
    case "MEDIUM":
      return "Built from your taste + a wider search.";
    case "LOW":
      return "Your library is thin for this world — found the strongest matches.";
    case "VERY_LOW":
      return "Your library doesn't have enough tracks for this world — showing only what genuinely fits.";
    default:
      return "Built from your library.";
  }
}

export function shouldExpandWorldCoverage(level: CoverageLevel): boolean {
  return level === "LOW" || level === "MEDIUM";
}

/** Assess library coverage for a committed world before final retrieval ranking. */
export function assessWorldCoverage(
  committedWorld: CommittedWorld | null,
  candidatePool: WorldIdentityTrack[],
  culturalProfile: CulturalWorldProfile | null,
): WorldCoverageAssessment {
  if (!committedWorld?.hardLock || !culturalProfile || candidatePool.length === 0) {
    return {
      score: candidatePool.length >= 12 ? "HIGH" : "MEDIUM",
      anchorHits: 0,
      adjacentHits: 0,
      weakHits: 0,
      numericScore: candidatePool.length >= 12 ? 0.85 : 0.55,
    };
  }

  let anchorHits = 0;
  let adjacentHits = 0;
  let weakHits = 0;

  for (const track of candidatePool) {
    const artist = String(track.artistName ?? "").trim();
    if (!artist) continue;

    if (isAnchorArtistForProfile(artist, culturalProfile)) {
      anchorHits += 1;
      continue;
    }
    if (matchesAdjacentArtist(artist, culturalProfile)) {
      adjacentHits += 1;
      continue;
    }

    const worldScore = scoreTrackWorldIdentity(track, culturalProfile);
    if (worldScore >= 0.8) {
      adjacentHits += 1;
    } else if (worldScore >= 0.45) {
      weakHits += 1;
    }
  }

  const poolSize = candidatePool.length;
  const anchorRatio = anchorHits / poolSize;
  const strongRatio = (anchorHits + adjacentHits) / poolSize;
  const numericScore = Math.min(
    1,
    anchorRatio * 0.55 + strongRatio * 0.35 + (weakHits / poolSize) * 0.1,
  );

  let score: CoverageLevel;
  if (anchorHits >= 3 && strongRatio >= 0.12) {
    score = "HIGH";
  } else if (anchorHits >= 1 || adjacentHits >= 4 || anchorHits + adjacentHits >= 3) {
    score = "MEDIUM";
  } else if (weakHits >= 2 || anchorHits + adjacentHits >= 1 || strongRatio >= 0.02) {
    score = "LOW";
  } else {
    score = "VERY_LOW";
  }

  return { score, anchorHits, adjacentHits, weakHits, numericScore };
}

export type WorldCoverageTier = "liked_world" | "library_adjacent" | "anchor_discovery";

export function classifyWorldCoverageTier(
  track: WorldIdentityTrack,
  culturalProfile: CulturalWorldProfile,
  isUserLiked: boolean,
  isExpansionCandidate: boolean,
): WorldCoverageTier {
  const artist = String(track.artistName ?? "").trim();
  if (isExpansionCandidate) return "anchor_discovery";
  if (isUserLiked && scoreTrackWorldIdentity(track, culturalProfile) >= 0.45) {
    return "liked_world";
  }
  if (matchesAdjacentArtist(artist, culturalProfile) || scoreTrackWorldIdentity(track, culturalProfile) >= 0.65) {
    return "library_adjacent";
  }
  return "anchor_discovery";
}

const TIER_PRIORITY: Record<WorldCoverageTier, number> = {
  liked_world: 3,
  library_adjacent: 2,
  anchor_discovery: 1,
};

export function compareWorldCoverageTier(
  tierA: WorldCoverageTier,
  tierB: WorldCoverageTier,
): number {
  return TIER_PRIORITY[tierA] - TIER_PRIORITY[tierB];
}
