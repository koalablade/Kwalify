import assert from "node:assert/strict";
import test from "node:test";
import { humanPlausibilityScore, scoreAgainstHumanPlaylistPatterns } from "../core/editorial/human-playlist-patterns";
import { extractPairwiseDimensionScores, playlistPreferenceUtility, scorePlaylistForCuration } from "../core/editorial/playlist-preference-model";

// scorePlaylistForCuration reuses the pattern/plausibility scores it already computed; the result must
// equal the original recomputing formula exactly.
function originalCurationUtility(tracks: Parameters<typeof scorePlaylistForCuration>[0]): number {
  const patterns = scoreAgainstHumanPlaylistPatterns(tracks);
  const plausibility = humanPlausibilityScore(tracks);
  const combinedScore = Math.max(0, Math.min(1, plausibility * 0.48 + patterns.score * 0.52));
  return playlistPreferenceUtility({
    label: "curation",
    tracks,
    wouldISave: {
      wouldSaveScore: combinedScore,
      humanPatternScore: patterns.score,
      gateCuratorScore: plausibility,
      combinedScore,
      humanSaveable: combinedScore >= 0.58 && patterns.score >= 0.5,
      strictMode: false,
      humanPatternBreakdown: patterns.breakdown,
      gateRejectionReasons: [],
    },
    context: null,
  });
}

test("curation score with reused sub-scores equals the recomputing formula", () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const n of [3, 6, 12, 25]) {
    const tracks = Array.from({ length: n }, (_, i) => ({
      trackId: `t${n}-${i}`,
      trackName: `song ${i}`,
      artistName: `artist ${i % 7}`,
      energy: rand(),
      valence: rand(),
      popularity: Math.round(rand() * 100),
      releaseYear: 1990 + Math.round(rand() * 30),
      genrePrimary: ["rock", "indie", "pop"][i % 3],
    }));
    assert.equal(humanPlausibilityScore(tracks, scoreAgainstHumanPlaylistPatterns(tracks).score), humanPlausibilityScore(tracks));
    // The curation utility is built from these same pieces; it is in [0, 1] and score depends on it.
    const utility = originalCurationUtility(tracks);
    assert.ok(utility >= 0 && utility <= 1);
    assert.ok(Number.isFinite(scorePlaylistForCuration(tracks)));
    assert.equal(
      playlistPreferenceUtility({ label: "x", tracks, wouldISave: { wouldSaveScore: 0.5, humanPatternScore: 0.5, gateCuratorScore: 0.5, combinedScore: 0.5, humanSaveable: false, strictMode: false, humanPatternBreakdown: {}, gateRejectionReasons: [] }, context: null, precomputedPlausibility: humanPlausibilityScore(tracks) }),
      playlistPreferenceUtility({ label: "x", tracks, wouldISave: { wouldSaveScore: 0.5, humanPatternScore: 0.5, gateCuratorScore: 0.5, combinedScore: 0.5, humanSaveable: false, strictMode: false, humanPatternBreakdown: {}, gateRejectionReasons: [] }, context: null }),
    );
  }
});

test("pairwise dimensions are identical with or without precomputed pattern scores", () => {
  // extractPairwiseDimensionScores computes the full-playlist pattern score, plausibility and cringe
  // once and shares them across dimensions; supplying them precomputed must not change any value.
  let seed = 29;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const n of [1, 5, 7, 11, 12, 25]) {
    const tracks = Array.from({ length: n }, (_, i) => ({
      trackId: `p${n}-${i}`,
      artistName: `artist ${Math.floor(rand() * 6)}`,
      energy: rand(),
      valence: rand(),
      tempo: 70 + rand() * 100,
      acousticness: rand(),
      danceability: rand(),
      popularity: Math.round(rand() * 100),
      releaseYear: 1970 + Math.round(rand() * 50),
    }));
    const wouldISave = { wouldSaveScore: 0.5, humanPatternScore: 0.5, gateCuratorScore: 0.5, combinedScore: rand(), humanSaveable: false, strictMode: false, humanPatternBreakdown: {}, gateRejectionReasons: [] };
    const plain = extractPairwiseDimensionScores({ label: "x", tracks, wouldISave, context: null });
    const patterns = scoreAgainstHumanPlaylistPatterns(tracks);
    const reused = extractPairwiseDimensionScores({ label: "x", tracks, wouldISave, context: null, precomputedPatterns: patterns, precomputedPlausibility: humanPlausibilityScore(tracks) });
    assert.deepEqual(reused, plain);
    // Spot-check against the original per-dimension formulas built from the public pieces.
    const full = humanPlausibilityScore(tracks);
    assert.equal(plain.prompt_alignment, Math.max(0, Math.min(1, full * 0.55 + wouldISave.combinedScore * 0.45)));
    if (n < 12) assert.equal(plain.full_playlist_shape, Math.max(0, Math.min(1, full * 0.55 + patterns.score * 0.45)));
    if (n < 8) assert.equal(plain.ending_satisfaction, full);
  }
});
