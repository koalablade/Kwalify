/**
 * V16/V18 human curation sequencer — moment-aware ordering and bad-track ejection after purity.
 * Reorders, replaces, or removes weak moment-fit tracks; never injects filler.
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { nearDuplicateKey } from "../../lib/near-duplicate";
import { promoteSceneAnchorsInPlaylist } from "./scene-anchor-spine";
import {
  MOMENT_FIT_MIN_VIABLE_LENGTH,
  momentRejectSeverity,
  passesMomentFitForRefill,
} from "./song-moment-fit";
import { scoreTrackWorldIdentity } from "./world-identity-score";
import { isSemanticSpamTrack } from "../playlist-contract/contract-axis-scoring";

export type HumanCurationTrack = {
  trackId?: string | null;
  trackName?: string | null;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  popularity?: number | null;
  acousticness?: number | null;
  tempo?: number | null;
  durationMs?: number | null;
};

export const MOMENT_REPLACEMENT_POOL_CAP = 256;
export const MOMENT_CROSS_POOL_MAX_ATTEMPTS = 8;

export type MomentCrossPoolReplacementDiagnostic = {
  originalTrack: string;
  rejectReason: string;
  replacementSearchAttempted: boolean;
  candidatePoolSize: number;
  eligibleCandidates: number;
  momentFitCandidates: number;
  selectedReplacement: string | null;
  replacementScore: number | null;
  replacementReason: string | null;
  fallbackToEject: boolean;
};

export type HumanCurationActivityHint =
  | "gym"
  | "bbq"
  | "motorway_rain"
  | "disco"
  | "country"
  | "madchester"
  | "night_drive"
  | null;

export type HumanCurationSequencerOpts = {
  prompt: string;
  activityHint?: HumanCurationActivityHint;
  /** Preserve slot 0 unless deep-cut opener guard fires. */
  preserveThesisOpener?: boolean;
  maxConsecutiveSameArtist?: number;
  /** When set, promotes underrepresented priority scene anchors in early slots. */
  culturalProfile?: CulturalWorldProfile | null;
  /** V19: bounded eligible pool for cross-pool moment-fit replacement (max 256). */
  replacementPool?: HumanCurationTrack[];
};

export type HumanCurationSequencerResult<T extends HumanCurationTrack> = {
  tracks: T[];
  swaps: number;
  reorders: number;
  removals: number;
  replacements: number;
  diagnostics: string[];
  momentReplacementDiagnostics: MomentCrossPoolReplacementDiagnostic[];
};

