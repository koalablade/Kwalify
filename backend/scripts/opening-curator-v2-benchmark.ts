/**
 * Opening Curator v2 human-retention benchmark CLI.
 *
 * Usage:
 *   node backend/dist/scripts/opening-curator-v2-benchmark.js [--live] [--local] [--spawn-local] [--category functional]
 *
 * Live mode requires PLAYLIST_EVAL_TOKEN + SMOKE_SPOTIFY_USER_ID (see docs/benchmark-environment.md).
 * Use --local for http://localhost:5000. Use --spawn-local to boot a fresh API when the running
 * server's eval token does not match your .env (common after sync:eval-token without restart).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadOpeningCuratorV2BenchmarkPrompts } from "../tests/opening-curator-v2-benchmark/loader";
import { runOpeningCuratorV2Benchmark } from "../tests/opening-curator-v2-benchmark/runner";
import type { LiveGenerationPayload } from "../tests/opening-curator-v2-benchmark/types";
import type { PatternScoringTrack } from "../core/editorial/human-playlist-patterns";
import {
  formatMissingBenchmarkEnv,
  readEvalToken,
  resolveLiveBenchmarkCredentials,
  validateBenchmarkEnvForCi,
} from "../lib/benchmark-env";
import { ensureEvalReady } from "../lib/benchmark-local-server";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const GENERATE_TIMEOUT_MS = 120_000;

function parseArgs() {
  const argv = process.argv.slice(2);
  const mode = argv.includes("--live") ? "live" as const : "offline" as const;
  const catIdx = argv.indexOf("--category");
  const category = catIdx >= 0 ? argv[catIdx + 1] : null;
  const local = argv.includes("--local");
  const spawnLocal = argv.includes("--spawn-local");
  return {
    mode,
    category,
    local,
    spawnLocal,
  };
}

function toPatternTrack(t: Record<string, unknown>): PatternScoringTrack {
  const artist = String(t.artistName ?? t.artist ?? "?");
  const name = String(t.trackName ?? t.name ?? "?");
  return {
    trackId: String(t.id ?? t.trackId ?? `${artist}-${name}`).toLowerCase().replace(/\s+/g, "-"),
    artistName: artist,
    energy: typeof t.energy === "number" ? t.energy : null,
    valence: typeof t.valence === "number" ? t.valence : null,
    danceability: typeof t.danceability === "number" ? t.danceability : null,
    acousticness: typeof t.acousticness === "number" ? t.acousticness : null,
    rediscoveryScore: 0.4,
  };
}

async function generateLive(
  baseUrl: string,
  token: string,
  prompt: string,
  spotifyUserId: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: prompt,
      mode: "balanced",
      length: 25,
      auditMode: true,
      spotifyUserId,
      varietyBoost: false,
    }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

function isLibraryInsufficient(data: Record<string, unknown>, status: number): boolean {
  return (
    data.code === "LIBRARY_INSUFFICIENT_FOR_PROMPT" ||
    data.reason === "LIBRARY_INSUFFICIENT_FOR_PROMPT" ||
    (status === 200 && data.success === false && data.canUseDiscoveryMode === true)
  );
}

function failureLabel(data: Record<string, unknown>, status: number): string {
  const code = String(data.code ?? data.reason ?? status);
  const message = String(data.message ?? data.error ?? "").slice(0, 120);
  return message ? `${code}: ${message}` : code;
}

async function runLiveBenchmark(
  baseUrl: string,
  token: string,
  spotifyUserId: string,
  categoryFilter: string | null,
): Promise<LiveGenerationPayload[]> {
  let prompts = loadOpeningCuratorV2BenchmarkPrompts();
  if (categoryFilter) {
    prompts = prompts.filter((p) => p.category === categoryFilter);
  }

  const results: LiveGenerationPayload[] = [];
  for (const prompt of prompts) {
    process.stderr.write(`[oc2-benchmark] ${prompt.id}...\n`);
    try {
      const gen = await generateLive(baseUrl, token, prompt.prompt, spotifyUserId);
      const libraryInsufficient = isLibraryInsufficient(gen.data, gen.status);
      const tracks = (Array.isArray(gen.data.tracks) ? gen.data.tracks : []).map((t) =>
        toPatternTrack(t as Record<string, unknown>),
      );
      const success = !libraryInsufficient && gen.data.success !== false && tracks.length >= 5;
      if (!success) {
        process.stderr.write(`  failed: ${failureLabel(gen.data, gen.status)}\n`);
      }
      results.push({
        entryId: prompt.id,
        success,
        libraryInsufficient,
        tracks,
        audit: gen.data,
      });
    } catch (err) {
      results.push({
        entryId: prompt.id,
        success: false,
        libraryInsufficient: false,
        tracks: [],
      });
      process.stderr.write(`  error: ${String(err)}\n`);
    }
  }
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs();
  let liveRows: LiveGenerationPayload[] | undefined;
  let shutdown: (() => void) | null = null;

  if (args.mode === "live") {
    const envCheck = validateBenchmarkEnvForCi();
    if (!envCheck.ok) {
      throw new Error(formatMissingBenchmarkEnv(envCheck.missing));
    }

    const creds = resolveLiveBenchmarkCredentials({
      strict: true,
      cli: args.local ? { baseUrl: "http://localhost:5000" } : undefined,
      defaultBaseUrl: args.local ? "http://localhost:5000" : undefined,
    });

    process.stderr.write(
      `[oc2-benchmark] live → ${creds.baseUrl} user=${creds.spotifyUserId} token=${readEvalToken().source}\n`,
    );

    const evalReady = await ensureEvalReady(
      creds.baseUrl,
      creds.token,
      args.spawnLocal || args.local,
      "npm run benchmark:opening-curator-v2:live:local",
    );
    shutdown = evalReady.shutdown;
    liveRows = await runLiveBenchmark(
      evalReady.baseUrl,
      creds.token,
      creds.spotifyUserId,
      args.category,
    );
  }

  let prompts = loadOpeningCuratorV2BenchmarkPrompts();
  if (args.category) {
    prompts = prompts.filter((p) => p.category === args.category);
  }

  const report = runOpeningCuratorV2Benchmark({
    mode: args.mode,
    liveRows: args.mode === "live" ? liveRows : undefined,
  });

  if (args.category) {
    report.results = report.results.filter((r) => r.category === args.category);
  }

  console.log(report.markdown);

  const outDir = path.join(ROOT, "reports", "opening-curator-v2-benchmark");
  await mkdir(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  await writeFile(path.join(outDir, `report-${stamp}.md`), `${report.markdown}\n`);
  await writeFile(path.join(outDir, "latest.md"), `${report.markdown}\n`);
  await writeFile(
    path.join(outDir, `report-${stamp}.json`),
    JSON.stringify(
      {
        ...report,
        markdown: undefined,
      },
      null,
      2,
    ),
  );

  shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
