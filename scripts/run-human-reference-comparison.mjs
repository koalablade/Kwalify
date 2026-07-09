/**
 * Compare Kwalify-generated playlists vs human-curated reference playlists
 * across easy / medium / hard prompt tiers.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { comparePlaylistsPairwise } = require(path.join(ROOT, "backend/dist/core/editorial/pairwise-playlist-judge"));
const { evaluateWouldISave } = require(path.join(ROOT, "backend/dist/core/editorial/would-i-save-evaluator"));
const { computeHumanPlaylistFeatures } = require(path.join(ROOT, "backend/dist/core/editorial/human-playlist-patterns"));

const PROMPTS_PATH = path.join(ROOT, "data/corpus/pairwise-benchmark-prompts.json");
const OUT_DIR = path.join(ROOT, "reports", "human-vs-kwalify-comparison");
const GENERATE_TIMEOUT_MS = 120_000;

const TIERS = {
  easy: ["cozy_sunday", "coffee_shop", "late_night"],
  medium: ["sunset_drive", "study_session", "road_trip"],
  hard: ["focus_coding", "party_pregame", "gym_boost"],
};

function lockedIntentStub() {
  return {
    genreFamilies: [],
    primaryGenre: null,
    primarySubgenre: null,
    secondarySubgenre: null,
    subgenreTerms: [],
    eraRange: null,
    mood: [],
    activity: null,
    energy: null,
  };
}

function toPatternTrack(row) {
  return {
    trackId: `${row.artistName}-${row.trackName}`.toLowerCase().replace(/\s+/g, "-"),
    trackName: row.trackName,
    artistName: row.artistName,
    genreFamily: row.genreFamily ?? null,
    energy: row.energy ?? null,
    valence: row.valence ?? null,
    danceability: row.danceability ?? null,
    acousticness: row.acousticness ?? null,
    rediscoveryScore: row.rediscoveryScore ?? 0.4,
  };
}

function buildCandidate(label, tracks, prompt) {
  const wouldISave = evaluateWouldISave({
    prompt,
    tracks,
    context: null,
    lockedIntent: lockedIntentStub(),
  });
  return {
    label,
    tracks,
    wouldISave,
    context: null,
    scalarTotal: wouldISave.combinedScore,
  };
}

function mean(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function trackKey(t) {
  return `${(t.artistName ?? "").toLowerCase()}|${(t.trackName ?? "").toLowerCase()}`;
}

function openingEnergyDelta(refTracks, genTracks, count = 5) {
  const refE = mean(refTracks.slice(0, count).map((t) => t.energy));
  const genE = mean(genTracks.slice(0, count).map((t) => t.energy));
  if (refE == null || genE == null) return null;
  return Math.abs(refE - genE);
}

const FOCUS_VETO_RE = /\b(?:ukg|uk\s*garage|grime|conducta|mj\s*cole|kurupt|korrupt|techno|artful\s*dodger|astech|airod|scooter|zapravka|re-rewind|techno\s*parties)\b/i;
const PARTY_MAINSTREAM_RE = /\b(?:usher|daft\s*punk|mark\s*ronson|dj\s*snake|black\s*eyed\s*peas|uptown\s*funk|get\s*lucky|yeah!|turn\s*down\s*for\s*what)\b/i;
const GYM_DRIVE_RE = /\b(?:eminem|kanye|guetta|macklemore|survivor|stronger|lose\s*yourself|titanium|can't\s*hold\s*us|eye\s*of\s*the\s*tiger)\b/i;
const GYM_SLOW_RE = /\b(?:led\s*zeppelin|fleetwood\s*mac|black\s*sabbath|cool\s*cat|planet\s*caravan|blues)\b/i;

function openingListeningHeuristics(id, opening5) {
  const text = opening5.join(" ").toLowerCase();
  if (id === "focus_coding") {
    const vetoHits = (text.match(new RegExp(FOCUS_VETO_RE.source, "gi")) ?? []).length;
    return { vetoHits, mainstreamHits: 0, driveHits: 0, slowHits: 0, pass: vetoHits === 0 };
  }
  if (id === "party_pregame") {
    const mainstreamHits = (text.match(new RegExp(PARTY_MAINSTREAM_RE.source, "gi")) ?? []).length;
    return { vetoHits: 0, mainstreamHits, driveHits: 0, slowHits: 0, pass: mainstreamHits >= 1 };
  }
  if (id === "gym_boost") {
    const driveHits = (text.match(new RegExp(GYM_DRIVE_RE.source, "gi")) ?? []).length;
    const slowHits = (text.match(new RegExp(GYM_SLOW_RE.source, "gi")) ?? []).length;
    return { vetoHits: 0, mainstreamHits: 0, driveHits, slowHits, pass: driveHits >= 1 && slowHits === 0 };
  }
  return { vetoHits: 0, mainstreamHits: 0, driveHits: 0, slowHits: 0, pass: null };
}

function overlapStats(refTracks, genTracks) {
  const refKeys = new Set(refTracks.map(trackKey));
  const genKeys = new Set(genTracks.map(trackKey));
  const refArtists = new Set(refTracks.map((t) => (t.artistName ?? "").toLowerCase()));
  const genArtists = new Set(genTracks.map((t) => (t.artistName ?? "").toLowerCase()));
  let exactMatches = 0;
  for (const k of genKeys) if (refKeys.has(k)) exactMatches += 1;
  let artistMatches = 0;
  for (const a of genArtists) if (refArtists.has(a)) artistMatches += 1;
  const refFamilies = refTracks.map((t) => t.genreFamily).filter(Boolean);
  const genFamilies = genTracks.map((t) => t.genreFamily).filter(Boolean);
  const refFamilySet = new Set(refFamilies);
  const genFamilySet = new Set(genFamilies);
  let familyOverlap = 0;
  for (const f of genFamilySet) if (refFamilySet.has(f)) familyOverlap += 1;
  return {
    exactTrackOverlap: genTracks.length ? exactMatches / genTracks.length : 0,
    exactTrackMatches: exactMatches,
    artistOverlap: genArtists.size ? artistMatches / genArtists.size : 0,
    genreFamilyOverlap: genFamilySet.size ? familyOverlap / genFamilySet.size : 0,
    refEnergyMean: mean(refTracks.map((t) => t.energy)),
    genEnergyMean: mean(genTracks.map((t) => t.energy)),
    refValenceMean: mean(refTracks.map((t) => t.valence)),
    genValenceMean: mean(genTracks.map((t) => t.valence)),
  };
}

async function loadDotEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || env[m[1]]) continue;
      env[m[1]] = m[2].trim().replace(/^["']+|["']+$/g, "");
    }
  } catch { /* no .env */ }
  return env;
}

