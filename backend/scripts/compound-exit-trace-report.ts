import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const TARGET_IDS = ["party-70s-disco", "mixed-2"] as const;
const ROOT = path.resolve(__dirname, "..", "..", "..");

function txt(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

async function runPrompt(baseUrl: string, token: string, spotifyUserId: string, promptId: (typeof TARGET_IDS)[number]) {
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((row) => row.id === promptId);
  if (!prompt) throw new Error(`Missing prompt ${promptId}`);
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
  const body = await res.json().catch(() => ({}));
  return { prompt, status: res.status, body: asRecord(body) ?? {} };
}

function explainTrace(result: Awaited<ReturnType<typeof runPrompt>>): string {
  const body = result.body;
  const code = txt(body.code) ?? "UNKNOWN";
  const trace = asRecord(body.intentCollapseRescueTrace);
  const collapse = asRecord(body.intentCollapseLayer);
  const execTrace = asRecord(body.playlistExecutionTrace);
  const trackCounts = asRecord(execTrace?.trackCounts);
  const gen = asRecord(body.generationDiagnostics);
  const retrieval = asRecord(gen?.candidateRetrieval);
  const orchestrator = asRecord(retrieval?.orchestrator);
  const blended = asRecord(orchestrator?.blendedIntentPool);
  const v3Decomp = asRecord(gen?.v3InvocationDecomposition);
  const constraintFailures = Array.isArray(gen?.constraintFailures)
    ? (gen?.constraintFailures as unknown[]).map((item) => String(item))
    : [];
  const primaryExit = txt(execTrace?.executionPath) === "gate_failure"
    ? (constraintFailures[0] ?? "gate_failure_without_constraint_reason")
    : txt(execTrace?.executionPath) === "partial_pipeline"
      ? "partial_pipeline_exit"
      : "no_early_exit_before_rescue";

  const lines = [
    `### ${result.prompt.id}`,
    `- HTTP: ${result.status}`,
    `- Code: ${code}`,
    `- Execution path: ${txt(execTrace?.executionPath) ?? "n/a"}`,
    `- Success/count: ${String(body.success ?? "n/a")} / ${num(body.count) ?? "n/a"}`,
    `- trackCounts.retrieved: ${num(trackCounts?.retrieved) ?? "n/a"}, trackCounts.sampled: ${num(trackCounts?.sampled) ?? "n/a"}`,
    `- orchestrator strategy: ${txt(orchestrator?.strategy) ?? "n/a"}, blendedIntentPool=${blended ? "yes" : "no"}`,
    `- v3 invocations: ${num(v3Decomp?.invocationCount) ?? "n/a"}, constraintFailures=${constraintFailures.join(", ") || "none"}`,
    `- intent collapse: preFilter=${num(collapse?.preFilterCount) ?? "n/a"}, postFilter=${num(collapse?.postFilterCount) ?? "n/a"}, world=${txt(collapse?.editorialWorldTag) ?? "n/a"}`,
    `- rescue trace: shapedPool=${num(trace?.shapedPoolCount) ?? "n/a"}, minimumRequired=${num(trace?.minimumRequired) ?? "n/a"}, hasLockedIntent=${String(trace?.hasLockedIntent ?? "n/a")}, hasEmotionProfile=${String(trace?.hasEmotionProfile ?? "n/a")}, hasClassMap=${String(trace?.hasClassMap ?? "n/a")}, collapseLikedSongsCount=${num(trace?.collapseLikedSongsCount) ?? "n/a"}, attemptedBlendedRescue=${String(trace?.attemptedBlendedRescue ?? "n/a")}, blendedPoolCount=${num(trace?.blendedPoolCount) ?? "n/a"}, blendedApplied=${String(trace?.blendedApplied ?? "n/a")}, reshapedPoolCount=${num(trace?.reshapedPoolCount) ?? "n/a"}, reshapedSufficient=${String(trace?.reshapedSufficient ?? "n/a")}`,
    "",
    "Call trace (instrumented):",
    "generate()",
    "  -> orchestratePlaylistRetrieval()",
    "  -> candidate shaping",
    "  -> runPlaylistPipeline()",
    "  -> runV3Pipeline()",
    blended
      ? "  -> blendedPoolRescue() activated in orchestrator before V3"
      : "  -> blendedPoolRescue() NOT activated in orchestrator",
    txt(execTrace?.executionPath) === "gate_failure"
      ? "  -> gate failure path returns with constrained fallback output"
      : txt(execTrace?.executionPath) === "full_pipeline"
        ? "  -> full pipeline returns success"
        : txt(execTrace?.executionPath) === "partial_pipeline"
          ? "  -> partial pipeline exits before full completion"
          : "  -> exit path unknown",
    "",
    `First blocking condition before rescue can activate: **${primaryExit}**`,
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });
  const results = [];
  for (const id of TARGET_IDS) {
    process.stderr.write(`[compound-exit-trace] ${id}\n`);
    results.push(await runPrompt(creds.baseUrl, creds.token, creds.spotifyUserId, id));
  }

  const report = [
    "# Compound Prompt Early-Exit Trace",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Base URL: ${creds.baseUrl}`,
    "",
    "This is trace-only instrumentation between orchestrator and V3/catch flow. No ranking/retrieval logic changed.",
    "",
    ...results.map(explainTrace),
  ].join("\n");

  const outPath = path.join(ROOT, "reports", "playlist-evaluation", "compound-starvation-exit-trace.md");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${report}\n`, "utf8");
  process.stdout.write(`[compound-exit-trace] wrote ${outPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
