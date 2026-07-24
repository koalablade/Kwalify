/**
 * Opening Curator v2 — mandatory editorial pass on tracks 1–5.
 *
 * Reorders existing playlist members only. Does not rescore the candidate pool
 * or modify generation weights.
 */

import {
  resolveActivityProfile,
  scoreActivityCandidateFit,
  trackFailsActivityHardGate,
  type ActivityClassificationInput,
  type ActivityIntentInput,
  type ActivityTrackInput,
} from "./activity-profiles";
import type { PatternScoringTrack } from "../core/editorial/human-playlist-patterns";
import { createOpeningLock, type OpeningLock } from "./opening-lock";
import { OPENER_FILLER_PATTERN } from "../core/editorial/opener-hygiene";

export const OPENING_WINDOW_SIZE = 5;

export type OpeningCuratorV2Track = PatternScoringTrack & {
  trackId: string;
  trackName?: string | null;
};

export type OpeningDecision = {
  openerTrackId: string;
  openingReason: string;
  rejectedOpeningCandidates: string[];
  identityStrength: number;
  continuityScore: number;
};

export type OpeningCuratorV2Opts<T extends OpeningCuratorV2Track> = {
  prompt: string;
  tracks: T[];
  openingSize?: number;
  lockedOpenerTrackId?: string | null;
  scorePromptRelevance: (track: T, position: number) => number;
  classifyForActivity?: (track: T) => ActivityClassificationInput;
  intentForActivity?: ActivityIntentInput;
  allowObscureOpeners?: boolean;
  /** Max psych-indie retrieval fillers allowed in opener slots 1–3 (0 = none). */
  maxPsychOpenersInOpening?: number;
};

export type OpeningCuratorV2Result<T extends OpeningCuratorV2Track> = {
  tracks: T[];
  openingDecision: OpeningDecision;
  openingLock: OpeningLock | null;
  swaps: number;
};

const DISCOVERY_PROMPT_RE = /\b(?:discover|deep cut|obscure|hidden gem|never heard|underground|rarity|rarities)\b/i;

const FUNCTIONAL_ACTIVITY_IDS = new Set(["gym", "focus_coding", "study", "party_pregame"]);

function isFunctionalActivityPrompt(prompt: string, intent: ActivityIntentInput | undefined): boolean {
  const profile = resolveActivityProfile(prompt, intent ?? {});
  return !!profile && FUNCTIONAL_ACTIVITY_IDS.has(profile.id);
}

