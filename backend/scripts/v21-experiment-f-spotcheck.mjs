/**
 * V21 Experiment F — 20-prompt corpus spot check (seed=42).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeBenchmarkTracks,
  validateBenchmarkTrackNormalization,
  playlistInstrumentationDiagnostics,
} from "./lib/benchmark-track-normalizer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CORPUS = resolve(ROOT, "reports/playlist-evaluation/v20-large-prompt-corpus.json");
const OUT = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-spotcheck-20.json");
const SEED = 42;

function seedRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function main() {
  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const corpus = JSON.parse(readFileSync(CORPUS, "utf8")).prompts;
  const rng = seedRandom(SEED);
  const picked = [...corpus].sort(() => rng() - 0.5).slice(0, 20);
  const creds = await resolveLiveBenchmarkCredentials();
  const rows = [];
  for (const item of picked) {
    const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": creds.token },
      body: JSON.stringify({
        vibe: item.prompt,
        mode: "balanced",
        length: item.length ?? 25,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: creds.spotifyUserId,
        requestId: `v21-f-spot-${item.id}`,
        seed: SEED,
      }),
    });
    const data = await res.json().catch(() => ({}));
    const raw = data.tracks ?? data.playlist ?? [];
    const normalized = normalizeBenchmarkTracks(raw);
    const validation = validateBenchmarkTrackNormalization(raw, normalized);
    const score = raw.length ? evaluateHumanCurationScore(item.prompt, normalized) : null;
    const diag = score ? playlistInstrumentationDiagnostics(raw, normalized, score) : null;
    rows.push({
      id: item.id,
      prompt: item.prompt,
      httpStatus: res.status,
      trackCount: raw.length,
      hcs: score?.totalScore ?? null,
      sequencing: score?.dimensions.sequencing.score ?? null,
      opener: normalized[0] ? `${normalized[0].artistName} — ${normalized[0].trackName}` : null,
      pathological: diag?.pathological ?? false,
      undefinedTransitions: diag?.undefinedTransitionEvidenceCount ?? 0,
      normalizationOk: validation.ok,
      errors: validation.errors,
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  const pathological = rows.filter((r) => r.pathological || r.sequencing === 0 || r.opener?.includes("? — ?"));
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), rows, pathologicalCount: pathological.length, pass: pathological.length === 0 }, null, 2));
  console.log(JSON.stringify({ pass: pathological.length === 0, pathologicalCount: pathological.length, out: OUT }));
  if (pathological.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
