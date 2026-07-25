/**
 * Large live benchmark — natural human prompts, organized for save/keep review.
 *
 * Output: reports/playlist-evaluation/human-keep-live/<run-id>/
 *   README.md, SUMMARY.md, summary.json, generations.jsonl
 *   playlists/<verdict>_<id>_<slug>.md
 *   by-verdict/<verdict>/index.md
 *   by-family/<family>/index.md
 *   by-difficulty/<difficulty>/index.md
 *
 * Usage:
 *   npm run benchmark:human-keep-live
 *   HUMAN_KEEP_LIMIT=20 npm run benchmark:human-keep-live
 *   HUMAN_KEEP_IDS=h03,h65 npm run benchmark:human-keep-live
 *   HUMAN_KEEP_DIFFICULTY=easy npm run benchmark:human-keep-live
 *   HUMAN_KEEP_DIFFICULTY=hard,edge npm run benchmark:human-keep-live
 *   HUMAN_KEEP_VARIETY=1 npm run benchmark:human-keep-live
 */
import { mkdir, writeFile, appendFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { ensureEvalReady, evalPingOk, healthOk } from "../lib/benchmark-local-server";
import { HUMAN_100_PROMPTS } from "./human-100-prompts";
import {
  asTracks,
  extractHumanQualityGate,
  judgeHuman,
  renderPlaylistMarkdown,
  slugifyPrompt,
  type SaveVerdict,
  type TrackRow,
} from "./human-keep-judge";

function runId(): string {
  const custom = process.env.HUMAN_KEEP_RUN_ID?.trim();
  if (custom) return custom;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}Z`;
}

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

type ResultRow = {
  id: string;
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  length: number;
  difficulty: "easy" | "medium" | "hard" | "edge";
  family: string;
  httpStatus: number;
  ok: boolean;
  ms: number;
  tracks: TrackRow[];
  message: string | null;
  humanQualityGate: unknown;
  playlistConfidence: unknown;
  judgment: ReturnType<typeof judgeHuman>;
  playlistFile: string;
};

async function writeIndex(dir: string, title: string, entries: Array<{ file: string; label: string }>) {
  await mkdir(dir, { recursive: true });
  const lines = [`# ${title}`, "", ...entries.map((e) => `- [${e.label}](${e.file})`)];
  await writeFile(path.join(dir, "index.md"), lines.join("\n"));
}

async function writeLiveStatus(
  outDir: string,
  opts: {
    runId: string;
    completed: number;
    total: number;
    currentId: string | null;
    currentPrompt: string | null;
    counts: Record<string, number>;
    results: ResultRow[];
  },
) {
  const underfilled = opts.results.filter((r) => r.tracks.length > 0 && r.tracks.length < r.length * 0.9);
  const fillRatios = opts.results
    .filter((r) => r.length > 0)
    .map((r) => r.tracks.length / r.length);
  const avgFillRatio = fillRatios.length
    ? +(fillRatios.reduce((a, b) => a + b, 0) / fillRatios.length).toFixed(3)
    : 0;
  const avgMs = opts.results.length
    ? Math.round(opts.results.reduce((a, r) => a + r.ms, 0) / opts.results.length)
    : 0;
  const remaining = Math.max(0, opts.total - opts.completed);
  const etaMinutes = remaining > 0 && avgMs > 0 ? Math.max(1, Math.round((remaining * avgMs) / 60000)) : 0;
  const recentPrompts = opts.results.slice(-5).map((r) => ({
    id: r.id,
    prompt: r.prompt.slice(0, 72),
    verdict: r.judgment.verdict,
    tracks: r.tracks.length,
    asked: r.length,
    underfilled: r.tracks.length > 0 && r.tracks.length < r.length * 0.9,
    ms: r.ms,
  }));
  const status = {
    runId: opts.runId,
    label: "human-keep-live",
    status: opts.completed >= opts.total ? "completed" : "running",
    updatedAt: new Date().toISOString(),
    progress: {
      completed: opts.completed,
      total: opts.total,
      percent: opts.total > 0 ? +((100 * opts.completed) / opts.total).toFixed(1) : 0,
      currentId: opts.currentId,
      currentPrompt: opts.currentPrompt,
    },
    counts: opts.counts,
    underfilledCount: underfilled.length,
    avgFillRatio,
    wouldSaveSoFar: opts.counts.SAVE ?? 0,
    keepableSoFar:
      (opts.counts.SAVE ?? 0) +
      (opts.counts.PARTIAL_OK ?? 0) +
      (opts.counts.MAYBE ?? 0) +
      (opts.counts.REFUSE_OK ?? 0),
    wouldSaveRateSoFar: opts.completed > 0 ? +(((opts.counts.SAVE ?? 0) / opts.completed)).toFixed(3) : 0,
    avgMs,
    etaMinutes,
    recentPrompts,
  };
  await writeFile(path.join(outDir, "status.json"), JSON.stringify(status, null, 2));
  try {
    await mkdir(path.join("reports"), { recursive: true });
    await copyFile(path.join(outDir, "status.json"), path.join("reports", "benchmark-live.json"));
  } catch {
    /* ignore */
  }
  const lines = [
    "HUMAN KEEP LIVE - LIVE STATUS",
    `Updated: ${status.updatedAt}`,
    `Progress: ${opts.completed}/${opts.total} (${status.progress.percent}%)`,
    opts.currentId ? `Current: ${opts.currentId} - ${opts.currentPrompt}` : "",
    "",
    "VERDICTS SO FAR",
    `  SAVE:        ${opts.counts.SAVE ?? 0}`,
    `  PARTIAL_OK:  ${opts.counts.PARTIAL_OK ?? 0}`,
    `  MAYBE:       ${opts.counts.MAYBE ?? 0}`,
    `  SKIP:        ${opts.counts.SKIP ?? 0}`,
    `  REFUSE_OK:   ${opts.counts.REFUSE_OK ?? 0}`,
    `  EMPTY_BAD:   ${opts.counts.EMPTY_BAD ?? 0}`,
    "",
    `Underfilled (<90%): ${underfilled.length}`,
    `Avg fill ratio:     ${avgFillRatio}`,
  ].filter(Boolean);
  await writeFile(path.join(outDir, "STATUS.txt"), lines.join("\n"));
}

