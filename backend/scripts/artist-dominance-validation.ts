/**
 * Gated artist-dominance check for eval reports.
 * Usage: node backend/dist/scripts/artist-dominance-validation.js [evaluation-report.json]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_REPORT = path.join(
  ROOT,
  "reports/playlist-evaluation/scoring-stage3-post-fix/evaluation-report.json",
);

const WATCH_ARTISTS = [
  { key: "paramore", patterns: ["paramore"] },
  { key: "fred", patterns: ["fred again"] },
  { key: "gnr", patterns: ["guns n roses", "gnr"] },
] as const;

type Track = {
  artist?: string;
  scoreChannels?: { novelty?: number; attributionSource?: string };
};

type Row = {
  ok?: boolean;
  benchmark?: { id?: string; category?: string };
  response?: { tracks?: Track[] };
};

function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function matchArtist(artist: unknown): string | null {
  const n = norm(String(artist ?? ""));
  for (const t of WATCH_ARTISTS) {
    if (t.patterns.some((p) => n.includes(norm(p)))) return t.key;
  }
  return null;
}

function analyze(rows: Row[]) {
  const ok = rows.filter((r) => r.ok && (r.response?.tracks?.length ?? 0) > 0);
  const totals: Record<string, number> = {};
  const byPrompt: Array<{ id: string; category: string; counts: Record<string, number> }> = [];
  let maxPerPlaylist = 0;
  let maxPerPlaylistPrompt = "";

  for (const row of ok) {
    const counts: Record<string, number> = {};
    for (const t of row.response?.tracks ?? []) {
      const k = matchArtist(t.artist);
      if (!k) continue;
      counts[k] = (counts[k] ?? 0) + 1;
      totals[k] = (totals[k] ?? 0) + 1;
    }
    const paramore = counts.paramore ?? 0;
    if (paramore > maxPerPlaylist) {
      maxPerPlaylist = paramore;
      maxPerPlaylistPrompt = row.benchmark?.id ?? "";
    }
    if (Object.keys(counts).length > 0) {
      byPrompt.push({
        id: row.benchmark?.id ?? "",
        category: row.benchmark?.category ?? "",
        counts,
      });
    }
  }

  const half = Math.ceil(ok.length / 2);
  const early = { paramore: 0, fred: 0, gnr: 0 };
  const late = { paramore: 0, fred: 0, gnr: 0 };
  for (let i = 0; i < ok.length; i++) {
    const bucket = i < half ? early : late;
    for (const t of ok[i]!.response?.tracks ?? []) {
      const k = matchArtist(t.artist);
      if (k === "paramore" || k === "fred" || k === "gnr") {
        bucket[k] += 1;
      }
    }
  }

  const gates = {
    paramoreTotal: { value: totals.paramore ?? 0, max: 18, pass: (totals.paramore ?? 0) <= 18 },
    paramoreLateHalf: { value: late.paramore, max: 8, pass: late.paramore <= 8 },
    paramoreMaxPerPlaylist: { value: maxPerPlaylist, max: 6, pass: maxPerPlaylist <= 6, prompt: maxPerPlaylistPrompt },
    fredTotal: { value: totals.fred ?? 0, max: 10, pass: (totals.fred ?? 0) <= 10 },
    gnrTotal: { value: totals.gnr ?? 0, max: 10, pass: (totals.gnr ?? 0) <= 10 },
  };

  return {
    succeeded: ok.length,
    totals,
    earlyHalf: early,
    lateHalf: late,
    byPrompt,
    gates,
    pass: Object.values(gates).every((g) => g.pass),
  };
}

function buildMarkdown(result: ReturnType<typeof analyze>, reportLabel: string): string {
  const lines = [
    "# Artist Dominance Validation",
    "",
    `Report: \`${reportLabel}\``,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Gates",
    "",
    "| Gate | Value | Max | Pass |",
    "|------|------:|----:|:----:|",
  ];
  for (const [name, g] of Object.entries(result.gates)) {
    const extra = "prompt" in g && g.prompt ? ` (${g.prompt})` : "";
    lines.push(`| ${name}${extra} | ${g.value} | ${g.max} | ${g.pass ? "yes" : "no"} |`);
  }
  lines.push(
    "",
    `**Overall:** ${result.pass ? "PASS" : "FAIL"}`,
    "",
    "## Session split",
    "",
    `| Artist | Early half | Late half |`,
    `|--------|----------:|----------:|`,
    `| Paramore | ${result.earlyHalf.paramore} | ${result.lateHalf.paramore} |`,
    `| Fred again.. | ${result.earlyHalf.fred} | ${result.lateHalf.fred} |`,
    `| GnR | ${result.earlyHalf.gnr} | ${result.lateHalf.gnr} |`,
    "",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const reportPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_REPORT;
  const raw = JSON.parse(await readFile(reportPath, "utf8")) as { rawResults?: Row[] };
  const result = analyze(raw.rawResults ?? []);
  const outDir = path.dirname(reportPath);
  await mkdir(outDir, { recursive: true });
  const jsonOut = path.join(outDir, "artist-dominance-validation.json");
  const mdOut = path.join(outDir, "artist-dominance-validation.md");
  await writeFile(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2), "utf8");
  await writeFile(mdOut, buildMarkdown(result, path.basename(path.dirname(reportPath))), "utf8");
  console.log("Wrote", jsonOut);
  console.log("Wrote", mdOut);
  console.log(result.pass ? "PASS" : "FAIL", "— Paramore", result.totals.paramore ?? 0);
  if (!result.pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
