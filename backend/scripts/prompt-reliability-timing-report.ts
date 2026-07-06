/**
 * Build a stage-timing report from a prompt-reliability benchmark JSON export.
 *
 * Usage:
 *   npm run build && node backend/dist/scripts/prompt-reliability-timing-report.js \
 *     --report reports/prompt-reliability/post-deploy/SHA/prompt-reliability-report.json \
 *     --out reports/prompt-reliability/timing-latest.md \
 *     --slowest 10
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatRequestStageTimingMarkdown, type RequestStageTimingReport } from "../lib/request-stage-timing";
import {
  formatV3InvocationBreakdownMarkdown,
  type V3InvocationPattern,
  type V3PerCandidateProfile,
} from "../lib/v3-invocation-decomposition";

type TimingReport = RequestStageTimingReport;

type PromptRow = {
  input: { id: string; prompt: string; group: string };
  elapsedMs: number;
  status: number | null;
  generation: { finalTrackCount: number };
  timing?: {
    requestStageTiming: TimingReport | null;
    latencyBudgetExceeded: boolean;
    latencyOptimizationSkipped: Record<string, boolean> | null;
    v3TimingMs: Record<string, number> | null;
    playlistPipelineTimingMs: Record<string, number> | null;
    v3PipelineTimingProfile?: {
      v3PipelineTotalMs: number;
      invocationPattern: string | null;
    } | null;
    v3Decomposition?: {
      v3InvocationCount: number | null;
      perCandidateV3Ms: number[] | null;
      perCandidate: Array<{ label: string; ms: number; poolSize: number; laneCount: number }> | null;
      selectedWinnerLabel: string | null;
      invocationPattern: string | null;
      avgMsPerInvocation: number | null;
      minMsPerInvocation: number | null;
      maxMsPerInvocation: number | null;
      costDriver: string | null;
    } | null;
    humanSaveRetries: number | null;
    coherenceRebuildIterations: number | null;
  };
};

type BenchmarkReport = {
  commit: string;
  prompts: PromptRow[];
};

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function intArg(args: string[], name: string, fallback: number): number {
  const raw = argValue(args, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reportPath = argValue(args, "--report");
  if (!reportPath) throw new Error("--report is required");
  const outPath = argValue(args, "--out") ?? "reports/prompt-reliability/timing-latest.md";
  const slowestCount = intArg(args, "--slowest", 10);

  const raw = JSON.parse(await readFile(reportPath, "utf8")) as BenchmarkReport;
  const withTiming = raw.prompts.filter((row) => row.timing?.requestStageTiming);
  const slowest = [...raw.prompts]
    .sort((a, b) => b.elapsedMs - a.elapsedMs)
    .slice(0, slowestCount);

  const stageTotals = new Map<string, { ms: number; count: number }>();
  for (const row of withTiming) {
    for (const entry of row.timing?.requestStageTiming?.ordered ?? []) {
      const current = stageTotals.get(entry.stage) ?? { ms: 0, count: 0 };
      current.ms += entry.ms;
      current.count += 1;
      stageTotals.set(entry.stage, current);
    }
  }
  const aggregateStages = [...stageTotals.entries()]
    .map(([stage, value]) => ({ stage, avgMs: Math.round(value.ms / Math.max(1, value.count)), prompts: value.count, totalMs: value.ms }))
    .sort((a, b) => b.avgMs - a.avgMs);

  const lines = [
    "# Prompt Reliability Timing Report",
    "",
    `Commit: \`${raw.commit}\``,
    `Source: \`${reportPath}\``,
    `Prompts with stage timing: ${withTiming.length}/${raw.prompts.length}`,
    "",
    "## Aggregate slowest stages (avg ms per prompt)",
    "",
    "| Stage | Avg ms | Prompts | Total ms |",
    "| --- | ---: | ---: | ---: |",
    ...aggregateStages.map((row) => `| ${row.stage} | ${row.avgMs} | ${row.prompts} | ${row.totalMs} |`),
    "",
    "## V3 per-invocation breakdown (slowest prompts)",
    "",
    "Read each table as: invocation N → pool | lanes | ms. Pattern tells you multiplicative vs pathological.",
    "",
  ];

  for (const row of slowest) {
    const decomp = row.timing?.v3Decomposition;
    const profile = row.timing?.v3PipelineTimingProfile;
    if (decomp?.perCandidate?.length && profile) {
      lines.push(formatV3InvocationBreakdownMarkdown({
        promptId: row.input.id,
        prompt: row.input.prompt,
        perCandidate: decomp.perCandidate as V3PerCandidateProfile[],
        selectedWinnerLabel: decomp.selectedWinnerLabel,
        invocationPattern: (profile.invocationPattern ?? decomp.invocationPattern ?? "unknown") as V3InvocationPattern,
        v3PipelineTotalMs: profile.v3PipelineTotalMs,
      }));
      lines.push("");
      continue;
    }
    const timing = row.timing?.requestStageTiming;
    if (timing) {
      lines.push(formatRequestStageTimingMarkdown(row.input.id, row.input.prompt, row.elapsedMs, timing, {
        latencyBudgetExceeded: row.timing?.latencyBudgetExceeded,
        retries: {
          humanSaveability: row.timing?.humanSaveRetries ?? 0,
          coherenceRebuild: row.timing?.coherenceRebuildIterations ?? 0,
        },
      }));
      lines.push("- **No per-invocation V3 breakdown in response**", "");
      continue;
    }
    lines.push(
      `### ${row.input.id}`,
      `- Prompt: ${row.input.prompt}`,
      `- Total: ${row.elapsedMs}ms`,
      `- Status: ${row.status ?? "client_abort"}`,
      `- Tracks: ${row.generation.finalTrackCount}`,
      `- **No timing in response**`,
      "",
    );
  }

  lines.push("## Findings checklist", "");
  lines.push("- Per-invocation tables are the primary signal — not v3PipelineTotalMs alone.");
  lines.push("- `multiplicative` ≈ 15×5s → fix candidate count / early exit.");
  lines.push("- `pathological` ≈ 1×82s → profile one runV3Pipeline (lanes, pool, clustering).");
  lines.push("- `latencyBudgetExceeded: true` means the server returned the best playlist at the ~90s budget.");

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
