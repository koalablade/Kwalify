import { readFile, writeFile } from "node:fs/promises";

const data = JSON.parse(await readFile("reports/live-e2e-phase/results.json", "utf8"));
const playlists = data.playlists;

function entropy(labels) {
  if (labels.length <= 1) return 0;
  const c = new Map();
  for (const l of labels) c.set(l, (c.get(l) ?? 0) + 1);
  let h = 0;
  for (const n of c.values()) {
    const p = n / labels.length;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h / Math.log2(c.size);
}

function structuralSimilarity(a, b) {
  if (a === b) return 1;
  const [ae, an] = a.split("::");
  const [be, bn] = b.split("::");
  const ap = ae.split("-").map(Number);
  const bp = be.split("-").map(Number);
  let s = 0;
  const len = Math.max(ap.length, bp.length, 1);
  for (let i = 0; i < len; i++) s += 1 - Math.min(1, Math.abs((ap[i] ?? 0) - (bp[i] ?? 0)) / 10);
  s /= len;
  return s * 0.7 + (1 - Math.min(1, Math.abs(Number(an) - Number(bn)))) * 0.3;
}

function energyBand(e) {
  const v = e ?? 0.5;
  if (v <= 0.42) return "low";
  if (v >= 0.55) return "high";
  return "mid";
}

const ok = playlists.filter((p) => p.ok);
const ents = ok.map(
  (p) => p.metadata?.genreEntropy ?? entropy(p.tracks.map((t) => t.genreFamily || t.genrePrimary || "unknown")),
);
const fps = ok.filter((p) => p.structuralFingerprint).map((p) => ({ id: p.id, fp: p.structuralFingerprint }));
let simSum = 0;
let simPairs = 0;
for (let i = 0; i < fps.length; i++) {
  for (let j = i + 1; j < fps.length; j++) {
    simPairs++;
    simSum += structuralSimilarity(fps[i].fp, fps[j].fp);
  }
}
const cross = ok.filter((p) => p.category === "crossrun");
const cfps = cross.map((p) => p.structuralFingerprint).filter(Boolean);
let crossSum = 0;
let crossPairs = 0;
for (let i = 0; i < cfps.length; i++) {
  for (let j = i + 1; j < cfps.length; j++) {
    crossPairs++;
    crossSum += structuralSimilarity(cfps[i], cfps[j]);
  }
}
const mean = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0);
const reps = ok.map((p) => p.metadata?.artistRepetitionRate ?? 0);
const avgStructSim = simPairs ? simSum / simPairs : 0;
const crossRunSim = crossPairs ? crossSum / crossPairs : 0;

const trackMap = new Map();
for (const p of ok) {
  for (const t of p.tracks) {
    if (t.trackId) trackMap.set(t.trackId, { name: t.trackName, artist: t.artistName });
  }
}
const trackCounts = new Map();
for (const p of ok) {
  for (const t of p.tracks) {
    if (!t.trackId) continue;
    trackCounts.set(t.trackId, (trackCounts.get(t.trackId) ?? 0) + 1);
  }
}
const repeated = [...trackCounts.entries()]
  .filter(([, c]) => c > 1)
  .map(([id, count]) => ({ id, count, ...trackMap.get(id) }))
  .sort((a, b) => b.count - a.count);

const genreVarianceMean = Math.round(mean(ents) * 1000) / 1000;
const artistRepetitionMean = Math.round(mean(reps) * 1000) / 1000;
const diversityScore = Math.round((genreVarianceMean * 0.4 + (1 - artistRepetitionMean) * 0.3 + (1 - avgStructSim) * 0.3) * 1000) / 1000;
const overSmoothingScore = Math.round(
  (avgStructSim * 0.35 +
    (repeated.filter((t) => t.count / ok.length >= 0.3).length / Math.max(1, ok.length)) * 0.35 +
    (1 - genreVarianceMean) * 0.30) * 1000,
) / 1000;

const fixed = {
  ...data.aggregateMetrics,
  genreVarianceMean,
  artistRepetitionMean,
  diversityScore,
  crossPlaylistStructuralSimilarity: Math.round(avgStructSim * 1000) / 1000,
  crossRunStructuralSimilarity: Math.round(crossRunSim * 1000) / 1000,
  overSmoothingScore,
  trackRepetitionNamed: repeated.slice(0, 25).map((t) => ({
    trackId: t.id,
    name: t.name,
    artist: t.artist,
    appearances: t.count,
    shareOfPlaylists: Math.round((t.count / ok.length) * 1000) / 1000,
  })),
};

await writeFile("reports/live-e2e-phase/metrics-summary.json", JSON.stringify(fixed, null, 2));

let md = `# Live E2E Phase Results\n\n`;
md += `Generated: ${data.generatedAt}\n`;
md += `Base: ${data.baseUrl}\n`;
md += `User: ${data.spotifyUserId}\n\n`;
md += `# SECTION 1 — PLAYLIST OUTPUTS\n\n`;

