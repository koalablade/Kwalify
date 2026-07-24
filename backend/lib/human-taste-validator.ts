/**
 * Human Taste Validator — deterministic post-generation self-critique.
 * Validates editorial shape, then repairs only weak slots from a candidate pool.
 */

import { curatePlaylistEnding } from "../core/editorial/ending-curator";
import { curatePlaylistOpening } from "../core/editorial/opening-curator";
import type { PatternScoringTrack } from "../core/editorial/human-playlist-patterns";

export type HumanTasteIssueCode =
  | "energy_monotony"
  | "artist_run"
  | "missing_peak"
  | "weak_ending"
  | "weak_opening"
  | "moment_mismatch"
  | "trust_outlier"
  | "enthusiast_opener_weak"
  | "obviously_wrong_song"
  | "not_worth_saving"
  | "would_not_share"
  | "undeliberate_transition";

export type HumanTasteIssue = {
  code: HumanTasteIssueCode;
  severity: "warn" | "fail";
  trackIndices: number[];
  detail: string;
};

export type HumanTasteValidation = {
  passed: boolean;
  score: number;
  issues: HumanTasteIssue[];
  v2?: HumanTasteV2Checks;
};

export type HumanTasteV2Checks = {
  wouldKeepOpener: boolean;
  deliberateTransitions: boolean;
  hasObviouslyWrongSong: boolean;
  worthSaving: boolean;
  wouldShare: boolean;
  v2Score: number;
};

export type HumanTasteTrack = PatternScoringTrack & {
  trackName?: string | null;
  score?: number;
};

export type HumanTasteValidateOpts = {
  tracks: HumanTasteTrack[];
  calmPrompt?: boolean;
  energeticPrompt?: boolean;
  scoreMomentFit?: (track: HumanTasteTrack, index: number) => number;
  momentMismatchThreshold?: number;
};

export type HumanTasteRepairOpts = {
  tracks: HumanTasteTrack[];
  candidates: HumanTasteTrack[];
  calmPrompt?: boolean;
  energeticPrompt?: boolean;
  scoreMomentFit: (track: HumanTasteTrack, index: number) => number;
  isCandidateSafe: (track: HumanTasteTrack) => boolean;
  maxSwaps?: number;
  momentMismatchThreshold?: number;
  openingActivityFitBoost?: (track: HumanTasteTrack, position: number) => number;
  lockedOpenerTrackId?: string | null;
  /** Set when opening-curator-v2 already ran — skip legacy opening swaps. */
  openingCuratorV2Applied?: boolean;
  /** When v2 ran, protect the full opening window from taste-repair swaps. */
  lockedOpeningWindowSize?: number;
  /** Prompt used for scene-aware ending shape (cooldown vs peak). */
  vibe?: string | null;
};

export type HumanTasteRepairResult = {
  tracks: HumanTasteTrack[];
  swappedCount: number;
  swappedIndices: number[];
  validationBefore: HumanTasteValidation;
  validationAfter: HumanTasteValidation;
  openingCuratorSwaps: number;
  endingCuratorSwaps: number;
  diagnostics: Record<string, unknown>;
};

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

function artistKey(track: HumanTasteTrack): string {
  return (track.artistName ?? "unknown").toLowerCase().trim();
}

function energyOf(track: HumanTasteTrack): number {
  return track.energy ?? 0.5;
}

function findArtistRuns(tracks: HumanTasteTrack[], minRun = 3): number[] {
  const indices: number[] = [];
  let runStart = 0;
  while (runStart < tracks.length) {
    const key = artistKey(tracks[runStart]!);
    let runEnd = runStart + 1;
    while (runEnd < tracks.length && artistKey(tracks[runEnd]!) === key) runEnd += 1;
    if (runEnd - runStart >= minRun) {
      for (let i = runStart; i < runEnd; i += 1) indices.push(i);
    }
    runStart = runEnd;
  }
  return indices;
}

