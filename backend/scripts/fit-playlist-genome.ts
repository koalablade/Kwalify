/**
 * Fit playlist genome from public playlist corpus.
 *
 * Output:
 *   backend/data/playlist-genome.json — full measured distributions
 *   backend/data/human-playlist-patterns.json — legacy priors slice
 *
 * Run:
 *   npm run fit:playlist-genome -- --in data/corpus/human-playlists.json
 */

import fs from "node:fs";
import path from "node:path";
import {
  attachPairwiseWeights,
  fitPlaylistGenomeFromCorpus,
  type CorpusPlaylist,
} from "../core/editorial/playlist-genome";
import type { PairwiseDimension } from "../core/editorial/playlist-preference-model";
import { loadPreferenceModel } from "../core/editorial/playlist-preference-model";

function parseArgs(): { inputPath: string; genomePath: string; patternsPath: string; preferenceModelPath: string } {
  const args = process.argv.slice(2);
  let inputPath = path.join(process.cwd(), "data/corpus/human-playlists.json");
  let genomePath = path.join(process.cwd(), "backend/data/playlist-genome.json");
  let patternsPath = path.join(process.cwd(), "backend/data/human-playlist-patterns.json");
  let preferenceModelPath = path.join(process.cwd(), "backend/data/playlist-preference-model.json");
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--in" && args[i + 1]) inputPath = path.resolve(args[++i]!);
    if (args[i] === "--out" && args[i + 1]) genomePath = path.resolve(args[++i]!);
    if (args[i] === "--patterns-out" && args[i + 1]) patternsPath = path.resolve(args[++i]!);
    if (args[i] === "--preference-model" && args[i + 1]) preferenceModelPath = path.resolve(args[++i]!);
  }
  return { inputPath, genomePath, patternsPath, preferenceModelPath };
}

function loadPairwiseWeights(preferenceModelPath: string): Record<PairwiseDimension, number> | null {
  if (!fs.existsSync(preferenceModelPath)) return null;
  try {
    const model = JSON.parse(fs.readFileSync(preferenceModelPath, "utf8")) as {
      dimensionWeights?: Record<PairwiseDimension, number>;
    };
    return model.dimensionWeights ?? null;
  } catch {
    return null;
  }
}

function main(): void {
  const { inputPath, genomePath, patternsPath, preferenceModelPath } = parseArgs();
  if (!fs.existsSync(inputPath)) {
    console.error(`Corpus not found: ${inputPath}`);
    console.error("Collect playlists first: npm run corpus:collect-genome");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8")) as CorpusPlaylist[];
  if (!Array.isArray(raw) || raw.length < 3) {
    console.error("Corpus must be an array of at least 3 playlists.");
    process.exit(1);
  }
  if (raw.length < 50) {
    console.warn(`Warning: fitting from ${raw.length} playlists — target 1,000+ for stable genome.`);
  }

  let genome = fitPlaylistGenomeFromCorpus(raw);
  const pairwiseWeights = loadPairwiseWeights(preferenceModelPath);
  if (pairwiseWeights) {
    genome = attachPairwiseWeights(genome, pairwiseWeights);
  }

  fs.mkdirSync(path.dirname(genomePath), { recursive: true });
  fs.writeFileSync(genomePath, `${JSON.stringify(genome, null, 2)}\n`);
  fs.writeFileSync(patternsPath, `${JSON.stringify(genome.patterns, null, 2)}\n`);

  console.log(JSON.stringify({
    corpusPlaylists: raw.length,
    usablePlaylists: genome.corpusSize,
    trackCountMedian: genome.trackCountMedian,
    genomePath,
    patternsPath,
    energyArcMix: genome.energyArcMix,
    scoringWeights: genome.scoringWeights,
    pairwiseThresholds: genome.pairwiseThresholds,
    segmentBlend: genome.segmentBlend,
  }, null, 2));
}

main();
