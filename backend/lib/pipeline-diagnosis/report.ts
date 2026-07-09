import type { ConvergenceAnalysis } from "./compare";
import type { ExtractedPipelineTrace } from "./extract";

export type PromptDiagnosisReport = {
  promptId: string;
  prompt: string;
  category: string;
  baseline: ExtractedPipelineTrace;
  current: ExtractedPipelineTrace;
  convergence: ConvergenceAnalysis;
};

export type DiagnosisReportBundle = {
  generatedAt: string;
  baselineDir: string;
  currentDir: string;
  liveRefetch: boolean;
  prompts: PromptDiagnosisReport[];
};

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function section(title: string): string {
  return `\n## ${title}\n`;
}

function renderTraceBlock(label: string, trace: ExtractedPipelineTrace): string {
  const lines: string[] = [];
  lines.push(`### ${label}`);
  lines.push(`- Success: ${trace.success}`);
  if (trace.failureCode) lines.push(`- Failure: \`${trace.failureCode}\``);
  lines.push(`- Fast fallback: ${trace.fastFallback}`);
  lines.push(`- Recovery: ${trace.recoveryTriggered}`);
  if (trace.executionPath) lines.push(`- Execution path: \`${trace.executionPath}\``);

  if (Object.keys(trace.retrieval.bySource).length > 0) {
    lines.push("- Retrieval by source:");
    for (const [source, count] of Object.entries(trace.retrieval.bySource)) {
      lines.push(`  - ${source}: ${count}`);
    }
  }
  if (trace.retrieval.outputCount !== undefined) {
    lines.push(`- Retrieval output count: ${trace.retrieval.outputCount}`);
  }
  if (trace.retrieval.combinedConfidence !== undefined) {
    lines.push(`- Combined confidence: ${trace.retrieval.combinedConfidence}`);
  }
  const limitingFactors = trace.retrieval.libraryCapability?.["limitingFactors"];
  if (Array.isArray(limitingFactors) && limitingFactors.length > 0) {
    lines.push(`- Limiting factors: ${limitingFactors.join(", ")}`);
  }

  if (trace.filterStages.length > 0) {
    lines.push("- Filter stages:");
    for (const stage of trace.filterStages) {
      const parts = [stage.stage];
      if (stage.beforeCount !== undefined) parts.push(`before=${stage.beforeCount}`);
      if (stage.afterCount !== undefined) parts.push(`after=${stage.afterCount}`);
      if (stage.removedCount !== undefined) parts.push(`removed=${stage.removedCount}`);
      lines.push(`  - ${parts.join(" ")}`);
    }
  }

  if (trace.scoreDistributionBeforeHybrid) {
    const d = trace.scoreDistributionBeforeHybrid;
    lines.push(`- Score distribution (pre-hybrid): n=${d.count}, min=${d.min}, median=${d.median}, max=${d.max}, p10=${d.p10}, p90=${d.p90}`);
  }

  if (trace.top20EnteringScoring.length > 0) {
    lines.push("- Top 20 entering scoring:");
    for (const t of trace.top20EnteringScoring.slice(0, 20)) {
      lines.push(`  - ${t.rank}. ${t.artistName ?? "?"} — ${t.trackName ?? t.trackId}${t.score !== undefined ? ` (${t.score})` : ""}`);
    }
  } else {
    lines.push("- Top 20 entering scoring: *(not captured in stored audit payload)*");
  }

  if (trace.top20AfterScoring.length > 0) {
    lines.push("- Top 20 after scoring:");
    for (const t of trace.top20AfterScoring.slice(0, 20)) {
      lines.push(`  - ${t.rank}. ${t.artistName ?? "?"} — ${t.trackName ?? t.trackId}${t.score !== undefined ? ` (${t.score})` : ""}`);
    }
  }

  lines.push("- Final playlist:");
  if (trace.finalPlaylist.length === 0) {
    lines.push("  - *(empty)*");
  } else {
    for (const t of trace.finalPlaylist) {
      lines.push(`  - ${t.rank}. ${t.artistName ?? "?"} — ${t.trackName ?? t.trackId}`);
    }
  }

  if (trace.rejectionReasons.length > 0) {
    lines.push("- Rejection reasons:");
    const grouped = new Map<string, number>();
    for (const r of trace.rejectionReasons) {
      grouped.set(r.reason, (grouped.get(r.reason) ?? 0) + 1);
    }
    for (const [reason, count] of [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      lines.push(`  - ${reason}${count > 1 ? ` (×${count})` : ""}`);
    }
  }

  return lines.join("\n");
}

export function renderMarkdownReport(bundle: DiagnosisReportBundle): string {
  const lines: string[] = [
    "# Worst-Prompt Pipeline Diagnosis (Top 10)",
    "",
    `Generated: ${bundle.generatedAt}`,
    `Baseline: \`${bundle.baselineDir}\``,
    `Current: \`${bundle.currentDir}\``,
    `Live re-fetch: ${bundle.liveRefetch ? "yes" : "no (stored audit payloads only)"}`,
    "",
    bundle.liveRefetch
      ? ""
      : [
          "> **Audit payload limit:** Stored benchmark responses omit `candidateRetrieval`, `forensicPoolTrace`,",
          "> `preV3TopCandidates`, and `removalReasons` when the request took the fast-fallback path.",
          "> Re-run with `npm run diagnosis:worst-prompts:live` for fuller traces (requires `PLAYLIST_EVAL_TOKEN` in `.env`).",
          "",
        ].join("\n"),
    "This report compares stage-by-stage pipeline behaviour for the 10 lowest-quality prompts from the live-6h benchmark.",
    "",
    "---",
  ];

  for (const item of bundle.prompts) {
    lines.push(section(`${item.promptId}`));
    lines.push(`**Prompt:** ${item.prompt}`);
    lines.push(`**Category:** ${item.category}`);
    lines.push("");

    const c = item.convergence;
    lines.push("### Convergence summary");
    lines.push(`- ${c.summary}`);
    lines.push(`- Final overlap (Jaccard): ${fmtPct(c.finalJaccard)}`);
    lines.push(`- Final ordered match: ${c.finalOrderedMatch}`);
    lines.push(`- Retrieval composition changed: ${c.retrievalCompositionChanged}`);
    lines.push(`- Scoring/finalisation overrode retrieval: ${c.scoringOverrodeRetrieval}`);
    lines.push(`- First stage matching baseline run: ${c.firstStageMatchingBaselineRun ?? "—"}`);
    lines.push(`- **First stage converging to baseline final playlist: ${c.firstStageMatchingBaselineFinal ?? "—"}**`);
    if (c.retrievalOverrideEvidence.length > 0) {
      lines.push("- Override evidence:");
      for (const ev of c.retrievalOverrideEvidence) {
        lines.push(`  - ${ev}`);
      }
    }

    if (c.stageComparisons.length > 0) {
      lines.push("");
      lines.push("### Stage comparison (current vs baseline)");
      lines.push("| Stage | Current count | Baseline count | Jaccard | Matches baseline final |");
      lines.push("| --- | ---: | ---: | ---: | --- |");
      for (const row of c.stageComparisons) {
        lines.push(
          `| ${row.label} | ${row.currentCount ?? row.currentTrackIds.length} | ${row.baselineCount ?? row.baselineTrackIds.length} | ${row.jaccardSimilarity} | ${row.matchesBaselineFinal ? "yes" : "no"} |`,
        );
      }
    }

    lines.push("");
    lines.push(renderTraceBlock("Current run", item.current));
    lines.push("");
    lines.push(renderTraceBlock("Baseline run", item.baseline));
    lines.push("");
    lines.push("---");
  }

  lines.push(section("Cross-prompt findings"));
  const earlyGate = bundle.prompts.filter((p) => p.current.failureCode === "LIBRARY_INSUFFICIENT_FOR_PROMPT");
  const retrievalChanged = bundle.prompts.filter((p) => p.convergence.retrievalCompositionChanged);
  const scoringOverride = bundle.prompts.filter((p) => p.convergence.scoringOverrodeRetrieval);
  const sameFinal = bundle.prompts.filter((p) => p.convergence.finalOrderedMatch);

  lines.push(`- Early orchestrator gate (gym cluster): ${earlyGate.length} prompts`);
  lines.push(`- Retrieval composition changed vs baseline: ${retrievalChanged.length} prompts`);
  lines.push(`- Scoring/finalisation overrode retrieval pool: ${scoringOverride.length} prompts`);
  lines.push(`- Identical final playlist to baseline: ${sameFinal.length} prompts`);

  const convergenceStages = new Map<string, number>();
  for (const p of bundle.prompts) {
    const stage = p.convergence.firstStageMatchingBaselineFinal ?? "never";
    convergenceStages.set(stage, (convergenceStages.get(stage) ?? 0) + 1);
  }
  lines.push("- Convergence stage distribution:");
  for (const [stage, count] of convergenceStages.entries()) {
    lines.push(`  - ${stage}: ${count}`);
  }

  return lines.join("\n");
}
