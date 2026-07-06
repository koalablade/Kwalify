/**
 * Decompose cumulative V3 multi-candidate loop time into invocation count × cost per call.
 * Used for delivery profiling — distinguishes "too many candidates" vs "each call too slow",
 * and whether candidates after the first genuinely-usable playlist materially improve the winner.
 */

export type V3InvocationTimingRow = {
  label: string;
  ms: number;
  /** Tracks passed into runV3Pipeline() after mergeV3UniverseInput — primary pool-scaling axis. */
  poolSize: number;
  inputPoolSize: number;
  candidatePoolSize: number;
  finalTrackCount: number;
  believabilityScore: number;
  genuinelyUsable: boolean;
  humanSaveable: boolean;
  laneCount: number;
};

export type V3CostDriver = "invocation_count" | "per_invocation_cost" | "mixed" | "unknown";

/** Distinguishes 15×5s (multiplicative) from 1×82s (pathological). */
export type V3InvocationPattern = "multiplicative" | "pathological" | "mixed" | "unknown";

export type V3CandidateTournamentValue = {
  selectedWinnerLabel: string | null;
  /** 1-based index of tournament winner in the candidate loop. */
  winnerCandidateIndex: number | null;
  /** True when candidate #1 won the pairwise tournament. */
  candidate1WinsTournament: boolean;
  firstUsableCandidateIndex: number | null;
  firstUsableCandidateLabel: string | null;
  /** True when the first genuinely-usable candidate was also the tournament winner. */
  firstUsableIsWinner: boolean;
  tournamentWinnerDiffersFromFirstUsable: boolean;
  believabilityAtFirstUsable: number | null;
  believabilityAtCandidate1: number | null;
  believabilityAtWinner: number | null;
  believabilityGainFirstUsableToWinner: number | null;
  believabilityGainCandidate1ToWinner: number | null;
  invocationsAfterFirstUsable: number;
  msAfterFirstUsable: number;
};

export type V3PerCandidateProfile = {
  /** 1-based position in the editorial candidate loop for cross-prompt rollups. */
  candidateIndex: number;
  label: string;
  /** Wall-clock ms for this runV3Pipeline() call. */
  elapsedMs: number;
  ms: number;
  poolSize: number;
  laneCount: number;
  tracksProduced: number;
  usable: boolean;
  winner: boolean;
  believabilityScore: number;
  genuinelyUsable: boolean;
  humanSaveable: boolean;
};

export type CandidatePositionRollupRow = {
  candidateIndex: number;
  promptCount: number;
  medianElapsedMs: number | null;
  maxElapsedMs: number | null;
  medianPoolSize: number | null;
  medianLaneCount: number | null;
  medianTracksProduced: number | null;
  medianBelievabilityScore: number | null;
  usableRate: number;
  winnerRate: number;
};

export type TournamentQualityRollup = {
  promptsWithData: number;
  /** % of prompts where candidate #1 won the pairwise tournament. */
  candidate1WinsRate: number;
  /** % of prompts where first genuinely-usable candidate was the winner. */
  firstUsableIsWinnerRate: number;
  /** % of prompts where winner differed from first usable (quality cost of early stop). */
  winnerDiffersFromFirstUsableRate: number;
  winnerByCandidateIndex: Record<number, number>;
};

/** P1 honest timing bucket — immediately shows which multiplier dominates. */
export type V3PipelineTimingProfile = {
  v3PipelineTotalMs: number;
  invocationCount: number;
  candidateCount: number;
  avgInvocationMs: number | null;
  maxInvocationMs: number | null;
  minInvocationMs: number | null;
  /** Median V3 input pool size across invocations. */
  poolSize: number | null;
  /** Median adaptive lane count across invocations. */
  laneCount: number | null;
  poolSizeAtMaxInvocation: number | null;
  laneCountAtMaxInvocation: number | null;
  /** multiplicative = many similar-cost calls; pathological = one call dominates total. */
  invocationPattern: V3InvocationPattern;
  maxToMedianInvocationRatio: number | null;
};

