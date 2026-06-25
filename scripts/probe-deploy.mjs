import { assertAuditResponse, loadBenchmarkEnv, requireProductionAuth } from "./load-benchmark-env.mjs";

const cfg = await requireProductionAuth(await loadBenchmarkEnv());
const res = await fetch(`${cfg.baseUrl}/api/generate?audit=1`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-kwalify-evaluation-token": cfg.token,
  },
  body: JSON.stringify({
    vibe: "music for thinking",
    mode: "balanced",
    length: 25,
    varietyBoost: true,
    auditMode: true,
    spotifyUserId: cfg.spotifyUserId,
  }),
});
const data = await res.json();
assertAuditResponse(res, data, { script: "probe-deploy" });

console.log(JSON.stringify({
  status: res.status,
  success: data.success,
  tokenSource: cfg.tokenSource,
  deploymentVersion: data.deploymentVersion ?? data.commitHash ?? null,
  trackCount: (data.tracks || []).length,
  sample: (data.tracks || []).slice(0, 5).map((t) => `${t.trackName} — ${t.artistName}`),
}, null, 2));

if (res.status !== 200 || !Array.isArray(data.tracks) || data.tracks.length === 0) {
  process.exit(1);
}