const POWER_BALLAD_TITLE =
  /\b(?:don'?t\s+cry|sweet\s+child|stairway|november\s+rain|every\s+rose|nothing\s+else\s+matters|welcome\s+home|patience|wind\s+of\s+change|with\s+or\s+without\s+you|one|dream\s+on|more\s+than\s+a\s+feeling|carry\s+on\s+wayward|free\s+bird|bohemian\s+rhapsody)\b/i;

const ANTHEMIC_SHOUT_TITLE =
  /\b(?:shout|livin'? on a prayer|don'?t\s+stop\s+believin|we\s+will\s+rock\s+you|we\s+are\s+the\s+champions|eye\s+of\s+the\s+tiger|final\s+countdown|jump|here\s+i\s+go\s+again)\b/i;

const INSTRUMENTAL_DEEP_TITLE =
  /\b(?:rat\s+salad|intro|outro|interlude|skit|reprise|instrumental|jam|movement|suite)\b/i;

const OBSCURE_OPENER_ARTISTS =
  /\b(?:rat\s+salad|tangerine\s+dream|throbbing\s+gristle|canterbury\s+scene)\b/i;

function artistKey(track: HumanCurationTrack): string {
  return String(track.artistName ?? "").toLowerCase().trim();
}

function energyOf(track: HumanCurationTrack): number {
  const e = track.energy;
  return typeof e === "number" && Number.isFinite(e) ? e : 0.5;
}

function popularityOf(track: HumanCurationTrack): number {
  const p = track.popularity;
  return typeof p === "number" && Number.isFinite(p) ? p : 50;
}

function titleOf(track: HumanCurationTrack): string {
  return String(track.trackName ?? "").toLowerCase();
}

/** Infer activity context from prompt text. */
export function inferHumanCurationActivity(prompt: string): HumanCurationActivityHint {
  const p = prompt.toLowerCase();
  if (/\b(?:gym|workout|lifting|cardio|pump)\b/.test(p)) return "gym";
  if (/\b(?:bbq|barbecue|dad\s+rock|backyard|beers)\b/.test(p)) return "bbq";
  if (/\b(?:motorway|midnight\s+rain|windscreen|empty\s+road)\b/.test(p)) return "motorway_rain";
  if (/\b(?:disco|rooftop\s+party|1978|four-on-the-floor)\b/.test(p)) return "disco";
  if (/\b(?:country|cowboy|road\s+trip)\b/.test(p) && !/\b(?:madchester|britpop)\b/.test(p)) return "country";
  if (/\b(?:madchester|baggy|stone\s+roses|happy\s+mondays)\b/.test(p)) return "madchester";
  if (/\b(?:80s|night\s+drive|synth)\b/.test(p)) return "night_drive";
  return null;
}

/** 0–1 position fit — higher is better for this slot. */
export function scorePositionFit(
  track: HumanCurationTrack,
  position: number,
  totalLength: number,
  activity: HumanCurationActivityHint,
): number {
  const energy = energyOf(track);
  const pop = popularityOf(track) / 100;
  const title = titleOf(track);
  const acoustic = track.acousticness ?? 0.5;
  const rel = totalLength > 1 ? position / (totalLength - 1) : 0;

  let score = 0.55;

  // Opener: favour recognisable hooks over deep cuts
  if (position === 0) {
    score += pop * 0.35;
    if (pop < 0.25) score -= 0.35;
    if (OBSCURE_OPENER_ARTISTS.test(title) || OBSCURE_OPENER_ARTISTS.test(artistKey(track))) {
      score -= 0.45;
    }
  }

  // Activity-specific moment fit
  switch (activity) {
    case "gym": {
      const cooldownOnly = totalLength >= 10 && rel >= 0.85;
      if (!cooldownOnly && (POWER_BALLAD_TITLE.test(title) || (energy < 0.55 && position >= 1))) {
        score -= 0.55;
      }
      if (position >= 1 && position <= Math.ceil(totalLength * 0.8) && energy >= 0.72) score += 0.2;
      if (position === 0 && energy >= 0.78) score += 0.15;
      break;
    }
    case "bbq": {
      if (position <= 4 && (POWER_BALLAD_TITLE.test(title) || energy < 0.42)) {
        score -= 0.5;
      }
      if (rel >= 0.2 && rel <= 0.8 && energy >= 0.5 && energy <= 0.82) score += 0.15;
      break;
    }
    case "motorway_rain": {
      const tail = rel >= 0.75;
      if (tail && (ANTHEMIC_SHOUT_TITLE.test(title) || (energy > 0.82 && (track.valence ?? 0.5) > 0.65))) {
        score -= 0.55;
      }
      if (rel >= 0.3 && rel <= 0.7 && energy >= 0.35 && energy <= 0.68) score += 0.2;
      if (position === 0 && energy >= 0.4 && energy <= 0.65) score += 0.1;
      break;
    }
    case "disco": {
      if (energy >= 0.55 && energy <= 0.88) score += 0.1;
      if (position === 0 && pop >= 0.4) score += 0.15;
      break;
    }
    case "country": {
      if (position >= 1 && position <= 3 && pop >= 0.35) score += 0.08;
      break;
    }
    default:
      break;
  }

  return Math.max(0, Math.min(1, score));
}

/** True when an obscure deep cut should not open the playlist. */
export function isObscureDeepCutOpener(track: HumanCurationTrack, position = 0): boolean {
  if (position !== 0) return false;
  const pop = popularityOf(track);
  const title = titleOf(track);
  if (OBSCURE_OPENER_ARTISTS.test(title) || OBSCURE_OPENER_ARTISTS.test(artistKey(track))) {
    return true;
  }
  if (INSTRUMENTAL_DEEP_TITLE.test(title)) return true;
  return pop < 22 && energyOf(track) < 0.72;
}

/** Break runs of same artist exceeding maxRun by swapping with best-fit alternative. */
export function breakConsecutiveArtistRuns<T extends HumanCurationTrack>(
  tracks: T[],
  opts: {
    maxRun?: number;
    preserveIndex0?: boolean;
    scoreFit?: (track: T, index: number) => number;
  } = {},
): { tracks: T[]; swaps: number } {
  const maxRun = opts.maxRun ?? 2;
  if (tracks.length < maxRun + 1) return { tracks: tracks.slice(), swaps: 0 };

  const result = tracks.slice();
  let swaps = 0;
  const scoreFit = opts.scoreFit ?? (() => 0.5);

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i += 1) {
      const key = artistKey(result[i]!);
      let runEnd = i + 1;
      while (runEnd < result.length && artistKey(result[runEnd]!) === key) runEnd += 1;
      const runLen = runEnd - i;

      if (runLen > maxRun) {
        const swapIdx = i + maxRun;
        if (opts.preserveIndex0 !== false && swapIdx === 0) continue;

        let bestIdx = -1;
        let bestScore = -1;
        for (let k = runEnd; k < result.length; k += 1) {
          if (artistKey(result[k]!) === key) continue;
          const prevKey = swapIdx > 0 ? artistKey(result[swapIdx - 1]!) : "";
          const nextKey = swapIdx + 1 < result.length ? artistKey(result[swapIdx + 1]!) : "";
          const candidateKey = artistKey(result[k]!);
          if (candidateKey === prevKey || candidateKey === nextKey) continue;
          const fit = scoreFit(result[k]!, swapIdx);
          if (fit > bestScore) {
            bestScore = fit;
            bestIdx = k;
          }
        }
        if (bestIdx >= 0) {
          const tmp = result[swapIdx]!;
          result[swapIdx] = result[bestIdx]!;
          result[bestIdx] = tmp;
          swaps += 1;
          changed = true;
          break;
        }
      }
      i = runEnd - 1;
    }
  }

  return { tracks: result, swaps };
}

