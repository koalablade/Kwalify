#!/usr/bin/env node
/**
 * Show one generation evidence record (+ feedback) as readable markdown.
 *
 * Usage:
 *   npm run beta:evidence:show -- REQUEST_ID
 */
import { findFeedbackForGeneration, findGenerationEvidence } from "../dist/lib/beta-evidence-store.js";
import { formatEvidenceMarkdown } from "../dist/lib/beta-generation-evidence.js";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: npm run beta:evidence:show -- REQUEST_ID");
    process.exit(1);
  }
  const record = await findGenerationEvidence(id);
  if (!record) {
    console.error(`No evidence found for ${id}`);
    process.exit(1);
  }
  const feedbackRows = await findFeedbackForGeneration(id);
  const latestFeedback = feedbackRows.at(-1) ?? null;
  console.log(formatEvidenceMarkdown(record, latestFeedback));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
