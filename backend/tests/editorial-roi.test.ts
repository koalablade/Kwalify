/**
 * ROI editorial modules — human patterns + would-i-save evaluator.
 *
 * Run: npm run test:editorial-roi
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeHumanPlaylistFeatures,
  scoreAgainstHumanPlaylistPatterns,
} from "../core/editorial/human-playlist-patterns";
import { evaluateWouldISave, evaluatePlaylistCurationBelievability } from "../core/editorial/would-i-save-evaluator";
import { comparePlaylistsPairwise } from "../core/editorial/pairwise-playlist-judge";
import {
  rankCandidatesByIntentVector,
  scoreEditorialIntentMatch,
  collapseIntent,
} from "../core/editorial/intent-collapse-layer";
import type { LockedIntent } from "../core/v3/intent";
import type { EmotionProfile } from "../lib/emotion";

const profile: EmotionProfile = {
  energy: 0.55,
  valence: 0.6,
  tension: 0.3,
  nostalgia: 0.3,
  calm: 0.4,
  environment: null,
  timeOfDay: null,
  motionState: null,
};

const commuteIntent: LockedIntent = {
  genreFamilies: [],
  primaryGenre: null,
  primarySubgenre: null,
  secondarySubgenre: null,
  subgenreTerms: [],
  eraRange: null,
  mood: ["uplift"],
  activity: "commute",
  energy: "high",
};

describe("editorial ROI modules", () => {
  it("scores human playlist spacing and discovery patterns", () => {
    const tracks = Array.from({ length: 25 }, (_, i) => ({
      trackId: `t${i}`,
      artistName: `Artist ${Math.floor(i / 5)}`,
      energy: 0.45 + (i / 25) * 0.25,
      valence: 0.55,
      danceability: 0.5,
      acousticness: 0.4,
      rediscoveryScore: i % 3 === 0 ? 0.7 : 0.3,
    }));
    const features = computeHumanPlaylistFeatures(tracks);
    assert.ok(features.maxArtistShare <= 0.25);
    const scored = scoreAgainstHumanPlaylistPatterns(tracks);
    assert.ok(scored.score > 0.35);
  });

  it("ranks genre-matched tracks above mismatched families", () => {
    const collapsed = collapseIntent({
      vibe: "Feel-good summer morning commute",
      lockedIntent: commuteIntent,
      profile,
      strictMode: true,
      sceneArchetypeId: "indie_pop_sunshine_commute",
    });
    const indie = {
      trackId: "i1",
      genreFamily: "indie",
      energy: 0.58,
      valence: 0.62,
      danceability: 0.55,
      acousticness: 0.35,
      tempo: 118,
    };
    const rock = {
      trackId: "r1",
      genreFamily: "rock",
      energy: 0.58,
      valence: 0.62,
      danceability: 0.55,
      acousticness: 0.35,
      tempo: 118,
    };
    assert.ok(scoreEditorialIntentMatch(indie, collapsed.intent) > scoreEditorialIntentMatch(rock, collapsed.intent));
    const ranked = rankCandidatesByIntentVector([rock, indie], collapsed.intent);
    assert.equal(ranked[0]!.track.trackId, "i1");
  });

  it("would-i-save evaluator rejects incoherent genre salad in strict mode", () => {
    const tracks = [
      { trackId: "1", trackName: "A", artistName: "One", genreFamily: "electronic", energy: 0.7, valence: 0.6, danceability: 0.8, acousticness: 0.2 },
      { trackId: "2", trackName: "B", artistName: "Two", genreFamily: "folk", energy: 0.35, valence: 0.4, danceability: 0.3, acousticness: 0.8 },
      { trackId: "3", trackName: "C", artistName: "Three", genreFamily: "metal", energy: 0.9, valence: 0.3, danceability: 0.4, acousticness: 0.1 },
    ];
    const evaluation = evaluateWouldISave({
      prompt: "rainy city morning walk reflective",
      tracks,
      context: null,
      lockedIntent: {
        ...commuteIntent,
        mood: ["reflective"],
        activity: "walk",
        energy: "low",
      },
    });
    assert.equal(evaluation.strictMode, true);
    assert.equal(evaluation.humanSaveable, false);
  });

  it("playlist curation believability prefers coherent human-shaped playlists", () => {
    const coherentTracks = Array.from({ length: 20 }, (_, i) => ({
      trackId: `c${i}`,
      trackName: `Track ${i}`,
      artistName: `Artist ${Math.floor(i / 5)}`,
      genreFamily: "indie",
      energy: 0.5 + (i / 20) * 0.15,
      valence: 0.58,
      danceability: 0.52,
      acousticness: 0.42,
      rediscoveryScore: i % 4 === 0 ? 0.65 : 0.35,
    }));
    const saladTracks = [
      ...coherentTracks.slice(0, 8),
      { trackId: "m1", trackName: "Metal", artistName: "SOAD", genreFamily: "metal", energy: 0.92, valence: 0.3, danceability: 0.4, acousticness: 0.1 },
      { trackId: "c1", trackName: "Country", artistName: "Keith", genreFamily: "country", energy: 0.55, valence: 0.5, danceability: 0.5, acousticness: 0.5 },
      ...coherentTracks.slice(8, 16),
      { trackId: "h1", trackName: "Rap", artistName: "Drake", genreFamily: "hip_hop", energy: 0.7, valence: 0.6, danceability: 0.8, acousticness: 0.2 },
    ];
    const coherent = evaluatePlaylistCurationBelievability({
      prompt: "indie reflective walk",
      tracks: coherentTracks,
      targetLength: 20,
      context: null,
      lockedIntent: commuteIntent,
    });
    const salad = evaluatePlaylistCurationBelievability({
      prompt: "indie reflective walk",
      tracks: saladTracks,
      targetLength: 20,
      context: null,
      lockedIntent: commuteIntent,
    });
    assert.ok(coherent.believabilityScore > salad.believabilityScore);
  });

  it("pairwise comparison prefers coherent playlist over genre salad", () => {
    const coherentTracks = Array.from({ length: 20 }, (_, i) => ({
      trackId: `c${i}`,
      trackName: `Track ${i}`,
      artistName: `Artist ${Math.floor(i / 5)}`,
      genreFamily: "indie",
      energy: 0.5 + (i / 20) * 0.15,
      valence: 0.58,
      danceability: 0.52,
      acousticness: 0.42,
      rediscoveryScore: i % 4 === 0 ? 0.65 : 0.35,
    }));
    const saladTracks = [
      ...coherentTracks.slice(0, 8),
      { trackId: "m1", trackName: "Metal", artistName: "SOAD", genreFamily: "metal", energy: 0.92, valence: 0.3, danceability: 0.4, acousticness: 0.1 },
      { trackId: "c1", trackName: "Country", artistName: "Keith", genreFamily: "country", energy: 0.55, valence: 0.5, danceability: 0.5, acousticness: 0.5 },
      ...coherentTracks.slice(8, 16),
      { trackId: "h1", trackName: "Rap", artistName: "Drake", genreFamily: "hip_hop", energy: 0.7, valence: 0.6, danceability: 0.8, acousticness: 0.2 },
    ];
    const baseEval = {
      strictMode: true,
      humanPatternBreakdown: {},
      gateRejectionReasons: [] as string[],
    };
    const result = comparePlaylistsPairwise(
      {
        label: "coherent",
        tracks: coherentTracks,
        wouldISave: { ...baseEval, wouldSaveScore: 0.82, humanPatternScore: 0.75, gateCuratorScore: 0.88, combinedScore: 0.82, humanSaveable: true },
        context: null,
      },
      {
        label: "salad",
        tracks: saladTracks,
        wouldISave: { ...baseEval, wouldSaveScore: 0.55, humanPatternScore: 0.42, gateCuratorScore: 0.62, combinedScore: 0.55, humanSaveable: false },
        context: null,
      },
    );
    assert.equal(result.winner, "a");
  });
});
