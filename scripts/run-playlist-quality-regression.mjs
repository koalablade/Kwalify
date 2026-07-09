/**
 * Live playlist quality regression runner (thin wrapper).
 * Delegates to compiled regression gate with --live.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = path.join(ROOT, "backend", "dist", "scripts", "playlist-quality-regression-gate.js");
const extra = process.argv.slice(2);

const result = spawnSync(process.execPath, [gate, "--live", ...extra], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
