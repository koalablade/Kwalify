/**
 * PlaylistContract shadow runner — Phase 2 integration.
 * Computes contract + logs disagreements; NEVER mutates output.
 */

import { resolveCommittedWorld } from "../committed-world";
import type { LockedIntent } from "../v3/intent";
import type { DecomposedIntent } from "../intent-decomposer";
import type { IntentState } from "../intent-state-engine";
import { buildPlaylistContract } from "./build-playlist-contract";
import { assessCollapseRisk, compareContractWithWorld } from "./compare-with-world";
import {
  isPlaylistContractRetrievalEnabled,
  isPlaylistContractShadowEnabled,
} from "./feature-flag";
import { compactContract, type ContractShadowDiagnostics, type PlaylistContract } from "./types";

export interface ContractShadowLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface ContractShadowInput {
  prompt: string;
  lockedIntent?: LockedIntent;
  decomposedIntent?: DecomposedIntent;
  intentState?: IntentState;
}

export interface ContractShadowResult {
  contract: PlaylistContract;
  diagnostics: ContractShadowDiagnostics;
}

/** Build contract when shadow and/or retrieval flags are on; log disagreements only in shadow mode. */
export function resolvePlaylistContractContext(
  input: ContractShadowInput,
  log: ContractShadowLogger,
): ContractShadowResult | null {
  const shadowOn = isPlaylistContractShadowEnabled();
  const retrievalOn = isPlaylistContractRetrievalEnabled();
  if (!shadowOn && !retrievalOn) return null;
  try {
    const world = resolveCommittedWorld({
      prompt: input.prompt,
      lockedIntent: input.lockedIntent,
    });
    const contract = buildPlaylistContract({
      prompt: input.prompt,
      lockedIntent: input.lockedIntent,
      decomposedIntent: input.decomposedIntent,
      intentState: input.intentState,
      committedWorld: world,
    });
    const disagreements = compareContractWithWorld(contract, world);
    const collapseRisk = assessCollapseRisk(contract, disagreements);
    const diagnostics: ContractShadowDiagnostics = {
      contract: compactContract(contract),
      disagreements,
      disagreementCount: disagreements.length,
      collapseRisk,
    };
    if (shadowOn) {
      log.info(
        {
          playlistContract: diagnostics,
          promptLen: input.prompt.length,
        },
        "playlist_contract_shadow",
      );
    }
    return { contract, diagnostics };
  } catch (err) {
    log.warn({ err }, "playlist_contract_shadow_failed");
    return null;
  }
}

/** @deprecated Use resolvePlaylistContractContext — kept for tests. */
export function runPlaylistContractShadow(
  input: ContractShadowInput,
  log: ContractShadowLogger,
): ContractShadowResult | null {
  if (!isPlaylistContractShadowEnabled()) return null;
  return resolvePlaylistContractContext(input, log);
}
