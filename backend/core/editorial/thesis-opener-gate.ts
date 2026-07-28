/**
 * Track 1 thesis gate — opener must prove the committed world (>= 0.8 identity or anchor artist).
 */

import type { CommittedWorld } from "../committed-world";
import { resolveCulturalProfileForCommitted, scoreTrackWorldIdentity, isAnchorArtistForProfile, type WorldIdentityTrack } from "./world-identity-score";
import { promoteWorldThesisOpener } from "./opener-hygiene";

export const THESIS_OPENER_MIN_SCORE = 0.8;

export type ThesisOpenerResult<T extends WorldIdentityTrack> = {
  tracks: T[];
  passed: boolean;
  promoted: boolean;
  fromIndex: number;
  openerScore: number;
  failures: string[];
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

/** Enforce thesis opener — promote best anchor if track 1 fails. */
export function enforceThesisOpenerGate<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  searchDepth = 15,
  expansionCandidates?: T[],
): ThesisOpenerResult<T> {
  if (!committed?.hardLock || tracks.length === 0) {
    return { tracks, passed: true, promoted: false, fromIndex: 0, openerScore: 1, failures: [] };
  }

  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) {
    return { tracks, passed: true, promoted: false, fromIndex: 0, openerScore: 0.75, failures: [] };
  }

  const opener = tracks[0]!;
  const openerCheck = trackMeetsThesisOpener(opener, committed);

  // World-perfect discovery opener > wrong liked song when opener scores < 0.8
  if (!openerCheck.passed && expansionCandidates && expansionCandidates.length > 0) {
    const bestExpansion = expansionCandidates
      .map((track) => ({
        track,
        score: scoreTrackWorldIdentity(track, profile),
        check: trackMeetsThesisOpener(track, committed),
      }))
      .filter((row) => row.check.passed && row.score >= THESIS_OPENER_MIN_SCORE)
      .sort((a, b) => b.score - a.score)[0];

    if (bestExpansion && bestExpansion.score > openerCheck.score) {
      const out = tracks.slice();
      const existingIdx = out.findIndex(
        (t) =>
          t.artistName === bestExpansion.track.artistName &&
          t.trackName === bestExpansion.track.trackName,
      );
      if (existingIdx > 0) {
        const [promoted] = out.splice(existingIdx, 1);
        if (promoted) out.unshift(promoted);
        return {
          tracks: out,
          passed: true,
          promoted: true,
          fromIndex: existingIdx,
          openerScore: bestExpansion.score,
          failures: [],
        };
      }
      const deduped = out.filter(
        (t) =>
          !(
            t.artistName === bestExpansion.track.artistName &&
            t.trackName === bestExpansion.track.trackName
          ),
      );
      return {
        tracks: [bestExpansion.track, ...deduped],
        passed: true,
        promoted: true,
        fromIndex: -1,
        openerScore: bestExpansion.score,
        failures: [],
      };
    }
  }

  if (openerCheck.passed) {
    return {
      tracks,
      passed: true,
      promoted: false,
      fromIndex: 0,
      openerScore: openerCheck.score,
      failures: [],
    };
  }

  const searchPool =
    expansionCandidates && expansionCandidates.length > 0
      ? [...tracks, ...expansionCandidates.filter(
          (c) => !tracks.some(
            (t) => t.artistName === c.artistName && t.trackName === c.trackName,
          ),
        )]
      : tracks;

  const thesis = promoteWorldThesisOpener(
    searchPool,
    (track) => scoreTrackWorldIdentity(track, profile),
    searchDepth,
  );

  const newOpener = thesis.tracks[0]!;
  const newCheck = trackMeetsThesisOpener(newOpener, committed);
  const label = `${newOpener.artistName ?? "?"} — ${newOpener.trackName ?? "?"}`;

  return {
    tracks: thesis.tracks,
    passed: newCheck.passed,
    promoted: thesis.promoted,
    fromIndex: thesis.fromIndex,
    openerScore: newCheck.score,
    failures: newCheck.passed ? [] : [`thesis_opener_failed:${label}`],
  };
}
