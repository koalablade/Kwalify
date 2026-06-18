/**
 * UK grime / UK rap world-boundary fixtures — rejects US hip-hop drift.
 *
 * Usage: npm run coherence:uk-hip-hop
 */

import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { hardRejectOffWorldTracks, resolveWorldBoundary } from "../core/world-boundary";
import { usHipHopDriftScore, ukHipHopEvidenceScore } from "../lib/uk-hip-hop-scene";

type Track = {
  trackId: string;
  trackName: string;
  artistName: string;
  genreFamily: string;
  genrePrimary: string;
  spotifyArtistGenres?: string[];
};

const UK_TRACK: Track = {
  trackId: "uk1",
  trackName: "Shutdown",
  artistName: "Skepta",
  genreFamily: "hip_hop",
  genrePrimary: "grime",
  spotifyArtistGenres: ["grime", "uk hip hop"],
};

const US_TRACK: Track = {
  trackId: "us1",
  trackName: "SICKO MODE",
  artistName: "Travis Scott",
  genreFamily: "hip_hop",
  genrePrimary: "trap",
  spotifyArtistGenres: ["rap", "hip hop"],
};

function main(): void {
  const prompt = "uk grime classics workout";
  const ctx = buildIntentPipelineContext(prompt, "balanced");
  const world = resolveWorldBoundary({
    sceneLock: ctx.sceneLockStatus,
    sceneAliases: ctx.sceneAliases,
    scenePrediction: ctx.scenePrediction,
    prompt,
  });

  const filtered = hardRejectOffWorldTracks([UK_TRACK, US_TRACK], world);
  const ukScore = ukHipHopEvidenceScore(UK_TRACK);
  const usScore = usHipHopDriftScore(US_TRACK);
  const keptIds = filtered.kept.map((t) => t.trackId);
  const pass =
    ctx.sceneLockStatus.active &&
    world.ukHipHopScene?.active === true &&
    world.hardLock === true &&
    keptIds.includes("uk1") &&
    !keptIds.includes("us1") &&
    ukScore > usScore;

  process.stdout.write(`${JSON.stringify({
    pass,
    sceneLock: ctx.sceneLockStatus.active,
    world: {
      active: world.active,
      hardLock: world.hardLock,
      ukScene: world.ukHipHopScene?.id ?? null,
    },
    filter: filtered.diagnostics,
    keptIds,
    ukScore,
    usScore,
  }, null, 2)}\n`);
  if (!pass) process.exit(1);
}

main();