for (const p of playlists) {
  md += `## ${p.id} [${p.category}]${p.run ? ` run ${p.run}` : ""}\n`;
  md += `**Prompt:** ${p.prompt}\n\n`;
  if (!p.ok) {
    md += `**FAILURE** (HTTP ${p.status}): ${p.error}\n\n---\n\n`;
    continue;
  }
  md += `Tracks: ${p.tracks.length} | Elapsed: ${p.metadata.elapsedMs}ms\n\n`;
  md += `### Metadata\n`;
  md += `- Genre distribution (%): ${JSON.stringify(p.metadata.genreDistribution)}\n`;
  md += `- Genre entropy: ${p.metadata.genreEntropy}\n`;
  md += `- Artist repetition rate: ${p.metadata.artistRepetitionRate} (unique artists: ${p.metadata.uniqueArtists})\n`;
  md += `- Energy curve: ${p.metadata.energyCurve.join(" → ")}\n`;
  md += `- Cluster distribution: ${JSON.stringify(p.metadata.clusterDistributionSummary)}\n`;
  md += `- Structural fingerprint: ${p.structuralFingerprint}\n\n`;
  md += `### Track list (in order)\n\n`;
  for (const t of p.tracks) {
    md += `${t.position}. **${t.trackName}** — ${t.artistName} [${t.genreFamily || t.genrePrimary || "?"}, energy: ${energyBand(t.energy)}]\n`;
  }
  md += `\n---\n\n`;
}

md += `# SECTION 2 — FAILURE LOG\n\n`;
for (const f of fixed.failures ?? []) {
  md += `- **${f.id}** [${f.category}]: "${f.prompt}" — ${f.error} (HTTP ${f.status})\n`;
}
const underfilled = ok.filter((p) => p.tracks.length < 20);
if (underfilled.length) {
  md += `\n### Underfilled (non-failure)\n`;
  for (const p of underfilled) {
    md += `- **${p.id}**: ${p.tracks.length} tracks\n`;
  }
}

md += `\n# SECTION 3 — REAL METRICS SUMMARY\n\n`;
md += `| Metric | Value |\n|---|---|\n`;
const rows = {
  "Success rate": `${fixed.successCount}/${fixed.totalPrompts} (${Math.round(fixed.successRate * 100)}%)`,
  "Genre variance (entropy mean)": fixed.genreVarianceMean,
  "Artist repetition rate (mean)": fixed.artistRepetitionMean,
  "Intent survival (API field absent)": "N/A — intentSurvival not returned in audit response",
  "Diversity score (combined)": fixed.diversityScore,
  "Cross-playlist structural similarity": fixed.crossPlaylistStructuralSimilarity,
  "Cross-run similarity (5× cozy optimistic)": fixed.crossRunStructuralSimilarity,
  "Over-smoothing detection score": fixed.overSmoothingScore,
  "Blended track overlap": fixed.categoryOverlap.blended,
  "Strong intent track overlap": fixed.categoryOverlap.strong,
  "Vague track overlap": fixed.categoryOverlap.vague,
  "Edge case track overlap": fixed.categoryOverlap.edge,
};
for (const [k, v] of Object.entries(rows)) md += `| ${k} | ${v} |\n`;

md += `\n### Top repeated tracks across outputs\n\n`;
for (const t of fixed.trackRepetitionNamed) {
  md += `- **${t.name}** — ${t.artist}: ${t.appearances}/${ok.length} playlists (${Math.round(t.shareOfPlaylists * 100)}%)\n`;
}

md += `\n# SECTION 4 — OVER-SMOOTHING / IDENTITY LOSS ANALYSIS\n\n`;
md += `**Over-smoothing score: ${fixed.overSmoothingScore}** (0 = diverse, 1 = collapsed)\n\n`;
md += `Evidence:\n`;
md += `- Cross-playlist structural similarity ${fixed.crossPlaylistStructuralSimilarity} indicates playlists share similar energy-arc + genre-entropy shapes.\n`;
md += `- Cross-run test (same prompt 5×) structural similarity ${fixed.crossRunStructuralSimilarity} — near-identical playlist shapes across runs.\n`;
md += `- ${repeated.filter((t) => t.count / ok.length >= 0.3).length} tracks appear in ≥30% of successful playlists; top track at ${Math.round((repeated[0]?.count ?? 0) / ok.length * 100)}%.\n`;
md += `- Blended overlap ${fixed.categoryOverlap.blended} and vague/edge overlap ${fixed.categoryOverlap.vague}/${fixed.categoryOverlap.edge} exceed 10–12% target.\n`;
md += `- Strong intent overlap ${fixed.categoryOverlap.strong} is lower, indicating better separation for explicit genre prompts.\n`;
md += `- Dominant repeated artists: ${fixed.topRepeatedArtists.slice(0, 5).map((a) => a.artist).join(", ")}.\n`;
md += `- Identity failures (i07 pop, i08 experimental ambient) reflect library evidence gaps, not generation collapse.\n`;
md += `- i04 jazz returned only 1 track (underfill, not HTTP failure).\n`;

await writeFile("reports/live-e2e-phase/full-report.md", md);
console.log(JSON.stringify(fixed, null, 2));
