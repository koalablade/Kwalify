/**
 * Playlist-level coherence regression using mock track fixtures.
 *
 * Usage: npm run coherence:playlist
 */

import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { scorePlaylistCoherence } from "../core/playlist-coherence-audit";
import { buildLockedIntent } from "../core/v3/intent";
import { mergeSceneAliasesIntoGenres } from "../lib/intent-pipeline-orchestrator";

type FixtureTrack = {
  trackId: string;
  genreFamily: string;
  energy?: number;
  valence?: number;
};

type Fixture = {
  id: string;
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  minOverall: number;
  tracks: FixtureTrack[];
};

const FIXTURES: Fixture[] = [
  {
    id: "volvo-garage-coherent",
    prompt: "music for working on my volvo in the garage late at night rainy sunday",
    mode: "balanced",
    minOverall: 0.55,
    tracks: [
      { trackId: "1", genreFamily: "blues", energy: 0.42, valence: 0.38 },
      { trackId: "2", genreFamily: "indie", energy: 0.45, valence: 0.4 },
      { trackId: "3", genreFamily: "rock", energy: 0.48, valence: 0.42 },
      { trackId: "4", genreFamily: "folk", energy: 0.4, valence: 0.45 },
      { trackId: "5", genreFamily: "blues", energy: 0.38, valence: 0.35 },
      { trackId: "6", genreFamily: "indie", energy: 0.44, valence: 0.41 },
      { trackId: "7", genreFamily: "country", energy: 0.46, valence: 0.43 },
      { trackId: "8", genreFamily: "rock", energy: 0.5, valence: 0.44 },
    ],
  },
  {
    id: "kerrang-coherent",
    prompt: "kerrang era alt rock and emo from my teenage years",
    mode: "strict",
    minOverall: 0.58,
    tracks: [
      { trackId: "1", genreFamily: "rock", energy: 0.72, valence: 0.4 },
      { trackId: "2", genreFamily: "metal", energy: 0.78, valence: 0.35 },
      { trackId: "3", genreFamily: "indie", energy: 0.68, valence: 0.42 },
      { trackId: "4", genreFamily: "punk", energy: 0.8, valence: 0.38 },
      { trackId: "5", genreFamily: "rock", energy: 0.74, valence: 0.36 },
      { trackId: "6", genreFamily: "metal", energy: 0.76, valence: 0.34 },
      { trackId: "7", genreFamily: "indie", energy: 0.7, valence: 0.4 },
      { trackId: "8", genreFamily: "punk", energy: 0.79, valence: 0.37 },
    ],
  },
  {
    id: "volvo-garage-incoherent",
    prompt: "music for working on my volvo in the garage late at night rainy sunday",
    mode: "balanced",
    minOverall: 0,
    tracks: [
      { trackId: "1", genreFamily: "blues", energy: 0.42, valence: 0.38 },
      { trackId: "2", genreFamily: "hip_hop", energy: 0.92, valence: 0.85 },
      { trackId: "3", genreFamily: "pop", energy: 0.95, valence: 0.9 },
      { trackId: "4", genreFamily: "electronic", energy: 0.94, valence: 0.88 },
      { trackId: "5", genreFamily: "trap", energy: 0.9, valence: 0.8 },
      { trackId: "6", genreFamily: "hip_hop", energy: 0.88, valence: 0.78 },
      { trackId: "7", genreFamily: "pop", energy: 0.91, valence: 0.82 },
      { trackId: "8", genreFamily: "electronic", energy: 0.93, valence: 0.86 },
    ],
  },
];

function main(): void {
  const results = FIXTURES.map((fixture) => {
    const pipeline = buildIntentPipelineContext(fixture.prompt, fixture.mode);
    const locked = buildLockedIntent(fixture.prompt);
    const intent = {
      ...locked,
      genreFamilies: mergeSceneAliasesIntoGenres(locked.genreFamilies, pipeline.sceneAliases),
    };
    const score = scorePlaylistCoherence(
      fixture.tracks.map((track) => ({
        trackId: track.trackId,
        genreFamily: track.genreFamily,
        genrePrimary: track.genreFamily,
        energy: track.energy ?? 0.5,
        valence: track.valence ?? 0.5,
      })),
      intent,
      pipeline.scenePrediction,
    );

    const expectHigh = fixture.id.endsWith("-coherent");
    const pass = expectHigh
      ? score.overallScore >= fixture.minOverall
      : score.overallScore < 0.68;

    return {
      id: fixture.id,
      pass,
      overallScore: score.overallScore,
      sceneScore: score.sceneScore,
      atmosphereScore: score.atmosphereScore,
      minOverall: fixture.minOverall,
      sceneAliases: pipeline.sceneAliases,
    };
  });

  const failed = results.filter((row) => !row.pass);
  process.stdout.write(`${JSON.stringify({ pass: failed.length === 0, results }, null, 2)}\n`);
  if (failed.length > 0) process.exit(1);
}

main();
