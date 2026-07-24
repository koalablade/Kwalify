/**
 * Spotcheck opener sanitizer on the 4 previously-failing SKIP prompts.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLocalDotEnv } from "../dist/lib/benchmark-env-dotenv.js";
import { evalPingOk, healthOk } from "../dist/lib/benchmark-local-server.js";
import { countPsychIndieOpenerFillers } from "../dist/core/editorial/world-identity-gate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const PROMPTS = [
  { id: "h55", prompt: "what would a cool older sibling put on" },
  { id: "h58", prompt: "playlist that feels like a film ending" },
  { id: "h86", prompt: "early 2010s indie sleaze night" },
  { id: "h98", prompt: "songs my dad would secretly like" },
];

const env = readLocalDotEnv();
const token = env.PLAYLIST_EVAL_TOKEN?.trim();
const userId = env.SMOKE_SPOTIFY_USER_ID?.trim() || "koalablade";
if (!token) {
  console.error("Missing PLAYLIST_EVAL_TOKEN in .env");
  process.exit(1);
}

async function killPort(port) {
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync(`netstat -ano | findstr ":${port}"`, { encoding: "utf8" });
    const pids = new Set(
      out
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/).pop())
        .filter((pid) => pid && /^\d+$/.test(pid)),
    );
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* port free */
  }
}

async function startFreshServer() {
  await killPort(5000);
  await new Promise((r) => setTimeout(r, 1500));
  const baseUrl = "http://127.0.0.1:5000";
  const server = spawn(process.execPath, [path.join(ROOT, "backend", "dist", "server.js")], {
    cwd: ROOT,
    env: { ...env, ...process.env, PORT: "5000", PLAYLIST_EVAL_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await healthOk(baseUrl)) && (await evalPingOk(baseUrl, token)).ok) {
      return { baseUrl, shutdown: () => server.kill("SIGTERM") };
    }
  }
  server.kill("SIGTERM");
  throw new Error("Fresh API did not become ready on :5000");
}

const { baseUrl, shutdown } = await startFreshServer();
console.log(`[opener-spotcheck] fresh server at ${baseUrl}`);

let failed = 0;
for (const fixture of PROMPTS) {
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: fixture.prompt,
      mode: "balanced",
      length: 25,
      spotifyUserId: userId,
      auditMode: true,
      allowDbWrites: false,
      allowSpotifyCreate: false,
      evaluationPromptId: fixture.id,
      evaluationTimeoutMs: 240_000,
    }),
  });
  const data = await res.json();
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const openers = tracks.slice(0, 3).map((t) => String(t.artist ?? t.artistName ?? "?"));
  const fillerCount = countPsychIndieOpenerFillers(
    tracks.map((t) => ({ artistName: t.artist ?? t.artistName })),
    3,
  );
  const fin = data.finalization ?? {};
  const sanitized = fin.psychIndieOpenerSanitized ?? 0;
  const ok = fillerCount < 2;
  if (!ok) failed += 1;
  console.log(
    `${fixture.id} ${ok ? "OK" : "FAIL"} openers=[${openers.join(" | ")}] fillerCount=${fillerCount} sanitized=${sanitized} maxAllowed=${fin.psychIndieOpenerMaxAllowed ?? "?"}`,
  );
}

shutdown();
process.exit(failed > 0 ? 1 : 0);
