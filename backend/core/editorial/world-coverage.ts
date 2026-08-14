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

export type CoverageTier = "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW" | "NONE";
export type CoverageLevel = "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";
const GENUINE_WORLD_SCORE_MIN = 0.5;

export function isGenuineWorldCandidate(track: WorldIdentityTrack, culturalProfile: CulturalWorldProfile | null): boolean {
  if (!culturalProfile) return true;
  const artist = String(track.artistName ?? "").trim();
  if (artist && isAnchorArtistForProfile(artist, culturalProfile)) return true;
  return scoreTrackWorldIdentity(track, culturalProfile) >= GENUINE_WORLD_SCORE_MIN;
}

export function countGenuineWorldCandidates(candidatePool: WorldIdentityTrack[], culturalProfile: CulturalWorldProfile | null): number {
  return candidatePool.filter((t) => isGenuineWorldCandidate(t, culturalProfile)).length;
}

export function assessCandidateCoverageTier(candidatePool: WorldIdentityTrack[], culturalProfile: CulturalWorldProfile | null): CoverageTier {
  const count = countGenuineWorldCandidates(candidatePool, culturalProfile);
  if (count >= 20) return "HIGH";
  if (count >= 12) return "MEDIUM";
  if (count >= 6) return "LOW";
  if (count >= 1) return "VERY_LOW";
  return "NONE";
}

export type DeliveryTarget = { min: number; max: number };
export function getDeliveryTarget(tier: CoverageTier): DeliveryTarget | null {
  switch (tier) {
    case "HIGH": return { min: 20, max: 25 };
    case "MEDIUM": return { min: 15, max: 20 };
    case "LOW": return { min: 6, max: 12 };
    case "VERY_LOW": return { min: 3, max: 5 };
    case "NONE": return null;
    default: return null;
  }
}

/**
 * Base tier ceiling remains conservative for callers that have not validated deeper delivery.
 * Once downstream purity/world gates have actually validated a deeper set, that validated
 * depth is authoritative; the old LOW=12 / MEDIUM=20 ceiling must not throw those tracks away.
 */
export function getDeliveryCap(tier: CoverageTier, requestedLength = 25, validatedTrackCount?: number): number {
  const requested = Math.max(1, requestedLength);
  const baseCap = tier === "HIGH" ? Math.min(25, requested)
    : tier === "MEDIUM" ? Math.min(20, requested)
    : tier === "LOW" ? Math.min(12, requested)
    : tier === "VERY_LOW" ? 5
    : tier === "NONE" ? 0
    : requested;
  if (typeof validatedTrackCount !== "number" || !Number.isFinite(validatedTrackCount)) return baseCap;
  return Math.min(requested, Math.max(baseCap, Math.max(0, Math.floor(validatedTrackCount))));
}

export function coverageLevelToDeliveryTier(level: CoverageLevel): CoverageTier { return level; }
export function buildDeliveryMessage(trackCount: number, tier: CoverageTier | null): string | null {
  if (trackCount <= 0 || tier == null || tier === "HIGH" || tier === "NONE") return null;
  return `Built a focused ${trackCount}-track version because your library had limited matches for this world.`;
}

export type WorldCoverageAssessment = { score: CoverageLevel; anchorHits: number; adjacentHits: number; weakHits: number; numericScore: number };
export function coverageLevelToMaxTracks(level: CoverageLevel, requestedLength: number, validatedTrackCount?: number): number {
  return getDeliveryCap(coverageLevelToDeliveryTier(level), requestedLength, validatedTrackCount);
}

export function coverageUserMessage(level: CoverageLevel): string {
  switch (level) {
    case "HIGH": return "Built from your library.";
    case "MEDIUM": return "Built from your taste + a wider search.";
    case "LOW": return "Your library is thin for this world — found the strongest matches.";
    case "VERY_LOW": return "Your library doesn't have enough tracks for this world — showing only what genuinely fits.";
    default: return "Built from your library.";
  }
}
export function shouldExpandWorldCoverage(level: CoverageLevel): boolean { return level === "LOW" || level === "MEDIUM" || level === "VERY_LOW"; }

