/**
 * World boundary enforcement regression fixtures.
 *
 * Usage: npm run coherence:world-boundary
 */

import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { buildLockedIntent } from "../core/v3/intent";
import { mergeSceneAliasesIntoGenres } from "../lib/intent-pipeline-orchestrator";
import {
  hardRejectOffWorldTracks,
  resolveWorldBoundary,
  buildPlaylistByWorldConstraints,
} from "../core/world-boundary";
import { scorePlaylistCoherence } from "../core/playlist-coherence-audit";

type Track = {
  trackId: string;
  genreFamily: string;
  energy?: number;
  valence?: number;
  danceability?: number;
};

const VOLVO_POOL: Track[] = [
  { trackId: "1", genreFamily: "blues", energy: 0.42, valence: 0.38, danceability: 0.35 },
  { trackId: "2", genreFamily: "indie", energy: 0.45, valence: 0.4, danceability: 0.38 },
  { trackId: "3", genreFamily: "rock", energy: 0.48, valence: 0.42, danceability: 0.4 },
  { trackId: "4", genreFamily: "folk", energy: 0.4, valence: 0.45, danceability: 0.32 },
  { trackId: "5", genreFamily: "hip_hop", energy: 0.92, valence: 0.85, danceability: 0.88 },
  { trackId: "6", genreFamily: "pop", energy: 0.95, valence: 0.9, danceability: 0.92 },
  { trackId: "7", genreFamily: "electronic", energy: 0.94, valence: 0.88, danceability: 0.9 },
  { trackId: "8", genreFamily: "trap", energy: 0.9, valence: 0.8, danceability: 0.86 },
  { trackId: "9", genreFamily: "blues", energy: 0.38, valence: 0.35, danceability: 0.33 },
  { trackId: "10", genreFamily: "country", energy: 0.46, valence: 0.43, danceability: 0.36 },
];

function main(): void {
  const prompt = "music for working on my volvo in the garage late at night rainy sunday";
  const pipeline = buildIntentPipelineContext(prompt, "balanced");
  const intent = buildLockedIntent(prompt);
  intent.genreFamilies = mergeSceneAliasesIntoGenres(intent.genreFamilies, pipeline.sceneAliases);

  const world = resolveWorldBoundary({
    sceneLock: pipeline.sceneLockStatus,
    sceneAliases: pipeline.sceneAliases,
    scenePrediction: pipeline.scenePrediction,
  });

  const filtered = hardRejectOffWorldTracks(
    VOLVO_POOL.map((t) => ({ ...t, genrePrimary: t.genreFamily })),
    world,
  );

  const offSceneRejected = filtered.rejected.filter((t) =>
    ["hip_hop", "pop", "electronic", "trap"].includes(t.genreFamily),
  ).length;

  const constrained = buildPlaylistByWorldConstraints({
    candidates: filtered.kept,
    intent,
    world,
    playlistLength: 8,
    scenePrediction: pipeline.scenePrediction,
  });

  const naive = scorePlaylistCoherence(VOLVO_POOL.slice(0, 8), intent, pipeline.scenePrediction);
  const built = constrained.coherenceScore;

  const pass =
    world.hardLock &&
    offSceneRejected >= 4 &&
    filtered.kept.length >= 5 &&
    built.overallScore > naive.overallScore + 0.08;

  process.stdout.write(`${JSON.stringify({
    pass,
    world: {
      active: world.active,
      hardLock: world.hardLock,
      dominantScene: world.dominantScene,
      allowed: world.allowedGenreFamilies,
    },
    filter: filtered.diagnostics,
    offSceneRejected,
    naiveCoherence: naive.overallScore,
    constrainedCoherence: built.overallScore,
    builtTrackFamilies: constrained.tracks.map((t) => t.genreFamily),
  }, null, 2)}\n`);

  if (!pass) process.exit(1);
}

main();
