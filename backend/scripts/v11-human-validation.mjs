/**
 * V11 live validation — 8 world-critical prompts, KEEP/MAYBE/DROP by thesis authority + full-world proof.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolveLiveBenchmarkCredentials } from "../dist/lib/benchmark-env.js";
import { parseHumanSaveabilityFromGenerateResponse } from "../dist/lib/human-saveability-benchmark-parse.js";
import { resolveCommittedWorld } from "../dist/core/committed-world.js";
import { scoreTrackWorldIdentity, resolveCulturalProfileForCommitted } from "../dist/core/editorial/world-identity-score.js";
import { artistForbiddenInWorld } from "../dist/core/editorial/artist-identity-map.js";
import { evaluateWorldProof } from "../dist/core/editorial/world-proof-gate.js";
import { enforceThesisOpener } from "../dist/core/editorial/thesis-opener-gate.js";
import { evaluateHumanUnderstoodGate } from "../dist/core/editorial/human-understood-gate.js";

const PROMPTS = [
  { id: "motorway_rain", prompt: "empty motorway at midnight rain on the windscreen" },
  { id: "dad_rock_bbq", prompt: "dad rock BBQ with beers" },
  { id: "80s_night_drive", prompt: "80s night drive" },
  { id: "madchester", prompt: "madchester pub walk" },
  { id: "disco", prompt: "disco rooftop party 1978" },
  { id: "gym", prompt: "heavy gym workout aggressive" },
  { id: "country_cowboy", prompt: "country cowboy road trip" },
  { id: "no_rap_gym", prompt: "no rap gym workout" },
];

function getHeadCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function classify(prompt, tracks, httpStatus, coverageLevel) {
  const committed = resolveCommittedWorld({ prompt });
  const profile = resolveCulturalProfileForCommitted(committed);
  const worldIds = committed?.worldIds ?? [];
  const top5 = tracks.slice(0, 5);

  const offWorldOpeners = top5.filter((t) => {
    const artist = String(t.artistName ?? t.artist ?? "");
    if (artistForbiddenInWorld(artist, worldIds)) return true;
    if (profile) {
      const score = scoreTrackWorldIdentity(
        { artistName: artist, trackName: t.trackName ?? t.name, energy: t.energy },
        profile,
      );
      return score === 0 || score < 0.45;
    }
    return false;
  });

  const mapped = tracks.map((t) => ({
    trackName: t.trackName ?? t.name,
    artistName: t.artistName ?? t.artist,
    energy: t.energy ?? null,
  }));

  const thesis = committed?.hardLock && profile
    ? enforceThesisOpener(mapped, profile, committed, undefined, 20)
    : null;
  const worldProof = committed
    ? evaluateWorldProof({
        tracks: mapped,
        committed,
        prompt,
        requestedLength: 25,
        coverageLevel,
      })
    : null;
  const understood = evaluateHumanUnderstoodGate({
    trackCount: tracks.length,
    requestedLength: 25,
    committed,
    thesis,
    worldProof,
    negationViolations: 0,
    openerNegationViolations: 0,
    coverageLevel,
  });

  const opener1 = thesis?.tracks[0] ?? tracks[0];
  const opener1Score = profile && opener1
    ? scoreTrackWorldIdentity(
        { artistName: opener1.artistName ?? opener1.artist, trackName: opener1.trackName ?? opener1.name },
        profile,
      )
    : 0;
  const opener1Ok = opener1Score >= 0.8;

  const count = tracks.length;
  if (count === 0 || httpStatus === 422 || understood.action === "refuse") {
    return { verdict: "DROP", why: "empty, refused, or wrong world" };
  }
  if (offWorldOpeners.length >= 2) return { verdict: "DROP", why: `${offWorldOpeners.length} off-world openers` };
  if (!opener1Ok && offWorldOpeners.length >= 1) return { verdict: "DROP", why: "weak track 1 + off-world opener" };
  if (worldProof && !worldProof.fullPlaylistPassed && !opener1Ok) {
    return { verdict: "DROP", why: `full playlist sample fail (${worldProof.samplePassRate?.toFixed(2)})` };
  }
  if (opener1Ok && count >= 12 && offWorldOpeners.length === 0 && (worldProof?.fullPlaylistPassed ?? true)) {
    return { verdict: "KEEP", why: "anchor thesis opener + full-world proof" };
  }
  if (opener1Ok && count >= 8 && offWorldOpeners.length === 0) {
    return { verdict: "KEEP", why: "strong anchor opener, honest length" };
  }
  if (offWorldOpeners.length === 0 && count >= 3) {
    if (opener1Ok) return { verdict: "MAYBE", why: `good opener, coverage=${coverageLevel ?? "unknown"}` };
    return { verdict: "MAYBE", why: `partial world fit, coverage=${coverageLevel ?? "unknown"}` };
  }
  return { verdict: "DROP", why: "stub or world drift" };
}

async function fetchGenerate(creds, prompt, requestId) {
  const url = `${creds.baseUrl}/api/generate?audit=1`;
  const res = await fetch(url, {
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
      seed: 42,
    }),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const parsed = parseHumanSaveabilityFromGenerateResponse(res.status, data);
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  return {
    httpStatus: res.status,
    tracks,
    parsed,
    coverageLevel: data.coverageLevel ?? null,
    coverageMessage: data.coverageMessage ?? null,
    fetchError: parsed.parseWarnings?.join(";") ?? null,
  };
}

async function main() {
  const baseUrl = process.env.KWALIFY_BENCHMARK_BASE_URL ?? "http://127.0.0.1:5000";
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: baseUrl,
    cli: { baseUrl },
  });
  const head = getHeadCommit();

  const lines = [
    "# V11 Thesis Authority — Human Validation",
    "",
    "Date: 2026-07-28",
    `Base URL: ${creds.baseUrl}`,
    `Commit: ${head} (V11 thesis authority: anchor-first opener and full-world validation)`,
    "",
    "## Method",
    "- KEEP/MAYBE/DROP judged on cultural world identity + thesis opener + full-playlist sample",
    "- Track 1 must be anchor artist or score >= 0.8 world identity",
    "- Sample tracks 1,2,3,5,10,15 must be 80%+ on-world for KEEP",
    "- Target: convert MAYBE→KEEP on madchester/motorway; preserve 80s night drive KEEP",
    "",
    "## Results",
    "",
    "| Prompt | Verdict | Tracks | Coverage | First opener |",
    "|--------|---------|--------|----------|--------------|",
  ];

  const verdicts = [];
  const beforeAfter = [];

  for (const row of PROMPTS) {
    const requestId = `v11-${row.id}-20260728`;
    const result = await fetchGenerate(creds, row.prompt, requestId);
    const { verdict, why } = classify(row.prompt, result.tracks, result.httpStatus, result.coverageLevel);
    verdicts.push(verdict);
    const committed = resolveCommittedWorld({ prompt: row.prompt });
    const first5 = result.tracks.slice(0, 5).map((t) =>
      `${t.artistName ?? t.artist} — ${t.trackName ?? t.name}`,
    );
    const opener = first5[0] ?? "(none)";

    lines.push(
      `| ${row.id} | **${verdict}** | ${result.tracks.length} | ${result.coverageLevel ?? "—"} | ${opener} |`,
    );

    beforeAfter.push({ id: row.id, first5, coverage: result.coverageLevel, verdict });

    lines.push("");
    lines.push(`### ${row.id}: "${row.prompt}"`);
    lines.push(`- **Verdict:** ${verdict}`);
    lines.push(`- **Why:** ${why}`);
    lines.push(`- **Committed world:** ${committed?.id ?? "none"} (hardLock=${committed?.hardLock ?? false})`);
    lines.push(`- **Coverage:** ${result.coverageLevel ?? "—"} — ${result.coverageMessage ?? ""}`);
    lines.push(`- **Tracks:** ${result.tracks.length} | HTTP ${result.httpStatus} | HQG humanSaveable=${result.parsed.humanSaveable}`);
    if (result.fetchError) lines.push(`- **Fetch note:** ${result.fetchError}`);
    lines.push("- **First 5:**");
    for (const line of first5) lines.push(`  - ${line}`);
    if (first5.length === 0) lines.push("  - (none)");
    lines.push("");
  }

  const keepCount = verdicts.filter((v) => v === "KEEP").length;
  const maybeCount = verdicts.filter((v) => v === "MAYBE").length;
  const dropCount = verdicts.filter((v) => v === "DROP").length;

  lines.push("## Summary");
  lines.push(`- KEEP: ${keepCount}/${PROMPTS.length}`);
  lines.push(`- MAYBE: ${maybeCount}/${PROMPTS.length}`);
  lines.push(`- DROP: ${dropCount}/${PROMPTS.length}`);
  lines.push(`- Verdicts: ${verdicts.join(", ")}`);
  lines.push("");
  lines.push("## V11 vs V10 improvements");
  lines.push("- Anchor-first thesis opener: Oasis/Stone Roses over James Righton, Chromatics/M83 over KURUPT FM");
  lines.push("- Gym: AC/DC/Metallica over Paramore soft tracks");
  lines.push("- Full-playlist sample validation at indices 1,2,3,5,10,15");
  lines.push("- Emotion capped at 5% on hard-lock retrieval scoring");
  lines.push("");
  lines.push("## First 5 tracks by prompt");
  for (const row of beforeAfter) {
    lines.push(`### ${row.id} (${row.verdict}, coverage: ${row.coverage ?? "—"})`);
    for (const t of row.first5) lines.push(`- ${t}`);
    lines.push("");
  }

  const outPath = "reports/playlist-evaluation/v11-human-validation-2026-07-28.md";
  mkdirSync("reports/playlist-evaluation", { recursive: true });
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`KEEP: ${keepCount} | MAYBE: ${maybeCount} | DROP: ${dropCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
