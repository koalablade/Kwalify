/**
 * End-to-end benchmark attribution trace — one failing run, raw API vs parser.
 *
 * Usage: npm run trace:benchmark-attribution
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveVerifiedProductionCredentials } from "../lib/benchmark-env";
import { parseHumanSaveabilityFromGenerateResponse } from "../lib/human-saveability-benchmark-parse";

const REPORT_DIR = path.resolve(process.cwd(), "reports");
const TRACE_PROMPT = {
  id: "rainy_walk",
  prompt: "rainy city morning walk with reflective mood",
  seed: 2,
};

async function main(): Promise<void> {
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const requestBody = {
    vibe: TRACE_PROMPT.prompt,
    mode: "balanced",
    length: 25,
    varietyBoost: true,
    auditMode: true,
    spotifyUserId: creds.spotifyUserId,
    requestId: `attribution-trace-${TRACE_PROMPT.id}-seed-${TRACE_PROMPT.seed}`,
    seed: TRACE_PROMPT.seed,
  };

  const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": creds.token,
    },
    body: JSON.stringify(requestBody),
  });

  const rawText = await res.text();
  let rawJson: Record<string, unknown>;
  try {
    rawJson = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    rawJson = { _parseError: true, rawTextPreview: rawText.slice(0, 500) };
  }

  const legacyParser = legacyBenchmarkParse(res.status, rawJson);
  const modernParser = parseHumanSaveabilityFromGenerateResponse(res.status, rawJson);

  const topLevelKeys = Object.keys(rawJson);
  const gateTop = rawJson.humanSaveabilityGate;
  const genDiag = rawJson.generationDiagnostics as Record<string, unknown> | undefined;
  const v3Top = rawJson.v3Diagnostics as Record<string, unknown> | undefined;
  const v3PipelineInGen = (genDiag?.v3Pipeline ?? null) as Record<string, unknown> | null;

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: creds.baseUrl,
    request: TRACE_PROMPT,
    httpStatus: res.status,
    topLevelKeys,
    diagnosticsPresence: {
      humanSaveabilityGate_topLevel: gateTop != null,
      generationDiagnostics: genDiag != null,
      v3Diagnostics_topLevel: v3Top != null,
      generationDiagnostics_v3Pipeline: v3PipelineInGen != null,
      humanSaveabilityGate_in_v3Diagnostics: !!(v3Top?.humanSaveabilityGate),
      humanSaveabilityGate_in_v3Pipeline: !!(v3PipelineInGen?.humanSaveabilityGate),
      openingTenDominantCluster_topLevel: !!(gateTop as Record<string, unknown> | undefined)?.openingTenDominantCluster,
      openingTenDominantCluster_attribution: !!((gateTop as Record<string, unknown> | undefined)?.attribution as Record<string, unknown> | undefined)?.openingTenDominantCluster,
      dominantCluster_gate: (gateTop as Record<string, unknown> | undefined)?.dominantCluster ?? null,
      dominantCluster_attribution: ((gateTop as Record<string, unknown> | undefined)?.attribution as Record<string, unknown> | undefined)?.dominantCluster ?? null,
      sceneWorldLayer_in_v3: !!(v3Top?.sceneWorldLayer ?? v3PipelineInGen?.sceneWorldLayer),
    },
    rawGateSnapshot: gateTop ?? null,
    rawV3HumanSaveGate: v3Top?.humanSaveabilityGate ?? v3PipelineInGen?.humanSaveabilityGate ?? null,
    openingTenFromTracks: Array.isArray(rawJson.tracks)
      ? (rawJson.tracks as Array<Record<string, unknown>>).slice(0, 10).map((t, i) => ({
          rank: i + 1,
          trackId: t.trackId ?? t.id,
          artist: t.artistName ?? t.artist,
          title: t.trackName ?? t.name,
        }))
      : [],
    archetypeFromApi:
      ((v3Top?.sceneWorldLayer ?? v3PipelineInGen?.sceneWorldLayer) as Record<string, unknown> | undefined)?.archetype ?? null,
    dominantClusterFromSceneWorld:
      (((v3Top?.sceneWorldLayer ?? v3PipelineInGen?.sceneWorldLayer) as Record<string, unknown> | undefined)?.sceneClusters as Record<string, unknown> | undefined)?.dominantCluster ?? null,
    parserComparison: {
      legacy: legacyParser,
      modern: modernParser,
      parsersAgree: JSON.stringify(legacyParser) === JSON.stringify(modernParser),
    },
    verdict: classifyVerdict(res.status, rawJson, legacyParser, modernParser),
  };

  await mkdir(REPORT_DIR, { recursive: true });
  const rawPath = path.join(REPORT_DIR, "benchmark-attribution-trace-raw.json");
  const reportPath = path.join(REPORT_DIR, "benchmark-attribution-trace-report.json");
  await writeFile(rawPath, JSON.stringify(rawJson, null, 2));
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  process.stdout.write(`HTTP ${res.status}\n`);
  process.stdout.write(`Wrote ${rawPath}\n`);
  process.stdout.write(`Wrote ${reportPath}\n`);
  process.stdout.write(JSON.stringify(report.verdict, null, 2));
  process.stdout.write("\n");
}

function legacyBenchmarkParse(status: number, data: Record<string, unknown>) {
  const row = {
    humanSaveable: false,
    curatorScore: null as number | null,
    rejectionReasons: [] as string[],
    dominantCluster: null as string | null,
    pipelineStageResponsible: null as string | null,
    openingTenDominantCluster: null as unknown,
  };
  if (!statusOk(status)) {
    const gate = (data.humanSaveabilityGate ?? {}) as Record<string, unknown>;
    row.curatorScore = typeof gate.curatorScore === "number" ? gate.curatorScore : null;
    row.rejectionReasons = Array.isArray(gate.rejectionReasons) ? gate.rejectionReasons.map(String) : [];
    row.dominantCluster = typeof gate.dominantCluster === "string" ? gate.dominantCluster : null;
    const attribution = (gate.attribution ?? {}) as Record<string, unknown>;
    row.pipelineStageResponsible = typeof attribution.stageResponsible === "string" ? attribution.stageResponsible : null;
    row.openingTenDominantCluster = gate.openingTenDominantCluster ?? null;
    return row;
  }
  const diagnostics = (data.diagnostics ?? data.generationDiagnostics ?? {}) as Record<string, unknown>;
  const v3 = (diagnostics.v3Pipeline ?? {}) as Record<string, unknown>;
  const gate = (v3.humanSaveabilityGate ?? {}) as Record<string, unknown>;
  row.humanSaveable = gate.humanSaveable === true || gate.passed === true;
  row.curatorScore = typeof gate.curatorScore === "number" ? gate.curatorScore : null;
  row.rejectionReasons = Array.isArray(gate.rejectionReasons) ? gate.rejectionReasons.map(String) : [];
  row.dominantCluster = typeof gate.dominantCluster === "string" ? gate.dominantCluster : null;
  const attribution = (gate.attribution ?? {}) as Record<string, unknown>;
  row.pipelineStageResponsible = typeof attribution.stageResponsible === "string" ? attribution.stageResponsible : null;
  row.openingTenDominantCluster = gate.openingTenDominantCluster ?? null;
  return row;
}

function statusOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function classifyVerdict(
  status: number,
  raw: Record<string, unknown>,
  legacy: ReturnType<typeof legacyBenchmarkParse>,
  modern: ReturnType<typeof parseHumanSaveabilityFromGenerateResponse>,
): { classification: "benchmark_bug" | "api_bug" | "both" | "neither"; reasons: string[] } {
  const reasons: string[] = [];
  const gate = raw.humanSaveabilityGate as Record<string, unknown> | undefined;
  const v3 = raw.v3Diagnostics as Record<string, unknown> | undefined;
  const hasApiGate = !!gate && Object.keys(gate).length > 0;
  const hasV3Gate = !!v3?.humanSaveabilityGate;
  const apiHasRejection = Array.isArray(gate?.rejectionReasons) && (gate!.rejectionReasons as unknown[]).length > 0;
  const apiHasDominant = !!(gate?.dominantCluster ?? (gate?.attribution as Record<string, unknown> | undefined)?.dominantCluster);
  const apiHasOpeningTen = !!(gate?.openingTenDominantCluster ?? (gate?.attribution as Record<string, unknown> | undefined)?.openingTenDominantCluster);

  let benchmarkBug = false;
  let apiBug = false;

  if (hasApiGate && apiHasRejection && legacy.rejectionReasons.length === 0) {
    benchmarkBug = true;
    reasons.push("API has rejectionReasons but legacy parser returned empty");
  }
  if (hasApiGate && apiHasDominant && !legacy.dominantCluster && !modern.dominantCluster) {
    benchmarkBug = true;
    reasons.push("dominantCluster only in attribution; parsers missed it");
  }
  if (hasApiGate && apiHasOpeningTen && !legacy.openingTenDominantCluster && !modern.openingTenDominantCluster) {
    benchmarkBug = true;
    reasons.push("openingTenDominantCluster present in API but parsers missed it");
  }
  if (statusOk(status) && hasV3Gate && !legacy.humanSaveable && modern.humanSaveable) {
    benchmarkBug = true;
    reasons.push("Gate in v3Diagnostics on 200 but legacy parser only checks generationDiagnostics.v3Pipeline");
  }
  if (!hasApiGate && !hasV3Gate && !statusOk(status)) {
    apiBug = true;
    reasons.push("Failure response has no humanSaveabilityGate anywhere");
  }
  if (statusOk(status) && !hasV3Gate && !(v3?.sceneWorldLayer)) {
    if (raw.fastFallback === true || v3?.fastFallback === true) {
      apiBug = true;
      reasons.push("fast_fallback 200 audit response bypassed human saveability gate without humanSaveabilityGate payload");
    } else {
      apiBug = true;
      reasons.push("200 audit response missing humanSaveabilityGate in v3Diagnostics");
    }
  }
  if (modern.gateBypassed && legacy.rejectionReasons.length === 0) {
    benchmarkBug = true;
    reasons.push("fast_fallback bypass detected by modern parser but legacy parser returned empty rejectionReasons (unspecified)");
  }

  const classification = benchmarkBug && apiBug
    ? "both"
    : benchmarkBug
      ? "benchmark_bug"
      : apiBug
        ? "api_bug"
        : "neither";

  return { classification, reasons };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
