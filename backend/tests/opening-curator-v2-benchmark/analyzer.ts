/**
 * Per-prompt WHY analysis — focused on tracks 1–5 human retention.
 */

import type { OpeningFiveEvaluation } from "../playlist-quality-benchmark/types";
import type { PlaylistReplaySimulation } from "../playlist-quality-benchmark/replay-simulator/types";
import type {
  FailureCause,
  OpeningCuratorDiagnostics,
  OpeningCuratorV2Prompt,
  OpeningCuratorV2PromptAnalysis,
  OpeningTrackSummary,
  RetrievalDiagnostics,
} from "./types";

const FEELS_HUMAN_REPLAY_MIN = 0.72;
const FEELS_HUMAN_SKIP_MAX = 0.35;

export function feelsHumanFirstFive(opts: {
  openingPass: boolean;
  replay: PlaylistReplaySimulation | null;
  negativeDetected: boolean;
}): boolean {
  if (!opts.openingPass || opts.negativeDetected) return false;
  if (!opts.replay) return opts.openingPass;
  return (
    opts.replay.replayProxyScore >= FEELS_HUMAN_REPLAY_MIN &&
    opts.replay.skipRiskScore <= FEELS_HUMAN_SKIP_MAX
  );
}

export function inferFailureCause(opts: {
  prompt: OpeningCuratorV2Prompt;
  generationSuccess: boolean;
  libraryInsufficient: boolean;
  openingPass: boolean;
  openingFive: OpeningFiveEvaluation | null;
  replay: PlaylistReplaySimulation | null;
  retrieval: RetrievalDiagnostics | null;
  openingCurator: OpeningCuratorDiagnostics | null;
  negativeDetected: boolean;
  humanPreferenceProxy: "human" | "kwalify" | "tie" | null;
}): { cause: FailureCause; detail: string } {
  if (!opts.generationSuccess) {
    if (opts.libraryInsufficient) {
      return {
        cause: "library",
        detail: "Library could not support this prompt — system should suggest discovery or refinement.",
      };
    }
    return {
      cause: "generation_failure",
      detail: "No usable playlist returned for evaluation.",
    };
  }

  if (opts.prompt.category === "adversarial" && !opts.openingPass) {
    return {
      cause: "prompt_understanding",
      detail: "Vague or contradictory prompt — narrative intent may exceed music selection capability.",
    };
  }

  if (opts.libraryInsufficient || opts.retrieval?.librarySufficient === false) {
    return {
      cause: "library",
      detail: "Library bias or insufficient capability dominated candidate pool.",
    };
  }

  if (opts.prompt.category === "library_gravity" && !opts.openingPass) {
    return {
      cause: "library",
      detail: "User library gravity pulled wrong favorites into the opening window.",
    };
  }

  const openingIssues = opts.openingFive?.issues ?? [];
  const replayFlags = opts.replay?.openingRetention.flags ?? [];

  if (
    openingIssues.some((i) => i.includes("gym") || i.includes("focus") || i.includes("party")) ||
    replayFlags.includes("wrong_activity_energy_opener")
  ) {
    if ((opts.openingCurator?.swaps ?? 0) > 0 && !opts.openingPass) {
      return {
        cause: "retrieval",
        detail: "Opening curator could not find activity-fit tracks in the candidate pool.",
      };
    }
    return {
      cause: "scoring",
      detail: "Candidate pool contained activity-mismatched tracks that won selection.",
    };
  }

  if (replayFlags.includes("genre_shock_opening") || openingIssues.length > 0) {
    if ((opts.openingCurator?.openingFinalOrderPreserved === false)) {
      return {
        cause: "sequencing",
        detail: "Post-curation sequencing disturbed the opening window.",
      };
    }
    return {
      cause: "sequencing",
      detail: "Opening five lacks continuity — genre or energy shock in tracks 1–5.",
    };
  }

  if (opts.humanPreferenceProxy === "human" && opts.openingPass) {
    return {
      cause: "scoring",
      detail: "Opening passes heuristics but human reference still wins preference — selection lacks human taste.",
    };
  }

  if (opts.prompt.category === "human_curator" && !opts.openingPass) {
    return {
      cause: "prompt_understanding",
      detail: "Scene/feeling prompt not translated into a memorable track 1 identity.",
    };
  }

  if (opts.openingPass) {
    return { cause: "none", detail: "Opening window meets human-retention heuristics." };
  }

  return {
    cause: "scoring",
    detail: "Tracks selected do not establish prompt identity in the first five.",
  };
}

