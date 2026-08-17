/**
 * Markdown diagnosis report from forensic analysis.
 */

import type { ForensicDiagnosis, ForensicPlaylist, HumanValidationItem } from "./forensic-analysis";

function dimLine(p: ForensicPlaylist): string {
  return Object.entries(p.dimensions)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

export function formatLightweightReviewMarkdown(item: HumanValidationItem): string {
  const lines = [
    "# Human validation (lightweight)",
    "",
    `Request ID: ${item.requestId}`,
    `Prompt: ${item.prompt}`,
    `Category: ${item.category}`,
    `Tracks: ${item.delivered}/${item.requested}`,
    `Automated verdict: ${item.automatedVerdict}`,
    "",
    `**Why this was selected:** ${item.whySelected}`,
    "",
    `**What listening is testing:** ${item.humanQuestion}`,
    "",
    "> These are generated tracklists, not Spotify playlists. Use the URI file to queue them.",
    "",
    "## Tracklist",
    "",
  ];
  for (const t of item.tracks) {
    const year = t.releaseYear ? ` (${t.releaseYear})` : "";
    const uri = t.uri ? ` \`${t.uri}\`` : "";
    lines.push(`${t.position}. ${t.artist} — ${t.name}${year}${uri}`);
  }
  if (item.tracks.length === 0) lines.push("_No tracks (refused / empty)._");
  lines.push(
    "",
    "## Your answers",
    "",
    "1. Would I press play?  YES / MAYBE / NO",
    "2. Does it immediately sound like the requested prompt?  YES / PARTLY / NO",
    "3. Would I keep listening?  YES / MAYBE / NO",
    "4. Would I save it?  YES / MAYBE / NO",
    "5. Biggest problem?",
    "6. Biggest strength?",
    "7. Optional free-text:",
    "",
    "Fill the sibling `.review.json` (same answers). Do not create Spotify playlists unless you opt in locally.",
    "",
  );
  return lines.join("\n");
}

export function lightweightReviewJson(item: HumanValidationItem): Record<string, unknown> {
  return {
    requestId: item.requestId,
    prompt: item.prompt,
    promptId: item.promptId,
    category: item.category,
    automatedVerdict: item.automatedVerdict,
    whySelected: item.whySelected,
    humanQuestion: item.humanQuestion,
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

export function formatDiagnosisMarkdown(d: ForensicDiagnosis): string {
  const lines: string[] = [
    "# HUMAN-CENTRIC BENCHMARK DIAGNOSIS",
    "",
    `Benchmark run: ${d.benchmarkRunId}`,
    `Requested length: ${d.requestedLength}`,
    `Generated: ${d.generatedAt}`,
    "",
    "> Automated buckets are **likely** labels, not human confirmation.",
    "> Tracklists exist in the benchmark JSONL. They are **not** Spotify playlists.",
    "",
    "## Executive summary",
    "",
    "### What is actually working?",
    ...d.working.map((x) => `- ${x}`),
    "",
    "### What is actually broken?",
    ...d.broken.map((x) => `- ${x}`),
    "",
    "## Classification (100 runs, forensic not HCS)",
    "",
    `- CLEARLY GOOD (likely): ${d.totals.CLEARLY_GOOD}`,
    `- PROBABLY GOOD (likely): ${d.totals.PROBABLY_GOOD}`,
    `- MIXED: ${d.totals.MIXED}`,
    `- PROBABLY BAD: ${d.totals.PROBABLY_BAD}`,
    `- CLEARLY BAD: ${d.totals.CLEARLY_BAD}`,
    `- TECHNICAL FAILURE (refuse/empty/timeout): ${d.totals.TECHNICAL_FAILURE}`,
    `- INSUFFICIENT EVIDENCE: ${d.totals.INSUFFICIENT_EVIDENCE}`,
    "",
    "## Delivery vs requested 25",
    "",
    `- full (25): ${d.delivery.full}`,
    `- partial (<25): ${d.delivery.partial}`,
    `- refused (422): ${d.delivery.refused}`,
    `- empty: ${d.delivery.empty}`,
    `- timeout fallback: ${d.delivery.timeout_fallback}`,
    `- technical failure: ${d.delivery.technical_failure}`,
    "",
    "## Underfill vs library opportunity (automated hypothesis)",
    "",
    "| Fill × opportunity | Count | Reading |",
    "|---|---|---|",
  ];

  const matrix = new Map<string, number>();
  for (const p of d.playlists) {
    const opp = p.library?.opportunity ?? "UNKNOWN";
    const key = `${p.fillSeverity} × ${opp}`;
    matrix.set(key, (matrix.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...matrix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const suspicious = /partial|severely/.test(key) && /HIGH|VERY_HIGH/.test(key);
    const understandable = /partial|severely|empty|refused/.test(key) && /LOW|VERY_LOW/.test(key);
    const reading = suspicious
      ? "suspicious — candidate/admission until disproven"
      : understandable
        ? "potentially valid scarcity"
        : "see playlist rows";
    lines.push(`| ${key} | ${count} | ${reading} |`);
  }

  lines.push(
    "",
    "Do not assume sparse library when opportunity is UNKNOWN or HIGH.",
    "",
    "## Top repeated failure classes",
    "",
  );

    for (const f of d.failureRank.slice(0, 8)) {
    lines.push(
      `### ${f.class} (${f.count}, severity ${f.severity})`,
      "",
      `- Observed: ${f.observed}`,
      `- Likely root cause (hypothesis): ${f.likelyRootCause}`,
      `- Alternatives: ${f.alternatives.join("; ")}`,
      `- Evidence required: ${f.evidenceRequired}`,
      `- Subsystem: ${f.subsystem}`,
      `- Examples: ${f.exampleRequestIds.join(", ")}`,
      "",
    );
  }

  const incomplete = d.playlists.filter((p) => p.traceIncomplete).length;
  const completeFunnel = d.playlists.filter((p) => p.candidateFunnel?.completeness === "complete").length;
  lines.push(
    "## Candidate funnel (observational)",
    "",
    `- Complete ` + "`candidateFunnel`" + `: ${completeFunnel}/${d.playlists.length}`,
    `- Incomplete traces: ${incomplete}/${d.playlists.length}`,
    "",
    "Unknown counts are not zeros. Do not infer retrieved=0 from a skipped playlistExecutionTrace.",
    "",
  );
  const diagnosticTrio = d.playlists.filter((p) =>
    /indie rock|2000s indie|90s alternative/i.test(p.prompt),
  );
  if (diagnosticTrio.length > 0) {
    lines.push(
      "### Diagnostic trio drop stages",
      "",
      "Library-wide `afterWorldFilter` is **not** retrieval-pool world admission. Use `worldFilterDropped` and `v3PreFilter`.",
      "",
      "| Prompt | Delivered | Scoring pool | World filter dropped | V3 prefilter | Composed | Post-terminal | Artist-cap | Refill added | Drop stage | Completeness |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const p of diagnosticTrio) {
      const f = p.candidateFunnel;
      const cell = (count: { value: number | null; status: string } | undefined) =>
        !count || count.status !== "actual" ? count?.status ?? "missing" : String(count.value);
      const scoringPool = f?.scoringPool?.status === "actual" ? f.scoringPool : f?.retrieved;
      lines.push(
        `| ${p.prompt} | ${p.delivered}/${p.requested} | ${cell(scoringPool)} | ${cell(f?.worldFilterDropped)} | ${cell(f?.v3PreFilter)} | ${cell(f?.compositionCandidates)} | ${cell(f?.postTerminal)} | ${cell(f?.artistCapRemovals)} | ${cell(f?.refillAdded)} | ${p.dropStage?.primary ?? "n/a"} | ${f?.completeness ?? "missing"} |`,
      );
    }
    lines.push("");
  }

  if (incomplete > 0 && completeFunnel === 0) {
    lines.push(
      "INCOMPLETE_TRACE on these payloads: retrieval/world/sampler stages are skipped and/or candidateFunnel is missing. Gate-failure-still-ships cannot be fully proven until a new instrumented run.",
      "",
    );
  }

  lines.push(
    "## Detected default-library cluster (automatic frequency, not a denylist)",
    "",
    "A track can be excellent for one prompt and wrong for another. Flag is contextual.",
    "",
  );
  for (const c of d.defaultCluster.slice(0, 12)) {
    lines.push(`- ${c.artist} — ${c.name} (${c.playlistCount} playlists, ${c.categoryCount} categories: ${c.categories.join(", ")})`);
  }

  lines.push("", "## Human-validation shortlist", "", "Listen to **these tracklists only**. Not Spotify playlists.", "");
  d.shortlist.forEach((item, i) => {
    lines.push(
      `### ${i + 1}. ${item.prompt}`,
      "",
      `- Request ID: \`${item.requestId}\``,
      `- Category: ${item.category} | ${item.delivered}/${item.requested} tracks | ${item.bucket}`,
      `- Response quality: ${item.responseQuality ?? "n/a"}`,
      `- Library: opportunity ${item.libraryOpportunity ?? "UNKNOWN"} / utilisation ${item.libraryUtilisation ?? "UNKNOWN"}`,
      `- Automated: ${item.automatedVerdict}`,
      `- Why selected: ${item.whySelected}`,
      `- Listening tests: ${item.humanQuestion}`,
      `- URI file: \`human-validation/uris/${item.requestId}.txt\``,
      "",
    );
    for (const t of item.tracks.slice(0, 8)) {
      lines.push(`  ${t.position}. ${t.artist} — ${t.name}${t.releaseYear ? ` (${t.releaseYear})` : ""}`);
    }
    if (item.tracks.length > 8) lines.push(`  … +${item.tracks.length - 8} more`);
    if (item.tracks.length === 0) lines.push("  _(empty / refused)_");
    lines.push("");
  });

  lines.push(
    "## Evaluator calibration (pre-human)",
    "",
    "No human reviews in this run. Hypotheses from metadata:",
    "",
    "- HCS is **unreliable for world fidelity**: it scores 80–91 on 80s synthpop, 90s alt, and Bristol trip-hop that contain none of the requested world.",
    "- Independent verifier **misses** shoegaze→classic rock and britpop→emo, and **over-fires** misfits on cozy/coffee acoustics.",
    "- Previous underfill measurement was wrong (requested was set to delivered).",
    "",
    "After you fill the shortlist `.review.json` files, rerun diagnose to compare human vs automated.",
    "",
    "## Root-cause hypotheses",
    "",
    "See failure classes above. Strongest hypothesis:",
    "",
    "> Failed world-gate runs still ship a default library cluster, while gym/drive sometimes refuse. Inconsistent post-gate policy, not 'need stronger HCS'.",
    "",
    "## Recommended next engineering investigation",
    "",
    d.recommendedNextAction,
    "",
    "## Do not build",
    "",
    ...d.doNotBuild.map((x) => `- ${x}`),
    "",
    "## How to listen without reconstructing playlists",
    "",
    "1. Open `human-validation/<requestId>.md`",
    "2. Open `human-validation/uris/<requestId>.txt` — one `spotify:track:` URI per line",
    "3. Queue those URIs in Spotify (desktop accepts `spotify:track:` links)",
    "4. Fill `human-validation/<requestId>.review.json`",
    "",
    "Do **not** expect these to already exist as Spotify playlists. The 100-run used audit mode.",
    "",
    "## Per-generation forensic table",
    "",
    "| # | prompt | n/25 | delivery | bucket | HCS | ver | failures | request ID |",
    "|---|---|---|---|---|---|---|---|---|",
  );

  d.playlists.forEach((p, i) => {
    const fails = p.failureClasses
      .map((f) => f.class)
      .filter((c) => c !== "INCOMPLETE_TRACE" && c !== "REPLAY_LOW_VARIATION")
      .slice(0, 3)
      .join(",");
    lines.push(
      `| ${i + 1} | ${p.prompt.replace(/\|/g, "/")} | ${p.delivered}/${p.requested} | ${p.delivery} | ${p.bucket} | ${p.hcsScore ?? ""} | ${p.verifierVerdict ?? ""} | ${fails} | \`${p.requestId}\` |`,
    );
  });

  lines.push("", "<details><summary>Dimension evidence (first 15)</summary>", "");
  for (const p of d.playlists.slice(0, 15)) {
    lines.push(`**${p.prompt}** (\`${p.requestId}\`)`, "", dimLine(p), "", p.bucketWhy, "");
  }
  lines.push("</details>", "");
  return lines.join("\n");
}

export function compareHumanReviews(
  diagnosis: ForensicDiagnosis,
  reviews: Array<Record<string, unknown>>,
): string {
  const byId = new Map(reviews.map((r) => [String(r.requestId), r]));
  const lines = ["# Human vs automation (shortlist only)", ""];
  let fp = 0;
  let fn = 0;
  let tp = 0;
  let tn = 0;
  for (const item of diagnosis.shortlist) {
    const r = byId.get(item.requestId);
    if (!r || r.wouldSave == null && r.soundsLikePrompt == null) {
      lines.push(`- \`${item.requestId}\`: no human review yet`);
      continue;
    }
    const autoGood = item.bucket === "CLEARLY_GOOD" || item.bucket === "PROBABLY_GOOD";
    const humanGood = r.wouldSave === "YES" || r.soundsLikePrompt === "YES";
    const humanBad = r.wouldSave === "NO" || r.soundsLikePrompt === "NO";
    let tag = "mixed";
    if (autoGood && humanBad) {
      tag = "FALSE POSITIVE";
      fp += 1;
    } else if (!autoGood && humanGood) {
      tag = "FALSE NEGATIVE";
      fn += 1;
    } else if (!autoGood && humanBad) {
      tag = "TRUE NEGATIVE";
      tn += 1;
    } else if (autoGood && humanGood) {
      tag = "TRUE POSITIVE";
      tp += 1;
    }
    lines.push(`- \`${item.requestId}\` (${item.prompt}): ${tag} — auto ${item.bucket}; human save=${r.wouldSave} prompt=${r.soundsLikePrompt}`);
  }
  lines.push("", `FP ${fp} / FN ${fn} / TP ${tp} / TN ${tn}`, "");
  return lines.join("\n");
}
