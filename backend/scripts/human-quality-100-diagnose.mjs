#!/usr/bin/env node
/**
 * Diagnose existing 100-generation JSONL. Does not generate. Does not modify the engine.
 *
 *   node backend/scripts/human-quality-100-diagnose.mjs
 *   node backend/scripts/human-quality-100-diagnose.mjs --in reports/human-quality/100-gen/results.jsonl
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  diagnose100GenerationRecords,
  BENCHMARK100_PLAYLIST_LENGTH,
} = require("../dist/lib/human-quality-evaluator/forensic-analysis.js");
const {
  formatDiagnosisMarkdown,
  formatLightweightReviewMarkdown,
  lightweightReviewJson,
  compareHumanReviews,
} = require("../dist/lib/human-quality-evaluator/diagnosis-report.js");
const { resolveQaLibrarySnapshot } = require("../dist/lib/human-quality-evaluator/library-snapshot.js");

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    inPath: get("--in", join(process.cwd(), "reports", "human-quality", "100-gen", "results.jsonl")),
    outDir: get("--out", join(process.cwd(), "reports", "human-quality", "100-gen", "diagnosis")),
    requested: Number.parseInt(get("--requested", "25"), 10) || 25,
  };
}

async function readJsonl(path) {
  const raw = await readFile(path, "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const opts = parseArgs();
  const records = await readJsonl(opts.inPath);
  if (records.length === 0) {
    console.error(`No records in ${opts.inPath}`);
    process.exit(1);
  }

  const cachePath = join(process.cwd(), "reports", "human-quality", "100-gen", "library-snapshot.json");
  const library = await resolveQaLibrarySnapshot(cachePath);
  if (library) console.log(`[diagnose] library snapshot ${library.librarySize} tracks`);
  else console.warn("[diagnose] no liked_songs snapshot — opportunity UNKNOWN");
  const diagnosis = diagnose100GenerationRecords(records, opts.requested, library);
  const hvDir = join(opts.outDir, "human-validation");
  const uriDir = join(hvDir, "uris");
  await mkdir(uriDir, { recursive: true });

  const md = formatDiagnosisMarkdown(diagnosis);
  await writeFile(join(opts.outDir, "HUMAN-CENTRIC-BENCHMARK-DIAGNOSIS.md"), md);
  await writeFile(
    join(opts.outDir, "diagnosis.json"),
    `${JSON.stringify({
      generatedAt: diagnosis.generatedAt,
      benchmarkRunId: diagnosis.benchmarkRunId,
      totals: diagnosis.totals,
      delivery: diagnosis.delivery,
      shortlist: diagnosis.shortlist.map((s) => ({
        requestId: s.requestId,
        prompt: s.prompt,
        bucket: s.bucket,
        whySelected: s.whySelected,
        humanQuestion: s.humanQuestion,
        delivered: s.delivered,
        requested: s.requested,
        responseQuality: s.responseQuality,
        libraryOpportunity: s.libraryOpportunity,
        libraryUtilisation: s.libraryUtilisation,
      })),
      failureRank: diagnosis.failureRank,
      recommendedNextAction: diagnosis.recommendedNextAction,
      defaultCluster: diagnosis.defaultCluster,
    }, null, 2)}\n`,
  );

  const classPath = join(opts.outDir, "classifications.jsonl");
  const lines = diagnosis.playlists.map((p) =>
    JSON.stringify({
      requestId: p.requestId,
      prompt: p.prompt,
      category: p.category,
      delivery: p.delivery,
      requested: p.requested,
      delivered: p.delivered,
      underfillMissing: p.underfillMissing,
      bucket: p.bucket,
      bucketWhy: p.bucketWhy,
      dimensions: p.dimensions,
      failureClasses: p.failureClasses,
      hcsScore: p.hcsScore,
      verifierVerdict: p.verifierVerdict,
      evaluatorConflict: p.evaluatorConflict,
      executionPath: p.executionPath,
      replayJaccard: p.replayJaccard,
      defaultClusterShare: p.defaultClusterShare,
      candidateFunnel: p.candidateFunnel,
      dropStage: p.dropStage,
      traceIncomplete: p.traceIncomplete,
      library: p.library,
      responseQuality: p.responseQuality,
    }),
  );
  await writeFile(classPath, `${lines.join("\n")}\n`);

  const indexLines = [
    "# Human validation set",
    "",
    "These are **tracklists from the benchmark**, not Spotify playlists.",
    "Queue the URI files. Fill each `.review.json`. Then rerun diagnose.",
    "",
  ];
  for (const item of diagnosis.shortlist) {
    await writeFile(join(hvDir, `${item.requestId}.md`), formatLightweightReviewMarkdown(item));
    await writeFile(join(hvDir, `${item.requestId}.review.json`), `${JSON.stringify(lightweightReviewJson(item), null, 2)}\n`);
    await writeFile(join(uriDir, `${item.requestId}.txt`), `${item.uris.join("\n")}${item.uris.length ? "\n" : ""}`);
    indexLines.push(`- [${item.prompt}](${item.requestId}.md) — ${item.bucket} — ${item.whySelected}`);
  }
  await writeFile(join(hvDir, "README.md"), `${indexLines.join("\n")}\n`);

  const reviewFiles = (await readdir(hvDir)).filter((f) => f.endsWith(".review.json"));
  const filled = [];
  for (const f of reviewFiles) {
    const raw = JSON.parse(await readFile(join(hvDir, f), "utf8"));
    if (raw.wouldPressPlay || raw.soundsLikePrompt || raw.wouldSave) filled.push(raw);
  }
  if (filled.length) {
    await writeFile(join(opts.outDir, "human-vs-automation.md"), compareHumanReviews(diagnosis, filled));
  }

  console.log(`[hq100-diagnose] ${records.length} records`);
  console.log(`[hq100-diagnose] buckets`, diagnosis.totals);
  console.log(`[hq100-diagnose] delivery`, diagnosis.delivery);
  console.log(`[hq100-diagnose] shortlist ${diagnosis.shortlist.length}`);
  console.log(`[hq100-diagnose] ${join(opts.outDir, "HUMAN-CENTRIC-BENCHMARK-DIAGNOSIS.md")}`);
  console.log(`[hq100-diagnose] NEXT: ${diagnosis.recommendedNextAction}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
