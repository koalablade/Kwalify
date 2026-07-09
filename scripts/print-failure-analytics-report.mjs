/**
 * Print playlist failure analytics report (requires running API + PLAYLIST_EVAL_TOKEN).
 *
 * Usage:
 *   node scripts/print-failure-analytics-report.mjs [--days 30] [--markdown]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const daysIdx = args.indexOf("--days");
const days = daysIdx >= 0 ? args[daysIdx + 1] : "30";
const markdown = args.includes("--markdown");
const baseUrl = process.env.KWALIFY_API_URL || "http://localhost:5000";

async function loadDotEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || env[m[1]]) continue;
      env[m[1]] = m[2].trim().replace(/^["']+|["']+$/g, "");
    }
  } catch { /* no .env */ }
  return env;
}

async function main() {
  const env = await loadDotEnv();
  const token = env.PLAYLIST_EVAL_TOKEN;
  if (!token) {
    console.error("PLAYLIST_EVAL_TOKEN is required in .env");
    process.exit(1);
  }

  const url = `${baseUrl}/api/eval/failure-analytics/report?days=${encodeURIComponent(days)}${markdown ? "&format=markdown" : ""}`;
  const res = await fetch(url, {
    headers: { "x-kwalify-evaluation-token": token },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(text);
    process.exit(1);
  }
  console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
