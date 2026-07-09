import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type RawResult = {
  benchmark?: {
    id?: string;
    category?: string;
    prompt?: string;
  };
  ok?: boolean;
  response?: {
    tracks?: Array<Record<string, unknown>>;
    generationDiagnostics?: Record<string, unknown>;
    playlistConfidence?: {
      recoveryUsed?: boolean;
    };
  };
};

type TrackUse = {
  key: string;
  name: string;
  artist: string;
  uses: number;
  openerUses: number;
  recoveryUses: number;
  avgScore: number | null;
  lanes: Map<string, number>;
  laneIds: Map<string, number>;
  retrievalSources: Map<string, number>;
  whyReasons: Map<string, number>;
  categories: Map<string, number>;
};

const ROOT = path.resolve(__dirname, "..", "..", "..");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function txt(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pushCount(map: Map<string, number>, key: string | null): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topEntries(map: Map<string, number>, n = 3): string {
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  if (rows.length === 0) return "n/a";
  return rows.map(([k, v]) => `${k} (${v})`).join(", ");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function main(): Promise<void> {
  const reportPath = path.join(ROOT, "reports", "playlist-evaluation", "live-6h", "evaluation-report.json");
  const raw = JSON.parse(await readFile(reportPath, "utf8")) as { rawResults?: RawResult[] };
  const rows = (raw.rawResults ?? []).filter((row) => row.ok);

  const byTrack = new Map<string, TrackUse>();
  let totalOccurrences = 0;
  let totalRecoveryOccurrences = 0;
  let totalOpenerOccurrences = 0;

  for (const row of rows) {
    const response = row.response ?? {};
    const tracks = asArray<Record<string, unknown>>(response.tracks);
    const benchmark = row.benchmark ?? {};
    const category = benchmark.category ?? "unknown";
    const gd = asRecord(response.generationDiagnostics);
    const retrieval = asRecord(gd?.candidateRetrieval);
    const retrievalSource = txt(retrieval?.pipeline) ?? "unknown";
    const recoveryTriggered = (gd?.recoveryTriggered === true) || (response.playlistConfidence?.recoveryUsed === true);

    tracks.forEach((track, index) => {
      const id = txt(track.id) ?? txt(track.trackId) ?? `${txt(track.artist) ?? txt(track.artistName) ?? "?"}::${txt(track.name) ?? txt(track.trackName) ?? "?"}`;
      const artist = txt(track.artist) ?? txt(track.artistName) ?? "?";
      const name = txt(track.name) ?? txt(track.trackName) ?? "?";
      const existing = byTrack.get(id) ?? {
        key: id,
        name,
        artist,
        uses: 0,
        openerUses: 0,
        recoveryUses: 0,
        avgScore: null,
        lanes: new Map(),
        laneIds: new Map(),
        retrievalSources: new Map(),
        whyReasons: new Map(),
        categories: new Map(),
      };
      const score = num(track.score);
      existing.avgScore = score == null
        ? existing.avgScore
        : existing.avgScore == null
          ? score
          : ((existing.avgScore * existing.uses) + score) / (existing.uses + 1);
      existing.uses += 1;
      if (index === 0) existing.openerUses += 1;
      if (recoveryTriggered) existing.recoveryUses += 1;
      pushCount(existing.lanes, txt(track.sourceLane));
      pushCount(existing.laneIds, txt(track.laneId));
      pushCount(existing.retrievalSources, retrievalSource);
      pushCount(existing.categories, category);
      const why = asArray<string>(track.whyReasons);
      for (const reason of why) pushCount(existing.whyReasons, reason);
      byTrack.set(id, existing);

      totalOccurrences += 1;
      if (index === 0) totalOpenerOccurrences += 1;
      if (recoveryTriggered) totalRecoveryOccurrences += 1;
    });
  }

  const top20 = [...byTrack.values()]
    .sort((a, b) => b.uses - a.uses || b.openerUses - a.openerUses)
    .slice(0, 20);

  const topOccurrences = top20.reduce((sum, row) => sum + row.uses, 0);
  const topRecoveryOccurrences = top20.reduce((sum, row) => sum + row.recoveryUses, 0);
  const topOpenerOccurrences = top20.reduce((sum, row) => sum + row.openerUses, 0);
  const multiLaneCount = top20.filter((row) => row.lanes.size > 1 || row.laneIds.size > 1).length;
  const highScoreCount = top20.filter((row) => (row.avgScore ?? 0) >= 0.7).length;

  const retrievalEvidence = round(topOccurrences / Math.max(1, totalOccurrences));
  const recoveryEvidence = round(topRecoveryOccurrences / Math.max(1, topOccurrences));
  const openerEvidence = round(topOpenerOccurrences / Math.max(1, topOccurrences));
  const crossLaneEvidence = round(multiLaneCount / Math.max(1, top20.length));
  const scoringEvidence = round(highScoreCount / Math.max(1, top20.length));

  const causeScores = [
    { cause: "A. retrieval quotas", score: retrievalEvidence, evidence: `${topOccurrences}/${totalOccurrences} (${(retrievalEvidence * 100).toFixed(1)}%) of all track placements come from top-20 reused tracks.` },
    { cause: "B. cross-lane convergence", score: crossLaneEvidence, evidence: `${multiLaneCount}/20 top tracks appear via multiple source lanes/lane IDs.` },
    { cause: "C. scoring preference", score: scoringEvidence, evidence: `${highScoreCount}/20 top tracks have average score >= 0.70.` },
    { cause: "D. recovery", score: recoveryEvidence, evidence: `${topRecoveryOccurrences}/${topOccurrences} (${(recoveryEvidence * 100).toFixed(1)}%) top-track placements occur in recovery-triggered playlists.` },
    { cause: "E. opener election", score: openerEvidence, evidence: `${topOpenerOccurrences}/${topOccurrences} (${(openerEvidence * 100).toFixed(1)}%) top-track placements are opener slots.` },
  ].sort((a, b) => b.score - a.score);

  const lines: string[] = [
    "# Overlap Root Cause Analysis",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Source: ${reportPath}`,
    "",
    "## Top 20 Most Reused Tracks",
    "",
    "| Track | Uses | Opener freq | Recovery freq | Avg V3 score | Lanes | Retrieval source | Top whyReason | Prompt categories | Multi-lane? |",
    "|------|------|-------------|---------------|--------------|-------|------------------|---------------|------------------|-------------|",
  ];

  for (const row of top20) {
    lines.push(
      `| ${`${row.artist} — ${row.name}`.replace(/\|/g, "/")} | ${row.uses} | ${row.openerUses} | ${row.recoveryUses} | ${row.avgScore == null ? "n/a" : round(row.avgScore)} | ${topEntries(row.lanes, 2).replace(/\|/g, "/")} | ${topEntries(row.retrievalSources, 2).replace(/\|/g, "/")} | ${topEntries(row.whyReasons, 2).replace(/\|/g, "/")} | ${topEntries(row.categories, 3).replace(/\|/g, "/")} | ${row.lanes.size > 1 || row.laneIds.size > 1 ? "yes" : "no"} |`,
    );
  }

  lines.push("");
  lines.push("## Cause Ranking (Evidence-Based)");
  lines.push("");
  for (const row of causeScores) {
    lines.push(`- **${row.cause}**: ${(row.score * 100).toFixed(1)}% signal — ${row.evidence}`);
  }

  lines.push("");
  lines.push("## Conclusion");
  lines.push("");
  lines.push(`Primary driver appears to be **${causeScores[0]?.cause ?? "n/a"}** based on highest measured signal.`);
  lines.push(`Secondary contributors: ${causeScores.slice(1, 3).map((row) => row.cause).join(", ")}.`);
  lines.push("Opener election is likely tertiary unless opener frequency is near retrieval-level concentration.");
  lines.push("Recovery contribution is substantial only if recovery frequency among top-20 placements approaches total reuse concentration.");
  lines.push("");
  lines.push("## Interpretation Notes");
  lines.push("");
  lines.push("- Retrieval quotas are inferred from concentration of repeated tracks and dominant retrieval source tags.");
  lines.push("- Cross-lane convergence is inferred when the same track appears with multiple `sourceLane` or `laneId` values.");
  lines.push("- Scoring preference is inferred from consistently high per-track `score` across repeated placements.");
  lines.push("- Recovery and opener effects are direct counts from recovery-triggered rows and first-position placements.");

  const outPath = path.join(ROOT, "reports", "playlist-evaluation", "overlap-root-cause-analysis.md");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${lines.join("\n")}\n`, "utf8");

  process.stdout.write(`[overlap-analysis] wrote ${outPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
