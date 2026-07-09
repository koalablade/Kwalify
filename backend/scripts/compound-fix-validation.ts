/**
 * Targeted post-fix validation for compound prompts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const ROOT = path.resolve(__dirname, "..", "..", "..");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function txt(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function runOne(id: string, baseUrl: string, token: string, spotifyUserId: string) {
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((row) => row.id === id);
  if (!prompt) throw new Error(`Missing prompt ${id}`);
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      auditMode: true,
      debug: true,
      debugPipeline: true,
      spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = asRecord(await res.json().catch(() => ({}))) ?? {};
  const gd = asRecord(body.generationDiagnostics) ?? {};
  const v3 = asRecord(body.v3Diagnostics) ?? {};
  const controlled = asRecord(v3.controlledGeneration) ?? {};
  const orch = asRecord(asRecord(gd.candidateRetrieval)?.orchestrator) ?? {};
  const tracks = asArray(body.tracks);
  const firstFive = tracks.slice(0, 5).map((row) => {
    const t = asRecord(row) ?? {};
    return `${txt(t.artist) ?? txt(t.artistName) ?? "?"} — ${txt(t.name) ?? txt(t.trackName) ?? "?"}`;
  });
  return {
    id,
    prompt: prompt.prompt,
    mode: prompt.mode,
    requested: prompt.length,
    status: res.status,
    elapsedMs: Date.now() - started,
    success: body.success === true,
    count: num(body.count) ?? tracks.length,
    executionPath: txt(asRecord(body.playlistExecutionTrace)?.executionPath),
    constraintFailures: asArray(controlled.constraintFailures).map(String),
    relaxationSteps: asArray(controlled.relaxationSteps).map(String),
    selectedRelaxation: controlled.selectedRelaxation ?? null,
    blendedIntentPool: asRecord(orch.blendedIntentPool),
    fallbackLevel: txt(gd.fallbackLevel),
    recoveryTier: txt(asRecord(gd.recoveryDiagnostics)?.tier),
    firstFive,
    passNormal: body.success === true
      && (num(body.count) ?? tracks.length) >= Math.min(20, prompt.length)
      && txt(asRecord(body.playlistExecutionTrace)?.executionPath) === "full_pipeline"
      && asArray(controlled.constraintFailures).length === 0,
  };
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) throw new Error("Pass prompt ids");
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });
  const rows = [];
  for (const id of ids) {
    process.stderr.write(`[validate] ${id}...\n`);
    rows.push(await runOne(id, creds.baseUrl, creds.token, creds.spotifyUserId));
  }
  const outDir = path.join(ROOT, "reports", "playlist-evaluation");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `compound-fix-validation-${stamp}.json`);
  await writeFile(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2), "utf8");
  for (const row of rows) {
    process.stdout.write(
      `${row.id}: status=${row.status} count=${row.count}/${row.requested} path=${row.executionPath} `
      + `failures=${row.constraintFailures.join(",") || "none"} steps=${row.relaxationSteps.join(">") || "none"} `
      + `passNormal=${row.passNormal}\n`,
    );
  }
  process.stdout.write(`[validate] wrote ${jsonPath}\n`);
  if (rows.some((row) => !row.passNormal)) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
