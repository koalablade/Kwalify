#!/usr/bin/env node
/**
 * Human QA: screen 100-gen JSONL, optionally create private Spotify QA playlists.
 * Does not generate playlists via the engine. Does not modify V55.
 *
 *   npm run eval:human-quality:qa -- --dry-run
 *   npm run eval:human-quality:qa -- --run hq100-6822d2f0
 *   npm run eval:human-quality:qa -- --list
 *   npm run eval:human-quality:qa -- --cleanup
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { diagnose100GenerationRecords } = require("../dist/lib/human-quality-evaluator/forensic-analysis.js");
const { deploymentVersion } = require("../dist/lib/deployment-version.js");
const {
  publishQaPlaylists,
  cleanupQaPlaylists,
  formatQaReportMarkdown,
  writeQaReviewTemplates,
  loadFilledQaReviews,
  formatHumanCalibration,
} = require("../dist/lib/human-quality-evaluator/spotify-qa.js");
const { loadQaRegistry, saveQaRegistry } = require("../dist/lib/human-quality-evaluator/spotify-qa-registry.js");
const { createMockSpotifyQaAdapter } = require("../dist/lib/human-quality-evaluator/spotify-qa-adapter.js");
const { createLiveSpotifyQaAdapter } = require("../dist/lib/human-quality-evaluator/spotify-qa-live.js");
const { resolveQaLibrarySnapshot } = require("../dist/lib/human-quality-evaluator/library-snapshot.js");
const {
  loadGoldSet,
  saveGoldSet,
  mergeGoldSet,
  goldLabelFromReview,
} = require("../dist/lib/human-quality-evaluator/gold-set.js");
const { investigate, formatInvestigationMarkdown } = require("../dist/lib/human-quality-evaluator/investigation.js");

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    run: get("--run", null),
    inPath: get("--in", join(process.cwd(), "reports", "human-quality", "100-gen", "results.jsonl")),
    outDir: get("--out", join(process.cwd(), "reports", "human-quality", "100-gen", "spotify-qa")),
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    list: args.includes("--list"),
    cleanup: args.includes("--cleanup"),
    limit: get("--limit", null) ? Number.parseInt(get("--limit", "15"), 10) : 15,
  };
}

async function readJsonl(path) {
  const raw = await readFile(path, "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const opts = parseArgs();
  const registryPath = join(opts.outDir, "playlist-registry.json");

  if (opts.list) {
    const registry = await loadQaRegistry(registryPath, opts.run ?? "unknown");
    console.log(`[qa] ${registry.playlists.length} registry rows for ${registry.benchmarkRunId}`);
    for (const row of registry.playlists) {
      console.log(`  ${row.status.padEnd(16)} ${row.prompt.slice(0, 40).padEnd(40)} ${row.spotifyUrl ?? ""}`);
    }
    return;
  }

  let records = await readJsonl(opts.inPath);
  if (opts.run) records = records.filter((r) => r.benchmarkRunId === opts.run);
  if (records.length === 0) {
    console.error(`No benchmark records in ${opts.inPath}${opts.run ? ` for ${opts.run}` : ""}`);
    process.exit(1);
  }
  const runId = records[0].benchmarkRunId;
  const cachePath = join(process.cwd(), "reports", "human-quality", "100-gen", "library-snapshot.json");
  const library = await resolveQaLibrarySnapshot(cachePath);
  if (library) console.log(`[qa] library snapshot ${library.librarySize} tracks (opportunity measured, not hardcoded)`);
  else console.warn("[qa] no liked_songs snapshot — library opportunity UNKNOWN (will not assume sparse library)");
  const diagnosis = diagnose100GenerationRecords(records, 25, library);

  if (opts.cleanup) {
    if (opts.dryRun) {
      const registry = await loadQaRegistry(registryPath, runId);
      const n = registry.playlists.filter((p) => p.spotifyPlaylistId && p.status !== "deleted").length;
      console.log(`[qa] dry-run cleanup would unfollow ${n} registered QA playlists only`);
      return;
    }
    const adapter = await createLiveSpotifyQaAdapter();
    const registry = await loadQaRegistry(registryPath, runId);
    const n = await cleanupQaPlaylists(adapter, registry);
    await saveQaRegistry(registryPath, registry);
    console.log(`[qa] unfollowed ${n} registered QA playlists`);
    return;
  }

  let dryRun = opts.dryRun;
  let adapter = createMockSpotifyQaAdapter();
  if (!dryRun) {
    try {
      adapter = await createLiveSpotifyQaAdapter();
      console.log(`[qa] Spotify user ${(await adapter.getUserId())}`);
    } catch (err) {
      dryRun = true;
      adapter = createMockSpotifyQaAdapter();
      console.warn(`[qa] Live Spotify unavailable (${err instanceof Error ? err.message : String(err)})`);
      console.warn("[qa] Falling back to dry-run. Log into Kwalify locally or set SPOTIFY_REFRESH_TOKEN with playlist-modify-private.");
    }
  }

  const publish = await publishQaPlaylists({
    diagnosis,
    adapter,
    outDir: opts.outDir,
    dryRun,
    force: opts.force,
    limit: opts.limit,
    commit: deploymentVersion(),
  });

  await mkdir(opts.outDir, { recursive: true });
  await writeQaReviewTemplates(opts.outDir, publish.registry);
  const reviews = await loadFilledQaReviews(opts.outDir);
  const goldExisting = await loadGoldSet();
  const incoming = reviews
    .map((r) => goldLabelFromReview(r, runId))
    .filter(Boolean);
  const merged = mergeGoldSet(goldExisting, incoming);
  await saveGoldSet(merged.gold);
  const inv = investigate(diagnosis, merged.gold);
  const invMd = formatInvestigationMarkdown(inv);
  await writeFile(join(opts.outDir, "investigation.md"), invMd);
  const md = formatQaReportMarkdown({ diagnosis, registry: publish.registry, publish, investigationMd: invMd });
  await writeFile(join(opts.outDir, "qa-report.md"), md);
  await writeFile(
    join(opts.outDir, "qa-report.json"),
    `${JSON.stringify({
      benchmarkRunId: runId,
      totals: diagnosis.totals,
      delivery: diagnosis.delivery,
      failureRank: diagnosis.failureRank.slice(0, 8),
      publish: {
        created: publish.created,
        reused: publish.reused,
        skippedEmpty: publish.skippedEmpty,
        failed: publish.failed,
        dryRun: publish.dryRun,
        addFailureCount: publish.addFailureCount,
      },
      playlists: publish.registry.playlists.map((p) => ({
        requestId: p.requestId,
        prompt: p.prompt,
        status: p.status,
        spotifyUrl: p.spotifyUrl,
        automatedVerdict: p.automatedVerdict,
      })),
      recommendedNextAction: inv.nextAction,
      nextActionWhy: inv.nextActionWhy,
      engineChangeAllowed: inv.engineChange.met,
      humanConfirmed: inv.humanConfirmed,
      diagnosticGroup: inv.diagnosticGroup,
    }, null, 2)}\n`,
  );

  await writeFile(join(opts.outDir, "human-vs-automation.md"), formatHumanCalibration(reviews, publish.registry));

  console.log(`[qa] analysed ${diagnosis.playlists.length} | shortlist ${Math.min(opts.limit, diagnosis.shortlist.length)}`);
  console.log(`[qa] created ${publish.created} reused ${publish.reused} empty ${publish.skippedEmpty} failed ${publish.failed} dryRun ${publish.dryRun}`);
  for (const row of publish.registry.playlists) {
    if (row.spotifyUrl) console.log(`  ${row.prompt} → ${row.spotifyUrl}`);
    else console.log(`  ${row.prompt} → ${row.status}`);
  }
  console.log(`[qa] NEXT ACTION: ${inv.nextAction}`);
  console.log(`[qa] engine change allowed: ${inv.engineChange.met}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
