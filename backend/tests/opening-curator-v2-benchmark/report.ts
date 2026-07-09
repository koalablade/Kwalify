/**
 * Opening Curator v2 benchmark report — weaknesses, failure causes, ROI fixes.
 */

import type {
  CategoryRollup,
  FailureCause,
  OpeningCuratorV2BenchmarkCategory,
  OpeningCuratorV2BenchmarkReport,
  OpeningCuratorV2PromptResult,
} from "./types";
import { formatFirstFiveLines } from "./analyzer";

const CATEGORIES: OpeningCuratorV2BenchmarkCategory[] = [
  "easy_mood",
  "emotional_specific",
  "functional",
  "library_gravity",
  "human_curator",
  "adversarial",
];

function rate(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

function mean(nums: Array<number | null | undefined>): number | null {
  const vals = nums.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function pct(v: number | null): string {
  return v == null ? "n/a" : `${(v * 100).toFixed(0)}%`;
}

function score(v: number | null, digits = 2): string {
  return v == null ? "n/a" : v.toFixed(digits);
}

function buildCategoryRollup(rows: OpeningCuratorV2PromptResult[]): CategoryRollup {
  const causeCounts = new Map<FailureCause, number>();
  for (const row of rows) {
    if (row.analysis.failureCause === "none") continue;
    causeCounts.set(row.analysis.failureCause, (causeCounts.get(row.analysis.failureCause) ?? 0) + 1);
  }
  const topFailureCauses = [...causeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cause]) => cause);

  const prefRows = rows.filter((r) => r.humanPreferenceProxy != null);
  const humanWins = prefRows.filter((r) => r.humanPreferenceProxy === "human").length;

  return {
    count: rows.length,
    feelsHumanRate: rate(rows.filter((r) => r.feelsHumanFirstFive).length, rows.length),
    openingPassRate: rate(rows.filter((r) => r.openingPass).length, rows.filter((r) => r.generationSuccess).length),
    avgReplayProxy: mean(rows.map((r) => r.replaySimulation?.replayProxyScore)),
    avgSkipRisk: mean(rows.map((r) => r.replaySimulation?.skipRiskScore)),
    avgSaveProxy: mean(rows.map((r) => r.replaySimulation?.saveProxyScore)),
    humanPreferenceWinRate: rate(humanWins, prefRows.length),
    topFailureCauses,
  };
}

function rankWeaknesses(
  byCategory: Record<OpeningCuratorV2BenchmarkCategory, CategoryRollup>,
  failureCauseCounts: Record<FailureCause, number>,
  results: OpeningCuratorV2PromptResult[],
): string[] {
  const weaknesses: string[] = [];

  const functional = byCategory.functional;
  if ((functional.feelsHumanRate ?? 1) < 0.6) {
    weaknesses.push(
      `Functional prompts (focus/gym/party/cleaning) — only ${pct(functional.feelsHumanRate)} feel human on first five; activity identity still breaks trust.`,
    );
  }

  const gravity = byCategory.library_gravity;
  if ((gravity.feelsHumanRate ?? 1) < 0.5) {
    weaknesses.push(
      `Library gravity — ${pct(gravity.feelsHumanRate)} human feel when library taste fights prompt; favorites win over moment.`,
    );
  }

  const human = byCategory.human_curator;
  if ((human.humanPreferenceWinRate ?? 0) < 0.5) {
    weaknesses.push(
      `Human curator scenarios — blind preference still favors reference ${pct(human.humanPreferenceWinRate)} of the time; track 1 rarely earns "yes, exactly".`,
    );
  }

  const emotional = byCategory.emotional_specific;
  if ((emotional.feelsHumanRate ?? 1) < 0.7) {
    weaknesses.push(
      `Emotional specificity — ${pct(emotional.feelsHumanRate)} human feel; generic sad/uplift pools replace situational curation.`,
    );
  }

  if ((failureCauseCounts.retrieval ?? 0) >= 3) {
    weaknesses.push("Retrieval pool often lacks activity-fit openers — opening curator cannot fix empty wrong lanes.");
  }
  if ((failureCauseCounts.library ?? 0) >= 2) {
    weaknesses.push("Library limitations and gravity dominate failures — system picks liked songs over right songs.");
  }
  if ((failureCauseCounts.prompt_understanding ?? 0) >= 3) {
    weaknesses.push("Prompt understanding gaps on scene/feeling/adversarial prompts — narrative beats music.");
  }

  const fails = results.filter((r) => !r.feelsHumanFirstFive && r.generationSuccess);
  const worst = fails
    .sort((a, b) => (a.replaySimulation?.replayProxyScore ?? 0) - (b.replaySimulation?.replayProxyScore ?? 0))
    .slice(0, 3);
  for (const row of worst) {
    weaknesses.push(`"${row.prompt}" — ${row.analysis.whySummary}`);
  }

  return weaknesses.slice(0, 8);
}

