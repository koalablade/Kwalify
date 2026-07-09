/**
 * Top track overlap report from a completed playlist evaluation run.
 *
 * Usage:
 *   node backend/dist/scripts/top-track-overlap-report.js
 *   node backend/dist/scripts/top-track-overlap-report.js --out reports/playlist-evaluation/live-6h
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

type TrackRow = {
  id?: string;
  trackId?: string;
  name?: string;
  trackName?: string;
  artist?: string;
  artistName?: string;
  sourceLane?: string | null;
  laneId?: string | null;
  whyReasons?: string[];
};

type RawResult = {
  benchmark?: { id?: string; prompt?: string };
  ok?: boolean;
  response?: {
    tracks?: TrackRow[];
    playlistConfidence?: { recoveryUsed?: boolean; fallbackUsed?: boolean };
    generationDiagnostics?: {
      recoveryTriggered?: boolean;
      recoveryDiagnostics?: { tier?: string };
      retrievalOrchestrator?: { blendedIntentPool?: unknown; strategy?: string };
    };
  };
};

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function trackKey(track: TrackRow): string {
  return track.id ?? track.trackId ?? `${track.artist ?? track.artistName}::${track.name ?? track.trackName}`;
}

function trackLabel(track: TrackRow): string {
  const artist = track.artist ?? track.artistName ?? "?";
  const name = track.name ?? track.trackName ?? "?";
  return `${artist} — ${name}`;
}

function retrievalSource(track: TrackRow, row: RawResult): string {
  const parts: string[] = [];
  if (track.sourceLane) parts.push(`lane:${track.sourceLane}`);
  if (track.laneId) parts.push(`laneId:${track.laneId}`);
  const why = track.whyReasons?.[0];
  if (why) parts.push(why);
  const orch = row.response?.generationDiagnostics?.retrievalOrchestrator;
  if (orch?.blendedIntentPool) parts.push("blended_intent_pool");
  if (orch?.strategy) parts.push(`strategy:${orch.strategy}`);
  return parts.length > 0 ? parts.join("; ") : "unknown";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outDir = path.resolve(argValue(args, "--out") ?? "reports/playlist-evaluation/live-6h");
  const reportPath = path.join(outDir, "evaluation-report.json");
  const raw = JSON.parse(await readFile(reportPath, "utf8")) as { rawResults?: RawResult[] };
  const rows = raw.rawResults ?? [];

  const usage = new Map<string, {
    label: string;
    uses: number;
    openerUses: number;
    recoveryUses: number;
    promptIds: Set<string>;
    sources: Map<string, number>;
  }>();

  for (const row of rows) {
    if (!row.ok) continue;
    const tracks = row.response?.tracks ?? [];
    const recovery =
      row.response?.playlistConfidence?.recoveryUsed === true ||
      row.response?.generationDiagnostics?.recoveryTriggered === true;
    const promptId = row.benchmark?.id ?? "?";

    tracks.forEach((track, index) => {
      const key = trackKey(track);
      const entry = usage.get(key) ?? {
        label: trackLabel(track),
        uses: 0,
        openerUses: 0,
        recoveryUses: 0,
        promptIds: new Set<string>(),
        sources: new Map<string, number>(),
      };
      entry.uses += 1;
      if (index === 0) entry.openerUses += 1;
      if (recovery) entry.recoveryUses += 1;
      entry.promptIds.add(promptId);
      const source = retrievalSource(track, row);
      entry.sources.set(source, (entry.sources.get(source) ?? 0) + 1);
      usage.set(key, entry);
    });
  }

  const top = [...usage.values()]
    .sort((a, b) => b.uses - a.uses || b.openerUses - a.openerUses)
    .slice(0, 20);

  const lines: string[] = [
    "# Top Track Overlap Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Source: ${reportPath}`,
    `Playlists analysed: ${rows.filter((r) => r.ok).length}`,
    "",
    "| Track | Uses | First track? | Recovery? | Retrieval source |",
    "|-------|------|--------------|-----------|------------------|",
  ];

  for (const row of top) {
    const topSource = [...row.sources.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
    lines.push(
      `| ${row.label.replace(/\|/g, "/")} | ${row.uses} | ${row.openerUses} | ${row.recoveryUses} | ${topSource.replace(/\|/g, "/")} |`,
    );
  }

  lines.push("");
  lines.push("## Interpretation hints");
  lines.push("");
  lines.push("- High **First track?** counts → opener election / activity lock gravity.");
  lines.push("- High **Recovery?** counts → repair/fallback path reusing the same safe tracks.");
  lines.push("- Repeated **lane:** tags → retrieval quota or lane sampling collapse.");
  lines.push("- **blended_intent_pool** in source → compound strict rescue path.");

  const md = `${lines.join("\n")}\n`;
  await mkdir(outDir, { recursive: true });
  const mdPath = path.join(outDir, "TOP-TRACK-OVERLAP.md");
  const jsonPath = path.join(outDir, "top-track-overlap.json");
  await writeFile(mdPath, md, "utf8");
  await writeFile(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    playlistsAnalysed: rows.filter((r) => r.ok).length,
    top: top.map((row) => ({
      track: row.label,
      uses: row.uses,
      openerUses: row.openerUses,
      recoveryUses: row.recoveryUses,
      playlistCount: row.promptIds.size,
      topRetrievalSource: [...row.sources.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown",
      sources: Object.fromEntries(row.sources),
    })),
  }, null, 2), "utf8");

  process.stdout.write(`${md}\nWrote ${mdPath}\nWrote ${jsonPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
