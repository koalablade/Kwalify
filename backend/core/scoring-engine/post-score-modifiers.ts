/**
 * Post-hybrid modifiers — discovery, reference, memory, repetition penalty.
 * Runs AFTER tri-score; does not alter hybrid weights.
 */

import type { EmotionProfile } from "../../lib/emotion";
import type { ReferenceFingerprint } from "../../lib/reference-playlist";
import { referenceSimilarityBonus } from "../../lib/reference-playlist";
import {
  computeRediscoveryScore,
  rediscoveryScoreBoost,
  type RediscoveryMode,
} from "../../lib/forgotten-favourites";
import { chapterTrackBoost, type ChapterMatch } from "../../lib/music-life-chapters";
import {
  archaeologyRediscoveryBoost,
  type ArchaeologyIntent,
} from "../../lib/library-archaeology";
import { rediscoveryJitter } from "../../lib/rediscovery";
import type { LibrarySignals } from "../../lib/library-signals";
import {
  applyFreshnessToScore,
  type FreshnessStats,
} from "../../lib/playlist-freshness";
import { applyVibeMatchGuards, modeScoreMultiplier } from "../../lib/vibe-match-guards";
import { refineSongScore } from "../../lib/emotion";
import type { ScoredLibraryTrack } from "./types";
import type { HybridScoreResult } from "../../lib/hybrid-scoring";

export interface PostScoreModifierInput<T extends { trackId: string; artistName: string; albumName: string }> {
  hybridResults: HybridScoreResult<T>[];
  referenceFingerprint: ReferenceFingerprint | null;
  mode: "strict" | "balanced" | "chaotic";
  memoryWeight: number;
  librarySignals: LibrarySignals;
  emotionProfile: EmotionProfile;
  rediscoveryMode: RediscoveryMode;
  archaeology: ArchaeologyIntent | null;
  chapterMatch: ChapterMatch | null;
  startMs: number;
  promptConfidenceMultiplier: number;
  journeyArcMultiplier: number;
  freshness: {
    stats: FreshnessStats;
    artistAppearances: Map<string, number>;
    albumAppearances: Map<string, number>;
    globalCloneMultiplier: number;
  };
  vibe: string;
}

export function applyPostScoreModifiers<T extends {
  trackId: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
}>(
  input: PostScoreModifierInput<T>
): ScoredLibraryTrack<T>[] {
  return input.hybridResults.map(({ track: song, score: hybridBase, debug }) => {
    let score = hybridBase;

    if (input.referenceFingerprint) {
      score += referenceSimilarityBonus(
        {
          energy: song.energy,
          valence: song.valence,
          tempo: song.tempo,
          danceability: song.danceability,
          acousticness: song.acousticness,
        },
        input.referenceFingerprint,
        input.mode
      );
    }

    if (input.memoryWeight > 0.45 && (song.acousticness ?? 0) > 0.35) {
      score += input.memoryWeight * 0.04;
    }

    const signal = input.librarySignals.tracks.get(song.trackId);
    const emotionFit = score;

    const rediscoveryScore = signal
      ? computeRediscoveryScore({
          signal,
          emotionFit,
          profile: input.emotionProfile,
          mode: input.rediscoveryMode,
        })
      : 0.2;

    score += rediscoveryScoreBoost(rediscoveryScore, emotionFit, input.rediscoveryMode) * 0.85;
    score += chapterTrackBoost(song.trackId, input.chapterMatch);
    if (input.archaeology) score += archaeologyRediscoveryBoost(input.archaeology.concept);
    score += rediscoveryJitter(song.trackId, input.startMs) * 0.001;
    score *= input.promptConfidenceMultiplier;
    score *= input.journeyArcMultiplier;

    score = applyFreshnessToScore(score, {
      trackId: song.trackId,
      artistName: song.artistName,
      albumName: song.albumName,
      stats: input.freshness.stats,
      artistAppearances: input.freshness.artistAppearances,
      albumAppearances: input.freshness.albumAppearances,
      globalCloneMultiplier: input.freshness.globalCloneMultiplier,
    });

    score = refineSongScore(score, song, input.emotionProfile);
    score = applyVibeMatchGuards(score, song, input.emotionProfile, input.vibe);
    score *= modeScoreMultiplier(input.mode);

    return { ...song, score, rediscoveryScore, scoringDebug: debug };
  });
}
