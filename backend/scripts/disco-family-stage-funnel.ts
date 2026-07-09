/**
 * Diagnosis-only: family × stage funnel for party-70s-disco.
 * Answers: where did disco/funk/soul candidates disappear?
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const OUT_DIR = path.join(ROOT, "reports", "playlist-evaluation");
const PROMPT_ID = "party-70s-disco";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function familyCols(hist: Record<string, unknown> | null | undefined): Record<string, number> {
  const raw = asRecord(hist) ?? {};
  const keys = ["disco", "funk", "soul", "rnb", "pop", "electronic", "rock", "indie", "metal", "other", "unknown"];
  const out: Record<string, number> = {};
  for (const key of keys) out[key] = num(raw[key]);
  return out;
}

function rowFromStage(stage: string, snap: Record<string, unknown> | null): string {
  if (!snap) return `| ${stage} | — | — | — | — | — | — | — | — | — |`;
  const raw = familyCols(asRecord(snap.raw));
  const total = num(snap.total);
  return `| ${stage} | ${total} | ${raw.disco} | ${raw.funk} | ${raw.soul} | ${raw.rnb} | ${raw.pop} | ${raw.electronic} | ${raw.rock} | ${raw.indie} | ${raw.metal} |`;
}

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((row) => row.id === PROMPT_ID);
  if (!prompt) throw new Error(`Missing ${PROMPT_ID}`);

  process.stderr.write(`[family-funnel] generating ${PROMPT_ID}...\n`);
  const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": creds.token,
    },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      auditMode: true,
      debug: true,
      debugPipeline: true,
      spotifyUserId: creds.spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = asRecord(await res.json().catch(() => ({}))) ?? {};
  const gd = asRecord(body.generationDiagnostics) ?? {};
  const funnel = asRecord(gd.familyStageFunnel) ?? {};
  const blended = asRecord(funnel.blended);
  const pipeline = asRecord(funnel.pipeline);
  const retrieval = asRecord(gd.candidateRetrieval) ?? {};
  const orch = asRecord(retrieval.orchestrator) ?? {};
  const blendedPool = asRecord(orch.blendedIntentPool) ?? asRecord(blended);

  const report = {
    generatedAt: new Date().toISOString(),
    diagnosisOnly: true,
    promptId: PROMPT_ID,
    count: body.count,
    executionPath: asRecord(body.playlistExecutionTrace)?.executionPath ?? null,
    activePath: asRecord(body.v3Diagnostics)?.activePath ?? null,
    blendedLanes: asRecord(blendedPool)?.lanes ?? null,
    blendedFamilyFunnel: blendedPool?.familyFunnel ?? blended,
    familyStageFunnel: funnel,
    candidates: {
      afterConstraints: gd.candidatesAfterConstraints,
      afterRanking: gd.candidatesAfterRanking,
      afterDiversity: gd.candidatesAfterDiversity,
      final: gd.candidatesFinal,
    },
  };

  const library = asRecord(funnel.library);
  const scoringInput = asRecord(funnel.scoringInput);
  const genreEligible = asRecord(blended?.genreEligible);
  const genreMatchLane = asRecord(blended?.genreMatchLane);
  const blendedMerged = asRecord(blended?.blendedMerged);
  const scored = asRecord(pipeline?.scored);
  const contractGuarded = asRecord(pipeline?.contractGuarded);
  const v3Input = asRecord(pipeline?.v3Input);
  const v3Selected = asRecord(pipeline?.v3Selected);
  const finalSnap = asRecord(funnel.final) ?? asRecord(pipeline?.final);

  const md = [
    "# party-70s-disco family × stage funnel",
    "",
    "**Diagnosis only** — instrumentation to find where disco/funk/soul disappear.",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Question",
    "",
    "Why is blended `genre_match` only ~4? Where do disco candidates disappear?",
    "",
    "## Live context",
    "",
    `- count: **${report.count}**`,
    `- executionPath: \`${report.executionPath}\``,
    `- activePath: \`${report.activePath}\``,
    `- blended lanes: \`${JSON.stringify(report.blendedLanes)}\``,
    `- genreFitEligibleCount: **${num(blended?.genreFitEligibleCount)}** (quota ${num(blended?.genreLaneQuota)})`,
    `- relaxedGenreFamilies: \`${JSON.stringify(blended?.relaxedGenreFamilies ?? null)}\``,
    `- normalizedIntentFamilies (via getGenreFamily): \`${JSON.stringify(blended?.normalizedIntentFamilies ?? null)}\``,
    "",
    "## Family × stage table (raw classifier labels)",
    "",
    "| Stage | Total | Disco | Funk | Soul | R&B | Pop | Electronic | Rock | Indie | Metal |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    rowFromStage("library", library),
    rowFromStage("blended genre-eligible (genreFit≥0.85)", genreEligible),
    rowFromStage("blended genre_match lane", genreMatchLane),
    rowFromStage("blended merged pool", blendedMerged),
    rowFromStage("scoring_input", scoringInput),
    rowFromStage("scored", scored),
    rowFromStage("contract_guarded", contractGuarded),
    rowFromStage("v3_input", v3Input),
    rowFromStage("v3_selected", v3Selected),
    rowFromStage("final", finalSnap),
    "",
    "## How to read this",
    "",
    "1. If **library** already has few soul/funk/disco → supply / classification problem.",
    "2. If library has many but **genre-eligible** is tiny → genreFit matching / `getGenreFamily` normalization bug.",
    "3. If genre-eligible is healthy but **genre_match lane** is tiny → quota / pull order (should equal min(eligible, quota)).",
    "4. If blended pool is soul-rich but **v3_input/final** is rock/indie → ranking / diversity / lane scoring loss.",
    "",
    "## First loss point",
    "",
    "_Filled after live run interpretation._",
    "",
    "Companion JSON: `reports/playlist-evaluation/disco-family-stage-funnel.json`",
    "",
  ].join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "disco-family-stage-funnel.json");
  const mdPath = path.join(OUT_DIR, "disco-family-stage-funnel.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdPath, md, "utf8");
  process.stderr.write(`[family-funnel] wrote ${mdPath}\n`);
  console.log(JSON.stringify({
    genreFitEligibleCount: blended?.genreFitEligibleCount,
    genreLaneQuota: blended?.genreLaneQuota,
    normalizedIntentFamilies: blended?.normalizedIntentFamilies,
    library: library?.raw,
    genreEligible: genreEligible?.raw,
    genreMatchLane: genreMatchLane?.raw,
    blendedMerged: blendedMerged?.raw,
    scoringInput: scoringInput?.raw,
    v3Input: v3Input?.raw,
    final: finalSnap?.raw,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