function topRoiFixes(
  byCategory: Record<OpeningCuratorV2BenchmarkCategory, CategoryRollup>,
  failureCauseCounts: Record<FailureCause, number>,
): string[] {
  const fixes: string[] = [];

  if ((byCategory.functional.feelsHumanRate ?? 1) < 0.75) {
    fixes.push("Rediscovery + activity-aware opener election: pull drive/focus tracks user forgot, not just top library scores.");
  }
  if ((failureCauseCounts.library ?? 0) >= 2) {
    fixes.push("Honest library-insufficient + discovery mode for gravity conflicts — stop forcing bad liked-song openers.");
  }
  if ((byCategory.human_curator.humanPreferenceWinRate ?? 0) < 0.55) {
    fixes.push("Sonic taste profile for opener tie-breaks — production/vocal/emotion traits from liked songs, not genre labels.");
  }
  if ((failureCauseCounts.retrieval ?? 0) >= 2) {
    fixes.push("Widen activity-fit candidate lanes before selection — opening curator can only reorder what retrieval delivers.");
  }
  fixes.push("Real behaviour events (save, skip-first-three, 30s listen) to calibrate replay proxy against truth.");

  return [...new Set(fixes)].slice(0, 5);
}

export function buildOpeningCuratorV2Report(
  results: OpeningCuratorV2PromptResult[],
  mode: "live" | "offline",
): OpeningCuratorV2BenchmarkReport {
  const byCategory = {} as Record<OpeningCuratorV2BenchmarkCategory, CategoryRollup>;
  for (const cat of CATEGORIES) {
    byCategory[cat] = buildCategoryRollup(results.filter((r) => r.category === cat));
  }

  const failureCauseCounts = {
    retrieval: 0,
    scoring: 0,
    sequencing: 0,
    library: 0,
    prompt_understanding: 0,
    generation_failure: 0,
    none: 0,
  } as Record<FailureCause, number>;
  for (const row of results) {
    failureCauseCounts[row.analysis.failureCause] += 1;
  }

  const prefRows = results.filter((r) => r.humanPreferenceProxy != null);
  const humanWins = prefRows.filter((r) => r.humanPreferenceProxy === "human").length;

  const rankedWeaknesses = rankWeaknesses(byCategory, failureCauseCounts, results);
  const topRoiFixesList = topRoiFixes(byCategory, failureCauseCounts);

  const feelsHumanFirstFiveRate = rate(
    results.filter((r) => r.feelsHumanFirstFive).length,
    results.filter((r) => r.generationSuccess).length,
  );

  const markdown = formatReportMarkdown({
    mode,
    results,
    byCategory,
    failureCauseCounts,
    feelsHumanFirstFiveRate,
    openingPassRate: rate(
      results.filter((r) => r.openingPass).length,
      results.filter((r) => r.generationSuccess).length,
    ),
    avgReplayProxyScore: mean(results.map((r) => r.replaySimulation?.replayProxyScore)),
    avgSkipRiskScore: mean(results.map((r) => r.replaySimulation?.skipRiskScore)),
    avgSaveProxyScore: mean(results.map((r) => r.replaySimulation?.saveProxyScore)),
    humanPreferenceWinRate: rate(humanWins, prefRows.length),
    rankedWeaknesses,
    topRoiFixes: topRoiFixesList,
  });

  return {
    generatedAt: new Date().toISOString(),
    mode,
    promptCount: results.length,
    feelsHumanFirstFiveRate,
    openingPassRate: rate(
      results.filter((r) => r.openingPass).length,
      results.filter((r) => r.generationSuccess).length,
    ),
    avgReplayProxyScore: mean(results.map((r) => r.replaySimulation?.replayProxyScore)),
    avgSkipRiskScore: mean(results.map((r) => r.replaySimulation?.skipRiskScore)),
    avgSaveProxyScore: mean(results.map((r) => r.replaySimulation?.saveProxyScore)),
    humanPreferenceWinRate: rate(humanWins, prefRows.length),
    byCategory,
    failureCauseCounts,
    rankedWeaknesses,
    topRoiFixes: topRoiFixesList,
    results,
    markdown,
  };
}

