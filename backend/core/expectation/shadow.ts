/**
 * Human Expectation Layer — Phase 1 shadow runner.
 *
 * Computes the moment interpretation + expectation contract and logs a compact
 * record. It NEVER mutates the response and NEVER throws: when the flag is off
 * it returns immediately, and any internal error is swallowed after logging.
 * This is the only integration point into the live pipeline for Phase 1.
 */

import { humanExpectationMode } from "./feature-flag";
import { deriveExpectationContract, type ContractEngineSeed } from "./expectation-contract";
import { interpretMoment } from "./moment-space";
import type { ExpectationContract, MomentInterpretation } from "./types";

export interface ShadowLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface ShadowResult {
  interpretation: MomentInterpretation;
  contract: ExpectationContract;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function compact(interpretation: MomentInterpretation, contract: ExpectationContract) {
  const b = contract.sonicBands;
  return {
    embedder: interpretation.embedderVersion,
    novelPrompt: interpretation.novelPrompt,
    peakSalience: round(interpretation.peakSalience),
    candidates: interpretation.candidates.slice(0, 3).map((c) => ({
      label: c.label,
      confidence: round(c.confidence),
      characteristics: c.characteristics.slice(0, 5),
    })),
    contract: {
      atmosphere: contract.atmosphere,
      avoid: contract.avoid,
      arc: contract.arc,
      lyrical: contract.lyrical,
      discovery: contract.discovery,
      era: contract.era,
      genreFunction: contract.genreFunction,
      bands: {
        energy: b.energy.map(round),
        valence: b.valence.map(round),
        tempo: b.tempo.map(round),
        acoustic: b.acoustic.map(round),
        instrumental: b.instrumental.map(round),
      },
      interpretationConfidence: round(contract.interpretationConfidence),
    },
  };
}

/**
 * Run the human-expectation analysis in shadow mode. Returns the computed
 * result (for tests / future phases) or null when disabled or on failure.
 */
export function runExpectationShadow(
  vibe: string,
  seed: ContractEngineSeed,
  log: ShadowLogger,
): ShadowResult | null {
  if (humanExpectationMode() === "off") return null;
  try {
    const interpretation = interpretMoment(vibe, {
      seed: {
        energy: seed.energy,
        valence: seed.valence,
        tension: seed.tension,
        nostalgia: seed.nostalgia,
        calm: seed.calm,
      },
    });
    const contract = deriveExpectationContract(interpretation, seed);
    log.info(
      { hxl: compact(interpretation, contract), vibeLen: vibe.length },
      "human_expectation_shadow",
    );
    return { interpretation, contract };
  } catch (err) {
    log.warn({ err }, "human_expectation_shadow_failed");
    return null;
  }
}
