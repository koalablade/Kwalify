#!/usr/bin/env node
/**
 * Append human feedback to a captured generation evidence record.
 *
 * Usage:
 *   npm run beta:evidence:feedback -- --id REQUEST_ID --opinion "Great until track 10"
 *   npm run beta:evidence:feedback -- --id REQUEST_ID --verdict mixed --reason tail --reason sequencing
 *   npm run beta:evidence:feedback -- --id REQUEST_ID --file feedback.json
 */
import { readFileSync } from "node:fs";
import { appendEvidenceFeedback, findGenerationEvidence } from "../dist/lib/beta-evidence-store.js";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function repeatedArgs(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) {
      values.push(process.argv[i + 1]);
    }
  }
  return values;
}

async function main() {
  const id = arg("--id") ?? arg("-i");
  if (!id) {
    console.error("Usage: --id REQUEST_ID [--opinion text] [--verdict good|mixed|bad] [--reason code] [--tester alias] [--file feedback.json]");
    process.exit(1);
  }
  const existing = await findGenerationEvidence(id);
  if (!existing) {
    console.warn(`Warning: no generation evidence found for ${id} — feedback will still be appended.`);
  }
  let payload = {};
  const file = arg("--file");
  if (file) {
    payload = JSON.parse(readFileSync(file, "utf8"));
  }
  const opinion = arg("--opinion") ?? payload.opinion ?? null;
  const testerId = arg("--tester") ?? payload.testerId ?? null;
  const verdict = arg("--verdict") ?? payload.verdict ?? null;
  const cliReasons = repeatedArgs("--reason");
  const reasons = cliReasons.length > 0 ? cliReasons : payload.reasons ?? undefined;
  const record = {
    kind: "feedback",
    generationEvidenceId: id,
    requestId: id,
    recordedAt: new Date().toISOString(),
    testerId,
    verdict,
    reasons,
    opinion,
    ratings: payload.ratings ?? undefined,
    trackFeedback: payload.trackFeedback ?? undefined,
  };
  await appendEvidenceFeedback(record);
  console.log(`Appended feedback for ${id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
