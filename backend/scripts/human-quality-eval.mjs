#!/usr/bin/env node
/**
 * Human-centric playlist quality evaluator CLI.
 * Measures existing output — does NOT modify generation.
 *
 * Usage:
 *   npm run eval:human-quality -- report              # audit beta evidence + write report
 *   npm run eval:human-quality -- audit-json path.json
 *   npm run eval:human-quality -- show REQUEST_ID     # via beta evidence show + audit
 *   npm run eval:human-quality -- review-template REQUEST_ID
 *   npm run eval:human-quality -- corpus              # list prompt corpus stats
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  runBetaEvidenceQualityReport,
  auditSavedApiResponse,
  formatHumanReviewMarkdown,
  humanReviewTemplate,
  HUMAN_QUALITY_PROMPT_CORPUS,
  corpusByCategory,
  corpusByDifficulty,
  pilotPrompts,
  evaluateFromBetaEvidence,
} from "../dist/lib/human-quality-evaluator/index.js";
import { findGenerationEvidence } from "../dist/lib/beta-evidence-store.js";
import { findFeedbackForGeneration } from "../dist/lib/beta-evidence-store.js";

async function main() {
  const cmd = process.argv[2] ?? "report";

  if (cmd === "corpus") {
    console.log(`Corpus: ${HUMAN_QUALITY_PROMPT_CORPUS.length} prompts`);
    console.log("By difficulty:", corpusByDifficulty());
    console.log("By category:", corpusByCategory());
    console.log("\nPilot subset:");
    for (const p of pilotPrompts()) console.log(`  ${p.id}: ${p.prompt}`);
    return;
  }

  if (cmd === "report") {
    const { paths, report } = await runBetaEvidenceQualityReport();
    console.log(`Report written:\n  ${paths.mdPath}\n  ${paths.jsonPath}`);
    console.log(`Playlists: ${report.playlistsEvaluated} | Human-reviewed: ${report.humanReviewed}`);
    console.log(`Next: ${report.recommendedNextStep}`);
    return;
  }

  if (cmd === "audit-json") {
    const path = process.argv[3];
    if (!path) {
      console.error("Usage: audit-json path/to/response.json");
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(path, "utf8"));
    const result = auditSavedApiResponse(data);
    console.log(JSON.stringify({
      requestId: result.requestId,
      hypothesis: result.automated.automatedHypothesis,
      hcs: result.automated.hcs,
      verifier: result.automated.independentVerifier,
      failureClasses: result.automated.failureClasses,
      outliers: result.automated.outliers,
    }, null, 2));
    return;
  }

  if (cmd === "review-template") {
    const id = process.argv[3];
    if (!id) {
      console.error("Usage: review-template REQUEST_ID");
      process.exit(1);
    }
    const record = await findGenerationEvidence(id);
    if (!record) {
      console.error(`No evidence for ${id}`);
      process.exit(1);
    }
    const feedback = (await findFeedbackForGeneration(id)).at(-1) ?? null;
    const playlist = evaluateFromBetaEvidence(record, feedback);
    const dir = join(process.cwd(), "reports", "human-quality-reviews");
    mkdirSync(dir, { recursive: true });
    const template = humanReviewTemplate(playlist);
    const jsonPath = join(dir, `${id}.review.json`);
    const mdPath = join(dir, `${id}.review.md`);
    writeFileSync(jsonPath, `${JSON.stringify(template, null, 2)}\n`);
    writeFileSync(mdPath, formatHumanReviewMarkdown(playlist));
    console.log(`Review template:\n  ${jsonPath}\n  ${mdPath}`);
    return;
  }

  if (cmd === "audit-id") {
    const id = process.argv[3];
    if (!id) {
      console.error("Usage: audit-id REQUEST_ID");
      process.exit(1);
    }
    const record = await findGenerationEvidence(id);
    if (!record) {
      console.error(`No evidence for ${id}`);
      process.exit(1);
    }
    const feedback = (await findFeedbackForGeneration(id)).at(-1) ?? null;
    const result = evaluateFromBetaEvidence(record, feedback);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error("Commands: report | audit-json | audit-id | review-template | corpus");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
