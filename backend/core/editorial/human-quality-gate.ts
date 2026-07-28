/**
 * Human Quality Gate — terminal save/replay honesty check.
 *
 * Aligns with docs/human-curation-alignment-v2.md:
 * never force completion; prefer honest partial or refuse over padded trash.
 */

import { isZeroPsychOpenerWorld } from "./opener-hygiene";
import { LANE_PURITY_WORLD_IDS } from "./world-coherence-score";
import { coverageLevelToMaxTracks, type CoverageLevel } from "./world-coverage";

export type HumanQualityGateAction = "pass" | "honest_partial" | "refuse";

export type HumanQualityGateInput = {
  trackCount: number;
  requestedLength: number;
  wouldSpotifyMakeThis?: boolean | null;
  dominantWorldDensity?: number | null;
  retrievalEntropy?: number | null;
  humanSavePassed?: boolean | null;
  curatorScore?: number | null;
  degradedDelivery?: boolean;
  seasonalLeakage?: boolean;
  holidayRequested?: boolean;
  holidayNegated?: boolean;
  uniqueArtistCount?: number | null;
  /** 0–1 share of tracks by the single most common artist */
  dominantArtistShare?: number | null;
  promptLabel?: string | null;
  /** 0–1 share of tracks in committed-world lane (funk/disco/soul/pop etc.). */
  feelGoodLanePurity?: number | null;
  /** Per-world lane purity pass (uses world-specific thresholds). */
  committedWorldLaneOk?: boolean | null;
  /** Active world id for lane-specific gates. */
  activeWorldId?: string | null;
  /** Genre-family dominance 0–1 for committed-world mash detection. */
  dominantFamilyShare?: number | null;
  /** Distinct genre families in the delivered list. */
  uniqueGenreFamilies?: number | null;
  /** Psych-indie opener fillers in slots 1–3 (Tame/Kasabian/Q chain smell). */
  psychIndieOpenerFillers?: number | null;
  /** Intent fidelity gate failed on sampled tracks or opener. */
  intentFidelityFailed?: boolean | null;
  /** Tracks 1–5 failed to prove the committed world before ship. */
  worldProofFailed?: boolean | null;
  /** Committed world hard-lock active for this prompt. */
  committedWorldHardLock?: boolean | null;
  /** Tracks in first 3 that violate explicit negation (no rap, no guitar, no christmas). */
  openerNegationViolations?: number | null;
  /** Total tracks violating explicit negation across playlist. */
  negationViolations?: number | null;
  /** Intent fidelity score 0–1 from world proof gate. */
  intentFidelityScore?: number | null;
  /** World membership score 0–1 — beats emotion for hard-lock prompts. */
  worldMatchScore?: number | null;
  /** Emotion/audio similarity score 0–1 — secondary to world on hard lock. */
  emotionMatchScore?: number | null;
  /** V10 world coverage level from library assessment. */
  coverageLevel?: CoverageLevel | null;
};

export type HumanQualityGateResult = {
  action: HumanQualityGateAction;
  reasons: string[];
  userMessage: string | null;
  /** Suggested publish length when action is honest_partial */
  salvageableCount: number;
  wouldSaveConfidence: number;
  replayConfidence: number;
  worldCoherenceOk: boolean;
  stubUnderfill: boolean;
};

export class HumanQualityGateError extends Error {
  readonly result: HumanQualityGateResult;
  readonly code = "HUMAN_QUALITY_GATE_REFUSED" as const;

  constructor(result: HumanQualityGateResult, message?: string) {
    super(message ?? result.userMessage ?? "Playlist refused by Human Quality Gate");
    this.name = "HumanQualityGateError";
    this.result = result;
  }
}

/** V15: minimum honest delivery — 3+ preferred; never refuse 1-2 on hard-lock when anchors exist. */
const MIN_SALVAGEABLE = 3;