function checkEnergyMonotony(tracks: HumanTasteTrack[], energeticPrompt: boolean): HumanTasteIssue | null {
  if (tracks.length < 6) return null;
  const energies = tracks.map(energyOf);
  const spread = stddev(energies);
  const maxEnergy = Math.max(...energies);
  const minEnergy = Math.min(...energies);
  const range = maxEnergy - minEnergy;
  const nearMeanBand = energies.filter((e) => Math.abs(e - mean(energies)) <= 0.08).length / energies.length;
  const hasPeak = maxEnergy >= mean(energies) + (energeticPrompt ? 0.10 : 0.14);
  if (spread < 0.07 && range < 0.12) {
    return {
      code: "energy_monotony",
      severity: "fail",
      trackIndices: energies.map((_, i) => i),
      detail: "Playlist energy is too flat — no arc or contrast",
    };
  }
  if (nearMeanBand >= 0.55 && !hasPeak && !energeticPrompt) {
    return {
      code: "energy_monotony",
      severity: "warn",
      trackIndices: energies.map((_, i) => i),
      detail: "Too many songs sit at the same energy level",
    };
  }
  return null;
}

function checkEmotionalPeak(tracks: HumanTasteTrack[], calmPrompt: boolean): HumanTasteIssue | null {
  if (calmPrompt || tracks.length < 8) return null;
  const energies = tracks.map(energyOf);
  const start = Math.floor(tracks.length * 0.2);
  const end = Math.ceil(tracks.length * 0.8);
  const middle = energies.slice(start, end);
  if (middle.length === 0) return null;
  const playlistP75 = [...energies].sort((a, b) => a - b)[Math.floor(energies.length * 0.75)] ?? 0.65;
  const hasPeak = middle.some((e) => e >= playlistP75 - 0.02);
  if (!hasPeak) {
    return {
      code: "missing_peak",
      severity: "warn",
      trackIndices: Array.from({ length: end - start }, (_, i) => start + i),
      detail: "No clear emotional high point in the middle of the playlist",
    };
  }
  return null;
}

function checkWeakEnding(tracks: HumanTasteTrack[], calmPrompt: boolean): HumanTasteIssue | null {
  if (tracks.length < 4) return null;
  const last = tracks[tracks.length - 1]!;
  const prev = tracks[tracks.length - 2]!;
  const drop = energyOf(prev) - energyOf(last);
  if (!calmPrompt && drop > 0.28) {
    return {
      code: "weak_ending",
      severity: "fail",
      trackIndices: [tracks.length - 1],
      detail: "Ending drops energy too abruptly",
    };
  }
  if (calmPrompt && energyOf(last) > 0.62) {
    return {
      code: "weak_ending",
      severity: "warn",
      trackIndices: [tracks.length - 1],
      detail: "Calm playlist ending feels too energetic",
    };
  }
  return null;
}

function checkWeakOpening(tracks: HumanTasteTrack[]): HumanTasteIssue | null {
  if (tracks.length < 5) return null;
  const opening = tracks.slice(0, 3);
  const artists = opening.map(artistKey);
  if (new Set(artists).size < artists.length) {
    return {
      code: "weak_opening",
      severity: "fail",
      trackIndices: [0, 1, 2],
      detail: "Opening repeats the same artist back-to-back",
    };
  }
  const openerEnergy = energyOf(opening[0]!);
  const tailMean = mean(tracks.slice(3).map(energyOf));
  if (openerEnergy < tailMean - 0.22) {
    return {
      code: "weak_opening",
      severity: "warn",
      trackIndices: [0],
      detail: "Opener is noticeably lower energy than the rest — weak hook",
    };
  }
  return null;
}

function checkMomentMismatch(
  tracks: HumanTasteTrack[],
  scoreMomentFit: (track: HumanTasteTrack, index: number) => number,
  threshold: number,
): HumanTasteIssue | null {
  if (tracks.length < 4) return null;
  const indices: number[] = [];
  for (let i = 0; i < tracks.length; i += 1) {
    if (scoreMomentFit(tracks[i]!, i) < threshold) indices.push(i);
  }
  if (indices.length === 0) return null;
  return {
    code: "moment_mismatch",
    severity: indices.length >= 2 ? "fail" : "warn",
    trackIndices: indices,
    detail: `${indices.length} track(s) no longer fit the described moment`,
  };
}

