/**
 * Test: "Sampling is not losing too many candidates"
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const PROMPTS = [
  "party-latin-summer",
  "drive-late-garage",
  "gym-2000s-pop-punk",
  "chill-acoustic",
  "party-70s-disco",
  "launch-calibration-003",
] as const;

function repoRoot(): string {
  for (const up of [2, 3]) {
    const c = path.resolve(__dirname, ...Array(up).fill(".."));
    if (existsSync(path.join(c, "package.json"))) return c;
  }
  return path.resolve(__dirname, "..", "..", "..");
}

const ROOT = repoRoot();
const OUT = path.join(ROOT, "reports", "playlist-evaluation", "sampling-assumption-test.json");

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

type Funnel = {
  promptId: string;
  requested: number;
  final: number;
  underfilled: boolean;
  initialLibrary: number | null;
  sampled: number | null;
  classified: number | null;
  afterIntent: number | null;
  afterRanking: number | null;
  afterDiversity: number | null;
  afterRepair: number | null;
  strictValid: number | null;
  relaxedValid: number | null;
  largestDropStage: string | null;
  largestDropCount: number | null;
  deliveryStages: Array<{ stage: string; enter?: number; exit: number; lost: number }>;
  hybridPoolCap: number | null;
  samplingRetentionPct: number | null;
  v3ExitVsRequested: number | null;
  postV3Loss: number | null;
  verdict: "sampling_bind" | "sampling_ok" | "not_sampling" | "mixed";
  notes: string[];
};

async function main(): Promise<void> {
  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const token = env.match(/^PLAYLIST_EVAL_TOKEN=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";
  const user = env.match(/^SMOKE_SPOTIFY_USER_ID=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";

  for (const hp of ["/api/healthz", "/healthz"]) {
    try {
      const h = await fetch(`http://localhost:5000${hp}`, { signal: AbortSignal.timeout(5000) });
      if (h.ok) break;
    } catch {
      if (hp === "/healthz") throw new Error("API not running");
    }
  }

  const funnels: Funnel[] = [];

  for (const id of PROMPTS) {
    const p = PLAYLIST_BENCHMARK_PROMPTS.find((x) => x.id === id)!;
    process.stderr.write(`[sampling-test] ${id}\n`);
    const res = await fetch("http://localhost:5000/api/generate?audit=1", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kwalify-evaluation-token": token },
      body: JSON.stringify({
        vibe: p.prompt,
        mode: p.mode,
        length: p.length,
        auditMode: true,
        debug: true,
        debugPipeline: true,
        spotifyUserId: user,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const d = asRecord(await res.json()) ?? {};
    const gd = asRecord(d.generationDiagnostics) ?? {};
    const ret = asRecord(gd.candidateRetrieval) ?? {};
    const orch = asRecord(ret.orchestrator) ?? {};
    const supply = asRecord(orch.validCandidateSupply) ?? {};
    const scoring = asRecord(gd.scoringPool) ?? asRecord((gd.waterfall as unknown)) ?? {};
    const scoringPool = asRecord(gd.scoringPoolDiagnostics) ?? {};
    const largest = asRecord(gd.largestDrop) ?? {};
    const du = asRecord(gd.deliveryUnderfillForensics) ?? {};
    const stages = Array.isArray(du.stages)
      ? (du.stages as Array<Record<string, unknown>>).map((s) => ({
        stage: txt(s.stage) ?? "?",
        enter: num(s.enter) ?? undefined,
        exit: num(s.exit) ?? 0,
        lost: num(s.lost) ?? 0,
      }))
      : [];

    const requested = p.length ?? 30;
    const final = num(d.count) ?? 0;
    const initial = num(gd.initialLibrarySize);
    const sampled = num(gd.candidatesSampled);
    const classified = num(gd.candidatesClassified);
    const afterDiversity = num(gd.candidatesAfterDiversity);
    const relaxed = num(supply.relaxedValidCount);
    const strict = num(supply.strictValidCount);

    const notes: string[] = [];
    let verdict: Funnel["verdict"] = "mixed";

    const samplingRetentionPct = initial != null && sampled != null && initial > 0
      ? (sampled / initial) * 100
      : null;

    const v3ExitVsRequested = afterDiversity != null ? afterDiversity / requested : null;
    const postV3Loss = afterDiversity != null ? afterDiversity - final : null;

    const largestStage = txt(largest.stage) ?? txt(largest.name);
    const largestCount = num(largest.drop) ?? num(largest.count) ?? num(largest.lost);

    // Heuristic verdict
    const hybridCap = num(scoringPool.hybridPoolCap) ?? num(scoringPool.cap);
    const minNeeded = Math.max(5, Math.ceil(requested * 0.67));
    const underfilled = final < minNeeded;

    if (!underfilled && (sampled ?? 0) >= requested * 3) {
      verdict = "sampling_ok";
      notes.push(`Hybrid pool (${sampled}) >> requested (${requested}); sampling not binding.`);
    }

    if (underfilled && classified != null && classified < minNeeded && (sampled ?? 0) >= minNeeded * 5) {
      verdict = "not_sampling";
      notes.push(`classified=${classified} << sampled=${sampled}; loss is pre-scoring classification/filters not hybrid cap.`);
    }

    if (underfilled && (sampled ?? 0) < relaxed! * 0.01 && relaxed != null && relaxed > requested * 10) {
      verdict = "sampling_bind";
      notes.push(`sampled=${sampled} vs relaxedValid=${relaxed}; hybrid cap may exclude intent-relevant headroom.`);
    }

    const deliveryBiggest = [...stages].sort((a, b) => b.lost - a.lost)[0];
    if (deliveryBiggest && deliveryBiggest.lost > requested && !deliveryBiggest.stage.includes("pipeline_exit")) {
      notes.push(`Largest post-V3 loss: ${deliveryBiggest.stage} lost=${deliveryBiggest.lost}`);
      if (verdict === "mixed") verdict = "not_sampling";
    }

    if (largestStage && /genre|evidence|era|finalize|recovery/i.test(largestStage)) {
      notes.push(`Waterfall largestDrop at ${largestStage} (${largestCount ?? "?"}) — not sampling.`);
      if (underfilled && verdict === "mixed") verdict = "not_sampling";
    }

    if (v3ExitVsRequested != null && v3ExitVsRequested >= 0.8 && !underfilled) {
      notes.push(`V3 exit ${afterDiversity} ≈ target; diversity stage is sizing not accidental loss.`);
    }

    funnels.push({
      promptId: id,
      requested,
      final,
      underfilled,
      initialLibrary: initial,
      sampled,
      classified,
      afterIntent: num(gd.candidatesAfterIntent),
      afterRanking: num(gd.candidatesAfterRanking),
      afterDiversity,
      afterRepair: num(gd.candidatesAfterRepair),
      strictValid: strict,
      relaxedValid: relaxed,
      largestDropStage: largestStage,
      largestDropCount: largestCount,
      deliveryStages: stages,
      hybridPoolCap: hybridCap,
      samplingRetentionPct,
      v3ExitVsRequested,
      postV3Loss,
      verdict,
      notes,
    });
  }

  const samplingBind = funnels.filter((f) => f.verdict === "sampling_bind");
  const notSampling = funnels.filter((f) => f.verdict === "not_sampling" || f.verdict === "sampling_ok");
  const underfilled = funnels.filter((f) => f.underfilled);

  const assumptionFalsified =
    samplingBind.length > 0 ||
    (underfilled.length > 0 && underfilled.every((f) => f.verdict !== "sampling_ok"));

  const report = {
    generatedAt: new Date().toISOString(),
    assumption: "Sampling is not losing too many candidates",
    falsified: assumptionFalsified,
    summary: {
      sampling_bind: samplingBind.length,
      sampling_ok: funnels.filter((f) => f.verdict === "sampling_ok").length,
      not_sampling: funnels.filter((f) => f.verdict === "not_sampling").length,
      underfilled: underfilled.length,
    },
    funnels,
    interpretation: assumptionFalsified
      ? "FALSIFIED or PARTIALLY FALSE — hybrid sampling and/or pre-scoring filters discard intent-relevant supply on thin prompts; on healthy prompts sampling is intentionally sized."
      : "HOLDS — hybrid pool retains sufficient headroom vs requested length on tested prompts.",
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2), "utf8");
  await writeFile(
    path.join(ROOT, "reports", "playlist-evaluation", "sampling-assumption-test.md"),
    buildMd(report),
    "utf8",
  );
  console.log(JSON.stringify({ falsified: report.falsified, summary: report.summary }, null, 2));
}

function buildMd(report: { falsified: boolean; summary: Record<string, number>; funnels: Funnel[]; interpretation: string }): string {
  return [
    "# Sampling Assumption Test",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `**Assumption:** Sampling is not losing too many candidates`,
    "",
    `**Falsified:** ${report.falsified ? "yes (partially or fully)" : "no"}`,
    "",
    "## Summary",
    "",
    `| Metric | Count |`,
    `|--------|------:|`,
    ...Object.entries(report.summary).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Funnel table",
    "",
    "| Prompt | lib | sampled | classified | ranking | V3 out | final | relaxedValid | verdict |",
    "|--------|----:|--------:|-----------:|--------:|-------:|------:|-------------:|---------|",
    ...report.funnels.map((f) =>
      `| ${f.promptId} | ${f.initialLibrary ?? "—"} | ${f.sampled ?? "—"} | ${f.classified ?? "—"} | ${f.afterRanking ?? "—"} | ${f.afterDiversity ?? "—"} | ${f.final} | ${f.relaxedValid ?? "—"} | ${f.verdict} |`,
    ),
    "",
    "## Per-prompt notes",
    "",
    ...report.funnels.flatMap((f) => [
      `### ${f.promptId}`,
      ...f.notes.map((n) => `- ${n}`),
      f.largestDropStage ? `- Waterfall largestDrop: \`${f.largestDropStage}\` (${f.largestDropCount ?? "?"})` : "",
      f.deliveryStages.length
        ? `- Post-V3 stages: ${f.deliveryStages.map((s) => `${s.stage} lost=${s.lost}`).join("; ")}`
        : "",
      "",
    ]),
    "## Interpretation",
    "",
    report.interpretation,
  ].join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
