/**
 * Rediscovery retrieval scoring — forgotten favourites, underused artists, low recency.
 */

import { computeRediscoveryScore, type RediscoveryMode } from "./forgotten-favourites";
import type { TrackLibrarySignal } from "./library-signals";
import {
  scoreTrackSonicPromptFit,
  scoreUserSonicAffinity,
  type PromptSonicTarget,
  type SonicTasteProfile,
  type SonicTrackFeatures,
} from "./sonic-taste-profile";

export type RediscoveryRetrievalInput = {
  track: SonicTrackFeatures & { trackId: string; artistName?: string | null };
  signal: TrackLibrarySignal | null;
  emotionFit: number;
  sonicPromptFit: number;
  sonicUserFit: number;
  activityFit: number;
  artistPlaylistCount: number;
};

export function scoreForgottenFavourite(input: RediscoveryRetrievalInput, mode: RediscoveryMode = "balanced"): number {
  if (!input.signal) return input.sonicPromptFit * 0.35 + input.activityFit * 0.25;

  const rediscovery = computeRediscoveryScore({
    signal: input.signal,
    emotionFit: input.emotionFit,
    profile: { energy: 0.5, valence: 0.5, tension: 0.3, nostalgia: 0.4, calm: 0.4, environment: null, timeOfDay: null, motionState: null },
    mode,
  });

  let score =
    rediscovery * 0.38 +
    input.sonicPromptFit * 0.28 +
    input.activityFit * 0.22 +
    input.sonicUserFit * 0.12;

  if (input.signal.playlistAppearances === 0) score += 0.12;
  else if (input.signal.playlistAppearances >= 3) score -= 0.15;

  if (input.signal.daysSinceSurfaced == null) score += 0.08;
  else if (input.signal.daysSinceSurfaced > 45) score += 0.1;
  else if (input.signal.daysSinceSurfaced < 7) score -= 0.12;

  if (input.signal.artistUnderused) score += 0.1;
  if (input.artistPlaylistCount >= 4) score -= 0.08;

  return Math.max(0, Math.min(1, score));
}

export function scoreSonicMatchCandidate(
  track: SonicTrackFeatures,
  promptTarget: PromptSonicTarget,
  userProfile: SonicTasteProfile | null,
  activityFit: number,
): number {
  const promptFit = scoreTrackSonicPromptFit(track, promptTarget, userProfile);
  const userFit = userProfile ? scoreUserSonicAffinity(track, userProfile) : 0.5;
  return Math.max(0, Math.min(1, promptFit * 0.62 + userFit * 0.18 + activityFit * 0.2));
}

export function buildRediscoveryRetrievalInput<T extends SonicTrackFeatures & { trackId: string; artistName?: string | null }>(
  track: T,
  opts: {
    signal: TrackLibrarySignal | null;
    emotionFit: number;
    activityFit: number;
    promptTarget: PromptSonicTarget;
    userProfile: SonicTasteProfile | null;
    artistPlaylistCount: number;
  },
): RediscoveryRetrievalInput {
  const sonicPromptFit = scoreTrackSonicPromptFit(track, opts.promptTarget, opts.userProfile);
  const sonicUserFit = opts.userProfile ? scoreUserSonicAffinity(track, opts.userProfile) : 0.5;
  return {
    track,
    signal: opts.signal,
    emotionFit: opts.emotionFit,
    sonicPromptFit,
    sonicUserFit,
    activityFit: opts.activityFit,
    artistPlaylistCount: opts.artistPlaylistCount,
  };
}

export function penalizeFrequentFavourite(
  baseScore: number,
  signal: TrackLibrarySignal | null,
  artistPlaylistCount: number,
): number {
  if (!signal) return baseScore;
  let penalty = 0;
  if (signal.playlistAppearances >= 3) penalty += 0.25;
  else if (signal.playlistAppearances >= 2) penalty += 0.12;
  if (signal.daysSinceSurfaced != null && signal.daysSinceSurfaced < 5) penalty += 0.15;
  if (artistPlaylistCount >= 5) penalty += 0.08;
  return Math.max(0, baseScore - penalty);
}
