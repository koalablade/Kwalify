/**
 * Publish forensic shortlist as private Spotify QA playlists.
 * Evaluation side-effect only — does not generate music.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ForensicDiagnosis, HumanValidationItem } from "./forensic-analysis";
import { screenPlaylist } from "./qa-screen";
import type { SpotifyQaAdapter } from "./spotify-qa-adapter";
import {
  findRegistryEntry,
  loadQaRegistry,
  QA_PLAYLIST_MARKER,
  saveQaRegistry,
  upsertRegistryEntry,
  type QaPlaylistRecord,
  type QaPlaylistRegistry,
} from "./spotify-qa-registry";

export const QA_NAME_PREFIX = "Kwalify QA |";

export function qaPlaylistName(item: HumanValidationItem): string {
  const prompt = item.prompt.replace(/\s+/g, " ").trim().slice(0, 40);
  const tail = item.requestId.slice(-10);
  return `${QA_NAME_PREFIX} ${prompt} | ${tail}`.slice(0, 100);
}

export function qaPlaylistDescription(item: HumanValidationItem, commit: string | null): string {
  const reasons = item.failureClasses.filter((c) => c !== "INCOMPLETE_TRACE").slice(0, 3).join(", ");
  const text = [
    QA_PLAYLIST_MARKER,
    `Prompt: "${item.prompt}"`,
    `ID: ${item.requestId}`,
    `Engine: V55`,
    commit ? `Commit: ${commit.slice(0, 8)}` : null,
    `Auto: ${item.bucket} (not human-verified)`,
    item.libraryOpportunity ? `Lib: ${item.libraryOpportunity}/${item.libraryUtilisation ?? "?"}` : null,
    `Human review: PENDING`,
    reasons ? `Flags: ${reasons}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return text.slice(0, 300);
}

export type PublishQaOptions = {
  diagnosis: ForensicDiagnosis;
  adapter: SpotifyQaAdapter;
  outDir: string;
  dryRun: boolean;
  force: boolean;
  limit?: number;
  commit?: string | null;
};

export type PublishQaResult = {
  registry: QaPlaylistRegistry;
  created: number;
  reused: number;
  skippedEmpty: number;
  failed: number;
  dryRun: boolean;
  addFailureCount: number;
};

function trackMeta(item: HumanValidationItem) {
  return item.tracks
    .filter((t) => t.uri)
    .map((t) => ({
      uri: t.uri!,
      name: t.name,
      artist: t.artist,
      spotifyId: t.spotifyId,
    }));
}

export async function publishQaPlaylists(opts: PublishQaOptions): Promise<PublishQaResult> {
  const { diagnosis, adapter, outDir, dryRun, force } = opts;
  const registryPath = join(outDir, "playlist-registry.json");
  const registry = await loadQaRegistry(registryPath, diagnosis.benchmarkRunId);
  const shortlist = diagnosis.shortlist.slice(0, opts.limit ?? diagnosis.shortlist.length);
  const failuresPath = join(outDir, "failed-spotify-adds.jsonl");
  const failureLines: string[] = [];

  let created = 0;
  let reused = 0;
  let skippedEmpty = 0;
  let failed = 0;
  let addFailureCount = 0;

  for (const item of shortlist) {
    const existing = findRegistryEntry(registry, item.requestId);
    if (existing?.spotifyPlaylistId && !force && existing.status !== "failed" && existing.status !== "deleted") {
      reused += 1;
      upsertRegistryEntry(registry, {
        ...existing,
        automatedVerdict: item.bucket,
        whySelected: item.whySelected,
        humanQuestion: item.humanQuestion,
      });
      continue;
    }

    if (item.uris.length === 0) {
      skippedEmpty += 1;
      upsertRegistryEntry(registry, {
        benchmarkRunId: diagnosis.benchmarkRunId,
        requestId: item.requestId,
        promptId: item.promptId,
        prompt: item.prompt,
        category: item.category,
        generationCommit: opts.commit ?? null,
        engine: "V55",
        automatedVerdict: item.bucket,
        whySelected: item.whySelected,
        humanQuestion: item.humanQuestion,
        spotifyPlaylistId: null,
        spotifyUrl: null,
        spotifyUri: null,
        createdAt: new Date().toISOString(),
        status: "skipped_empty",
        tracksRequested: 0,
        tracksAdded: 0,
        addFailures: [],
        humanReviewStatus: "pending",
      });
      continue;
    }

    if (dryRun) {
      upsertRegistryEntry(registry, {
        benchmarkRunId: diagnosis.benchmarkRunId,
        requestId: item.requestId,
        promptId: item.promptId,
        prompt: item.prompt,
        category: item.category,
        generationCommit: opts.commit ?? null,
        engine: "V55",
        automatedVerdict: item.bucket,
        whySelected: item.whySelected,
        humanQuestion: item.humanQuestion,
        spotifyPlaylistId: null,
        spotifyUrl: null,
        spotifyUri: null,
        createdAt: new Date().toISOString(),
        status: "dry_run",
        tracksRequested: item.uris.length,
        tracksAdded: 0,
        addFailures: [],
        humanReviewStatus: "pending",
      });
      continue;
    }

    try {
      const result = await adapter.createPrivatePlaylist({
        name: qaPlaylistName(item),
        description: qaPlaylistDescription(item, opts.commit ?? null),
        uris: item.uris,
        trackMeta: trackMeta(item),
      });
      addFailureCount += result.failures.length;
      for (const f of result.failures) {
        failureLines.push(JSON.stringify({
          class: "SPOTIFY_QA_ADD_FAILURE",
          benchmarkRunId: diagnosis.benchmarkRunId,
          requestId: item.requestId,
          ...f,
        }));
      }
      const status = result.failures.length ? "partial" : "created";
      if (status === "created") created += 1;
      else created += 1;
      upsertRegistryEntry(registry, {
        benchmarkRunId: diagnosis.benchmarkRunId,
        requestId: item.requestId,
        promptId: item.promptId,
        prompt: item.prompt,
        category: item.category,
        generationCommit: opts.commit ?? null,
        engine: "V55",
        automatedVerdict: item.bucket,
        whySelected: item.whySelected,
        humanQuestion: item.humanQuestion,
        spotifyPlaylistId: result.playlistId,
        spotifyUrl: result.url,
        spotifyUri: result.uri,
        createdAt: new Date().toISOString(),
        status,
        tracksRequested: result.tracksRequested,
        tracksAdded: result.tracksAdded,
        addFailures: result.failures,
        humanReviewStatus: "pending",
      });
    } catch (err: unknown) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      upsertRegistryEntry(registry, {
        benchmarkRunId: diagnosis.benchmarkRunId,
        requestId: item.requestId,
        promptId: item.promptId,
        prompt: item.prompt,
        category: item.category,
        generationCommit: opts.commit ?? null,
        engine: "V55",
        automatedVerdict: item.bucket,
        whySelected: item.whySelected,
        humanQuestion: item.humanQuestion,
        spotifyPlaylistId: null,
        spotifyUrl: null,
        spotifyUri: null,
        createdAt: new Date().toISOString(),
        status: "failed",
        tracksRequested: item.uris.length,
        tracksAdded: 0,
        addFailures: [{ uri: "", reason: message }],
        humanReviewStatus: "pending",
      });
    }
  }

  await mkdir(outDir, { recursive: true });
  await saveQaRegistry(registryPath, registry);
  if (failureLines.length) {
    await writeFile(failuresPath, `${failureLines.join("\n")}\n`);
  } else {
    await writeFile(failuresPath, "");
  }

  return {
    registry,
    created: dryRun ? 0 : created,
    reused,
    skippedEmpty,
    failed,
    dryRun,
    addFailureCount,
  };
}

export async function cleanupQaPlaylists(adapter: SpotifyQaAdapter, registry: QaPlaylistRegistry): Promise<number> {
  let n = 0;
  for (const row of registry.playlists) {
    if (!row.spotifyPlaylistId || row.status === "deleted") continue;
    await adapter.unfollowPlaylist(row.spotifyPlaylistId);
    row.status = "deleted";
    n += 1;
  }
  return n;
}

export function formatQaReportMarkdown(input: {
  diagnosis: ForensicDiagnosis;
  registry: QaPlaylistRegistry;
  publish: PublishQaResult;
  investigationMd?: string;
}): string {
  const { diagnosis, registry, publish } = input;
  const byId = new Map(diagnosis.playlists.map((p) => [p.requestId, p]));
  const likelyBad = diagnosis.totals.CLEARLY_BAD + diagnosis.totals.PROBABLY_BAD;
  const technical = diagnosis.totals.TECHNICAL_FAILURE;
  const valid = diagnosis.playlists.length - technical;
  const lines: string[] = [];
  if (input.investigationMd) {
    lines.push(input.investigationMd.trim(), "", "---", "");
  }
  lines.push(
    "# Kwalify Human QA",
    "",
    `Benchmark: ${diagnosis.benchmarkRunId}`,
    `Engine: V55 (frozen)`,
    "",
    "> Automation can screen. Humans verify. Nothing here is human-confirmed until a review is filled in.",
    "",
    "## Summary",
    "",
    `- Generations analysed: ${diagnosis.playlists.length}`,
    `- Technically valid (not refuse/timeout/empty): ${valid}`,
    `- Likely quality problems (CLEARLY/PROBABLY BAD): ${likelyBad}`,
    `- Technical failures: ${technical}`,
    `- Spotify QA created this run: ${publish.created}`,
    `- Reused existing: ${publish.reused}`,
    `- Skipped empty: ${publish.skippedEmpty}`,
    `- Create failures: ${publish.failed}`,
    `- Dry-run: ${publish.dryRun}`,
    "",
    "## Dominant failure classes (automated hypothesis)",
    "",
  );
  for (const f of diagnosis.failureRank.slice(0, 6)) {
    lines.push(`- ${f.class} (${f.count}) — ${f.observed}`);
  }
  lines.push("", "## Spotify QA playlists", "");

  const listen = registry.playlists.filter((p) => p.status !== "deleted");
  listen.forEach((row, i) => {
    const forensic = byId.get(row.requestId);
    const screen = forensic
      ? screenPlaylist(forensic, true)
      : null;
    const emoji =
      row.automatedVerdict === "CLEARLY_BAD" || row.automatedVerdict === "PROBABLY_BAD"
        ? "🔴"
        : row.automatedVerdict === "TECHNICAL_FAILURE"
          ? "⚫"
          : row.automatedVerdict === "CLEARLY_GOOD" || row.automatedVerdict === "PROBABLY_GOOD"
            ? "🟢"
            : "🟡";
    lines.push(`## ${i + 1}. ${row.prompt}`);
    lines.push("");
    if (row.spotifyUrl) lines.push(`Spotify QA playlist: ${row.spotifyUrl}`);
    else if (row.status === "skipped_empty") lines.push("Spotify QA playlist: _(none — empty/refused generation)_");
    else if (row.status === "dry_run") lines.push(`Would create: \`${qaPlaylistName({
      requestId: row.requestId,
      prompt: row.prompt,
      promptId: row.promptId,
      category: row.category,
      delivered: row.tracksRequested,
      requested: 25,
      bucket: row.automatedVerdict as HumanValidationItem["bucket"],
      automatedVerdict: row.automatedVerdict,
      whySelected: row.whySelected,
      humanQuestion: row.humanQuestion,
      tracks: [],
      uris: [],
      failureClasses: [],
    })}\``);
    else lines.push(`Spotify status: ${row.status}`);
    lines.push("");
    lines.push(`Automated: ${emoji} ${row.automatedVerdict} _(likely — not human-verified)_`);
    if (screen) lines.push(`Confidence: ${screen.confidence}`);
    if (forensic?.library) {
      lines.push(`Library opportunity: ${forensic.library.opportunity} (${forensic.library.strongRelevantCount} strong / ${forensic.library.librarySize} likes)`);
      lines.push(`Library utilisation: ${forensic.library.utilisation}`);
      lines.push(`Fill: ${forensic.delivered}/${forensic.requested} (${forensic.fillSeverity})`);
      lines.push(`Response quality hypothesis: ${forensic.responseQuality}`);
    }
    lines.push(`Why selected: ${row.whySelected}`);
    lines.push(`Human question: ${row.humanQuestion}`);
    if (row.addFailures.length) {
      lines.push(`Add failures: ${row.addFailures.length}`);
    }
    lines.push("");
    lines.push("Human review:");
    lines.push("");
    lines.push("[ ] YES — genuinely good");
    lines.push("[ ] MAYBE — mixed");
    lines.push("[ ] NO — bad");
    lines.push("");
    lines.push("Optional tags: actually good despite automation / bad despite automation / prompt understood but not my taste / prompt misunderstood / too short / wrong genre / wrong mood / wrong era / too repetitive / would not save");
    lines.push("");
    lines.push(`Fill: \`human-review/${row.requestId}.review.json\``);
    lines.push("");
  });

  lines.push(
    "## NEXT INVESTIGATION",
    "",
    diagnosis.recommendedNextAction,
    "",
    "Labels: OBSERVED (benchmark) · AUTOMATED HYPOTHESIS (forensic) · HUMAN-CONFIRMED (only after reviews).",
    "",
  );
  return lines.join("\n");
}

export function qaReviewTemplate(row: QaPlaylistRecord): Record<string, unknown> {
  return {
    requestId: row.requestId,
    prompt: row.prompt,
    spotifyUrl: row.spotifyUrl,
    automatedVerdict: row.automatedVerdict,
    whySelected: row.whySelected,
    humanQuestion: row.humanQuestion,
    verdict: null,
    tags: [],
    wouldPressPlay: null,
    soundsLikePrompt: null,
    wouldKeepListening: null,
    wouldSave: null,
    biggestProblem: "",
    biggestStrength: "",
    opinion: "",
    reviewedAt: null,
  };
}

export async function writeQaReviewTemplates(outDir: string, registry: QaPlaylistRegistry): Promise<void> {
  const dir = join(outDir, "human-review");
  await mkdir(dir, { recursive: true });
  for (const row of registry.playlists) {
    if (row.status === "deleted") continue;
    const path = join(dir, `${row.requestId}.review.json`);
    try {
      const existing = JSON.parse(await readFile(path, "utf8"));
      if (existing.verdict) continue;
    } catch {
      /* write fresh */
    }
    await writeFile(path, `${JSON.stringify(qaReviewTemplate(row), null, 2)}\n`);
  }
}

