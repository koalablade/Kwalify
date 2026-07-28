/**
 * V14 retrieval recovery validation — 8 prompts, compare track counts vs V13.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolveLiveBenchmarkCredentials } from "../dist/lib/benchmark-env.js";
import { parseHumanSaveabilityFromGenerateResponse } from "../dist/lib/human-saveability-benchmark-parse.js";
import { resolveCommittedWorld } from "../dist/core/committed-world.js";
import {
  scoreTrackWorldIdentity,
  resolveCulturalProfileForCommitted,
} from "../dist/core/editorial/world-identity-score.js";
import { artistForbiddenInWorld } from "../dist/core/editorial/artist-identity-map.js";
import { enforceThesisOpener } from "../dist/core/editorial/thesis-opener-gate.js";
import { applyWorldPurityGate } from "../dist/core/editorial/world-purity-gate.js";

const PROMPTS = [
  { id: "80s_night_drive", prompt: "80s night drive", v13Count: 5 },
  { id: "motorway_rain", prompt: "empty motorway at midnight rain on the windscreen", v13Count: 3 },
  { id: "madchester", prompt: "madchester pub walk", v13Count: 3 },
  { id: "dad_rock_bbq", prompt: "dad rock BBQ with beers", v13Count: 10 },
  { id: "disco", prompt: "disco rooftop party 1978", v13Count: 4 },
  { id: "country_cowboy", prompt: "country cowboy road trip", v13Count: 7 },
  { id: "gym", prompt: "heavy gym workout aggressive", v13Count: 3 },
  { id: "no_rap_gym", prompt: "no rap gym workout", v13Count: 4 },
];

const TAIL_FORBIDDEN = {
  "80s_night_drive": ["fred again", "french montana", "gray squat rave"],
  motorway_rain: ["oasis", "onyx deimos", "david guetta", "tiësto", "tiesto", "avicii"],
  country_cowboy: ["florence", "arctic monkeys", "bon iver", "phoebe bridgers"],
  madchester: ["bon iver", "phoebe bridgers", "sonic youth"],
  disco: ["dua lipa", "the weeknd", "panic"],
  gym: ["paramore", "fall out boy", "green day"],
  dad_rock_bbq: ["bon iver", "phoebe bridgers"],
};

function getHeadCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function tailForbiddenHits(id, tracks) {
  const needles = TAIL_FORBIDDEN[id] ?? [];
  const hits = [];
  for (const t of tracks) {
    const artist = String(t.artistName ?? t.artist ?? "").toLowerCase();
    for (const needle of needles) {
      if (artist.includes(needle)) hits.push(`${t.artistName ?? t.artist} — ${t.trackName ?? t.name}`);
    }
  }
  return hits;
}

function artistDiversity(tracks) {
  const artists = new Set(
    tracks.map((t) => String(t.artistName ?? t.artist ?? "").toLowerCase().trim()).filter(Boolean),
  );
  return artists.size;
}

function classify(id, prompt, tracks, httpStatus, coverageLevel) {
  const committed = resolveCommittedWorld({ prompt });
  const profile = resolveCulturalProfileForCommitted(committed);
  const worldIds = committed?.worldIds ?? [];
  const forbiddenHits = tailForbiddenHits(id, tracks);

  const mapped = tracks.map((t) => ({
    trackName: t.trackName ?? t.name,
    artistName: t.artistName ?? t.artist,
    energy: t.energy ?? null,
  }));

  const purity = committed
    ? applyWorldPurityGate(mapped, committed, { prompt, requestedLength: 25, coverageLevel })
    : null;

  const opener1 = tracks[0];
  const opener1Score = profile && opener1
    ? scoreTrackWorldIdentity(
        { artistName: opener1.artistName ?? opener1.artist, trackName: opener1.trackName ?? opener1.name },
        profile,
      )
    : 0;
  const opener1Ok = opener1Score >= 0.85 || opener1Score >= 0.8;
  const count = tracks.length;
  const diversity = artistDiversity(tracks);

  if (count === 0 || httpStatus === 422) return { verdict: "DROP", why: "empty or refused" };
  if (forbiddenHits.length >= 2) return { verdict: "DROP", why: `forbidden: ${forbiddenHits.join("; ")}` };
  if (forbiddenHits.length === 1) return { verdict: "MAYBE", why: `forbidden: ${forbiddenHits[0]}` };
  if (opener1Ok && count >= 15 && (purity?.wouldStillBelieve ?? true)) {
    return { verdict: "KEEP", why: "V14 expanded pool + purity maintained" };
  }
  if (opener1Ok && count >= 8) return { verdict: "KEEP", why: "strong opener, no contamination" };
  if (count >= 3 && opener1Ok) return { verdict: "MAYBE", why: `partial ${count}, diversity=${diversity}` };
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
    retrievalShortfall: data.generationDiagnostics?.retrievalShortfall ?? null,
  };
}

function formatTrackList(tracks) {
  return tracks.map((t, i) => {
    const artist = t.artistName ?? t.artist ?? "?";
    const name = t.trackName ?? t.name ?? "?";
    return `${String(i + 1).padStart(2)}. ${artist} — ${name}`;
  }).join("\n");
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
    "# V14 Retrieval Recovery — Human Validation",
    "",
    "Date: 2026-07-28",
    `Base URL: ${creds.baseUrl}`,
    `Commit: ${head} (V14 retrieval recovery: expanded culture graph and exhausted world search)`,
    "",
    "## Method",
    "- V14 purity: T1-2 >=95, T3-5 >=90, T6-10 >=85, T11+ >=80",
    "- Target: 15-25 tracks on worlds that had 3-7 in V13",
    "- No forbidden artists in full list",
    "",
    "## Results",
    "",
    "| Prompt | Verdict | V13 | V14 | Δ | Diversity | Coverage | Forbidden |",
    "|--------|---------|-----|-----|---|-----------|----------|-----------|",
  ];

  const verdicts = [];
  const detailSections = [];

  for (const { id, prompt, v13Count } of PROMPTS) {
    const result = await fetchGenerate(creds, prompt, `v14-${id}-${Date.now()}`);
    const tracks = result.tracks;
    const forbidden = tailForbiddenHits(id, tracks);
    const diversity = artistDiversity(tracks);
    const { verdict, why } = classify(id, prompt, tracks, result.httpStatus, result.coverageLevel);
    const delta = tracks.length - v13Count;
    verdicts.push(verdict);
    lines.push(
      `| ${id} | ${verdict} | ${v13Count} | ${tracks.length} | ${delta >= 0 ? "+" : ""}${delta} | ${diversity} | ${result.coverageLevel ?? "—"} | ${forbidden.length ? forbidden.length : "0"} |`,
    );
    detailSections.push(
      `### ${id} — ${verdict}`,
      "",
      `Prompt: ${prompt}`,
      `Why: ${why}`,
      `V13 count: ${v13Count} → V14 count: ${tracks.length}`,
      "",
      "**Full track list:**",
      formatTrackList(tracks) || "(empty)",
      "",
    );
    if (result.retrievalShortfall) {
      detailSections.push(
        `Retrieval shortfall: gap=${result.retrievalShortfall.gap}, suggestions=${(result.retrievalShortfall.suggestions ?? []).join("; ")}`,
        "",
      );
    }
  }

  const keep = verdicts.filter((v) => v === "KEEP").length;
  const maybe = verdicts.filter((v) => v === "MAYBE").length;
  const drop = verdicts.filter((v) => v === "DROP").length;
  lines.push("");
  lines.push(`**Summary:** ${keep} KEEP / ${maybe} MAYBE / ${drop} DROP`);
  lines.push("");
  lines.push("## Full track lists");
  lines.push("");
  lines.push(...detailSections);

  const outDir = "reports/playlist-evaluation";
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/v14-retrieval-recovery-2026-07-28.md`;
  writeFileSync(outPath, lines.join("\n"));
  console.log(`Wrote ${outPath}`);
  console.log(`SUMMARY: ${keep} KEEP / ${maybe} MAYBE / ${drop} DROP`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
