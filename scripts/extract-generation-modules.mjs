/**
 * Extract no-library Spotify retrieval from generation.controller.ts only.
 * Run: node scripts/extract-generation-modules.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const controllerPath = path.join(root, "backend/controllers/generation.controller.ts");
const lines = readFileSync(controllerPath, "utf8").split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).join("\n");
}

function removeRanges(allLines, ranges) {
  const remove = new Set();
  for (const [start, end] of ranges) {
    for (let i = start; i <= end; i += 1) remove.add(i);
  }
  return allLines.filter((_, idx) => !remove.has(idx + 1));
}

const eraHelpers = slice(871, 916)
  .replace(/^function hasDecorativeEraOnly/m, "function hasDecorativeEraOnly")
  .replace(/^function extractEraRange/m, "function extractEraRange")
  .replace(/^function fullDecadeStart/m, "function fullDecadeStart");

const noLibraryBody = slice(3653, 3985)
  .replace(/^type RetrievalCompletionDiagnostics/m, "export type RetrievalCompletionDiagnostics")
  .replace(/^function noLibrarySearchQueries/m, "export function noLibrarySearchQueries")
  .replace(/^async function buildNoLibrarySpotifyCandidates/m, "export async function buildNoLibrarySpotifyCandidates");

const noLibraryHeader = `/**
 * Spotify-wide retrieval ladder for no-library generation mode.
 */
import { likedSongsTable } from "../../db";
import {
  enrichTrackMetadata,
  fetchAlbumMetadata,
  fetchArtistGenres,
  fetchAudioFeatures,
  searchSpotifyTracks,
} from "../../lib/spotify";

`;

const noLibraryPath = path.join(root, "backend/controllers/generation/generation-no-library-retrieval.ts");
writeFileSync(noLibraryPath, `${noLibraryHeader}${eraHelpers}\n\n${noLibraryBody}\n`);

const importBlock = `import {
  buildNoLibrarySpotifyCandidates,
  type RetrievalCompletionDiagnostics,
} from "./generation/generation-no-library-retrieval";
`;

const newLines = removeRanges(lines, [[3653, 3985]]);
const anchor = 'import type { CompilePlanDSL } from "../core/compile-plan-dsl";';
const anchorIdx = newLines.findIndex((line) => line === anchor);
if (anchorIdx === -1) throw new Error("import anchor missing");
newLines.splice(anchorIdx + 1, 0, importBlock);
writeFileSync(controllerPath, newLines.join("\n"));
console.log("Extracted generation-no-library-retrieval.ts");
