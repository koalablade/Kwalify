/**
 * V8 live validation — 6 world-critical prompts, KEEP/MAYBE/DROP by world fit (not HQG).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolveLiveBenchmarkCredentials } from "../dist/lib/benchmark-env.js";
import { parseHumanSaveabilityFromGenerateResponse } from "../dist/lib/human-saveability-benchmark-parse.js";
import { resolveCommittedWorld, committedWorldArtistForbidden } from "../dist/core/committed-world.js";
import { artistForbiddenInWorld } from "../dist/core/editorial/artist-identity-map.js";
import { OPENER_FILLER_PATTERN } from "../dist/core/editorial/opener-hygiene.js";

const PROMPTS = [
  { id: "dad_rock", prompt: "dad rock" },
  { id: "motorway_rain", prompt: "empty motorway at midnight rain on the windscreen" },
  { id: "gym", prompt: "heavy gym workout rock" },
  { id: "grunge", prompt: "90s grunge" },
  { id: "madchester", prompt: "madchester" },
  { id: "disco", prompt: "70s disco rooftop party" },
];

function classify(prompt, tracks, httpStatus) {
  const committed = resolveCommittedWorld({ prompt });
  const worldIds = committed?.worldIds ?? [];
  const top5 = tracks.slice(0, 5);
  const landfillOpeners = top5.filter((t) => {
    const artist = String(t.artistName ?? t.artist ?? "");
    return (
      OPENER_FILLER_PATTERN.test(artist) ||
      artistForbiddenInWorld(artist, worldIds) ||
      (committed && committedWorldArtistForbidden(committed, artist, t.trackName))
    );
  });
  const count = tracks.length;
  if (count === 0 || httpStatus === 422) return { verdict: "DROP", why: "empty or refused" };
  if (landfillOpeners.length >= 2) return { verdict: "DROP", why: `${landfillOpeners.length} off-world openers` };
  if (landfillOpeners.length === 1 && count < 12) return { verdict: "MAYBE", why: "one weak opener" };
  if (landfillOpeners.length === 0 && count >= 12) return { verdict: "KEEP", why: "on-world openers, sufficient length" };
  if (landfillOpeners.length === 0 && count >= 6) return { verdict: "MAYBE", why: "honest partial but on-world" };
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
    "# V8 Human Save Recovery — Live Validation",
    "",
    "Date: 2026-07-28",
    `Base URL: ${creds.baseUrl}`,
    "Commit: V8 human save rate: world contract enforcement",
    "",
    "## Method",
    "- KEEP/MAYBE/DROP judged on musical world fit (not HQG pass rate)",
    "- Landfill openers in slots 1–5: Bon Iver, Phoebe, Clairo, Noah Kahan, Sufjan, Beach House, etc.",
    "",
    "## Results",
    "",
  ];

  for (const row of PROMPTS) {
    const requestId = `v8-${row.id}-20260728`;
    const result = await fetchGenerate(creds, row.prompt, requestId);
    const { verdict, why } = classify(row.prompt, result.tracks, result.httpStatus);
    const committed = resolveCommittedWorld({ prompt: row.prompt });
    const first5 = result.tracks.slice(0, 5).map((t) =>
      `${t.artistName ?? t.artist} — ${t.trackName ?? t.name}`,
    );

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

  const outPath = "../reports/playlist-evaluation/v8-save-recovery-2026-07-28.md";
  mkdirSync("../reports/playlist-evaluation", { recursive: true });
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