/** Minimum opener-fit gain required before swapping away a failed opener. */
const OPENER_SWAP_MIN_GAIN = 0.05;

/** Minimum absolute fit for a replacement opener candidate. */
const OPENER_SWAP_MIN_FIT = 0.45;

function selectBestOpenerAlternative<T extends HumanCurationTrack>(
  tracks: T[],
  activity: HumanCurationActivityHint,
  openerFit: number,
): { bestIdx: number; bestFit: number } {
  let bestIdx = -1;
  let bestFit = openerFit;
  let bestPop = -1;
  const searchEnd = Math.min(tracks.length, 10);
  for (let i = 1; i < searchEnd; i += 1) {
    const candidate = tracks[i]!;
    if (momentRejectSeverity(candidate, activity, 0, tracks.length) === "hard") continue;
    const fit = scorePositionFit(candidate, 0, tracks.length, activity);
    if (fit < OPENER_SWAP_MIN_FIT || fit <= openerFit + OPENER_SWAP_MIN_GAIN) continue;
    const pop = popularityOf(candidate);
    if (fit > bestFit + 0.001 || (Math.abs(fit - bestFit) <= 0.001 && pop > bestPop)) {
      bestFit = fit;
      bestPop = pop;
      bestIdx = i;
    }
  }
  return { bestIdx, bestFit };
}

/** Swap deep-cut opener with best-known track from positions 1–8. Hard failures override preserveThesisOpener. */
export function guardDeepCutOpener<T extends HumanCurationTrack>(
  tracks: T[],
  activity: HumanCurationActivityHint,
  _preserveThesisOpener = true,
): { tracks: T[]; swapped: boolean; previousOpener?: string; newOpener?: string } {
  if (tracks.length < 2) return { tracks: tracks.slice(), swapped: false };
  const opener = tracks[0]!;
  const hardOpenerFail =
    isObscureDeepCutOpener(opener, 0) ||
    momentRejectSeverity(opener, activity, 0, tracks.length) === "hard";
  if (!hardOpenerFail) return { tracks: tracks.slice(), swapped: false };

  const openerFit = scorePositionFit(opener, 0, tracks.length, activity);
  const { bestIdx } = selectBestOpenerAlternative(tracks, activity, openerFit);
  if (bestIdx < 0) return { tracks: tracks.slice(), swapped: false };

  const out = tracks.slice();
  const tmp = out[0]!;
  out[0] = out[bestIdx]!;
  out[bestIdx] = tmp;
  return {
    tracks: out,
    swapped: true,
    previousOpener: `${opener.artistName ?? "?"} — ${opener.trackName ?? "?"}`,
    newOpener: `${out[0]!.artistName ?? "?"} — ${out[0]!.trackName ?? "?"}`,
  };
}

/**
 * V19 Experiment C — terminal opener guard after final API hygiene.
 * Fit-first swap within the delivered playlist; popularity is tie-break only.
 */
export function applyTerminalOpenerGuard<T extends HumanCurationTrack>(
  tracks: T[],
  prompt: string,
): { tracks: T[]; swapped: boolean; previousOpener?: string; newOpener?: string } {
  const activity = inferHumanCurationActivity(prompt);
  return guardDeepCutOpener(tracks, activity, false);
}

