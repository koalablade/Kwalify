/**
 * Live production E2E playlist generation run.
 * Reads credentials from .env (local only). Checkpointed JSON output.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "reports", "live-e2e-phase");
const CHECKPOINT = path.join(OUT_DIR, "checkpoint.json");

async function loadEnv() {
  const env = {};
  try {
    const raw = await readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* no .env */ }
  return {
    baseUrl: process.env.SMOKE_BASE_URL || env.SMOKE_BASE_URL || "https://kwalify.net",
    token: process.env.PLAYLIST_EVAL_TOKEN || env.PLAYLIST_EVAL_TOKEN || "",
    spotifyUserId: process.env.SMOKE_SPOTIFY_USER_ID || env.SMOKE_SPOTIFY_USER_ID || "koalablade",
    timeoutMs: Number(process.env.E2E_TIMEOUT_MS || 180000),
    delayMs: Number(process.env.E2E_DELAY_MS || 2000),
  };
}

const PROMPTS = [
  // 1 BLENDED
  { id: "b01", category: "blended", prompt: "feel good but slightly lonely summer morning with hope and sadness mixed" },
  { id: "b02", category: "blended", prompt: "warm nostalgic feeling that isn't tied to any specific era" },
  { id: "b03", category: "blended", prompt: "cozy optimistic start of the day with soft energy" },
  { id: "b04", category: "blended", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "b05", category: "blended", prompt: "rainy city morning walk with reflective mood" },
  { id: "b06", category: "blended", prompt: "golden hour quiet happiness with subtle melancholy" },
  { id: "b07", category: "blended", prompt: "slow peaceful morning with coffee and thoughts" },
  { id: "b08", category: "blended", prompt: "bittersweet summer evening nostalgia with warmth and loss" },
  { id: "b09", category: "blended", prompt: "early morning sunlight optimism with calm energy" },
  { id: "b10", category: "blended", prompt: "calm but emotionally warm day start" },
  // 2 STRONG
  { id: "s01", category: "strong", prompt: "90s trance euphoric rave high energy continuous" },
  { id: "s02", category: "strong", prompt: "aggressive gym hardcore workout music" },
  { id: "s03", category: "strong", prompt: "old school dubstep heavyweight bass music" },
  { id: "s04", category: "strong", prompt: "liquid drum and bass focus flow" },
  { id: "s05", category: "strong", prompt: "shoegaze wall of sound haze atmosphere" },
  { id: "s06", category: "strong", prompt: "UK garage 2-step classics underground" },
  { id: "s07", category: "strong", prompt: "dark techno warehouse set industrial" },
  { id: "s08", category: "strong", prompt: "2000s emo rock nostalgia emotional intensity" },
  { id: "s09", category: "strong", prompt: "minimal deep house late night groove" },
  { id: "s10", category: "strong", prompt: "punk hardcore fast energy aggression" },
  // 3 VAGUE
  { id: "v01", category: "vague", prompt: "music for thinking" },
  { id: "v02", category: "vague", prompt: "background focus vibes" },
  { id: "v03", category: "vague", prompt: "something for tonight" },
  { id: "v04", category: "vague", prompt: "music while working alone" },
  { id: "v05", category: "vague", prompt: "late night feeling" },
  { id: "v06", category: "vague", prompt: "just something chill" },
  { id: "v07", category: "vague", prompt: "driving and thinking" },
  { id: "v08", category: "vague", prompt: "lost in thoughts music" },
  { id: "v09", category: "vague", prompt: "floating through the day" },
  { id: "v10", category: "vague", prompt: "no idea what I want" },
  // 4 SCENE
  { id: "sc01", category: "scene", prompt: "driving through a city at 3am alone" },
  { id: "sc02", category: "scene", prompt: "walking home after a long night" },
  { id: "sc03", category: "scene", prompt: "first train in the morning alone" },
  { id: "sc04", category: "scene", prompt: "summer road trip with friends" },
  { id: "sc05", category: "scene", prompt: "rainy neon streets in Tokyo at night" },
  { id: "sc06", category: "scene", prompt: "sunset over empty highways" },
  { id: "sc07", category: "scene", prompt: "waking up in a foreign city alone" },
  { id: "sc08", category: "scene", prompt: "abandoned building exploration vibe" },
  { id: "sc09", category: "scene", prompt: "slow Sunday in a quiet town" },
  { id: "sc10", category: "scene", prompt: "late night kitchen lights on" },
  // 5 EDGE
  { id: "e01", category: "edge", prompt: "happy sad music" },
  { id: "e02", category: "edge", prompt: "calm energy workout" },
  { id: "e03", category: "edge", prompt: "nostalgic but forward looking" },
  { id: "e04", category: "edge", prompt: "sad but slightly hopeful" },
  { id: "e05", category: "edge", prompt: "chaotic calm focus music" },
  { id: "e06", category: "edge", prompt: "energetic but peaceful" },
  { id: "e07", category: "edge", prompt: "emotional but not heavy" },
  { id: "e08", category: "edge", prompt: "relaxed hype music" },
  { id: "e09", category: "edge", prompt: "dreamy but rhythmic focus" },
  { id: "e10", category: "edge", prompt: "intense but soft" },
  // 6 IDENTITY
  { id: "i01", category: "identity", prompt: "indie folk morning playlist" },
  { id: "i02", category: "identity", prompt: "electronic discovery playlist" },
  { id: "i03", category: "identity", prompt: "hip hop deep cuts playlist" },
  { id: "i04", category: "identity", prompt: "jazz late night selection" },
  { id: "i05", category: "identity", prompt: "rock road trip classics" },
  { id: "i06", category: "identity", prompt: "underground electronic mix" },
  { id: "i07", category: "identity", prompt: "mainstream pop feel good set" },
  { id: "i08", category: "identity", prompt: "experimental ambient textures" },
  { id: "i09", category: "identity", prompt: "80s synth nostalgia mix" },
  { id: "i10", category: "identity", prompt: "modern alternative indie set" },
  // 7 CROSS-RUN
  { id: "x01", category: "crossrun", prompt: "cozy optimistic start to the day", run: 1 },
  { id: "x02", category: "crossrun", prompt: "cozy optimistic start to the day", run: 2 },
  { id: "x03", category: "crossrun", prompt: "cozy optimistic start to the day", run: 3 },
  { id: "x04", category: "crossrun", prompt: "cozy optimistic start to the day", run: 4 },
  { id: "x05", category: "crossrun", prompt: "cozy optimistic start to the day", run: 5 },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function energyBand(e) {
  const v = e ?? 0.5;
  if (v <= 0.42) return "low";
  if (v >= 0.55) return "high";
  return "mid";
}

function normalizedEntropy(labels) {
  if (labels.length <= 1) return 0;
  const counts = new Map();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / labels.length;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h / Math.log2(counts.size);
}

function playlistMetadata(tracks, response) {
  const genres = tracks.map((t) => t.genreFamily || t.genrePrimary || "unknown");
  const genreCounts = {};
  for (const g of genres) genreCounts[g] = (genreCounts[g] ?? 0) + 1;
  const genreDistribution = Object.fromEntries(
    Object.entries(genreCounts).map(([g, c]) => [g, Math.round((c / Math.max(1, tracks.length)) * 1000) / 10]),
  );
  const artists = tracks.map((t) => (t.artistName || t.artist || "").toLowerCase()).filter(Boolean);
  const uniqueArtists = new Set(artists).size;
  const artistRepetitionRate = tracks.length > 0
    ? Math.round((1 - uniqueArtists / tracks.length) * 1000) / 1000
    : 0;
  const energyCurve = tracks.map((t) => energyBand(t.energy));
  const clusters = tracks.flatMap((t) => {
    if (Array.isArray(t.clusterIds) && t.clusterIds.length) return t.clusterIds;
    if (t.clusterId) return [t.clusterId];
    const fam = t.genreFamily || t.genrePrimary || "unknown";
    return [`${fam}|${energyBand(t.energy)}`];
  });
  const clusterCounts = {};
  for (const c of clusters) clusterCounts[c] = (clusterCounts[c] ?? 0) + 1;
  const clusterSummary = Object.fromEntries(
    Object.entries(clusterCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => [k, Math.round((v / Math.max(1, clusters.length)) * 1000) / 10]),
  );
  const intentSurvival = response?.intentSurvival ?? response?.generationDiagnostics?.intentSurvival ?? null;
  return {
    trackCount: tracks.length,
    genreDistribution,
    genreEntropy: Math.round(normalizedEntropy(genres) * 1000) / 1000,
    artistRepetitionRate,
    uniqueArtists,
    energyCurve,
    clusterDistributionSummary: clusterSummary,
    intentSurvival,
    finalGenreDistribution: response?.finalGenreDistribution ?? null,
    deploymentVersion: response?.deploymentVersion ?? response?.commitHash ?? null,
    elapsedMs: null,
  };
}

function structuralFingerprint(tracks) {
  const buckets = 8;
  const step = Math.max(1, Math.floor(tracks.length / buckets));
  const energyParts = [];
  for (let i = 0; i < buckets; i++) {
    const slice = tracks.slice(i * step, (i + 1) * step);
    const avg = slice.reduce((s, t) => s + (t.energy ?? 0.5), 0) / Math.max(1, slice.length);
    energyParts.push(Math.round(avg * 10));
  }
  const families = tracks.map((t) => t.genreFamily || t.genrePrimary || "unknown");
  return `${energyParts.join("-")}::${normalizedEntropy(families).toFixed(2)}`;
}

function structuralSimilarity(a, b) {
  if (a === b) return 1;
  const [aE, aEnt] = a.split("::");
  const [bE, bEnt] = b.split("::");
  const aParts = aE.split("-").map(Number);
  const bParts = bE.split("-").map(Number);
  let sim = 0;
  const len = Math.max(aParts.length, bParts.length, 1);
  for (let i = 0; i < len; i++) {
    sim += 1 - Math.min(1, Math.abs((aParts[i] ?? 0) - (bParts[i] ?? 0)) / 10);
  }
  sim /= len;
  const entSim = 1 - Math.min(1, Math.abs(Number(aEnt) - Number(bEnt)));
  return sim * 0.7 + entSim * 0.3;
}

async function generate(cfg, item, sessionMemory) {
  const started = Date.now();
  const body = {
    vibe: item.prompt,
    mode: "balanced",
    length: 25,
    varietyBoost: true,
    auditMode: true,
    spotifyUserId: cfg.spotifyUserId,
  };
  if (sessionMemory.length > 0) {
    body.evaluationSessionMemory = { previousTrackIds: sessionMemory.slice(-20) };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": cfg.token,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    const ok = res.ok && data.success === true && tracks.length > 0;
    const meta = playlistMetadata(tracks, data);
    meta.elapsedMs = Date.now() - started;
    return {
      ...item,
      ok,
      status: res.status,
      error: ok ? null : String(data.message ?? data.error ?? res.statusText ?? "unknown_error"),
      tracks: tracks.map((t, i) => ({
        position: i + 1,
        trackId: t.trackId || t.id,
        trackName: t.trackName || t.name,
        artistName: t.artistName || t.artist,
        genrePrimary: t.genrePrimary ?? null,
        genreFamily: t.genreFamily ?? null,
        energy: t.energy ?? null,
        valence: t.valence ?? null,
        releaseYear: t.releaseYear ?? null,
        clusterIds: t.clusterIds ?? (t.clusterId ? [t.clusterId] : []),
      })),
      metadata: meta,
      structuralFingerprint: tracks.length >= 4 ? structuralFingerprint(tracks) : null,
      rawDiagnostics: {
        intentSurvival: data.intentSurvival ?? null,
        artistDiversity: data.artistDiversity ?? null,
        finalization: data.finalization ?? null,
      },
    };
  } catch (err) {
    return {
      ...item,
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
      tracks: [],
      metadata: null,
      structuralFingerprint: null,
      rawDiagnostics: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function computeAggregateMetrics(results) {
  const successes = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok);
  const allTrackIds = new Map();
  const allArtists = new Map();
  const genreEntropies = [];
  const artistReps = [];
  const intentScores = [];
  const fingerprints = [];
  const crossrun = results.filter((r) => r.category === "crossrun" && r.ok);

  for (const r of successes) {
    genreEntropies.push(r.metadata.genreEntropy);
    artistReps.push(r.metadata.artistRepetitionRate);
    if (r.structuralFingerprint) fingerprints.push({ id: r.id, fp: r.structuralFingerprint, category: r.category });
    const surv = r.rawDiagnostics?.intentSurvival ?? r.metadata?.intentSurvival;
    if (surv?.scores?.overall != null) intentScores.push(surv.scores.overall);
    else if (surv?.overallScore != null) intentScores.push(surv.overallScore);
    for (const t of r.tracks) {
      const id = t.trackId;
      if (id) allTrackIds.set(id, (allTrackIds.get(id) ?? 0) + 1);
      const a = (t.artistName || "").toLowerCase();
      if (a) allArtists.set(a, (allArtists.get(a) ?? 0) + 1);
    }
  }

  const repeatedTracks = [...allTrackIds.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ trackId: id, appearances: count, shareOfPlaylists: Math.round((count / Math.max(1, successes.length)) * 1000) / 1000 }));

  let structuralPairs = 0;
  let structuralSimSum = 0;
  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      structuralPairs++;
      structuralSimSum += structuralSimilarity(fingerprints[i].fp, fingerprints[j].fp);
    }
  }
  const avgStructuralSimilarity = structuralPairs > 0 ? Math.round((structuralSimSum / structuralPairs) * 1000) / 1000 : 0;

  let crossrunSim = 0;
  let crossrunTrackSim = 0;
  if (crossrun.length >= 2) {
    const fps = crossrun.map((r) => r.structuralFingerprint).filter(Boolean);
    let sum = 0, pairs = 0;
    for (let i = 0; i < fps.length; i++) {
      for (let j = i + 1; j < fps.length; j++) {
        pairs++;
        sum += structuralSimilarity(fps[i], fps[j]);
      }
    }
    crossrunSim = pairs > 0 ? Math.round((sum / pairs) * 1000) / 1000 : 0;
    let trackSum = 0;
    let trackPairs = 0;
    for (let i = 0; i < crossrun.length; i++) {
      for (let j = i + 1; j < crossrun.length; j++) {
        const a = new Set(crossrun[i].tracks.map((t) => t.trackId).filter(Boolean));
        const b = new Set(crossrun[j].tracks.map((t) => t.trackId).filter(Boolean));
        const inter = [...a].filter((id) => b.has(id)).length;
        const union = new Set([...a, ...b]).size;
        trackSum += union > 0 ? inter / union : 0;
        trackPairs++;
      }
    }
    crossrunTrackSim = trackPairs > 0 ? Math.round((trackSum / trackPairs) * 1000) / 1000 : 0;
  }

  const blended = successes.filter((r) => r.category === "blended");
  const strong = successes.filter((r) => r.category === "strong");
  const overlap = (cat) => {
    const ids = cat.flatMap((r) => r.tracks.map((t) => t.trackId).filter(Boolean));
    const set = new Set(ids);
    return ids.length > 0 ? Math.round((1 - set.size / ids.length) * 1000) / 1000 : 0;
  };

  const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const overSmoothingScore = Math.round((
    avgStructuralSimilarity * 0.35 +
    (repeatedTracks.filter((t) => t.shareOfPlaylists >= 0.3).length / Math.max(1, successes.length)) * 0.35 +
    (1 - mean(genreEntropies)) * 0.30
  ) * 1000) / 1000;

  return {
    totalPrompts: results.length,
    successCount: successes.length,
    failureCount: failures.length,
    successRate: Math.round((successes.length / results.length) * 1000) / 1000,
    genreVarianceMean: Math.round(mean(genreEntropies) * 1000) / 1000,
    artistRepetitionMean: Math.round(mean(artistReps) * 1000) / 1000,
    intentSurvivalMean: Math.round(mean(intentScores) * 1000) / 1000,
    diversityScore: Math.round((mean(genreEntropies) * 0.4 + (1 - mean(artistReps)) * 0.3 + (1 - avgStructuralSimilarity) * 0.3) * 1000) / 1000,
    overSmoothingScore,
    crossPlaylistStructuralSimilarity: avgStructuralSimilarity,
    crossRunStructuralSimilarity: crossrunSim,
    crossRunTrackOverlap: crossrunTrackSim,
    trackRepetitionAcrossOutputs: repeatedTracks.slice(0, 30),
    topRepeatedArtists: [...allArtists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([artist, count]) => ({ artist, appearances: count })),
    categoryOverlap: {
      blended: overlap(blended),
      strong: overlap(strong),
      vague: overlap(successes.filter((r) => r.category === "vague")),
      edge: overlap(successes.filter((r) => r.category === "edge")),
    },
    failures: failures.map((f) => ({ id: f.id, prompt: f.prompt, category: f.category, error: f.error, status: f.status })),
  };
}

