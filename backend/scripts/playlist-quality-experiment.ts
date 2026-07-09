/**
 * Playlist quality experiment CLI — track every improvement as a measurable experiment.
 *
 * Usage:
 *   node backend/dist/scripts/playlist-quality-experiment.js --name "candidate retrieval v3" [--offline|--live] [--suite training|validation|stress|all]
 *   node backend/dist/scripts/playlist-quality-experiment.js --name "..." --live --suite all --flag retrievalVersion=3
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPlaylistQualityExperiment, loadPromptSuiteForLive } from "../tests/playlist-quality-benchmark/experiment-runner";
import { runHumanRetentionBenchmark } from "../tests/benchmark-human-retention";
import type { LiveGenerationResult } from "../tests/playlist-quality-benchmark/quality-benchmark-runner";
import type { PromptSuiteSplit } from "../tests/playlist-quality-benchmark/types";
import { listPromptSuiteSplits } from "../tests/playlist-quality-benchmark/prompt-suite-loader";
import { parseConfigurationFlags } from "../tests/playlist-quality-benchmark/experiment-metadata";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const GENERATE_TIMEOUT_MS = 120_000;

type Args = {
  name: string;
  mode: "offline" | "live";
  suites: PromptSuiteSplit[] | "all";
  withHrps: boolean;
  persist: boolean;
  baseUrl: string;
  spotifyUserId: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const nameIdx = argv.indexOf("--name");
  const name = nameIdx >= 0 ? argv[nameIdx + 1] ?? "unnamed experiment" : "unnamed experiment";
  const mode = argv.includes("--live") ? "live" : "offline";

  let suites: PromptSuiteSplit[] | "all" = ["training"];
  const suiteIdx = argv.indexOf("--suite");
  if (suiteIdx >= 0) {
    const value = argv[suiteIdx + 1] ?? "training";
    suites = value === "all" ? "all" : [value as PromptSuiteSplit];
  }

  return {
    name,
    mode,
    suites,
    withHrps: argv.includes("--with-hrps") || mode === "live",
    persist: !argv.includes("--no-persist"),
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

async function runLiveSuite(
  suite: PromptSuiteSplit,
  baseUrl: string,
  token: string,
  spotifyUserId: string,
): Promise<LiveGenerationResult[]> {
  const entries = loadPromptSuiteForLive(suite);
  const results: LiveGenerationResult[] = [];

  for (const entry of entries) {
    process.stderr.write(`[experiment] ${suite}/${entry.id}...\n`);
    try {
      const gen = await generateLive(baseUrl, token, entry.prompt, spotifyUserId);
      const libraryInsufficient = isLibraryInsufficient(gen.data, gen.status);
      const tracks = (Array.isArray(gen.data.tracks) ? gen.data.tracks : []).map((t) =>
        toPatternTrack(t as Record<string, unknown>),
      );
      results.push({
        entryId: entry.id,
        success: !libraryInsufficient && gen.data.success !== false && tracks.length >= 5,
        libraryInsufficient,
        varietyBoost: false,
        tracks,
      });
    } catch (err) {
      results.push({
        entryId: entry.id,
        success: false,
        libraryInsufficient: false,
        tracks: [],
      });
      process.stderr.write(`  error: ${String(err)}\n`);
    }
  }

  return results;
}

async function ensureServer(baseUrl: string, token: string): Promise<(() => void) | null> {
  if (await healthOk(baseUrl)) return null;
  const { spawn } = await import("node:child_process");
  const env = { ...process.env, PLAYLIST_EVAL_TOKEN: token, GIT_COMMIT: process.env.GIT_COMMIT || "quality-experiment" };
  const server = spawn(process.execPath, [path.join(ROOT, "backend", "dist", "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await healthOk(baseUrl)) return () => server.kill("SIGTERM");
  }
  server.kill("SIGTERM");
  throw new Error(`API did not start at ${baseUrl}`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const argv = process.argv.slice(2);
  const { randomBytes } = await import("node:crypto");
  const token = randomBytes(16).toString("base64url").slice(0, 21);

  const suites = args.suites === "all" ? listPromptSuiteSplits() : args.suites;
  const liveResultsBySuite: Partial<Record<PromptSuiteSplit, LiveGenerationResult[]>> = {};

  let shutdown: (() => void) | null = null;
  if (args.mode === "live") {
    shutdown = await ensureServer(args.baseUrl, token);
    for (const suite of suites) {
      liveResultsBySuite[suite] = await runLiveSuite(suite, args.baseUrl, token, args.spotifyUserId);
    }
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

  const record = runPlaylistQualityExperiment({
    name: args.name,
    mode: args.mode,
    suites,
    liveResultsBySuite,
    configurationFlags: parseConfigurationFlags(argv),
    hrpsAvgImprovement,
    argv,
    persist: args.persist,
  });

  console.log(record.reportMarkdown);

  const outDir = path.join(ROOT, "reports", "playlist-quality-experiments");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "latest-console.md"), `${record.reportMarkdown}\n`);

  shutdown?.();

  if (record.overallRecommendation === "REJECT") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
