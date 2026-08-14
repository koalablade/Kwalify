/**
 * Track 1 thesis gate — opener must prove the committed world (>= 0.8 identity or anchor artist).
 * V11: ALWAYS promote highest world-identity anchor to slot 0 after expansion merge + ranking.
 */

import type { CommittedWorld } from "../committed-world";
import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { matchesAdjacentArtist, getPriorityAnchorOrder } from "./cultural-identity-profile";
import {
  resolveCulturalProfileForCommitted,
  scoreTrackWorldIdentity,
  isAnchorArtistForProfile,
  type WorldIdentityTrack,
} from "./world-identity-score";
import { promoteWorldThesisOpener, rankThesisOpenerCandidate, isRemixBaitTrackTitle } from "./opener-hygiene";
import { trackMatchesExcludedArtist } from "../../lib/prompt-negation-enforcement";

export const THESIS_OPENER_MIN_SCORE = 0.8;
export const THESIS_OPENER_UNDENIABLE_SCORE = 0.85;

export type ThesisOpenerResult<T extends WorldIdentityTrack> = {
  tracks: T[];
  passed: boolean;
  promoted: boolean;
  fromIndex: number;
  openerScore: number;
  failures: string[];
  refuseMessage: string | null;
};

export function trackMeetsThesisOpener(
  track: WorldIdentityTrack,
  committed: CommittedWorld | null,
): { passed: boolean; score: number } {
  if (!committed?.hardLock) return { passed: true, score: 1 };
  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) return { passed: true, score: 0.75 };
  const score = scoreTrackWorldIdentity(track, profile);
  const anchor = isAnchorArtistForProfile(track.artistName, profile);
  const title = String(track.trackName ?? "").trim();
  if (isRemixBaitTrackTitle(title) && !anchor) {
    return { passed: false, score };
  }
  const minScore = profile.openerRules.minWorldIdentityScore ?? THESIS_OPENER_MIN_SCORE;
  return { passed: anchor || score >= minScore, score };
}

function dedupeKey(track: WorldIdentityTrack): string {
  return `${String(track.artistName ?? "").trim().toLowerCase()}|${String(track.trackName ?? "").trim().toLowerCase()}`;
}

