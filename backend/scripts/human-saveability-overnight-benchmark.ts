/**
 * Overnight human saveability benchmark — production API, 5 seeds per prompt.
 *
 * Usage: npm run benchmark:human-saveability-overnight
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveVerifiedProductionCredentials,
  EXPECTED_EVAL_TOKEN_LENGTH,
} from "../lib/benchmark-env";
import { normalizeEvalToken } from "../lib/eval-token-normalize";

const SEEDS = [1, 2, 3, 4, 5];
const REPORT_DIR = path.resolve(process.cwd(), "reports");
const REPORT_PATH = path.join(REPORT_DIR, "human-saveability-overnight.json");

const PROMPTS: Array<{ id: string; prompt: string }> = [
  { id: "summer_morning", prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work." },
  { id: "rainy_walk", prompt: "rainy city morning walk with reflective mood" },
  { id: "cozy_sunday", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "late_night", prompt: "late night feeling" },
  { id: "sunset_drive", prompt: "driving at sunset with open windows and golden light" },
  { id: "optimistic_commute", prompt: "optimistic commute to work with forward energy" },
  { id: "study_session", prompt: "music for thinking and study session focus" },
  { id: "gym_boost", prompt: "gym confidence boost high energy workout" },
];

type RunRow = {
  promptId: string;
  prompt: string;
  seed: number;
  ok: boolean;
  humanSaveable: boolean;
  curatorScore: number | null;
  rejectionReasons: string[];
  retriesUsed: number | null;
  error: string | null;
  trackCount: number;
  firstTen: string[];
};

async function generateRun(
  baseUrl: string,
  token: string,
  spotifyUserId: string,
  item: { id: string; prompt: string },
  seed: number,
): Promise<RunRow> {
  const row: RunRow = {
    promptId: item.id,
    prompt: item.prompt,
    seed,
    ok: false,
    humanSaveable: false,
    curatorScore: null,
    rejectionReasons: [],
    retriesUsed: null,
    error: null,
    trackCount: 0,
    firstTen: [],
  };

  try {
    const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": token,
      },
      body: JSON.stringify({
        vibe: item.prompt,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId,
        requestId: `overnight-human-save-${item.id}-seed-${seed}`,
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      row.error = String(data.message ?? data.error ?? data.code ?? res.status);
      const gate = (data.humanSaveabilityGate ?? {}) as Record<string, unknown>;
      if (Object.keys(gate).length > 0) {
        row.ok = true;
        row.humanSaveable = false;
        row.curatorScore = typeof gate.curatorScore === "number" ? gate.curatorScore : null;
        row.retriesUsed = typeof gate.retriesUsed === "number" ? gate.retriesUsed : null;
        row.rejectionReasons = Array.isArray(gate.rejectionReasons)
          ? gate.rejectionReasons.map(String)
          : [row.error];
        row.error = null;
      }
      return row;
    }
    const tracks = Array.isArray(data.tracks) ? data.tracks as Array<Record<string, unknown>> : [];
    row.trackCount = tracks.length;
    row.firstTen = tracks.slice(0, 10).map((t) =>
      `${t.trackName ?? t.name} — ${t.artistName ?? t.artist}`,
    );
    const diagnostics = (data.diagnostics ?? data.generationDiagnostics ?? {}) as Record<string, unknown>;
    const v3 = (diagnostics.v3Pipeline ?? {}) as Record<string, unknown>;
    const gate = (v3.humanSaveabilityGate ?? {}) as Record<string, unknown>;
    row.humanSaveable = gate.humanSaveable === true || gate.passed === true;
    row.curatorScore = typeof gate.curatorScore === "number" ? gate.curatorScore : null;
    row.retriesUsed = typeof gate.retriesUsed === "number" ? gate.retriesUsed : null;
    row.rejectionReasons = Array.isArray(gate.rejectionReasons)
      ? gate.rejectionReasons.map(String)
      : [];
    row.ok = tracks.length > 0;
    return row;
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
    return row;
  }
}

async function main(): Promise<void> {
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const token = normalizeEvalToken(creds.token);
  if (token.length !== EXPECTED_EVAL_TOKEN_LENGTH) {
    throw new Error(`PLAYLIST_EVAL_TOKEN length must be ${EXPECTED_EVAL_TOKEN_LENGTH}`);
  }

  const results: RunRow[] = [];
  for (const item of PROMPTS) {
    for (const seed of SEEDS) {
      process.stdout.write(`RUN ${item.id} seed=${seed}\n`);
      const row = await generateRun(creds.baseUrl, token, creds.spotifyUserId, item, seed);
      results.push(row);
      process.stdout.write(
        row.ok
          ? `  ${row.humanSaveable ? "PASS" : "FAIL"} curator=${row.curatorScore ?? "n/a"}\n`
          : `  ERROR ${row.error}\n`,
      );
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const successful = results.filter((r) => r.ok);
  const humanSaveable = successful.filter((r) => r.humanSaveable);
  const reasonCounts = new Map<string, number>();
  for (const row of successful.filter((r) => !r.humanSaveable)) {
    for (const reason of row.rejectionReasons.length ? row.rejectionReasons : ["unspecified"]) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  const byPrompt = new Map<string, { pass: number; total: number }>();
  for (const row of successful) {
    const cur = byPrompt.get(row.promptId) ?? { pass: 0, total: 0 };
    cur.total += 1;
    if (row.humanSaveable) cur.pass += 1;
    byPrompt.set(row.promptId, cur);
  }
  const worstPrompts = [...byPrompt.entries()]
    .map(([promptId, stats]) => ({
      promptId,
      passRate: stats.total > 0 ? stats.pass / stats.total : 0,
      pass: stats.pass,
      total: stats.total,
    }))
    .sort((a, b) => a.passRate - b.passRate)
    .slice(0, 10);

  const summary = {
    totalRuns: results.length,
    apiSuccessRuns: successful.length,
    humanSaveableRuns: humanSaveable.length,
    humanSaveablePct: successful.length > 0
      ? Math.round((humanSaveable.length / successful.length) * 1000) / 1000
      : 0,
    worstPrompts,
    topRejectionReasons: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([reason, count]) => ({ reason, count })),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: creds.baseUrl,
    summary,
    runs: results,
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  process.stdout.write(`\nWrote ${REPORT_PATH}\n`);
  process.stdout.write(JSON.stringify(summary, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
