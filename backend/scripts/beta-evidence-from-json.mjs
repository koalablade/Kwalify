#!/usr/bin/env node
/**
 * Capture evidence from a saved /api/generate JSON response (retroactive).
 *
 * Usage:
 *   npm run beta:evidence:from-json -- path/to/response.json
 */
import { readFileSync } from "node:fs";
import { buildBetaGenerationEvidence } from "../dist/lib/beta-generation-evidence.js";
import { appendGenerationEvidence } from "../dist/lib/beta-evidence-store.js";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npm run beta:evidence:from-json -- path/to/response.json");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(path, "utf8"));
  const requestId = data.requestId ?? data.generationEvidenceId;
  if (!requestId) {
    console.error("Response JSON missing requestId");
    process.exit(1);
  }
  const record = buildBetaGenerationEvidence({
    requestId,
    prompt: data.vibe ?? data.prompt ?? "",
    mode: data.mode ?? "balanced",
    noLibraryMode: !!data.noLibraryMode,
    requestedTrackCount: data.length ?? data.requestedLength ?? data.totalTracks ?? data.tracks?.length ?? 0,
    tracks: data.tracks ?? [],
    playlistTitle: data.playlistName ?? data.name ?? null,
    honestPartial: data.honestPartialPublished ?? false,
    spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? null,
    spotifyPlaylistId: data.spotifyPlaylistId ?? null,
    savedPlaylistId: data.savedPlaylistId ?? data.playlistId ?? null,
    playlistExecutionTrace: data.playlistExecutionTrace ?? null,
    interpretation: {
      sceneId: data.sceneId ?? null,
      momentUnderstandingLine: data.momentUnderstandingLine ?? null,
      humanNarrative: data.humanNarrative ?? null,
      humanExperience: data.humanExperience ?? null,
      matchQualityLabel: data.matchQualityLabel ?? null,
      retrievalSignature: data.retrievalSignature ?? null,
      intentSurvivalSummary: data.intentSurvivalSummary ?? null,
    },
    pipelineExtras: {
      generationMs: data.generationMs ?? null,
      importedFromJson: true,
    },
  });
  await appendGenerationEvidence(record);
  console.log(`Captured evidence ${record.generationEvidenceId} (${record.tracks.length} tracks)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
