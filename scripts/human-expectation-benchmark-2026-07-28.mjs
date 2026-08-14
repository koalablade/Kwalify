/**
 * Human-expectation benchmark — 100+ diverse prompts vs real-user KEEP/MAYBE/DROP.
 *
 * Step 1: node scripts/collect-human-benchmark-prompts-2026-07-28.mjs
 * Step 2: node scripts/human-expectation-benchmark-2026-07-28.mjs [--resume] [--concurrency 4]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { resolveVerifiedProductionCredentials } = require("../backend/dist/lib/benchmark-env");
const { evaluateWouldISave } = require("../backend/dist/core/editorial/would-i-save-evaluator");

const BENCH_DIR = path.resolve("reports/playlist-evaluation/human-benchmark-2026-07-28");
const PROMPTS_PATH = path.join(BENCH_DIR, "prompts.json");
const RAW_PATH = path.join(BENCH_DIR, "raw-results.json");
const REPORT_PATH = path.resolve("reports/playlist-evaluation/human-benchmark-2026-07-28.md");

const LANDFILL =
  /\b(bon iver|clairo|noah kahan|dayglow|gregory alan isakov|badbadnotgood|phoebe bridgers|sufjan|mitski)\b/i;

function trackLine(t) {
  if (typeof t === "string") return t;
  const artist = t.artistName ?? t.artist ?? t.artist_name ?? "?";
  const name = t.trackName ?? t.name ?? t.title ?? "?";
  return `${artist} — ${name}`;
}

function lockedIntentStub() {
  return {
    genreFamilies: [],
    primaryGenre: null,
    primarySubgenre: null,
    secondarySubgenre: null,
    subgenreTerms: [],
    eraRange: null,
    mood: [],
    activity: null,
    energy: null,
  };
}

function toRegex(pattern) {
  if (!pattern) return null;
  if (pattern instanceof RegExp) return pattern;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function scoreHumanExpectation(tracks, spec, meta) {
  const lines = tracks.map(trackLine);
  const first3 = lines.slice(0, 3);
  const first10 = lines.slice(0, 10);
  const tail = lines.slice(3, 10);

  const forbidden = toRegex(spec.forbidden) ?? /$^/;
  const prefer = toRegex(spec.prefer) ?? /./;

  const hitsForbidden = (list) =>
    list.filter((line) => forbidden.test(line) || LANDFILL.test(line));

  const worldHits = (list) =>
    list.filter((line) => prefer.test(line.toLowerCase()));

  const f3bad = hitsForbidden(first3);
  const f10bad = hitsForbidden(first10);
  const f3good = worldHits(first3);
  const f10good = worldHits(first10);
  const tailGood = worldHits(tail);

  const first3World = tracks.length > 0 && f3bad.length === 0 && (f3good.length >= 1 || tracks.length <= 3);
  const first10World = tracks.length >= 3 && f10bad.length <= 1 && f10good.length >= Math.min(3, first10.length);
  const tailCoherent = tail.length === 0 || tailGood.length >= Math.max(1, Math.floor(tail.length * 0.4));

  const targetLen = spec.length ?? 25;
  const fillRatio = tracks.length / targetLen;
  const honestPartial = fillRatio >= 0.5 && fillRatio < 0.85;
  const padded = fillRatio >= 0.85 && f10bad.length >= 2;

  const wouldISave = tracks.length >= 3
    ? evaluateWouldISave({
        prompt: spec.prompt,
        tracks: tracks.map((t) => ({
          trackId: `${t.artistName ?? t.artist}-${t.trackName ?? t.name}`,
          trackName: t.trackName ?? t.name ?? "?",
          artistName: t.artistName ?? t.artist ?? "?",
          genreFamily: t.genreFamily ?? null,
          energy: t.energy ?? null,
          valence: t.valence ?? null,
        })),
        context: null,
        lockedIntent: lockedIntentStub(),
      })
    : null;

  const hqgPass = meta.humanSaveable === true || meta.humanQualityGate === "pass";
  const combined = wouldISave?.combinedScore ?? 0;

  let verdict = "MAYBE";
  const issues = [];

  if (tracks.length < 6 || !okish(meta)) {
    verdict = "DROP";
    if (tracks.length < 6) issues.push(`underfilled (${tracks.length}/${targetLen})`);
    if (meta.httpStatus !== 200) issues.push(`HTTP ${meta.httpStatus}: ${meta.error ?? "error"}`);
  } else if (f10bad.length >= 3 || f3bad.length >= 2) {
    verdict = "DROP";
    issues.push("wrong-world artists dominate");
  } else if (
    f10bad.length === 0 &&
    f10good.length >= 4 &&
    tracks.length >= 10 &&
    first3World &&
    first10World &&
    (hqgPass || combined >= 0.68)
  ) {
    verdict = "KEEP";
  } else if (f10bad.length >= 2 || padded || !first3World) {
    verdict = "DROP";
    if (!first3World) issues.push("opener wrong world");
    if (padded) issues.push("padded with off-vibe tracks");
    if (f10bad.length >= 2) issues.push(`forbidden in first 10: ${f10bad.join("; ")}`);
  } else if (first3World && (first10World || tailCoherent) && (hqgPass || combined >= 0.6)) {
    verdict = "MAYBE";
    if (!first10World) issues.push("tail drifts from expected world");
    if (!hqgPass && combined < 0.68) issues.push("HQG/gate borderline");
    if (honestPartial) issues.push(`honest partial (${tracks.length}/${targetLen})`);
  } else {
    verdict = "MAYBE";
    if (!first10World) issues.push("weak world coherence in first 10");
  }

  if (meta.humanSaveable === false && verdict === "KEEP") verdict = "MAYBE";

  let failureClass = null;
  if (!first3World) failureClass = "WRONG_OPENER";
  else if (!first10World && first3World) failureClass = "GOOD_START_COLLAPSES";
  else if (f10bad.length > 0 && f10good.length >= 2) failureClass = "RIGHT_WORLD_BAD_SONGS";
  else if (tracks.length < 10 && tracks.length >= 6) failureClass = "HONEST_PARTIAL";

  return {
    trackCount: tracks.length,
    targetLen,
    first3Artists: first3.map((l) => l.split(" — ")[0]),
    first3,
    first10,
    forbiddenInFirst10: f10bad,
    worldHitsFirst10: f10good.length,
    first3World,
    first10World,
    tailCoherent,
    wouldISaveScore: combined,
    humanSaveable: meta.humanSaveable,
    humanQualityGate: meta.humanQualityGate,
    editorialWorldTag: meta.editorialWorldTag,
    verdict,
    failureClass,
    issues,
    hqgPass,
  };
}

function okish(meta) {
  return meta.httpStatus === 200;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    limit: get("--limit", null) ? Number.parseInt(get("--limit", "999"), 10) : null,
    resume: args.includes("--resume"),
    delayMs: Number.parseInt(get("--delay-ms", "2500"), 10),
    concurrency: Math.min(5, Math.max(1, Number.parseInt(get("--concurrency", "4"), 10))),
    baseUrl: get("--base-url", "https://kwalify.net"),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function categoryStats(results) {
  const byCat = new Map();
  for (const r of results) {
    const cat = r.category;
    if (!byCat.has(cat)) byCat.set(cat, { keep: 0, maybe: 0, drop: 0, total: 0 });
    const s = byCat.get(cat);
    s.total++;
    if (r.verdict === "KEEP") s.keep++;
    else if (r.verdict === "MAYBE") s.maybe++;
    else s.drop++;
  }
  return Object.fromEntries(byCat);
}

function buildMarkdown(summary) {
  const { results, aggregate, byCategory, commit, baseUrl, at, readyzCommit } = summary;
  const lines = [
    "# Human Expectation Benchmark — 2026-07-28",
    "",
    `**API:** ${baseUrl}  `,
    `**Local commit:** \`${commit?.slice(0, 7) ?? "unknown"}\`  `,
    `**Deploy commit:** \`${readyzCommit?.slice(0, 7) ?? "unknown"}\`  `,
    `**Run at:** ${at}  `,
    `**Prompts run:** ${results.length}`,
    "",
    "## Aggregate KEEP / MAYBE / DROP",
    "",
    `| Verdict | Count | Rate |`,
    `|---------|------:|-----:|`,
    `| KEEP | ${aggregate.keep} | ${(aggregate.keepRate * 100).toFixed(1)}% |`,
    `| MAYBE | ${aggregate.maybe} | ${(aggregate.maybeRate * 100).toFixed(1)}% |`,
    `| DROP | ${aggregate.drop} | ${(aggregate.dropRate * 100).toFixed(1)}% |`,
    "",
    `HQG humanSaveable pass rate: **${aggregate.hqgPassRate}%** (${aggregate.hqgPass}/${results.length})`,
    `HTTP 200 rate: **${aggregate.http200Rate}%** (${aggregate.http200}/${results.length})`,
    `Avg would-save score: **${aggregate.avgWouldSave ?? "—"}**`,
    "",
    "## Category breakdown",
    "",
    "| Category | Total | KEEP | MAYBE | DROP | KEEP rate |",
    "|----------|------:|-----:|------:|-----:|----------:|",
    ...Object.entries(byCategory)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([cat, s]) =>
        `| ${cat} | ${s.total} | ${s.keep} | ${s.maybe} | ${s.drop} | ${s.total ? ((s.keep / s.total) * 100).toFixed(0) : 0}% |`,
      ),
    "",
    "## Summary table (all prompts)",
    "",
    "| ID | Category | Prompt | Tracks | Verdict | Expected vs Actual | Key issues |",
    "|----|----------|--------|-------:|---------|-------------------|------------|",
    ...results.map((r) => {
      const promptShort = r.prompt.length > 42 ? r.prompt.slice(0, 39) + "…" : r.prompt;
      const eva = `${r.expectedWorld} → ${r.editorialWorldTag ?? "?"}`;
      const issues = r.issues.length ? r.issues.join("; ") : (r.failureClass ?? "—");
      return `| ${r.id} | ${r.category} | ${promptShort.replace(/\|/g, "/")} | ${r.trackCount} | **${r.verdict}** | ${eva.replace(/\|/g, "/")} | ${issues.replace(/\|/g, "/")} |`;
    }),
    "",
    "## Top failures (DROP)",
    "",
  ];

  const drops = results.filter((r) => r.verdict === "DROP");
  if (!drops.length) {
    lines.push("_No DROP verdicts._");
  } else {
    for (const r of drops.slice(0, 25)) {
      lines.push(`### ${r.id}: ${r.prompt}`);
      lines.push("");
      lines.push(`- **Category:** ${r.category}`);
      lines.push(`- **Expected:** ${r.expectedWorld}`);
      lines.push(`- **Actual world:** ${r.editorialWorldTag ?? "unknown"} | HQG: ${r.humanQualityGate ?? "—"} | humanSaveable: ${r.humanSaveable}`);
      lines.push(`- **Tracks:** ${r.trackCount} | First 3: ${r.first3Artists.join(", ")}`);
      if (r.forbiddenInFirst10?.length) {
        lines.push(`- **Wrong-world tracks:** ${r.forbiddenInFirst10.join("; ")}`);
      }
      lines.push(`- **Human expectation vs actual:** User asking for _"${r.prompt}"_ expects **${r.expectedWorld}**; system tagged \`${r.editorialWorldTag ?? "?"}\` with opener ${r.first3Artists.join(" / ")}.`);
      lines.push(`- **Issues:** ${r.issues.join("; ") || r.failureClass}`);
      lines.push("");
      lines.push("**First 3 tracks:**");
      for (const t of r.first3) lines.push(`- ${t}`);
      lines.push("");
    }
    if (drops.length > 25) lines.push(`_…and ${drops.length - 25} more DROP verdicts (see raw-results.json)._`);
  }

  lines.push("## Human expectation notes (sample)");
  lines.push("");
  const sampleKeep = results.filter((r) => r.verdict === "KEEP").slice(0, 3);
  const sampleMaybe = results.filter((r) => r.verdict === "MAYBE").slice(0, 3);
  const sampleDrop = results.filter((r) => r.verdict === "DROP").slice(0, 3);
  for (const r of [...sampleKeep, ...sampleMaybe, ...sampleDrop]) {
    lines.push(`- **${r.id}** (${r.verdict}): A real user asking for _"${r.prompt}"_ would expect **${r.expectedWorld}**. Got \`${r.editorialWorldTag ?? "?"}\` with opener ${r.first3Artists.join(" / ")}. ${r.verdict === "KEEP" ? "Would likely save." : r.verdict === "MAYBE" ? "Might replay a few tracks but wouldn't save the playlist." : "Would skip — wrong vibe or filler."}`);
  }

  lines.push("");
  lines.push("## Recommendations (highest impact)");
  lines.push("");
  const recs = [];
  const wrongOpeners = results.filter((r) => r.failureClass === "WRONG_OPENER").length;
  const collapses = results.filter((r) => r.failureClass === "GOOD_START_COLLAPSES").length;
  const landfill = results.filter((r) => r.forbiddenInFirst10?.length > 0).length;
  const underfill = results.filter((r) => r.trackCount < 10).length;
  const httpFails = results.filter((r) => r.httpStatus !== 200).length;
  if (wrongOpeners >= 5) recs.push(`1. **Opener/world lock** — ${wrongOpeners} prompts failed on first-3 world identity. Strengthen opening curator + world identity gate for genre-locked and scene prompts.`);
  if (collapses >= 5) recs.push(`2. **Tail coherence** — ${collapses} playlists had good openers but collapsed by track 10. Tighten editorial memory / pairwise local search.`);
  if (landfill >= 8) recs.push(`3. **Landfill suppression** — recurring wrong-world artists (Bon Iver, Clairo, Noah Kahan, etc.) in ${landfill} playlists. Hard-penalise in genre-locked worlds.`);
  if (underfill >= 8) recs.push(`4. **Honest partials** — ${underfill} playlists under 10 tracks. Prefer clear partial over padded filler (human-curation alignment).`);
  if (httpFails >= 3) recs.push(`5. **Reliability** — ${httpFails} HTTP failures/timeouts. Increase evaluation timeout or reduce per-prompt length for large batches.`);
  const negFails = results.filter((r) => r.category === "negation" && r.verdict !== "KEEP");
  if (negFails.length) recs.push(`6. **Negation enforcement** — ${negFails.length}/${results.filter((r) => r.category === "negation").length} negation prompts not KEEP. Seasonal/genre negations must be hard suppress.`);
  const ukFails = results.filter((r) => r.category === "UK-specific" && r.verdict === "DROP");
  if (ukFails.length >= 3) recs.push(`7. **UK scene grounding** — ${ukFails.length} UK-specific prompts DROP. Improve garage/grime/britpop scene routing.`);
  if (!recs.length) recs.push("1. Overall quality is strong — focus on MAYBE→KEEP polish (opener confidence, tail coherence).");
  lines.push(...recs);
  lines.push("");
  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- Prompts: \`${PROMPTS_PATH}\``);
  lines.push(`- Raw results: \`${RAW_PATH}\``);
  lines.push("");
  return lines.join("\n");
}

async function generateOne(creds, baseUrl, spec) {
  const started = Date.now();
  let data = {};
  let httpStatus = 0;
  try {
    const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: spec.prompt,
        length: spec.length ?? 25,
        mode: spec.mode ?? "balanced",
        seed: 42,
        spotifyUserId: creds.spotifyUserId,
        auditMode: true,
        allowDbWrites: false,
        allowSpotifyCreate: false,
        evaluationPromptId: `human-bench-${spec.id}`,
        evaluationCategory: "human_expectation_2026_07_28",
        evaluationTimeoutMs: 240_000,
      }),
    });
    httpStatus = res.status;
    data = await res.json();
  } catch (err) {
    data = { error: err.message };
    httpStatus = 0;
  }

  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const meta = {
    httpStatus,
    error: !httpStatus || httpStatus !== 200
      ? (data.message ?? data.error ?? data.userMessage ?? `HTTP ${httpStatus}`)
      : null,
    editorialWorldTag:
      data.intentCollapseLayer?.editorialWorldTag ??
      data.playlistExecutionTrace?.intentCollapseLayer?.editorialWorldTag ??
      null,
    humanSaveable:
      data.humanSaveabilityGate?.humanSaveable ??
      data.playlistExecutionTrace?.humanSaveable ??
      null,
    humanQualityGate:
      data.humanQualityGate?.action ??
      data.playlistExecutionTrace?.humanQualityGate?.action ??
      null,
  };

  const score = scoreHumanExpectation(tracks, spec, meta);
  return {
    id: spec.id,
    category: spec.category,
    prompt: spec.prompt,
    expectedWorld: spec.world,
    source: spec.source ?? null,
    ms: Date.now() - started,
    tracks: tracks.map((t) => ({
      artist: t.artistName ?? t.artist ?? "?",
      name: t.trackName ?? t.name ?? "?",
    })),
    ...meta,
    ...score,
  };
}

async function runPool(items, concurrency, worker, onDone) {
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      const result = await worker(item);
      await onDone(result, item);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
}

function summarize(results) {
  const n = results.length || 1;
  const keep = results.filter((r) => r.verdict === "KEEP").length;
  const maybe = results.filter((r) => r.verdict === "MAYBE").length;
  const drop = results.filter((r) => r.verdict === "DROP").length;
  const hqgPass = results.filter((r) => r.humanSaveable === true).length;
  const http200 = results.filter((r) => r.httpStatus === 200).length;
  const scores = results.map((r) => r.wouldISaveScore).filter((s) => typeof s === "number" && Number.isFinite(s));
  return {
    keep,
    maybe,
    drop,
    keepRate: keep / n,
    maybeRate: maybe / n,
    dropRate: drop / n,
    hqgPass,
    hqgPassRate: ((hqgPass / n) * 100).toFixed(1),
    http200,
    http200Rate: ((http200 / n) * 100).toFixed(1),
    avgWouldSave: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3) : null,
  };
}

async function saveArtifacts(summary) {
  await mkdir(BENCH_DIR, { recursive: true });
  await writeFile(RAW_PATH, JSON.stringify(summary, null, 2));
  await writeFile(REPORT_PATH, buildMarkdown(summary));
}

async function main() {
  const { limit, resume, delayMs, concurrency, baseUrl: cliBase } = parseArgs();

  const creds = await resolveVerifiedProductionCredentials();
  const baseUrl = (cliBase || creds.baseUrl || "https://kwalify.net").replace(/\/$/, "");
  const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const ready = await (await fetch(`${baseUrl}/api/readyz`)).json();

  const corpus = JSON.parse(await readFile(PROMPTS_PATH, "utf8"));
  let allPrompts = corpus.prompts ?? corpus;
  if (limit) allPrompts = allPrompts.slice(0, limit);

  if (allPrompts.length < 100) {
    throw new Error(`Only ${allPrompts.length} prompts in ${PROMPTS_PATH} — need 100+. Run collector first.`);
  }

  let existing = [];
  if (resume) {
    try {
      const raw = await readFile(RAW_PATH, "utf8");
      existing = JSON.parse(raw).results ?? [];
    } catch {
      existing = [];
    }
  }
  const isSuccessfulRun = (r) => r.httpStatus === 200 && r.trackCount > 0;
  const kept = existing.filter(isSuccessfulRun);
  const retryIds = new Set(existing.filter((r) => !isSuccessfulRun(r)).map((r) => r.id));
  const doneIds = new Set(kept.map((r) => r.id));
  const toRun = allPrompts.filter((p) => !doneIds.has(p.id));
  const results = [...kept];

  console.log(`Running ${toRun.length} prompts (${kept.length} successful, ${retryIds.size} retries) against ${baseUrl}`);
  console.log(`Concurrency: ${concurrency} | delay between batches: ${delayMs}ms`);

  let completedInBatch = 0;
  await runPool(
    toRun,
    concurrency,
    async (spec) => generateOne(creds, baseUrl, spec),
    async (row) => {
      results.push(row);
      completedInBatch++;
      const tag = row.httpStatus !== 200 || row.trackCount === 0
        ? `FAIL (${row.httpStatus}: ${row.error})`
        : `${row.verdict} (${row.trackCount} tracks, ${row.ms}ms, HQG=${row.humanQualityGate})`;
      console.log(`[${row.id}] ${row.prompt.slice(0, 48)}… → ${tag}`);

      const summary = {
        at: new Date().toISOString(),
        commit,
        readyzCommit: ready.commit ?? null,
        baseUrl,
        concurrency,
        promptCount: allPrompts.length,
        aggregate: summarize(results),
        byCategory: categoryStats(results),
        results,
      };
      await saveArtifacts(summary);

      if (completedInBatch % concurrency === 0 && completedInBatch < toRun.length) {
        await sleep(delayMs);
      }
    },
  );

  const summary = {
    at: new Date().toISOString(),
    commit,
    readyzCommit: ready.commit ?? null,
    baseUrl,
    concurrency,
    promptCount: allPrompts.length,
    aggregate: summarize(results),
    byCategory: categoryStats(results),
    results,
  };
  await saveArtifacts(summary);

  const { aggregate: a } = summary;
  console.log("\n=== AGGREGATE ===");
  console.log(`Prompts run: ${results.length}`);
  console.log(`KEEP: ${a.keep} (${(a.keepRate * 100).toFixed(1)}%)`);
  console.log(`MAYBE: ${a.maybe} (${(a.maybeRate * 100).toFixed(1)}%)`);
  console.log(`DROP: ${a.drop} (${(a.dropRate * 100).toFixed(1)}%)`);
  console.log(`Report: ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
