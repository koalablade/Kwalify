#!/usr/bin/env node
/**
 * V22 Phase 0 — capture V21 baseline snapshot (read-only on V21 artifacts).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation/v22-controlled-corrective");
const BENCH = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-f-benchmark.json");
const G_DIAG = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-diagnostic.json");
const G_LISTEN = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-listen-analysis.json");
const G_REVIEW = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-human-review-set.json");

function getHeadCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeBenchmark(rows) {
  const ok = rows.filter((r) => r.success);
  const scored = ok.filter((r) => r.trackCount > 0 && r.hcs != null);
  const hcs = scored.map((r) => r.hcs).sort((a, b) => a - b);
  const count = (field, val) => scored.filter((r) => r[field] === val).length;
  return {
    total: rows.length,
    success: ok.length,
    scored: scored.length,
    hcsMean: hcs.length ? Math.round((hcs.reduce((a, b) => a + b, 0) / hcs.length) * 10) / 10 : null,
    hcsMedian: percentile(hcs, 50),
    saveYes: count("wouldSave", "YES"),
    shareYes: count("wouldShare", "YES"),
    shareMaybe: count("wouldShare", "MAYBE"),
    shareNo: count("wouldShare", "NO"),
    stubRate: scored.filter((r) => r.deliveryTier === "STUB").length / Math.max(1, scored.length),
    sequencingZero: scored.filter((r) => r.dimensions?.sequencing?.score === 0).length,
    openerUnknown: scored.filter((r) => r.opener === "? — ?").length,
    undefinedArtist: scored.filter((r) => (r.instrumentation?.undefinedArtistCount ?? 0) > 0).length,
  };
}

function templateRecurrence(tracklists) {
  const artists = ["Jungle Giants", "Wallows", "The 1975"];
  const counts = Object.fromEntries(artists.map((a) => [a, 0]));
  let playlistsWithNucleus = 0;
  for (const pl of tracklists) {
    let hasNucleus = false;
    for (const t of pl.tracklist ?? []) {
      const name = String(t.artistName ?? t.artist ?? "");
      for (const a of artists) {
        if (name.toLowerCase().includes(a.toLowerCase())) {
          counts[a] += 1;
          hasNucleus = true;
        }
      }
    }
    if (hasNucleus) playlistsWithNucleus += 1;
  }
  return { artistCounts: counts, playlistsWithNucleus, playlistCount: tracklists.length };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const bench = existsSync(BENCH) ? JSON.parse(readFileSync(BENCH, "utf8")) : null;
  const gDiag = existsSync(G_DIAG) ? JSON.parse(readFileSync(G_DIAG, "utf8")) : null;
  const gListen = existsSync(G_LISTEN) ? JSON.parse(readFileSync(G_LISTEN, "utf8")) : null;
  const gReview = existsSync(G_REVIEW) ? JSON.parse(readFileSync(G_REVIEW, "utf8")) : null;

  const criticalIds = ["G-016", "G-030", "G-032", "G-036", "G-023", "G-027"];
  const criticalCases = {};
  if (gDiag?.criticalTraces) {
    for (const row of gDiag.criticalTraces) {
      if (criticalIds.includes(row.reviewId)) criticalCases[row.reviewId] = row;
    }
  }
  if (gReview?.playlists) {
    for (const id of criticalIds) {
      const pl = gReview.playlists.find((p) => p.reviewId === id);
      if (pl && !criticalCases[id]) criticalCases[id] = { reviewId: id, prompt: pl.prompt, stored: pl._evaluator };
      if (pl) {
        criticalCases[id] = { ...(criticalCases[id] ?? {}), tracklist: pl.tracklist, prompt: pl.prompt };
      }
    }
  }

  const gTracklists = gReview?.playlists ?? [];
  const snapshot = {
    capturedAt: new Date().toISOString(),
    experiment: "v22-baseline-snapshot",
    sourceCommit: bench?.commit ?? null,
    v21Benchmark: bench
      ? {
          commit: bench.commit,
          commitShort: bench.commitShort,
          summary: summarizeBenchmark(bench.rows ?? []),
        }
      : null,
    gListenSummary: gListen?.summary ?? gListen?.stratumSummary ?? null,
    templateRecurrence: templateRecurrence(gTracklists),
    criticalCases,
    profileCoverageAtBaseline: {
      uk_garage_world: false,
      pop_punk_world: false,
      note: "V21 baseline captured before V22 cultural profiles",
    },
  };

  const outPath = resolve(OUT_DIR, "v21-baseline-snapshot.json");
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

main();