function checkTrustOutliers(
  tracks: HumanTasteTrack[],
  scoreMomentFit: (track: HumanTasteTrack, index: number) => number,
): HumanTasteIssue | null {
  if (tracks.length < 5) return null;
  const scores = tracks.map((t, i) => scoreMomentFit(t, i));
  const m = mean(scores);
  const sd = stddev(scores);
  const cutoff = m - Math.max(0.22, sd * 1.6);
  const indices = scores
    .map((score, index) => ({ score, index }))
    .filter(({ score }) => score < cutoff)
    .map(({ index }) => index);
  if (indices.length === 0) return null;
  return {
    code: "trust_outlier",
    severity: "fail",
    trackIndices: indices.slice(0, 3),
    detail: "Track(s) would make a listener ask 'why is THIS here?'",
  };
}

function checkObviouslyWrongSong(
  tracks: HumanTasteTrack[],
  scoreMomentFit: (track: HumanTasteTrack, index: number) => number,
  threshold: number,
): HumanTasteIssue | null {
  if (tracks.length < 4) return null;
  let worstIndex = -1;
  let worstScore = Infinity;
  for (let i = 0; i < tracks.length; i += 1) {
    const fit = scoreMomentFit(tracks[i]!, i);
    if (fit < worstScore) {
      worstScore = fit;
      worstIndex = i;
    }
  }
  if (worstIndex < 0 || worstScore >= threshold) return null;
  const m = mean(tracks.map((t, i) => scoreMomentFit(t, i)));
  if (m - worstScore < 0.28) return null;
  return {
    code: "obviously_wrong_song",
    severity: "fail",
    trackIndices: [worstIndex],
    detail: "One track is a clear misfit for this playlist",
  };
}

function checkUndeliberateTransitions(
  tracks: HumanTasteTrack[],
  scoreMomentFit: (track: HumanTasteTrack, index: number) => number,
): HumanTasteIssue | null {
  if (tracks.length < 5) return null;
  const indices: number[] = [];
  for (let i = 1; i < tracks.length; i += 1) {
    const prev = tracks[i - 1]!;
    const curr = tracks[i]!;
    const energyJump = Math.abs(energyOf(prev) - energyOf(curr));
    const fitDrop = scoreMomentFit(prev, i - 1) - scoreMomentFit(curr, i);
    if (energyJump > 0.38 && fitDrop > 0.18) indices.push(i);
  }
  if (indices.length < 2) return null;
  return {
    code: "undeliberate_transition",
    severity: "warn",
    trackIndices: indices.slice(0, 4),
    detail: "Some transitions feel accidental rather than curated",
  };
}

function runHumanTasteV2Checks(
  tracks: HumanTasteTrack[],
  issues: HumanTasteIssue[],
  scoreMomentFit: (track: HumanTasteTrack, index: number) => number,
  lockedOpenerTrackId?: string | null,
): HumanTasteV2Checks {
  const opener = tracks[0];
  const openerFit = opener ? scoreMomentFit(opener, 0) : 0;
  const wouldKeepOpener = openerFit >= 0.42 && !issues.some(
    (i) => i.code === "weak_opening" || (i.code === "enthusiast_opener_weak" && i.trackIndices.includes(0)),
  );
  const deliberateTransitions = !issues.some((i) => i.code === "undeliberate_transition" && i.severity === "fail");
  const hasObviouslyWrongSong = issues.some((i) => i.code === "obviously_wrong_song" || i.code === "trust_outlier");
  const failCount = issues.filter((i) => i.severity === "fail").length;
  const worthSaving = failCount <= 1 && openerFit >= 0.35;
  const wouldShare = worthSaving && !hasObviouslyWrongSong && openerFit >= 0.48;
  const v2Penalty =
    (wouldKeepOpener ? 0 : 0.18) +
    (deliberateTransitions ? 0 : 0.1) +
    (hasObviouslyWrongSong ? 0.22 : 0) +
    (worthSaving ? 0 : 0.2) +
    (wouldShare ? 0 : 0.08) +
    (lockedOpenerTrackId && opener?.trackId !== lockedOpenerTrackId ? 0.12 : 0);
  const v2Score = Math.max(0, Math.round((1 - v2Penalty) * 100) / 100);
  return {
    wouldKeepOpener,
    deliberateTransitions,
    hasObviouslyWrongSong,
    worthSaving,
    wouldShare,
    v2Score,
  };
}

