/**
 * Stage 3 rebalance validation — compare telemetry vs Stage 1 baseline.
 * Usage: node backend/dist/scripts/scoring-stage3-validation-analysis.js [stage3-report.json]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const STAGE1_ANALYSIS = path.join(
  ROOT,
  "reports/playlist-evaluation/scoring-stage1-after/score-channels-analysis.json",
);
const STAGE1_FORENSICS = path.join(ROOT, "reports/playlist-evaluation/scoring-forensics-data.json");
const DEFAULT_STAGE3 = path.join(
  ROOT,
  "reports/playlist-evaluation/scoring-stage3-after/evaluation-report.json",
);

const TARGET_ARTISTS = [
  { key: "laurindo", patterns: ["laurindo"] },
  { key: "tame", patterns: ["tame impala"] },
  { key: "paramore", patterns: ["paramore"] },
  { key: "fleetwood", patterns: ["fleetwood mac"] },
  { key: "fred", patterns: ["fred again"] },
  { key: "gnr", patterns: ["guns n roses", "gnr"] },
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
  attributionSource?: string;
};

type RawRow = {
  ok?: boolean;
  benchmark?: { id?: string; category?: string; length?: number };
  response?: {
    tracks?: Array<{
      artist?: string;
      name?: string;
      score?: number;
      scoreChannels?: Channel;
      scoreBreakdown?: { attributionSource?: string };
    }>;
    playlistConfidence?: { percent?: number; score?: number };
    generationDiagnostics?: Record<string, unknown>;
  };
};

type ArtistChannelRow = Channel & {
  promptId: string;
  artist: string;
  name: string;
  score: number;
  attributionSource: string;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function matchArtist(artist: unknown): string | null {
  const n = norm(String(artist ?? ""));
  for (const t of TARGET_ARTISTS) {
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

function artistStats(items: ArtistChannelRow[]) {
  const emb = items.map((i) => i.embedding ?? 0);
  const red = items.map((i) => i.rediscovery ?? 0);
  const ref = items.map((i) => i.refine ?? 0);
  const emo = items.map((i) => i.emotion ?? 0);
  return {
    count: items.length,
    avgEmbedding: avg(emb),
    avgRediscovery: avg(red),
    avgRefine: avg(ref),
    avgEmotion: avg(emo),
    corrEmbeddingRediscovery: pearson(emb, red),
    corrEmbeddingRefine: pearson(emb, ref),
    corrEmbeddingEmotion: pearson(emb, emo),
  };
}

function inferAttribution(ch: Channel | undefined, breakdown?: { attributionSource?: string }): string {
  if (breakdown?.attributionSource) return breakdown.attributionSource;
  if (ch?.attributionSource) return ch.attributionSource;
  if (ch && (ch.embedding ?? 0) === 0 && (ch.final ?? 0) >= 0.69 && (ch.final ?? 0) <= 0.71) {
    return "recovery";
  }
  return "primary";
}

function analyzeReport(raw: { rawResults?: RawRow[] }, label: string) {
  const rows = raw.rawResults ?? [];
  const okRows = rows.filter((r) => r.ok);

  const byArtist: Record<string, ArtistChannelRow[]> = {};
  for (const t of TARGET_ARTISTS) byArtist[t.key] = [];

  let tracksWithChannels = 0;
  let totalTracks = 0;
  let confidenceSum = 0;
  let confidenceN = 0;
  let underfills = 0;
  const recoveryRows: Array<Record<string, unknown>> = [];

  for (const row of okRows) {
    const tracks = row.response?.tracks ?? [];
    const req = row.benchmark?.length ?? 30;
    if (tracks.length < req) underfills += 1;

    const conf = row.response?.playlistConfidence?.percent
      ?? (typeof row.response?.playlistConfidence?.score === "number"
        ? row.response.playlistConfidence.score * 100
        : null);
    if (conf != null) {
      confidenceSum += conf;
      confidenceN += 1;
    }

    const gd = row.response?.generationDiagnostics ?? {};
    const rec = (gd.recoveryDiagnostics ?? {}) as Record<string, unknown>;

    for (const t of tracks) {
      totalTracks += 1;
      const ch = t.scoreChannels;
      const attr = inferAttribution(ch, t.scoreBreakdown);
      if (ch) tracksWithChannels += 1;

      const key = matchArtist(t.artist);
      if (key && ch) {
        byArtist[key]!.push({
          ...ch,
          promptId: row.benchmark?.id ?? "unknown",
          artist: String(t.artist ?? ""),
          name: String(t.name ?? ""),
          score: t.score ?? 0,
          attributionSource: attr,
        });
      }

      if ((key === "laurindo" || key === "tame") && attr !== "primary") {
        recoveryRows.push({
          promptId: row.benchmark?.id,
          category: row.benchmark?.category,
          artist: t.artist,
          name: t.name,
          score: t.score,
          attributionSource: attr,
          scoreChannels: ch ?? null,
          recoveryTier: rec.tier ?? null,
          recoveryTrigger: rec.triggerReason ?? null,
          candidateCountBeforeRecovery: rec.candidateCountBeforeRecovery ?? null,
          candidateCountAfterRecovery: rec.candidateCountAfterRecovery ?? null,
          underfillRecoveryApplied: gd.underfillRecoveryApplied ?? null,
          expandedPoolSize: gd.underfillRecoveryExpandedPoolSize ?? null,
        });
      }
    }
  }

  const paramore = byArtist.paramore ?? [];
  const repeatCounts: Record<string, number> = {};
  for (const [key, items] of Object.entries(byArtist)) {
    repeatCounts[key] = items.length;
  }

  return {
    label,
    playlists: rows.length,
    succeeded: okRows.length,
    totalTracks,
    tracksWithChannels,
    telemetryCoverage: totalTracks > 0 ? Math.round((tracksWithChannels / totalTracks) * 1000) / 1000 : 0,
    avgConfidence: confidenceN > 0 ? Math.round((confidenceSum / confidenceN) * 10) / 10 : null,
    underfills,
    paramore: artistStats(paramore),
    repeatCounts,
    recoveryForensics: recoveryRows,
    byArtist: Object.fromEntries(
      Object.entries(byArtist).map(([k, items]) => [k, { ...artistStats(items), samples: items.slice(0, 3) }]),
    ),
  };
}

type Stage1Paramore = {
  avgEmbedding?: number | null;
  avgRediscovery?: number | null;
  corrEmbeddingEmotion?: number | null;
  corrEmbeddingRediscovery?: number | null;
  corrEmbeddingRefine?: number | null;
};

function delta(current: number | null | undefined, baseline: number | null | undefined): string {
  if (current == null || baseline == null) return "n/a";
  const d = Math.round((current - baseline) * 1000) / 1000;
  return d > 0 ? `+${d}` : String(d);
}

function verdictLower(current: number | null | undefined, baseline: number | null | undefined): string {
  if (current == null || baseline == null) return "—";
  if (current < baseline - 0.02) return "lower";
  if (current > baseline + 0.02) return "higher";
  return "flat";
}

function buildMarkdown(
  stage3: ReturnType<typeof analyzeReport>,
  comparison: {
    paramoreAvgEmbedding: { stage1: unknown; stage3: unknown; delta?: string; verdict: string };
    paramoreAvgRediscovery: { stage1: unknown; stage3: unknown; delta?: string; verdict: string };
    corrEmbeddingEmotion: { stage1: unknown; stage3: unknown; delta?: string; verdict: string };
    corrEmbeddingRediscovery: { stage1: unknown; stage3: unknown; delta?: string; verdict: string };
    corrEmbeddingRefine: { stage1: unknown; stage3: unknown; delta?: string; verdict: string };
    avgConfidence: { stage1: unknown; stage3: unknown; delta?: string; verdict: string };
    underfills: { stage1: unknown; stage3: unknown; verdict: string };
    repeatCounts: { stage1: Record<string, number>; stage3: Record<string, number> };
  },
): string {
  const lines: string[] = [
    "# Stage 3 Rebalance Validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Run summary",
    "",
    "| Metric | Value |",
    "|--------|------:|",
    `| Succeeded | ${stage3.succeeded}/${stage3.playlists} |`,
    `| Telemetry coverage | ${(stage3.telemetryCoverage * 100).toFixed(1)}% |`,
    `| Avg confidence | ${stage3.avgConfidence ?? "n/a"} |`,
    `| Underfills | ${stage3.underfills} |`,
    "",
    "## Paramore channels vs Stage 1",
    "",
    "| Metric | Stage 1 | Stage 3 | Δ | Target | Verdict |",
    "|--------|--------:|--------:|--:|--------|---------|",
    `| avg embedding | ${comparison.paramoreAvgEmbedding.stage1} | ${comparison.paramoreAvgEmbedding.stage3 ?? "—"} | ${comparison.paramoreAvgEmbedding.delta ?? "—"} | ↓ noticeably | ${comparison.paramoreAvgEmbedding.verdict} |`,
    `| avg rediscovery | ${comparison.paramoreAvgRediscovery.stage1} | ${comparison.paramoreAvgRediscovery.stage3 ?? "—"} | ${comparison.paramoreAvgRediscovery.delta ?? "—"} | lower, capped | ${comparison.paramoreAvgRediscovery.verdict} |`,
    `| corr(emb, emotion) | ${comparison.corrEmbeddingEmotion.stage1} | ${comparison.corrEmbeddingEmotion.stage3 ?? "—"} | ${comparison.corrEmbeddingEmotion.delta ?? "—"} | lower | ${comparison.corrEmbeddingEmotion.verdict} |`,
    `| corr(emb, rediscovery) | ${comparison.corrEmbeddingRediscovery.stage1} | ${comparison.corrEmbeddingRediscovery.stage3 ?? "—"} | ${comparison.corrEmbeddingRediscovery.delta ?? "—"} | lower | ${comparison.corrEmbeddingRediscovery.verdict} |`,
    `| corr(emb, refine) | ${comparison.corrEmbeddingRefine.stage1} | ${comparison.corrEmbeddingRefine.stage3 ?? "—"} | ${comparison.corrEmbeddingRefine.delta ?? "—"} | lower | ${comparison.corrEmbeddingRefine.verdict} |`,
    `| avg confidence | ${comparison.avgConfidence.stage1} | ${comparison.avgConfidence.stage3 ?? "—"} | ${comparison.avgConfidence.delta ?? "—"} | ±2–3 pts | ${comparison.avgConfidence.verdict} |`,
    `| underfills | ${comparison.underfills.stage1} | ${comparison.underfills.stage3} | — | 0 | ${comparison.underfills.verdict} |`,
    "",
    "## Repeat counts",
    "",
    "| Artist | Stage 1 | Stage 3 |",
    "|--------|--------:|--------:|",
  ];

  const repeats = comparison.repeatCounts as { stage1: Record<string, number>; stage3: Record<string, number> };
  for (const key of TARGET_ARTISTS.map((t) => t.key)) {
    lines.push(`| ${key} | ${repeats.stage1[key] ?? "—"} | ${repeats.stage3[key] ?? 0} |`);
  }

  lines.push("", "## Recovery forensics (Laurindo / Tame)", "");
  if (stage3.recoveryForensics.length === 0) {
    lines.push("_No Laurindo/Tame recovery-path rows._");
  } else {
    for (const row of stage3.recoveryForensics) {
      lines.push(
        `### ${row.promptId} — ${row.artist} / ${row.name}`,
        "",
        `- attributionSource: **${row.attributionSource}**`,
        `- score: ${row.score}`,
        `- recovery tier: ${row.recoveryTier ?? "unknown"}`,
        `- trigger: ${row.recoveryTrigger ?? "unknown"}`,
        `- candidates before/after: ${row.candidateCountBeforeRecovery ?? "?"} → ${row.candidateCountAfterRecovery ?? "?"}`,
        `- underfill recovery: ${row.underfillRecoveryApplied ?? "?"}`,
        `- expanded pool: ${row.expandedPoolSize ?? "?"}`,
        "",
      );
    }
  }

  lines.push(
    "## Interpretation",
    "",
    "Judge success on **decorrelated channels** and **explainable recovery**, not Paramore count alone.",
    "If disappointing, inspect telemetry before re-tweaking weights.",
    "",
  );

  return lines.join("\n");
}

async function main(): Promise<void> {
  const reportPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_STAGE3;
  const raw = JSON.parse(await readFile(reportPath, "utf8")) as { rawResults?: RawRow[] };
  const stage3 = analyzeReport(raw, "scoring-stage3-after");

  let stage1Paramore: Stage1Paramore = {
    avgEmbedding: 0.356,
    avgRediscovery: 0.024,
    corrEmbeddingEmotion: 0.68,
    corrEmbeddingRediscovery: 0.675,
    corrEmbeddingRefine: 0.445,
  };
  let stage1Repeats: Record<string, number> = {};
  const stage1Confidence = 84.4;
  const stage1Underfills = 2;

  try {
    const s1 = JSON.parse(await readFile(STAGE1_ANALYSIS, "utf8")) as {
      stage1?: { byArtist?: { paramore?: Stage1Paramore } };
    };
    const p = s1.stage1?.byArtist?.paramore;
    if (p) stage1Paramore = { ...stage1Paramore, ...p };
  } catch { /* defaults */ }

  try {
    const forensics = JSON.parse(await readFile(STAGE1_FORENSICS, "utf8")) as {
      sources?: Record<string, { byArtist?: Record<string, number> }>;
    };
    const s1src = forensics.sources?.["reports/playlist-evaluation/scoring-stage1-after/evaluation-report.json"];
    if (s1src?.byArtist) stage1Repeats = s1src.byArtist;
  } catch { /* ignore */ }

  const p3 = stage3.paramore;
  const comparison = {
    paramoreAvgEmbedding: {
      stage1: stage1Paramore.avgEmbedding,
      stage3: p3.avgEmbedding,
      delta: delta(p3.avgEmbedding, stage1Paramore.avgEmbedding),
      target: "lower",
      verdict: verdictLower(p3.avgEmbedding, stage1Paramore.avgEmbedding),
    },
    paramoreAvgRediscovery: {
      stage1: stage1Paramore.avgRediscovery,
      stage3: p3.avgRediscovery,
      delta: delta(p3.avgRediscovery, stage1Paramore.avgRediscovery),
      target: "lower",
      verdict: verdictLower(p3.avgRediscovery, stage1Paramore.avgRediscovery),
    },
    corrEmbeddingEmotion: {
      stage1: stage1Paramore.corrEmbeddingEmotion,
      stage3: p3.corrEmbeddingEmotion,
      delta: delta(p3.corrEmbeddingEmotion, stage1Paramore.corrEmbeddingEmotion),
      target: "lower",
      verdict: verdictLower(p3.corrEmbeddingEmotion, stage1Paramore.corrEmbeddingEmotion),
    },
    corrEmbeddingRediscovery: {
      stage1: stage1Paramore.corrEmbeddingRediscovery,
      stage3: p3.corrEmbeddingRediscovery,
      delta: delta(p3.corrEmbeddingRediscovery, stage1Paramore.corrEmbeddingRediscovery),
      target: "lower",
      verdict: verdictLower(p3.corrEmbeddingRediscovery, stage1Paramore.corrEmbeddingRediscovery),
    },
    corrEmbeddingRefine: {
      stage1: stage1Paramore.corrEmbeddingRefine,
      stage3: p3.corrEmbeddingRefine,
      delta: delta(p3.corrEmbeddingRefine, stage1Paramore.corrEmbeddingRefine),
      target: "lower",
      verdict: verdictLower(p3.corrEmbeddingRefine, stage1Paramore.corrEmbeddingRefine),
    },
    avgConfidence: {
      stage1: stage1Confidence,
      stage3: stage3.avgConfidence,
      delta: stage3.avgConfidence != null ? delta(stage3.avgConfidence, stage1Confidence) : "n/a",
      target: "stable",
      verdict:
        stage3.avgConfidence != null && Math.abs(stage3.avgConfidence - stage1Confidence) <= 3
          ? "stable"
          : "drift",
    },
    underfills: {
      stage1: stage1Underfills,
      stage3: stage3.underfills,
      target: "0",
      verdict: stage3.underfills <= stage1Underfills ? "ok" : "regression",
    },
    repeatCounts: { stage1: stage1Repeats, stage3: stage3.repeatCounts },
  };

  const outDir = path.dirname(reportPath);
  await mkdir(outDir, { recursive: true });
  const jsonOut = path.join(outDir, "scoring-stage3-validation-analysis.json");
  await writeFile(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), stage3, comparison }, null, 2), "utf8");
  const mdOut = path.join(outDir, "scoring-stage3-validation.md");
  const md = buildMarkdown(stage3, comparison);
  await writeFile(mdOut, md, "utf8");
  console.log("Wrote", jsonOut);
  console.log("Wrote", mdOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