export type V3InvocationDecomposition = {
  /** Canonical: how many runV3Pipeline() calls completed. */
  v3InvocationCount: number;
  /** Canonical: wall ms per candidate, same order as perCandidate. */
  perCandidateV3Ms: number[];
  /** Canonical: per-candidate ms + poolSize + curator signals for scaling / tournament analysis. */
  perCandidate: V3PerCandidateProfile[];
  /** Whether later candidates beat the first genuinely-usable playlist. */
  candidateTournamentValue: V3CandidateTournamentValue;
  /** P1 canonical timing summary (replaces misleading candidateGeneration bucket). */
  v3PipelineTimingProfile: V3PipelineTimingProfile;
  invocationCount: number;
  plannedCandidateAttemptCount: number;
  executableCandidateAttemptCount: number;
  retrievalSafetyExpanded: boolean;
  totalMs: number;
  perInvocationMs: number[];
  minMsPerInvocation: number | null;
  maxMsPerInvocation: number | null;
  medianMsPerInvocation: number | null;
  avgMsPerInvocation: number | null;
  costDriver: V3CostDriver;
  invocations: V3InvocationTimingRow[];
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function classifyV3CostDriver(
  invocationCount: number,
  avgMsPerInvocation: number | null,
): V3CostDriver {
  if (!invocationCount || avgMsPerInvocation == null || !Number.isFinite(avgMsPerInvocation)) {
    return "unknown";
  }
  if (invocationCount >= 8 && avgMsPerInvocation < 10_000) return "invocation_count";
  if (invocationCount <= 5 && avgMsPerInvocation >= 15_000) return "per_invocation_cost";
  return "mixed";
}

export function classifyV3InvocationPattern(
  invocations: V3InvocationTimingRow[],
  totalMs: number,
): V3InvocationPattern {
  if (invocations.length === 0) return "unknown";
  if (invocations.length === 1) return "pathological";
  const msValues = invocations.map((row) => row.ms);
  const sorted = [...msValues].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1] ?? 0;
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const total = totalMs > 0 ? totalMs : msValues.reduce((sum, ms) => sum + ms, 0);
  if (total > 0 && max / total >= 0.65) return "pathological";
  if (median > 0 && max / median >= 3) return "pathological";
  if (invocations.length >= 3 && median > 0 && max / median <= 1.5) return "multiplicative";
  return "mixed";
}

function buildCandidateTournamentValue(
  invocations: V3InvocationTimingRow[],
  selectedWinnerLabel: string | null,
): V3CandidateTournamentValue {
  const firstUsableIndex = invocations.findIndex((row) => row.genuinelyUsable);
  const firstUsable = firstUsableIndex >= 0 ? invocations[firstUsableIndex]! : null;
  const candidate1 = invocations[0] ?? null;
  const winner = selectedWinnerLabel
    ? invocations.find((row) => row.label === selectedWinnerLabel) ?? null
    : null;
  const winnerCandidateIndex = winner
    ? invocations.findIndex((row) => row.label === winner.label) + 1
    : null;
  const believabilityAtFirstUsable = firstUsable?.believabilityScore ?? null;
  const believabilityAtCandidate1 = candidate1?.believabilityScore ?? null;
  const believabilityAtWinner = winner?.believabilityScore ?? null;
  const believabilityGainFirstUsableToWinner =
    believabilityAtFirstUsable != null && believabilityAtWinner != null
      ? Math.round((believabilityAtWinner - believabilityAtFirstUsable) * 1000) / 1000
      : null;
  const believabilityGainCandidate1ToWinner =
    believabilityAtCandidate1 != null && believabilityAtWinner != null
      ? Math.round((believabilityAtWinner - believabilityAtCandidate1) * 1000) / 1000
      : null;
  const invocationsAfterFirstUsable = firstUsableIndex >= 0
    ? Math.max(0, invocations.length - firstUsableIndex - 1)
    : 0;
  const msAfterFirstUsable = firstUsableIndex >= 0
    ? invocations.slice(firstUsableIndex + 1).reduce((sum, row) => sum + row.ms, 0)
    : 0;
  const firstUsableIsWinner = !!firstUsable && !!winner && winner.label === firstUsable.label;
  return {
    selectedWinnerLabel,
    winnerCandidateIndex: winnerCandidateIndex && winnerCandidateIndex > 0 ? winnerCandidateIndex : null,
    candidate1WinsTournament: !!candidate1 && !!winner && winner.label === candidate1.label,
    firstUsableCandidateIndex: firstUsableIndex >= 0 ? firstUsableIndex + 1 : null,
    firstUsableCandidateLabel: firstUsable?.label ?? null,
    firstUsableIsWinner,
    tournamentWinnerDiffersFromFirstUsable: !!firstUsable && !!winner && winner.label !== firstUsable.label,
    believabilityAtFirstUsable,
    believabilityAtCandidate1,
    believabilityAtWinner,
    believabilityGainFirstUsableToWinner,
    believabilityGainCandidate1ToWinner,
    invocationsAfterFirstUsable,
    msAfterFirstUsable,
  };
}

