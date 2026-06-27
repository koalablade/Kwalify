/**
 * Export blind A/B playlist pairs for human preference labelling.
 * Replace bootstrap fit (human vs shuffled) with labels from this file.
 *
 *   npm run build && node scripts/export-blind-pairwise-pairs.mjs
 *   # Raters fill: data/corpus/pairwise-human-labels.jsonl
 *   npm run fit:pairwise-preferences -- --labels data/corpus/pairwise-human-labels.jsonl
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveVerifiedProductionCredentials } = require("../backend/dist/lib/benchmark-env");
const { buildBlindPairwiseHumanBenchmarkPair } = require("../backend/dist/core/editorial/pairwise-playlist-judge");

const PROMPTS_PATH = path.resolve("data/corpus/pairwise-benchmark-prompts.json");
const OUT_PAIRS = path.resolve("data/corpus/blind-pairwise-export.json");
const LABELS_PATH = path.resolve("data/corpus/pairwise-human-labels.jsonl");

async function main() {
  const creds = resolveVerifiedProductionCredentials({ strict: true });
  const prompts = JSON.parse(await readFile(PROMPTS_PATH, "utf8"));
  const exports = [];

  for (const item of prompts.slice(0, 15)) {
    const reference = {
      label: "human_reference",
      tracks: item.referenceTracks ?? [],
    };
    exports.push({
      promptId: item.id,
      prompt: item.prompt,
      blindPair: buildBlindPairwiseHumanBenchmarkPair({
        prompt: item.prompt,
        playlistA: reference,
        playlistB: { label: "kwalify_generated", tracks: [] },
        seed: item.id,
      }),
      labelFormat: {
        prompt: item.prompt,
        playlistA_id: "sideA",
        playlistB_id: "sideB",
        winner: "a|b|tie",
        rater_id: "anonymous",
        questions: [
          "Which would you save?",
          "Which feels like a human spent an hour on it?",
          "Which would you send to a friend?",
        ],
      },
    });
  }

  await mkdir(path.dirname(OUT_PAIRS), { recursive: true });
  await writeFile(OUT_PAIRS, JSON.stringify({ baseUrl: creds.baseUrl, exports }, null, 2));
  try {
    await readFile(LABELS_PATH, "utf8");
  } catch {
    await writeFile(
      LABELS_PATH,
      '{"prompt":"example","playlistA_id":"a","playlistB_id":"b","winner":"a","rater_id":"demo","questions":["Which would you save?"]}\n',
    );
  }
  console.log(JSON.stringify({ pairs: exports.length, out: OUT_PAIRS, labelsTemplate: LABELS_PATH }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
