/**
 * Fit human playlist pattern priors from a corpus of real playlists.
 *
 * Input: JSON array of playlists, each { tracks: [...] } with artistName, energy,
 * valence, danceability, acousticness, rediscoveryScore/popularity.
 *
 * Output: fitted profile JSON (percentiles) — replaces hand-tuned priors when
 * HUMAN_PLAYLIST_PATTERNS_PATH points at the output file.
 *
 * Run: npm run fit:human-playlist-patterns -- --in data/corpus/human-playlists.json --out backend/data/human-playlist-patterns.json
 */

import fs from "node:fs";
import path from "node:path";
import {
  computeHumanPlaylistFeatures,
  DEFAULT_HUMAN_PLAYLIST_PATTERNS,
  type HumanPlaylistPatternProfile,
  type PatternScoringTrack,
} from "../core/editorial/human-playlist-patterns";

type CorpusPlaylist = { tracks: PatternScoringTrack[] };

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(sorted.length - 1, idx)]!;
}

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

function fitProfile(playlists: CorpusPlaylist[]): HumanPlaylistPatternProfile {
  const spacings: number[] = [];
  const discoveries: number[] = [];
  const maxShares: number[] = [];
  const jumps: number[] = [];
  const smooth: number[] = [];
  const slopes: number[] = [];

  for (const playlist of playlists) {
    const f = computeHumanPlaylistFeatures(playlist.tracks);
    spacings.push(f.artistSpacingMedian);
    discoveries.push(f.discoveryRatio);
    maxShares.push(f.maxArtistShare);
    jumps.push(f.avgEnergyJump);
    smooth.push(f.smoothTransitionShare);
    slopes.push(f.energySlope);
  }

  return {
    ...DEFAULT_HUMAN_PLAYLIST_PATTERNS,
    artistSpacingP25: percentile(spacings, 0.25),
    artistSpacingP50: percentile(spacings, 0.5),
    artistSpacingP75: percentile(spacings, 0.75),
    maxSameArtistShare: percentile(maxShares, 0.9),
    discoveryRatioP25: percentile(discoveries, 0.25),
    discoveryRatioP50: percentile(discoveries, 0.5),
    discoveryRatioP75: percentile(discoveries, 0.75),
    maxEnergyJumpP90: percentile(jumps, 0.9),
    transitionSmoothShare: percentile(smooth, 0.5),
  };
}

function main(): void {
  const { inputPath, outputPath } = parseArgs();
  if (!fs.existsSync(inputPath)) {
    console.error(`Corpus not found: ${inputPath}`);
    console.error("Provide a JSON array of { tracks: [...] } from real human playlists.");
    console.error("Until then, human-playlist-patterns.json remains hand-tuned editorial priors.");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8")) as CorpusPlaylist[];
  if (!Array.isArray(raw) || raw.length < 10) {
    console.error("Corpus must be an array of at least 10 playlists.");
    process.exit(1);
  }
  const profile = fitProfile(raw);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(profile, null, 2)}\n`);
  console.log(JSON.stringify({
    fittedFrom: raw.length,
    outputPath,
    profile,
  }, null, 2));
}

main();