function buildV3PipelineTimingProfile(
  invocations: V3InvocationTimingRow[],
  totalMs: number,
  candidateCount: number,
): V3PipelineTimingProfile {
  const perInvocationMs = invocations.map((row) => row.ms);
  const sortedMs = [...perInvocationMs].sort((a, b) => a - b);
  const poolSizes = invocations.map((row) => row.poolSize).sort((a, b) => a - b);
  const laneCounts = invocations.map((row) => row.laneCount).sort((a, b) => a - b);
  const invocationCount = invocations.length;
  const maxInvocationMs = sortedMs[sortedMs.length - 1] ?? null;
  const maxIndex = maxInvocationMs != null
    ? perInvocationMs.findIndex((ms) => ms === maxInvocationMs)
    : -1;
  const maxInvocation = maxIndex >= 0 ? invocations[maxIndex]! : null;
  const totalFromRows = perInvocationMs.reduce((sum, ms) => sum + ms, 0);
  const v3PipelineTotalMs = totalMs > 0 ? totalMs : totalFromRows;
  const medianMs = percentile(sortedMs, 50) ?? 0;
  const maxToMedianInvocationRatio =
    medianMs > 0 && maxInvocationMs != null ? Math.round((maxInvocationMs / medianMs) * 100) / 100 : null;
  const invocationPattern = classifyV3InvocationPattern(invocations, v3PipelineTotalMs);
  return {
    v3PipelineTotalMs,
    invocationCount,
    candidateCount,
    avgInvocationMs: invocationCount > 0 ? Math.round(v3PipelineTotalMs / invocationCount) : null,
    maxInvocationMs,
    minInvocationMs: sortedMs[0] ?? null,
    poolSize: percentile(poolSizes, 50) != null ? Math.round(percentile(poolSizes, 50)!) : null,
    laneCount: percentile(laneCounts, 50) != null ? Math.round(percentile(laneCounts, 50)!) : null,
    poolSizeAtMaxInvocation: maxInvocation?.poolSize ?? null,
    laneCountAtMaxInvocation: maxInvocation?.laneCount ?? null,
    invocationPattern,
    maxToMedianInvocationRatio,
  };
}

export function formatV3InvocationBreakdownMarkdown(input: {
  promptId: string;
  prompt: string;
  perCandidate: V3PerCandidateProfile[];
  selectedWinnerLabel: string | null;
  invocationPattern: V3InvocationPattern;
  v3PipelineTotalMs: number;
}): string {
  const lines = [
    `### ${input.promptId}`,
    `- Prompt: ${input.prompt}`,
    `- v3PipelineTotalMs: ${input.v3PipelineTotalMs}ms`,
    `- invocationPattern: **${input.invocationPattern}**`,
    `- winner: ${input.selectedWinnerLabel ?? "unknown"}`,
    "",
    "| # | candidate | pool | lanes | tracks | usable | winner | elapsed |",
    "| ---: | --- | ---: | ---: | ---: | :---: | :---: | ---: |",
  ];
  input.perCandidate.forEach((row) => {
    lines.push(
      `| ${row.candidateIndex} | ${row.label} | ${row.poolSize} | ${row.laneCount}`
      + ` | ${row.tracksProduced} | ${row.usable ? "yes" : "no"} | ${row.winner ? "yes" : "no"}`
      + ` | ${row.elapsedMs} |`,
    );
  });
  return lines.join("\n");
}

