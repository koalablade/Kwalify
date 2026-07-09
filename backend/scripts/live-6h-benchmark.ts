/**
 * 6-hour live playlist evaluation benchmark.
 *
 * Runs the full 250-prompt suite (gym, focus, party, era, genre, mood, contradictory,
 * discovery, edge cases, scaling scenes) against real /api/generate in audit mode.
 *
 * Usage:
 *   node backend/dist/scripts/live-6h-benchmark.js [--local] [--spawn-local] [--resume]
 *
 * Typical ~6–7h at concurrency 1 (120s timeout, 3s delay between prompts).
 * Checkpoints every prompt under reports/playlist-evaluation/live-6h/
 */

import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import {
  formatMissingBenchmarkEnv,
  readEvalToken,
  resolveLiveBenchmarkCredentials,
  validateBenchmarkEnvForCi,
} from "../lib/benchmark-env";
import { ensureEvalReady } from "../lib/benchmark-local-server";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const OUT_DIR = path.join(ROOT, "reports", "playlist-evaluation", "live-6h");
const DURATION_LABEL = "6h";

function localGitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "local-dev";
  }
}

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    local: argv.includes("--local") || !argv.includes("--production"),
    spawnLocal: argv.includes("--spawn-local"),
    resume: argv.includes("--resume"),
    fresh: argv.includes("--fresh"),
    category: (() => {
      const idx = argv.indexOf("--category");
      return idx >= 0 ? argv[idx + 1] ?? null : null;
    })(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const envCheck = validateBenchmarkEnvForCi();
  if (!envCheck.ok) {
    throw new Error(formatMissingBenchmarkEnv(envCheck.missing));
  }

  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: {
      ...(args.local ? { baseUrl: "http://localhost:5000" } : {}),
      spotifyUserId: process.env.SMOKE_SPOTIFY_USER_ID || "koalablade",
    },
    defaultBaseUrl: args.local ? "http://localhost:5000" : undefined,
  });

  process.stderr.write(
    `[live-6h] ${DURATION_LABEL} benchmark → ${creds.baseUrl} user=${creds.spotifyUserId} token=${readEvalToken().source}\n`,
  );
  process.stderr.write(
    "[live-6h] 250 prompts: gym, focus, party, driving, chill, era, genre, mood, contradictory, discovery, edge, scaling\n",
  );

  const evalReady = await ensureEvalReady(
    creds.baseUrl,
    creds.token,
    args.spawnLocal || args.local,
    "npm run benchmark:live-6h:local",
  );

  let expectedCommit = localGitHead();
  try {
    const pingRes = await fetch(`${evalReady.baseUrl}/api/eval/ping`, {
      method: "POST",
      headers: { "x-kwalify-evaluation-token": creds.token },
      signal: AbortSignal.timeout(15000),
    });
    const pingData = (await pingRes.json()) as Record<string, unknown>;
    if (typeof pingData.commit === "string" && pingData.commit.trim()) {
      expectedCommit = pingData.commit.trim();
    }
  } catch {
    // fall back to local git head
  }

  const harnessArgs = [
    path.join(ROOT, "backend", "dist", "scripts", "playlist-evaluation-harness.js"),
    "--base-url",
    evalReady.baseUrl,
    "--benchmark-size",
    "250",
    "--out",
    OUT_DIR,
    "--timeout-ms",
    "120000",
    "--concurrency",
    "1",
    "--delay-ms",
    "3000",
    "--max-http-retries",
    "2",
    "--max-failures",
    "60",
    "--cluster-fail-fast",
    "0",
    "--checkpoint-every",
    "1",
    "--expected-deployment-version",
    expectedCommit,
  ];

  if (args.category) {
    harnessArgs.push("--category", args.category);
  }
  if (args.resume) {
    harnessArgs.push("--resume");
  } else if (args.fresh || !args.resume) {
    harnessArgs.push("--fresh");
  }

  process.stderr.write(`[live-6h] Starting harness → ${OUT_DIR}\n`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, harnessArgs, {
      cwd: ROOT,
      env: {
        ...process.env,
        PLAYLIST_EVAL_TOKEN: creds.token,
        SMOKE_SPOTIFY_USER_ID: creds.spotifyUserId || "koalablade",
        GIT_COMMIT: localGitHead(),
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      evalReady.shutdown?.();
      if (code === 0) resolve();
      else reject(new Error(`Harness exited with code ${code ?? 1}`));
    });
  });

  process.stderr.write(`[live-6h] Complete. Reports: ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