/** Bubble weak moment-fit tracks toward tail; includes final slot (closer). */
export function reorderWeakMomentSlots<T extends HumanCurationTrack>(
  tracks: T[],
  activity: HumanCurationActivityHint,
  threshold = 0.38,
): { tracks: T[]; reorders: number } {
  if (tracks.length < 3 || !activity) return { tracks: tracks.slice(), reorders: 0 };

  const result = tracks.slice();
  let reorders = 0;

  for (let i = 1; i < result.length; i += 1) {
    const fit = scorePositionFit(result[i]!, i, result.length, activity);
    if (fit >= threshold) continue;

    let bestSwap = -1;
    let bestGain = 0;
    const searchEnd = i === result.length - 1 ? result.length - 1 : Math.min(result.length, i + 6);
    for (let j = i + 1; j < searchEnd; j += 1) {
      if (artistKey(result[j]!) === artistKey(result[i]!)) continue;
      if (j > 0 && artistKey(result[j]!) === artistKey(result[j - 1]!)) continue;
      const candidateFit = scorePositionFit(result[j]!, i, result.length, activity);
      const gain = candidateFit - scorePositionFit(result[j]!, j, result.length, activity);
      if (candidateFit > fit && gain > bestGain) {
        bestGain = gain;
        bestSwap = j;
      }
    }
    // Closer slot: try swapping with a stronger earlier track
    if (bestSwap < 0 && i === result.length - 1) {
      for (let j = 1; j < i; j += 1) {
        const candidateFit = scorePositionFit(result[j]!, i, result.length, activity);
        const currentCloserFit = fit;
        const donorFit = scorePositionFit(result[i]!, j, result.length, activity);
        if (candidateFit > currentCloserFit + 0.12 && donorFit >= 0.35) {
          bestSwap = j;
          break;
        }
      }
    }
    if (bestSwap >= 0) {
      const tmp = result[i]!;
      result[i] = result[bestSwap]!;
      result[bestSwap] = tmp;
      reorders += 1;
    }
  }

  return { tracks: result, reorders };
}

/** Guard weak anthem / filler closer by swap or eject. */
export function guardWeakCloser<T extends HumanCurationTrack>(
  tracks: T[],
  activity: HumanCurationActivityHint,
): { tracks: T[]; changed: boolean; removed: boolean } {
  if (tracks.length < 2 || !activity) return { tracks: tracks.slice(), changed: false, removed: false };
  const lastIdx = tracks.length - 1;
  const closer = tracks[lastIdx]!;
  const closerFit = scorePositionFit(closer, lastIdx, tracks.length, activity);
  const severity = momentRejectSeverity(closer, activity, lastIdx, tracks.length);
  if (severity !== "hard" && closerFit >= 0.38) {
    return { tracks: tracks.slice(), changed: false, removed: false };
  }

  let bestIdx = -1;
  let bestFit = closerFit;
  for (let j = 0; j < lastIdx; j += 1) {
    const fit = scorePositionFit(tracks[j]!, lastIdx, tracks.length, activity);
    if (fit > bestFit + 0.08) {
      bestFit = fit;
      bestIdx = j;
    }
  }
  if (bestIdx >= 0) {
    const out = tracks.slice();
    const tmp = out[lastIdx]!;
    out[lastIdx] = out[bestIdx]!;
    out[bestIdx] = tmp;
    return { tracks: out, changed: true, removed: false };
  }

  if (severity === "hard" && tracks.length > MOMENT_FIT_MIN_VIABLE_LENGTH) {
    return { tracks: tracks.slice(0, lastIdx), changed: true, removed: true };
  }
  return { tracks: tracks.slice(), changed: false, removed: false };
}

function trackLabel(track: HumanCurationTrack): string {
  return `${track.artistName ?? "?"} — ${track.trackName ?? "?"}`;
}

function trackIdentityKey(track: HumanCurationTrack): string {
  const id = track.trackId;
  if (id) return String(id);
  return `${String(track.artistName ?? "").toLowerCase().trim()}|${String(track.trackName ?? "").toLowerCase().trim()}`;
}

function isDuplicateInPlaylist<T extends HumanCurationTrack>(candidate: T, playlist: T[]): boolean {
  const candKey = trackIdentityKey(candidate);
  for (const t of playlist) {
    if (trackIdentityKey(t) === candKey) return true;
    const playlistNear = nearDuplicateKey({ name: t.trackName, artist: t.artistName });
    const candNear = nearDuplicateKey({ name: candidate.trackName, artist: candidate.artistName });
    if (playlistNear && candNear && playlistNear === candNear) return true;
  }
  return false;
}

function passesWorldForReplacement<T extends HumanCurationTrack>(
  track: T,
  profile: CulturalWorldProfile | null | undefined,
  minWorld = 0.72,
): boolean {
  if (!profile) return true;
  return scoreTrackWorldIdentity(track, profile) >= minWorld;
}