export function buildHumanQualityRefuseMessage(
  reasons: string[],
  opts?: { trackCount?: number; requestedLength?: number; promptLabel?: string | null },
): string {
  const requested = opts?.requestedLength ?? 0;
  const count = opts?.trackCount ?? 0;
  if (reasons.includes("holiday_requested_empty_supply")) {
    return (
      "This library does not contain enough authentic Christmas / holiday tracks " +
      "to build a playlist I'd be confident you'll enjoy. Filling with unrelated pop " +
      "would dilute the experience — try Discovery Mode or a broader festive prompt."
    );
  }
  if (reasons.includes("stub_underfill") || (count > 0 && count < MIN_SALVAGEABLE && !reasons.includes("v15_minimum_delivery"))) {
    return (
      `I only found ${count} strong match${count === 1 ? "" : "es"}` +
      (requested > 0 ? ` for a ${requested}-track request` : "") +
      ". Padding the rest would invent coherence that isn't there. " +
      "Try Discovery Mode or broaden the prompt."
    );
  }
  if (reasons.includes("world_incoherent") || reasons.includes("identity_drift")) {
    return (
      "I couldn't assemble a single musical world that feels intentionally curated for this prompt. " +
      "Returning a mixed filler playlist would fail the save/replay test — try Discovery Mode or a clearer scene."
    );
  }
  if (reasons.includes("psych_indie_opener_chain")) {
    return (
      "The opening tracks looked like generic retrieval filler rather than intentional curation. " +
      "I won't publish that chain — try again or broaden the prompt."
    );
  }
  if (reasons.includes("seasonal_leakage")) {
    return (
      "Holiday / seasonal tracks leaked into a non-seasonal prompt. " +
      "I won't publish that — try again without seasonal language, or request Christmas explicitly."
    );
  }
  return (
    "This playlist would not pass a human save/replay test in its current form. " +
    "I'd rather explain the gap than ship something you wouldn't keep."
  );
}