function formatReportMarkdown(opts: {
  mode: "live" | "offline";
  results: OpeningCuratorV2PromptResult[];
  byCategory: Record<OpeningCuratorV2BenchmarkCategory, CategoryRollup>;
  failureCauseCounts: Record<FailureCause, number>;
  feelsHumanFirstFiveRate: number | null;
  openingPassRate: number | null;
  avgReplayProxyScore: number | null;
  avgSkipRiskScore: number | null;
  avgSaveProxyScore: number | null;
  humanPreferenceWinRate: number | null;
  rankedWeaknesses: string[];
  topRoiFixes: string[];
}): string {
  const lines: string[] = [
    "# Opening Curator v2 — Human Retention Benchmark",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${opts.mode}${opts.mode === "offline" ? " (reference/negative proxy — run \`--live\` for real generation)" : ""}`,
    "",
    "## Executive answers",
    "",
    `1. **Playlists that feel human on first 5 tracks:** ${pct(opts.feelsHumanFirstFiveRate)}`,
    `2. **Opening pass rate:** ${pct(opts.openingPassRate)}`,
    `3. **Replay proxy / skip risk / save proxy:** ${score(opts.avgReplayProxyScore)} / ${score(opts.avgSkipRiskScore)} / ${score(opts.avgSaveProxyScore)}`,
    `4. **Human preference proxy (Kwalify win rate):** ${pct(opts.humanPreferenceWinRate)}`,
    "",
    "### Failure causes",
    ...Object.entries(opts.failureCauseCounts)
      .filter(([, count]) => count > 0)
      .map(([cause, count]) => `- **${cause}**: ${count}`),
    "",
    "## By category",
    "",
    "| Category | n | Feels human | Opening pass | Replay | Skip risk | Human pref |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...CATEGORIES.map((cat) => {
      const row = opts.byCategory[cat];
      return `| ${cat} | ${row.count} | ${pct(row.feelsHumanRate)} | ${pct(row.openingPassRate)} | ${score(row.avgReplayProxy)} | ${score(row.avgSkipRisk)} | ${pct(row.humanPreferenceWinRate)} |`;
    }),
    "",
    "## Biggest remaining weaknesses",
    "",
    ...opts.rankedWeaknesses.map((w, i) => `${i + 1}. ${w}`),
    "",
    "## Top 5 highest-ROI fixes",
    "",
    ...opts.topRoiFixes.map((f, i) => `${i + 1}. ${f}`),
    "",
    "## Per-prompt analysis (tracks 1–5 focus)",
    "",
  ];

  for (const row of opts.results) {
    lines.push(`### ${row.id}`);
    lines.push(`**Prompt:** ${row.prompt}`);
    lines.push(`**Category:** ${row.category} · expected ${row.expectedBand} · mode ${row.mode}`);
    lines.push(`**Feels human (first 5):** ${row.feelsHumanFirstFive ? "YES" : "NO"} · opening pass: ${row.openingPass ? "PASS" : "FAIL"}`);
    if (row.replaySimulation) {
      lines.push(
        `**Proxies:** replay=${row.replaySimulation.replayProxyScore.toFixed(2)} skip=${row.replaySimulation.skipRiskScore.toFixed(2)} save=${row.replaySimulation.saveProxyScore.toFixed(2)}`,
      );
    }
    if (row.humanPreferenceProxy) {
      lines.push(`**Human preference proxy:** ${row.humanPreferenceProxy}`);
    }
    if (row.retrieval?.strategy) {
      lines.push(
        `**Retrieval:** strategy=${row.retrieval.strategy} librarySufficient=${row.retrieval.librarySufficient} confidence=${row.retrieval.combinedConfidence ?? "n/a"}`,
      );
    }
    if (row.openingCurator?.openerTrackId) {
      lines.push(
        `**Opening curator:** reason=${row.openingCurator.openingReason} swaps=${row.openingCurator.swaps ?? 0} identity=${row.openingCurator.identityStrength ?? "n/a"}`,
      );
    }
    lines.push("**First 5:**");
    for (const line of formatFirstFiveLines(row.firstFive)) {
      lines.push(`- ${line}`);
    }
    lines.push(`**WHY:** ${row.analysis.whySummary}`);
    if (row.analysis.weaknesses.length) {
      lines.push(`**Weaknesses:** ${row.analysis.weaknesses.join("; ")}`);
    }
    lines.push(`**Failure cause:** ${row.analysis.failureCause} — ${row.analysis.failureCauseDetail}`);
    lines.push("");
  }

  return lines.join("\n");
}

export { pct, score };