function capReplacementPool<T extends HumanCurationTrack>(pool: T[]): T[] {
  return pool.length > MOMENT_REPLACEMENT_POOL_CAP
    ? pool.slice(0, MOMENT_REPLACEMENT_POOL_CAP)
    : pool;
}

/** V19: merge delivered + expansion candidates, hard-capped for cross-pool moment replacement. */
export function buildMomentReplacementPool<T extends HumanCurationTrack>(
  delivered: T[],
  expansion?: T[],
): T[] {
  const merged = [
    ...delivered,
    ...(expansion && expansion.length > 0 ? expansion : []),
  ].filter(
    (track) =>
      !isSemanticSpamTrack({
        artistName: track.artistName,
        trackName: track.trackName,
      }),
  );
  return capReplacementPool(merged);
}

function searchCrossPoolReplacement<T extends HumanCurationTrack>(
  playlist: T[],
  slotIndex: number,
  activity: HumanCurationActivityHint,
  pool: T[],
  opts: {
    prompt: string;
    culturalProfile?: CulturalWorldProfile | null;
    usedPoolKeys: Set<string>;
  },
): {
  replacement: T | null;
  candidatePoolSize: number;
  eligibleCandidates: number;
  momentFitCandidates: number;
  replacementScore: number | null;
  replacementReason: string | null;
} {
  const cappedPool = capReplacementPool(pool);
  let eligibleCandidates = 0;
  let momentFitCandidates = 0;
  let best: T | null = null;
  let bestScore = -1;
  let replacementReason: string | null = null;

  for (const candidate of cappedPool) {
    const key = trackIdentityKey(candidate);
    if (opts.usedPoolKeys.has(key)) continue;
    if (isDuplicateInPlaylist(candidate, playlist)) continue;
    eligibleCandidates += 1;

    if (momentRejectSeverity(candidate, activity, slotIndex, playlist.length) === "hard") continue;
    if (!passesMomentFitForRefill(candidate, opts.prompt)) continue;
    momentFitCandidates += 1;

    if (!passesWorldForReplacement(candidate, opts.culturalProfile)) continue;

    const fit = scorePositionFit(candidate, slotIndex, playlist.length, activity);
    if (fit > bestScore) {
      bestScore = fit;
      best = candidate;
      replacementReason = `position_fit:${fit.toFixed(2)}`;
    }
  }

  return {
    replacement: best,
    candidatePoolSize: cappedPool.length,
    eligibleCandidates,
    momentFitCandidates,
    replacementScore: best ? bestScore : null,
    replacementReason,
  };
}

export type EjectOrReplaceOpts<T extends HumanCurationTrack> = {
  maxRounds?: number;
  replacementPool?: T[];
  prompt?: string;
  culturalProfile?: CulturalWorldProfile | null;
};

