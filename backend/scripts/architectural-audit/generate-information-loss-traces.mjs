#!/usr/bin/env node
/**
 * Generate information-loss traces from v37-fresh-validation.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
const require = createRequire(join(repoRoot, "backend", "package.json"));
const { buildInformationLossReport } = require(join(repoRoot, "backend", "dist", "core", "playlist-contract", "information-loss.js"));

const v37Path = join(repoRoot, "reports", "playlist-evaluation", "v37-fresh-validation.json");
const v37 = JSON.parse(readFileSync(v37Path, "utf8"));

const rows = v37.rows.map((r) => ({
  id: r.id,
  prompt: r.prompt,
  category: r.category,
  delivered: r.funnel?.delivered ?? r.delivered,
  requested: 25,
  v3Composed: r.funnel?.v3Composed,
  postPurity: r.funnel?.postPurity,
  retrieval: r.funnel?.retrieval,
  hqgOutcome: r.humanQualityGate?.action,
  hqgReason: r.humanQualityGate?.reason,
}));

const report = buildInformationLossReport(rows);
const outPath = join(repoRoot, "reports", "playlist-evaluation", "v38-information-loss-traces.json");
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), source: "v37-fresh-validation.json", ...report }, null, 2));
console.log("Written:", outPath);
console.log("Earliest loss counts:", report.earliestLossCounts);
