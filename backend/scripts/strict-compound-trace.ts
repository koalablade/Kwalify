/**
 * Trace strict compound prompt failures (diagnosis only).
 *
 * Usage:
 *   npm run build
 *   node backend/dist/scripts/strict-compound-trace.js
 *   node backend/dist/scripts/strict-compound-trace.js --spawn-local
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureEvalReady } from "../lib/benchmark-local-server";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";

const PROMPTS = [
  { id: "party-70s-disco", prompt: "70s disco party dancefloor", mode: "strict" as const, length: 30 },
  { id: "genre-pop-party", prompt: "pop party classics", mode: "strict" as const, length: 30 },
];

const ROOT = path.resolve(__dirname, "..", "..", "..");

async function main(): Promise<void> {
  const spawnLocal = process.argv.includes("--spawn-local");
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000", expectedDeploymentVersion: "benchmark" },
  });
  const ready = await ensureEvalReady(
    creds.baseUrl,
    creds.token,
    spawnLocal,
    "node backend/dist/scripts/strict-compound-trace.js --spawn-local",
  );

  const traces: Record<string, unknown>[] = [];
  for (const prompt of PROMPTS) {
    const started = Date.now();
    const res = await fetch(`${ready.baseUrl}/api/generate?audit=1&debug=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: prompt.prompt,
        mode: prompt.mode,
        length: prompt.length,
        auditMode: true,
        spotifyUserId: creds.spotifyUserId,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const diagnostics = data.generationDiagnostics as Record<string, unknown> | undefined;
    traces.push({
      id: prompt.id,
      prompt: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      httpStatus: res.status,
      elapsedMs: Date.now() - started,
      success: data.success,
      code: data.code ?? null,
      error: data.error ?? null,
      trackCount: Array.isArray(data.tracks) ? data.tracks.length : 0,
      intentCollapseLayer: data.intentCollapseLayer ?? null,
      humanSaveabilityGate: data.humanSaveabilityGate ?? null,
      failureReason: diagnostics?.failureReason ?? null,
      preV3CandidateCount: (diagnostics?.preScoringCandidateShape as Record<string, unknown> | undefined)?.outputCount ?? null,
      executionTraceFailure: (data.playlistExecutionTrace as Record<string, unknown> | undefined)?.failure ?? null,
      executionTraceStages: Array.isArray((data.playlistExecutionTrace as Record<string, unknown> | undefined)?.stages)
        ? ((data.playlistExecutionTrace as { stages: Array<{ stage?: string; status?: string }> }).stages
          .map((s) => ({ stage: s.stage, status: s.status })))
        : null,
    });
    console.log(JSON.stringify(traces[traces.length - 1], null, 2));
  }

  const outDir = path.join(ROOT, "reports", "playlist-evaluation", "strict-compound-trace-2026-07-07");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "trace.json"), JSON.stringify(traces, null, 2));
  console.error(`[trace] wrote ${path.join(outDir, "trace.json")}`);
  ready.shutdown?.();
  process.exit(traces.some((row) => (row.httpStatus as number) >= 500) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
