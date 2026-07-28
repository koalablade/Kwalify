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

  const thesis = promoteWorldThesisOpener(
    tracks,
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
