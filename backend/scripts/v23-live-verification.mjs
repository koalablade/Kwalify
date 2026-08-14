#!/usr/bin/env node
/**
 * V23 Live Verification — fresh V22 pipeline generation for 7 critical/control prompts.
 *
 * Usage: node backend/scripts/v23-live-verification.mjs [--resume]
 * Output:
 *   reports/playlist-evaluation/v23-live-verification.json
 *   reports/playlist-evaluation/V23_LIVE_VERIFICATION.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  normalizeBenchmarkTracks,
} from "./lib/benchmark-track-normalizer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_JSON = resolve(ROOT, "reports/playlist-evaluation/v23-live-verification.json");
const OUT_MD = resolve(ROOT, "reports/playlist-evaluation/V23_LIVE_VERIFICATION.md");
const OUT_LOG = resolve(ROOT, "reports/playlist-evaluation/v23-live-verification.log");
const G_REVIEW = resolve(ROOT, "reports/playlist-evaluation/v21-experiment-g-human-review-set.json");

const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
const DELAY_MS = 1500;
const SEED = 42;
const TEMPLATE_ARTISTS = ["jungle giants", "wallows", "the 1975"];

const CASES = [
  { id: "G-016", kind: "critical", expectWorldId: "uk_garage_world", prompt: "late night uk garage drive" },
  { id: "G-030", kind: "critical", expectWorldId: "gym_energy_world", prompt: "hard techno gym", musicExpect: "techno_not_rock" },
  { id: "G-032", kind: "critical", expectWorldId: "pop_punk_world", prompt: "2000s pop punk gym workout", musicExpect: "pop_punk" },
  { id: "G-036", kind: "critical", expectWorldId: "pop_punk_world", prompt: "2000s pop punk gym workout with no pop music", musicExpect: "pop_punk_no_pop" },
  { id: "G-027", kind: "control", expectWorldId: "dad_rock_world", prompt: "dad rock BBQ with beers" },
  { id: "G-023", kind: "control", expectWorldId: "rainy_motorway_world", prompt: null },
  { id: "G-034", kind: "control", expectWorldId: "pop_punk_world", prompt: "pop punk cardio playlist with no Blink-182", musicExpect: "pop_punk_no_blink" },
];

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  mkdirSync(dirname(OUT_LOG), { recursive: true });
  appendFileSync(OUT_LOG, msg + "\n", "utf8");
}

function getHeadCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function loadV21Baseline() {
  if (!existsSync(G_REVIEW)) return {};
  const g = JSON.parse(readFileSync(G_REVIEW, "utf8"));
  const out = {};
  for (const c of CASES) {
    const pl = g.playlists?.find((p) => p.reviewId === c.id);
    if (!pl) continue;
    const ev = pl._evaluator ?? {};
    const tracks = pl.tracklist ?? [];
    out[c.id] = {
      prompt: pl.prompt,
      hcs: ev.hcs ?? null,
      share: ev.share ?? null,
      save: ev.save ?? null,
      cohesion: ev.cohesion ?? null,
      moment: ev.moment ?? null,
      plausibility: ev.plausibility ?? null,
      trackCount: tracks.length,
      artists: [...new Set(tracks.map((t) => t.artistName ?? t.artist).filter(Boolean))],
      tracks: tracks.map((t) => ({ artist: t.artistName ?? t.artist, track: t.trackName ?? t.name })),
      templateHits: templateArtistsInTracks(tracks),
    };
  }
  return out;
}

function templateArtistsInTracks(tracks) {
  const hits = Object.fromEntries(TEMPLATE_ARTISTS.map((a) => [a, 0]));
  for (const t of tracks ?? []) {
    const artist = String(t.artistName ?? t.artist ?? "").toLowerCase();
    for (const a of TEMPLATE_ARTISTS) {
      if (artist.includes(a)) hits[a] += 1;
    }
  }
  return hits;
}

function extractRetrievalDiagnostics(data) {
  const gen = data.generationDiagnostics ?? {};
  const v3 = data.v3Diagnostics ?? {};
  const funnel = data.retrievalFunnel ?? gen.retrievalFunnel ?? null;
  const pools = v3.retrievalPoolsDetailed ?? null;
  const fallback = v3.fallback ?? gen.fallback ?? null;
  const sceneWorld = v3.sceneWorldLayer ?? null;
  const worldCoherence = v3.worldCoherence ?? null;

  let worldPreservingFallback = null;
  const search = (obj, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 6) return;
    if (typeof obj.fallback === "string" && obj.fallback.includes("world_preserving")) {
      worldPreservingFallback = obj.fallback;
    }
    for (const v of Object.values(obj)) {
      if (typeof v === "object") search(v, depth + 1);
    }
  };
  search(gen);
  search(v3);
  search(funnel);

  return {
    retrievalFunnel: funnel,
    retrievalPoolsDetailed: pools,
    fallback,
    sceneWorldLayer: sceneWorld,
    worldCoherence,
    worldPreservingFallbackActivated: worldPreservingFallback != null,
    worldPreservingFallback,
    retrievalStrategy: gen.retrievalStrategy ?? gen.candidateRetrieval ?? pools?.strategy ?? null,
    poolSummary: pools?.summary ?? pools?.primaryPool ?? null,
  };
}

function extractCommittedWorldFromResponse(data, resolveCommittedWorld) {
  const v3 = data.v3Diagnostics ?? {};
  const gen = data.generationDiagnostics ?? {};
  const fromDiag =
    v3.committedWorld ??
    gen.committedWorld ??
    v3.sceneWorldLayer?.committedWorld ??
    v3.worldCoherence?.committedWorld ??
    null;

  const prompt = data.prompt ?? data.vibe ?? null;
  const resolved = prompt ? resolveCommittedWorld({ prompt }) : null;

  return {
    fromDiagnostics: fromDiag,
    resolved: resolved
      ? {
          id: resolved.id,
          musicalWorldId: resolved.musicalWorldId ?? null,
          activityContext: resolved.activityContext ?? null,
          activityWorldId: resolved.activityWorldId ?? null,
          source: resolved.source,
          hardLock: resolved.hardLock,
          reason: resolved.reason,
        }
      : null,
  };
}

function assessMusic(caseDef, tracks, helpers) {
  const { getCulturalProfile, scoreTrackWorldIdentity, artistForbiddenInWorld } = helpers;
  const profile = getCulturalProfile(caseDef.expectWorldId);
  const artistList = tracks.map((t) => t.artistName ?? t.artist).filter(Boolean);
  const lowerArtists = artistList.map((a) => String(a).toLowerCase());

  const rockBetrayal = ["ac/dc", "guns n' roses", "metallica", "led zeppelin", "journey"];
  const popBetrayal = ["taylor swift", "ariana grande", "dua lipa", "ed sheeran", "katy perry"];
  const indieTemplate = TEMPLATE_ARTISTS.filter((a) => lowerArtists.some((x) => x.includes(a)));

  let worldScores = [];
  if (profile) {
    worldScores = tracks.map((t) =>
      scoreTrackWorldIdentity(
        {
          artistName: t.artistName ?? t.artist,
          trackName: t.trackName ?? t.name,
          energy: t.energy ?? null,
          valence: t.valence ?? null,
        },
        profile,
      ),
    );
  }

  const meanWorldScore = worldScores.length
    ? worldScores.reduce((a, b) => a + b, 0) / worldScores.length
    : null;
  const strongBelonging = worldScores.filter((s) => s >= 0.8).length;
  const weakBelonging = worldScores.filter((s) => s < 0.4).length;

  const hasRockBetrayal = rockBetrayal.some((r) => lowerArtists.some((a) => a.includes(r)));
  const hasPopBetrayal = popBetrayal.some((p) => lowerArtists.some((a) => a.includes(p)));
  const hasBlink = lowerArtists.some((a) => a.includes("blink-182") || a.includes("blink 182"));

  let musicOk = false;
  let musicNote = "";

  switch (caseDef.musicExpect ?? caseDef.expectWorldId) {
    case "techno_not_rock":
      musicOk = !hasRockBetrayal && (strongBelonging >= Math.max(2, Math.ceil(tracks.length * 0.4)) || meanWorldScore >= 0.55);
      musicNote = hasRockBetrayal ? "Rock betrayal (AC/DC/GNR/etc)" : musicOk ? "Techno/electronic gym fit" : "Weak techno world fit";
      break;
    case "pop_punk":
      musicOk = strongBelonging >= Math.max(3, Math.ceil(tracks.length * 0.5)) && !hasRockBetrayal;
      musicNote = musicOk ? "Pop-punk anchors present" : "Insufficient pop-punk identity";
      break;
    case "pop_punk_no_pop":
      musicOk =
        strongBelonging >= Math.max(3, Math.ceil(tracks.length * 0.5)) &&
        !hasPopBetrayal;
      musicNote = hasPopBetrayal ? "Pop artist leakage" : musicOk ? "Pop-punk without pop leakage" : "Weak pop-punk fit";
      break;
    case "pop_punk_no_blink":
      musicOk = !hasBlink && strongBelonging >= Math.max(2, Math.ceil(tracks.length * 0.4));
      musicNote = hasBlink ? "Blink-182 present (negation violated)" : musicOk ? "Pop-punk without Blink" : "Weak pop-punk fit";
      break;
    case "uk_garage_world":
      musicOk = strongBelonging >= Math.max(3, Math.ceil(tracks.length * 0.5)) && indieTemplate.length === 0;
      musicNote = indieTemplate.length ? `Indie template leakage: ${indieTemplate.join(", ")}` : musicOk ? "UK garage identity" : "Weak UK garage fit";
      break;
    default:
      musicOk = meanWorldScore != null ? meanWorldScore >= 0.55 && weakBelonging <= Math.ceil(tracks.length * 0.3) : tracks.length >= 5;
      musicNote = musicOk ? "Control world fit acceptable" : "Control world fit degraded";
  }

  return {
    musicOk,
    musicNote,
    meanWorldScore: meanWorldScore != null ? Math.round(meanWorldScore * 100) / 100 : null,
    strongBelonging,
    weakBelonging,
    hasRockBetrayal,
    hasPopBetrayal,
    hasBlink,
    indieTemplate,
    artists: artistList,
  };
}

function classifyVerdict(caseDef, v21, v22, worldFixed, musicFixed) {
  const isControl = caseDef.kind === "control";
  const v21Share = v21?.share ?? null;
  const v22Share = v22?.share ?? null;
  const v21MusicBad = caseDef.musicExpect === "techno_not_rock" && v21?.artists?.some((a) => /ac\/dc|guns n/i.test(a));
  const v21WasGood = isControl && (v21?.share === "YES" || v21?.share === "MAYBE") && (v21?.hcs ?? 0) >= 80;

  if (isControl) {
    const regressed =
      (v21WasGood && v22Share === "NO") ||
      (v21?.hcs != null && v22?.hcs != null && v22.hcs < v21.hcs - 15) ||
      (!musicFixed && v21MusicBad !== true);
    if (regressed && !worldFixed) return { verdict: "REGRESSION", reason: "Control case degraded vs V21" };
    if (worldFixed && musicFixed) return { verdict: "FIXED", reason: "Control preserved or improved" };
    if (worldFixed || musicFixed) return { verdict: "PARTIALLY FIXED", reason: "Control mixed" };
    return { verdict: v21WasGood ? "NOT FIXED" : "PARTIALLY FIXED", reason: "Control stable" };
  }

  if (worldFixed && musicFixed) return { verdict: "FIXED", reason: "World and music both corrected" };
  if (worldFixed && !musicFixed) return { verdict: "PARTIALLY FIXED", reason: "World fixed; generator/retrieval still wrong" };
  if (!worldFixed && musicFixed) return { verdict: "PARTIALLY FIXED", reason: "Music improved but world resolution wrong" };
  if (v21MusicBad && !musicFixed) return { verdict: "NOT FIXED", reason: "Same music failure as V21" };
  return { verdict: "NOT FIXED", reason: "Neither world nor music fixed" };
}

function pickConclusion(rows) {
  const critical = rows.filter((r) => r.kind === "critical");
  const regressions = rows.filter((r) => r.verdict === "REGRESSION");
  const worldOnly = critical.filter((r) => r.worldFixed && !r.musicFixed);
  const allCriticalFixed = critical.every((r) => r.verdict === "FIXED");
  const musicGoodEvaluatorBad = rows.filter(
    (r) => r.musicFixed && r.v22?.share === "NO" && (r.v21?.share === "YES" || r.v21?.share === "MAYBE"),
  );

  if (regressions.length > 0) return { id: 3, text: "Regression → investigate regression" };
  if (allCriticalFixed && critical.length > 0) return { id: 1, text: "V22 works → move to human listening/validation" };
  if (worldOnly.length > 0) return { id: 2, text: "World fixed but music wrong → next fix is generator/retrieval" };
  if (musicGoodEvaluatorBad.length >= 2) return { id: 4, text: "Music good but evaluator wrong → evaluator issue" };
  if (critical.some((r) => r.verdict === "FIXED" || r.verdict === "PARTIALLY FIXED")) {
    return { id: 2, text: "World fixed but music wrong → next fix is generator/retrieval" };
  }
  return { id: 3, text: "Regression → investigate regression" };
}

function renderMarkdown(payload) {
  const lines = [];
  lines.push("# V23 Live Verification");
  lines.push("");
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push(`Commit: \`${payload.commit}\``);
  lines.push(`Base URL: ${payload.baseUrl}`);
  lines.push(`Method: fresh live /api/generate?audit=1 (seed=${SEED})`);
  lines.push("");
  lines.push("## Verdict table");
  lines.push("");
  lines.push("| Case | V21 | Fresh V22 | World fixed? | Music fixed? | Verdict |");
  lines.push("|------|-----|-----------|--------------|--------------|---------|");
  for (const r of payload.results) {
    const v21s = `HCS ${r.v21?.hcs ?? "—"} / Share ${r.v21?.share ?? "—"} / ${r.v21?.trackCount ?? 0} tracks`;
    const v22s = `HCS ${r.v22?.hcs ?? "—"} / Share ${r.v22?.share ?? "—"} / ${r.v22?.trackCount ?? 0} tracks`;
    lines.push(
      `| ${r.id} | ${v21s} | ${v22s} | ${r.worldFixed ? "Yes" : "No"} | ${r.musicFixed ? "Yes" : "No"} | **${r.verdict}** |`,
    );
  }
  lines.push("");
  lines.push(`## Final conclusion`);
  lines.push("");
  lines.push(`${payload.conclusion.id}. **${payload.conclusion.text}**`);
  lines.push("");
  lines.push("## Template artist recurrence (Jungle Giants / Wallows / The 1975)");
  lines.push("");
  lines.push("| Scope | Playlists w/ template | Jungle Giants | Wallows | The 1975 |");
  lines.push("|-------|----------------------|---------------|---------|----------|");
  const v21t = payload.templateRecurrence.v21;
  const v22t = payload.templateRecurrence.v22;
  lines.push(
    `| V21 (same prompts) | ${v21t.playlistsWithTemplate}/${v21t.playlistCount} | ${v21t.artistCounts["jungle giants"]} | ${v21t.artistCounts.wallows} | ${v21t.artistCounts["the 1975"]} |`,
  );
  lines.push(
    `| Fresh V22 | ${v22t.playlistsWithTemplate}/${v22t.playlistCount} | ${v22t.artistCounts["jungle giants"]} | ${v22t.artistCounts.wallows} | ${v22t.artistCounts["the 1975"]} |`,
  );
  lines.push("");
  lines.push("## Per-case detail");
  lines.push("");
  for (const r of payload.results) {
    lines.push(`### ${r.id} — ${r.prompt}`);
    lines.push("");
    lines.push(`- **Expected world:** ${r.expectWorldId}`);
    lines.push(`- **Resolved world:** ${r.v22?.committedWorld?.resolved?.id ?? "—"} (musical: ${r.v22?.committedWorld?.resolved?.musicalWorldId ?? "—"}, activity: ${r.v22?.committedWorld?.resolved?.activityContext ?? "—"})`);
    lines.push(`- **World-preserving fallback:** ${r.v22?.retrieval?.worldPreservingFallbackActivated ? "yes" : "no"}${r.v22?.retrieval?.worldPreservingFallback ? ` (${r.v22.retrieval.worldPreservingFallback})` : ""}`);
    lines.push(`- **V22 scores:** HCS ${r.v22?.hcs ?? "—"}, cohesion ${r.v22?.cohesion ?? "—"}, moment ${r.v22?.moment ?? "—"}, plausibility ${r.v22?.plausibility ?? "—"}, Share ${r.v22?.share ?? "—"}`);
    lines.push(`- **Music assessment:** ${r.v22?.music?.musicNote ?? "—"}`);
    lines.push(`- **Verdict:** ${r.verdict} — ${r.verdictReason}`);
    lines.push("");
    lines.push("**V21 artists:** " + (r.v21?.artists?.slice(0, 10).join(", ") || "—"));
    lines.push("");
    lines.push("**V22 artists:** " + (r.v22?.music?.artists?.slice(0, 10).join(", ") || "—"));
    lines.push("");
    if (r.v22?.tracks?.length) {
      lines.push("<details><summary>V22 tracklist</summary>");
      lines.push("");
      for (const [i, t] of r.v22.tracks.entries()) {
        lines.push(`${i + 1}. ${t.artist} — ${t.track}`);
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }
  if (payload.blockers?.length) {
    lines.push("## Blockers");
    lines.push("");
    for (const b of payload.blockers) lines.push(`- ${b}`);
  }
  return lines.join("\n");
}

async function generateOne(creds, prompt, requestId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${creds.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: prompt,
        mode: "balanced",
        length: 25,
        varietyBoost: true,
        auditMode: true,
        spotifyUserId: creds.spotifyUserId,
        requestId,
        seed: SEED,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const resume = process.argv.includes("--resume");
  mkdirSync(dirname(OUT_JSON), { recursive: true });

  const { resolveLiveBenchmarkCredentials } = await import("../dist/lib/benchmark-env.js");
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const { resolveCommittedWorld } = await import("../dist/core/committed-world.js");
  const { getCulturalProfile } = await import("../dist/core/editorial/cultural-identity-profile.js");
  const { scoreTrackWorldIdentity } = await import("../dist/core/editorial/world-identity-score.js");

  const creds = await resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: "http://127.0.0.1:5000",
  });

  const v21Baseline = loadV21Baseline();
  for (const c of CASES) {
    if (!c.prompt && v21Baseline[c.id]?.prompt) c.prompt = v21Baseline[c.id].prompt;
  }

  let existing = { results: [], blockers: [] };
  if (resume && existsSync(OUT_JSON)) {
    existing = JSON.parse(readFileSync(OUT_JSON, "utf8"));
    log(`Resuming — ${existing.results?.length ?? 0} cases done`);
  }

  const doneIds = new Set((existing.results ?? []).map((r) => r.id));
  const results = [...(existing.results ?? [])];
  const blockers = [...(existing.blockers ?? [])];

  log(`V23 live verification starting commit=${getHeadCommit()} baseUrl=${creds.baseUrl}`);

  try {
    const ping = await fetch(`${creds.baseUrl}/api/eval/ping`, {
      headers: { "x-kwalify-evaluation-token": creds.token },
    });
    if (!ping.ok) blockers.push(`eval/ping returned ${ping.status}`);
  } catch (err) {
    blockers.push(`API unreachable at ${creds.baseUrl}: ${err.message}`);
    log(`BLOCKER: ${blockers[blockers.length - 1]}`);
  }

  for (const caseDef of CASES) {
    if (doneIds.has(caseDef.id)) continue;
    const prompt = caseDef.prompt;
    log(`[${caseDef.id}] generating: ${prompt}`);

    const row = {
      id: caseDef.id,
      kind: caseDef.kind,
      prompt,
      expectWorldId: caseDef.expectWorldId,
      v21: v21Baseline[caseDef.id] ?? null,
      v22: null,
      worldFixed: false,
      musicFixed: false,
      verdict: "NOT FIXED",
      verdictReason: "",
      success: false,
      error: null,
    };

    try {
      const t0 = Date.now();
      const { httpStatus, data } = await generateOne(creds, prompt, `v23-${caseDef.id}`);
      const rawTracks = data.tracks ?? data.playlist ?? [];
      const normalized = normalizeBenchmarkTracks(rawTracks);
      const score = evaluateHumanCurationScore(prompt, normalized);
      const committedWorld = extractCommittedWorldFromResponse({ ...data, prompt }, resolveCommittedWorld);
      const retrieval = extractRetrievalDiagnostics(data);
      const music = assessMusic(caseDef, normalized, { getCulturalProfile, scoreTrackWorldIdentity });

      const resolvedId = committedWorld.resolved?.id ?? null;
      row.worldFixed = resolvedId === caseDef.expectWorldId;
      row.musicFixed = music.musicOk;
      row.success = httpStatus === 200 && rawTracks.length > 0;

      row.v22 = {
        httpStatus,
        durationMs: Date.now() - t0,
        trackCount: rawTracks.length,
        hcs: score.totalScore,
        share: score.wouldShare,
        save: score.wouldSave,
        pressPlay: score.wouldPressPlay,
        tier: score.saveabilityDeliveryTier,
        cohesion: score.dimensions.cohesion.score,
        moment: score.dimensions.momentUnderstanding.score,
        plausibility: score.dimensions.humanPlausibility.score,
        sequencing: score.dimensions.sequencing.score,
        committedWorld,
        retrieval,
        music,
        tracks: normalized.map((t) => ({ artist: t.artistName, track: t.trackName })),
      };

      const { verdict, reason } = classifyVerdict(caseDef, row.v21, row.v22, row.worldFixed, row.musicFixed);
      row.verdict = verdict;
      row.verdictReason = reason;

      log(
        `  done ${row.v22.durationMs}ms http=${httpStatus} tracks=${rawTracks.length} world=${resolvedId} share=${row.v22.share} verdict=${verdict}`,
      );
    } catch (err) {
      row.error = String(err?.message ?? err);
      row.verdict = "NOT FIXED";
      row.verdictReason = row.error;
      log(`  ERROR: ${row.error}`);
    }

    results.push(row);
    doneIds.add(caseDef.id);

    const partial = {
      generatedAt: new Date().toISOString(),
      experiment: "v23-live-verification",
      commit: getHeadCommit(),
      baseUrl: creds.baseUrl,
      seed: SEED,
      results,
      blockers,
    };
    writeFileSync(OUT_JSON, JSON.stringify(partial, null, 2), "utf8");

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const v21Template = { artistCounts: Object.fromEntries(TEMPLATE_ARTISTS.map((a) => [a, 0])), playlistsWithTemplate: 0, playlistCount: 0 };
  const v22Template = { artistCounts: Object.fromEntries(TEMPLATE_ARTISTS.map((a) => [a, 0])), playlistsWithTemplate: 0, playlistCount: 0 };

  for (const r of results) {
    if (r.v21?.templateHits) {
      v21Template.playlistCount += 1;
      let any = false;
      for (const [a, n] of Object.entries(r.v21.templateHits)) {
        v21Template.artistCounts[a] += n;
        if (n > 0) any = true;
      }
      if (any) v21Template.playlistsWithTemplate += 1;
    }
    if (r.v22?.tracks) {
      v22Template.playlistCount += 1;
      const hits = templateArtistsInTracks(r.v22.tracks.map((t) => ({ artistName: t.artist })));
      let any = false;
      for (const [a, n] of Object.entries(hits)) {
        v22Template.artistCounts[a] += n;
        if (n > 0) any = true;
      }
      if (any) v22Template.playlistsWithTemplate += 1;
    }
  }

  const conclusion = pickConclusion(results);
  const payload = {
    generatedAt: new Date().toISOString(),
    experiment: "v23-live-verification",
    commit: getHeadCommit(),
    baseUrl: creds.baseUrl,
    seed: SEED,
    generationSucceeded: results.every((r) => r.success),
    results,
    templateRecurrence: { v21: v21Template, v22: v22Template },
    conclusion,
    blockers,
    keyQuestions: {
      ukGarageProducedUkGarage: results.find((r) => r.id === "G-016")?.musicFixed ?? false,
      hardTechnoNotRock: results.find((r) => r.id === "G-030")?.musicFixed ?? false,
      popPunkGymProducedPopPunk: results.find((r) => r.id === "G-032")?.musicFixed ?? false,
      noPopMusicRespected: results.find((r) => r.id === "G-036")?.musicFixed ?? false,
      controlsRegressed: results.filter((r) => r.kind === "control" && r.verdict === "REGRESSION").map((r) => r.id),
      templateImproved: v22Template.playlistsWithTemplate <= v21Template.playlistsWithTemplate,
    },
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(OUT_MD, renderMarkdown(payload), "utf8");
  log(`Complete → ${OUT_JSON}`);
  log(`Report → ${OUT_MD}`);
  console.log(JSON.stringify({ conclusion, keyQuestions: payload.keyQuestions, generationSucceeded: payload.generationSucceeded }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