export function validateHumanTastePlaylist(opts: HumanTasteValidateOpts): HumanTasteValidation {
  const tracks = opts.tracks;
  if (tracks.length === 0) {
    return { passed: false, score: 0, issues: [{ code: "trust_outlier", severity: "fail", trackIndices: [], detail: "Empty playlist" }] };
  }

  const calmPrompt = opts.calmPrompt === true;
  const energeticPrompt = opts.energeticPrompt === true;
  const momentThreshold = opts.momentMismatchThreshold ?? -0.12;
  const scoreMomentFit = opts.scoreMomentFit ?? (() => 0);

  const issues: HumanTasteIssue[] = [];
  const push = (issue: HumanTasteIssue | null) => { if (issue) issues.push(issue); };

  push(checkEnergyMonotony(tracks, energeticPrompt));
  const artistRun = findArtistRuns(tracks, 3);
  if (artistRun.length > 0) {
    issues.push({
      code: "artist_run",
      severity: "fail",
      trackIndices: artistRun,
      detail: "Three or more consecutive songs from the same artist",
    });
  }
  push(checkEmotionalPeak(tracks, calmPrompt));
  push(checkWeakEnding(tracks, calmPrompt));
  push(checkWeakOpening(tracks));
  push(checkMomentMismatch(tracks, scoreMomentFit, momentThreshold));
  push(checkTrustOutliers(tracks, scoreMomentFit));
  push(checkObviouslyWrongSong(tracks, scoreMomentFit, momentThreshold - 0.08));
  push(checkUndeliberateTransitions(tracks, scoreMomentFit));

  if (tracks[0] && scoreMomentFit(tracks[0], 0) < 0.38) {
    issues.push({
      code: "enthusiast_opener_weak",
      severity: "fail",
      trackIndices: [0],
      detail: "A music enthusiast would not intentionally keep this opener",
    });
  }

  const failCount = issues.filter((i) => i.severity === "fail").length;
  const v2 = runHumanTasteV2Checks(tracks, issues, scoreMomentFit);
  if (!v2.worthSaving && failCount >= 2) {
    issues.push({
      code: "not_worth_saving",
      severity: "fail",
      trackIndices: [],
      detail: "Playlist would not be worth saving as-is",
    });
  }
  if (!v2.wouldShare && failCount >= 1) {
    issues.push({
      code: "would_not_share",
      severity: "warn",
      trackIndices: [],
      detail: "Would not confidently share this playlist",
    });
  }
  const finalFailCount = issues.filter((i) => i.severity === "fail").length;
  const finalWarnCount = issues.filter((i) => i.severity === "warn").length;
  const finalScore = Math.max(0, Math.min(1, 1 - finalFailCount * 0.22 - finalWarnCount * 0.08));
  const finalV2 = runHumanTasteV2Checks(tracks, issues, scoreMomentFit);
  return {
    passed: finalFailCount === 0,
    score: Math.round(finalScore * 100) / 100,
    issues,
    v2: finalV2,
  };
}

function collectReplaceIndices(validation: HumanTasteValidation): number[] {
  const priority: HumanTasteIssueCode[] = [
    "obviously_wrong_song",
    "trust_outlier",
    "enthusiast_opener_weak",
    "moment_mismatch",
    "artist_run",
    "weak_ending",
    "weak_opening",
    "missing_peak",
    "energy_monotony",
    "undeliberate_transition",
  ];
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const code of priority) {
    for (const issue of validation.issues.filter((i) => i.code === code)) {
      for (const index of issue.trackIndices) {
        if (!seen.has(index)) {
          seen.add(index);
          ordered.push(index);
        }
      }
    }
  }
  return ordered;
}

function replacementScore(
  candidate: HumanTasteTrack,
  index: number,
  tracks: HumanTasteTrack[],
  scoreMomentFit: (track: HumanTasteTrack, index: number) => number,
): number {
  const prev = tracks[index - 1];
  const next = tracks[index + 1];
  const fit = scoreMomentFit(candidate, index);
  const transitionPenalty = (prev
    ? Math.abs(energyOf(prev) - energyOf(candidate))
    : 0) + (next ? Math.abs(energyOf(next) - energyOf(candidate)) * 0.8 : 0);
  const artistPenalty = (prev && artistKey(prev) === artistKey(candidate) ? 0.35 : 0)
    + (next && artistKey(next) === artistKey(candidate) ? 0.25 : 0);
  return fit * 2.4 - transitionPenalty * 0.6 - artistPenalty + (candidate.score ?? 0.4) * 0.3;
}