export function analyzePromptResult(opts: {
  prompt: OpeningCuratorV2Prompt;
  firstFive: OpeningTrackSummary[];
  openingFive: OpeningFiveEvaluation | null;
  replay: PlaylistReplaySimulation | null;
  openingPass: boolean;
  feelsHuman: boolean;
  generationSuccess: boolean;
  libraryInsufficient: boolean;
  retrieval: RetrievalDiagnostics | null;
  openingCurator: OpeningCuratorDiagnostics | null;
  negativeDetected: boolean;
  humanPreferenceProxy: "human" | "kwalify" | "tie" | null;
}): OpeningCuratorV2PromptAnalysis {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const openingIssues = [...(opts.openingFive?.issues ?? [])];

  if (opts.openingPass) strengths.push("Opening five passes activity and coherence heuristics.");
  else weaknesses.push("Opening five fails first-impression checks.");

  if (opts.feelsHuman) strengths.push("Replay proxy suggests a human would keep listening past track 1.");
  else weaknesses.push("Low replay/skip proxy — high early abandonment risk.");

  if (opts.replay) {
    if (opts.replay.replayProxyScore >= 0.8) strengths.push(`Strong replay proxy (${opts.replay.replayProxyScore.toFixed(2)}).`);
    if (opts.replay.skipRiskScore > 0.35) weaknesses.push(`Elevated skip risk (${opts.replay.skipRiskScore.toFixed(2)}).`);
    if (opts.replay.openingRetention.flags.length > 0) {
      openingIssues.push(...opts.replay.openingRetention.flags);
    }
  }

  if (opts.humanPreferenceProxy === "kwalify") strengths.push("Blind preference proxy favors Kwalify opening.");
  if (opts.humanPreferenceProxy === "human") weaknesses.push("Human reference still wins blind preference on opening.");

  if ((opts.openingCurator?.swaps ?? 0) > 0) {
    strengths.push(`Opening curator v2 swapped ${opts.openingCurator!.swaps} track(s) to repair opening.`);
  }
  if (opts.openingCurator?.openingLockApplied && opts.openingCurator.openingFinalOrderPreserved) {
    strengths.push("Opening lock preserved curated order through finalization.");
  }
  if (opts.openingCurator?.openingLockViolations?.length) {
    weaknesses.push(
      `Opening lock violations: ${opts.openingCurator.openingLockViolations.map((v) => v.reason).join(", ")}`,
    );
  }

  if (opts.retrieval?.strategy) {
    if (opts.retrieval.librarySufficient === false) {
      weaknesses.push(`Retrieval flagged library insufficient (strategy: ${opts.retrieval.strategy}).`);
    }
  }

  const { cause, detail } = inferFailureCause({
    prompt: opts.prompt,
    generationSuccess: opts.generationSuccess,
    libraryInsufficient: opts.libraryInsufficient,
    openingPass: opts.openingPass,
    openingFive: opts.openingFive,
    replay: opts.replay,
    retrieval: opts.retrieval,
    openingCurator: opts.openingCurator,
    negativeDetected: opts.negativeDetected,
    humanPreferenceProxy: opts.humanPreferenceProxy,
  });

  const opener = opts.firstFive[0];
  const whySummary = opts.feelsHuman
    ? `Track 1 (${opener?.artistName ?? "?"} — ${opener?.trackName ?? "?"}) establishes the prompt; a human would likely press play and continue.`
    : opts.openingPass
      ? `Opening heuristics pass but replay proxy is weak — "${opener?.artistName ?? "?"}" may feel technically related without emotional lock-in.`
      : `Opening fails: ${detail} Opener "${opener?.artistName ?? "?"}" does not earn trust in the first 30 seconds.`;

  return {
    whySummary,
    strengths,
    weaknesses,
    openingIssues: [...new Set(openingIssues)],
    failureCause: cause,
    failureCauseDetail: detail,
  };
}

export function formatFirstFiveLines(firstFive: OpeningTrackSummary[]): string[] {
  return firstFive.map(
    (t) =>
      `${t.position}. ${t.artistName} — ${t.trackName}` +
      (t.energy != null ? ` (E=${t.energy.toFixed(2)})` : "") +
      (t.genreFamily ? ` [${t.genreFamily}]` : ""),
  );
}
