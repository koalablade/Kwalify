/**
 * V10 live validation — 6 world-critical prompts, KEEP/MAYBE/DROP by cultural identity + coverage.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolveLiveBenchmarkCredentials } from "../dist/lib/benchmark-env.js";
import { parseHumanSaveabilityFromGenerateResponse } from "../dist/lib/human-saveability-benchmark-parse.js";
import { resolveCommittedWorld } from "../dist/core/committed-world.js";
import { scoreTrackWorldIdentity } from "../dist/core/editorial/world-identity-score.js";
import { resolveCulturalProfileForCommitted } from "../dist/core/editorial/world-identity-score.js";
import { artistForbiddenInWorld } from "../dist/core/editorial/artist-identity-map.js";

const PROMPTS = [
  { id: "dad_rock_bbq", prompt: "dad rock BBQ with beers" },
  { id: "motorway_rain", prompt: "empty motorway at midnight, rain on the windscreen" },
  { id: "80s_night_drive", prompt: "80s night drive" },
  { id: "madchester", prompt: "madchester pub walk" },
  { id: "gym", prompt: "heavy gym workout aggressive" },
  { id: "disco", prompt: "disco rooftop party 1978" },
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

  const opener1 = tracks[0];
  const opener1Score = profile && opener1
    ? scoreTrackWorldIdentity(
        { artistName: opener1.artistName ?? opener1.artist, trackName: opener1.trackName ?? opener1.name },
        profile,
      )
    : 0;
  const opener1Ok = opener1Score >= 0.8;

  const count = tracks.length;
  if (count === 0 || httpStatus === 422) return { verdict: "DROP", why: "empty or refused" };
  if (offWorldOpeners.length >= 2) return { verdict: "DROP", why: `${offWorldOpeners.length} off-world openers` };
  if (!opener1Ok && offWorldOpeners.length >= 1) return { verdict: "DROP", why: "weak track 1 + off-world opener" };
  if (opener1Ok && count >= 12 && offWorldOpeners.length === 0) return { verdict: "KEEP", why: "on-world opener, sufficient length" };
  if (opener1Ok && count >= 8 && offWorldOpeners.length === 0) return { verdict: "KEEP", why: "strong opener, coverage-assisted" };
  if (offWorldOpeners.length === 0 && count >= 3) {
    if (coverageLevel === "HIGH" || coverageLevel === "MEDIUM") {
      return { verdict: "MAYBE", why: `honest partial, coverage=${coverageLevel}` };
    }
    return { verdict: "MAYBE", why: `thin library partial, coverage=${coverageLevel ?? "unknown"}` };
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
    "# V10 World Coverage — Live Validation",
    "",
    "Date: 2026-07-28",
    `Base URL: ${creds.baseUrl}`,
    `Commit: ${head} (V10 world coverage: anchor expansion and honest coverage states)`,
    "",
    "## Method",
    "- KEEP/MAYBE/DROP judged on cultural world identity (not HQG pass rate)",
    "- Track 1 must score >= 0.8 world identity or be anchor artist",
    "- Coverage level reported in API response",
    "- Target: some KEEP (not just 6/6 MAYBE)",
    "",
    "## Results",
    "",
    "| Prompt | Verdict | Tracks | Coverage | First opener |",
    "|--------|---------|--------|----------|--------------|",
  ];

  const verdicts = [];
  const beforeAfter = [];

  for (const row of PROMPTS) {
    const requestId = `v10-${row.id}-20260728`;
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

    beforeAfter.push({ id: row.id, first5, coverage: result.coverageLevel });

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
  lines.push("## First 5 tracks by prompt");
  for (const row of beforeAfter) {
    lines.push(`### ${row.id} (coverage: ${row.coverage ?? "—"})`);
    for (const t of row.first5) lines.push(`- ${t}`);
    lines.push("");
  }

  const outPath = "reports/playlist-evaluation/v10-world-coverage-2026-07-28.md";
  mkdirSync("reports/playlist-evaluation", { recursive: true });
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`KEEP: ${keepCount} | MAYBE: ${maybeCount} | DROP: ${dropCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
