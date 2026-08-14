/**
 * Compare broken V20 vs corrected Experiment F benchmark results.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const BROKEN = resolve(ROOT, "reports/playlist-evaluation/v20-large-real-benchmark.json");
const CORRECTED = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-benchmark.json");
const OUT = resolve(ROOT, "reports/playlist-evaluation/v21-f-benchmark-comparison.json");

function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : null;
}

function pickSummary(s, scored) {
  return {
    successPct: s.successPct,
    http422: s.failed ? null : null,
    hcsMean: s.hcs?.mean,
    hcsMedian: s.hcs?.median,
    hcsP10: s.hcs?.p10,
    hcsP90: s.hcs?.p90,
    hcsMin: s.hcs?.min,
    hcsMax: s.hcs?.max,
    hcsGte80: s.hcs?.gte80Pct,
    saveYesPct: s.save?.yesPct,
    shareYesPct: s.share?.yesPct,
    pressPlayYesPct: s.pressPlay?.yesPct,
    fullPartialPct: s.deliveryTier
      ? pct((s.deliveryTier.FULL ?? 0) + (s.deliveryTier.PARTIAL ?? 0), scored)
      : s.deliveryTier?.fullPct != null
        ? s.deliveryTier.fullPct + (s.deliveryTier.partialPct ?? 0)
        : null,
    trackMean: s.trackCount?.mean,
    sequencingMean: s.dimensionStats?.sequencing?.mean ?? null,
    varietyMean: s.dimensionStats?.variety?.mean ?? null,
  };
}

function main() {
  const broken = JSON.parse(readFileSync(BROKEN, "utf8"));
  const corrected = JSON.parse(readFileSync(CORRECTED, "utf8"));

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
      oldHcs: old.hcs ?? null,
      newHcs: row.hcs ?? null,
      deltaHcs: (row.hcs ?? 0) - (old.hcs ?? 0),
      oldSeq: old.dimensions?.sequencing?.score ?? null,
      newSeq: row.dimensions?.sequencing?.score ?? null,
      oldSave: old.save,
      newSave: row.save,
      oldShare: old.share,
      newShare: row.share,
      oldPressPlay: old.pressPlay,
      newPressPlay: row.pressPlay,
      oldTracks: old.trackCount,
      newTracks: row.trackCount,
    });
  }

  deltas.sort((a, b) => b.deltaHcs - a.deltaHcs);

  const payload = {
    generatedAt: new Date().toISOString(),
    broken: {
      commit: broken.commit,
      runCount: broken.runCount,
      summary: broken.summary,
      metrics: pickSummary(broken.summary, brokenOk.length),
    },
    corrected: {
      commit: corrected.commit,
      runCount: corrected.runCount,
      summary: corrected.summary,
      metrics: pickSummary(corrected.summary, correctedOk.length),
    },
    delta: {
      hcsMean: (corrected.summary?.hcs?.mean ?? 0) - (broken.summary?.hcs?.mean ?? 0),
      saveYesPct: (corrected.summary?.save?.yesPct ?? 0) - (broken.summary?.save?.yesPct ?? 0),
      shareYesPct: (corrected.summary?.share?.yesPct ?? 0) - (broken.summary?.share?.yesPct ?? 0),
      pressPlayYesPct: (corrected.summary?.pressPlay?.yesPct ?? 0) - (broken.summary?.pressPlay?.yesPct ?? 0),
    },
    promptDeltas: deltas,
    largestRecovery: deltas.slice(0, 20),
    largestDecrease: [...deltas].sort((a, b) => a.deltaHcs - b.deltaHcs).slice(0, 20),
    saveChanges: deltas.filter((d) => d.oldSave !== d.newSave).length,
    shareChanges: deltas.filter((d) => d.oldShare !== d.newShare).length,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload.delta, null, 2));
}

main();
