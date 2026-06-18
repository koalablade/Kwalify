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
import { trackHasEraEvidence } from "../../lib/era-evidence";
import type { ScoredLibraryTrack } from "./types";
import type { HybridScoreResult } from "../../lib/hybrid-scoring";
import type { FeedbackMemory } from "../../lib/feedback-memory";
import { computeSceneAliasRetrievalBoost } from "../../lib/scene-alias-retrieval-boost";
import { tasteGraphV2RetrievalBoost, type TasteGraphV2 } from "../../lib/taste-graph-v2";
import { cultureRetrievalBoost } from "../../lib/scene-culture-graph";
import { globalTasteRetrievalBoost, type GlobalTasteProfile } from "../../lib/global-taste-profile";
import { trendRetrievalBoost } from "../../lib/trend-ingestion";

function metadataGenreMatch(genres: unknown, vibe: string): number {
  if (!Array.isArray(genres)) return 0;
  const lower = vibe.toLowerCase();
  return genres.some((genre) => typeof genre === "string" && lower.includes(genre.toLowerCase()))
    ? 1
    : 0;
}

function promptEraYear(vibe: string): { start: number; end: number } | null {
  const lower = vibe.toLowerCase();
  const decade = lower.match(/\b(60'?s|70'?s|80'?s|90'?s|00'?s|10'?s|20'?s|1960'?s|1970'?s|1980'?s|1990'?s|2000'?s|2010'?s|2020'?s)\b/)?.[1]?.replace("'", "");
  if (!decade) return null;
  const start = decade.length === 4
    ? Number(`${decade.slice(0, 3)}0`)
    : decade === "00s" ? 2000 : decade === "10s" ? 2010 : decade === "20s" ? 2020 : Number(`19${decade.slice(0, 2)}`);
  return { start, end: start + 9 };
}

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
  feedbackMemory?: FeedbackMemory | null;
  curatorScoreByTrack?: Map<string, number>;
  sceneAliases?: string[];
  scenePrediction?: Record<string, number>;
  tasteGraphV2?: TasteGraphV2 | null;
  globalTasteProfile?: GlobalTasteProfile | null;
  globalGenreFamily?: string | null;
  trendPrompt?: string;
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
    const enriched = song as typeof song & {
      spotifyArtistGenres?: unknown;
      albumGenres?: unknown;
      popularity?: number | null;
      releaseYear?: number | null;
      genreFamily?: string | null;
      genrePrimary?: string | null;
      genres?: string[] | null;
    };
    score += metadataGenreMatch(enriched.spotifyArtistGenres, input.vibe) * 0.18;
    score += metadataGenreMatch(enriched.albumGenres, input.vibe) * 0.10;
    if (input.sceneAliases && input.sceneAliases.length > 0) {
      score += computeSceneAliasRetrievalBoost(
        enriched,
        input.sceneAliases,
        input.scenePrediction ?? {},
      );
    }
    if (input.tasteGraphV2) {
      score += tasteGraphV2RetrievalBoost(enriched, input.tasteGraphV2);
    }
    if (input.globalTasteProfile) {
      score += globalTasteRetrievalBoost(enriched.genreFamily, input.globalTasteProfile);
    } else if (input.globalGenreFamily && input.tasteGraphV2) {
      score += globalTasteRetrievalBoost(enriched.genreFamily ?? input.globalGenreFamily, {
        userId: "",
        genreWeights: input.tasteGraphV2.genreWeights,
        sceneWeights: input.tasteGraphV2.memoryGraph.sceneAffinity,
        artistWeights: input.tasteGraphV2.memoryGraph.artistAffinity,
        generationCount: 0,
        avgCoherence: null,
      });
    }
    if (input.trendPrompt) {
      score += trendRetrievalBoost(input.trendPrompt);
      score += cultureRetrievalBoost(input.trendPrompt);
    }
    if (typeof enriched.popularity === "number") {
      const popularityBalance = 1 - Math.abs(enriched.popularity - 58) / 100;
      score += Math.max(0, popularityBalance) * 0.035;
    }
    const curatorScore = input.curatorScoreByTrack?.get(song.trackId);
    if (typeof curatorScore === "number") {
      score += Math.max(-0.35, Math.min(0.35, curatorScore - 0.5));
    }
    const era = promptEraYear(input.vibe);
    if (era && trackHasEraEvidence(enriched, era)) {
      score += 0.12;
    }
    if (input.feedbackMemory) {
      if (input.feedbackMemory.badArtists.includes(song.artistName)) score -= 2;
      if (
        "genrePrimary" in song &&
        typeof song.genrePrimary === "string" &&
        input.feedbackMemory.badGenres.includes(song.genrePrimary)
      ) {
        score -= 2;
      }
      if (input.feedbackMemory.overplayedTracks.includes(song.trackId)) score -= 3;
      const skipCount = input.feedbackMemory.skipCountByTrack[song.trackId] ?? 0;
      const saveCount = input.feedbackMemory.saveCountByTrack[song.trackId] ?? 0;
      score -= Math.min(1.5, skipCount * 0.25);
      score += Math.min(0.8, saveCount * 0.12);
      const artistAffinity = input.feedbackMemory.artistAffinityGraph[song.artistName]?.score ?? 0;
      const albumAffinity = input.feedbackMemory.albumAffinityGraph[song.albumName]?.score ?? 0;
      if (artistAffinity !== 0) score *= Math.max(0.55, Math.min(1.18, 1 + artistAffinity * 0.025));
      if (albumAffinity !== 0) score *= Math.max(0.70, Math.min(1.10, 1 + albumAffinity * 0.018));
    }
    score *= modeScoreMultiplier(input.mode);

    return { ...song, score, rediscoveryScore, scoringDebug: debug };
  });
}
