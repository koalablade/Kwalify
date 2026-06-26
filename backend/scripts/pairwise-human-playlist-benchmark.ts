/**
 * Pairwise human playlist benchmark scaffold.
 *
 * Produces blind A/B pairs (Kwalify vs reference human playlist) for external rating.
 * The trustworthy benchmark is human pairwise choice — not internal gate pass rate.
 *
 * Run:
 *   npm run benchmark:pairwise-human -- --prompt "summer morning commute" --reference-playlist <spotify-url-or-id>
 *
 * Requires PLAYLIST_EVAL_TOKEN and corpus entries in data/corpus/pairwise-benchmark-prompts.json
 */

import fs from "node:fs";
import path from "node:path";
import { buildBlindPairwiseHumanBenchmarkPair } from "../core/editorial/pairwise-playlist-judge";

type BenchmarkPrompt = {
  id: string;
  prompt: string;
  referencePlaylistId?: string;
  referenceTrackNames?: Array<{ trackName: string; artistName: string }>;
};

const REPORT_DIR = path.resolve(process.cwd(), "reports");
const PROMPTS_PATH = path.resolve(process.cwd(), "data/corpus/pairwise-benchmark-prompts.json");

function parseArgs(): { promptsPath: string; limit: number } {
  let promptsPath = PROMPTS_PATH;
  let limit = 100;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--prompts" && args[i + 1]) promptsPath = path.resolve(args[++i]!);
    if (args[i] === "--limit" && args[i + 1]) limit = Number.parseInt(args[++i]!, 10);
  }
  return { promptsPath, limit };
}

function main(): void {
  const { promptsPath, limit } = parseArgs();
  if (!fs.existsSync(promptsPath)) {
    const seed: BenchmarkPrompt[] = [
      {
        id: "summer_morning",
        prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.",
        referenceTrackNames: [
          { trackName: "Remember When", artistName: "Wallows" },
          { trackName: "Can I Call You Tonight?", artistName: "Dayglow" },
          { trackName: "Sunflower", artistName: "Rex Orange County" },
        ],
      },
      {
        id: "rainy_walk",
        prompt: "rainy city morning walk with reflective mood",
        referenceTrackNames: [
          { trackName: "Holocene", artistName: "Bon Iver" },
          { trackName: "Motion Sickness", artistName: "Phoebe Bridgers" },
        ],
      },
    ];
    fs.mkdirSync(path.dirname(promptsPath), { recursive: true });
    fs.writeFileSync(promptsPath, `${JSON.stringify(seed, null, 2)}\n`);
    console.log(`Created seed prompts at ${promptsPath}`);
  }

  const prompts = JSON.parse(fs.readFileSync(promptsPath, "utf8")) as BenchmarkPrompt[];
  const pairs = prompts.slice(0, limit).map((row, idx) => {
    const referenceTracks = (row.referenceTrackNames ?? []).map((t) => ({
      trackName: t.trackName,
      artistName: t.artistName,
    }));
    return {
      id: row.id,
      ...buildBlindPairwiseHumanBenchmarkPair({
        prompt: row.prompt,
        playlistA: { label: "human_reference", tracks: referenceTracks },
        playlistB: {
          label: "kwalify_generated",
          tracks: [{ trackName: "(generate via /generate and paste tracks)", artistName: "..." }],
        },
        seed: idx + 1,
      }),
      instructions: [
        "Show sideA and sideB without revealing source labels to raters.",
        "Collect pairwise answers for each question (A, B, or tie).",
        "Win rate vs human reference = primary quality metric.",
        "Target: Kwalify wins ~50% against real human playlists for similar prompts.",
      ],
    };
  });

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const outPath = path.join(REPORT_DIR, "pairwise-human-benchmark-pairs.json");
  fs.writeFileSync(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), pairs }, null, 2)}\n`);
  console.log(`Wrote ${pairs.length} blind A/B pairs to ${outPath}`);
  console.log("Next: generate Kwalify playlists for each prompt, replace placeholder sideB tracks, run human rating session.");
}

main();
