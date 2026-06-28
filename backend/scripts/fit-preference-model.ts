/**
 * Fit playlist preference model from bootstrap corpus and/or human pairwise labels.
 *
 *   npm run fit:preference-model
 *   npm run fit:preference-model -- --labels data/corpus/pairwise-human-labels.jsonl
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildCorpusIdIndex,
  fitPreferenceModelFromBootstrap,
  fitPreferenceModelFromHumanLabels,
  mergePreferenceModels,
  readHumanPairwiseLabels,
  type HumanPairwiseLabel,
} from "../core/editorial/playlist-preference-model";
import type { PatternScoringTrack } from "../core/editorial/human-playlist-patterns";

function parseArgs(): {
  corpusPath: string;
  labelsPath: string | null;
  modelPath: string;
} {
  const args = process.argv.slice(2);
  let corpusPath = path.join(process.cwd(), "data/corpus/human-playlists.json");
  let labelsPath: string | null = null;
  let modelPath = path.join(process.cwd(), "backend/data/playlist-preference-model.json");
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--in" && args[i + 1]) corpusPath = path.resolve(args[++i]!);
    if (args[i] === "--labels" && args[i + 1]) labelsPath = path.resolve(args[++i]!);
    if (args[i] === "--out" && args[i + 1]) modelPath = path.resolve(args[++i]!);
  }
  return { corpusPath, labelsPath, modelPath };
}

async function main(): Promise<void> {
  const { corpusPath, labelsPath, modelPath } = parseArgs();

  let bootstrap = fitPreferenceModelFromBootstrap([]);
  if (fs.existsSync(corpusPath)) {
    const playlists = JSON.parse(fs.readFileSync(corpusPath, "utf8")) as Array<{
      id?: string;
      tracks: PatternScoringTrack[];
    }>;
    bootstrap = fitPreferenceModelFromBootstrap(playlists);
  }

  let humanModel = null;
  let labels: HumanPairwiseLabel[] = [];
  if (labelsPath && fs.existsSync(labelsPath)) {
    labels = await readHumanPairwiseLabels(labelsPath);
    const corpusIndex = fs.existsSync(corpusPath)
      ? buildCorpusIdIndex(JSON.parse(fs.readFileSync(corpusPath, "utf8")))
      : new Map<string, PatternScoringTrack[]>();
    humanModel = fitPreferenceModelFromHumanLabels(labels, corpusIndex);
  }

  const model = mergePreferenceModels(bootstrap, humanModel);
  fs.mkdirSync(path.dirname(modelPath), { recursive: true });
  fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`);

  console.log(JSON.stringify({
    source: model.source,
    labelCount: model.labelCount,
    pairCount: model.pairCount,
    blendWeight: model.blendWeight,
    modelPath,
    labelsLoaded: labels.length,
    humanPairsResolved: humanModel?.pairCount ?? 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
