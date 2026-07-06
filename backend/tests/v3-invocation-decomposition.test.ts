import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildV3InvocationDecomposition,
  classifyV3CostDriver,
  classifyV3InvocationPattern,
  formatV3InvocationBreakdownMarkdown,
  rollupCandidatePositionStats,
  rollupTournamentQuality,
} from "../lib/v3-invocation-decomposition";

function row(
  label: string,
  ms: number,
  believabilityScore: number,
  genuinelyUsable: boolean,
  laneCount = 4,
): {
  label: string;
  ms: number;
  poolSize: number;
  inputPoolSize: number;
  candidatePoolSize: number;
  finalTrackCount: number;
  believabilityScore: number;
  genuinelyUsable: boolean;
  humanSaveable: boolean;
  laneCount: number;
} {
  return {
    label,
    ms,
    poolSize: 320,
    inputPoolSize: 200,
    candidatePoolSize: 180,
    finalTrackCount: genuinelyUsable ? 30 : 4,
    believabilityScore,
    genuinelyUsable,
    humanSaveable: genuinelyUsable,
    laneCount,
  };
}

describe("v3 invocation decomposition", () => {
  it("classifies world A (many fast invocations)", () => {
    assert.equal(classifyV3CostDriver(15, 5_000), "invocation_count");
  });

  it("classifies world B (few slow invocations)", () => {
    assert.equal(classifyV3CostDriver(3, 25_000), "per_invocation_cost");
  });

  it("builds count × cost summary from per-invocation rows", () => {
    const summary = buildV3InvocationDecomposition({
      invocations: Array.from({ length: 15 }, (_, index) =>
        row(`cand_${index}`, 5_000, 0.72, index === 0)),
      plannedCandidateAttemptCount: 15,
      executableCandidateAttemptCount: 15,
      retrievalSafetyExpanded: false,
      totalMs: 75_000,
      selectedWinnerLabel: "cand_0",
    });
    assert.equal(summary.v3InvocationCount, 15);
    assert.deepEqual(summary.perCandidateV3Ms, Array.from({ length: 15 }, () => 5_000));
    assert.equal(summary.avgMsPerInvocation, 5_000);
    assert.equal(summary.costDriver, "invocation_count");
    assert.equal(summary.v3PipelineTimingProfile.v3PipelineTotalMs, 75_000);
    assert.equal(summary.v3PipelineTimingProfile.invocationCount, 15);
    assert.equal(summary.v3PipelineTimingProfile.candidateCount, 15);
    assert.equal(summary.v3PipelineTimingProfile.avgInvocationMs, 5_000);
    assert.equal(summary.v3PipelineTimingProfile.poolSize, 320);
    assert.equal(summary.v3PipelineTimingProfile.invocationPattern, "multiplicative");
    assert.equal(summary.candidateTournamentValue.firstUsableCandidateIndex, 1);
    assert.equal(summary.candidateTournamentValue.candidate1WinsTournament, true);
    assert.equal(summary.candidateTournamentValue.invocationsAfterFirstUsable, 14);
    assert.equal(summary.candidateTournamentValue.msAfterFirstUsable, 70_000);
    assert.equal(summary.candidateTournamentValue.tournamentWinnerDiffersFromFirstUsable, false);
  });

  it("classifies multiplicative 15×5s pattern", () => {
    const invocations = Array.from({ length: 15 }, (_, index) => ({
      label: `cand_${index}`,
      ms: 5_000 + (index % 3) * 100,
      poolSize: 300,
      inputPoolSize: 200,
      candidatePoolSize: 180,
      finalTrackCount: 30,
      believabilityScore: 0.7,
      genuinelyUsable: true,
      humanSaveable: true,
      laneCount: 4,
    }));
    assert.equal(classifyV3InvocationPattern(invocations, 75_000), "multiplicative");
  });

  it("classifies pathological single dominant invocation", () => {
    assert.equal(
      classifyV3InvocationPattern([
        {
          label: "slow",
          ms: 82_000,
          poolSize: 400,
          inputPoolSize: 300,
          candidatePoolSize: 280,
          finalTrackCount: 30,
          believabilityScore: 0.8,
          genuinelyUsable: true,
          humanSaveable: true,
          laneCount: 5,
        },
      ], 82_000),
      "pathological",
    );
  });

  it("formats per-invocation markdown table", () => {
    const md = formatV3InvocationBreakdownMarkdown({
      promptId: "sunday-coffee",
      prompt: "sunday morning coffee",
      perCandidate: [
        {
          candidateIndex: 1,
          label: "balanced_seed0",
          elapsedMs: 5400,
          ms: 5400,
          poolSize: 312,
          laneCount: 4,
          tracksProduced: 30,
          usable: true,
          winner: false,
          believabilityScore: 0.71,
          genuinelyUsable: true,
          humanSaveable: true,
        },
        {
          candidateIndex: 2,
          label: "balanced_seed1",
          elapsedMs: 5500,
          ms: 5500,
          poolSize: 308,
          laneCount: 4,
          tracksProduced: 32,
          usable: true,
          winner: true,
          believabilityScore: 0.72,
          genuinelyUsable: true,
          humanSaveable: true,
        },
      ],
      selectedWinnerLabel: "balanced_seed1",
      invocationPattern: "multiplicative",
      v3PipelineTotalMs: 10_900,
    });
    assert.match(md, /\| 1 \| balanced_seed0/);
    assert.match(md, /\| yes \| yes \| 5500 \|/);
    assert.match(md, /invocationPattern: \*\*multiplicative\*\*/);
  });

  it("rolls up candidate 1 tournament win rate", () => {
    const rollup = rollupTournamentQuality([
      {
        selectedWinnerLabel: "cand_0",
        winnerCandidateIndex: 1,
        candidate1WinsTournament: true,
        firstUsableCandidateIndex: 1,
        firstUsableCandidateLabel: "cand_0",
        firstUsableIsWinner: true,
        tournamentWinnerDiffersFromFirstUsable: false,
        believabilityAtFirstUsable: 0.71,
        believabilityAtCandidate1: 0.71,
        believabilityAtWinner: 0.71,
        believabilityGainFirstUsableToWinner: 0,
        believabilityGainCandidate1ToWinner: 0,
        invocationsAfterFirstUsable: 14,
        msAfterFirstUsable: 70_000,
      },
      {
        selectedWinnerLabel: "cand_2",
        winnerCandidateIndex: 3,
        candidate1WinsTournament: false,
        firstUsableCandidateIndex: 1,
        firstUsableCandidateLabel: "cand_0",
        firstUsableIsWinner: false,
        tournamentWinnerDiffersFromFirstUsable: true,
        believabilityAtFirstUsable: 0.7,
        believabilityAtCandidate1: 0.7,
        believabilityAtWinner: 0.84,
        believabilityGainFirstUsableToWinner: 0.14,
        believabilityGainCandidate1ToWinner: 0.14,
        invocationsAfterFirstUsable: 2,
        msAfterFirstUsable: 12_000,
      },
    ]);
    assert.equal(rollup.promptsWithData, 2);
    assert.equal(rollup.candidate1WinsRate, 50);
    assert.equal(rollup.firstUsableIsWinnerRate, 50);
    assert.equal(rollup.winnerByCandidateIndex[1], 1);
    assert.equal(rollup.winnerByCandidateIndex[3], 1);
  });

  it("rolls up median elapsed by candidate position across prompts", () => {
    const rollup = rollupCandidatePositionStats([
      {
        perCandidate: [
          { candidateIndex: 1, label: "a", elapsedMs: 4_800, ms: 4_800, poolSize: 300, laneCount: 4, tracksProduced: 30, usable: true, winner: false, believabilityScore: 0.7, genuinelyUsable: true, humanSaveable: true },
          { candidateIndex: 2, label: "b", elapsedMs: 5_000, ms: 5_000, poolSize: 300, laneCount: 4, tracksProduced: 30, usable: true, winner: true, believabilityScore: 0.72, genuinelyUsable: true, humanSaveable: true },
        ],
      },
      {
        perCandidate: [
          { candidateIndex: 1, label: "a", elapsedMs: 4_900, ms: 4_900, poolSize: 310, laneCount: 4, tracksProduced: 28, usable: true, winner: true, believabilityScore: 0.71, genuinelyUsable: true, humanSaveable: true },
          { candidateIndex: 2, label: "b", elapsedMs: 34_000, ms: 34_000, poolSize: 400, laneCount: 6, tracksProduced: 12, usable: false, winner: false, believabilityScore: 0.5, genuinelyUsable: false, humanSaveable: false },
        ],
      },
    ]);
    assert.equal(rollup[0]?.candidateIndex, 1);
    assert.equal(rollup[0]?.medianElapsedMs, 4_800);
    assert.equal(rollup[1]?.candidateIndex, 2);
    assert.equal(rollup[1]?.medianElapsedMs, 5_000);
    assert.equal(rollup[1]?.maxElapsedMs, 34_000);
  });
});
