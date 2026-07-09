/**
 * Diagnosis-only: break down human-saveability curatorScore for party-70s-disco.
 * Does not change thresholds, gates, or pipeline behavior.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "reports", "playlist-evaluation");
const PROMPT_ID = "party-70s-disco";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function txt(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function generate(baseUrl: string, token: string, spotifyUserId: string) {
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((row) => row.id === PROMPT_ID);
  if (!prompt) throw new Error(`Missing prompt ${PROMPT_ID}`);
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      auditMode: true,
      debug: true,
      debugPipeline: true,
      debugPerformance: true,
      spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = asRecord(await res.json().catch(() => ({}))) ?? {};
  return { prompt, status: res.status, body };
}

function extract(body: Record<string, unknown>) {
  const gd = asRecord(body.generationDiagnostics) ?? {};
  const v3 = asRecord(body.v3Diagnostics) ?? {};
  const exec = asRecord(body.playlistExecutionTrace) ?? {};
  const gate = asRecord(v3.humanSaveabilityGate) ?? {};
  const breakdown = asRecord(gate.breakdown) ?? {};
  const sceneWorld = asRecord(v3.sceneWorld) ?? asRecord(gd.sceneWorld) ?? {};
  const archetype = asRecord(sceneWorld.archetype) ?? asRecord(v3.sceneWorldArchetype);
  const tracks = asArray<Record<string, unknown>>(body.tracks);
  const gateTracks = asArray<Record<string, unknown>>(gate.finalTracks ?? gate.tracks);
  const evaluatedTracks = gateTracks.length > 0 ? gateTracks : tracks;

  const familyHistogram = new Map<string, number>();
  const genrePrimaryHistogram = new Map<string, number>();
  for (const track of evaluatedTracks) {
    const family = String(track.genreFamily ?? track.genrePrimary ?? "unknown").toLowerCase();
    const primary = String(track.genrePrimary ?? "unknown").toLowerCase();
    familyHistogram.set(family, (familyHistogram.get(family) ?? 0) + 1);
    genrePrimaryHistogram.set(primary, (genrePrimaryHistogram.get(primary) ?? 0) + 1);
  }

  const sceneClusterConsistency = num(breakdown.sceneClusterConsistency);
  const emotionalTextureConsistency = num(breakdown.emotionalTextureConsistency);
  const sonicWorldUniqueness = num(breakdown.sonicWorldUniqueness);
  const opening5Stability = num(breakdown.opening5Stability);
  const curatorScore = num(breakdown.curatorScore) ?? num(gate.curatorScore);

  const weightedContribution = {
    sceneClusterConsistency:
      sceneClusterConsistency != null ? Math.round(sceneClusterConsistency * 0.4 * 1000) / 1000 : null,
    emotionalTextureConsistency:
      emotionalTextureConsistency != null
        ? Math.round(emotionalTextureConsistency * 0.3 * 1000) / 1000
        : null,
    sonicWorldUniqueness:
      sonicWorldUniqueness != null ? Math.round(sonicWorldUniqueness * 0.2 * 1000) / 1000 : null,
    opening5Stability:
      opening5Stability != null ? Math.round(opening5Stability * 0.1 * 1000) / 1000 : null,
  };

  return {
    promptId: PROMPT_ID,
    prompt: txt(asRecord(body)?.vibe as unknown) ?? "70s disco party dancefloor",
    status: num(body.count) != null ? "ok" : "unknown",
    httpSuccess: body.success === true,
    count: num(body.count) ?? tracks.length,
    executionPath: txt(exec.executionPath),
    gate: {
      passed: gate.passed === true,
      humanSaveable: gate.humanSaveable === true,
      hardFailed: gate.hardFailed === true,
      degradedDelivery: gate.degradedDelivery === true,
      strictModeHumanSaveability: gate.strictModeHumanSaveability === true,
      curatorScore,
      wouldSaveScore: num(gate.wouldSaveScore),
      humanPatternScore: num(gate.humanPatternScore),
      rejectionReasons: asArray(gate.rejectionReasons).map(String),
      retriesUsed: num(gate.retriesUsed),
      breakdown: {
        curatorScore,
        sceneClusterConsistency,
        emotionalTextureConsistency,
        sonicWorldUniqueness,
        opening5Stability,
      },
      weightedContribution,
      formula:
        "curatorScore = sceneClusterConsistency*0.40 + emotionalTextureConsistency*0.30 + sonicWorldUniqueness*0.20 + opening5Stability*0.10",
      minCuratorScore: 0.86,
      offendingTracks: asArray<Record<string, unknown>>(gate.offendingTracks).map((row) => ({
        trackId: txt(row.trackId),
        title: txt(row.title),
        artist: txt(row.artist),
        rank: num(row.rank),
        reason: txt(row.reason),
      })),
      attribution: asRecord(gate.attribution),
    },
    evaluatedTrackCount: evaluatedTracks.length,
    familyHistogram: [...familyHistogram.entries()]
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => b.count - a.count),
    genrePrimaryHistogram: [...genrePrimaryHistogram.entries()]
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count),
    sceneWorldActive: sceneWorld.active === true,
    archetypeGenreFamilies: asArray(archetype?.genreFamilies ?? sceneWorld.genreFamilies).map(String),
    candidates: {
      afterConstraints: num(gd.candidatesAfterConstraints),
      afterRanking: num(gd.candidatesAfterRanking),
      afterDiversity: num(gd.candidatesAfterDiversity),
      afterRepair: num(gd.candidatesAfterRepair),
      final: num(gd.candidatesFinal),
    },
    trackTitles: evaluatedTracks.slice(0, 30).map((t, i) => ({
      rank: i + 1,
      title: txt(t.trackName) ?? txt(t.name) ?? txt(t.trackId),
      artist: txt(t.artistName) ?? txt(t.artist) ?? "?",
      genreFamily: txt(t.genreFamily),
      genrePrimary: txt(t.genrePrimary),
      energy: num(t.energy),
      danceability: num(t.danceability),
      acousticness: num(t.acousticness),
    })),
  };
}

function markdown(report: ReturnType<typeof extract>): string {
  const g = report.gate;
  const b = g.breakdown;
  const w = g.weightedContribution;
  const lines: string[] = [
    "# party-70s-disco human-saveability gate breakdown",
    "",
    "_Diagnosis only — no threshold or gate changes._",
    "",
    "## Verdict",
    "",
    `- executionPath: \`${report.executionPath ?? "?"}\``,
    `- final count: **${report.count}**`,
    `- humanSaveable: **${g.humanSaveable}**`,
    `- strictModeHumanSaveability (soft-scene strict): **${g.strictModeHumanSaveability}**`,
    `- curatorScore: **${g.curatorScore ?? "n/a"}** (min ${g.minCuratorScore})`,
    `- rejectionReasons: ${g.rejectionReasons.map((r) => `\`${r}\``).join("; ") || "_none_"}`,
    "",
    "## How curatorScore is calculated",
    "",
    "```",
    g.formula,
    "```",
    "",
    "From `backend/core/human-saveability-gate.ts` `computeCuratorScore`.",
    "",
    "| Component | Raw (0–1) | Weight | Contribution to curatorScore |",
    "| --- | ---: | ---: | ---: |",
    `| sceneClusterConsistency | ${b.sceneClusterConsistency ?? "n/a"} | 0.40 | ${w.sceneClusterConsistency ?? "n/a"} |`,
    `| emotionalTextureConsistency | ${b.emotionalTextureConsistency ?? "n/a"} | 0.30 | ${w.emotionalTextureConsistency ?? "n/a"} |`,
    `| sonicWorldUniqueness | ${b.sonicWorldUniqueness ?? "n/a"} | 0.20 | ${w.sonicWorldUniqueness ?? "n/a"} |`,
    `| opening5Stability | ${b.opening5Stability ?? "n/a"} | 0.10 | ${w.opening5Stability ?? "n/a"} |`,
    `| **curatorScore** | | | **${g.curatorScore ?? "n/a"}** |`,
    "",
    "### Component definitions (short)",
    "",
    "- **sceneClusterConsistency**: mean scene-cluster membership, or `1 - family entropy` if no scene clusters.",
    "- **emotionalTextureConsistency**: `1 - entropy` over texture buckets (acoustic / rhythmic / dense / balanced).",
    "- **sonicWorldUniqueness**: dominant family share, then ×0.35 if ≥3 families (or ×0.62 if exactly 2 families **and** soft-scene strict).",
    "- **opening5Stability**: opening-5 cluster membership / family entropy.",
    "",
    "## Which rule fires \"too many genre families\"",
    "",
    "Exact rule in `evaluateHumanSaveability`:",
    "",
    "```ts",
    "if (!strict && families.size >= 3) {",
    "  rejectionReasons.push(`too many genre families (${families.size}) for single-curator aesthetic`);",
    "}",
    "```",
    "",
    "`strict` here is `strictModeHumanSaveability` = `isSoftScenePrompt(vibe, lockedIntent)`.",
    "Soft-scene is **false** when the locked intent has genre families **or** an era range — so compound prompts like \"70s disco party\" are evaluated under the **non–soft-scene** (relaxed aesthetic) branch.",
    "",
    "That branch allows 2 families but hard-rejects ≥3.",
    "Separately, `sonicWorldUniqueness` is multiplied by **0.35** whenever familyCount ≥ 3 (score drag, independent of that rejection string).",
    "",
    `Observed families on evaluated playlist (${report.evaluatedTrackCount} tracks):`,
    "",
    "| Family | Count |",
    "| --- | ---: |",
    ...report.familyHistogram.map((row) => `| ${row.family} | ${row.count} |`),
    "",
    `Archetype primary families (if any): ${report.archetypeGenreFamilies.join(", ") || "_none / scene world inactive_"}`,
    `sceneWorld.active: ${report.sceneWorldActive}`,
    "",
    "## Offending tracks / transitions",
    "",
  ];

  if (g.offendingTracks.length === 0) {
    lines.push("_No per-track offenders recorded (failure is playlist-level / aesthetic rule)._");
  } else {
    lines.push("| Rank | Title | Artist | Reason |", "| ---: | --- | --- | --- |");
    for (const row of g.offendingTracks) {
      lines.push(`| ${row.rank ?? "?"} | ${row.title ?? "?"} | ${row.artist ?? "?"} | ${row.reason ?? "?"} |`);
    }
  }

  lines.push(
    "",
    "## Funnel context",
    "",
    `| Stage | Count |`,
    `| --- | ---: |`,
    `| afterConstraints | ${report.candidates.afterConstraints ?? "n/a"} |`,
    `| afterRanking | ${report.candidates.afterRanking ?? "n/a"} |`,
    `| afterDiversity | ${report.candidates.afterDiversity ?? "n/a"} |`,
    `| afterRepair | ${report.candidates.afterRepair ?? "n/a"} |`,
    `| final | ${report.candidates.final ?? report.count} |`,
    "",
    "## Tracks presented to (or surviving) gate",
    "",
    "| Rank | Title | Artist | family | primary | energy | dance | acoustic |",
    "| ---: | --- | --- | --- | --- | ---: | ---: | ---: |",
    ...report.trackTitles.map(
      (t) =>
        `| ${t.rank} | ${t.title ?? "?"} | ${t.artist} | ${t.genreFamily ?? "?"} | ${t.genrePrimary ?? "?"} | ${t.energy ?? "?"} | ${t.danceability ?? "?"} | ${t.acousticness ?? "?"} |`,
    ),
    "",
    "## Interpretation checklist",
    "",
    "Use the weighted rows above to classify root cause:",
    "",
    "1. **Candidate pool** — families genuinely fragmented across 3+ stacks; pool/selection issue.",
    "2. **Scoring formula** — one weighted component systemically accounts for most of the deficit vs 0.86.",
    "3. **Editorial thresholds** — curatorScore near threshold but hard family/pair rules fail first.",
    "4. **Specific aesthetic rule** — `!strict && families.size >= 3` firing on a compound prompt that is not soft-scene.",
    "",
  );

  return lines.join("\n");
}

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });
  process.stderr.write(`[gate-breakdown] generating ${PROMPT_ID}...\n`);
  const { status, body } = await generate(creds.baseUrl, creds.token, creds.spotifyUserId);
  const report = {
    ...extract(body),
    httpStatus: status,
    rawGateKeys: Object.keys(asRecord(asRecord(body.v3Diagnostics)?.humanSaveabilityGate) ?? {}),
  };
  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "party-70s-disco-gate-breakdown.json");
  const mdPath = path.join(OUT_DIR, "party-70s-disco-gate-breakdown.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdPath, markdown(report), "utf8");
  process.stderr.write(`[gate-breakdown] wrote ${mdPath}\n`);
  console.log(
    JSON.stringify(
      {
        curatorScore: report.gate.curatorScore,
        breakdown: report.gate.breakdown,
        weightedContribution: report.gate.weightedContribution,
        rejectionReasons: report.gate.rejectionReasons,
        strictModeHumanSaveability: report.gate.strictModeHumanSaveability,
        familyHistogram: report.familyHistogram,
        offendingTrackCount: report.gate.offendingTracks.length,
        count: report.count,
        executionPath: report.executionPath,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
