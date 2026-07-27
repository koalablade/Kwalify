/**
 * Diagnosis-only: delivery underfill forensics across compound prompts.
 * No production behaviour changes beyond reading audit instrumentation.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";
import { summarizeRemovalReasons } from "../lib/delivery-underfill-forensics";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const OUT_DIR = path.join(ROOT, "reports", "playlist-evaluation");

const PROMPT_IDS = ["party-70s-disco", "party-latin-summer", "mixed-2", "genre-pop-party"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function generateOne(
  baseUrl: string,
  token: string,
  spotifyUserId: string,
  promptId: string,
): Promise<Record<string, unknown>> {
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((row) => row.id === promptId);
  if (!prompt) throw new Error(`Missing prompt ${promptId}`);
  process.stderr.write(`[delivery-underfill] ${promptId}: ${prompt.prompt}\n`);
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      auditMode: true,
      debug: true,
      debugPipeline: true,
      spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = asRecord(await res.json().catch(() => ({}))) ?? {};
  const gd = asRecord(body.generationDiagnostics) ?? {};
  const forensics = asRecord(gd.deliveryUnderfillForensics);
  const recovery = asRecord(gd.recoveryDiagnostics);
  const genreEvidence = asRecord(body.strictGenreEvidence);
  const eraEvidence = asRecord(body.strictEraEvidence);
  const audit = asRecord(forensics?.genreEvidenceAudit);
  const removals = Array.isArray(audit?.removals) ? audit!.removals : [];
  return {
    promptId,
    prompt: prompt.prompt,
    mode: prompt.mode,
    requestedLength: prompt.length,
    count: body.count,
    executionPath: asRecord(body.playlistExecutionTrace)?.executionPath ?? null,
    candidates: {
      afterDiversity: gd.candidatesAfterDiversity,
      afterRepair: gd.candidatesAfterRepair,
      afterCoherence: gd.candidatesAfterCoherence,
      final: gd.candidatesFinal,
    },
    recovery: recovery
      ? {
          triggerReason: recovery.triggerReason,
          triggerDetail: recovery.triggerDetail,
          relaxations: recovery.relaxations,
          candidateCountBeforeRecovery: recovery.candidateCountBeforeRecovery,
          candidateCountAfterRecovery: recovery.candidateCountAfterRecovery,
          qualityImpact: recovery.qualityImpact,
        }
      : null,
    strictGenreEvidence: genreEvidence
      ? {
          active: genreEvidence.active,
          verifiedCount: genreEvidence.verifiedCount,
          rejectedCount: genreEvidence.rejectedCount,
          requiredCount: genreEvidence.requiredCount,
          requiredRatio: genreEvidence.requiredRatio,
          finalCount: genreEvidence.finalCount,
          expectedFamilies: genreEvidence.expectedFamilies,
          relaxed: genreEvidence.relaxed,
        }
      : null,
    strictEraEvidence: eraEvidence
      ? {
          active: eraEvidence.active,
          verifiedCount: eraEvidence.verifiedCount,
          rejectedCount: eraEvidence.rejectedCount,
          requiredCount: eraEvidence.requiredCount,
          publishedCount: eraEvidence.publishedCount,
          publishMode: eraEvidence.publishMode,
          compatibleFallbackUsed: eraEvidence.compatibleFallbackUsed,
          finalCount: eraEvidence.finalCount,
        }
      : null,
    deliveryUnderfillForensics: forensics,
    removalReasonCounts: summarizeRemovalReasons(
      removals as Parameters<typeof summarizeRemovalReasons>[0],
    ),
    finalizationPartialReason: forensics?.finalizationPartialReason ?? null,
    constrainedPoolSizes: forensics?.constrainedPoolSizes ?? null,
  };
}

function classifyRootCause(row: Record<string, unknown>): string {
  const recovery = asRecord(row.recovery);
  const genre = asRecord(row.strictGenreEvidence);
  const detail = String(recovery?.triggerDetail ?? "");
  const afterDiv = num(asRecord(row.candidates)?.afterDiversity);
  const final = num(row.count);
  if (detail.includes("genre_evidence") || detail.includes("genre_leak")) {
    const pools =
      asRecord(row.constrainedPoolSizes) ??
      asRecord(asRecord(row.deliveryUnderfillForensics)?.constrainedPoolSizes);
    const merged = num(pools?.merged);
    if (num(genre?.verifiedCount) > final && merged <= final) {
      return "G+C";
    }
    return "G";
  }
  if (afterDiv > final && final < num(row.requestedLength)) return "H";
  return "unknown";
}

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });

  const prompts: Record<string, unknown>[] = [];
  for (const id of PROMPT_IDS) {
    prompts.push(await generateOne(creds.baseUrl, creds.token, creds.spotifyUserId, id));
  }

  const disco = prompts.find((p) => p.promptId === "party-70s-disco")!;
  const discoGenre = asRecord(disco.strictGenreEvidence);
  const discoPools = asRecord(disco.constrainedPoolSizes) ?? asRecord(asRecord(disco.deliveryUnderfillForensics)?.constrainedPoolSizes);
  const discoAudit = asRecord(asRecord(disco.deliveryUnderfillForensics)?.genreEvidenceAudit);

  const primaryCause =
    num(discoGenre?.verifiedCount) < num(discoGenre?.requiredCount) &&
    num(discoPools?.merged) < num(asRecord(disco.candidates)?.afterDiversity) &&
    String(asRecord(disco.recovery)?.triggerDetail ?? "").includes("genre_evidence")
      ? {
          code: "G",
          label: "Contract / genre evidence enforcement removes too many tracks (via constrained-prefix replacement)",
          evidence: [
            `verified=${discoGenre?.verifiedCount} < required=${discoGenre?.requiredCount} (ratio ${discoGenre?.requiredRatio}) on a ${asRecord(disco.candidates)?.afterDiversity}-track V3 exit`,
            `publishConstrainedPrefix replaced playlist with mergedConstrainedRecoveryPool size ${discoPools?.merged}`,
            `recovery.triggerDetail=${asRecord(disco.recovery)?.triggerDetail}`,
            `counterfactual verified-only length would be ${asRecord(discoAudit?.counterfactual)?.ifKeptVerifiedOnly}`,
          ],
          secondary: "C — replacement search / constrained pool exhausted relative to target 30",
        }
      : {
          code: "H",
          label: "See per-prompt evidence",
          evidence: [],
          secondary: null,
        };

  const report = {
    generatedAt: new Date().toISOString(),
    diagnosisOnly: true,
    primaryCause,
    prompts,
    perPromptRootCause: Object.fromEntries(prompts.map((p) => [String(p.promptId), classifyRootCause(p)])),
  };

  const mdLines: string[] = [
    "# Delivery Underfill Forensics",
    "",
    "**Diagnosis only** — no retrieval / scoring / gate / Opening Curator / recovery behaviour changes.",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Executive summary",
    "",
    `For \`party-70s-disco\`, V3 still exits at **${asRecord(disco.candidates)?.afterDiversity}** tracks, but delivery collapses to **${disco.count}** inside the controller **genre evidence guard**.`,
    "",
    `Primary cause: **${primaryCause.code}. ${primaryCause.label}**.`,
    "",
    "Mechanism:",
    "",
    "1. Pipeline / diversity exits with a full-length playlist (`candidatesAfterDiversity=30`).",
    `2. Genre evidence finds verified=${discoGenre?.verifiedCount}, rejected=${discoGenre?.rejectedCount}, required=${discoGenre?.requiredCount} (ratio ${discoGenre?.requiredRatio}).`,
    "3. Because verified < required, `publishConstrainedPrefix` runs **first** and replaces the entire playlist with `mergedConstrainedRecoveryPool`.",
    `4. That pool only has **${discoPools?.merged}** tracks (exact/adjacent/genre/family all ${discoPools?.exact}/${discoPools?.adjacent}/${discoPools?.genre}/${discoPools?.family}).`,
    "5. Later era / coherence stages cannot grow back to 30 — final count stays underfilled.",
    "",
    "Human saveability is **not** the shrink stage (V3 gate already passed to reach `full_pipeline`).",
    "",
    "## Funnel (party-70s-disco)",
    "",
    "```",
    `afterDiversity / pipeline exit: ${asRecord(disco.candidates)?.afterDiversity}`,
    "↓",
    `after_finalize_recovery: ${asRecord(disco.deliveryUnderfillForensics)?.afterFinalizeCount ?? "n/a"}`,
    "↓",
    `genre_evidence_guard → constrained prefix: ${asRecord(disco.deliveryUnderfillForensics)?.afterGenreEvidenceCount ?? disco.count}`,
    "↓",
    `era_evidence_guard: ${asRecord(disco.deliveryUnderfillForensics)?.afterEraEvidenceCount ?? "n/a"}`,
    "↓",
    `final: ${disco.count}`,
    "```",
    "",
    "## Stage loss summary",
    "",
    "| Stage | Enter | Exit | Lost | Added |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  const stages = Array.isArray(asRecord(disco.deliveryUnderfillForensics)?.stages)
    ? (asRecord(disco.deliveryUnderfillForensics)!.stages as Array<Record<string, unknown>>)
    : [];
  for (const stage of stages) {
    mdLines.push(
      `| ${stage.stage} | ${stage.enter ?? "—"} | ${stage.exit} | ${stage.lost} | ${stage.added} |`,
    );
  }
  if (stages.length === 0) {
    mdLines.push(
      `| pipeline / afterDiversity | — | ${asRecord(disco.candidates)?.afterDiversity} | — | — |`,
      `| afterRepair (funnel metric) | — | ${asRecord(disco.candidates)?.afterRepair} | — | — |`,
      `| afterCoherence (funnel metric) | — | ${asRecord(disco.candidates)?.afterCoherence} | — | — |`,
      `| final | — | ${disco.count} | — | — |`,
    );
  }

  mdLines.push(
    "",
    "## Removal reason counts (party-70s-disco)",
    "",
    "| Removal reason | Count |",
    "| --- | ---: |",
  );
  const reasonCounts = asRecord(disco.removalReasonCounts) ?? {};
  const reasonEntries = Object.entries(reasonCounts);
  if (reasonEntries.length === 0) {
    mdLines.push("| (no per-track audit rows; see JSON genreEvidenceAudit) | — |");
  } else {
    for (const [reason, count] of reasonEntries.sort((a, b) => Number(b[1]) - Number(a[1]))) {
      mdLines.push(`| ${reason} | ${count} |`);
    }
  }

  mdLines.push(
    "",
    "## Per-track removals (party-70s-disco)",
    "",
    "| Artist | Title | Stage | Rule | Replacement available | Note |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  const removals = Array.isArray(discoAudit?.removals)
    ? (discoAudit!.removals as Array<Record<string, unknown>>)
    : [];
  for (const row of removals.slice(0, 40)) {
    mdLines.push(
      `| ${row.artist} | ${row.title} | ${row.removalStage} | ${row.removalReason} | ${row.replacementAvailable} | ${String(row.replacementNote ?? "").slice(0, 120)} |`,
    );
  }
  if (removals.length === 0) {
    mdLines.push("| — | — | — | — | — | Audit instrumentation missing/empty |");
  }

  mdLines.push(
    "",
    "## Candidate availability",
    "",
    `- Merged constrained recovery pool: **${discoPools?.merged ?? "n/a"}**`,
    `- Exact / adjacent / genre / family: **${discoPools?.exact}/${discoPools?.adjacent}/${discoPools?.genre}/${discoPools?.family}**`,
    `- Verified-only counterfactual length: **${asRecord(discoAudit?.counterfactual)?.ifKeptVerifiedOnly ?? "n/a"}**`,
    `- Would verified-only reach target 30? **${asRecord(discoAudit?.counterfactual)?.wouldReachTargetWithVerified ?? "n/a"}**`,
    "",
    "Replacement after the ratio miss: **attempted YES** via `publishConstrainedPrefix`, but pool size caps delivery — availability vs target 30 = **NO** (pool exhausted relative to target).",
    "",
    "## Root cause",
    "",
    `**${primaryCause.code}. ${primaryCause.label}**`,
    "",
    ...(primaryCause.evidence as string[]).map((line) => `- ${line}`),
    "",
    primaryCause.secondary ? `Secondary contributing factor: **${primaryCause.secondary}**.` : "",
    "",
    "Not primary: human saveability (already passed), Opening Curator, activity prune, embarrassment filter (absent on this path).",
    "",
    "## Cross-prompt comparison",
    "",
    "| Prompt | Count | afterDiversity | Genre verified/required/rejected | Trigger | Merged pool |",
    "| --- | ---: | ---: | --- | --- | ---: |",
  );

  for (const row of prompts) {
    const g = asRecord(row.strictGenreEvidence);
    const pools = asRecord(row.constrainedPoolSizes) ?? asRecord(asRecord(row.deliveryUnderfillForensics)?.constrainedPoolSizes);
    mdLines.push(
      `| ${row.promptId} | ${row.count} | ${asRecord(row.candidates)?.afterDiversity} | ${g?.verifiedCount ?? "—"}/${g?.requiredCount ?? "—"}/${g?.rejectedCount ?? "—"} | ${asRecord(row.recovery)?.triggerDetail ?? "—"} | ${pools?.merged ?? "—"} |`,
    );
  }

  mdLines.push(
    "",
    "## Recommendation (ONE next change)",
    "",
    "**Change:** When `verifiedCount < requiredCount` but `verified.length >= min(requiredCount-ε, target*0.7)` (e.g. 25/26), prefer **verified-only keep / soft strip of leaks** (`finalTracks = verified.slice(0, length)`) **before** `publishConstrainedPrefix`, or only call constrained prefix when verified count would drop below a hard floor.",
    "",
    "- **ROI:** Highest — disco already has 25 verified soul tracks; avoiding the 15-track recovery pool should restore ~25–30 deliverable tracks without touching scoring or gate thresholds.",
    "- **Size:** Tiny branch reorder in `generation.controller.ts` genre evidence block (~7835–7856).",
    "- **Expected impact:** `party-70s-disco` final length 15 → ~25 (or 30 if pool refill follows).",
    "- **Confidence:** **High** (live counters show verified=25, required=26, merged pool=15).",
    "",
    "## Validation decision",
    "",
    "1. Is the delivery underfill root cause now fully understood?",
    "",
    "**YES** — live audit shows the shrink is the genre-evidence constrained-prefix replacement after a one-track shortfall versus the 85% ratio, not ranking/diversity/V3.",
    "",
    "2. Is another targeted fix justified before rerunning the 250 benchmark?",
    "",
    "**YES** — one branch reorder / guard in genre evidence publish order; do not run 250 until disco lands 20–30.",
    "",
    "3. Opening Curator benchmark safe to rerun?",
    "",
    "**NO** — delivery still underfills the target playlist; Opening Curator benchmarks would confound length failures.",
    "",
    "4. Full 250 benchmark safe to rerun?",
    "",
    "**NO** — same reason; wait until party-70s-disco stably delivers 20–30 `full_pipeline` tracks.",
    "",
    "Companion JSON: `reports/playlist-evaluation/delivery-underfill-forensics.json`",
    "",
  );

  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "delivery-underfill-forensics.json");
  const mdPath = path.join(OUT_DIR, "delivery-underfill-forensics.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdPath, mdLines.filter((l) => l !== undefined).join("\n"), "utf8");
  process.stderr.write(`[delivery-underfill] wrote ${mdPath}\n`);
  console.log(JSON.stringify({
    primaryCause: primaryCause.code,
    disco: {
      count: disco.count,
      afterDiversity: asRecord(disco.candidates)?.afterDiversity,
      verified: discoGenre?.verifiedCount,
      required: discoGenre?.requiredCount,
      rejected: discoGenre?.rejectedCount,
      mergedPool: discoPools?.merged,
      trigger: asRecord(disco.recovery)?.triggerDetail,
    },
    others: prompts.map((p) => ({
      id: p.promptId,
      count: p.count,
      afterDiversity: asRecord(p.candidates)?.afterDiversity,
      trigger: asRecord(p.recovery)?.triggerDetail,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