async function healthOk(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function generate(baseUrl, token, prompt, length = 25, extraBody = {}) {
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: prompt,
      mode: "balanced",
      length,
      auditMode: true,
      spotifyUserId: "koalablade",
      varietyBoost: true,
      ...extraBody,
    }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function extractOrchestrator(data) {
  return data?.generationDiagnostics?.candidateRetrieval?.orchestrator
    ?? data?.retrievalOrchestrator
    ?? data?.generationDiagnostics?.retrievalOrchestrator
    ?? null;
}

function wouldSkipFirstTrack(id, openingListening, orchestrator, kwalifyTracks) {
  if (openingListening?.pass === false) return true;
  if (orchestrator?.humanOpener?.confidence != null && orchestrator.humanOpener.confidence < 0.42) return true;
  if (["focus_coding", "party_pregame", "gym_boost"].includes(id)) {
    const opener = kwalifyTracks[0];
    if (!opener) return true;
    if (id === "focus_coding" && (opener.energy ?? 0.5) > 0.55) return true;
    if (id === "gym_boost" && (opener.energy ?? 0.5) < 0.55) return true;
  }
  return false;
}

async function main() {
  const env = await loadDotEnv();
  const token = randomBytes(16).toString("base64url").slice(0, 21);
  env.PLAYLIST_EVAL_TOKEN = token;
  env.GIT_COMMIT = env.GIT_COMMIT || "human-ref-comparison";
  const baseUrl = "http://localhost:5000";

  if (!(await healthOk(baseUrl))) {
    const { spawn } = await import("node:child_process");
    const server = spawn(process.execPath, [path.join(ROOT, "backend", "dist", "server.js")], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await healthOk(baseUrl)) break;
    }
    if (!(await healthOk(baseUrl))) {
      server.kill("SIGTERM");
      throw new Error("API did not start");
    }
    process.on("exit", () => server.kill("SIGTERM"));
  }

  const corpus = JSON.parse(await readFile(PROMPTS_PATH, "utf8"));
  const byId = new Map(corpus.map((row) => [row.id, row]));
  const results = [];

  for (const [tier, ids] of Object.entries(TIERS)) {
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        console.error(`missing prompt ${id}`);
        continue;
      }
      const started = Date.now();
      process.stderr.write(`[human-ref] ${tier}/${id} generating...\n`);
      let gen;
      try {
        gen = await generate(baseUrl, token, row.prompt, Math.max(20, row.referenceTracks?.length ?? 20));
      } catch (err) {
        gen = { status: 0, data: { error: String(err) } };
      }

      const kwalifyTracks = (Array.isArray(gen.data?.tracks) ? gen.data.tracks : []).map((t) => toPatternTrack({
        trackName: t.trackName ?? t.name ?? "?",
        artistName: t.artistName ?? t.artist ?? "?",
        genreFamily: t.genreFamily ?? null,
        energy: t.energy ?? null,
        valence: t.valence ?? null,
        danceability: t.danceability ?? null,
        acousticness: t.acousticness ?? null,
      }));
      const refTracks = (row.referenceTracks ?? []).map(toPatternTrack);
      const humanCandidate = buildCandidate("human_reference", refTracks, row.prompt);
      const kwalifyCandidate = buildCandidate("kwalify_generated", kwalifyTracks, row.prompt);

      let pairwise = null;
      if (kwalifyTracks.length >= 5 && refTracks.length >= 5) {
        const cmp = comparePlaylistsPairwise(humanCandidate, kwalifyCandidate);
        pairwise = {
          winner: cmp.winner === "a" ? "human_reference" : "kwalify_generated",
          confidence: cmp.confidence,
          reasons: cmp.reasons,
          dimensions: cmp.dimensions,
          selectionMode: cmp.selectionMode,
        };
      }

      const overlap = overlapStats(refTracks, kwalifyTracks);
      const humanFeatures = computeHumanPlaylistFeatures(refTracks);
      const kwalifyFeatures = computeHumanPlaylistFeatures(kwalifyTracks);
      const retrieval = gen.data?.generationDiagnostics?.candidateRetrieval
        ?? gen.data?.generationDiagnostics?.performanceFastPath?.candidateRetrieval
        ?? null;
      const orchestrator = extractOrchestrator(gen.data);
      const libraryInsufficient =
        gen.data?.code === "LIBRARY_INSUFFICIENT_FOR_PROMPT" ||
        gen.data?.reason === "LIBRARY_INSUFFICIENT_FOR_PROMPT" ||
        (gen.status === 200 && gen.data?.success === false && gen.data?.canUseDiscoveryMode === true);
      const openingListening = openingListeningHeuristics(id, kwalifyTracks.slice(0, 5).map((t) => `${t.artistName} — ${t.trackName}`));
      const tasteV2 = gen.data?.generationDiagnostics?.finalization?.humanTasteValidator?.v2After
        ?? gen.data?.generationDiagnostics?.humanTasteValidator?.v2After
        ?? null;

      let discoveryComparison = null;
      if (libraryInsufficient || (tier === "hard" && !gen.data?.success)) {
        try {
          const discovery = await generate(baseUrl, token, row.prompt, Math.max(20, row.referenceTracks?.length ?? 20), {
            noLibraryMode: true,
          });
          const discoveryTracks = (Array.isArray(discovery.data?.tracks) ? discovery.data.tracks : []).map((t) => toPatternTrack({
            trackName: t.trackName ?? t.name ?? "?",
            artistName: t.artistName ?? t.artist ?? "?",
            genreFamily: t.genreFamily ?? null,
            energy: t.energy ?? null,
            valence: t.valence ?? null,
            danceability: t.danceability ?? null,
            acousticness: t.acousticness ?? null,
          }));
          if (discoveryTracks.length >= 5 && refTracks.length >= 5) {
            const discoveryCandidate = buildCandidate("kwalify_discovery", discoveryTracks, row.prompt);
            const cmp = comparePlaylistsPairwise(humanCandidate, discoveryCandidate);
            discoveryComparison = {
              status: discovery.status,
              success: discovery.status === 200 && discovery.data?.success === true,
              trackCount: discoveryTracks.length,
              judgeWinner: cmp.winner === "a" ? "human_reference" : "kwalify_discovery",
              judgeConfidence: cmp.confidence,
              wouldISaveScore: discoveryCandidate.wouldISave.combinedScore,
              openingListening: openingListeningHeuristics(id, discoveryTracks.slice(0, 5).map((t) => `${t.artistName} — ${t.trackName}`)),
              strategy: extractOrchestrator(discovery.data)?.strategy ?? "D_spotify_catalogue",
            };
          }
        } catch {
          discoveryComparison = { error: "discovery_pass_failed" };
        }
      }

      results.push({
        tier,
        id,
        prompt: row.prompt,
        durationMs: Date.now() - started,
        generation: {
          status: gen.status,
          success: gen.status === 200 && gen.data?.success === true,
          libraryInsufficient,
          code: gen.data?.code ?? gen.data?.reason ?? null,
          trackCount: kwalifyTracks.length,
          recoveryUsed: gen.data?.generationDiagnostics?.recoveryTriggered === true,
          fallbackLevel: gen.data?.generationDiagnostics?.fallbackLevel ?? null,
          confidence: gen.data?.playlistConfidence ?? null,
          opening5: kwalifyTracks.slice(0, 5).map((t) => `${t.artistName} — ${t.trackName}`),
          openingEnergyDelta: openingEnergyDelta(refTracks, kwalifyTracks),
          openingListening,
          retrieval,
          orchestrator,
          retrievalStrategy: orchestrator?.strategy ?? retrieval?.strategyId ?? null,
          libraryCapabilityScore: orchestrator?.libraryCapability?.score ?? null,
          librarySufficient: orchestrator?.librarySufficient ?? (gen.data?.success === true),
          combinedConfidence: orchestrator?.combinedConfidence ?? null,
          wouldSkipFirstTrack: wouldSkipFirstTrack(id, openingListening, orchestrator, kwalifyTracks),
          wouldShare: tasteV2?.wouldShare ?? null,
          worthSaving: tasteV2?.worthSaving ?? null,
          humanTasteV2: tasteV2,
          discoveryComparison,
        },
        humanReference: {
          trackCount: refTracks.length,
          opening5: refTracks.slice(0, 5).map((t) => `${t.artistName} — ${t.trackName}`),
          wouldISaveScore: humanCandidate.wouldISave.combinedScore,
          features: humanFeatures,
        },
        kwalify: {
          wouldISaveScore: kwalifyCandidate.wouldISave.combinedScore,
          features: kwalifyFeatures,
        },
        overlap,
        pairwise,
      });

      process.stderr.write(
        `[human-ref] ${tier}/${id} → ${gen.status} tracks=${kwalifyTracks.length} judge=${pairwise?.winner ?? "n/a"}\n`,
      );
    }
  }

  const withJudge = results.filter((r) => r.pairwise);
  const summary = {
    generatedAt: new Date().toISOString(),
    promptCount: results.length,
    successCount: results.filter((r) => r.generation.success).length,
    judgeHumanWins: withJudge.filter((r) => r.pairwise.winner === "human_reference").length,
    judgeKwalifyWins: withJudge.filter((r) => r.pairwise.winner === "kwalify_generated").length,
    avgExactTrackOverlap: mean(withJudge.map((r) => r.overlap.exactTrackOverlap)),
    avgArtistOverlap: mean(withJudge.map((r) => r.overlap.artistOverlap)),
    hardOpeningListeningPass: results
      .filter((r) => ["focus_coding", "party_pregame", "gym_boost"].includes(r.id))
      .filter((r) => r.generation.openingListening?.pass === true).length,
    hardOpeningListeningTotal: results
      .filter((r) => ["focus_coding", "party_pregame", "gym_boost"].includes(r.id)).length,
    avgRetrievalLibraryGravity: mean(
      results.map((r) => r.generation.retrieval?.libraryGravityShare).filter((v) => typeof v === "number"),
    ),
    avgRetrievalDiversity: mean(
      results.map((r) => r.generation.retrieval?.diversityIndex).filter((v) => typeof v === "number"),
    ),
    librarySufficiencyRate: results.length
      ? results.filter((r) => r.generation.librarySufficient === true && r.generation.success).length / results.length
      : null,
    libraryInsufficientCount: results.filter((r) => r.generation.libraryInsufficient).length,
    avgWouldSkipFirstTrackRate: mean(
      results.map((r) => (r.generation.wouldSkipFirstTrack ? 1 : 0)),
    ),
    avgWouldShareRate: mean(
      results.map((r) => (r.generation.wouldShare === true ? 1 : r.generation.wouldShare === false ? 0 : null)),
    ),
    retrievalStrategyCounts: results.reduce((acc, r) => {
      const key = r.generation.retrievalStrategy ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    discoveryModeLift: (() => {
      const rows = results.filter((r) => r.generation.discoveryComparison?.success);
      if (!rows.length) return null;
      const likedSave = mean(rows.map((r) => r.kwalify.wouldISaveScore));
      const discoverySave = mean(rows.map((r) => r.generation.discoveryComparison.wouldISaveScore));
      const likedOpen = rows.filter((r) => r.generation.openingListening?.pass === true).length;
      const discoveryOpen = rows.filter((r) => r.generation.discoveryComparison.openingListening?.pass === true).length;
      return {
        comparedPrompts: rows.length,
        avgWouldISaveLiked: likedSave,
        avgWouldISaveDiscovery: discoverySave,
        hardOpeningPassLiked: likedOpen,
        hardOpeningPassDiscovery: discoveryOpen,
      };
    })(),
    byTier: Object.fromEntries(
      Object.keys(TIERS).map((tier) => {
        const rows = results.filter((r) => r.tier === tier);
        const judged = rows.filter((r) => r.pairwise);
        return [tier, {
          count: rows.length,
          success: rows.filter((r) => r.generation.success).length,
          humanWins: judged.filter((r) => r.pairwise.winner === "human_reference").length,
          kwalifyWins: judged.filter((r) => r.pairwise.winner === "kwalify_generated").length,
          avgWouldISaveHuman: mean(rows.map((r) => r.humanReference.wouldISaveScore)),
          avgWouldISaveKwalify: mean(rows.map((r) => r.kwalify.wouldISaveScore)),
          avgExactOverlap: mean(rows.map((r) => r.overlap.exactTrackOverlap)),
        }];
      }),
    ),
  };

  await mkdir(OUT_DIR, { recursive: true });
  const reportPath = path.join(OUT_DIR, "comparison-report.json");
  const mdPath = path.join(OUT_DIR, "comparison-summary.md");
  await writeFile(reportPath, JSON.stringify({ summary, results }, null, 2));

  const md = [
    "# Human reference vs Kwalify comparison",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Summary",
    `- Prompts: ${summary.promptCount} (3 easy, 3 medium, 3 hard)`,
    `- Kwalify success: ${summary.successCount}/${summary.promptCount}`,
    `- Internal judge: human ${summary.judgeHumanWins} / kwalify ${summary.judgeKwalifyWins} (${withJudge.length} judged)`,
    `- Avg exact track overlap with reference: ${((summary.avgExactTrackOverlap ?? 0) * 100).toFixed(1)}%`,
    `- Avg artist overlap with reference: ${((summary.avgArtistOverlap ?? 0) * 100).toFixed(1)}%`,
    `- Hard prompt opening listening pass: ${summary.hardOpeningListeningPass}/${summary.hardOpeningListeningTotal} (heuristic, not judge)`,
    `- Avg retrieval library-gravity share: ${summary.avgRetrievalLibraryGravity != null ? (summary.avgRetrievalLibraryGravity * 100).toFixed(1) + "%" : "n/a"}`,
    `- Avg retrieval diversity index: ${summary.avgRetrievalDiversity?.toFixed(2) ?? "n/a"}`,
    `- Library sufficiency rate (liked-only): ${summary.librarySufficiencyRate != null ? (summary.librarySufficiencyRate * 100).toFixed(1) + "%" : "n/a"}`,
    `- Library insufficient failures: ${summary.libraryInsufficientCount}`,
    `- Would-skip-first-track rate: ${summary.avgWouldSkipFirstTrackRate != null ? (summary.avgWouldSkipFirstTrackRate * 100).toFixed(1) + "%" : "n/a"}`,
    `- Retrieval strategies: ${JSON.stringify(summary.retrievalStrategyCounts)}`,
    ...(summary.discoveryModeLift
      ? [
        `- Discovery mode lift (${summary.discoveryModeLift.comparedPrompts} prompts): would-I-save ${summary.discoveryModeLift.avgWouldISaveLiked?.toFixed(2) ?? "?"} → ${summary.discoveryModeLift.avgWouldISaveDiscovery?.toFixed(2) ?? "?"}`,
        `- Discovery opening pass (hard subset): liked ${summary.discoveryModeLift.hardOpeningPassLiked} / discovery ${summary.discoveryModeLift.hardOpeningPassDiscovery}`,
      ]
      : []),
    "",
    "## By tier",
    ...Object.entries(summary.byTier).flatMap(([tier, s]) => [
      `### ${tier}`,
      `- Human judge wins: ${s.humanWins}/${s.count}`,
      `- Kwalify judge wins: ${s.kwalifyWins}/${s.count}`,
      `- Would-I-save score — human ref avg ${(s.avgWouldISaveHuman ?? 0).toFixed(2)}, Kwalify avg ${(s.avgWouldISaveKwalify ?? 0).toFixed(2)}`,
      `- Exact track overlap avg ${((s.avgExactOverlap ?? 0) * 100).toFixed(1)}%`,
      "",
    ]),
    "## Per prompt",
    ...results.flatMap((r) => [
      `### [${r.tier}] ${r.id}`,
      `**Prompt:** ${r.prompt}`,
      "",
      `| | Human reference | Kwalify |`,
      `|---|---|---|`,
      `| Tracks | ${r.humanReference.trackCount} | ${r.generation.trackCount} |`,
      `| Would-I-save | ${r.humanReference.wouldISaveScore.toFixed(2)} | ${r.kwalify.wouldISaveScore.toFixed(2)} |`,
      `| Energy (mean) | ${r.overlap.refEnergyMean?.toFixed(2) ?? "?"} | ${r.overlap.genEnergyMean?.toFixed(2) ?? "?"} |`,
      `| Valence (mean) | ${r.overlap.refValenceMean?.toFixed(2) ?? "?"} | ${r.overlap.genValenceMean?.toFixed(2) ?? "?"} |`,
      `| Opening energy Δ | — | ${r.generation.openingEnergyDelta?.toFixed(2) ?? "?"} |`,
      `| Opening listening | — | ${r.generation.openingListening?.pass == null ? "n/a" : r.generation.openingListening.pass ? "pass" : "fail"} |`,
      `| Retrieval strategy | — | ${r.generation.retrievalStrategy ?? "n/a"} |`,
      `| Library sufficient | — | ${r.generation.librarySufficient === true ? "yes" : r.generation.libraryInsufficient ? "no (failed)" : "n/a"} |`,
      `| Would skip opener | — | ${r.generation.wouldSkipFirstTrack ? "yes" : "no"} |`,
      `| Judge winner | — | ${r.pairwise?.winner ?? "n/a"} (${r.pairwise?.confidence != null ? (r.pairwise.confidence * 100).toFixed(0) + "% conf" : ""}) |`,
      ...(r.generation.retrieval
        ? [
          "",
          "**Retrieval (audit):**",
          `- Profile: ${r.generation.retrieval.profile?.activity ?? r.generation.retrieval.activityProfileId ?? "n/a"} (confidence ${r.generation.retrieval.profile?.activityConfidence ?? "?"})`,
          `- Source mix: activity ${r.generation.retrieval.sourceDistribution?.activity_match ?? "?"}, emotional ${r.generation.retrieval.sourceDistribution?.emotional_match ?? "?"}, genre ${r.generation.retrieval.sourceDistribution?.genre_match ?? "?"}, favourites ${r.generation.retrieval.sourceDistribution?.favourite_artists ?? "?"}, exploratory ${r.generation.retrieval.sourceDistribution?.exploratory ?? "?"}`,
          `- Library gravity share: ${r.generation.retrieval.libraryGravityShare != null ? (r.generation.retrieval.libraryGravityShare * 100).toFixed(1) + "%" : "n/a"}`,
          `- Diversity index: ${r.generation.retrieval.diversityIndex?.toFixed(2) ?? "n/a"}`,
        ]
        : []),
      "",
      "**Human opening 5:**",
      ...r.humanReference.opening5.map((t) => `- ${t}`),
      "",
      "**Kwalify opening 5:**",
      ...r.generation.opening5.map((t) => `- ${t}`),
      "",
      r.pairwise?.reasons?.length
        ? `**Judge reasons:** ${r.pairwise.reasons.slice(0, 3).join("; ")}`
        : "",
      "",
    ]),
    "_Note: Internal pairwise judge is an engineering proxy, not blind human rating._",
  ].join("\n");

  await writeFile(mdPath, md);
  console.log(JSON.stringify({ reportPath, mdPath, summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
