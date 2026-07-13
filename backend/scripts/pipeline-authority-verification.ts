/**
 * Pipeline Authority — static mutation site analysis + dynamic verification from harness results.
 *
 * Usage:
 *   npm run build && node backend/dist/scripts/pipeline-authority-verification.js
 *   npm run build && node backend/dist/scripts/pipeline-authority-verification.js --from reports/playlist-evaluation/latest
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  analyzeStaticMutationSites,
  verifyPipelineAuthorityDiagnostics,
  summarizeVerificationBatch,
  type PipelineAuthorityVerificationResult,
} from "../lib/pipeline-authority/verification";
import {
  analyzePipelineAuthorityGate,
  analyzePipelineQualityGate,
} from "../lib/pipeline-authority/harness-gates";
import { assertPipelineAuthorityDeployment } from "../lib/pipeline-authority/deployment-fingerprint";
import type { PipelineAuthorityDiagnostics } from "../lib/pipeline-authority/types";
import type { GenerationEvaluationResult } from "../lib/playlist-evaluation/metrics";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CONTROLLER_PATH = path.join(REPO_ROOT, "backend/controllers/generation.controller.ts");
const OUT_DIR = path.join(REPO_ROOT, "reports/architecture");

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

async function preflightDeployment(baseUrl: string, expectedCommit: string | null): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/api/readyz`);
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || data["status"] !== "ready") {
    throw new Error(`Deployment not ready: ${response.status} ${String(data["status"])}`);
  }
  const pipelineAuthority = data["pipelineAuthority"] as Record<string, unknown> | undefined;
  assertPipelineAuthorityDeployment(expectedCommit ?? String(data["commit"] ?? ""), {
    commit: String(data["commit"] ?? "unknown"),
    pipelineAuthority: pipelineAuthority
      ? { enabled: pipelineAuthority["enabled"] === true }
      : null,
  });
  return data;
}

async function loadHarnessRows(dir: string): Promise<GenerationEvaluationResult[]> {
  const jsonlPath = path.join(dir, "evaluation-results.jsonl");
  try {
    const jsonl = await readFile(jsonlPath, "utf8");
    return jsonl
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GenerationEvaluationResult);
  } catch {
    return [];
  }
}

async function runStaticAnalysis(): Promise<{
  sites: ReturnType<typeof analyzeStaticMutationSites>;
  totalCallSites: number;
  byKind: Record<string, number>;
}> {
  const source = await readFile(CONTROLLER_PATH, "utf8");
  const start = source.indexOf("const delivery = createPipelineDeliveryBuffer");
  const end = source.indexOf("const deliveredTracks = [...delivery.tracks]");
  const block = start >= 0 && end >= 0 ? source.slice(start, end) : source;
  const sites = analyzeStaticMutationSites(block);
  const byKind: Record<string, number> = {};
  for (const site of sites) {
    byKind[site.kind] = (byKind[site.kind] ?? 0) + 1;
  }
  return { sites, totalCallSites: sites.length, byKind };
}

async function loadHarnessResults(dir: string): Promise<PipelineAuthorityVerificationResult[]> {
  const jsonlPath = path.join(dir, "evaluation-results.jsonl");
  const resultsPath = path.join(dir, "results.json");
  let rows: Array<{
    ok: boolean;
    benchmark: { id: string };
    response: Record<string, unknown> | null;
  }> = [];
  try {
    const jsonl = await readFile(jsonlPath, "utf8");
    rows = jsonl
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as typeof rows[number]);
  } catch {
    try {
      const raw = await readFile(resultsPath, "utf8");
      rows = JSON.parse(raw) as typeof rows;
    } catch {
      console.warn(`No evaluation-results.jsonl or results.json at ${dir}`);
      return [];
    }
  }
  const out: PipelineAuthorityVerificationResult[] = [];
  for (const row of rows) {
    if (!row.ok || !row.response) continue;
    const finalization = row.response["finalization"] as Record<string, unknown> | undefined;
    const authority = finalization?.["pipelineAuthority"] as PipelineAuthorityDiagnostics | undefined;
    if (!authority) {
      out.push({
        pass: false,
        promptId: row.benchmark.id,
        mutationCount: 0,
        contentMutationCount: 0,
        freezeRecorded: false,
        timeline: [],
        checkpointProof: {
          pass: false,
          expected: [],
          observed: [],
          missing: [],
          duplicates: [],
          outOfOrder: true,
          details: ["pipelineAuthority missing from response"],
        },
        violations: ["pipelineAuthority_missing"],
      });
      continue;
    }
    out.push(verifyPipelineAuthorityDiagnostics(authority, { promptId: row.benchmark.id }));
  }
  return out;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const staticAnalysis = await runStaticAnalysis();
  const harnessDir = argValue("--from");
  const baseUrl = argValue("--base-url") ?? "http://localhost:5000";
  const expectedCommit = argValue("--expected-commit");

  let deployment: Record<string, unknown> | null = null;
  if (harnessDir || argValue("--preflight")) {
    deployment = await preflightDeployment(baseUrl, expectedCommit);
  }

  const dynamicResults = harnessDir ? await loadHarnessResults(path.resolve(harnessDir)) : [];
  const harnessRows = harnessDir ? await loadHarnessRows(path.resolve(harnessDir)) : [];
  const authorityGate = harnessRows.length > 0 ? analyzePipelineAuthorityGate(harnessRows) : null;
  const qualityGate = harnessRows.length > 0 ? analyzePipelineQualityGate(harnessRows) : null;
  const batchSummary = summarizeVerificationBatch(dynamicResults);

  const observedStages = new Set<string>();
  for (const result of dynamicResults) {
    for (const entry of result.timeline) {
      if (entry.mutationType !== "freeze") observedStages.add(entry.stage);
    }
  }

  const staticStages = new Set(staticAnalysis.sites.map((s) => s.stage));
  const unobservedStaticStages = [...staticStages].filter((s) => !observedStages.has(s) && s !== "v3_handoff");

  const report = {
    generatedAt: new Date().toISOString(),
    staticAnalysis: {
      controllerPath: "backend/controllers/generation.controller.ts",
      deliveryBlockOnly: true,
      totalMutationCallSites: staticAnalysis.totalCallSites,
      byKind: staticAnalysis.byKind,
      sites: staticAnalysis.sites,
    },
    dynamicVerification: harnessDir
      ? {
          harnessDir,
          ...batchSummary,
          perPrompt: dynamicResults.map((r) => ({
            promptId: r.promptId,
            pass: r.pass,
            contentMutationCount: r.contentMutationCount,
            violations: r.violations,
            checkpointProof: r.checkpointProof,
            timeline: r.timeline,
          })),
        }
      : { note: "No --from harness dir; run harness with audit mode to populate dynamic verification" },
    mutationCoverage: {
      staticCallSites: staticAnalysis.totalCallSites,
      dynamicAvgContentMutations: batchSummary.mutationCountAvg,
      dynamicMin: batchSummary.mutationCountMin,
      dynamicMax: batchSummary.mutationCountMax,
      registryCompletenessPerRequest: dynamicResults.length
        ? `${batchSummary.passed}/${batchSummary.total} requests passed authority verification`
        : "not measured",
      unobservedConditionalStages: unobservedStaticStages,
      note: "Authority pass is independent of playlist quality failures",
    },
    architecturePass: {
      evaluated: batchSummary.total,
      passed: batchSummary.passed,
      failed: batchSummary.failed,
      failurePromptIds: batchSummary.failurePromptIds,
      strictRcAuthorityGate: authorityGate,
    },
    qualityResults: qualityGate
      ? {
          evaluated: qualityGate.evaluated,
          passed: qualityGate.pass,
          failed: qualityGate.failures,
          failurePromptIds: qualityGate.failurePromptIds,
          violationIds: qualityGate.violationIds,
          note: "Quality failures do not affect architecture confidence",
        }
      : { note: "Run with --from harness dir containing evaluation-results.jsonl" },
    deployment: deployment
      ? {
          commit: deployment["commit"],
          pipelineAuthority: deployment["pipelineAuthority"],
          verified: true,
        }
      : {
          note: "Pass --preflight or --from to verify deployment fingerprint",
        },
  };

  const outPath = path.join(OUT_DIR, "pipeline-authority-verification-data.json");
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outPath, staticCallSites: staticAnalysis.totalCallSites, dynamic: batchSummary }));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