export function rollupCandidatePositionStats(
  prompts: Array<{ perCandidate: V3PerCandidateProfile[] }>,
): CandidatePositionRollupRow[] {
  const byIndex = new Map<number, {
    elapsed: number[];
    pool: number[];
    lane: number[];
    tracks: number[];
    believability: number[];
    usable: number;
    winner: number;
    total: number;
  }>();
  for (const prompt of prompts) {
    for (const row of prompt.perCandidate) {
      const bucket = byIndex.get(row.candidateIndex) ?? {
        elapsed: [],
        pool: [],
        lane: [],
        tracks: [],
        believability: [],
        usable: 0,
        winner: 0,
        total: 0,
      };
      bucket.elapsed.push(row.elapsedMs);
      bucket.pool.push(row.poolSize);
      bucket.lane.push(row.laneCount);
      bucket.tracks.push(row.tracksProduced);
      bucket.believability.push(row.believabilityScore);
      bucket.usable += row.usable ? 1 : 0;
      bucket.winner += row.winner ? 1 : 0;
      bucket.total += 1;
      byIndex.set(row.candidateIndex, bucket);
    }
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([candidateIndex, bucket]) => {
      const elapsedSorted = [...bucket.elapsed].sort((a, b) => a - b);
      const poolSorted = [...bucket.pool].sort((a, b) => a - b);
      const laneSorted = [...bucket.lane].sort((a, b) => a - b);
      const tracksSorted = [...bucket.tracks].sort((a, b) => a - b);
      const believabilitySorted = [...bucket.believability].sort((a, b) => a - b);
      return {
        candidateIndex,
        promptCount: bucket.total,
        medianElapsedMs: percentile(elapsedSorted, 50) != null ? Math.round(percentile(elapsedSorted, 50)!) : null,
        maxElapsedMs: elapsedSorted[elapsedSorted.length - 1] ?? null,
        medianPoolSize: percentile(poolSorted, 50) != null ? Math.round(percentile(poolSorted, 50)!) : null,
        medianLaneCount: percentile(laneSorted, 50) != null ? Math.round(percentile(laneSorted, 50)!) : null,
        medianTracksProduced: percentile(tracksSorted, 50) != null ? Math.round(percentile(tracksSorted, 50)!) : null,
        medianBelievabilityScore: percentile(believabilitySorted, 50) != null
          ? Math.round((percentile(believabilitySorted, 50)!) * 1000) / 1000
          : null,
        usableRate: bucket.total ? Math.round((bucket.usable / bucket.total) * 1000) / 10 : 0,
        winnerRate: bucket.total ? Math.round((bucket.winner / bucket.total) * 1000) / 10 : 0,
      };
    });
}

export function rollupTournamentQuality(
  tournaments: V3CandidateTournamentValue[],
): TournamentQualityRollup {
  const withWinner = tournaments.filter((row) => row.winnerCandidateIndex != null);
  const total = withWinner.length || 1;
  const winnerByCandidateIndex: Record<number, number> = {};
  let candidate1Wins = 0;
  let firstUsableIsWinner = 0;
  let winnerDiffersFromFirstUsable = 0;
  for (const row of withWinner) {
    if (row.candidate1WinsTournament) candidate1Wins += 1;
    if (row.firstUsableIsWinner) firstUsableIsWinner += 1;
    if (row.tournamentWinnerDiffersFromFirstUsable) winnerDiffersFromFirstUsable += 1;
    const index = row.winnerCandidateIndex!;
    winnerByCandidateIndex[index] = (winnerByCandidateIndex[index] ?? 0) + 1;
  }
  return {
    promptsWithData: withWinner.length,
    candidate1WinsRate: Math.round((candidate1Wins / total) * 1000) / 10,
    firstUsableIsWinnerRate: Math.round((firstUsableIsWinner / total) * 1000) / 10,
    winnerDiffersFromFirstUsableRate: Math.round((winnerDiffersFromFirstUsable / total) * 1000) / 10,
    winnerByCandidateIndex,
  };
}

export function formatTournamentQualityMarkdown(
  rollup: TournamentQualityRollup,
  positionRollup: CandidatePositionRollupRow[],
): string {
  const lines = [
    "# V3 Tournament Quality Rollup",
    "",
    "Answers: would early-stop at candidate 1 hurt quality?",
    "",
    `Prompts with tournament data: ${rollup.promptsWithData}`,
    `Candidate #1 wins tournament: **${rollup.candidate1WinsRate}%**`,
    `First usable candidate is winner: **${rollup.firstUsableIsWinnerRate}%**`,
    `Winner differs from first usable: **${rollup.winnerDiffersFromFirstUsableRate}%**`,
    "",
    "## Winner by candidate position",
    "",
    "| candidate # | wins | win % | median believability |",
    "| ---: | ---: | ---: | ---: |",
  ];
  const totalWins = Object.values(rollup.winnerByCandidateIndex).reduce((sum, n) => sum + n, 0) || 1;
  for (const row of positionRollup) {
    const wins = rollup.winnerByCandidateIndex[row.candidateIndex] ?? 0;
    lines.push(
      `| ${row.candidateIndex} | ${wins} | ${Math.round((wins / totalWins) * 1000) / 10}%`
      + ` | ${row.medianBelievabilityScore ?? "n/a"} |`,
    );
  }
  lines.push(
    "",
    "If candidate #1 wins >80% with similar believability, early-stop is likely safe.",
    "If winner is spread across positions, tournament is earning its keep.",
  );
  return lines.join("\n");
}

