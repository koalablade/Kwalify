/**
 * Extract evidence for scoring-root-cause-forensics.md
 * Usage: npx tsx backend/scripts/scoring-root-cause-forensics.ts
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const SOURCES = [
  "reports/playlist-evaluation/scoring-stage1-after/evaluation-report.json",
  "reports/playlist-evaluation/contextual-uniqueness-after/evaluation-report.json",
  "reports/playlist-evaluation/session-artist-gravity-after/evaluation-report.json",
  "reports/playlist-evaluation/live-6h/evaluation-report.json",
  "reports/playlist-evaluation/post-audio-features-baseline-2026-07-07/evaluation-results.jsonl",
];

const TARGETS = [
  { key: "laurindo", patterns: ["laurindo"] },
  { key: "tame", patterns: ["tame impala"] },
  { key: "fleetwood", patterns: ["fleetwood mac"] },
  { key: "fred", patterns: ["fred again"] },
  { key: "gnr", patterns: ["guns n roses", "guns n roses", "gnr"] },
  { key: "paramore", patterns: ["paramore"] },
] as const;

type RawRow = {
  ok?: boolean;
  benchmark?: { id?: string; category?: string };
  response?: {
    tracks?: Array<Record<string, unknown>>;
    generationDiagnostics?: Record<string, unknown>;
    playlistConfidence?: { recoveryUsed?: boolean };
  };
};

function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function matchArtist(artist: unknown): string | null {
  const n = norm(String(artist ?? ""));
  for (const t of TARGETS) {
    if (t.patterns.some((p) => n.includes(norm(p)) || norm(p).includes(n))) return t.key;
  }
  return null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function loadRows(file: string): Promise<RawRow[]> {
  const raw = await readFile(path.join(ROOT, file), "utf8");
  if (file.endsWith(".jsonl")) {
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RawRow);
  }
  const j = JSON.parse(raw) as { rawResults?: RawRow[] };
  return j.rawResults ?? [];
}

async function main(): Promise<void> {
  const analysis: Record<string, unknown> = { sources: {} };
  const sources = analysis.sources as Record<string, unknown>;

  for (const src of SOURCES) {
    try {
      const rows = (await loadRows(src)).filter((r) => (r.response?.tracks?.length ?? 0) > 0);
      const trackOcc: Array<Record<string, unknown>> = [];
      const scoreGaps: Array<Record<string, unknown>> = [];
      const why = new Map<string, number>();
      const categories = new Map<string, number>();
      const noveltyPen: Array<Record<string, unknown>> = [];
      const cupPen: Array<Record<string, unknown>> = [];
      const rediscovery: number[] = [];
      const lanes = new Map<string, number>();
      let recoveryPlaylists = 0;
      let targetRecovery = 0;

      for (const row of rows) {
        const tracks = row.response?.tracks ?? [];
        const cat = row.benchmark?.category ?? "unknown";
        const gd = row.response?.generationDiagnostics ?? {};
        const recovery =
          row.response?.playlistConfidence?.recoveryUsed === true || gd.recoveryTriggered === true;
        if (recovery) recoveryPlaylists += 1;

        const scored = tracks
          .map((t, i) => ({
            id: txt(t.id) ?? txt(t.trackId),
            artist: txt(t.artistName) ?? txt(t.artist) ?? "",
            name: txt(t.trackName) ?? txt(t.name) ?? "",
            score: num(t.score),
            rediscovery: num(t.rediscoveryScore),
            pos: i,
            why: Array.isArray(t.whyReasons) ? (t.whyReasons as string[]) : [],
            lane: txt(t.sourceLane) ?? txt(t.laneId),
          }))
          .filter((t) => t.score != null)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        for (const t of tracks) {
          const key = matchArtist(t.artistName ?? t.artist);
          if (!key) continue;
          if (recovery) targetRecovery += 1;
          trackOcc.push({
            key,
            promptId: row.benchmark?.id,
            category: cat,
            artist: t.artistName ?? t.artist,
            name: t.trackName ?? t.name,
            trackId: t.id ?? t.trackId,
            position: tracks.indexOf(t),
            score: num(t.score),
            rediscovery: num(t.rediscoveryScore),
            recovery,
            why: Array.isArray(t.whyReasons) ? (t.whyReasons as string[])[0] : null,
            lane: txt(t.sourceLane) ?? txt(t.laneId),
          });
          categories.set(cat, (categories.get(cat) ?? 0) + 1);
          for (const w of Array.isArray(t.whyReasons) ? (t.whyReasons as string[]) : []) {
            why.set(w, (why.get(w) ?? 0) + 1);
          }
          const lane = txt(t.sourceLane) ?? txt(t.laneId);
          if (lane) lanes.set(lane, (lanes.get(lane) ?? 0) + 1);
          const rd = num(t.rediscoveryScore);
          if (rd != null) rediscovery.push(rd);
        }

        const nd = gd.noveltyDiagnostics as Record<string, unknown> | undefined;
        if (nd?.noveltyPenalty && typeof nd.noveltyPenalty === "object") {
          for (const [id, p] of Object.entries(nd.noveltyPenalty as Record<string, number>)) {
            if (typeof p === "number") noveltyPen.push({ id, penalty: p });
          }
        }
        const cup = gd.contextualUniquenessDiagnostics as Record<string, unknown> | undefined;
        if (Array.isArray(cup?.penalisedTracks)) {
          for (const e of cup.penalisedTracks as Array<Record<string, unknown>>) {
            if (typeof e.penaltyApplied === "number" && e.penaltyApplied > 0) cupPen.push(e);
          }
        }

        if (scored.length >= 6) {
          for (let i = 0; i < Math.min(3, scored.length); i += 1) {
            const winner = scored[i]!;
            const key = matchArtist(winner.artist);
            if (!key) continue;
            const alts = scored.slice(i + 1, i + 6);
            scoreGaps.push({
              promptId: row.benchmark?.id,
              category: cat,
              winner: winner.name,
              winnerScore: winner.score,
              key,
              gaps: alts.map((a) => (winner.score ?? 0) - (a.score ?? 0)),
              altArtists: alts.map((a) => a.artist),
              altScores: alts.map((a) => a.score),
            });
          }
        }
      }

      const margins = { within001: 0, within002: 0, within005: 0, within010: 0, total: 0 };
      const nearTop = { within001: 0, within002: 0, within005: 0, within010: 0, candidates: 0 };
      for (const row of rows) {
        const scores = (row.response?.tracks ?? [])
          .map((t) => num(t.score))
          .filter((s): s is number => s != null)
          .sort((a, b) => b - a);
        if (scores.length < 5) continue;
        margins.total += 1;
        const gap = scores[0]! - scores[1]!;
        if (gap <= 0.01) margins.within001 += 1;
        if (gap <= 0.02) margins.within002 += 1;
        if (gap <= 0.05) margins.within005 += 1;
        if (gap <= 0.1) margins.within010 += 1;

        const top = scores[0]!;
        nearTop.candidates += scores.length;
        for (const s of scores) {
          const d = top - s;
          if (d <= 0.01) nearTop.within001 += 1;
          if (d <= 0.02) nearTop.within002 += 1;
          if (d <= 0.05) nearTop.within005 += 1;
          if (d <= 0.1) nearTop.within010 += 1;
        }
      }

      const scoredTargets = trackOcc.filter((t) => typeof t.score === "number") as Array<{ score: number }>;
      sources[src] = {
        playlists: rows.length,
        targetOccurrences: trackOcc.length,
        byArtist: Object.fromEntries(
          TARGETS.map((t) => [t.key, trackOcc.filter((o) => o.key === t.key).length]),
        ),
        trackOcc,
        topWhyReasons: [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
        categories: [...categories.entries()].sort((a, b) => b[1] - a[1]),
        avgRediscovery: rediscovery.length
          ? rediscovery.reduce((a, b) => a + b, 0) / rediscovery.length
          : null,
        lanes: [...lanes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
        recoveryPlaylists,
        targetRecoveryOccurrences: targetRecovery,
        scoreMarginsTop1vs2: margins,
        nearTopFromWinner: nearTop,
        scoreGapExamples: scoreGaps,
        noveltyPenaltiesSample: noveltyPen.slice(0, 30),
        cupPenaltiesSample: cupPen,
        avgTargetScore:
          scoredTargets.length > 0
            ? scoredTargets.reduce((s, t) => s + t.score, 0) / scoredTargets.length
            : null,
      };
    } catch (err) {
      sources[src] = { error: String(err) };
    }
  }

  // Weight sensitivity simulation on available final scores (proxy)
  const primary = sources[SOURCES[0]!] as Record<string, unknown> | undefined;
  if (primary && !primary.error) {
    const sim = simulateWeightSensitivity(primary.scoreGapExamples as Array<Record<string, unknown>>);
    analysis.weightSensitivityProxy = sim;
  }

  await mkdir(path.join(ROOT, "reports/playlist-evaluation"), { recursive: true });
  const out = path.join(ROOT, "reports/playlist-evaluation/scoring-forensics-data.json");
  await writeFile(out, JSON.stringify(analysis, null, 2), "utf8");
  console.log("Wrote", out);
}

function simulateWeightSensitivity(
  gaps: Array<Record<string, unknown>>,
): Record<string, unknown> {
  // Proxy: emotion+embedding dominate; assume winner emotion edge ~40% of gap, embedding ~50%, rest 10%
  const results: Record<string, number> = { emotion10: 0, embedding5: 0, embedding10: 0, embedding20: 0, noveltyDouble: 0, rediscoveryHalf: 0 };
  for (const row of gaps) {
    const gapsArr = row.gaps as number[];
    if (!gapsArr?.length) continue;
    const minGap = Math.min(...gapsArr);
    const winnerScore = row.winnerScore as number;
    // Would alt overtake if we reduced winner by X% of emotion channel (~10% of score)?
    const emotionContrib = winnerScore * 0.1;
    if (minGap < emotionContrib * 0.05) results.emotion10 += 1;
    if (minGap < winnerScore * 0.05 * 0.5) results.embedding5 += 1;
    if (minGap < winnerScore * 0.6 * 0.1) results.embedding10 += 1;
    if (minGap < winnerScore * 0.6 * 0.2) results.embedding20 += 1;
    if (minGap < 0.09) results.noveltyDouble += 1;
    if (minGap < 0.12) results.rediscoveryHalf += 1;
  }
  return { cases: gaps.length, flipsEstimated: results };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