async function main() {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: "http://127.0.0.1:5000",
    cli: { baseUrl: process.env.HUMAN_KEEP_BASE_URL || "http://127.0.0.1:5000" },
  });
  const spawnLocal = process.env.HUMAN_KEEP_SPAWN !== "0";
  if (spawnLocal && process.env.BENCHMARK_FORCE_RESTART !== "0") {
    process.env.BENCHMARK_FORCE_RESTART = "1";
  }
  const varietyBoost = process.env.HUMAN_KEEP_VARIETY === "1";
  const limit = process.env.HUMAN_KEEP_LIMIT
    ? Number.parseInt(process.env.HUMAN_KEEP_LIMIT, 10)
    : HUMAN_100_PROMPTS.length;
  const idFilter = process.env.HUMAN_KEEP_IDS?.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const cohortFilter = process.env.HUMAN_KEEP_COHORT?.trim().toLowerCase();
  const difficultyFilter = process.env.HUMAN_KEEP_DIFFICULTY
    ?.split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  let prompts: typeof HUMAN_100_PROMPTS;
  if (cohortFilter === "guided" || cohortFilter === "vague") {
    prompts = HUMAN_100_PROMPTS.filter((p) => p.cohort === cohortFilter);
    if (idFilter?.length) {
      prompts = prompts.filter((p) => idFilter.includes(p.id.toLowerCase()));
    }
  } else if (idFilter?.length) {
    prompts = HUMAN_100_PROMPTS.filter((p) => idFilter.includes(p.id.toLowerCase()));
  } else {
    prompts = HUMAN_100_PROMPTS.slice(0, Math.max(1, Math.min(limit, HUMAN_100_PROMPTS.length)));
  }
  if (difficultyFilter?.length) {
    prompts = prompts.filter((p) => difficultyFilter.includes(p.difficulty));
  }
  if (!idFilter?.length && prompts.length > limit) {
    prompts = prompts.slice(0, Math.max(1, limit));
  }
  if (prompts.length === 0) {
    throw new Error(
      cohortFilter
        ? `No prompts for cohort=${cohortFilter}${idFilter?.length ? ` ids=${process.env.HUMAN_KEEP_IDS}` : ""}`
        : `HUMAN_KEEP_IDS matched no prompts: ${process.env.HUMAN_KEEP_IDS}`,
    );
  }

  const ready = await ensureEvalReady(creds.baseUrl, creds.token, spawnLocal, "benchmark:human-keep-live");
  const baseUrl = ready.baseUrl;
  if (!(await healthOk(baseUrl))) throw new Error(`API not healthy at ${baseUrl}`);
  const ping = await evalPingOk(baseUrl, creds.token);
  if (!ping.ok) throw new Error(`Eval token rejected: ${ping.reason}`);

  const id = runId();
  const outDir = path.join("reports", "playlist-evaluation", "human-keep-live", id);
  const playlistsDir = path.join(outDir, "playlists");
  const byVerdictDir = path.join(outDir, "by-verdict");
  const byFamilyDir = path.join(outDir, "by-family");
  const byDifficultyDir = path.join(outDir, "by-difficulty");
  await mkdir(playlistsDir, { recursive: true });

  const jsonlPath = path.join(outDir, "generations.jsonl");
  await writeFile(jsonlPath, "");

  const commit = gitCommit();
  console.log(`[human-keep-live] run=${id} prompts=${prompts.length} → ${baseUrl} user=${creds.spotifyUserId}`);
  if (varietyBoost) console.log("[human-keep-live] varietyBoost=on (same-prompt diversity)");

  const results: ResultRow[] = [];
  const verdictIndex = new Map<SaveVerdict, Array<{ file: string; label: string }>>();
  const familyIndex = new Map<string, Array<{ file: string; label: string }>>();
  const difficultyIndex = new Map<string, Array<{ file: string; label: string }>>();

  const tallyCounts = () => ({
    SAVE: results.filter((r) => r.judgment.verdict === "SAVE").length,
    PARTIAL_OK: results.filter((r) => r.judgment.verdict === "PARTIAL_OK").length,
    MAYBE: results.filter((r) => r.judgment.verdict === "MAYBE").length,
    SKIP: results.filter((r) => r.judgment.verdict === "SKIP").length,
    REFUSE_OK: results.filter((r) => r.judgment.verdict === "REFUSE_OK").length,
    EMPTY_BAD: results.filter((r) => r.judgment.verdict === "EMPTY_BAD").length,
  });

  for (let i = 0; i < prompts.length; i++) {
    const fixture = prompts[i]!;
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/generate?audit=1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-kwalify-evaluation-token": creds.token,
        },
        body: JSON.stringify({
          vibe: fixture.prompt,
          mode: fixture.mode,
          length: fixture.length,
          spotifyUserId: creds.spotifyUserId,
          auditMode: true,
          allowDbWrites: false,
          allowSpotifyCreate: false,
          evaluationPromptId: fixture.id,
          evaluationCategory: "human_keep_live",
          evaluationTimeoutMs: 240_000,
          ...(varietyBoost ? { varietyBoost: true } : {}),
        }),
      });
    } catch (err) {
      const judgment = judgeHuman({
        family: fixture.family,
        prompt: fixture.prompt,
        tracks: [],
        asked: fixture.length,
        httpStatus: 0,
        message: "fetch_failed",
        humanQualityGate: null,
      });
      const playlistFile = `FETCH_FAIL_${fixture.id}_${slugifyPrompt(fixture.prompt)}.md`;
      const row: ResultRow = {
        ...fixture,
        httpStatus: 0,
        ok: false,
        ms: Date.now() - started,
        tracks: [],
        message: err instanceof Error ? err.message : String(err),
        humanQualityGate: null,
        playlistConfidence: null,
        judgment,
        playlistFile,
      };
      results.push(row);
      await appendFile(jsonlPath, `${JSON.stringify(row)}\n`);
      console.log(`[${i + 1}/${prompts.length}] ${fixture.id} FETCH_FAIL`);
      continue;
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const tracks = asTracks(data.tracks);
    const message = (data.message ?? data.userMessage ?? data.error ?? null) as string | null;
    const hqg = extractHumanQualityGate(data);
    const judgment = judgeHuman({
      family: fixture.family,
      prompt: fixture.prompt,
      tracks,
      asked: fixture.length,
      httpStatus: response.status,
      message,
      humanQualityGate: hqg,
    });
    const playlistFile = `${judgment.verdict}_${fixture.id}_${slugifyPrompt(fixture.prompt)}.md`;
    const row: ResultRow = {
      ...fixture,
      httpStatus: response.status,
      ok: response.ok && tracks.length > 0,
      ms: Date.now() - started,
      tracks,
      message,
      humanQualityGate: hqg,
      playlistConfidence: data.playlistConfidence ?? null,
      judgment,
      playlistFile,
    };
    results.push(row);
    await appendFile(jsonlPath, `${JSON.stringify(row)}\n`);

    const md = renderPlaylistMarkdown(row);
    await writeFile(path.join(playlistsDir, playlistFile), md);

    const relFile = `../../playlists/${playlistFile}`;
    const label = `${fixture.id} — ${fixture.prompt.slice(0, 56)}`;
    const vList = verdictIndex.get(judgment.verdict) ?? [];
    vList.push({ file: relFile, label });
    verdictIndex.set(judgment.verdict, vList);
    const fList = familyIndex.get(fixture.family) ?? [];
    fList.push({ file: relFile, label: `${judgment.verdict} · ${label}` });
    familyIndex.set(fixture.family, fList);
    const dList = difficultyIndex.get(fixture.difficulty) ?? [];
    dList.push({ file: relFile, label: `${judgment.verdict} · ${label}` });
    difficultyIndex.set(fixture.difficulty, dList);

    console.log(
      `[${i + 1}/${prompts.length}] ${fixture.id} ${judgment.verdict.padEnd(9)} n=${String(tracks.length).padStart(2)}/${fixture.length} ` +
        `${fixture.difficulty}/${fixture.family} ${Math.round(row.ms / 1000)}s — ${fixture.prompt.slice(0, 44)}`,
    );

    await writeLiveStatus(outDir, {
      runId: id,
      completed: i + 1,
      total: prompts.length,
      currentId: fixture.id,
      currentPrompt: fixture.prompt,
      counts: tallyCounts(),
      results,
    });
  }

  const counts = tallyCounts();
  const underfilledRows = results.filter((r) => r.tracks.length > 0 && r.tracks.length < r.length * 0.9);
  const fillRatios = results.filter((r) => r.length > 0).map((r) => r.tracks.length / r.length);
  const avgFillRatio = fillRatios.length
    ? +(fillRatios.reduce((a, b) => a + b, 0) / fillRatios.length).toFixed(3)
    : 0;
  const avgUnderfillRatio = fillRatios.length
    ? +(fillRatios.map((f) => Math.max(0, 1 - f)).reduce((a, b) => a + b, 0) / fillRatios.length).toFixed(3)
    : 0;
  const worldFeelCounts = {
    one_world: results.filter((r) => r.judgment.worldFeel === "one_world").length,
    mixed: results.filter((r) => r.judgment.worldFeel === "mixed").length,
    broken: results.filter((r) => r.judgment.worldFeel === "broken").length,
    empty: results.filter((r) => r.judgment.worldFeel === "empty").length,
  };
  const keepable = counts.SAVE + counts.PARTIAL_OK + counts.MAYBE + counts.REFUSE_OK;
  const summary = {
    runId: id,
    label: "human-keep-live",
    purpose: "Natural-language prompts a human would try — judged for save/keep/replay",
    generatedAt: new Date().toISOString(),
    gitCommit: commit,
    baseUrl,
    userId: creds.spotifyUserId,
    promptCount: prompts.length,
    varietyBoost,
    cohort: cohortFilter ?? "all",
    counts,
    keepableRate: +(keepable / results.length).toFixed(3),
    wouldSaveRate: +(counts.SAVE / results.length).toFixed(3),
    wouldSkipRate: +((counts.SKIP + counts.EMPTY_BAD) / results.length).toFixed(3),
    underfilledCount: underfilledRows.length,
    avgFillRatio,
    avgUnderfillRatio,
    worldFeelCounts,
    avgMs: Math.round(results.reduce((a, r) => a + r.ms, 0) / Math.max(1, results.length)),
    byDifficulty: Object.fromEntries(
      (["easy", "medium", "hard", "edge"] as const).map((d) => {
        const rows = results.filter((r) => r.difficulty === d);
        return [
          d,
          {
            n: rows.length,
            SAVE: rows.filter((r) => r.judgment.verdict === "SAVE").length,
            PARTIAL_OK: rows.filter((r) => r.judgment.verdict === "PARTIAL_OK").length,
            MAYBE: rows.filter((r) => r.judgment.verdict === "MAYBE").length,
            SKIP: rows.filter((r) => r.judgment.verdict === "SKIP").length,
            REFUSE_OK: rows.filter((r) => r.judgment.verdict === "REFUSE_OK").length,
            EMPTY_BAD: rows.filter((r) => r.judgment.verdict === "EMPTY_BAD").length,
          },
        ];
      }),
    ),
    byFamily: Object.fromEntries(
      [...new Set(results.map((r) => r.family))].sort().map((family) => {
        const rows = results.filter((r) => r.family === family);
        return [
          family,
          {
            n: rows.length,
            SAVE: rows.filter((r) => r.judgment.verdict === "SAVE").length,
            SKIP: rows.filter((r) => r.judgment.verdict === "SKIP").length,
          },
        ];
      }),
    ),
    results: results.map(({ tracks: _t, ...rest }) => rest),
  };

  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  for (const [verdict, entries] of verdictIndex) {
    await writeIndex(path.join(byVerdictDir, verdict), `${verdict} — would keep?`, entries);
  }
  for (const [family, entries] of familyIndex) {
    await writeIndex(path.join(byFamilyDir, family), `Family: ${family}`, entries);
  }
  for (const [difficulty, entries] of difficultyIndex) {
    await writeIndex(path.join(byDifficultyDir, difficulty), `Difficulty: ${difficulty}`, entries);
  }

  const readme = [
    "# Human Keep Live Benchmark",
    "",
    "Natural-language prompts a real person would type — each playlist judged for **save / keep / replay**.",
    "",
    `**Run ID:** \`${id}\``,
    `**Generated:** ${summary.generatedAt}`,
    commit ? `**Git commit:** \`${commit}\`` : "",
    `**Prompts:** ${prompts.length}`,
    `**Library user:** ${creds.spotifyUserId}`,
    `**Variety boost:** ${varietyBoost ? "on" : "off"}`,
    "",
    "## Verdict key",
    "",
    "| Verdict | Meaning |",
    "|---------|---------|",
    "| **SAVE** | Would save and replay — belongs in one world |",
    "| **PARTIAL_OK** | Honest partial — would keep what's there |",
    "| **MAYBE** | Listenable with skips — wouldn't save as-is |",
    "| **SKIP** | Would abandon — broken world or filler smell |",
    "| **REFUSE_OK** | Empty/refuse with honest message — good UX |",
    "| **EMPTY_BAD** | Empty without explanation — bad UX |",
    "",
    "## Results",
    "",
    `- **Would save:** ${counts.SAVE}/${prompts.length}`,
    `- **Honest partial:** ${counts.PARTIAL_OK}/${prompts.length}`,
    `- **Maybe:** ${counts.MAYBE}/${prompts.length}`,
    `- **Skip:** ${counts.SKIP}/${prompts.length}`,
    `- **Honest refuse:** ${counts.REFUSE_OK}/${prompts.length}`,
    `- **Empty bad:** ${counts.EMPTY_BAD}/${prompts.length}`,
    `- **Underfilled (<90%):** ${underfilledRows.length}/${prompts.length}`,
    `- **Avg fill ratio:** ${avgFillRatio}`,
    `- **One-world feel:** ${worldFeelCounts.one_world}/${prompts.length}`,
  ].filter(Boolean).join("\n");

  const summaryMd = [
    readme,
    "",
    "## Folder guide",
    "",
    "- `playlists/` — one markdown file per prompt (full track list)",
    "- `by-verdict/` — grouped by save/keep judgment",
    "- `by-family/` — grouped by scene family (gym, chill, vague, …)",
    "- `by-difficulty/` — easy → edge",
    "- `generations.jsonl` — machine-readable row per prompt",
    "- `summary.json` — aggregate stats",
    "",
    "## By difficulty",
    "",
    ...Object.entries(summary.byDifficulty).map(([d, c]) =>
      `- **${d}** (n=${(c as { n: number }).n}): SAVE ${(c as Record<string, number>).SAVE} · PARTIAL ${(c as Record<string, number>).PARTIAL_OK} · MAYBE ${(c as Record<string, number>).MAYBE} · SKIP ${(c as Record<string, number>).SKIP}`,
    ),
  ].join("\n");

  await writeFile(path.join(outDir, "README.md"), readme);
  await writeFile(path.join(outDir, "SUMMARY.md"), summaryMd);
  await writeLiveStatus(outDir, {
    runId: id,
    completed: prompts.length,
    total: prompts.length,
    currentId: null,
    currentPrompt: null,
    counts,
    results,
  });

  console.log("\n=== HUMAN KEEP LIVE SUMMARY ===");
  console.log(JSON.stringify(counts));
  console.log(`wouldSave=${summary.wouldSaveRate} keepable=${summary.keepableRate} skip=${summary.wouldSkipRate} underfill=${summary.underfilledCount} fill=${summary.avgFillRatio}`);
  console.log(`Wrote ${outDir}`);

  ready.shutdown?.();
  if (counts.SKIP + counts.EMPTY_BAD > prompts.length * 0.4) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
