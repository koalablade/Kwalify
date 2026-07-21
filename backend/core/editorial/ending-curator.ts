/**
 * Ending curation — humans land playlists with cooldown, discovery tail, and closure.
 * Reorder-only pass after opening curator / local search.
 */

import {
  loadHumanPlaylistPatternProfile,
  scoreAgainstHumanPlaylistPatterns,
  type PatternScoringTrack,
} from "./human-playlist-patterns";
import { humanPlausibilityScore } from "./playlist-local-search";

export type EndingCuratorMode = "cooldown" | "peak" | "default";

export type EndingCuratorOpts = {
  endingSize?: number;
  /** Prompt / vibe — used to pick cooldown vs peak ending shape. */
  vibe?: string | null;
  mode?: EndingCuratorMode;
};

export type EndingCuratorResult<T extends PatternScoringTrack> = {
  tracks: T[];
  scoreBefore: number;
  scoreAfter: number;
  swaps: number;
  mode: EndingCuratorMode;
};

function artistKey(track: PatternScoringTrack): string {
  return (track.artistName ?? "unknown").toLowerCase();
}

const SOFT_ENDING_RE =
  /\b(?:lo-?fi|chillhop|study|ambient|comedown|afterparty|after\s+party|quiet\s+rage|melanchol|sad\s+(?:night\s+)?driv|goth|darkwave|soft|calm|sleep|focus|rain|intimacy|healing|ballad|walking\s+past|old\s+school|nostalg)\b/i;
const PEAK_ENDING_RE =
  /\b(?:boss\s+fight|boss\s+battle|gym|workout|festival|rave|party|dancefloor|neon|synthwave|hard\s+techno|grunge|metal)\b/i;

export function resolveEndingCuratorMode(vibe?: string | null, explicit?: EndingCuratorMode): EndingCuratorMode {
  if (explicit && explicit !== "default") return explicit;
  const text = vibe ?? "";
  if (SOFT_ENDING_RE.test(text) && !PEAK_ENDING_RE.test(text)) return "cooldown";
  if (PEAK_ENDING_RE.test(text) && !SOFT_ENDING_RE.test(text)) return "peak";
  if (SOFT_ENDING_RE.test(text)) return "cooldown";
  return explicit ?? "default";
}

function endingScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length === 0) return 0;
  const tailSize = Math.min(8, Math.max(4, Math.floor(tracks.length * 0.22)));
  const slice = tracks.slice(-tailSize);
  const pattern = scoreAgainstHumanPlaylistPatterns(slice).score;
  const plausibility = humanPlausibilityScore(slice);
  return pattern * 0.5 + plausibility * 0.5;
}

function tailDiscoveryScore(track: PatternScoringTrack): number {
  if (typeof track.rediscoveryScore === "number") return track.rediscoveryScore;
  if (typeof track.popularity === "number") return Math.max(0, Math.min(1, 1 - track.popularity / 100));
  return 0.4;
}

function energyTargetForMode(mode: EndingCuratorMode, profile: ReturnType<typeof loadHumanPlaylistPatternProfile>): number {
  if (mode === "peak") return 0.62 + profile.energyArcCooldownWeight * 0.05;
  if (mode === "cooldown") return 0.34 - profile.energyArcCooldownWeight * 0.08;
  return 0.42 - profile.energyArcCooldownWeight * 0.12;
}

function tailEnergyScore(
  track: PatternScoringTrack,
  profile: ReturnType<typeof loadHumanPlaylistPatternProfile>,
  mode: EndingCuratorMode,
): number {
  const energy = track.energy ?? 0.5;
  const target = energyTargetForMode(mode, profile);
  const softness = mode === "cooldown" ? 2.8 : mode === "peak" ? 1.8 : 2.2;
  return Math.max(0, 1 - Math.abs(energy - target) * softness);
}

