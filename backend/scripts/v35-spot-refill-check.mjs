#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
const creds = await resolveLiveBenchmarkCredentials({ strict: true, defaultBaseUrl: "http://127.0.0.1:5000" });
const prompt = process.argv[2] ?? "sunset beach reggae";
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
    requestId: `v35-spot-${Date.now()}`,
  }),
});
const data = await res.json();
const fin = data.finalization?.diagnostics?.deliverableDepthRefill;
const pur = data.generationDiagnostics?.puritySubFunnel ?? data.puritySubFunnel ?? {};
const mutations = (data.finalization?.pipelineAuthority?.mutations ?? []).filter((m) =>
  /refill/i.test(String(m.stage ?? "")),
);
console.log(JSON.stringify({
  prompt,
  delivered: (data.tracks ?? []).length,
  deliverableDepthRefill: fin,
  postDeliverableDepthRefillCount: pur.postDeliverableDepthRefillCount,
  refillMutations: mutations,
}, null, 2));
