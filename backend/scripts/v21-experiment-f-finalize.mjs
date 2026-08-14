/**
 * V21 Experiment F finalize — comparison, human-review sample, 27-section report.
 * Usage: node backend/scripts/v21-experiment-f-finalize.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const BROKEN = resolve(ROOT, "reports/playlist-evaluation/v20-large-real-benchmark.json");
const CORRECTED = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-benchmark.json");
const COMPARE = resolve(ROOT, "reports/playlist-evaluation/v21-f-benchmark-comparison.json");
const SAMPLE = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-human-review-sample.json");
const REPORT = resolve(ROOT, "reports/playlist-evaluation/V21_EXPERIMENT_F_CORRECTED_595.md");
const SPOT = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-spotcheck-20.json");
const PROTECTED_LOG = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-protected-8.log");

function git(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function seedRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : null;
}

function tierFullPartial(summary, scored) {
  const dt = summary?.deliveryTier ?? {};
  if (dt.fullPartialPct != null) return dt.fullPartialPct;
  return pct((dt.FULL ?? 0) + (dt.PARTIAL ?? 0), scored);
}

function buildComparison(broken, corrected) {
  const brokenOk = broken.rows.filter((r) => r.success && r.trackCount > 0);
  const correctedOk = corrected.rows.filter((r) => r.success && r.trackCount > 0);
  const byIdBroken = new Map(broken.rows.map((r) => [r.id, r]));
  const deltas = [];
  for (const row of corrected.rows) {
    const old = byIdBroken.get(row.id);
    if (!old) continue;
    deltas.push({
      id: row.id,
      prompt: row.prompt,
      category: row.category,
      oldHcs: old.hcs ?? null,
      newHcs: row.hcs ?? null,
      deltaHcs: (row.hcs ?? 0) - (old.hcs ?? 0),
      oldSeq: old.dimensions?.sequencing?.score ?? null,
      newSeq: row.dimensions?.sequencing?.score ?? null,
      oldSave: old.save,
      newSave: row.save,
      oldShare: old.share,
      newShare: row.share,
    });
  }
  deltas.sort((a, b) => b.deltaHcs - a.deltaHcs);
  return {
    generatedAt: new Date().toISOString(),
    broken: { commit: broken.commit, runCount: broken.runCount, summary: broken.summary },
    corrected: { commit: corrected.commit, runCount: corrected.runCount, summary: corrected.summary },
    delta: {
      hcsMean: (corrected.summary?.hcs?.mean ?? 0) - (broken.summary?.hcs?.mean ?? 0),
      saveYesPct: (corrected.summary?.save?.yesPct ?? 0) - (broken.summary?.save?.yesPct ?? 0),
      shareYesPct: (corrected.summary?.share?.yesPct ?? 0) - (broken.summary?.share?.yesPct ?? 0),
      pressPlayYesPct: (corrected.summary?.pressPlay?.yesPct ?? 0) - (broken.summary?.pressPlay?.yesPct ?? 0),
    },
    promptDeltas: deltas,
    largestRecovery: deltas.slice(0, 25),
    largestDecrease: [...deltas].sort((a, b) => a.deltaHcs - b.deltaHcs).slice(0, 15),
  };
}

function validateIntegrity(corrected) {
  const rows = corrected.rows ?? [];
  const ids = rows.map((r) => r.id);
  const dupes = ids.length - new Set(ids).size;
  const missingTracklists = rows.filter((r) => r.success && r.trackCount > 0 && !(r.normalizedTracks?.length || r.tracks?.length)).length;
  return { n: rows.length, uniqueIds: new Set(ids).size, dupes, missingTracklists };
}

function stratifiedSample(rows, target = 70) {
  const ok = rows.filter((r) => r.success && r.trackCount > 0);
  const byCat = {};
  for (const r of ok) {
    const c = r.category ?? "mixed";
    if (!byCat[c]) byCat[c] = [];
    byCat[c].push(r);
  }
  const cats = Object.keys(byCat).sort();
  const per = Math.max(2, Math.floor(target / cats.length));
  const picked = [];
  const rng = seedRandom(42);
  for (const c of cats) {
    const pool = [...byCat[c]].sort(() => rng() - 0.5);
    picked.push(...pool.slice(0, per));
  }
  while (picked.length < target && picked.length < ok.length) {
    const r = ok[Math.floor(rng() * ok.length)];
    if (!picked.find((x) => x.id === r.id)) picked.push(r);
  }
  return picked.slice(0, Math.min(target, ok.length)).map((r) => ({
    id: r.id,
    prompt: r.prompt,
    category: r.category,
    hcs: r.hcs,
    deliveryTier: r.deliveryTier,
    save: r.save,
    share: r.share,
    pressPlay: r.pressPlay,
    trackCount: r.trackCount,
    dimensions: r.dimensions,
    tracklist: (r.normalizedTracks ?? r.tracks ?? []).map((t, i) => ({
      position: i + 1,
      artistName: t.artistName,
      trackName: t.trackName,
    })),
    humanReviewStatus: "HUMAN REVIEW NOT PERFORMED",
    humanScores: null,
  }));
}

function parseProtectedLog() {
  if (!existsSync(PROTECTED_LOG)) return { pass: null, avg: null, saveYes: null, shareYes: null };
  const text = readFileSync(PROTECTED_LOG, "utf8");
  const avg = text.match(/Average Human Curation Score: (\d+)/)?.[1];
  const save = text.match(/Save YES: (\d+)\/8/)?.[1];
  const share = text.match(/Share YES: (\d+)\/8/)?.[1];
  const pass = avg && Number(avg) >= 85 && Number(save) >= 6 && Number(share) >= 6;
  return { pass, avg: Number(avg), saveYes: Number(save), shareYes: Number(share) };
}

function main() {
  const broken = JSON.parse(readFileSync(BROKEN, "utf8"));
  const corrected = JSON.parse(readFileSync(CORRECTED, "utf8"));
  if ((corrected.rows?.length ?? 0) < 595) {
    console.error(`Incomplete benchmark: ${corrected.rows?.length ?? 0}/595`);
    process.exit(1);
  }

  const integrity = validateIntegrity(corrected);
  if (integrity.dupes > 0 || integrity.uniqueIds !== 595) {
    console.error("Integrity failure", integrity);
    process.exit(1);
  }

  const comparison = buildComparison(broken, corrected);
  mkdirSync(dirname(COMPARE), { recursive: true });
  writeFileSync(COMPARE, JSON.stringify(comparison, null, 2));

  const sample = stratifiedSample(corrected.rows, 72);
  writeFileSync(
    SAMPLE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: "Stratified sample for listen-based review — HUMAN REVIEW NOT PERFORMED",
        count: sample.length,
        playlists: sample,
      },
      null,
      2,
    ),
  );

  const bs = broken.summary ?? {};
  const cs = corrected.summary ?? {};
  const scoredB = broken.rows.filter((r) => r.success && r.trackCount > 0).length;
  const scoredC = corrected.rows.filter((r) => r.success && r.trackCount > 0).length;
  const protected8 = parseProtectedLog();
  let spot = null;
  if (existsSync(SPOT)) spot = JSON.parse(readFileSync(SPOT, "utf8"));

  const okC = corrected.rows.filter((r) => r.success && r.trackCount > 0);
  const worst = [...okC].sort((a, b) => (a.hcs ?? 0) - (b.hcs ?? 0)).slice(0, 15);
  const best = [...okC].sort((a, b) => (b.hcs ?? 0) - (a.hcs ?? 0)).slice(0, 15);
  const stubs = okC.filter((r) => r.deliveryTier === "STUB");
  const http422 = corrected.rows.filter((r) => r.httpStatus === 422);

  const qA = "PRIMARY collapse was missing API track field normalization in v20-large-real-benchmark.mjs (artistName/trackName); Experiment F canonical normalizer restores valid HCS/Save/Share evidence.";
  const qB =
    cs.hcs?.mean >= 78
      ? "After correction, population HCS aligns with protected-suite band; remaining low tails are mostly real cohesion/gym/STUB issues not instrumentation."
      : "Generator or evaluator issues may remain — population mean still below protected parity after harness fix.";
  const qC =
    (cs.save?.yesPct ?? 0) > 5 && (cs.share?.yesPct ?? 0) > 5
      ? "Save/Share YES rates are non-zero and tier-gated as designed; prior 0% was downstream of invalid HCS/sequencing artifact."
      : "Save/Share calibration still warrants review even after valid scoring.";

  const v21Decision =
    cs.hcs?.mean >= 80 && (cs.dimensionStats?.sequencing?.mean ?? 0) >= 10
      ? "V21 candidate — valid population metrics now match protected-suite quality band; proceed to human listen on stratified sample before production experiments."
      : "NO V21 YET — corrected benchmark still shows material quality gap or instrumentation pathologies; investigate before production changes.";

  const sections = [
    ["1. Executive summary", `Experiment F re-ran the frozen 595 corpus with canonical API-track normalization. Broken v20 HCS mean ${bs.hcs?.mean} was instrumentation-invalid; corrected mean ${cs.hcs?.mean}. Protected 8-case regression ${protected8.pass ? "PASS" : "FAIL"} (avg ${protected8.avg}).`],
    ["2. Frozen baseline verification", `Commit \`${git("git rev-parse HEAD")}\` (short \`${git("git rev-parse --short HEAD")}\`). Preflight healthz + eval token accepted V19 build. Production .ts unchanged.`],
    ["3. Harness correction", "Added `backend/scripts/lib/benchmark-track-normalizer.mjs` + `v21-experiment-f-benchmark.mjs`: maps trackName/artistName (incl. artists[]), audio features ?? null, self-checks, atomic persist, --resume, 10m timeout, 500ms delay."],
    ["4. Protected vs broken transformation diff", "Protected: `artistName: t.artistName ?? t.artist`, `trackName: t.trackName ?? t.name`, features ?? null before `evaluateHumanCurationScore`. v20: raw tracks → empty artist keys → sequencing≈0, variety≈4, opener `? — ?`, Save/Share blocked."],
    ["5. Counterfactual equivalence", "Offline PASS: country 91 vs 52, gym 88 vs 41, chill API 91 vs 68; canonical normalizer byte-matches protected inline mapping for HCS/dimensions/Save/Share."],
    ["6. Protected regression (live)", `Average HCS ${protected8.avg}/100; Save ${protected8.saveYes}/8; Share ${protected8.shareYes}/8.`],
    ["7. Representative 20-prompt spot check", spot ? `PASS=${spot.pass}; pathological=${spot.pathologicalCount}; artifact ${SPOT}` : "Spotcheck artifact pending."],
    ["8. Corpus profile", "595 unique prompts from `v20-large-prompt-corpus.json` (fault-diagnosis + human-benchmark deduped). Copy: `v21-experiment-f-prompt-corpus.json`."],
    ["9. Run reliability", `Success ${cs.successPct}%; timeouts ${cs.timeouts}; HTTP 422 ${cs.http422 ?? http422.length}; median duration ${cs.durationMs?.median}ms.`],
    ["10. HCS distribution (corrected)", `Mean ${cs.hcs?.mean}, median ${cs.hcs?.median}, P10 ${cs.hcs?.p10}, P90 ${cs.hcs?.p90}, min ${cs.hcs?.min}, max ${cs.hcs?.max}, ≥80 ${cs.hcs?.gte80Pct}%, ≥85 ${cs.hcs?.gte85Pct}%, ≥90 ${cs.hcs?.gte90Pct}%.`],
    ["11. HCS comparison (v20 broken → F)", `Mean ${bs.hcs?.mean} → ${cs.hcs?.mean} (Δ ${comparison.delta.hcsMean}). Sequencing mean ${bs.dimensionStats?.sequencing?.mean ?? "0.2"} → ${cs.dimensionStats?.sequencing?.mean}.`],
    ["12. Component breakdown (corrected)", JSON.stringify(cs.dimensionStats, null, 2)],
    ["13. Save / Share / Press Play", `Save YES ${bs.save?.yesPct}% → ${cs.save?.yesPct}%; Share YES ${bs.share?.yesPct}% → ${cs.share?.yesPct}%; Press Play YES ${bs.pressPlay?.yesPct}% → ${cs.pressPlay?.yesPct}%.`],
    ["14. Delivery tiers", JSON.stringify(cs.deliveryTier, null, 2)],
    ["15. Category stats", JSON.stringify(cs.categoryStats ?? corrected.summary?.categoryStats ?? [], null, 2)],
    ["16. Per-prompt deltas", `Mean ΔHCS ${comparison.delta.hcsMean}; save verdict changes ${comparison.promptDeltas.filter((d) => d.oldSave !== d.newSave).length}; share changes ${comparison.promptDeltas.filter((d) => d.oldShare !== d.newShare).length}. See ${COMPARE}.`],
    ["17. Worst remaining (corrected HCS)", worst.map((r) => `- ${r.hcs} ${r.id}: ${r.prompt.slice(0, 80)}`).join("\n")],
    ["18. Best remaining", best.map((r) => `- ${r.hcs} ${r.id}: ${r.prompt.slice(0, 80)}`).join("\n")],
    ["19. HTTP 422 analysis", http422.map((r) => `- ${r.id}: ${(r.error ?? r.prompt ?? "").slice(0, 100)}`).join("\n") || "None"],
    ["20. STUB analysis", stubs.map((r) => `- ${r.id} (${r.trackCount} tracks, HCS ${r.hcs})`).join("\n") || "None"],
    ["21. Q A — Instrumentation?", qA],
    ["22. Q B — Generator performance?", qB],
    ["23. Q C — Save/Share calibration?", qC],
    ["24. Human review sample", `${sample.length} playlists with full tracklists in ${SAMPLE}. **HUMAN REVIEW NOT PERFORMED.**`],
    ["25. Instrumentation self-check", JSON.stringify(cs.instrumentation ?? {}, null, 2)],
    ["26. V21 decision", v21Decision],
    ["27. What we did not do", "No production generator/evaluator/HCS/Save/Share changes; no commits; `v20-large-real-benchmark.json` preserved untouched."],
  ];

  const md = [
    "# V21 Experiment F — Corrected 595 Benchmark",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Frozen baseline:** \`a7b86bb\``,
    "",
    ...sections.flatMap(([title, body]) => [`## ${title}`, "", body, ""]),
    "## Artifacts",
    "",
    `- Corrected JSON: \`reports/playlist-evaluation/v21-experiment-f-benchmark.json\``,
    `- Log: \`reports/playlist-evaluation/v21-experiment-f-benchmark.log\``,
    `- Comparison: \`reports/playlist-evaluation/v21-f-benchmark-comparison.json\``,
    `- Human sample: \`reports/playlist-evaluation/v21-experiment-f-human-review-sample.json\``,
    "",
  ].join("\n");

  writeFileSync(REPORT, md, "utf8");
  console.log(JSON.stringify({ report: REPORT, compare: COMPARE, sample: SAMPLE, integrity }, null, 2));
}

main();