export function assessWorldCoverage(committedWorld: CommittedWorld | null, candidatePool: WorldIdentityTrack[], culturalProfile: CulturalWorldProfile | null): WorldCoverageAssessment {
  if (!committedWorld?.hardLock || !culturalProfile || candidatePool.length === 0) {
    return { score: candidatePool.length >= 12 ? "HIGH" : "MEDIUM", anchorHits: 0, adjacentHits: 0, weakHits: 0, numericScore: candidatePool.length >= 12 ? 0.85 : 0.55 };
  }
  let anchorHits = 0; let adjacentHits = 0; let weakHits = 0;
  for (const track of candidatePool) {
    const artist = String(track.artistName ?? "").trim();
    if (!artist) continue;
    if (isAnchorArtistForProfile(artist, culturalProfile)) { anchorHits += 1; continue; }
    if (matchesAdjacentArtist(artist, culturalProfile)) { adjacentHits += 1; continue; }
    const worldScore = scoreTrackWorldIdentity(track, culturalProfile);
    if (worldScore >= 0.8) adjacentHits += 1;
    else if (worldScore >= 0.45) weakHits += 1;
  }
  const poolSize = candidatePool.length;
  const anchorRatio = anchorHits / poolSize;
  const strongRatio = (anchorHits + adjacentHits) / poolSize;
  const numericScore = Math.min(1, anchorRatio * 0.55 + strongRatio * 0.35 + (weakHits / poolSize) * 0.1);
  let score: CoverageLevel;
  if (anchorHits >= 3 && strongRatio >= 0.12) score = "HIGH";
  else if (anchorHits >= 1 || adjacentHits >= 4 || anchorHits + adjacentHits >= 3) score = "MEDIUM";
  else if (weakHits >= 2 || anchorHits + adjacentHits >= 1 || strongRatio >= 0.02) score = "LOW";
  else score = "VERY_LOW";
  return { score, anchorHits, adjacentHits, weakHits, numericScore };
}

export type WorldCoverageTier = "liked_world" | "library_adjacent" | "anchor_discovery";
export function classifyWorldCoverageTier(track: WorldIdentityTrack, culturalProfile: CulturalWorldProfile, isUserLiked: boolean, isExpansionCandidate: boolean): WorldCoverageTier {
  const artist = String(track.artistName ?? "").trim();
  if (isExpansionCandidate) return "anchor_discovery";
  if (isUserLiked && scoreTrackWorldIdentity(track, culturalProfile) >= 0.45) return "liked_world";
  if (matchesAdjacentArtist(artist, culturalProfile) || scoreTrackWorldIdentity(track, culturalProfile) >= 0.65) return "library_adjacent";
  return "anchor_discovery";
}
const TIER_PRIORITY: Record<WorldCoverageTier, number> = { liked_world: 3, library_adjacent: 2, anchor_discovery: 1 };
export function compareWorldCoverageTier(tierA: WorldCoverageTier, tierB: WorldCoverageTier): number { return TIER_PRIORITY[tierA] - TIER_PRIORITY[tierB]; }

export type RetrievalConfidenceResult = { score: number; tier: CoverageTier; refuse: boolean; reasons: string[] };
export function computeRetrievalConfidence(candidatePool: WorldIdentityTrack[], culturalProfile: CulturalWorldProfile | null, opts?: { anchorHits?: number; avgWorldScore?: number }): RetrievalConfidenceResult {
  const genuineCount = countGenuineWorldCandidates(candidatePool, culturalProfile);
  const coverageTier = assessCandidateCoverageTier(candidatePool, culturalProfile);
  let anchorHits = opts?.anchorHits ?? 0;
  if (anchorHits === 0 && culturalProfile) for (const track of candidatePool) { const artist = String(track.artistName ?? "").trim(); if (artist && isAnchorArtistForProfile(artist, culturalProfile)) anchorHits += 1; }
  let avgWorldScore = opts?.avgWorldScore;
  if (avgWorldScore == null && culturalProfile && candidatePool.length > 0) avgWorldScore = candidatePool.reduce((acc, t) => acc + scoreTrackWorldIdentity(t, culturalProfile), 0) / candidatePool.length;
  const identityConfidence = anchorHits >= 2 ? 1 : anchorHits >= 1 ? 0.85 : 0.55;
  const qualityConfidence = avgWorldScore != null ? Math.min(1, avgWorldScore / 0.75) : 0.5;
  const countConfidence = genuineCount >= 20 ? 1 : genuineCount >= 12 ? 0.82 : genuineCount >= 6 ? 0.58 : genuineCount >= 3 ? 0.42 : 0.15;
  const score = Math.round(Math.min(100, Math.max(0, countConfidence * 50 + identityConfidence * 30 + qualityConfidence * 20)));
  const reasons: string[] = [];
  if (genuineCount >= 20) reasons.push("strong_world_pool"); else if (genuineCount >= 12) reasons.push("honest_playlist_pool"); else if (genuineCount >= 6) reasons.push("partial_pool"); else if (genuineCount >= 3) reasons.push("very_low_pool"); else reasons.push("insufficient_genuine_candidates");
  const refuse = score < 40 || coverageTier === "NONE";
  return { score, tier: coverageTier, refuse, reasons };
}
