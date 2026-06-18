/**
 * Semantic scene benchmark — narrative prompts vs track semantic profiles.
 *
 * Usage: npm run benchmark:semantic-scenes
 */

import { enrichTrackSemanticProfile } from "../lib/track-semantic-enrichment";
import {
  buildPromptSceneProfile,
  semanticSurvivalMetrics,
  scoreSemanticSceneMatch,
} from "../lib/scene-semantic-retrieval";
import { buildArtistEcosystemGraph } from "../lib/artist-ecosystem-graph";

const NARRATIVE_PROMPTS = [
  "Tokyo at 3am after missing the last train",
  "Rain on the motorway",
  "Fixing my Volvo in the garage at midnight",
  "Walking through empty city streets",
  "Warehouse rave at sunrise",
  "Last train home",
  "Post-club solitude outside the club",
  "Urban nostalgia from a forgotten rave flyer in 1997",
];

const RANKING_EXPECTATIONS: Array<{ prompt: string; topArtists: string[] }> = [
  { prompt: "Tokyo at 3am after missing the last train", topArtists: ["M83", "Burial", "The xx"] },
  { prompt: "Rain on the motorway", topArtists: ["Chris Rea", "M83"] },
  { prompt: "Fixing my Volvo in the garage at midnight", topArtists: ["Sparks", "M83"] },
  { prompt: "Walking through empty city streets", topArtists: ["Goldie", "M83", "Burial"] },
  { prompt: "Urban nostalgia from a forgotten rave flyer in 1997", topArtists: ["Goldie", "Burial", "M83"] },
];

const FIXTURE_TRACKS = [
  { trackId: "t1", trackName: "Midnight City", artistName: "M83", albumName: "Hurry Up, We're Dreaming", energy: 0.72, valence: 0.48, tempo: 104, danceability: 0.58, acousticness: 0.02, instrumentalness: 0.12, releaseYear: 2011 },
  { trackId: "t2", trackName: "Archangel", artistName: "Burial", albumName: "Untrue", energy: 0.41, valence: 0.22, tempo: 134, danceability: 0.62, acousticness: 0.08, instrumentalness: 0.71, releaseYear: 2007 },
  { trackId: "t3", trackName: "Teardrop", artistName: "Massive Attack", albumName: "Mezzanine", energy: 0.38, valence: 0.31, tempo: 98, danceability: 0.52, acousticness: 0.14, instrumentalness: 0.04, releaseYear: 1998 },
  { trackId: "t4", trackName: "Road to Hell", artistName: "Chris Rea", albumName: "Auberge", energy: 0.55, valence: 0.42, tempo: 118, danceability: 0.48, acousticness: 0.22, instrumentalness: 0.01, releaseYear: 1991 },
  { trackId: "t5", trackName: "Garage", artistName: "Sparks", albumName: "No. 1 in Heaven", energy: 0.61, valence: 0.55, tempo: 122, danceability: 0.64, acousticness: 0.18, instrumentalness: 0.02, releaseYear: 1979 },
  { trackId: "t6", trackName: "Inner City Life", artistName: "Goldie", albumName: "Timeless", energy: 0.68, valence: 0.35, tempo: 172, danceability: 0.71, acousticness: 0.05, instrumentalness: 0.18, releaseYear: 1995 },
  { trackId: "t7", trackName: "Only You", artistName: "The xx", albumName: "xx", energy: 0.28, valence: 0.38, tempo: 98, danceability: 0.58, acousticness: 0.42, instrumentalness: 0.22, releaseYear: 2009 },
  { trackId: "t8", trackName: "Porcelain", artistName: "Moby", albumName: "Play", energy: 0.35, valence: 0.28, tempo: 120, danceability: 0.61, acousticness: 0.31, instrumentalness: 0.88, releaseYear: 1999 },
];

const MIN_SCENE_SURVIVAL = 20;
const MIN_SEMANTIC_COHERENCE = 12;

function main(): void {
  const profiles = FIXTURE_TRACKS.map((track) => ({
    track,
    profile: enrichTrackSemanticProfile(track),
  }));
  const artistGraph = buildArtistEcosystemGraph({
    likedTracks: FIXTURE_TRACKS.map((t) => ({ trackId: t.trackId, artistName: t.artistName })),
  });

  let failed = 0;
  for (const prompt of NARRATIVE_PROMPTS) {
    const promptProfile = buildPromptSceneProfile(prompt);
    const ranked = profiles
      .map(({ track, profile }) => ({
        track,
        profile,
        boost: scoreSemanticSceneMatch(promptProfile, profile, {
          artistName: track.artistName,
          trackName: track.trackName,
          artistGraph,
        }).boost,
      }))
      .sort((a, b) => b.boost - a.boost)
      .slice(0, 5);

    const metrics = semanticSurvivalMetrics(
      promptProfile,
      ranked.map((r) => ({ profile: r.profile, artistName: r.track.artistName })),
      artistGraph,
    );

    const rankingExpectation = RANKING_EXPECTATIONS.find((entry) => entry.prompt === prompt);
    const topTwo = ranked.slice(0, 2).map((r) => r.track.artistName);
    const rankingOk = !rankingExpectation || rankingExpectation.topArtists.some((artist) => topTwo.includes(artist));
    const strict = !!rankingExpectation;

    const ok =
      promptProfile.retrievalSignature.length > 0 &&
      ranked.some((r) => r.boost > 0) &&
      rankingOk &&
      (!strict ||
        (metrics.sceneSurvivalPercent >= MIN_SCENE_SURVIVAL &&
          metrics.semanticCoherencePercent >= MIN_SEMANTIC_COHERENCE));

    if (!ok) failed += 1;
    console.log(JSON.stringify({
      prompt,
      promptSignature: promptProfile.retrievalSignature.slice(0, 120),
      topTracks: ranked.map((r) => ({ name: r.track.trackName, artist: r.track.artistName, boost: r.boost })),
      metrics,
      rankingOk,
      ok,
    }));
  }

  if (failed > 0) {
    console.error(`semantic scene benchmark failed: ${failed}/${NARRATIVE_PROMPTS.length}`);
    process.exit(1);
  }
  console.log(`semantic scene benchmark passed (${NARRATIVE_PROMPTS.length} prompts)`);
}

main();