async function main() {
  const cfg = await loadEnv();
  if (!cfg.token) {
    console.error("PLAYLIST_EVAL_TOKEN missing — set in .env");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  let checkpoint = { completed: {}, sessionMemory: [], startedAt: new Date().toISOString() };
  try {
    checkpoint = JSON.parse(await readFile(CHECKPOINT, "utf8"));
  } catch { /* fresh */ }

  const sessionMemory = checkpoint.sessionMemory ?? [];
  console.log(`Live E2E: ${PROMPTS.length} prompts → ${cfg.baseUrl} user=${cfg.spotifyUserId}`);

  for (const item of PROMPTS) {
    if (checkpoint.completed[item.id]) {
      console.log(`SKIP ${item.id} (checkpoint)`);
      continue;
    }
    console.log(`RUN  ${item.id} [${item.category}] ${item.prompt.slice(0, 60)}...`);
    const result = await generate(cfg, item, sessionMemory);
    checkpoint.completed[item.id] = result;
    if (result.ok) {
      sessionMemory.push(result.tracks.map((t) => t.trackId).filter(Boolean));
    }
    checkpoint.sessionMemory = sessionMemory;
    checkpoint.updatedAt = new Date().toISOString();
    await writeFile(CHECKPOINT, JSON.stringify(checkpoint, null, 2));
    console.log(result.ok ? ` OK  ${result.tracks.length} tracks ${result.metadata.elapsedMs}ms` : ` FAIL ${result.error}`);
    await sleep(cfg.delayMs);
  }

  const results = PROMPTS.map((p) => checkpoint.completed[p.id]).filter(Boolean);
  const metrics = computeAggregateMetrics(results);
  const final = {
    generatedAt: new Date().toISOString(),
    baseUrl: cfg.baseUrl,
    spotifyUserId: cfg.spotifyUserId,
    playlists: results,
    aggregateMetrics: metrics,
  };
  await writeFile(path.join(OUT_DIR, "results.json"), JSON.stringify(final, null, 2));
  await writeFile(path.join(OUT_DIR, "metrics-summary.json"), JSON.stringify(metrics, null, 2));
  console.log("\nDONE", JSON.stringify({ success: metrics.successCount, fail: metrics.failureCount }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
