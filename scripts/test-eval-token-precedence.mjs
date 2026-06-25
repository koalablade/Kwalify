/**
 * Prove local .env overrides stale process.env for PLAYLIST_EVAL_TOKEN.
 * Usage: node scripts/test-eval-token-precedence.mjs
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const BACKUP = path.join(ROOT, ".env.precedence-test.bak");

const DOTENV_TOKEN = "a".repeat(21);
const SHELL_TOKEN = "b".repeat(20);

async function main() {
  let hadBackup = false;
  try {
    try {
      await readFile(BACKUP, "utf8");
      hadBackup = true;
    } catch {
      try {
        await readFile(ENV_PATH, "utf8");
        await writeFile(BACKUP, await readFile(ENV_PATH, "utf8"));
        hadBackup = true;
      } catch { /* no .env */ }
    }

    await writeFile(ENV_PATH, `PLAYLIST_EVAL_TOKEN=${DOTENV_TOKEN}\n`, "utf8");

    const probe = spawnSync(
      process.execPath,
      ["-e", `import { readEvalToken } from "./backend/dist/lib/benchmark-env.js"; const r = readEvalToken(); console.log(JSON.stringify({ source: r.source, length: r.token.length, staleShellIgnored: r.staleShellIgnored }));`],
      {
        cwd: ROOT,
        env: { ...process.env, PLAYLIST_EVAL_TOKEN: SHELL_TOKEN, CI: "", GITHUB_ACTIONS: "" },
        encoding: "utf8",
      },
    );

    if (probe.status !== 0) {
      console.error(probe.stderr || probe.stdout);
      process.exit(1);
    }

    const result = JSON.parse(probe.stdout.trim());
    const pass =
      result.source === ".env PLAYLIST_EVAL_TOKEN"
      && result.length === 21
      && result.staleShellIgnored === true;

    console.log(JSON.stringify({ pass, result, shellTokenLength: 20, dotEnvTokenLength: 21 }, null, 2));
    process.exit(pass ? 0 : 1);
  } finally {
    if (hadBackup) {
      await writeFile(ENV_PATH, await readFile(BACKUP, "utf8"));
      await unlink(BACKUP);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
