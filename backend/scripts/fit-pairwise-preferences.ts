/**
 * Bootstrap pairwise preference weights from playlist genome corpus.
 * Labels: human playlist order beats score-sorted and shuffled variants.
 *
 * Run after corpus exists:
 *   npm run fit:pairwise-preferences
 */

import fs from "node:fs";
import path from "node:path";
import {
  computeHumanPlaylistFeatures,
  scoreAgainstHumanPlaylistPatterns,
  type PatternScoringTrack,
} from "../core/editorial/human-playlist-patterns";
import type { PairwiseDimension } from "../core/editorial/pairwise-playlist-judge";

type CorpusPlaylist = { tracks: PatternScoringTrack[] };

const DIMENSIONS: PairwiseDimension[] = [
  "human_saveable",
  "opening_intention",
  "full_playlist_shape",
  "cringe_resistance",
  "prompt_alignment",
  "transition_flow",
  "discovery_pacing",
  "ending_satisfaction",
];

function shuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function scoreSorted(tracks: PatternScoringTrack[]): PatternScoringTrack[] {
  return tracks.slice().sort((a, b) => {
    const pa = a.popularity ?? 50;
    const pb = b.popularity ?? 50;
    return pb - pa;
  });
}

function openingScore(tracks: PatternScoringTrack[]): number {
  return scoreAgainstHumanPlaylistPatterns(tracks.slice(0, 5)).score;
}

function endingScore(tracks: PatternScoringTrack[]): number {
  return scoreAgainstHumanPlaylistPatterns(tracks.slice(-Math.min(8, tracks.length))).score;
}

function transitionScore(tracks: PatternScoringTrack[]): number {
  const f = computeHumanPlaylistFeatures(tracks);
  return f.smoothTransitionShare;
}

function discoveryScore(tracks: PatternScoringTrack[]): number {
  const f = computeHumanPlaylistFeatures(tracks);
  const band = f.discoveryRatio >= 0.15 && f.discoveryRatio <= 0.45 ? 1 : 0.5;
  return band * (f.artistSpacingMedian >= 3 ? 1 : 0.7);
}

function dimensionScores(tracks: PatternScoringTrack[]): Record<PairwiseDimension, number> {
  const full = scoreAgainstHumanPlaylistPatterns(tracks).score;
  return {
    human_saveable: full,
    opening_intention: openingScore(tracks),
    full_playlist_shape: full,
    cringe_resistance: transitionScore(tracks),
    prompt_alignment: full * 0.9,
    transition_flow: transitionScore(tracks),
    discovery_pacing: discoveryScore(tracks),
    ending_satisfaction: endingScore(tracks),
  };
}

function parseArgs(): { inputPath: string; outputPath: string } {
  const args = process.argv.slice(2);
  let inputPath = path.join(process.cwd(), "data/corpus/human-playlists.json");
  let outputPath = path.join(process.cwd(), "backend/data/pairwise-preference-weights.json");
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
    console.error("Run: node scripts/bootstrap-playlist-corpus-from-references.mjs");
    process.exit(1);
  }
  const playlists = JSON.parse(fs.readFileSync(inputPath, "utf8")) as CorpusPlaylist[];
  const wins: Record<PairwiseDimension, number> = Object.fromEntries(
    DIMENSIONS.map((d) => [d, 0]),
  ) as Record<PairwiseDimension, number>;
  const totals: Record<PairwiseDimension, number> = { ...wins };
  let pairs = 0;

  for (let i = 0; i < playlists.length; i += 1) {
    const human = playlists[i]!.tracks;
    if (human.length < 10) continue;
    const variants = [
      scoreSorted(human),
      shuffle(human, i * 7919 + 1),
      shuffle(human, i * 9973 + 2),
    ];
    for (const variant of variants) {
      pairs += 1;
      const a = dimensionScores(human);
      const b = dimensionScores(variant);
      for (const dim of DIMENSIONS) {
        totals[dim] += 1;
        if (a[dim] >= b[dim] + 0.02) wins[dim] += 1;
      }
    }
  }

  const weights: Record<PairwiseDimension, number> = {} as Record<PairwiseDimension, number>;
  for (const dim of DIMENSIONS) {
    const rate = totals[dim] > 0 ? wins[dim]! / totals[dim]! : 0.5;
    weights[dim] = Math.round((0.85 + rate * 0.7) * 100) / 100;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(weights, null, 2));
  console.log(JSON.stringify({ pairs, weights, output: outputPath }, null, 2));
}

main();
