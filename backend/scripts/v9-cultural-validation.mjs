/**
 * V9 live validation — 6 world-critical prompts, KEEP/MAYBE/DROP by cultural identity (not HQG).
 */
import { writeFileSync, mkdirSync } from "node:fs";
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

function classify(prompt, tracks, httpStatus) {
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

  const count = tracks.length;
  if (count === 0 || httpStatus === 422) return { verdict: "DROP", why: "empty or refused" };
  if (offWorldOpeners.length >= 2) return { verdict: "DROP", why: `${offWorldOpeners.length} off-world openers` };
  if (offWorldOpeners.length === 1 && count < 12) return { verdict: "MAYBE", why: "one weak opener" };
  if (offWorldOpeners.length === 0 && count >= 12) return { verdict: "KEEP", why: "on-world openers, sufficient length" };
  if (offWorldOpeners.length === 0 && count >= 3) return { verdict: "MAYBE", why: "honest partial but on-world" };
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
  return { httpStatus: res.status, tracks, parsed, fetchError: parsed.parseWarnings?.join(";") ?? null };
}

async function main() {
  const baseUrl = process.env.KWALIFY_BENCHMARK_BASE_URL ?? "http://127.0.0.1:5000";
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: baseUrl,
    cli: { baseUrl },
  });

  const lines = [
    "# V9 Cultural Identity — Live Validation",
    "",
    "Date: 2026-07-28",
    `Base URL: ${creds.baseUrl}`,
    "Commit: V9 cultural identity: world scoring and thesis opener",
    "",
    "## Method",
    "- KEEP/MAYBE/DROP judged on cultural world identity (not HQG pass rate)",
    "- Track 1 must score >= 0.8 world identity or be anchor artist",
    "- Forbidden artists in openers = DROP",
    "",
    "## Results",
    "",
    "| Prompt | Verdict | Tracks | First opener |",
    "|--------|---------|--------|--------------|",
  ];

  const verdicts = [];

  for (const row of PROMPTS) {
    const requestId = `v9-${row.id}-20260728`;
    const result = await fetchGenerate(creds, row.prompt, requestId);
    const { verdict, why } = classify(row.prompt, result.tracks, result.httpStatus);
    verdicts.push(verdict);
    const committed = resolveCommittedWorld({ prompt: row.prompt });
    const first5 = result.tracks.slice(0, 5).map((t) =>
      `${t.artistName ?? t.artist} — ${t.trackName ?? t.name}`,
    );
    const opener = first5[0] ?? "(none)";

    lines.push(`| ${row.id} | **${verdict}** | ${result.tracks.length} | ${opener} |`);

    lines.push("");
    lines.push(`### ${row.id}: "${row.prompt}"`);
    lines.push(`- **Verdict:** ${verdict}`);
    lines.push(`- **Why:** ${why}`);
    lines.push(`- **Committed world:** ${committed?.id ?? "none"} (hardLock=${committed?.hardLock ?? false})`);
    lines.push(`- **Tracks:** ${result.tracks.length} | HTTP ${result.httpStatus} | HQG humanSaveable=${result.parsed.humanSaveable}`);
    if (result.fetchError) lines.push(`- **Fetch note:** ${result.fetchError}`);
    lines.push("- **First 5:**");
    for (const line of first5) lines.push(`  - ${line}`);
    if (first5.length === 0) lines.push("  - (none)");
    lines.push("");
  }

  const keepMaybe = verdicts.filter((v) => v === "KEEP" || v === "MAYBE").length;
  lines.push("## Summary");
  lines.push(`- KEEP/MAYBE: ${keepMaybe}/${PROMPTS.length} (target: 4/6 minimum)`);
  lines.push(`- Verdicts: ${verdicts.join(", ")}`);

  const outPath = "reports/playlist-evaluation/v9-cultural-identity-2026-07-28.md";
  mkdirSync("reports/playlist-evaluation", { recursive: true });
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`KEEP/MAYBE: ${keepMaybe}/${PROMPTS.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