function openerActivityFit<T extends OpeningCuratorV2Track>(
  track: T,
  opts: OpeningCuratorV2Opts<T>,
): number {
  const profile = resolveActivityProfile(opts.prompt, opts.intentForActivity ?? {});
  if (!profile) return 0.5;
  const classification = opts.classifyForActivity?.(track) ?? {};
  return scoreActivityCandidateFit(
    track as ActivityTrackInput,
    classification,
    profile,
    opts.prompt,
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function artistKey(track: OpeningCuratorV2Track): string {
  return (track.artistName ?? "unknown").toLowerCase();
}

function energyOf(track: OpeningCuratorV2Track): number {
  return track.energy ?? 0.5;
}

function textureBucket(track: OpeningCuratorV2Track): string {
  const acoustic = track.acousticness ?? 0.5;
  const dance = track.danceability ?? 0.5;
  if (acoustic >= 0.55) return "acoustic";
  if (dance >= 0.65) return "rhythmic";
  if (acoustic <= 0.25 && dance <= 0.45) return "dense";
  return "balanced";
}

function isObscure(track: OpeningCuratorV2Track): boolean {
  const pop = track.popularity;
  if (typeof pop === "number" && pop < 22) return true;
  const rediscovery = track.rediscoveryScore ?? 0;
  return rediscovery >= 0.68;
}

function activityHardGate<T extends OpeningCuratorV2Track>(
  track: T,
  prompt: string,
  intent: ActivityIntentInput | undefined,
  classify?: (track: T) => ActivityClassificationInput,
): boolean {
  const profile = resolveActivityProfile(prompt, intent ?? {});
  if (!profile) return false;
  const classification = classify?.(track) ?? {};
  return trackFailsActivityHardGate(
    track as ActivityTrackInput,
    classification,
    profile,
    prompt,
  );
}

function hardRejectReason<T extends OpeningCuratorV2Track>(
  track: T,
  position: number,
  opening: T[],
  opts: OpeningCuratorV2Opts<T>,
): string | null {
  const maxPsych = opts.maxPsychOpenersInOpening ?? 1;
  const artist = String(track.artistName ?? "");
  if (position < 3 && OPENER_FILLER_PATTERN.test(artist)) {
    const fillersBefore = opening
      .slice(0, position)
      .filter((t) => OPENER_FILLER_PATTERN.test(String(t.artistName ?? ""))).length;
    if (maxPsych === 0 || fillersBefore >= maxPsych) return "retrieval_filler_opener";
  }

  if (activityHardGate(track, opts.prompt, opts.intentForActivity, opts.classifyForActivity)) {
    return "activity_mismatch";
  }

  const relevance = opts.scorePromptRelevance(track, position);
  if (relevance < 0.08) return "weak_prompt_relevance";

  if (position === 0) {
    if (!opts.allowObscureOpeners && isObscure(track)) return "obscure_opener";
    if (isFunctionalActivityPrompt(opts.prompt, opts.intentForActivity)) {
      const activityFit = openerActivityFit(track, opts);
      if (activityFit < 0.42) return "activity_fit_below_energy";
    }
    return null;
  }

  const prev = opening[position - 1];
  if (!prev) return null;

  if (artistKey(prev) === artistKey(track)) return "artist_repeat";

  const energyJump = Math.abs(energyOf(prev) - energyOf(track));
  const textureJump = textureBucket(prev) !== textureBucket(track);

  if (position <= 2) {
    if (energyJump > 0.32) return "extreme_energy_mismatch";
    if (textureJump && energyJump > 0.2) return "genre_shock";
  } else if (textureJump && energyJump > 0.34) {
    return "genre_shock";
  }

  return null;
}

function identityScore<T extends OpeningCuratorV2Track>(track: T, opts: OpeningCuratorV2Opts<T>): number {
  const relevance = opts.scorePromptRelevance(track, 0);
  const pop = typeof track.popularity === "number"
    ? clamp01(track.popularity / 100)
    : typeof track.rediscoveryScore === "number"
      ? clamp01(1 - track.rediscoveryScore)
      : 0.5;
  const obscurePenalty = !opts.allowObscureOpeners && isObscure(track) ? 0.35 : 0;
  if (isFunctionalActivityPrompt(opts.prompt, opts.intentForActivity)) {
    const activityFit = openerActivityFit(track, opts);
    if (activityFit < 0.42) return 0;
    const energy = energyOf(track);
    const energyFit = opts.intentForActivity?.activity === "gym" || opts.intentForActivity?.activity === "party"
      ? clamp01(energy)
      : clamp01(1 - Math.abs(energy - 0.45));
    return clamp01(activityFit * 0.55 + relevance * 0.25 + energyFit * 0.12 + pop * 0.08 - obscurePenalty);
  }
  return clamp01(relevance * 0.62 + pop * 0.18 + 0.2 - obscurePenalty);
}

function continuityScore<T extends OpeningCuratorV2Track>(track: T, opening: T[], opts: OpeningCuratorV2Opts<T>): number {
  const anchor = opening[0];
  if (!anchor) return 0;
  const relevance = opts.scorePromptRelevance(track, opening.length);
  const energyDelta = Math.abs(energyOf(anchor) - energyOf(track));
  const textureMatch = textureBucket(anchor) === textureBucket(track) ? 0.18 : 0;
  return clamp01(relevance * 0.5 + (1 - energyDelta * 1.4) * 0.32 + textureMatch);
}

function varietyScore<T extends OpeningCuratorV2Track>(track: T, opening: T[], opts: OpeningCuratorV2Opts<T>): number {
  const anchor = opening[0];
  if (!anchor) return 0;
  const relevance = opts.scorePromptRelevance(track, opening.length);
  const artists = new Set(opening.map(artistKey));
  const artistBonus = artists.has(artistKey(track)) ? 0 : 0.12;
  const energySpread = Math.abs(energyOf(anchor) - energyOf(track));
  const spreadBonus = energySpread >= 0.06 && energySpread <= 0.22 ? 0.1 : 0;
  const textureNovelty = textureBucket(anchor) !== textureBucket(track) ? 0.08 : 0;
  return clamp01(relevance * 0.45 + artistBonus + spreadBonus + textureNovelty + 0.25);
}

function pickBestIndex<T extends OpeningCuratorV2Track>(
  tracks: T[],
  used: Set<number>,
  opening: T[],
  position: number,
  opts: OpeningCuratorV2Opts<T>,
  scoreFn: (track: T, opening: T[]) => number,
  rejected: Map<string, string>,
): number | null {
  let bestIdx: number | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < tracks.length; i += 1) {
    if (used.has(i)) continue;
    const track = tracks[i]!;
    const reject = hardRejectReason(track, position, opening, opts);
    if (reject) {
      rejected.set(track.trackId, reject);
      continue;
    }
    const score = scoreFn(track, opening);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Assign tracks 1–5 by editorial role, then append the unchanged tail.
 */
export function applyOpeningCuratorV2<T extends OpeningCuratorV2Track>(
  opts: OpeningCuratorV2Opts<T>,
): OpeningCuratorV2Result<T> {
  const openingSize = Math.min(opts.openingSize ?? 5, 5);
  const tracks = opts.tracks.slice();

  if (tracks.length <= openingSize) {
    const opener = tracks[0];
    return {
      tracks,
      openingDecision: {
        openerTrackId: opener?.trackId ?? "",
        openingReason: "playlist_shorter_than_opening_window",
        rejectedOpeningCandidates: [],
        identityStrength: opener ? identityScore(opener, opts) : 0,
        continuityScore: 1,
      },
      openingLock: null,
      swaps: 0,
    };
  }

  const allowObscure = opts.allowObscureOpeners ?? DISCOVERY_PROMPT_RE.test(opts.prompt);
  const curatorOpts = { ...opts, allowObscureOpeners: allowObscure };
  const used = new Set<number>();
  const opening: T[] = [];
  const rejected = new Map<string, string>();
  const originalOpeningIds = tracks.slice(0, openingSize).map((t) => t.trackId);

  if (opts.lockedOpenerTrackId) {
    const lockedIdx = tracks.findIndex((t) => t.trackId === opts.lockedOpenerTrackId);
    if (lockedIdx >= 0) {
      used.add(lockedIdx);
      opening.push(tracks[lockedIdx]!);
    }
  }

  while (opening.length < openingSize) {
    const position = opening.length;
    let pick: number | null = null;

    if (position === 0) {
      pick = pickBestIndex(tracks, used, opening, position, curatorOpts, (track) => identityScore(track, curatorOpts), rejected);
    } else if (position <= 2) {
      pick = pickBestIndex(tracks, used, opening, position, curatorOpts, (track, op) => continuityScore(track, op, curatorOpts), rejected);
    } else {
      pick = pickBestIndex(tracks, used, opening, position, curatorOpts, (track, op) => varietyScore(track, op, curatorOpts), rejected);
    }

    if (pick == null) {
      for (let i = 0; i < tracks.length; i += 1) {
        if (!used.has(i)) {
          pick = i;
          rejected.set(tracks[i]!.trackId, "fallback_fill");
          break;
        }
      }
    }

    if (pick == null) break;
    used.add(pick);
    opening.push(tracks[pick]!);
  }

  const tail = tracks.filter((_, index) => !used.has(index));
  const reordered = [...opening, ...tail];

  const swaps = opening.filter((track, index) => originalOpeningIds[index] !== track.trackId).length;
  const opener = opening[0];
  const continuity = opening.length >= 3
    ? (continuityScore(opening[1]!, opening.slice(0, 1), curatorOpts) + continuityScore(opening[2]!, opening.slice(0, 2), curatorOpts)) / 2
    : 0;

  const openingReason = opts.lockedOpenerTrackId
    ? "locked_human_opener"
    : opening.length >= 3
      ? "identity_then_promise_then_variety"
      : "partial_opening_window";

  return {
    tracks: reordered,
    openingDecision: {
      openerTrackId: opener?.trackId ?? "",
      openingReason,
      rejectedOpeningCandidates: [...rejected.keys()],
      identityStrength: opener ? Math.round(identityScore(opener, curatorOpts) * 1000) / 1000 : 0,
      continuityScore: Math.round(continuity * 1000) / 1000,
    },
    openingLock: createOpeningLock(reordered),
    swaps,
  };
}
