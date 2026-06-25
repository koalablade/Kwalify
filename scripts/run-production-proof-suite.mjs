/**
 * Run full production proof suite (requires valid PLAYLIST_EVAL_TOKEN in .env).
 *
 * Usage: node scripts/run-production-proof-suite.mjs
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const node = process.execPath;

function run(label, script, args = []) {
  console.log(`\n========== ${label} ==========\n`);
  const result = spawnSync(node, [script, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label} (exit ${result.status ?? 1})`);
    process.exit(result.status ?? 1);
  }
}

// Preflight auth before any long runs
run("preflight auth", path.join(ROOT, "scripts", "probe-deploy.mjs"));
run("scene-world-proof-remote", path.join(ROOT, "scripts", "scene-world-proof-remote.mjs"));
run("human-save-regression", path.join(ROOT, "scripts", "human-save-regression.mjs"));

try {
  const fs = await import("node:fs/promises");
  await fs.rm(path.join(ROOT, "reports", "live-e2e-phase", "checkpoint.json"), { force: true });
} catch { /* fresh */ }

run("live-e2e-65", path.join(ROOT, "scripts", "live-e2e-phase-run.mjs"));
run("production-evidence-report", path.join(ROOT, "scripts", "production-evidence-report.mjs"));

console.log("\nProduction proof suite complete.");
