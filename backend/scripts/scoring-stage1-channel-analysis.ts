/**
 * Analyze scoreChannels telemetry from evaluation report.
 * Usage: node backend/dist/scripts/scoring-stage1-channel-analysis.js [report.json]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_REPORT = path.join(
  ROOT,
  "reports/playlist-evaluation/scoring-stage1-after/evaluation-report.json",
);
const BASELINE_REPORT = path.join(
  ROOT,
  "reports/playlist-evaluation/contextual-uniqueness-after/evaluation-report.json",
);

const TARGETS = [
  { key: "laurindo", patterns: ["laurindo"] },
  { key: "tame", patterns: ["tame impala"] },
  { key: "paramore", patterns: ["paramore"] },
] as const;

type Channel = {
  embedding?: number;
  userTaste?: number;
  emotion?: number;
  scene?: number;
  rediscovery?: number;
  refine?: number;
  freshness?: number;
  novelty?: number;
  contextual?: number;
  final?: number;
};

type TrackRow = {
  artist?: string;
  name?: string;
  score?: number;
  scoreChannels?: Channel;
  scoreBreakdown?: Record<string, number>;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function matchArtist(artist: unknown): string | null {
  const n = norm(String(artist ?? ""));
  for (const t of TARGETS) {
    if (t.patterns.some((p) => n.includes(norm(p)))) return t.key;
  }
  return null;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const vx = (xs[i] ?? 0) - mx;
    const vy = (ys[i] ?? 0) - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? Math.round((num / den) * 1000) / 1000 : null;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
}

async function analyzeReport(reportPath: string, label: string) {
  const raw = JSON.parse(await readFile(reportPath, "utf8")) as {
    rawResults?: Array<{ benchmark?: { id?: string; category?: string }; response?: { tracks?: TrackRow[] } }>;
  };
  const rows = raw.rawResults ?? [];
  const byArtist: Record<string, Array<Channel & { promptId: string; category: string; artist: string; name: string }>> = {
    laurindo: [],
    tame: [],
    paramore: [],
  };
  let tracksWithChannels = 0;
  let totalTracks = 0;

  for (const row of rows) {
    const tracks = row.response?.tracks ?? [];
    for (const t of tracks) {
      totalTracks += 1;
      if (!t.scoreChannels) continue;
      tracksWithChannels += 1;
      const key = matchArtist(t.artist);
      if (!key) continue;
      byArtist[key]!.push({
        ...t.scoreChannels,
        promptId: row.benchmark?.id ?? "unknown",
        category: row.benchmark?.category ?? "unknown",
        artist: String(t.artist ?? ""),
        name: String(t.name ?? ""),
      });
    }
  }

  const artistStats: Record<string, unknown> = {};
  for (const [key, items] of Object.entries(byArtist)) {
    const emb = items.map((i) => i.embedding ?? 0);
    const red = items.map((i) => i.rediscovery ?? 0);
    const ref = items.map((i) => i.refine ?? 0);
    const emo = items.map((i) => i.emotion ?? 0);
    const taste = items.map((i) => i.userTaste ?? 0);
    const nov = items.map((i) => Math.abs(i.novelty ?? 0));
    artistStats[key] = {
      count: items.length,
      avgEmbedding: avg(emb),
      avgUserTaste: avg(taste),
      avgEmotion: avg(emo),
      avgRediscovery: avg(red),
      avgRefine: avg(ref),
      avgNoveltyPenalty: avg(nov),
      corrEmbeddingRediscovery: pearson(emb, red),
      corrEmbeddingRefine: pearson(emb, ref),
      corrRediscoveryRefine: pearson(red, ref),
      corrEmbeddingEmotion: pearson(emb, emo),
      corrUserTasteRediscovery: pearson(taste, red),
      samples: items.slice(0, 5),
    };
  }

  return {
    label,
    playlists: rows.length,
    totalTracks,
    tracksWithChannels,
    telemetryCoverage: totalTracks > 0 ? Math.round((tracksWithChannels / totalTracks) * 1000) / 1000 : 0,
    byArtist: artistStats,
  };
}

async function main(): Promise<void> {
  const reportPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_REPORT;
  const out = {
    generatedAt: new Date().toISOString(),
    stage1: await analyzeReport(reportPath, "scoring-stage1-after"),
    baseline: null as Awaited<ReturnType<typeof analyzeReport>> | null,
  };
  try {
    out.baseline = await analyzeReport(BASELINE_REPORT, "contextual-uniqueness-after");
  } catch {
    out.baseline = null;
  }

  const outDir = path.dirname(reportPath);
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "score-channels-analysis.json");
  await writeFile(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote", outPath);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
