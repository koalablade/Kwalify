/**
 * Human Expectation Layer — post-assembly orchestrator.
 *
 * Ties the pieces together at the point a playlist has been assembled:
 *   interpret → contract → critique (editor) → (enforce) repair.
 * Returns rich diagnostics for the API and a decision on whether repair should
 * be applied. Never throws; a no-op when the flag is off.
 */

import { deriveExpectationContract, type ContractEngineSeed } from "./expectation-contract";
import { humanExpectationMode } from "./feature-flag";
import { interpretMoment } from "./moment-space";
import { compactCritique, critiquePlaylist } from "./playlist-critic";
import { repairPlaylist } from "./repair";
import { evaluateTrackAdmissibility } from "./track-admissibility";
import type { ShadowLogger } from "./shadow";
import type {
  ExpectationContract,
  ExpectationTrack,
  MomentInterpretation,
  PlaylistCritiqueResult,
  RepairResult,
} from "./types";

export interface PlaylistExpectationParams {
  vibe: string;
  seed: ContractEngineSeed;
  tracks: ExpectationTrack[];
  reservoir: ExpectationTrack[];
  targetLength: number;
  log: ShadowLogger;
  now?: Date;
}

export interface PlaylistExpectationResult {
  interpretation: MomentInterpretation;
  contract: ExpectationContract;
  critique: PlaylistCritiqueResult;
  repair: RepairResult | null;
  /** True when in enforce mode and repair produced a usable, changed playlist. */
  applied: boolean;
  /** Ordered track ids to publish when `applied` (else the original order). */
  orderedIds: string[];
  diagnostics: Record<string, unknown>;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function runPlaylistExpectation(
  p: PlaylistExpectationParams,
): PlaylistExpectationResult | null {
  const mode = humanExpectationMode();
  if (mode === "off") return null;
  try {
    const interpretation = interpretMoment(p.vibe, {
      seed: {
        energy: p.seed.energy,
        valence: p.seed.valence,
        tension: p.seed.tension,
        nostalgia: p.seed.nostalgia,
        calm: p.seed.calm,
      },
    });
    const contract = deriveExpectationContract(interpretation, p.seed);
    const critique = critiquePlaylist(p.tracks, contract, interpretation, { now: p.now });

    let repair: RepairResult | null = null;
    let applied = false;
    let orderedIds = p.tracks.map((t) => t.trackId);

    if (mode === "enforce" && critique.verdict !== "publish") {
      repair = repairPlaylist(p.tracks, p.reservoir, contract, interpretation, {
        minLength: Math.max(8, Math.floor(p.targetLength * 0.6)),
        now: p.now,
      });
      const changed =
        repair.removedIds.length > 0 || repair.addedIds.length > 0;
      const usable = repair.orderedIds.length >= Math.min(p.tracks.length, 8);
      if (changed && usable) {
        applied = true;
        orderedIds = repair.orderedIds;
      }
    }

    const openingWhy = p.tracks.slice(0, Math.min(5, p.tracks.length)).map((t) => {
      const a = evaluateTrackAdmissibility(t, contract);
      return {
        trackId: t.trackId,
        title: t.trackName ?? null,
        artist: t.artistName ?? null,
        fit: round(a.score),
        admissible: a.admissible,
        violations: a.violations,
      };
    });

    const diagnostics = {
      mode,
      interpretedMoment: {
        candidates: interpretation.candidates.slice(0, 3).map((c) => ({
          label: c.label,
          confidence: round(c.confidence),
          characteristics: c.characteristics.slice(0, 6),
        })),
        novelPrompt: interpretation.novelPrompt,
      },
      expectedAtmosphere: {
        atmosphere: contract.atmosphere,
        avoid: contract.avoid,
        genreFunction: contract.genreFunction,
        arc: contract.arc,
        lyrical: contract.lyrical,
        discovery: contract.discovery,
        era: contract.era,
        bands: {
          energy: contract.sonicBands.energy.map(round),
          valence: contract.sonicBands.valence.map(round),
          tempo: contract.sonicBands.tempo.map(round),
        },
      },
      detectedRisks: critique.failureModes.map((f) => ({
        mode: f.mode,
        severity: f.severity,
        detail: f.detail,
        count: f.trackIds.length,
      })),
      critique: compactCritique(critique),
      whyOpening: openingWhy,
      repair: repair
        ? { applied, removed: repair.removedIds.length, added: repair.addedIds.length, explanation: repair.explanation, iterations: repair.iterations }
        : null,
    };

    p.log.info({ hxl: diagnostics, vibeLen: p.vibe.length }, "human_expectation_evaluation");

    return { interpretation, contract, critique, repair, applied, orderedIds, diagnostics };
  } catch (err) {
    p.log.warn({ err }, "human_expectation_evaluation_failed");
    return null;
  }
}
