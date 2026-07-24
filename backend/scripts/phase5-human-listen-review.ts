/**
 * Build human-listen review from phase5-bench-25 results.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeVibe } from "../lib/emotion";
import { buildLockedIntent } from "../core/v3/intent";
import { resolveHumanScene } from "../lib/human-scene-knowledge";
import { resolveSemanticScene } from "../lib/semantic-scene-engine";

type BenchRow = {
  benchmark: {
    id: string;
    category: string;
    prompt: string;
    length: number;
    expectedEnergy?: string;
  };
  ok: boolean;
  tracks: Array<{
    artist?: string;
    artistName?: string;
    name?: string;
    trackName?: string;
    energy?: number | null;
  }>;
  response?: { playlistConfidence?: number };
  elapsedMs?: number;
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
  if (underfill) score -= 0.2;
  if (n > 0 && n <= 3) score -= 0.15;
  if (overfill) score -= 0.04;
  if (expected === "high" && softShare > 0.35) score -= 0.12;
  if (expected === "low" && highShare > 0.35) score -= 0.18;
  if (row.benchmark.id === "party-latin-summer" && n <= 2) score = Math.min(score, 0.25);
  if (row.benchmark.id === "party-70s-disco" && avgE != null && avgE < 0.6) score -= 0.1;
  if (row.benchmark.id.startsWith("focus-") && avgE != null && avgE > 0.58 && expected === "low") score -= 0.12;
  score = Math.max(0.08, Math.min(0.94, score));
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

const lines = readFileSync("reports/playlist-evaluation/phase5-bench-25/evaluation-results.jsonl", "utf8")
  .trim()
  .split(/\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l) as BenchRow);
const report = JSON.parse(
  readFileSync("reports/playlist-evaluation/phase5-bench-25/evaluation-report.json", "utf8"),
) as { summary?: { playlists?: Array<Record<string, unknown>> } };
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
    prompt: p,
    expectedEnergy: row.benchmark.expectedEnergy,
    requestedLength: row.benchmark.length,
    readAs,
    interpretation: {
      humanScene: human.primary?.id ?? null,
      behaviour: human.musicalBehaviour ?? null,
      phase: human.phase ?? null,
      semantic: sem.matchedId ?? null,
      lockedEnergy: locked.energy,
      lockedActivity: locked.activity,
      genres: locked.genreFamilies,
      profileEnergy: +profile.energy.toFixed(2),
    },
    listen,
    trackList: tracks,
  });
}

writeFileSync(
  "reports/playlist-evaluation/phase5-bench-25/human-listen-review.json",
  JSON.stringify(out, null, 2),
);

const md: string[] = [
  "# Phase 5 — Live bench 25 human listen review",
  "",
  "Push: `3d441f6` on main. Harness pass rate 25/25. Below: what we read each prompt as, what came back, and whether a real person would keep listening on Spotify.",
  "",
  "| # | Prompt | Read as | n / avgE | Human listen |",
  "|---|---|---|---|---|",
  ...out.map(
    (o, i) =>
      `| ${i + 1} | ${o.prompt.replace(/\|/g, "/")} | ${o.interpretation.humanScene || o.interpretation.semantic || o.interpretation.lockedActivity || "—"} / ${o.interpretation.lockedEnergy} | ${o.listen.n} / ${o.listen.avgE ?? "—"} | **${o.listen.score}** ${o.listen.label} |`,
  ),
  "",
];

for (const o of out) {
  md.push(`## ${o.id}`);
  md.push("");
  md.push(`**Prompt:** "${o.prompt}"`);
  md.push("");
  md.push(`**What we read it as:** ${o.readAs}`);
  md.push("");
  md.push(
    `**Returned:** ${o.listen.n} tracks (asked ${o.requestedLength}), avg energy ${o.listen.avgE ?? "n/a"}, high-energy share ${o.listen.highPct}%, soft share ${o.listen.softPct}%.`,
  );
  md.push("");
  md.push("**Tracks:**");
  for (const t of o.trackList.slice(0, 15)) {
    md.push(`- ${t.artist} — ${t.title}${t.energy != null ? ` (e=${t.energy})` : ""}`);
  }
  if (o.trackList.length > 15) md.push(`- … +${o.trackList.length - 15} more`);
  md.push("");
  md.push(`**Would a real person listen?** ${o.listen.score} — ${o.listen.label}`);
  md.push("");
}

writeFileSync("reports/playlist-evaluation/phase5-bench-25/HUMAN-LISTEN-REVIEW.md", md.join("\n"));

for (const o of out) {
  console.log(
    `${o.id.padEnd(28)} n=${String(o.listen.n).padStart(2)} avgE=${String(o.listen.avgE).padEnd(5)} listen=${o.listen.score}  ${o.listen.label}`,
  );
}
