/**
 * Dominant-cluster funnel investigation — stage-by-stage candidate counts for soft prompts.
 *
 * Usage: npm run investigate:dominant-cluster-funnel
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveVerifiedProductionCredentials } from "../lib/benchmark-env";

const SEEDS = [1, 2, 3, 4, 5];
const REPORT_DIR = path.resolve(process.cwd(), "reports");
const REPORT_PATH = path.join(REPORT_DIR, "dominant-cluster-funnel-investigation.json");

const SOFT_PROMPTS: Array<{ id: string; prompt: string }> = [
  { id: "summer_morning", prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work." },
  { id: "rainy_walk", prompt: "rainy city morning walk with reflective mood" },
  { id: "cozy_sunday", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "late_night", prompt: "late night feeling" },
  { id: "sunset_drive", prompt: "driving at sunset with open windows and golden light" },
  { id: "optimistic_commute", prompt: "optimistic commute to work with forward energy" },
];

type FunnelRow = {
  promptId: string;
  prompt: string;
  seed: number;
  ok: boolean;
  humanSaveable: boolean;
  error: string | null;
  dominantCluster: string | null;
  dominantClusterId: string | null;
  dominantClusterShifted: boolean | null;
  earliestCollapseStage: string | null;
  retrievalDominantFilterApplied: boolean | null;
  worldLockedFromFullLibrary: boolean | null;
  counts: Record<string, number> | null;
  rejectionReasons: string[];
  pipelineStageResponsible: string | null;
};

function extractFunnel(data: Record<string, unknown>): Record<string, unknown> | null {
  const gate = (data.humanSaveabilityGate ?? {}) as Record<string, unknown>;
  const direct = gate.sceneClusterFunnel;
  if (direct && typeof direct === "object") return direct as Record<string, unknown>;
  const attribution = (gate.attribution ?? {}) as Record<string, unknown>;
  const fromAttr = attribution.sceneClusterFunnel;
  if (fromAttr && typeof fromAttr === "object") return fromAttr as Record<string, unknown>;
  const diagnostics = (data.diagnostics ?? data.generationDiagnostics ?? {}) as Record<string, unknown>;
  const v3 = (diagnostics.v3Pipeline ?? {}) as Record<string, unknown>;
  const fromV3 = v3.sceneClusterFunnel;
  if (fromV3 && typeof fromV3 === "object") return fromV3 as Record<string, unknown>;
  return null;
}

async function runPrompt(
  baseUrl: string,
  token: string,
  spotifyUserId: string,
  item: { id: string; prompt: string },
  seed: number,
): Promise<FunnelRow> {
  const row: FunnelRow = {
    promptId: item.id,
    prompt: item.prompt,
    seed,
    ok: false,
    humanSaveable: false,
    error: null,
    dominantCluster: null,
    dominantClusterId: null,
    dominantClusterShifted: null,
    earliestCollapseStage: null,
    retrievalDominantFilterApplied: null,
    worldLockedFromFullLibrary: null,
    counts: null,
    rejectionReasons: [],
    pipelineStageResponsible: null,
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
        requestId: `funnel-investigate-${item.id}-seed-${seed}`,
        seed,
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    const funnel = extractFunnel(data);
    if (funnel) {
      row.dominantCluster = typeof funnel.dominantClusterLabel === "string" ? funnel.dominantClusterLabel : null;
      row.dominantClusterId = typeof funnel.dominantClusterId === "string" ? funnel.dominantClusterId : null;
      row.dominantClusterShifted = typeof funnel.dominantClusterShifted === "boolean" ? funnel.dominantClusterShifted : null;
      row.earliestCollapseStage = typeof funnel.earliestCollapseStage === "string" ? funnel.earliestCollapseStage : null;
      row.retrievalDominantFilterApplied = typeof funnel.retrievalDominantFilterApplied === "boolean"
        ? funnel.retrievalDominantFilterApplied
        : null;
      row.worldLockedFromFullLibrary = typeof funnel.worldLockedFromFullLibrary === "boolean"
        ? funnel.worldLockedFromFullLibrary
        : null;
      row.counts = funnel.counts && typeof funnel.counts === "object"
        ? funnel.counts as Record<string, number>
        : null;
    }

    if (!res.ok) {
      row.error = String(data.message ?? data.error ?? data.code ?? res.status);
      const gate = (data.humanSaveabilityGate ?? {}) as Record<string, unknown>;
      if (Object.keys(gate).length > 0) {
        row.ok = true;
        row.rejectionReasons = Array.isArray(gate.rejectionReasons)
          ? gate.rejectionReasons.map(String)
          : [row.error];
        const attribution = (gate.attribution ?? {}) as Record<string, unknown>;
        row.pipelineStageResponsible = typeof attribution.stageResponsible === "string"
          ? attribution.stageResponsible
          : null;
        row.error = null;
      }
      return row;
    }

    const diagnostics = (data.diagnostics ?? data.generationDiagnostics ?? {}) as Record<string, unknown>;
    const v3 = (diagnostics.v3Pipeline ?? {}) as Record<string, unknown>;
    const gate = (v3.humanSaveabilityGate ?? {}) as Record<string, unknown>;
    row.humanSaveable = gate.humanSaveable === true || gate.passed === true;
    row.rejectionReasons = Array.isArray(gate.rejectionReasons)
      ? gate.rejectionReasons.map(String)
      : [];
    row.ok = true;
    return row;
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
    return row;
  }
}

async function main(): Promise<void> {
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const rows: FunnelRow[] = [];
  for (const item of SOFT_PROMPTS) {
    for (const seed of SEEDS) {
      process.stdout.write(`funnel ${item.id} seed=${seed}... `);
      const row = await runPrompt(creds.baseUrl, creds.token, creds.spotifyUserId, item, seed);
      rows.push(row);
      process.stdout.write(`${row.earliestCollapseStage ?? "n/a"} dominant=${row.dominantCluster ?? "?"}\n`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const collapseByStage = new Map<string, number>();
  let shiftedCount = 0;
  let filterAppliedCount = 0;
  for (const row of rows) {
    if (row.earliestCollapseStage) {
      collapseByStage.set(row.earliestCollapseStage, (collapseByStage.get(row.earliestCollapseStage) ?? 0) + 1);
    }
    if (row.dominantClusterShifted) shiftedCount++;
    if (row.retrievalDominantFilterApplied) filterAppliedCount++;
  }

  const summary = {
    runs: rows.length,
    apiOk: rows.filter((r) => r.ok).length,
    humanSaveable: rows.filter((r) => r.humanSaveable).length,
    dominantClusterShifted: shiftedCount,
    retrievalDominantFilterApplied: filterAppliedCount,
    earliestCollapseByStage: Object.fromEntries(collapseByStage.entries()),
    hypothesisSupported: shiftedCount > rows.length * 0.3,
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2));
  process.stdout.write(`\nWrote ${REPORT_PATH}\n`);
  process.stdout.write(JSON.stringify(summary, null, 2));
  process.stdout.write("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