/** Soft endings must not land on arena/party spikes (Def Leppard / Heart of Glass class). */
function endingWorldPenalty(track: PatternScoringTrack, mode: EndingCuratorMode): number {
  if (mode !== "cooldown") return 0;
  const energy = track.energy ?? 0.5;
  const dance = track.danceability ?? 0.5;
  const popularity = track.popularity ?? 50;
  let penalty = 0;
  if (energy >= 0.72) penalty += 0.22;
  if (energy >= 0.62 && dance >= 0.68) penalty += 0.14;
  if (popularity >= 78 && energy >= 0.58) penalty += 0.1;
  return penalty;
}

function endingValid(tail: PatternScoringTrack[]): boolean {
  const artists = tail.map(artistKey);
  if (new Set(artists).size !== artists.length) return false;
  // No artist may own more than one of the final three slots after a swap trial.
  const last3 = artists.slice(-3);
  return new Set(last3).size === last3.length;
}

function scoreTailCandidate(
  track: PatternScoringTrack,
  posInTail: number,
  size: number,
  profile: ReturnType<typeof loadHumanPlaylistPatternProfile>,
  mode: EndingCuratorMode,
): number {
  const nearEnd = posInTail >= size - 2;
  const nearCooldown = posInTail >= size - 3;
  return (
    tailDiscoveryScore(track) * (nearEnd ? 0.14 : 0.04) +
    tailEnergyScore(track, profile, mode) * (nearCooldown ? 0.14 : 0.04) -
    endingWorldPenalty(track, mode) * (nearEnd ? 1.2 : 0.7)
  );
}

export function curatePlaylistEnding<T extends PatternScoringTrack>(
  playlist: T[],
  endingSizeOrOpts: number | EndingCuratorOpts = 6,
): EndingCuratorResult<T> {
  const opts: EndingCuratorOpts =
    typeof endingSizeOrOpts === "number" ? { endingSize: endingSizeOrOpts } : endingSizeOrOpts;
  const endingSize = opts.endingSize ?? 6;
  const mode = resolveEndingCuratorMode(opts.vibe, opts.mode);

  if (playlist.length <= endingSize + 5) {
    const score = endingScore(playlist);
    return { tracks: playlist.slice(), scoreBefore: score, scoreAfter: score, swaps: 0, mode };
  }

  const profile = loadHumanPlaylistPatternProfile();
  const size = Math.min(endingSize, 8);
  const tailStart = playlist.length - size;
  let current = playlist.slice();
  const scoreBefore = endingScore(current);
  let swaps = 0;

  for (let pass = 0; pass < size * 2; pass += 1) {
    let improved = false;
    for (let i = tailStart; i < current.length; i += 1) {
      for (let j = tailStart; j < current.length; j += 1) {
        if (i === j) continue;
        if (artistKey(current[i]!) === artistKey(current[j]!)) continue;
        const trial = current.slice();
        const tmp = trial[i]!;
        trial[i] = trial[j]!;
        trial[j] = tmp;
        const tail = trial.slice(tailStart);
        if (!endingValid(tail)) continue;
        const posInTail = i - tailStart;
        const before =
          endingScore(current) + scoreTailCandidate(current[i]!, posInTail, size, profile, mode);
        const after =
          endingScore(trial) + scoreTailCandidate(trial[i]!, posInTail, size, profile, mode);
        if (after > before + 0.007) {
          current = trial;
          swaps += 1;
          improved = true;
        }
      }
      for (let j = Math.max(0, tailStart - 12); j < tailStart; j += 1) {
        if (artistKey(current[j]!) === artistKey(current[i]!)) continue;
        const trial = current.slice();
        const tmp = trial[i]!;
        trial[i] = trial[j]!;
        trial[j] = tmp;
        if (!endingValid(trial.slice(tailStart))) continue;
        const posInTail = i - tailStart;
        const before =
          endingScore(current) + scoreTailCandidate(current[i]!, posInTail, size, profile, mode);
        const after =
          endingScore(trial) + scoreTailCandidate(trial[i]!, posInTail, size, profile, mode);
        if (after > before + 0.008) {
          current = trial;
          swaps += 1;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return {
    tracks: current,
    scoreBefore,
    scoreAfter: endingScore(current),
    swaps,
    mode,
  };
}
