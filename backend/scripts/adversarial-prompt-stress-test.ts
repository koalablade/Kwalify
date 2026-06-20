/**
 * Adversarial prompt stress test — 1000 prompts, failure modes, weakest 10%.
 *
 * Usage:
 *   npm run stress:adversarial
 *   npm run stress:adversarial -- --limit 100
 *   npm run stress:adversarial -- --out reports/stress/adversarial.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { generateAdversarialPrompts, ADVERSARIAL_PROMPT_TARGET_COUNT } from "../lib/stress-testing/adversarial-prompts";
import { SYNTHETIC_LIBRARIES } from "../lib/stress-testing/synthetic-libraries";
import { evaluatePromptStress, summarizeStressResults } from "../lib/stress-testing/stress-evaluator";
import type { StressEvaluation } from "../lib/stress-testing/types";

function parseArgs(): { limit: number; out: string; seed: number; libraryId: string } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
  };
  return {
    limit: Number(get("--limit", String(ADVERSARIAL_PROMPT_TARGET_COUNT))),
    out: get("--out", "reports/stress/adversarial-prompt-stress.json"),
    seed: Number(get("--seed", "42")),
    libraryId: get("--library", "uk-electronic-only"),
  };
}

function main(): void {
  const { limit, out, seed, libraryId } = parseArgs();
  const library = SYNTHETIC_LIBRARIES.find((l) => l.id === libraryId) ?? SYNTHETIC_LIBRARIES.find((l) => l.id === "uk-electronic-only")!;
  const prompts = generateAdversarialPrompts({ seed, limit });
  const signatureIndex = new Map<string, string[]>();
  const results: StressEvaluation[] = [];

  for (const item of prompts) {
    results.push(evaluatePromptStress({
      prompt: item.prompt,
      libraryId: library.id,
      tracks: library.tracks,
      coldStart: library.coldStart,
      category: item.category,
      signatureIndex,
    }));
  }

  const summary = summarizeStressResults(results);
  const report = {
    schemaVersion: "adversarial-prompt-stress-v1",
    generatedAt: new Date().toISOString(),
    config: { limit, seed, libraryId: library.id, targetCount: ADVERSARIAL_PROMPT_TARGET_COUNT },
    summary,
    failures: results.filter((r) => !r.passed).slice(0, 50),
    weakestTenth: summary.weakest,
    allResults: results,
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  for (const row of summary.weakest.slice(0, 15)) {
    console.log(JSON.stringify({
      id: row.prompt.slice(0, 60),
      pass: row.passed,
      collapse: row.collapseType,
      stage: row.responsibleStage,
      failure: row.failureMode,
      fix: row.proposedFix,
      severity: row.severity,
    }));
  }

  console.log(JSON.stringify({
    prompts: results.length,
    passed: summary.passed,
    failed: summary.failed,
    passRate: summary.passRate,
    collapseCounts: summary.collapseCounts,
    stageCounts: summary.stageCounts,
    weakestTenthCount: summary.weakest.length,
    out,
  }, null, 2));

  console.log(`stress:adversarial complete — weakest ${summary.weakest.length} cases written to ${out}`);
}

main();
