/**
 * Human-understood gate — would a person feel Kwalify got what they meant?
 * Replaces coherence-only checks with world + opener + negation honesty.
 */

import type { CommittedWorld } from "../committed-world";
import type { CoverageLevel } from "./world-coverage";
import { coverageLevelToMaxTracks } from "./world-coverage";
import type { WorldProofResult } from "./world-proof-gate";
import type { ThesisOpenerResult } from "./thesis-opener-gate";
import type { WorldIdentityTrack } from "./world-identity-score";
import {
  resolveCulturalProfileForCommitted,
  scoreTrackWorldIdentity,
  isAnchorArtistForProfile,
} from "./world-identity-score";
import { THESIS_OPENER_UNDENIABLE_SCORE } from "./thesis-opener-gate";
import type { HumanQualityGateAction } from "./human-quality-gate";

export type HumanUnderstoodInput = {
  trackCount: number;
  requestedLength: number;
  committed: CommittedWorld | null;
  thesis: ThesisOpenerResult<WorldIdentityTrack> | null;
  worldProof: WorldProofResult | null;
  negationViolations: number;
  openerNegationViolations: number;
  coverageLevel?: CoverageLevel | null;
  tracks?: WorldIdentityTrack[];
};

const STRICT_SCENE_WORLD_IDS = new Set([
  "rainy_motorway_world",
  "rainy_drive_world",
  "80s_night_drive_world",
  "country_world",
  "gym_rock_world",
  "heavy_gym_world",
  "angry_rock_world",
  "gym_world",
]);

function isStrictSceneWorld(committed: CommittedWorld | null): boolean {
  if (!committed?.hardLock) return false;
  if (STRICT_SCENE_WORLD_IDS.has(committed.id)) return true;
  return committed.worldIds.some((id) => STRICT_SCENE_WORLD_IDS.has(id));
}

function strictSceneWorldFailures(
  tracks: WorldIdentityTrack[],
  committed: CommittedWorld,
): string[] {
  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile || tracks.length === 0) return [];
  const failures: string[] = [];
  const opener = tracks[0]!;
  const openerScore = scoreTrackWorldIdentity(opener, profile);
  const openerAnchor = isAnchorArtistForProfile(opener.artistName, profile);
  if (!openerAnchor && openerScore < THESIS_OPENER_UNDENIABLE_SCORE) {
    failures.push("thesis_opener_not_undeniable");
  }
  for (let i = 5; i < tracks.length; i++) {
    const score = scoreTrackWorldIdentity(tracks[i]!, profile);
    if (score === 0 || score < 0.45) {
      failures.push(`tail_world_violation:${i + 1}`);
      break;
    }
  }
  if (tracks.length >= 10) {
    const tenth = tracks[9]!;
    const tenthScore = scoreTrackWorldIdentity(tenth, profile);
    if (tenthScore === 0 || tenthScore < 0.45) {
      failures.push("track_10_betrays_world");
    }
  }
  return failures;
}

export type HumanUnderstoodResult = {
  action: HumanQualityGateAction;
  understood: boolean;
  reasons: string[];
  userMessage: string | null;
  salvageableCount: number;
};

export function wouldPersonFeelUnderstood(input: HumanUnderstoodInput): boolean {
  if (input.trackCount < 3) return false;
  if (input.negationViolations >= 2 || input.openerNegationViolations >= 1) return false;
  if (input.thesis && !input.thesis.passed) return false;
  if (input.worldProof && !input.worldProof.trackOnePassed) return false;
  if (input.committed?.hardLock && input.tracks && isStrictSceneWorld(input.committed)) {
    const strictFailures = strictSceneWorldFailures(input.tracks, input.committed);
    if (strictFailures.length > 0) return false;
  }
  if (input.committed?.hardLock && input.worldProof && !input.worldProof.fullPlaylistPassed) {
    return false;
  }
  if (input.committed?.hardLock && input.worldProof && !input.worldProof.passed) {
    return input.worldProof.verifiedTracks.length >= 3;
  }
  return true;
}

export function evaluateHumanUnderstoodGate(input: HumanUnderstoodInput): HumanUnderstoodResult {
  const requested = Math.max(1, input.requestedLength || 1);
  const count = Math.max(0, input.trackCount);
  const reasons: string[] = [];
  const hardLock = input.committed?.hardLock === true;
  const coverageCap =
    hardLock && input.coverageLevel
      ? coverageLevelToMaxTracks(input.coverageLevel, requested)
      : Math.min(12, Math.ceil(requested * 0.4));
  const salvageableCount = count >= 3 ? Math.min(count, coverageCap) : 0;

  if (count === 0) reasons.push("empty_playlist");
  if (count > 0 && count < 3) reasons.push("stub_underfill");
  if (input.thesis && !input.thesis.passed) reasons.push("thesis_opener_failed");
  if (input.worldProof && !input.worldProof.trackOnePassed) reasons.push("thesis_opener_failed");
  if (input.worldProof && !input.worldProof.fullPlaylistPassed) reasons.push("full_playlist_world_fail");
  if (input.worldProof && !input.worldProof.passed) reasons.push("world_proof_failed");
  if (input.openerNegationViolations >= 1) reasons.push("negation_violation");
  if (input.negationViolations >= 2) reasons.push("negation_violation");
  if (input.committed?.hardLock && input.tracks && isStrictSceneWorld(input.committed)) {
    reasons.push(...strictSceneWorldFailures(input.tracks, input.committed));
  }
  if (hardLock && input.coverageLevel === "VERY_LOW" && count > coverageCap) {
    reasons.push("very_low_world_coverage");
  }

  const understood = wouldPersonFeelUnderstood(input);

  if (!understood && count < 3) {
    return {
      action: "refuse",
      understood: false,
      reasons,
      userMessage:
        input.thesis?.refuseMessage ??
        "I couldn't assemble a playlist that genuinely fits this world. Try Discovery Mode or broaden the prompt.",
      salvageableCount: 0,
    };
  }

  if (!understood && salvageableCount >= 3) {
    return {
      action: "honest_partial",
      understood: false,
      reasons,
      userMessage:
        input.thesis?.refuseMessage ??
        `Found ${salvageableCount} track${salvageableCount === 1 ? "" : "s"} that genuinely fit this world — publishing only those rather than padding with mismatched filler.`,
      salvageableCount,
    };
  }

  if (!understood) {
    return {
      action: "refuse",
      understood: false,
      reasons,
      userMessage:
        input.thesis?.refuseMessage ??
        "This playlist would not pass a human save/replay test — the musical world doesn't hold together.",
      salvageableCount: 0,
    };
  }

  if (hardLock && input.coverageLevel && input.coverageLevel !== "HIGH" && count > coverageCap) {
    return {
      action: "honest_partial",
      understood: true,
      reasons: [...reasons, "coverage_capped"],
      userMessage: `Your library supports about ${salvageableCount} of ${requested} requested tracks without inventing coherence.`,
      salvageableCount,
    };
  }

  return {
    action: "pass",
    understood: true,
    reasons: [],
    userMessage: null,
    salvageableCount: count,
  };
}