export function repairHumanTastePlaylist(opts: HumanTasteRepairOpts): HumanTasteRepairResult {
  let tracks = opts.tracks.slice();
  const lockedOpenerId = opts.lockedOpenerTrackId ?? null;
  let openingCuratorSwaps = 0;

  if (lockedOpenerId) {
    const openerIdx = tracks.findIndex((t) => t.trackId === lockedOpenerId);
    if (openerIdx > 0) {
      const [locked] = tracks.splice(openerIdx, 1);
      tracks.unshift(locked!);
    }
  } else if (!opts.openingCuratorV2Applied) {
    const opening = curatePlaylistOpening(tracks, {
      openingSize: 5,
      activityFitBoost: opts.openingActivityFitBoost,
    });
    tracks = opening.tracks;
    openingCuratorSwaps = opening.swaps;
  }

  const ending = curatePlaylistEnding(tracks, {
    endingSize: 6,
    vibe: opts.vibe ?? null,
  });
  tracks = ending.tracks;

  const validationBefore = validateHumanTastePlaylist({
    tracks,
    calmPrompt: opts.calmPrompt,
    energeticPrompt: opts.energeticPrompt,
    scoreMomentFit: opts.scoreMomentFit,
    momentMismatchThreshold: opts.momentMismatchThreshold,
  });

  if (validationBefore.passed) {
    return {
      tracks,
      swappedCount: 0,
      swappedIndices: [],
      validationBefore,
      validationAfter: validationBefore,
      openingCuratorSwaps,
      endingCuratorSwaps: ending.swaps,
      diagnostics: { skipped: "already_passed", v2: validationBefore.v2 },
    };
  }

  const maxSwaps = opts.maxSwaps ?? 6;
  const playlistIds = new Set(tracks.map((t) => t.trackId));
  const lockedOpeningWindowSize = opts.openingCuratorV2Applied
    ? Math.max(0, opts.lockedOpeningWindowSize ?? 5)
    : 0;
  const replaceIndices = collectReplaceIndices(validationBefore)
    .filter((index) => {
      if (lockedOpeningWindowSize > 0 && index < lockedOpeningWindowSize) return false;
      if (lockedOpenerId && index === 0) return false;
      return true;
    })
    .slice(0, maxSwaps);
  const swappedIndices: number[] = [];

  for (const index of replaceIndices) {
    const incumbent = tracks[index]!;
    let best: { track: HumanTasteTrack; score: number } | null = null;
    for (const candidate of opts.candidates) {
      if (!candidate.trackId || playlistIds.has(candidate.trackId)) continue;
      if (!opts.isCandidateSafe(candidate)) continue;
      if (artistKey(candidate) === artistKey(incumbent)) continue;
      const score = replacementScore(candidate, index, tracks, opts.scoreMomentFit);
      if (!best || score > best.score) best = { track: candidate, score };
    }
    if (!best || best.score <= opts.scoreMomentFit(incumbent, index)) continue;
    playlistIds.delete(incumbent.trackId);
    playlistIds.add(best.track.trackId);
    tracks[index] = best.track;
    swappedIndices.push(index);
  }

  const validationAfter = validateHumanTastePlaylist({
    tracks,
    calmPrompt: opts.calmPrompt,
    energeticPrompt: opts.energeticPrompt,
    scoreMomentFit: opts.scoreMomentFit,
    momentMismatchThreshold: opts.momentMismatchThreshold,
  });

  return {
    tracks,
    swappedCount: swappedIndices.length,
    swappedIndices,
    validationBefore,
    validationAfter,
    openingCuratorSwaps,
    endingCuratorSwaps: ending.swaps,
    diagnostics: {
      replaceCandidatesConsidered: replaceIndices.length,
      issuesBefore: validationBefore.issues.map((i) => i.code),
      issuesAfter: validationAfter.issues.map((i) => i.code),
      v2Before: validationBefore.v2,
      v2After: validationAfter.v2,
      lockedOpenerTrackId: lockedOpenerId,
    },
  };
}