function buildSearchPool<T extends WorldIdentityTrack>(
  tracks: T[],
  expansionCandidates?: T[],
  excludedArtists: string[] = [],
): T[] {
  const filterExcluded = (list: T[]) =>
    excludedArtists.length > 0
      ? list.filter((track) => !trackMatchesExcludedArtist(track.artistName, excludedArtists))
      : list;
  const base = filterExcluded(tracks);
  if (!expansionCandidates || expansionCandidates.length === 0) return base;
  const seen = new Set(base.map(dedupeKey));
  const merged = base.slice();
  for (const candidate of filterExcluded(expansionCandidates)) {
    const key = dedupeKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged;
}

function anchorPriorityBoost(artist: string, profile: CulturalWorldProfile): number {
  const order = getPriorityAnchorOrder(profile);
  const normalized = String(artist ?? "").trim().toLowerCase();
  if (!normalized) return 0;
  for (let i = 0; i < order.length; i++) {
    const anchor = order[i]!.toLowerCase();
    if (normalized.includes(anchor) || anchor.includes(normalized)) {
      return (order.length - i) * 200;
    }
  }
  return 0;
}

function rankOpenerForProfile<T extends WorldIdentityTrack>(
  track: T,
  profile: CulturalWorldProfile,
): number {
  const title = String(track.trackName ?? "").trim();
  const anchor = isAnchorArtistForProfile(track.artistName, profile);
  if (isRemixBaitTrackTitle(title) && !anchor) return -1;
  const base = rankThesisOpenerCandidate(
    track,
    profile,
    (t) => scoreTrackWorldIdentity(t, profile),
    (artist) => isAnchorArtistForProfile(artist, profile),
    (artist) => matchesAdjacentArtist(artist, profile),
  );
  if (base < 0) return base;
  return base + anchorPriorityBoost(String(track.artistName ?? ""), profile);
}

/**
 * V15 thesis opener selection — always return the best anchor in the pool.
 * Prefers 95+ world score; when none exist, promotes highest worldIdentityScore anchor.
 */
export function selectThesisOpener<T extends WorldIdentityTrack>(
  candidates: T[],
  profile: CulturalWorldProfile,
  searchDepth = 20,
  excludedArtists: string[] = [],
): { track: T; score: number; isAnchor: boolean; index: number } | null {
  const pool = excludedArtists.length > 0
    ? candidates.filter((track) => !trackMatchesExcludedArtist(track.artistName, excludedArtists))
    : candidates;
  if (pool.length === 0) return null;

  const depth = Math.min(searchDepth, pool.length);
  let bestIdx = 0;
  let bestRank = -1;
  for (let i = 0; i < depth; i++) {
    const rank = rankOpenerForProfile(pool[i]!, profile);
    if (rank > bestRank) {
      bestRank = rank;
      bestIdx = i;
    }
  }
  if (bestRank < 0) return null;

  const track = pool[bestIdx]!;
  return {
    track,
    score: scoreTrackWorldIdentity(track, profile),
    isAnchor: isAnchorArtistForProfile(track.artistName, profile),
    index: bestIdx,
  };
}

/**
 * Final thesis opener enforcement — ALWAYS reorder highest world-identity anchor to slot 0.
 * Runs after expansion merge + ranking. V15: never refuse when any anchor exists in pool.
 */
export function enforceThesisOpener<T extends WorldIdentityTrack>(
  tracks: T[],
  profile: CulturalWorldProfile | null,
  committed: CommittedWorld | null,
  expansionCandidates?: T[],
  searchDepth = 20,
  excludedArtists: string[] = [],
): ThesisOpenerResult<T> {
  if (!committed?.hardLock || tracks.length === 0) {
    return { tracks, passed: true, promoted: false, fromIndex: 0, openerScore: 1, failures: [], refuseMessage: null };
  }
  if (!profile) {
    return { tracks, passed: true, promoted: false, fromIndex: 0, openerScore: 0.75, failures: [], refuseMessage: null };
  }

  const minScore = profile.openerRules.minWorldIdentityScore ?? THESIS_OPENER_MIN_SCORE;
  const searchPool = buildSearchPool(tracks, expansionCandidates, excludedArtists);
  const selected = selectThesisOpener(searchPool, profile, searchDepth, excludedArtists);

  let out =
    excludedArtists.length > 0
      ? tracks.filter((track) => !trackMatchesExcludedArtist(track.artistName, excludedArtists))
      : tracks.slice();
  let promoted = false;
  let fromIndex = 0;

  if (selected) {
    const bestTrack = selected.track;
    const existingIdx = out.findIndex((t) => dedupeKey(t) === dedupeKey(bestTrack));
    if (existingIdx > 0) {
      const [moved] = out.splice(existingIdx, 1);
      if (moved) out.unshift(moved);
      promoted = true;
      fromIndex = existingIdx;
    } else if (existingIdx < 0) {
      out = [bestTrack, ...out.filter((t) => dedupeKey(t) !== dedupeKey(bestTrack))];
      promoted = true;
      fromIndex = -1;
    } else if (selected.index > 0) {
      const thesis = promoteWorldThesisOpener(
        out,
        (_, idx) => scoreTrackWorldIdentity(out[idx]!, profile),
        searchDepth,
        (track) => rankOpenerForProfile(track, profile),
      );
      out = thesis.tracks;
      promoted = thesis.promoted;
      fromIndex = thesis.fromIndex;
    }
  }

  const opener = out[0]!;
  const openerCheck = trackMeetsThesisOpener(opener, committed);
  const openerScore = selected?.score ?? openerCheck.score;
  const openerAnchor = selected?.isAnchor ?? isAnchorArtistForProfile(opener.artistName, profile);
  const label = `${opener.artistName ?? "?"} — ${opener.trackName ?? "?"}`;

  // V15: never refuse because track 1 is 92 instead of 95 — best anchor always ships
  if (selected && (openerAnchor || openerScore >= minScore || openerScore >= THESIS_OPENER_MIN_SCORE)) {
    return {
      tracks: out,
      passed: true,
      promoted,
      fromIndex,
      openerScore,
      failures: [],
      refuseMessage: null,
    };
  }

  if (!openerCheck.passed) {
    return {
      tracks: out,
      passed: false,
      promoted,
      fromIndex,
      openerScore: openerCheck.score,
      failures: [`thesis_opener_failed:${label}`],
      refuseMessage:
        "I couldn't find a track 1 that genuinely proves this musical world in your library. " +
        "Publishing a mismatched opener would break trust — try Discovery Mode or broaden the prompt.",
    };
  }

  return {
    tracks: out,
    passed: true,
    promoted,
    fromIndex,
    openerScore: openerCheck.score,
    failures: [],
    refuseMessage: null,
  };
}

/** Enforce thesis opener — promote best anchor if track 1 fails. */
export function enforceThesisOpenerGate<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  searchDepth = 15,
  expansionCandidates?: T[],
): ThesisOpenerResult<T> {
  const profile = resolveCulturalProfileForCommitted(committed);
  return enforceThesisOpener(tracks, profile, committed, expansionCandidates, searchDepth);
}