export function formatCandidatePositionRollupMarkdown(rows: CandidatePositionRollupRow[]): string {
  const lines = [
    "# V3 Candidate Position Rollup",
    "",
    "Median elapsed ms **per candidate #** across all prompts — reveals uniform cost vs positional outliers.",
    "",
    "| candidate # | prompts | median elapsed | max elapsed | median pool | median lanes | median tracks | median quality | usable % | winner % |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.candidateIndex} | ${row.promptCount} | ${row.medianElapsedMs ?? "n/a"}`
      + ` | ${row.maxElapsedMs ?? "n/a"} | ${row.medianPoolSize ?? "n/a"} | ${row.medianLaneCount ?? "n/a"}`
      + ` | ${row.medianTracksProduced ?? "n/a"} | ${row.medianBelievabilityScore ?? "n/a"}`
      + ` | ${row.usableRate} | ${row.winnerRate} |`,
    );
  }
  lines.push(
    "",
    "Uniform row (~5s each) → multiplicative candidate-count problem.",
    "Single hot row (e.g. candidate 7 median 34s) → positional/pathological problem.",
  );
  return lines.join("\n");
}

export function buildV3InvocationDecomposition(input: {
  invocations: V3InvocationTimingRow[];
  plannedCandidateAttemptCount: number;
  executableCandidateAttemptCount: number;
  retrievalSafetyExpanded: boolean;
  totalMs: number;
  selectedWinnerLabel?: string | null;
}): V3InvocationDecomposition {
  const perInvocationMs = input.invocations.map((row) => row.ms);
  const sorted = [...perInvocationMs].sort((a, b) => a - b);
  const invocationCount = perInvocationMs.length;
  const totalFromRows = perInvocationMs.reduce((sum, ms) => sum + ms, 0);
  const totalMs = input.totalMs > 0 ? input.totalMs : totalFromRows;
  const avgMsPerInvocation = invocationCount > 0
    ? Math.round(totalMs / invocationCount)
    : null;
  const selectedWinnerLabel = input.selectedWinnerLabel ?? null;
  const perCandidate: V3PerCandidateProfile[] = input.invocations.map((row, index) => ({
    candidateIndex: index + 1,
    label: row.label,
    elapsedMs: row.ms,
    ms: row.ms,
    poolSize: row.poolSize,
    laneCount: row.laneCount,
    tracksProduced: row.finalTrackCount,
    usable: row.genuinelyUsable,
    winner: selectedWinnerLabel === row.label,
    believabilityScore: row.believabilityScore,
    genuinelyUsable: row.genuinelyUsable,
    humanSaveable: row.humanSaveable,
  }));
  const candidateCount = input.executableCandidateAttemptCount;
  return {
    v3InvocationCount: invocationCount,
    perCandidateV3Ms: perInvocationMs,
    perCandidate,
    candidateTournamentValue: buildCandidateTournamentValue(input.invocations, selectedWinnerLabel),
    v3PipelineTimingProfile: buildV3PipelineTimingProfile(
      input.invocations,
      totalMs,
      candidateCount,
    ),
    invocationCount,
    plannedCandidateAttemptCount: input.plannedCandidateAttemptCount,
    executableCandidateAttemptCount: input.executableCandidateAttemptCount,
    retrievalSafetyExpanded: input.retrievalSafetyExpanded,
    totalMs,
    perInvocationMs,
    minMsPerInvocation: sorted[0] ?? null,
    maxMsPerInvocation: sorted[sorted.length - 1] ?? null,
    medianMsPerInvocation: percentile(sorted, 50) != null ? Math.round(percentile(sorted, 50)!) : null,
    avgMsPerInvocation,
    costDriver: classifyV3CostDriver(invocationCount, avgMsPerInvocation),
    invocations: input.invocations,
  };
}
