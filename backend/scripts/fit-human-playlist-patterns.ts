/**
 * Fit human playlist pattern priors from a corpus of real playlists.
 *
 * Prefer the full genome fitter:
 *   npm run fit:playlist-genome
 */

import fs from "node:fs";
import path from "node:path";
import { fitPlaylistGenomeFromCorpus, type CorpusPlaylist } from "../core/editorial/playlist-genome";

function parseArgs(): { inputPath: string; outputPath: string } {
  const args = process.argv.slice(2);
  let inputPath = path.join(process.cwd(), "data/corpus/human-playlists.json");
  let outputPath = path.join(process.cwd(), "backend/data/human-playlist-patterns.json");
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--in" && args[i + 1]) inputPath = path.resolve(args[++i]!);
    if (args[i] === "--out" && args[i + 1]) outputPath = path.resolve(args[++i]!);
  }
  return { inputPath, outputPath };
}

function main(): void {
  const { inputPath, outputPath } = parseArgs();
  if (!fs.existsSync(inputPath)) {
    console.error(`Corpus not found: ${inputPath}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8")) as CorpusPlaylist[];
  const genome = fitPlaylistGenomeFromCorpus(raw);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(genome.patterns, null, 2)}\n`);
  console.log(JSON.stringify({
    fittedFrom: genome.corpusSize,
    outputPath,
    profile: genome.patterns,
  }, null, 2));
}

main();
