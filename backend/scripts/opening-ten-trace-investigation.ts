/**
 * Opening-10 trace — first 10 tracks only for failed soft prompts.
 *
 * Usage: npm run investigate:opening-ten-trace
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveVerifiedProductionCredentials } from "../lib/benchmark-env";

const SEEDS = [1, 2, 3, 4, 5];
const REPORT_PATH = path.resolve(process.cwd(), "reports", "opening-ten-trace-investigation.json");

const SOFT_PROMPTS: Array<{ id: string; prompt: string }> = [
  { id: "rainy_walk", prompt: "rainy city morning walk with reflective mood" },
  { id: "cozy_sunday", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "optimistic_commute", prompt: "optimistic commute to work with forward energy" },
];

type TraceRow = {
  promptId: string;
  seed: number;
  ok: boolean;
  humanSaveable: boolean;
  dominantCluster: string | null;
  preSamplerPreviewPurity: number | null;
  postInterleaverPurity: number | null;
  interleaverPreEmotionalPurity: number | null;
  interleaverPostEmotionalPurity: number | null;
  meetsOpeningTarget: boolean | null;
  identityLostAt: "sampler" | "interleaver_merge" | "interleaver_emotional_flow" | "none" | "unknown";
  openingTen: Array<Record<string, unknown>>;
};

function extractOpeningTen(data: Record<string, unknown>): Record<string, unknown> | null {
  const gate = (data.humanSaveabilityGate ?? {}) as Record<string, unknown>;
  const direct = gate.openingTenDominantCluster ?? (gate.attribution as Record<string, unknown> | undefined)?.openingTenDominantCluster;
  if (direct && typeof direct === "object") return direct as Record<string, unknown>;
  const diagnostics = (data.diagnostics ?? data.generationDiagnostics ?? {}) as Record<string, unknown>;
  const v3 = (diagnostics.v3Pipeline ?? {}) as Record<string, unknown>;
  const fromV3 = v3.openingTenDominantCluster;
  if (fromV3 && typeof fromV3 === "object") return fromV3 as Record<string, unknown>;
  return null;
}

function inferLossStage(opening: Record<string, unknown>): TraceRow["identityLostAt"] {
  const interleaver = (opening.interleaver ?? {}) as Record<string, unknown>;
  const preSampler = typeof opening.preInterleaverSamplerPreviewPurity === "number"
    ? opening.preInterleaverSamplerPreviewPurity
    : null;
  const preEmotional = typeof interleaver.preEmotionalFlowPurity === "number"
    ? interleaver.preEmotionalFlowPurity
    : null;
  const postEmotional = typeof interleaver.postEmotionalFlowPurity === "number"
    ? interleaver.postEmotionalFlowPurity
    : null;
  const target = 0.9;
  if (preSampler != null && preSampler < target) return "sampler";
  if (preEmotional != null && preEmotional < target) return "interleaver_merge";
  if (postEmotional != null && postEmotional < target) return "interleaver_emotional_flow";
  if (typeof opening.postInterleaverPurity === "number" && opening.postInterleaverPurity >= target) return "none";
  return "unknown";
}

async function runPrompt(
  baseUrl: string,
  token: string,
  spotifyUserId: string,
  item: { id: string; prompt: string },
  seed: number,
): Promise<TraceRow> {
  const row: TraceRow = {
    promptId: item.id,
    seed,
    ok: false,
    humanSaveable: false,
    dominantCluster: null,
    preSamplerPreviewPurity: null,
    postInterleaverPurity: null,
    interleaverPreEmotionalPurity: null,
    interleaverPostEmotionalPurity: null,
    meetsOpeningTarget: null,
    identityLostAt: "unknown",
    openingTen: [],
  };

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
      requestId: `opening-ten-trace-${item.id}-seed-${seed}`,
      seed,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  const opening = extractOpeningTen(data);
  if (opening) {
    row.preSamplerPreviewPurity = typeof opening.preInterleaverSamplerPreviewPurity === "number"
      ? opening.preInterleaverSamplerPreviewPurity
      : null;
    row.postInterleaverPurity = typeof opening.postInterleaverPurity === "number"
      ? opening.postInterleaverPurity
      : null;
    const interleaver = (opening.interleaver ?? {}) as Record<string, unknown>;
    row.interleaverPreEmotionalPurity = typeof interleaver.preEmotionalFlowPurity === "number"
      ? interleaver.preEmotionalFlowPurity
      : null;
    row.interleaverPostEmotionalPurity = typeof interleaver.postEmotionalFlowPurity === "number"
      ? interleaver.postEmotionalFlowPurity
      : null;
    row.meetsOpeningTarget = typeof interleaver.meetsTarget === "boolean"
      ? interleaver.meetsTarget
      : (row.postInterleaverPurity != null ? row.postInterleaverPurity >= 0.9 : null);
    row.openingTen = Array.isArray(opening.trace) ? opening.trace as Array<Record<string, unknown>> : [];
    row.identityLostAt = inferLossStage(opening);
    const gate = (data.humanSaveabilityGate ?? {}) as Record<string, unknown>;
    row.dominantCluster = typeof gate.dominantCluster === "string"
      ? gate.dominantCluster
      : null;
  }

  if (!res.ok) {
    row.ok = Object.keys((data.humanSaveabilityGate ?? {}) as object).length > 0;
    return row;
  }
  const diagnostics = (data.diagnostics ?? data.generationDiagnostics ?? {}) as Record<string, unknown>;
  const v3 = (diagnostics.v3Pipeline ?? {}) as Record<string, unknown>;
  const gate = (v3.humanSaveabilityGate ?? {}) as Record<string, unknown>;
  row.humanSaveable = gate.humanSaveable === true || gate.passed === true;
  row.ok = true;
  return row;
}

async function main(): Promise<void> {
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const rows: TraceRow[] = [];
  for (const item of SOFT_PROMPTS) {
    for (const seed of SEEDS) {
      process.stdout.write(`trace ${item.id} seed=${seed}... `);
      const row = await runPrompt(creds.baseUrl, creds.token, creds.spotifyUserId, item, seed);
      rows.push(row);
      process.stdout.write(`${row.identityLostAt} purity=${row.postInterleaverPurity ?? "n/a"}\n`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const lossCounts = new Map<string, number>();
  for (const row of rows) {
    lossCounts.set(row.identityLostAt, (lossCounts.get(row.identityLostAt) ?? 0) + 1);
  }
  const summary = {
    runs: rows.length,
    meetsOpeningTarget: rows.filter((r) => r.meetsOpeningTarget === true).length,
    identityLostAt: Object.fromEntries(lossCounts.entries()),
    avgPostInterleaverPurity: rows
      .filter((r) => r.postInterleaverPurity != null)
      .reduce((sum, r) => sum + (r.postInterleaverPurity ?? 0), 0) /
      Math.max(1, rows.filter((r) => r.postInterleaverPurity != null).length),
  };

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2));
  process.stdout.write(`\nWrote ${REPORT_PATH}\n${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
