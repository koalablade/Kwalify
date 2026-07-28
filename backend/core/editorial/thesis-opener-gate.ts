/**
 * Track 1 thesis gate — opener must prove the committed world (>= 0.8 identity or anchor artist).
 * V11: ALWAYS promote highest world-identity anchor to slot 0 after expansion merge + ranking.
 */

import type { CommittedWorld } from "../committed-world";
import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { matchesAdjacentArtist } from "./cultural-identity-profile";
import {
  resolveCulturalProfileForCommitted,
  scoreTrackWorldIdentity,
  isAnchorArtistForProfile,
  type WorldIdentityTrack,
} from "./world-identity-score";
import { promoteWorldThesisOpener, rankThesisOpenerCandidate } from "./opener-hygiene";

export const THESIS_OPENER_MIN_SCORE = 0.8;

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
  const minScore = profile.openerRules.minWorldIdentityScore ?? THESIS_OPENER_MIN_SCORE;
  return { passed: anchor || score >= minScore, score };
}

function dedupeKey(track: WorldIdentityTrack): string {
  return `${String(track.artistName ?? "").trim().toLowerCase()}|${String(track.trackName ?? "").trim().toLowerCase()}`;
}

function buildSearchPool<T extends WorldIdentityTrack>(
  tracks: T[],
  expansionCandidates?: T[],
): T[] {
  if (!expansionCandidates || expansionCandidates.length === 0) return tracks;
  const seen = new Set(tracks.map(dedupeKey));
  const merged = tracks.slice();
  for (const candidate of expansionCandidates) {
    const key = dedupeKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged;
}

function rankOpenerForProfile<T extends WorldIdentityTrack>(
  track: T,
  profile: CulturalWorldProfile,
): number {
  return rankThesisOpenerCandidate(
    track,
    profile,
    (t) => scoreTrackWorldIdentity(t, profile),
    (artist) => isAnchorArtistForProfile(artist, profile),
    (artist) => matchesAdjacentArtist(artist, profile),
  );
}

/**
 * Final thesis opener enforcement — ALWAYS reorder highest world-identity anchor to slot 0.
 * Runs after expansion merge + ranking. Refuses when no candidate scores >= min threshold.
 */
export function enforceThesisOpener<T extends WorldIdentityTrack>(
  tracks: T[],
  profile: CulturalWorldProfile | null,
  committed: CommittedWorld | null,
  expansionCandidates?: T[],
  searchDepth = 20,
): ThesisOpenerResult<T> {
  if (!committed?.hardLock || tracks.length === 0) {
    return { tracks, passed: true, promoted: false, fromIndex: 0, openerScore: 1, failures: [], refuseMessage: null };
  }
  if (!profile) {
    return { tracks, passed: true, promoted: false, fromIndex: 0, openerScore: 0.75, failures: [], refuseMessage: null };
  }

  const minScore = profile.openerRules.minWorldIdentityScore ?? THESIS_OPENER_MIN_SCORE;
  const searchPool = buildSearchPool(tracks, expansionCandidates);

  let bestIdx = 0;
  let bestRank = -1;
  const depth = Math.min(searchDepth, searchPool.length);
  for (let i = 0; i < depth; i++) {
    const rank = rankOpenerForProfile(searchPool[i]!, profile);
    if (rank > bestRank) {
      bestRank = rank;
      bestIdx = i;
    }
  }

  const bestTrack = searchPool[bestIdx]!;
  const bestIdentity = scoreTrackWorldIdentity(bestTrack, profile);
  const bestAnchor = isAnchorArtistForProfile(bestTrack.artistName, profile);
  const openerQualifies = bestAnchor || bestIdentity >= minScore;

  let out = tracks.slice();
  let promoted = false;
  let fromIndex = 0;

  if (openerQualifies) {
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
    } else if (bestIdx > 0) {
      const thesis = promoteWorldThesisOpener(
        out,
        (_, idx) => scoreTrackWorldIdentity(out[idx]!, profile),
        depth,
        (track) => rankOpenerForProfile(track, profile),
      );
      out = thesis.tracks;
      promoted = thesis.promoted;
      fromIndex = thesis.fromIndex;
    }
  } else {
    const thesis = promoteWorldThesisOpener(
      searchPool,
      (_, idx) => scoreTrackWorldIdentity(searchPool[idx]!, profile),
      depth,
      (track) => rankOpenerForProfile(track, profile),
    );
    const candidate = thesis.tracks[0];
    const candidateScore = candidate ? scoreTrackWorldIdentity(candidate, profile) : 0;
    const candidateAnchor = candidate ? isAnchorArtistForProfile(candidate.artistName, profile) : false;
    if (candidate && (candidateAnchor || candidateScore >= minScore)) {
      const existingIdx = out.findIndex((t) => dedupeKey(t) === dedupeKey(candidate));
      if (existingIdx > 0) {
        const [moved] = out.splice(existingIdx, 1);
        if (moved) out.unshift(moved);
        promoted = true;
        fromIndex = existingIdx;
      } else if (existingIdx < 0) {
        out = [candidate, ...out.filter((t) => dedupeKey(t) !== dedupeKey(candidate))];
        promoted = true;
        fromIndex = -1;
      }
    }
  }

  const opener = out[0]!;
  const openerCheck = trackMeetsThesisOpener(opener, committed);
  const label = `${opener.artistName ?? "?"} — ${opener.trackName ?? "?"}`;

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
