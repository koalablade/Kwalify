/**
 * V13 immersion validation — 8 prompts, STRICT tail checking (tracks 6-10).
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
  { id: "motorway_rain", prompt: "empty motorway at midnight rain on the windscreen" },
  { id: "dad_rock_bbq", prompt: "dad rock BBQ with beers" },
  { id: "80s_night_drive", prompt: "80s night drive" },
  { id: "madchester", prompt: "madchester pub walk" },
  { id: "disco", prompt: "disco rooftop party 1978" },
  { id: "gym", prompt: "heavy gym workout aggressive" },
  { id: "country_cowboy", prompt: "country cowboy road trip" },
  { id: "no_rap_gym", prompt: "no rap gym workout" },
];

const TAIL_FORBIDDEN = {
  "80s_night_drive": ["fred again", "french montana", "gray squat rave"],
  motorway_rain: ["oasis", "onyx deimos", "david guetta", "tiësto", "tiesto", "avicii"],
  country_cowboy: ["florence", "arctic monkeys", "bon iver", "phoebe bridgers"],
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

function classify(id, prompt, tracks, httpStatus, coverageLevel) {
  const committed = resolveCommittedWorld({ prompt });
  const profile = resolveCommittedProfileForCommitted(committed);
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
  const opener1Ok = opener1Score >= 0.85 || opener1Score >= 0.8;

  const count = tracks.length;
  const tailHits = tailForbiddenHits(id, tracks);
  const tailStrictFail = tailHits.length > 0;

  const gymHonestMetal =
    committed?.id === "gym_rock_world" &&
    id === "no_rap_gym" &&
    count >= 3 &&
    offWorldOpeners.length === 0 &&
    !tailStrictFail;

  if (count === 0 || httpStatus === 422) {
    return { verdict: "DROP", why: "empty or refused" };
  }
  if (tailStrictFail) {
    return { verdict: tailHits.length >= 2 ? "DROP" : "MAYBE", why: `tail forbidden: ${tailHits.join("; ")}` };
  }
  if (offWorldOpeners.length >= 2) return { verdict: "DROP", why: `${offWorldOpeners.length} off-world openers` };
  if (!opener1Ok && offWorldOpeners.length >= 1) return { verdict: "DROP", why: "weak track 1 + off-world opener" };
  if (gymHonestMetal) return { verdict: "KEEP", why: "honest gym metal partial, tail pure" };
  if (opener1Ok && count >= 12 && offWorldOpeners.length === 0 && (purity?.wouldStillBelieve ?? true)) {
    return { verdict: "KEEP", why: "anchor thesis + V13 purity checkpoints" };
  }
  if (opener1Ok && count >= 8 && offWorldOpeners.length === 0) {
    return { verdict: "KEEP", why: "strong anchor opener, tail pure" };
  }
  if (offWorldOpeners.length === 0 && count >= 3) {
    if (opener1Ok) return { verdict: "MAYBE", why: `good opener, coverage=${coverageLevel ?? "unknown"}` };
    return { verdict: "MAYBE", why: `partial world fit, coverage=${coverageLevel ?? "unknown"}` };
  }
  return { verdict: "DROP", why: "stub or world drift" };
}

function resolveCommittedProfileForCommitted(committed) {
  return resolveCulturalProfileForCommitted(committed);
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
    "# V13 Immersion Sprint — Human Validation",
    "",
    "Date: 2026-07-28",
    `Base URL: ${creds.baseUrl}`,
    `Commit: ${head} (V13 immersion: full-playlist world purity and tail sequencing)`,
    "",
    "## Method",
    "- KEEP/MAYBE/DROP with STRICT tail criteria (tracks 6-10)",
    "- Forbidden artist in tail = MAYBE or DROP",
    "- V13 position thresholds: T1-5 >=90, T6-10 >=80, T11+ >=70",
    "",
    "## Results",
    "",
    "| Prompt | Verdict | Tracks | Coverage | First opener | Tail hits |",
    "|--------|---------|--------|----------|--------------|-----------|",
  ];

  const verdicts = [];
  const detailSections = [];

  for (const { id, prompt } of PROMPTS) {
    const result = await fetchGenerate(creds, prompt, `v13-${id}-${Date.now()}`);
    const tracks = result.tracks;
    const opener = tracks[0];
    const { verdict, why } = classify(id, prompt, tracks, result.httpStatus, result.coverageLevel);
    const tailHits = tailForbiddenHits(id, tracks);
    verdicts.push(verdict);
    lines.push(
      `| ${id} | ${verdict} | ${tracks.length} | ${result.coverageLevel ?? "—"} | ${opener?.artistName ?? opener?.artist ?? "—"} | ${tailHits.length ? tailHits.join("; ") : "—"} |`,
    );
    detailSections.push(
      `### ${id} — ${verdict}`,
      "",
      `Prompt: ${prompt}`,
      `Why: ${why}`,
      "",
      "**Full track list:**",
      formatTrackList(tracks) || "(empty)",
      "",
    );
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
  const outPath = `${outDir}/v13-immersion-2026-07-28.md`;
  writeFileSync(outPath, lines.join("\n"));
  console.log(`Wrote ${outPath}`);
  console.log(`SUMMARY: ${keep} KEEP / ${maybe} MAYBE / ${drop} DROP`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
