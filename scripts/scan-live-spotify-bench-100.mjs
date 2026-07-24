/**
 * Post-scan for live Spotify bench-100: errors, high-ROI issues, full tracklists.
 *
 *   node scripts/scan-live-spotify-bench-100.mjs reports/live-spotify-verify/bench-100-test-2
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const outDir = process.argv[2] ?? "reports/live-spotify-verify/bench-100-test-2";

function mean(nums) {
  const xs = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pct(n, d) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

function genreBlob(track) {
  return [track.genrePrimary, track.genreFamily, ...(track.genres ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function analyzePlaylist(row) {
  const issues = [];
  const tracks = row.tracks ?? [];
  const n = tracks.length;
  const requested = row.requestedLength ?? 25;

  if (!row.ok) {
    issues.push({
      severity: "critical",
      code: "generation_failed",
      roi: "critical",
      detail: row.error ?? `HTTP ${row.status}`,
    });
  }

  if (row.ok && n === 0) {
    issues.push({ severity: "critical", code: "empty_delivery", roi: "critical", detail: "success but 0 tracks" });
  }

  if (row.ok && n > 0 && n < Math.min(8, Math.floor(requested * 0.4))) {
    issues.push({
      severity: "high",
      code: "severe_underfill",
      roi: "high",
      detail: `delivered ${n}/${requested}`,
    });
  } else if (row.ok && n < requested * 0.75) {
    issues.push({
      severity: "medium",
      code: "underfill",
      roi: "medium",
      detail: `delivered ${n}/${requested}`,
    });
  }

  if (row.ok && !row.spotifyPlaylistUrl) {
    issues.push({
      severity: "high",
      code: "spotify_create_missing",
      roi: "high",
      detail: "ok response but no Spotify URL",
    });
  }

  const artists = tracks.map((t) => (t.artistName || "").toLowerCase()).filter(Boolean);
  const artistCounts = new Map();
  for (const a of artists) artistCounts.set(a, (artistCounts.get(a) ?? 0) + 1);
  const topArtist = [...artistCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topArtist && n >= 8 && topArtist[1] / n >= 0.28) {
    issues.push({
      severity: "high",
      code: "artist_dominance",
      roi: "high",
      detail: `${topArtist[0]} = ${topArtist[1]}/${n} (${pct(topArtist[1], n)})`,
    });
  }

  const names = tracks.map((t) => `${(t.trackName || "").toLowerCase()}::${(t.artistName || "").toLowerCase()}`);
  const dupes = names.filter((x, i) => names.indexOf(x) !== i);
  if (dupes.length) {
    issues.push({
      severity: "medium",
      code: "duplicate_tracks",
      roi: "medium",
      detail: `${new Set(dupes).size} duplicate identities`,
    });
  }

  const scores = tracks.map((t) => t.score ?? t.confidence).filter((s) => typeof s === "number");
  const avgScore = mean(scores);
  if (avgScore != null && avgScore < 0.45 && n >= 5) {
    issues.push({
      severity: "medium",
      code: "low_avg_score",
      roi: "medium",
      detail: `avg score ${avgScore.toFixed(3)}`,
    });
  }

  const energies = tracks.map((t) => t.energy).filter((e) => typeof e === "number");
  const avgE = mean(energies);
  if (row.expectedEnergy === "high" && avgE != null && avgE < 0.45) {
    issues.push({
      severity: "high",
      code: "energy_mismatch_low",
      roi: "high",
      detail: `expected high energy, avgE=${avgE.toFixed(3)}`,
    });
  }
  if (row.expectedEnergy === "low" && avgE != null && avgE > 0.65) {
    issues.push({
      severity: "high",
      code: "energy_mismatch_high",
      roi: "high",
      detail: `expected low energy, avgE=${avgE.toFixed(3)}`,
    });
  }

  const expectedGenres = (row.expectedGenres ?? []).map((g) => g.toLowerCase());
  if (expectedGenres.length && n >= 5) {
    const hits = tracks.filter((t) => {
      const blob = genreBlob(t);
      return expectedGenres.some((g) => blob.includes(g) || g.split(" ").every((w) => blob.includes(w)));
    }).length;
    const hitRate = hits / n;
    if (hitRate < 0.25) {
      issues.push({
        severity: "high",
        code: "genre_miss",
        roi: "high",
        detail: `expected [${expectedGenres.join(", ")}] genre-hit ${pct(hits, n)}`,
      });
    }
  }

  if (row.expectedEra && n >= 5) {
    const years = tracks.map((t) => t.releaseYear).filter((y) => typeof y === "number");
    if (years.length >= 3) {
      const out = years.filter((y) => y < row.expectedEra.start || y > row.expectedEra.end);
      if (out.length / years.length > 0.4) {
        issues.push({
          severity: "medium",
          code: "era_drift",
          roi: "medium",
          detail: `${out.length}/${years.length} outside ${row.expectedEra.start}-${row.expectedEra.end}`,
        });
      }
    }
  }

  const gate = row.diagnostics?.humanQualityGate;
  if (gate && (gate.action === "refuse" || gate.action === "honest_partial")) {
    issues.push({
      severity: gate.action === "refuse" ? "high" : "medium",
      code: `hqg_${gate.action}`,
      roi: gate.action === "refuse" ? "high" : "medium",
      detail: gate.reason ?? gate.message ?? gate.action,
    });
  }

  const roiRank = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => (roiRank[a.roi] ?? 9) - (roiRank[b.roi] ?? 9));
  return {
    issues,
    avgScore,
    avgEnergy: avgE,
    topArtists: [...artistCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([artist, count]) => ({ artist, count })),
  };
}

async function main() {
  const raw = JSON.parse(await readFile(path.join(outDir, "raw-results.json"), "utf8"));
  const results = raw.results ?? [];
  const analyzed = results.map((row) => {
    const scan = analyzePlaylist(row);
    return { ...row, scan };
  });

  const fails = analyzed.filter((r) => !r.ok);
  const withIssues = analyzed.filter((r) => r.scan.issues.length > 0);
  const byCode = new Map();
  for (const r of withIssues) {
    for (const issue of r.scan.issues) {
      const cur = byCode.get(issue.code) ?? { code: issue.code, roi: issue.roi, count: 0, examples: [] };
      cur.count += 1;
      if (cur.examples.length < 5) cur.examples.push({ id: r.id, prompt: r.prompt, detail: issue.detail, url: r.spotifyPlaylistUrl });
      byCode.set(issue.code, cur);
    }
  }
  const roiOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const issueSummary = [...byCode.values()].sort(
    (a, b) => (roiOrder[a.roi] ?? 9) - (roiOrder[b.roi] ?? 9) || b.count - a.count
  );

  const highRoi = analyzed
    .filter((r) => r.scan.issues.some((i) => i.roi === "critical" || i.roi === "high"))
    .map((r) => ({
      id: r.id,
      prompt: r.prompt,
      category: r.category,
      ok: r.ok,
      trackCount: r.trackCount,
      url: r.spotifyPlaylistUrl,
      issues: r.scan.issues.filter((i) => i.roi === "critical" || i.roi === "high"),
    }));

  const summary = {
    n: results.length,
    pass: results.filter((r) => r.ok).length,
    fail: fails.length,
    withIssues: withIssues.length,
    highRoiCount: highRoi.length,
    meanTrackCount: mean(results.map((r) => r.trackCount)),
    meanAvgScore: mean(analyzed.map((r) => r.scan.avgScore).filter(Boolean)),
    meanElapsedMs: mean(results.map((r) => r.elapsedMs)),
    issueSummary,
    highRoi,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "roi-scan.json"), JSON.stringify({ summary, playlists: analyzed }, null, 2));

  const fullTrackMd = [
    "# Bench 100 — Full tracklists (test 2)",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Pass: ${summary.pass}/${summary.n}`,
    "",
    ...analyzed.flatMap((r) => {
      const lines = [
        `## ${r.id}`,
        "",
        `- Prompt: ${r.prompt}`,
        `- Category: ${r.category} · mode: ${r.mode}`,
        `- Status: ${r.ok ? "ok" : "FAIL"} (${r.status})`,
        `- Playlist: ${r.playlistName ?? "—"}`,
        `- Spotify: ${r.spotifyPlaylistUrl ?? "—"}`,
        `- Tracks: ${r.trackCount}/${r.requestedLength}`,
        `- Playlist confidence: ${JSON.stringify(r.diagnostics?.playlistConfidence ?? null)}`,
        `- Human quality gate: ${JSON.stringify(r.diagnostics?.humanQualityGate ?? null)}`,
        `- Avg score: ${r.scan.avgScore?.toFixed?.(3) ?? "n/a"} · avg energy: ${r.scan.avgEnergy?.toFixed?.(3) ?? "n/a"}`,
        `- Top artists: ${r.scan.topArtists.map((a) => `${a.artist} (${a.count})`).join(", ") || "—"}`,
        ...(r.scan.issues.length
          ? [`- Issues: ${r.scan.issues.map((i) => `[${i.roi}/${i.code}] ${i.detail}`).join("; ")}`]
          : ["- Issues: none"]),
        ...(r.error ? [`- Error: ${r.error}`] : []),
        "",
        "| # | Track | Artist | Year | Genre | Score | Energy | Valence |",
        "|---:|---|---|---:|---|---:|---:|---:|",
        ...(r.tracks ?? []).map((t) => {
          const genre = t.genrePrimary ?? t.genreFamily ?? (t.genres?.[0] ?? "—");
          return `| ${t.index} | ${t.trackName || "—"} | ${t.artistName || "—"} | ${t.releaseYear ?? "—"} | ${genre} | ${t.score ?? t.confidence ?? "—"} | ${t.energy ?? "—"} | ${t.valence ?? "—"} |`;
        }),
        "",
      ];
      return lines;
    }),
  ].join("\n");
  await writeFile(path.join(outDir, "FULL-TRACKLISTS.md"), fullTrackMd);

  const roiMd = [
    "# Bench 100 test 2 — Error / high-ROI scan",
    "",
    `Pass **${summary.pass}/${summary.n}** · issues on **${summary.withIssues}** · high-ROI flags **${summary.highRoiCount}**`,
    `Mean tracks: ${summary.meanTrackCount?.toFixed?.(1) ?? "n/a"} · mean score: ${summary.meanAvgScore?.toFixed?.(3) ?? "n/a"} · mean latency: ${summary.meanElapsedMs ? Math.round(summary.meanElapsedMs / 1000) + "s" : "n/a"}`,
    "",
    "## Highest-ROI issue classes",
    "",
    "| ROI | Code | Count | Examples |",
    "|---|---|---:|---|",
    ...issueSummary.map((row) => {
      const ex = row.examples.map((e) => `\`${e.id}\``).join(", ");
      return `| ${row.roi} | ${row.code} | ${row.count} | ${ex} |`;
    }),
    "",
    "## High-ROI playlists",
    "",
    ...(highRoi.length
      ? highRoi.flatMap((r) => [
          `### ${r.id}`,
          `- Prompt: ${r.prompt}`,
          `- Cat: ${r.category} · n=${r.trackCount} · ${r.url ?? "no url"}`,
          ...r.issues.map((i) => `- **${i.code}** (${i.roi}): ${i.detail}`),
          "",
        ])
      : ["_No critical/high ROI issues detected._", ""]),
    "## Failures",
    "",
    ...(fails.length
      ? fails.map((r) => `- **${r.id}** — ${r.prompt}: ${r.error}`)
      : ["_None_"]),
    "",
    "## Index (Spotify links)",
    "",
    "| # | ID | Prompt | n | Status | URL |",
    "|---:|---|---|---:|---|---|",
    ...analyzed.map((r, i) => {
      const link = r.spotifyPlaylistUrl ? `[open](${r.spotifyPlaylistUrl})` : "—";
      return `| ${i + 1} | ${r.id} | ${r.prompt} | ${r.trackCount} | ${r.ok ? "ok" : "fail"} | ${link} |`;
    }),
    "",
  ].join("\n");
  await writeFile(path.join(outDir, "ROI-SCAN.md"), roiMd);

  // Compact JSON of every track for tooling
  const allTracks = analyzed.flatMap((r) =>
    (r.tracks ?? []).map((t) => ({
      playlistId: r.id,
      prompt: r.prompt,
      category: r.category,
      playlistName: r.playlistName,
      spotifyPlaylistUrl: r.spotifyPlaylistUrl,
      ...t,
    }))
  );
  await writeFile(path.join(outDir, "all-tracks.json"), JSON.stringify(allTracks, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote:\n- ${path.join(outDir, "ROI-SCAN.md")}\n- ${path.join(outDir, "FULL-TRACKLISTS.md")}\n- ${path.join(outDir, "roi-scan.json")}\n- ${path.join(outDir, "all-tracks.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
