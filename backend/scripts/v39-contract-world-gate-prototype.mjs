#!/usr/bin/env node
/**
 * V39 Contract World Gate — offline gate matrix + optional live A/B.
 *
 * Usage:
 *   node backend/scripts/v39-contract-world-gate-prototype.mjs
 *   PLAYLIST_CONTRACT_WORLD_GATE=1 node backend/scripts/v39-contract-world-gate-prototype.mjs --live
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");
const OUT_JSON = resolve(OUT_DIR, "v39-contract-world-gate-prototype.json");
const OUT_MD = resolve(OUT_DIR, "V39_CONTRACT_WORLD_GATE_PROTOTYPE.md");
const MATRIX_V2 = resolve(OUT_DIR, "combinatorial-world-matrix-v2.json");
const V37_JSON = resolve(OUT_DIR, "v37-fresh-validation.json");

const PROBES = [
  { id: "probe-01", category: "mood", prompt: "sad party bangers" },
  { id: "probe-02", category: "ambiguous", prompt: "energetic but not cheesy" },
  { id: "probe-03", category: "ambiguous", prompt: "something nostalgic for driving" },
  { id: "probe-04", category: "explicit_genre", prompt: "deep house afterparty" },
  { id: "probe-05", category: "ambiguous", prompt: "chilled but not boring" },
  { id: "probe-06", category: "genre_activity", prompt: "UK grime workout" },
  { id: "probe-07", category: "genre_activity", prompt: "drum and bass night drive" },
  { id: "probe-08", category: "genre_activity", prompt: "lo-fi study focus" },
  { id: "probe-09", category: "genre_era", prompt: "2000s pop punk gym workout" },
  { id: "probe-10", category: "context", prompt: "dad rock BBQ" },
  { id: "probe-11", category: "explicit_genre", prompt: "sunset beach reggae" },
  { id: "probe-12", category: "explicit_genre", prompt: "late night UK garage drive" },
  { id: "probe-13", category: "context", prompt: "rainy motorway night drive" },
  { id: "probe-14", category: "explicit_genre", prompt: "classic country road trip" },
  { id: "probe-15", category: "explicit_genre", prompt: "hard techno gym" },
];

const CONTROLS = [
  "dad rock BBQ",
  "sunset beach reggae",
  "2000s pop punk gym workout",
  "late night UK garage drive",
  "rainy motorway night drive",
  "classic country road trip",
];

async function loadBackend() {
  const { createRequire } = await import("node:module");
  return createRequire(resolve(ROOT, "package.json"));
}

async function evaluateOffline() {
  const require = await loadBackend();
  const { resolveCommittedWorld } = require("./backend/dist/core/committed-world.js");
  const { buildPlaylistContract } = require("./backend/dist/core/playlist-contract/build-playlist-contract.js");
  const { compareContractWithWorld } = require("./backend/dist/core/playlist-contract/compare-with-world.js");
  const { evaluateWorldGate, buildWorldGateAuditDiagnostics } = require("./backend/dist/core/playlist-contract/world-gate.js");
  const { setPlaylistContractWorldGateEnabled } = require("./backend/dist/core/playlist-contract/feature-flag.js");

  setPlaylistContractWorldGateEnabled(true);

  const rows = [];
  for (const row of PROBES) {
    const world = resolveCommittedWorld({ prompt: row.prompt });
    const contract = buildPlaylistContract({ prompt: row.prompt, committedWorld: world });
    const disagreements = compareContractWithWorld(contract, world);
    const decision = evaluateWorldGate({ contract, world, disagreements });
    const audit = buildWorldGateAuditDiagnostics(decision, contract);
    rows.push({
      ...row,
      originalWorld: world?.id ?? null,
      originalHardLock: world?.hardLock ?? false,
      deferHardLock: decision.deferHardLock,
      deferReasons: decision.reasons,
      finalMode: decision.mode,
      mustGenres: contract.must.genres.map((g) => g.value),
      tensions: contract.tension.map((t) => t.description),
      mustNot: contract.mustNot.map((n) => n.value),
      disagreements: disagreements.map((d) => d.kind),
      audit,
    });
  }

  let matrixDefer = 0;
  let matrixTotal = 0;
  if (existsSync(MATRIX_V2)) {
    const matrix = JSON.parse(readFileSync(MATRIX_V2, "utf8"));
    const items = matrix.results ?? matrix.rows ?? [];
    for (const item of items) {
      matrixTotal += 1;
      const prompt = item.prompt;
      const world = resolveCommittedWorld({ prompt });
      const contract = buildPlaylistContract({ prompt, committedWorld: world });
      const disagreements = compareContractWithWorld(contract, world);
      const decision = evaluateWorldGate({ contract, world, disagreements });
      if (decision.deferHardLock) matrixDefer += 1;
    }
  }

  const deferRate = rows.filter((r) => r.deferHardLock).length / Math.max(1, rows.length);
  const controlRegressions = rows.filter(
    (r) => CONTROLS.includes(r.prompt) && r.deferHardLock,
  );

  setPlaylistContractWorldGateEnabled(null);

  return {
    generatedAt: new Date().toISOString(),
    mode: "offline_gate_matrix",
    probeRows: rows,
    summary: {
      probeCount: rows.length,
      deferCount: rows.filter((r) => r.deferHardLock).length,
      deferRate: Math.round(deferRate * 1000) / 1000,
      matrixTotal,
      matrixDefer,
      matrixDeferRate: matrixTotal ? Math.round((matrixDefer / matrixTotal) * 1000) / 1000 : null,
      controlRegressions: controlRegressions.map((r) => r.prompt),
      byCategory: Object.fromEntries(
        [...new Set(rows.map((r) => r.category))].map((cat) => [
          cat,
          {
            count: rows.filter((r) => r.category === cat).length,
            defer: rows.filter((r) => r.category === cat && r.deferHardLock).length,
          },
        ]),
      ),
    },
    v37Baseline: existsSync(V37_JSON)
      ? JSON.parse(readFileSync(V37_JSON, "utf8")).summary ?? null
      : null,
    liveAb: null,
  };
}

function renderMd(result) {
  const s = result.summary;
  let md = `# V39 Contract World Gate Prototype\n\n`;
  md += `**Generated:** ${result.generatedAt}\n\n`;
  md += `## 1. Implementation\n\n`;
  md += `- Module: \`backend/core/playlist-contract/world-gate.ts\`\n`;
  md += `- Integration: \`generation.controller.ts\` pre-retrieval (~7064) via \`resolveWorldGateContext()\`\n`;
  md += `- Flag: \`PLAYLIST_CONTRACT_WORLD_GATE=1\` (off by default)\n`;
  md += `- Retrieval override: \`committedWorldOverride\` on orchestrator + pipeline\n\n`;
  md += `## 2. World defer rates\n\n`;
  md += `| Metric | Value |\n|--------|------:|\n`;
  md += `| Probe defer rate | ${(s.deferRate * 100).toFixed(1)}% (${s.deferCount}/${s.probeCount}) |\n`;
  md += `| Matrix defer rate | ${s.matrixDeferRate != null ? `${(s.matrixDeferRate * 100).toFixed(1)}% (${s.matrixDefer}/${s.matrixTotal})` : "n/a"} |\n\n`;
  md += `## 3. Category breakdown\n\n`;
  md += `| Category | Defer / Total |\n|----------|-------------:|\n`;
  for (const [cat, v] of Object.entries(s.byCategory)) {
    md += `| ${cat} | ${v.defer}/${v.count} |\n`;
  }
  md += `\n## 4. Control regressions (known-good prompts deferred)\n\n`;
  md += s.controlRegressions.length
    ? s.controlRegressions.map((p) => `- ${p}`).join("\n")
    : "- None\n";
  md += `\n\n## 5. Probe table\n\n`;
  md += `| Prompt | World | Defer | Reasons |\n|--------|-------|:-----:|---------|\n`;
  for (const r of result.probeRows) {
    md += `| ${r.prompt} | ${r.originalWorld} | ${r.deferHardLock ? "yes" : "no"} | ${r.deferReasons.join(", ")} |\n`;
  }
  md += `\n## 6. Architectural hypothesis\n\n`;
  md += s.deferCount > 0 && s.controlRegressions.length === 0
    ? "**Supported offline** — gate defers collapsed worlds on tension/MUST mismatch without deferring explicit controls.\n"
    : "**Partial / needs live A/B** — review defer decisions and control regressions before promotion.\n";
  md += `\n## 7. Production status\n\n`;
  md += `V37 unchanged when \`PLAYLIST_CONTRACT_WORLD_GATE\` is off.\n`;
  md += `\n## 8. Next step\n\n`;
  md += `Run live 28-prompt A/B with flag on to measure MUST satisfaction, wrong-world rate, and pool size changes.\n`;
  return md;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const result = await evaluateOffline();
  writeFileSync(OUT_JSON, JSON.stringify(result, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMd(result), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