export async function loadFilledQaReviews(outDir: string): Promise<Array<Record<string, unknown>>> {
  const dir = join(outDir, "human-review");
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".review.json"));
    const out: Array<Record<string, unknown>> = [];
    for (const f of files) {
      const raw = JSON.parse(await readFile(join(dir, f), "utf8"));
      if (raw.verdict || raw.wouldSave) out.push(raw);
    }
    return out;
  } catch {
    return [];
  }
}

export function formatHumanCalibration(reviews: Array<Record<string, unknown>>, registry: QaPlaylistRegistry): string {
  if (reviews.length === 0) {
    return "No human reviews yet. Fill human-review/*.review.json after listening.\n";
  }
  const byId = new Map(registry.playlists.map((p) => [p.requestId, p]));
  const lines = ["# Human vs automation", ""];
  let fp = 0;
  let fn = 0;
  let tp = 0;
  let tn = 0;
  let uncertain = 0;
  for (const r of reviews) {
    const id = String(r.requestId);
    const auto = byId.get(id);
    const autoGood = auto?.automatedVerdict === "CLEARLY_GOOD" || auto?.automatedVerdict === "PROBABLY_GOOD";
    const autoBad = auto?.automatedVerdict === "CLEARLY_BAD" || auto?.automatedVerdict === "PROBABLY_BAD";
    const humanYes = r.verdict === "YES";
    const humanNo = r.verdict === "NO";
    const autoMixed = auto?.automatedVerdict === "MIXED" || auto?.automatedVerdict === "INSUFFICIENT_EVIDENCE";
    const tags = Array.isArray(r.tags) ? r.tags.map(String) : [];
    const underfilledYes = humanYes && tags.some((t) => /too short/i.test(t));
    let tag = "AUTOMATION UNCERTAIN";
    if (autoGood && humanNo) {
      tag = "FALSE POSITIVE / AUTOMATED_BLIND_SPOT";
      fp += 1;
    } else if (autoBad && humanYes) {
      tag = "FALSE NEGATIVE / AUTOMATED_FALSE_ALARM";
      fn += 1;
    } else if (autoBad && humanNo) {
      tag = "TRUE NEGATIVE";
      tn += 1;
    } else if (autoGood && humanYes && !underfilledYes) {
      tag = "TRUE POSITIVE";
      tp += 1;
    } else if (autoMixed && underfilledYes) {
      tag = "DIMENSIONAL_AGREEMENT — world/music YES, adequacy underfill";
      uncertain += 1;
    } else if (autoGood && underfilledYes) {
      tag = "PARTIAL — human likes tracks but confirms underfill";
      uncertain += 1;
    } else if (autoMixed && humanNo) {
      tag = "DIRECTIONAL_AGREEMENT — auto MIXED / human NO";
      tn += 1;
    } else {
      uncertain += 1;
    }
    lines.push(`- \`${id}\` (${auto?.prompt}): ${tag} — auto ${auto?.automatedVerdict}; human ${r.verdict}`);
  }
  lines.push("", `TP ${tp} / TN ${tn} / FP ${fp} / FN ${fn} / uncertain ${uncertain}`, "");
  return lines.join("\n");
}