export function buildHumanQualityPartialMessage(
  salvageableCount: number,
  requestedLength: number,
  reasons: string[],
): string {
  if (reasons.includes("intent_fidelity_failed") || reasons.includes("world_proof_failed")) {
    return (
      `Found ${salvageableCount} track${salvageableCount === 1 ? "" : "s"} that genuinely fit this world — ` +
      "publishing only those rather than padding with mismatched filler."
    );
  }
  if (reasons.includes("world_incoherent") || reasons.includes("degraded_delivery")) {
    return (
      `I found about ${salvageableCount} tracks that belong together for this prompt ` +
      `(requested ${requestedLength}). Publishing only those — filling further would dilute the identity.`
    );
  }
  return (
    `Your library supports about ${salvageableCount} of ${requestedLength} requested tracks ` +
    `without inventing coherence. Publishing the strongest matches.`
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function evaluateHumanQualityGate(input: HumanQualityGateInput): HumanQualityGateResult {
  const requested = Math.max(1, input.requestedLength || 1);
  const count = Math.max(0, input.trackCount);
  const density = typeof input.dominantWorldDensity === "number" ? input.dominantWorldDensity : null;
  const entropy = typeof input.retrievalEntropy === "number" ? input.retrievalEntropy : null;
  const wouldSpotify =
    typeof input.wouldSpotifyMakeThis === "boolean" ? input.wouldSpotifyMakeThis : null;
  const curator =
    typeof input.curatorScore === "number" ? input.curatorScore : null;
  const artistShare =
    typeof input.dominantArtistShare === "number" ? input.dominantArtistShare : null;

  const reasons: string[] = [];
  const stubUnderfill = count > 0 && count < MIN_SALVAGEABLE;
  const empty = count === 0;
  const weakWorld =
    wouldSpotify === false ||
    (density != null && density < 0.35) ||
    (entropy != null && entropy > 0.82);
  const worldCoherenceOk = !weakWorld;

  if (empty) reasons.push("empty_playlist");
  if (stubUnderfill) reasons.push("stub_underfill");
  if (input.seasonalLeakage && !input.holidayRequested) reasons.push("seasonal_leakage");
  if (input.holidayRequested && count < 3) reasons.push("holiday_requested_empty_supply");
  if (weakWorld) reasons.push("world_incoherent");
  if (input.degradedDelivery) reasons.push("degraded_delivery");
  if (input.humanSavePassed === false) reasons.push("human_save_failed");
  if (input.intentFidelityFailed === true) reasons.push("intent_fidelity_failed");
  if (
    input.committedWorldHardLock === true &&
    typeof input.worldMatchScore === "number" &&
    typeof input.emotionMatchScore === "number" &&
    input.worldMatchScore < input.emotionMatchScore - 0.08
  ) {
    reasons.push("world_under_emotion");
    if (!reasons.includes("intent_fidelity_failed")) reasons.push("intent_fidelity_failed");
  }
  if (
    input.committedWorldHardLock === true &&
    typeof input.intentFidelityScore === "number" &&
    input.intentFidelityScore < 0.72
  ) {
    if (!reasons.includes("intent_fidelity_failed")) reasons.push("intent_fidelity_failed");
  }
  if (input.worldProofFailed === true) {
    reasons.push("world_proof_failed");
    if (!reasons.includes("intent_fidelity_failed")) reasons.push("intent_fidelity_failed");
  }
  if (
    input.committedWorldHardLock === true &&
    typeof input.psychIndieOpenerFillers === "number" &&
    input.psychIndieOpenerFillers >= 1
  ) {
    reasons.push("psych_indie_opener_chain");
    if (!reasons.includes("intent_fidelity_failed")) reasons.push("intent_fidelity_failed");
  }
  if (typeof input.openerNegationViolations === "number" && input.openerNegationViolations >= 1) {
    reasons.push("negation_violation");
    if (!reasons.includes("intent_fidelity_failed")) reasons.push("intent_fidelity_failed");
  }
  if (typeof input.negationViolations === "number" && input.negationViolations >= 2) {
    reasons.push("negation_violation");
  }
  if (artistShare != null && artistShare >= 0.55 && count >= 8) reasons.push("artist_dominance");
  if (density != null && density < 0.42 && count >= MIN_SALVAGEABLE) reasons.push("identity_drift");
  if (
    input.activeWorldId &&
    LANE_PURITY_WORLD_IDS.has(input.activeWorldId) &&
    input.committedWorldLaneOk === false &&
    count >= MIN_SALVAGEABLE
  ) {
    reasons.push("world_lane_mash");
  }
  if (
    input.activeWorldId &&
    typeof input.dominantFamilyShare === "number" &&
    typeof input.uniqueGenreFamilies === "number" &&
    input.uniqueGenreFamilies >= 3 &&
    input.dominantFamilyShare < 0.5 &&
    count >= MIN_SALVAGEABLE
  ) {
    reasons.push("world_lane_mash");
  }
  if (typeof input.psychIndieOpenerFillers === "number" && input.psychIndieOpenerFillers >= 2) {
    reasons.push("psych_indie_opener_chain");
  } else if (
    typeof input.psychIndieOpenerFillers === "number" &&
    input.psychIndieOpenerFillers >= 1 &&
    input.activeWorldId &&
    isZeroPsychOpenerWorld(input.activeWorldId) &&
    !reasons.includes("psych_indie_opener_chain")
  ) {
    reasons.push("psych_indie_opener_chain");
  }

  // Salvageable means we can honestly publish what we have (including mid-stubs 3–5).
  const coverageCap =
    input.coverageLevel && input.committedWorldHardLock
      ? coverageLevelToMaxTracks(input.coverageLevel, requested)
      : Math.min(12, Math.ceil(requested * 0.4));
  const salvageableCount = count >= 3 ? Math.min(count, coverageCap) : 0;

  let wouldSaveConfidence = 0.55;
  if (wouldSpotify === true) wouldSaveConfidence += 0.22;
  if (wouldSpotify === false) wouldSaveConfidence -= 0.28;
  if (density != null) wouldSaveConfidence += (density - 0.5) * 0.3;
  if (curator != null) wouldSaveConfidence = wouldSaveConfidence * 0.6 + curator * 0.4;
  if (stubUnderfill || empty) wouldSaveConfidence = Math.min(wouldSaveConfidence, 0.25);
  if (input.degradedDelivery) wouldSaveConfidence -= 0.15;
  wouldSaveConfidence = clamp01(wouldSaveConfidence);

  let replayConfidence = wouldSaveConfidence;
  if (artistShare != null && artistShare > 0.45) replayConfidence -= 0.12;
  if (count >= Math.ceil(requested * 0.75) && worldCoherenceOk) replayConfidence += 0.08;
  replayConfidence = clamp01(replayConfidence);

  if (
    input.committedWorldHardLock === true &&
    input.coverageLevel === "VERY_LOW" &&
    count > coverageCap
  ) {
    if (salvageableCount >= 3) {
      return {
        action: "honest_partial",
        reasons: [...reasons, "very_low_world_coverage"],
        userMessage: buildHumanQualityPartialMessage(salvageableCount, requested, ["very_low_world_coverage"]),
        salvageableCount,
        wouldSaveConfidence,
        replayConfidence,
        worldCoherenceOk,
        stubUnderfill,
      };
    }
    return {
      action: "refuse",
      reasons: [...reasons, "very_low_world_coverage"],
      userMessage: buildHumanQualityRefuseMessage([...reasons, "very_low_world_coverage"], {
        trackCount: count,
        requestedLength: requested,
        promptLabel: input.promptLabel,
      }),
      salvageableCount: 0,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }

  if (
    input.committedWorldHardLock === true &&
    input.coverageLevel &&
    input.coverageLevel !== "HIGH" &&
    count > coverageCap
  ) {
    return {
      action: "honest_partial",
      reasons: [...reasons, "coverage_capped"],
      userMessage: buildHumanQualityPartialMessage(salvageableCount, requested, ["coverage_capped"]),
      salvageableCount,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }

  // Refuse only truly unsavable stubs (empty), seasonal leak, opener chain that survived sanitize, or empty wanted-christmas.
  if (
    count > 0 &&
    count < 3 &&
    input.committedWorldHardLock === true
  ) {
    return {
      action: "honest_partial",
      reasons: [...reasons, "v15_minimum_delivery"],
      userMessage: buildHumanQualityPartialMessage(count, requested, [...reasons, "v15_minimum_delivery"]),
      salvageableCount: count,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }

  if (
    empty ||
    (count < 3 && input.committedWorldHardLock !== true) ||
    reasons.includes("holiday_requested_empty_supply") ||
    reasons.includes("seasonal_leakage") ||
    (reasons.includes("psych_indie_opener_chain") &&
      typeof input.psychIndieOpenerFillers === "number" &&
      input.psychIndieOpenerFillers >= 2)
  ) {
    const refuseReasons = reasons.length > 0 ? reasons : ["unsavable"];
    return {
      action: "refuse",
      reasons: refuseReasons,
      userMessage: buildHumanQualityRefuseMessage(refuseReasons, {
        trackCount: count,
        requestedLength: requested,
        promptLabel: input.promptLabel,
      }),
      salvageableCount: 0,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }

  // Honest partial: under-request or mid-stub (3–5) or degraded — publish what belongs.
  const underfilled = count < Math.ceil(requested * 0.75);
  const laneMash =
    reasons.includes("world_lane_mash") &&
    (input.committedWorldLaneOk === false ||
      (input.dominantFamilyShare ?? 1) < 0.5 ||
      ((input.uniqueGenreFamilies ?? 0) >= 3 && (input.dominantFamilyShare ?? 1) < 0.52));
  const openerChain = reasons.includes("psych_indie_opener_chain");
  const genreWorldCommitted = Boolean(input.activeWorldId);
  const identityDriftOnLock =
    genreWorldCommitted &&
    (reasons.includes("identity_drift") || reasons.includes("world_lane_mash"));
  if (reasons.includes("human_save_failed")) {
    if (salvageableCount >= 3) {
      return {
        action: "honest_partial",
        reasons,
        userMessage: buildHumanQualityPartialMessage(salvageableCount, requested, reasons),
        salvageableCount: Math.min(salvageableCount, Math.min(12, Math.ceil(requested * 0.4))),
        wouldSaveConfidence,
        replayConfidence,
        worldCoherenceOk,
        stubUnderfill,
      };
    }
    const refuseReasons = reasons.length > 0 ? reasons : ["human_save_failed"];
    return {
      action: "refuse",
      reasons: refuseReasons,
      userMessage: buildHumanQualityRefuseMessage(refuseReasons, {
        trackCount: count,
        requestedLength: requested,
        promptLabel: input.promptLabel,
      }),
      salvageableCount: 0,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }
  if (
    reasons.includes("intent_fidelity_failed") ||
    reasons.includes("world_proof_failed") ||
    (input.committedWorldHardLock === true && reasons.includes("world_lane_mash")) ||
    (input.committedWorldHardLock === true && reasons.includes("negation_violation"))
  ) {
    if (salvageableCount >= 3) {
      const partialCap = Math.min(salvageableCount, Math.min(12, Math.ceil(requested * 0.4)));
      const worldProofMessage =
        reasons.includes("world_proof_failed")
          ? `Found ${partialCap} track${partialCap === 1 ? "" : "s"} that genuinely fit this world — publishing only those rather than padding with mismatched filler.`
          : buildHumanQualityPartialMessage(partialCap, requested, reasons);
      return {
        action: "honest_partial",
        reasons,
        userMessage: worldProofMessage,
        salvageableCount: partialCap,
        wouldSaveConfidence,
        replayConfidence,
        worldCoherenceOk,
        stubUnderfill,
      };
    }
    const refuseReasons = reasons.length > 0 ? reasons : ["intent_fidelity_failed"];
    return {
      action: "refuse",
      reasons: refuseReasons,
      userMessage: buildHumanQualityRefuseMessage(refuseReasons, {
        trackCount: count,
        requestedLength: requested,
        promptLabel: input.promptLabel,
      }),
      salvageableCount: 0,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }
  if (input.degradedDelivery === true) {
    const partialCap = Math.min(count, Math.min(12, Math.ceil(requested * 0.4)));
    const partialReasons = reasons.length > 0 ? reasons : ["degraded_delivery"];
    return {
      action: "honest_partial",
      reasons: partialReasons,
      userMessage: buildHumanQualityPartialMessage(partialCap, requested, partialReasons),
      salvageableCount: partialCap,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }
  if (identityDriftOnLock) {
    if (salvageableCount >= 3) {
      const partialCap = Math.min(salvageableCount, Math.min(12, Math.ceil(requested * 0.4)));
      return {
        action: "honest_partial",
        reasons,
        userMessage: buildHumanQualityPartialMessage(partialCap, requested, reasons),
        salvageableCount: partialCap,
        wouldSaveConfidence,
        replayConfidence,
        worldCoherenceOk,
        stubUnderfill,
      };
    }
    const refuseReasons = reasons.length > 0 ? reasons : ["identity_drift"];
    return {
      action: "refuse",
      reasons: refuseReasons,
      userMessage: buildHumanQualityRefuseMessage(refuseReasons, {
        trackCount: count,
        requestedLength: requested,
        promptLabel: input.promptLabel,
      }),
      salvageableCount: 0,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }
  if (underfilled || stubUnderfill || laneMash || openerChain) {
    const partialReasons = reasons.length > 0 ? reasons : ["honest_underfill"];
    return {
      action: "honest_partial",
      reasons: partialReasons,
      userMessage: buildHumanQualityPartialMessage(count, requested, partialReasons),
      salvageableCount: count,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }

  if (
    input.committedWorldHardLock === true &&
    (input.humanSavePassed === false ||
      input.worldProofFailed === true ||
      (typeof input.curatorScore === "number" && input.curatorScore < 0.72) ||
      reasons.includes("negation_violation"))
  ) {
    if (salvageableCount >= 3) {
      const partialCap = Math.min(salvageableCount, Math.min(12, Math.ceil(requested * 0.4)));
      return {
        action: "honest_partial",
        reasons: reasons.length > 0 ? reasons : ["human_save_failed"],
        userMessage: buildHumanQualityPartialMessage(partialCap, requested, reasons),
        salvageableCount: partialCap,
        wouldSaveConfidence,
        replayConfidence,
        worldCoherenceOk,
        stubUnderfill,
      };
    }
  }

  if (
    input.committedWorldHardLock === true &&
    (input.humanSavePassed === false ||
      input.worldProofFailed === true ||
      reasons.includes("world_proof_failed") ||
      reasons.includes("intent_fidelity_failed")) &&
    count > Math.min(12, Math.ceil(requested * 0.4))
  ) {
    const partialCap = Math.min(count, Math.min(12, Math.ceil(requested * 0.4)));
    return {
      action: "honest_partial",
      reasons: reasons.length > 0 ? reasons : ["world_proof_failed"],
      userMessage: `Found ${partialCap} track${partialCap === 1 ? "" : "s"} that genuinely fit this world — publishing only those rather than padding with mismatched filler.`,
      salvageableCount: partialCap,
      wouldSaveConfidence,
      replayConfidence,
      worldCoherenceOk,
      stubUnderfill,
    };
  }

  return {
    action: "pass",
    reasons: weakWorld && !reasons.includes("human_save_failed") && !reasons.includes("intent_fidelity_failed")
      ? ["world_soft_warn"]
      : [],
    userMessage: null,
    salvageableCount: count,
    wouldSaveConfidence,
    replayConfidence,
    worldCoherenceOk,
    stubUnderfill: false,
  };
}
