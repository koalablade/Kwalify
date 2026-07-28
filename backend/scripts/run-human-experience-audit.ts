/**
 * Run full human experience benchmark audit (10k prompts).
 *
 * Usage:
 *   npm run build && node backend/dist/scripts/run-human-experience-audit.js
 *   node backend/dist/scripts/run-human-experience-audit.js --limit 500
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runHumanExperienceAudit } from "../lib/world-understanding/human-experience-audit";

function parseArgs(): { limit?: number; out: string; stratified: boolean } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
  };
  const limitRaw = get("--limit", "");
  return {
    limit: limitRaw ? Number(limitRaw) : undefined,
    out: get("--out", "backend/reports/human-experience-audit.json"),
    stratified: args.includes("--stratified"),
  };
}

function main(): void {
  const { limit, out, stratified } = parseArgs();
  const started = Date.now();
  process.stderr.write(
    `[human-experience-audit] Starting${limit ? ` (limit=${limit}${stratified ? ", stratified by difficulty" : ""})` : stratified ? " (stratified)" : " (full 10k)"}...\n`,
  );

  const report = runHumanExperienceAudit({ limit, maxFailuresStored: 500, stratified });

  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  process.stderr.write(`[human-experience-audit] Wrote ${out} in ${elapsed}s\n`);

  console.log(
    JSON.stringify(
      {
        total_prompts: report.total_prompts,
        accuracy_pct: report.accuracy_pct,
        weakest_dimensions: report.weakest_dimensions.slice(0, 5),
        failure_summary: report.failure_summary,
        top_failure_patterns: report.top_failure_patterns.slice(0, 20).map((p) => ({
          pattern: p.pattern,
          count: p.count,
        })),
        architecture_assessment: report.architecture_assessment,
        ...(report.style_breakdown
          ? { style_breakdown: report.style_breakdown, stratified: report.stratified }
          : {}),
        report_path: out,
      },
      null,
      2,
    ),
  );
}

main();
