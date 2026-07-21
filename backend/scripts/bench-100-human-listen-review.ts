/**
 * Build human-listen review from stratified bench-100 results.
 * Records title, prompt, tracks, and how a human would rate each playlist.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeVibe } from "../lib/emotion";
import { buildLockedIntent } from "../core/v3/intent";
import { resolveHumanScene } from "../lib/human-scene-knowledge";
import { resolveSemanticScene } from "../lib/semantic-scene-engine";

const OUT_DIR = process.argv[2] ?? "reports/playlist-evaluation/bench-100-roi";

type BenchRow = {
  benchmark: {
    id: string;
    category: string;
    prompt: string;
    length: number;
    mode?: string;
    expectedEnergy?: string;
    tags?: string[];
  };
  ok: boolean;
  tracks: Array<{
    artist?: string;
    artistName?: string;
    name?: string;
    trackName?: string;
    energy?: number | null;
  }>;
  response?: {
    playlistConfidence?: number;
    playlistName?: string;
    name?: string;
    count?: number;
  };
  elapsedMs?: number;
  error?: string | null;
};

function num(x: unknown, d: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : d;
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function judge(row: BenchRow, pmeta: Record<string, unknown>) {
  const tracks = row.tracks || [];
  const n = tracks.length;
  const energies = tracks
    .map((t) => t.energy)
    .filter((e): e is number => typeof e === "number" && Number.isFinite(e));
  const avgE = avg(energies);
  const highShare = energies.length ? energies.filter((e) => e > 0.72).length / energies.length : 0;
  const softShare = energies.length ? energies.filter((e) => e <= 0.52).length / energies.length : 0;
  const artists = tracks.map((t) => String(t.artist || t.artistName || "").toLowerCase()).filter(Boolean);
  const uniqueArtists = new Set(artists).size;
  const artistRep = n && artists.length ? 1 - uniqueArtists / n : 0;
  const expected = row.benchmark.expectedEnergy;
  let energyFit = 0.55;
  if (expected === "high") energyFit = avgE == null ? 0.4 : avgE >= 0.65 ? 0.92 : avgE >= 0.55 ? 0.7 : 0.28;
  else if (expected === "low") energyFit = avgE == null ? 0.4 : avgE <= 0.5 ? 0.92 : avgE <= 0.6 ? 0.58 : 0.22;
  else if (expected === "medium") energyFit = avgE == null ? 0.5 : avgE >= 0.45 && avgE <= 0.75 ? 0.88 : 0.48;
  const lengthFit = n <= 0 ? 0 : Math.min(1, n / Math.max(10, row.benchmark.length * 0.55));
  const underfill = n < row.benchmark.length * 0.45;
  const overfill = n > row.benchmark.length + 2;
  const sysConf = num(pmeta.confidence, num(row.response?.playlistConfidence, 0.55));
  const coherence = num(pmeta.coherenceScore, num(pmeta.transitionQuality, 0.85));
  let score =
    0.34 * energyFit +
    0.22 * lengthFit +
    0.18 * Math.min(1, coherence) +
    0.16 * Math.min(1, sysConf) +
    0.1 * (1 - Math.min(1, artistRep * 2));
  if (!row.ok) score = Math.min(score, 0.2);
  if (underfill) score -= 0.2;
  if (n > 0 && n <= 3) score -= 0.15;
  if (overfill) score -= 0.04;
  if (expected === "high" && softShare > 0.35) score -= 0.12;
  if (expected === "low" && highShare > 0.35) score -= 0.18;
  if (/latin|disco|ukg|shoegaze|synthwave/i.test(row.benchmark.prompt) && underfill) score = Math.min(score, 0.35);
  if (row.benchmark.category === "focus" && avgE != null && avgE > 0.58 && expected === "low") score -= 0.12;
  score = Math.max(0.05, Math.min(0.94, score));
  let label: string;
  if (score >= 0.78) label = "Would keep — feels like a real Spotify playlist I made";
  else if (score >= 0.65) label = "Would listen with some skips";
  else if (score >= 0.5) label = "Mixed — keep a few songs, rebuild the rest";
  else if (score >= 0.35) label = "Weak — wrong vibe or too thin to save";
  else label = "Would abandon / not save";
  return {
    score: +score.toFixed(2),
    label,
    avgE: avgE == null ? null : +avgE.toFixed(3),
    highPct: Math.round(highShare * 100),
    softPct: Math.round(softShare * 100),
    n,
    artistUnique: uniqueArtists,
    underfill,
    overfill,
    sysConf: +sysConf.toFixed(2),
  };
}

const resultsPath = path.join(OUT_DIR, "evaluation-results.jsonl");
const reportPath = path.join(OUT_DIR, "evaluation-report.json");
const lines = readFileSync(resultsPath, "utf8")
  .trim()
  .split(/\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l) as BenchRow);
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  summary?: { playlists?: Array<Record<string, unknown>> };
};
const playlists = report.summary?.playlists ?? [];

const out = [];
for (const row of lines) {
  const p = row.benchmark.prompt;
  const profile = analyzeVibe(p);
  const locked = buildLockedIntent(p);
  const human = resolveHumanScene(p);
  const sem = resolveSemanticScene(p, profile);
  const pmeta =
    playlists.find(
      (x) => x.promptId === row.benchmark.id || x.id === row.benchmark.id || x.prompt === p,
    ) ?? {};
  const tracks = (row.tracks || []).map((t) => ({
    artist: t.artist || t.artistName || "?",
    title: t.name || t.trackName || "?",
    energy: typeof t.energy === "number" ? +t.energy.toFixed(2) : null,
  }));
  const listen = judge(row, pmeta);
  const playlistTitle =
    (typeof row.response?.playlistName === "string" && row.response.playlistName) ||
    (typeof row.response?.name === "string" && row.response.name) ||
    p;
  const readAs = [
    human.primary?.id ? `scene ${human.primary.id}` : null,
    human.musicalBehaviour ? `behaviour ${human.musicalBehaviour}` : null,
    human.phase ? `phase ${human.phase}` : null,
    sem.matchedId ? `semantic ${sem.matchedId}` : null,
    `energy ${locked.energy ?? profile.energy.toFixed(2)}`,
    locked.activity ? `activity ${locked.activity}` : null,
    locked.genreFamilies?.length ? `genres ${locked.genreFamilies.join("/")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  out.push({
    id: row.benchmark.id,
    category: row.benchmark.category,
    mode: row.benchmark.mode ?? null,
    tags: row.benchmark.tags ?? [],
    prompt: p,
    playlistTitle,
    expectedEnergy: row.benchmark.expectedEnergy ?? null,
    requestedLength: row.benchmark.length,
    readAs,
    ok: row.ok,
    error: row.error ?? null,
    elapsedMs: row.elapsedMs ?? null,
    tracks,
    listen,
  });
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "human-listen-review.json"), JSON.stringify(out, null, 2));

const byLabel = new Map<string, number>();
const byCategory = new Map<string, { n: number; sum: number; keep: number; abandon: number }>();
for (const row of out) {
  byLabel.set(row.listen.label, (byLabel.get(row.listen.label) ?? 0) + 1);
  const cat = byCategory.get(row.category) ?? { n: 0, sum: 0, keep: 0, abandon: 0 };
  cat.n += 1;
  cat.sum += row.listen.score;
  if (row.listen.score >= 0.78) cat.keep += 1;
  if (row.listen.score < 0.35) cat.abandon += 1;
  byCategory.set(row.category, cat);
}
const avgScore = out.length ? out.reduce((s, r) => s + r.listen.score, 0) / out.length : 0;
const keepRate = out.length ? out.filter((r) => r.listen.score >= 0.78).length / out.length : 0;
const abandonRate = out.length ? out.filter((r) => r.listen.score < 0.35).length / out.length : 0;

const md: string[] = [
  `# Bench 100 — Human listen review`,
  ``,
  `**Out:** \`${OUT_DIR}\`  `,
  `**n:** ${out.length}  `,
  `**Mean human score:** ${avgScore.toFixed(2)}  `,
  `**Would keep (≥0.78):** ${(keepRate * 100).toFixed(0)}%  `,
  `**Would abandon (<0.35):** ${(abandonRate * 100).toFixed(0)}%`,
  ``,
  `## Rating distribution`,
  ``,
  ...[...byLabel.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `- ${n}× ${label}`),
  ``,
  `## By category`,
  ``,
  `| Category | n | avg | keep | abandon |`,
  `|---|---:|---:|---:|---:|`,
  ...[...byCategory.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([cat, s]) =>
        `| ${cat} | ${s.n} | ${(s.sum / s.n).toFixed(2)} | ${s.keep} | ${s.abandon} |`,
    ),
  ``,
  `## Summary table`,
  ``,
  `| # | Title | Prompt | Cat | n / avgE | Human listen |`,
  `|---|---|---|---|---|---|`,
];

out.forEach((row, i) => {
  const title = row.playlistTitle.replace(/\|/g, "/");
  const prompt = row.prompt.replace(/\|/g, "/");
  md.push(
    `| ${i + 1} | ${title} | ${prompt} | ${row.category} | ${row.listen.n} / ${row.listen.avgE ?? "—"} | **${row.listen.score}** ${row.listen.label} |`,
  );
});

md.push(``, `## Per-prompt detail`, ``);

for (const row of out) {
  md.push(`## ${row.id}`);
  md.push(``);
  md.push(`**Title:** ${row.playlistTitle}`);
  md.push(``);
  md.push(`**Prompt:** "${row.prompt}"`);
  md.push(``);
  md.push(`**Category / mode:** ${row.category} / ${row.mode ?? "—"}`);
  md.push(``);
  md.push(`**What we read it as:** ${row.readAs}`);
  md.push(``);
  md.push(
    `**Returned:** ${row.listen.n} tracks (asked ${row.requestedLength}), avg energy ${row.listen.avgE ?? "—"}, high-energy share ${row.listen.highPct}%, soft share ${row.listen.softPct}%.`,
  );
  if (!row.ok) md.push(``, `**Error:** ${row.error ?? "request failed"}`);
  md.push(``);
  md.push(`**Tracks:**`);
  const preview = row.tracks.slice(0, 12);
  for (const t of preview) {
    md.push(`- ${t.artist} — ${t.title}${t.energy == null ? "" : ` (e=${t.energy})`}`);
  }
  if (row.tracks.length > preview.length) md.push(`- … +${row.tracks.length - preview.length} more`);
  md.push(``);
  md.push(`**Would a real person listen?** ${row.listen.score} — ${row.listen.label}`);
  md.push(``);
}

writeFileSync(path.join(OUT_DIR, "HUMAN-LISTEN-REVIEW.md"), md.join("\n"));
writeFileSync(
  path.join(OUT_DIR, "human-listen-summary.json"),
  JSON.stringify(
    {
      outDir: OUT_DIR,
      n: out.length,
      meanScore: +avgScore.toFixed(3),
      keepRate: +keepRate.toFixed(3),
      abandonRate: +abandonRate.toFixed(3),
      byLabel: Object.fromEntries(byLabel),
      byCategory: Object.fromEntries(
        [...byCategory.entries()].map(([k, v]) => [
          k,
          { ...v, avg: +(v.sum / v.n).toFixed(3) },
        ]),
      ),
      worst: [...out].sort((a, b) => a.listen.score - b.listen.score).slice(0, 15).map((r) => ({
        id: r.id,
        prompt: r.prompt,
        title: r.playlistTitle,
        score: r.listen.score,
        label: r.listen.label,
        n: r.listen.n,
        avgE: r.listen.avgE,
      })),
      best: [...out].sort((a, b) => b.listen.score - a.listen.score).slice(0, 15).map((r) => ({
        id: r.id,
        prompt: r.prompt,
        title: r.playlistTitle,
        score: r.listen.score,
        label: r.listen.label,
        n: r.listen.n,
        avgE: r.listen.avgE,
      })),
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      outDir: OUT_DIR,
      n: out.length,
      meanScore: +avgScore.toFixed(3),
      keepRate: +keepRate.toFixed(3),
      abandonRate: +abandonRate.toFixed(3),
      files: ["human-listen-review.json", "HUMAN-LISTEN-REVIEW.md", "human-listen-summary.json"],
    },
    null,
    2,
  ),
);
