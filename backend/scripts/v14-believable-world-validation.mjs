/**
 * V14 believable world validation — 8 prompts, strict purity + expanded retrieval.
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
import {
  applyWorldPurityGate,
  worldPurityThresholdForPosition,
  scoreTrackPurityPercent,
} from "../dist/core/editorial/world-purity-gate.js";

const PROMPTS = [
  { id: "motorway_rain", prompt: "empty motorway at midnight rain on the windscreen", v13Count: 3 },
  { id: "dad_rock_bbq", prompt: "dad rock BBQ with beers", v13Count: 10 },
  { id: "80s_night_drive", prompt: "80s night drive", v13Count: 5 },
  { id: "madchester", prompt: "madchester pub walk", v13Count: 3 },
  { id: "disco", prompt: "disco rooftop party 1978", v13Count: 4 },
  { id: "gym", prompt: "heavy gym workout aggressive", v13Count: 3 },
  { id: "country_cowboy", prompt: "country cowboy road trip", v13Count: 7 },
  { id: "no_rap_gym", prompt: "no rap gym workout", v13Count: 4 },
];

const TAIL_FORBIDDEN = {
  "80s_night_drive": ["fred again", "french montana", "gray squat rave"],
  motorway_rain: ["oasis", "onyx deimos", "david guetta", "tiësto", "tiesto", "avicii"],
  country_cowboy: ["florence", "arctic monkeys", "bon iver", "phoebe bridgers"],
  madchester: ["bon iver", "phoebe bridgers", "destructo disk"],
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
  const tail = tracks.slice(5, 10);
  const hits = [];
  for (const t of tail) {
    const artist = String(t.artistName ?? t.artist ?? "").toLowerCase();
    for (const needle of needles) {
      if (artist.includes(needle)) hits.push(`${t.artistName ?? t.artist} — ${t.trackName ?? t.name}`);
    }
  }
  return hits;
}

function purityFailures(tracks, profile) {
  const failures = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const score = scoreTrackPurityPercent(
      { artistName: t.artistName ?? t.artist, trackName: t.trackName ?? t.name, energy: t.energy },
      profile,
    );
    const threshold = worldPurityThresholdForPosition(i);
    if (score < threshold) {
      failures.push(`T${i + 1}:${t.artistName ?? t.artist}:${score}<${threshold}`);
    }
  }
  return failures;
}

function classify(id, prompt, tracks, httpStatus, coverageLevel) {
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
  const purity = committed
    ? applyWorldPurityGate(mapped, committed, { prompt, requestedLength: 25, coverageLevel })
    : null;

  const opener1 = thesis?.tracks[0] ?? tracks[0];
  const opener1Score = profile && opener1
    ? scoreTrackWorldIdentity(
        { artistName: opener1.artistName ?? opener1.artist, trackName: opener1.trackName ?? opener1.name },
        profile,
      )
    : 0;
  const opener1Ok = opener1Score >= 0.85;

  const count = tracks.length;
  const tailHits = tailForbiddenHits(id, tracks);
  const tailStrictFail = tailHits.length > 0;
  const purityFails = profile ? purityFailures(tracks, profile) : [];

  if (count === 0 || httpStatus === 422) {
    return { verdict: "DROP", why: "empty or refused" };
  }
  if (tailStrictFail) {
    return { verdict: tailHits.length >= 2 ? "DROP" : "MAYBE", why: `tail forbidden: ${tailHits.join("; ")}` };
  }
  if (offWorldOpeners.length >= 2) return { verdict: "DROP", why: `${offWorldOpeners.length} off-world openers` };
  if (!opener1Ok && offWorldOpeners.length >= 1) return { verdict: "DROP", why: "weak track 1 + off-world opener" };
  if (purityFails.length > 0 && count < 15) {
    return { verdict: "MAYBE", why: `purity gaps: ${purityFails.slice(0, 3).join("; ")}` };
  }
  if (opener1Ok && count >= 15 && offWorldOpeners.length === 0 && (purity?.wouldStillBelieve ?? true)) {
    return { verdict: "KEEP", why: "V14 believable world: 15+ pure tracks, thesis + checkpoints" };
  }
  if (opener1Ok && count >= 12 && offWorldOpeners.length === 0 && purityFails.length === 0) {
    return { verdict: "KEEP", why: "strong anchor opener, full purity pass" };
  }
  if (offWorldOpeners.length === 0 && count >= 8) {
    return { verdict: "MAYBE", why: `good world fit, count=${count}, coverage=${coverageLevel ?? "unknown"}` };
  }
  if (offWorldOpeners.length === 0 && count >= 3) {
    return { verdict: "MAYBE", why: `partial honest, count=${count}` };
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
    "# V14 Believable World — Human Validation",
    "",
    "Date: 2026-07-28",
    `Base URL: ${creds.baseUrl}`,
    `Commit: ${head} (V14 one believable world: exhausted retrieval and strict purity)`,
    "",
    "## Method",
    "- V14 purity: T1-2 >=95, T3-5 >=90, T6-10 >=85, T11+ >=80",
    "- Exhausted retrieval: anchors → deep cuts → neighbours",
    "- Target: 15-25 pure tracks, KEEP not just MAYBE",
    "- CommittedWorld immutable across pipeline stages",
    "",
    "## Results",
    "",
    "| Prompt | Verdict | V13 | V14 | Δ | Coverage | First opener | Tail hits |",
    "|--------|---------|-----|-----|---|----------|--------------|-----------|",
  ];

  const verdicts = [];
  const detailSections = [];

  for (const { id, prompt, v13Count } of PROMPTS) {
    const result = await fetchGenerate(creds, prompt, `v14-bw-${id}-${Date.now()}`);
    const tracks = result.tracks;
    const opener = tracks[0];
    const { verdict, why } = classify(id, prompt, tracks, result.httpStatus, result.coverageLevel);
    const tailHits = tailForbiddenHits(id, tracks);
    const delta = tracks.length - v13Count;
    verdicts.push(verdict);
    lines.push(
      `| ${id} | ${verdict} | ${v13Count} | ${tracks.length} | ${delta >= 0 ? "+" : ""}${delta} | ${result.coverageLevel ?? "—"} | ${opener?.artistName ?? opener?.artist ?? "—"} | ${tailHits.length ? tailHits.join("; ") : "—"} |`,
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
  const outPath = `${outDir}/v14-believable-world-2026-07-28.md`;
  writeFileSync(outPath, lines.join("\n"));
  console.log(`Wrote ${outPath}`);
  console.log(`SUMMARY: ${keep} KEEP / ${maybe} MAYBE / ${drop} DROP`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