/** Eject or replace hard moment-fit failures from the body of the playlist. */
export function ejectOrReplaceBadMomentTracks<T extends HumanCurationTrack>(
  tracks: T[],
  activity: HumanCurationActivityHint,
  opts: EjectOrReplaceOpts<T> | number = {},
): {
  tracks: T[];
  removals: number;
  replacements: number;
  crossPoolReplacements: number;
  momentReplacementDiagnostics: MomentCrossPoolReplacementDiagnostic[];
} {
  const resolvedOpts: EjectOrReplaceOpts<T> =
    typeof opts === "number" ? { maxRounds: opts } : opts;
  const maxRounds = resolvedOpts.maxRounds ?? 2;
  const replacementPool = resolvedOpts.replacementPool ?? [];
  const prompt = resolvedOpts.prompt ?? "";
  const culturalProfile = resolvedOpts.culturalProfile ?? null;
  const hasCrossPool = replacementPool.length > 0 && prompt.length > 0;

  if (tracks.length < 2 || !activity) {
    return {
      tracks: tracks.slice(),
      removals: 0,
      replacements: 0,
      crossPoolReplacements: 0,
      momentReplacementDiagnostics: [],
    };
  }

  let working = tracks.slice();
  let removals = 0;
  let replacements = 0;
  let crossPoolReplacements = 0;
  const momentReplacementDiagnostics: MomentCrossPoolReplacementDiagnostic[] = [];
  const usedPoolKeys = new Set(working.map((t) => trackIdentityKey(t)));

  const tryCrossPoolAt = (index: number, rejectReason: string, originalLabel: string): boolean => {
    if (!hasCrossPool || crossPoolReplacements >= MOMENT_CROSS_POOL_MAX_ATTEMPTS) {
      momentReplacementDiagnostics.push({
        originalTrack: originalLabel,
        rejectReason,
        replacementSearchAttempted: hasCrossPool,
        candidatePoolSize: capReplacementPool(replacementPool).length,
        eligibleCandidates: 0,
        momentFitCandidates: 0,
        selectedReplacement: null,
        replacementScore: null,
        replacementReason: null,
        fallbackToEject: true,
      });
      return false;
    }

    const search = searchCrossPoolReplacement(working, index, activity, replacementPool, {
      prompt,
      culturalProfile,
      usedPoolKeys,
    });

    if (search.replacement) {
      const key = trackIdentityKey(search.replacement);
      usedPoolKeys.add(key);
      working[index] = search.replacement;
      replacements += 1;
      crossPoolReplacements += 1;
      momentReplacementDiagnostics.push({
        originalTrack: originalLabel,
        rejectReason,
        replacementSearchAttempted: true,
        candidatePoolSize: search.candidatePoolSize,
        eligibleCandidates: search.eligibleCandidates,
        momentFitCandidates: search.momentFitCandidates,
        selectedReplacement: trackLabel(search.replacement),
        replacementScore: search.replacementScore,
        replacementReason: search.replacementReason,
        fallbackToEject: false,
      });
      return true;
    }

    momentReplacementDiagnostics.push({
      originalTrack: originalLabel,
      rejectReason,
      replacementSearchAttempted: true,
      candidatePoolSize: search.candidatePoolSize,
      eligibleCandidates: search.eligibleCandidates,
      momentFitCandidates: search.momentFitCandidates,
      selectedReplacement: null,
      replacementScore: null,
      replacementReason: null,
      fallbackToEject: true,
    });
    return false;
  };

  for (let round = 0; round < maxRounds; round += 1) {
    let changed = false;
    for (let i = working.length - 1; i >= 0; i -= 1) {
      const badTrack = working[i]!;
      const severity = momentRejectSeverity(badTrack, activity, i, working.length);
      if (severity !== "hard") continue;

      const title = titleOf(badTrack);
      const rejectReason = `hard_moment_fit:${activity}:${title.slice(0, 40)}`;
      const cooldownOnly = activity === "gym" && working.length >= 10 && i >= working.length - 2;
      const midSetGymBallad =
        activity === "gym" && !cooldownOnly && i >= 1 && POWER_BALLAD_TITLE.test(title);

      if (midSetGymBallad) {
        const originalLabel = trackLabel(badTrack);
        if (tryCrossPoolAt(i, `${rejectReason}:gym_ballad`, originalLabel)) {
          changed = true;
          continue;
        }
        if (working.length > MOMENT_FIT_MIN_VIABLE_LENGTH) {
          working.splice(i, 1);
          removals += 1;
          changed = true;
        }
        continue;
      }

      let bestIdx = -1;
      let bestFit = scorePositionFit(badTrack, i, working.length, activity);
      for (let j = 0; j < working.length; j += 1) {
        if (j === i) continue;
        if (momentRejectSeverity(working[j]!, activity, i, working.length) === "hard") continue;
        const fit = scorePositionFit(working[j]!, i, working.length, activity);
        if (fit > bestFit + 0.05) {
          bestFit = fit;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) {
        const tmp = working[i]!;
        working[i] = working[bestIdx]!;
        working[bestIdx] = tmp;
        replacements += 1;
        changed = true;
        continue;
      }

      const originalLabel = trackLabel(badTrack);
      if (tryCrossPoolAt(i, rejectReason, originalLabel)) {
        changed = true;
        continue;
      }

      if (working.length > MOMENT_FIT_MIN_VIABLE_LENGTH) {
        working.splice(i, 1);
        removals += 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { tracks: working, removals, replacements, crossPoolReplacements, momentReplacementDiagnostics };
}

/** Limit rolling artist share without banning strong anchors entirely. */
export function limitRollingArtistShare<T extends HumanCurationTrack>(
  tracks: T[],
  maxShare: number,
): { tracks: T[]; demoted: number } {
  if (tracks.length < 4) return { tracks: tracks.slice(), demoted: 0 };
  const counts = new Map<string, number>();
  for (const t of tracks) {
    const k = artistKey(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const cap = Math.max(2, Math.floor(tracks.length * maxShare));
  const over = [...counts.entries()].filter(([, n]) => n > cap).map(([k]) => k);
  if (over.length === 0) return { tracks: tracks.slice(), demoted: 0 };

  const result = tracks.slice();
  let demoted = 0;
  for (const artist of over) {
    let seen = 0;
    for (let i = result.length - 1; i >= 0; i -= 1) {
      if (artistKey(result[i]!) !== artist) continue;
      seen += 1;
      if (seen <= cap) continue;
      const swapIdx = result.findIndex((t, idx) => idx < i && artistKey(t) !== artist && !over.includes(artistKey(t)));
      if (swapIdx >= 0) {
        const tmp = result[i]!;
        result[i] = result[swapIdx]!;
        result[swapIdx] = tmp;
        demoted += 1;
      }
    }
  }
  return { tracks: result, demoted };
}

/**
 * Apply human curation sequencing — anti-repetition, moment fit, deep-cut opener guard.
 * Runs after world purity; reorder-only.
 */
export function applyHumanCurationSequencing<T extends HumanCurationTrack>(
  tracks: T[],
  opts: HumanCurationSequencerOpts,
): HumanCurationSequencerResult<T> {
  if (tracks.length <= 1) {
    return {
      tracks: tracks.slice(),
      swaps: 0,
      reorders: 0,
      removals: 0,
      replacements: 0,
      diagnostics: [],
      momentReplacementDiagnostics: [],
    };
  }

  const activity = opts.activityHint ?? inferHumanCurationActivity(opts.prompt);
  const diagnostics: string[] = [];
  const momentReplacementDiagnostics: MomentCrossPoolReplacementDiagnostic[] = [];
  let working = tracks.slice();
  let swaps = 0;
  let reorders = 0;
  let removals = 0;
  let replacements = 0;

  const eject = ejectOrReplaceBadMomentTracks(working, activity, {
    replacementPool: opts.replacementPool as T[] | undefined,
    prompt: opts.prompt,
    culturalProfile: opts.culturalProfile,
  });
  if (eject.removals > 0 || eject.replacements > 0) {
    working = eject.tracks;
    removals += eject.removals;
    replacements += eject.replacements;
    momentReplacementDiagnostics.push(...eject.momentReplacementDiagnostics);
    diagnostics.push(
      `moment_eject:rm${eject.removals}:rp${eject.replacements}:xp${eject.crossPoolReplacements}`,
    );
  }

  const deepCut = guardDeepCutOpener(working, activity, opts.preserveThesisOpener !== false);
  if (deepCut.swapped) {
    working = deepCut.tracks;
    swaps += 1;
    diagnostics.push("deep_cut_opener_guard");
  }

  if (opts.culturalProfile) {
    const anchorPromo = promoteSceneAnchorsInPlaylist(working, opts.culturalProfile);
    if (anchorPromo.promotions > 0) {
      working = anchorPromo.tracks;
      swaps += anchorPromo.promotions;
      diagnostics.push(`scene_anchor_promote:${anchorPromo.promotions}`);
    }
  }

  const antiRun = breakConsecutiveArtistRuns(working, {
    maxRun: opts.maxConsecutiveSameArtist ?? 2,
    preserveIndex0: false,
    scoreFit: (t, idx) => scorePositionFit(t, idx, working.length, activity),
  });
  if (antiRun.swaps > 0) {
    working = antiRun.tracks;
    swaps += antiRun.swaps;
    diagnostics.push(`artist_run_break:${antiRun.swaps}`);
  }

  if (activity === "country") {
    const share = limitRollingArtistShare(working, 0.45);
    if (share.demoted > 0) {
      working = share.tracks;
      swaps += share.demoted;
      diagnostics.push(`country_artist_share:${share.demoted}`);
    }
  }

  const moment = reorderWeakMomentSlots(working, activity);
  if (moment.reorders > 0) {
    working = moment.tracks;
    reorders += moment.reorders;
    diagnostics.push(`moment_reorder:${moment.reorders}`);
  }

  const closer = guardWeakCloser(working, activity);
  if (closer.changed) {
    working = closer.tracks;
    if (closer.removed) removals += 1;
    else swaps += 1;
    diagnostics.push(closer.removed ? "weak_closer_removed" : "weak_closer_swap");
  }

  return { tracks: working, swaps, reorders, removals, replacements, diagnostics, momentReplacementDiagnostics };
}

const POWER_BALLAD_RE =
  /\b(?:don'?t\s+cry|sweet\s+child|stairway|november\s+rain|every\s+rose|nothing\s+else\s+matters|patience|wind\s+of\s+change|with\s+or\s+without\s+you|dream\s+on|more\s+than\s+a\s+feeling|free\s+bird|bohemian\s+rhapsody)\b/i;

const ANTHEMIC_TAIL_RE =
  /\b(?:shout|livin'? on a prayer|don'?t\s+stop\s+believin|we\s+will\s+rock\s+you|eye\s+of\s+the\s+tiger|final\s+countdown)\b/i;

export type ListenabilityFailure = {
  code: string;
  severity: "major" | "minor";
  detail: string;
  trackIndex?: number;
};

/** Evidence-based listenability failures aligned with benchmark human reviews. */
export function detectListenabilityFailures(
  tracks: HumanCurationTrack[],
  prompt: string,
): ListenabilityFailure[] {
  const activity = inferHumanCurationActivity(prompt);
  const failures: ListenabilityFailure[] = [];
  const len = tracks.length;

  if (len === 0) {
    failures.push({ code: "empty_delivery", severity: "major", detail: "No tracks delivered." });
    return failures;
  }
  if (len === 1) {
    failures.push({ code: "stub_playlist", severity: "major", detail: "Single-track stub cannot sustain a moment." });
  }

  if (tracks[0] && isObscureDeepCutOpener(tracks[0], 0)) {
    failures.push({
      code: "obscure_opener",
      severity: "major",
      detail: `Obscure opener: ${tracks[0].artistName} — ${tracks[0].trackName}`,
      trackIndex: 0,
    });
  }

  const maxRun = (() => {
    let best = 1;
    let run = 1;
    for (let i = 1; i < len; i += 1) {
      if (artistKey(tracks[i]!) === artistKey(tracks[i - 1]!)) {
        run += 1;
        best = Math.max(best, run);
      } else {
        run = 1;
      }
    }
    return best;
  })();
  if (maxRun >= 3) {
    failures.push({
      code: "artist_run_3",
      severity: "major",
      detail: `${maxRun} consecutive tracks from the same artist.`,
    });
  }

  if (activity === "gym" || /\bgym\b|\bworkout\b/i.test(prompt)) {
    for (let i = 0; i < len; i += 1) {
      const t = tracks[i]!;
      const title = titleOf(t);
      const cooldownOnly = len >= 10 && i >= len - 2;
      if (cooldownOnly) continue;
      if (POWER_BALLAD_RE.test(title) || (energyOf(t) < 0.55 && i >= Math.floor(len * 0.25))) {
        failures.push({
          code: "gym_ballad_midset",
          severity: "major",
          detail: `Power ballad / low-energy mid-workout: ${t.artistName} — ${t.trackName} at #${i + 1}`,
          trackIndex: i,
        });
      }
    }
  }

  if (activity === "bbq" || /\bbbq\b|\bdad\s+rock\b/i.test(prompt)) {
    for (let i = 0; i < Math.min(5, len); i += 1) {
      const t = tracks[i]!;
      if (POWER_BALLAD_RE.test(titleOf(t)) || energyOf(t) < 0.45) {
        failures.push({
          code: "bbq_slow_epic_early",
          severity: "major",
          detail: `Slow epic kills BBQ momentum: ${t.artistName} — ${t.trackName} at #${i + 1}`,
          trackIndex: i,
        });
      }
    }
  }

  if (activity === "motorway_rain") {
    const tail = tracks[len - 1];
    if (tail && (ANTHEMIC_TAIL_RE.test(titleOf(tail)) || energyOf(tail) > 0.82)) {
      failures.push({
        code: "motorway_anthem_tail",
        severity: "major",
        detail: `Anthemic / high-energy tail breaks nocturnal rain mood: ${tail.artistName} — ${tail.trackName}`,
        trackIndex: len - 1,
      });
    }
  }

  if (activity === "madchester") {
    const artists = tracks.map((t) => artistKey(t));
    const hasStoneRoses = artists.some((a) => a.includes("stone roses"));
    const hasHappyMondays = artists.some((a) => a.includes("happy mondays"));
    const oasisCount = artists.filter((a) => a.includes("oasis")).length;
    if (!hasStoneRoses && !hasHappyMondays) {
      failures.push({
        code: "madchester_missing_canonical",
        severity: "major",
        detail: "Missing Stone Roses / Happy Mondays — Oasis-default smell.",
      });
    }
    if (oasisCount >= 2 && maxRun >= 2) {
      failures.push({
        code: "madchester_oasis_cluster",
        severity: "minor",
        detail: `Oasis-heavy (${oasisCount} tracks) without scene spine diversity.`,
      });
    }
  }

  if (activity === "disco" && len < 3) {
    failures.push({
      code: "disco_thin_delivery",
      severity: "major",
      detail: `Disco delivery too thin (${len} tracks) — cannot sustain a party arc.`,
    });
  }

  if (activity === "country") {
    const zachRuns = (() => {
      let best = 0;
      let run = 0;
      for (const t of tracks) {
        if (artistKey(t).includes("zach bryan")) {
          run += 1;
          best = Math.max(best, run);
        } else {
          run = 0;
        }
      }
      return best;
    })();
    if (zachRuns >= 3) {
      failures.push({
        code: "country_artist_cluster",
        severity: "minor",
        detail: `Zach Bryan ${zachRuns}× consecutive — needs variety on a road trip.`,
      });
    }
  }

  return failures;
}
