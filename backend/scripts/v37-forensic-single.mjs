#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const prompt = process.argv[2] ?? "feel-good soul";

function loadDotEnv() {
  const p = resolve(ROOT, ".env");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadDotEnv();
const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
const creds = resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: "http://127.0.0.1:5000" });
const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": creds.token },
  body: JSON.stringify({
    vibe: prompt,
    mode: "balanced",
    length: 25,
    varietyBoost: true,
    auditMode: true,
    spotifyUserId: "koalablade",
    requestId: `v37-forensic-${Date.now()}`,
  }),
});
const data = await res.json();
const fin = data.finalization ?? {};
const auth = fin.pipelineAuthority ?? {};
const muts = (auth.mutations ?? []).map((m) => ({
  stage: m.stage,
  before: m.beforeCount,
  after: m.afterCount,
  removed: m.tracksRemoved,
}));
const dl = data.generationDiagnostics?.deliveryLossFunnel ?? data.deliveryLossFunnel ?? {};
const diag = fin.diagnostics ?? {};
const hqg = diag.humanQualityGate ?? diag.humanQualityGateLate ?? null;
console.log(JSON.stringify({
  prompt,
  delivered: (data.tracks ?? []).length,
  committedWorld: data.committedWorld ?? data.generationDiagnostics?.committedWorld,
  deliveryLossFunnel: dl,
  mutations: muts,
  humanQualityGate: hqg,
  humanQualityGateLate: diag.humanQualityGateLate,
  intentFidelityGate: diag.intentFidelityGate,
  artistCapDiverseRefill: diag.artistCapDiverseRefill,
  postApiRefillArtistCap: diag.postApiRefillArtistCap,
  humanSaveUnsavableCap: diag.humanSaveUnsavableCap,
  degradedDelivery: diag.degradedDelivery,
  thinLibraryDeliveryCapApplied: diag.thinLibraryDeliveryCapApplied,
  honestPartialPublished: diag.honestPartialPublished,
  coverageLevel: data.generationDiagnostics?.worldCoverage?.score ?? null,
}, null, 2));
