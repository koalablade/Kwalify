/**
 * Playlist quality regression gate — golden prompts + hall of fame + opening + HRPS.
 * Evaluation infrastructure only; does not modify generation.
 *
 * Usage:
 *   node backend/dist/scripts/playlist-quality-regression-gate.js [--offline|--live] [--write-baseline] [--out dir]
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  formatQualityBenchmarkMarkdown,
  runQualityBenchmarkReport,
  type LiveGenerationResult,
} from "../tests/playlist-quality-benchmark/quality-benchmark-runner";
import { loadPromptSuiteEntries } from "../tests/playlist-quality-benchmark/prompt-suite-loader";
import { runHumanRetentionBenchmark } from "../tests/benchmark-human-retention";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_OUT = path.join(ROOT, "reports", "playlist-quality-regression");
const GENERATE_TIMEOUT_MS = 120_000;

type Args = {
  mode: "offline" | "live";
  writeBaseline: boolean;
  withHrps: boolean;
  outDir: string;
  baseUrl: string;
  spotifyUserId: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const mode = argv.includes("--live") ? "live" : "offline";
  return {
    mode,
    writeBaseline: argv.includes("--write-baseline"),
    withHrps: argv.includes("--with-hrps") || mode === "live",
    outDir: argv.includes("--out")
      ? argv[argv.indexOf("--out") + 1] ?? DEFAULT_OUT
      : DEFAULT_OUT,
    baseUrl: process.env.KWALIFY_BASE_URL ?? "http://localhost:5000",
    spotifyUserId: process.env.BENCHMARK_SPOTIFY_USER_ID ?? "koalablade",
  };
}

async function healthOk(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function generateLive(
  baseUrl: string,
  token: string,
  prompt: string,
  spotifyUserId: string,
  extraBody: Record<string, unknown> = {},
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
      ...extraBody,
    }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

function toPatternTrack(t: Record<string, unknown>) {
  return {
    trackId: `${String(t.artistName ?? t.artist ?? "?")}-${String(t.trackName ?? t.name ?? "?")}`
      .toLowerCase()
      .replace(/\s+/g, "-"),
    trackName: String(t.trackName ?? t.name ?? "?"),
    artistName: String(t.artistName ?? t.artist ?? "?"),
    genreFamily: (t.genreFamily as string | null | undefined) ?? null,
    energy: typeof t.energy === "number" ? t.energy : null,
    valence: typeof t.valence === "number" ? t.valence : null,
    danceability: typeof t.danceability === "number" ? t.danceability : null,
    acousticness: typeof t.acousticness === "number" ? t.acousticness : null,
    rediscoveryScore: 0.4,
  };
}

function isLibraryInsufficient(data: Record<string, unknown>, status: number): boolean {
  return (
    data.code === "LIBRARY_INSUFFICIENT_FOR_PROMPT" ||
    data.reason === "LIBRARY_INSUFFICIENT_FOR_PROMPT" ||
    (status === 200 && data.success === false && data.canUseDiscoveryMode === true)
  );
}

async function runLiveGenerations(args: Args, token: string): Promise<LiveGenerationResult[]> {
  const entries = loadPromptSuiteEntries("training");
  const results: LiveGenerationResult[] = [];

  for (const entry of entries) {
    process.stderr.write(`[quality-regression] live ${entry.id}...\n`);
    let gen;
    try {
      gen = await generateLive(args.baseUrl, token, entry.prompt, args.spotifyUserId);
    } catch (err) {
      results.push({
        entryId: entry.id,
        success: false,
        libraryInsufficient: false,
        tracks: [],
      });
      process.stderr.write(`  error: ${String(err)}\n`);
      continue;
    }

    const libraryInsufficient = isLibraryInsufficient(gen.data, gen.status);
    const tracks = (Array.isArray(gen.data.tracks) ? gen.data.tracks : []).map((t) =>
      toPatternTrack(t as Record<string, unknown>),
    );
    const success = !libraryInsufficient && gen.data.success !== false && tracks.length >= 5;

    results.push({
      entryId: entry.id,
      success,
      libraryInsufficient,
      varietyBoost: false,
      tracks,
    });
  }

  return results;
}

async function ensureServer(args: Args, token: string): Promise<(() => void) | null> {
  if (await healthOk(args.baseUrl)) return null;

  const { spawn } = await import("node:child_process");
  const env = { ...process.env, PLAYLIST_EVAL_TOKEN: token, GIT_COMMIT: process.env.GIT_COMMIT || "quality-regression" };
  const server = spawn(process.execPath, [path.join(ROOT, "backend", "dist", "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await healthOk(args.baseUrl)) {
      return () => server.kill("SIGTERM");
    }
  }

  server.kill("SIGTERM");
  throw new Error(`API did not start at ${args.baseUrl}`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const { randomBytes } = await import("node:crypto");
  const token = randomBytes(16).toString("base64url").slice(0, 21);

  let shutdown: (() => void) | null = null;
  let liveResults: LiveGenerationResult[] | undefined;

  if (args.mode === "live") {
    shutdown = await ensureServer(args, token);
    liveResults = await runLiveGenerations(args, token);
  }

  let hrpsAvgImprovement: number | null = null;
  if (args.withHrps) {
    try {
      const hrps = await runHumanRetentionBenchmark();
      hrpsAvgImprovement = hrps.summary.avgHrpsImprovement;
    } catch {
      hrpsAvgImprovement = null;
    }
  }

  const report = runQualityBenchmarkReport({
    mode: args.mode,
    liveResults,
    writeBaseline: args.writeBaseline,
    hrpsAvgImprovement,
  });

  await mkdir(args.outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(args.outDir, `report-${stamp}.json`);
  const mdPath = path.join(args.outDir, `report-${stamp}.md`);
  const latestJson = path.join(args.outDir, "latest.json");
  const latestMd = path.join(args.outDir, "latest.md");

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(mdPath, `${formatQualityBenchmarkMarkdown(report)}\n`);
  await writeFile(latestJson, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(latestMd, `${formatQualityBenchmarkMarkdown(report)}\n`);

  console.log(formatQualityBenchmarkMarkdown(report));
  console.log(`\nWrote ${jsonPath}`);

  shutdown?.();

  if (!report.regression.passed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
