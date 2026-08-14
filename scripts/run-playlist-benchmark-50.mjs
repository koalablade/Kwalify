/**
 * Run the official 50-playlist evaluation harness against a live API.
 * Loads repo-root .env into the child process environment (never prints secrets).
 */
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const OUT_DIR = path.join(ROOT, "reports", "playlist-evaluation", "benchmark-50-after-fixes");
const HARNESS = path.join(ROOT, "backend", "dist", "scripts", "playlist-evaluation-harness.js");

function ephemeralEvalToken() {
  return randomBytes(16).toString("base64url").slice(0, 21);
}

async function loadDotEnvInto(target) {
  try {
    const raw = await readFile(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2].trim().replace(/^["']+|["']+$/g, "");
      if (!target[key]) target[key] = value;
    }
  } catch {
    /* no .env */
  }
}

async function healthOk(baseUrl) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/healthz`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchDeployedCommit(baseUrl) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/readyz`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    return typeof data.commit === "string" ? data.commit : "unknown";
  } catch {
    return "unknown";
  }
}

function runNode(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}`));
    });
  });
}

function localGitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function ensureApi(env, forceRestart = false) {
  const baseUrl = (env.KWALIFY_BENCHMARK_BASE_URL || env.API_BASE_URL || env.APP_URL || "http://localhost:5000").replace(/\/+$/, "");
  if (!forceRestart && await healthOk(baseUrl)) {
    console.error(`[benchmark-50] API healthy at ${baseUrl}`);
    return { baseUrl, startedServer: false, server: null };
  }
  if (forceRestart) {
    console.error("[benchmark-50] restarting local API with benchmark env...");
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)"', { encoding: "utf8" }).trim();
      const pid = Number(out);
      if (Number.isInteger(pid) && pid > 0) {
        process.kill(pid);
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch {
      /* port already free */
    }
  } else {
    console.error("[benchmark-50] API not reachable — starting local server...");
  }
  const server = spawn(process.execPath, [path.join(ROOT, "backend", "dist", "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  server.stdout?.on("data", (chunk) => process.stderr.write(chunk));
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await healthOk(baseUrl)) {
      console.error(`[benchmark-50] API ready at ${baseUrl}`);
      return { baseUrl, startedServer: true, server };
    }
  }
  server.kill("SIGTERM");
  throw new Error(`API did not become healthy at ${baseUrl}`);
}

const env = { ...process.env };
await loadDotEnvInto(env);
env.SMOKE_SPOTIFY_USER_ID = env.SMOKE_SPOTIFY_USER_ID || "koalablade";
if (!env.KWALIFY_BENCHMARK_BASE_URL && !env.API_BASE_URL) {
  env.KWALIFY_BENCHMARK_BASE_URL = env.APP_URL?.includes("kwalify.net")
    ? env.APP_URL.replace(/\/+$/, "")
    : "http://localhost:5000";
}

const localTarget = !env.KWALIFY_BENCHMARK_BASE_URL.includes("kwalify.net");
const gitCommit = localGitHead();
env.GIT_COMMIT = gitCommit;
env.PLAYLIST_EVAL_EXPECTED_VERSION = gitCommit;

if (localTarget) {
  env.PLAYLIST_EVAL_TOKEN = ephemeralEvalToken();
  console.error("[benchmark-50] local audit mode with ephemeral eval token");
}

const { baseUrl, startedServer, server } = await ensureApi(env, localTarget);
env.KWALIFY_BENCHMARK_BASE_URL = baseUrl;
const deployedCommit = await fetchDeployedCommit(baseUrl);
const expectedVersion = deployedCommit !== "unknown" ? deployedCommit : gitCommit;

if (!env.PLAYLIST_EVAL_TOKEN) {
  console.error(
    "[benchmark-50] PLAYLIST_EVAL_TOKEN missing for remote benchmark. Run:\n" +
      "  npm run sync:eval-token -Token \"<21-char eval token>\"",
  );
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
const harnessArgs = [
  "--benchmark-size", "50",
  "--out", OUT_DIR,
  "--base-url", baseUrl,
  "--spotify-user-id", env.SMOKE_SPOTIFY_USER_ID,
  "--token", env.PLAYLIST_EVAL_TOKEN,
  "--timeout-ms", "120000",
  "--delay-ms", "2500",
  "--max-http-retries", "2",
  "--cluster-fail-fast", "0",
  "--checkpoint-every", "5",
  "--fresh",
];
if (deployedCommit && deployedCommit !== "unknown") {
  harnessArgs.push("--expected-deployment-version", deployedCommit);
} else if (expectedVersion && expectedVersion !== "unknown") {
  harnessArgs.push("--expected-deployment-version", expectedVersion);
}

try {
  await runNode(HARNESS, harnessArgs, env);
  console.error(`[benchmark-50] done — reports in ${OUT_DIR}`);
} finally {
  if (startedServer && server && !server.killed) {
    server.kill("SIGTERM");
  }
}
