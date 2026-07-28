/**
 * V6.1 golden human validation — 5 prompts against live API.
 * Usage: node scripts/v6-golden-ear-validation.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { resolveVerifiedProductionCredentials } = require("../backend/dist/lib/benchmark-env");

const PROMPTS = [
  {
    id: "A",
    prompt: "empty motorway at midnight, rain on the windscreen",
    world: "late-night cinematic driving",
    forbidden: /\b(bon iver|clairo|noah kahan|dayglow|travis scott|dmx|fugees)\b/i,
    prefer: /\b(synth|electronic|post.?rock|dream|ambient|cinematic|drive|war on drugs|massive attack|depeche|tame impala|radiohead)\b/i,
  },
  {
    id: "B",
    prompt: "dad rock BBQ with beers",
    world: "classic rock gathering",
    forbidden: /\b(bon iver|clairo|phoebe bridgers|sufjan|gregory alan|noah kahan|iron\s*&\s*wine)\b/i,
    prefer: /\b(queen|fleetwood|eagles|petty|boston|ac\/dc|zz top|lynyrd|def leppard|journey|billy joel|bruce)\b/i,
  },
  {
    id: "C",
    prompt: "yacht rock sunset by the pool",
    world: "70s/80s smooth rock",
    forbidden: /\b(bon iver|clairo|lo-?fi|bedroom|phoebe bridgers)\b/i,
    prefer: /\b(toto|steely dan|hall\s*&\s*oates|christopher cross|michael mcdonald|doobie|yacht|soft rock|fleetwood)\b/i,
  },
  {
    id: "D",
    prompt: "heavy gym workout, aggressive",
    world: "high energy training",
    forbidden: /\b(bon iver|acoustic|iron\s*&\s*wine|sufjan|gregory alan|phoebe bridgers|folk)\b/i,
    prefer: /\b(metal|hard rock|rap|electronic|dmx|eminem|metallica|rage|pump|aggressive|high energy)\b/i,
  },
  {
    id: "E",
    prompt: "disco rooftop party 1978",
    world: "classic disco",
    forbidden: /\b(bon iver|indie folk|acoustic|lo-?fi)\b/i,
    prefer: /\b(disco|funk|soul|bee gees|chic|donna summer|earth wind|kool|village people|gloria gaynor)\b/i,
  },
];

const LANDFILL = /\b(bon iver|clairo|noah kahan|dayglow|gregory alan isakov|badbadnotgood|phoebe bridgers)\b/i;

function trackLine(t) {
  const artist = t.artistName ?? t.artist ?? t.artist_name ?? "?";
  const name = t.trackName ?? t.name ?? t.title ?? "?";
  return `${artist} — ${name}`;
}

function scorePlaylist(tracks, spec) {
  const lines = tracks.map(trackLine);
  const first3 = lines.slice(0, 3);
  const first10 = lines.slice(0, 10);

  const hitsForbidden = (list) =>
    list.filter((line) => spec.forbidden.test(line) || LANDFILL.test(line));

  const worldHits = (list) =>
    list.filter((line) => spec.prefer.test(line.toLowerCase()));

  const f3bad = hitsForbidden(first3);
  const f10bad = hitsForbidden(first10);
  const f3good = worldHits(first3);
  const f10good = worldHits(first10);

  const first3World = tracks.length > 0 && f3bad.length === 0 && (f3good.length >= 1 || tracks.length <= 3);
  const first10World = tracks.length >= 3 && f10bad.length <= 1 && f10good.length >= Math.min(3, first10.length);

  let save = "MAYBE";
  if (f10bad.length >= 3 || tracks.length < 6) save = "NO";
  else if (f10bad.length === 0 && f10good.length >= 4 && tracks.length >= 10) save = "YES";
  else if (f10bad.length <= 1 && f10good.length >= 2) save = "MAYBE";

  let failureClass = null;
  if (!first3World) failureClass = "WRONG_WORLD";
  else if (!first10World && first3World) failureClass = "GOOD_START_COLLAPSES_LATER";
  else if (f10bad.length > 0 && f10good.length >= 2) failureClass = "RIGHT_WORLD_BAD_SONGS";
  else if (tracks.length < 10 && tracks.length >= 6) failureClass = "TOO_SHORT";

  return {
    trackCount: tracks.length,
    first3: first3.map(trackLine),
    first10: first10.map(trackLine),
    forbiddenInFirst3: f3bad,
    forbiddenInFirst10: f10bad,
    worldHitsFirst10: f10good.length,
    first3World: first3World ? "YES" : "NO",
    first10World: first10World ? "YES" : "NO",
    wouldSave: save,
    failureClass,
  };
}

async function main() {
  const creds = await resolveVerifiedProductionCredentials();
  const baseUrl = creds.baseUrl.replace(/\/$/, "");
  const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

  const ready = await (await fetch(`${baseUrl}/api/readyz`)).json();
  if (ready.commit && !String(ready.commit).startsWith(commit.slice(0, 7))) {
    console.warn(`Warning: readyz commit ${ready.commit} != local ${commit}`);
  }

  const outDir = path.join("reports", "playlist-evaluation", "v6-golden-ear", new Date().toISOString().slice(0, 10));
  await mkdir(outDir, { recursive: true });

  const results = [];
  for (const spec of PROMPTS) {
    const started = Date.now();
    process.stdout.write(`[${spec.id}] generating: ${spec.prompt.slice(0, 50)}... `);
    const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: spec.prompt,
        length: 25,
        mode: "balanced",
        seed: 42,
        spotifyUserId: creds.spotifyUserId,
        auditMode: true,
        allowDbWrites: false,
        allowSpotifyCreate: false,
        evaluationPromptId: `v6-golden-${spec.id}`,
        evaluationCategory: "v6_golden_ear",
        evaluationTimeoutMs: 240_000,
      }),
    });
    const data = await res.json();
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    const score = scorePlaylist(tracks, spec);
    const row = {
      id: spec.id,
      prompt: spec.prompt,
      expectedWorld: spec.world,
      httpStatus: res.status,
      ms: Date.now() - started,
      error: !res.ok || tracks.length === 0
        ? (data.message ?? data.error ?? data.userMessage ?? `HTTP ${res.status}`)
        : null,
      editorialWorldTag: data.intentCollapseLayer?.editorialWorldTag ?? data.playlistExecutionTrace?.intentCollapseLayer?.editorialWorldTag ?? null,
      humanSaveable: data.humanSaveabilityGate?.humanSaveable ?? data.playlistExecutionTrace?.humanSaveable ?? null,
      humanQualityGate: data.humanQualityGate?.action ?? data.playlistExecutionTrace?.humanQualityGate?.action ?? null,
      trackCount: tracks.length,
      ...score,
    };
    results.push(row);
    if (!res.ok || tracks.length === 0) {
      console.log(`FAIL (${res.status}: ${row.error})`);
    } else {
      console.log(`${score.wouldSave} (${tracks.length} tracks, ${row.ms}ms)`);
    }
    if (spec.id !== "E") await new Promise((r) => setTimeout(r, 2000));
  }

  const believable = results.filter((r) => r.wouldSave === "YES" || (r.wouldSave === "MAYBE" && r.first3World === "YES")).length;
  const summary = {
    commit,
    readyzCommit: ready.commit ?? null,
    baseUrl,
    at: new Date().toISOString(),
    believableCount: believable,
    passThreshold: "4/5",
    betaReady: believable >= 4,
    results,
  };

  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  const md = [
    "# V6.1 Golden Ear Validation",
    "",
    `Commit: \`${commit}\``,
    `API: ${baseUrl}`,
    `Believable: **${believable}/5** (YES or strong MAYBE with first-3 world)`,
    `Beta ready: **${believable >= 4 ? "YES" : "NO"}**`,
    "",
    ...results.flatMap((r) => [
      `## Test ${r.id}: ${r.prompt}`,
      "",
      `- Expected: ${r.expectedWorld}`,
      `- Tracks: ${r.trackCount} | HQG: ${r.humanQualityGate} | Editorial: ${r.editorialWorldTag}`,
      `- First 3 world: **${r.first3World}** | Tracks 1-10 world: **${r.first10World}** | Would save: **${r.wouldSave}**`,
      r.failureClass ? `- Failure class: ${r.failureClass}` : "",
      "",
      "**First 3:**",
      ...r.first3.map((t) => `- ${t}`),
      "",
      "**Forbidden in first 10:**",
      ...(r.forbiddenInFirst10.length ? r.forbiddenInFirst10.map((t) => `- ${t}`) : ["- (none)"]),
      "",
    ]),
  ].join("\n");
  await writeFile(path.join(outDir, "SUMMARY.md"), md);
  console.log("\n" + md);
  console.log(`\nWrote ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
