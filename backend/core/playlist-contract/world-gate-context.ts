/**
 * V39 — Resolve PlaylistContract + optional world gate for generation requests.
 */

import type { CommittedWorld } from "../committed-world";
import { resolveCommittedWorld } from "../committed-world";
import type { DecomposedIntent } from "../intent-decomposer";
import type { IntentState } from "../intent-state-engine";
import type { LockedIntent } from "../v3/intent";
import type { WorldBoundary } from "../world-boundary";
import { buildPlaylistContract } from "./build-playlist-contract";
import { assessCollapseRisk, compareContractWithWorld } from "./compare-with-world";
import { isPlaylistContractWorldGateEnabled, isPlaylistContractWorldGateEvaluationEnabled, isPlaylistContractV41Enabled } from "./feature-flag";
import { compactContract, type ContractShadowDiagnostics } from "./types";
import {
  buildWorldGateAuditDiagnostics,
  evaluateWorldGate,
  type WorldGateAuditDiagnostics,
  type WorldGateDecision,
} from "./world-gate";

export interface WorldGateLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export type WorldGateContextInput = {
  prompt: string;
  lockedIntent?: LockedIntent;
  decomposedIntent?: DecomposedIntent;
  intentState?: IntentState;
  sceneLock?: Parameters<typeof resolveCommittedWorld>[0]["sceneLock"];
  sceneAliases?: string[];
  scenePrediction?: Record<string, number>;
  primaryGenres?: string[];
};

export type WorldGateContextResult = {
  contract: ReturnType<typeof buildPlaylistContract>;
  rawWorld: CommittedWorld | null;
  effectiveWorld: CommittedWorld | null;
  gateDecision: WorldGateDecision | null;
  diagnostics: WorldGateAuditDiagnostics | null;
  shadowDiagnostics: ContractShadowDiagnostics | null;
};

export function resolveWorldGateContext(
  input: WorldGateContextInput,
  log?: WorldGateLogger,
): WorldGateContextResult {
  const rawWorld = resolveCommittedWorld({
    prompt: input.prompt,
    lockedIntent: input.lockedIntent,
    sceneLock: input.sceneLock ?? null,
    sceneAliases: input.sceneAliases,
    scenePrediction: input.scenePrediction,
    primaryGenres: input.primaryGenres,
  });
  const contract = buildPlaylistContract({
    prompt: input.prompt,
    lockedIntent: input.lockedIntent,
    decomposedIntent: input.decomposedIntent,
    intentState: input.intentState,
    committedWorld: rawWorld,
  });
  const disagreements = compareContractWithWorld(contract, rawWorld);
  const shadowDiagnostics: ContractShadowDiagnostics = {
    contract: compactContract(contract),
    disagreements,
    disagreementCount: disagreements.length,
    collapseRisk: assessCollapseRisk(contract, disagreements),
  };

  if (!isPlaylistContractWorldGateEvaluationEnabled()) {
    return {
      contract,
      rawWorld,
      effectiveWorld: rawWorld,
      gateDecision: null,
      diagnostics: null,
      shadowDiagnostics,
    };
  }

  const gateDecision = evaluateWorldGate({ contract, world: rawWorld, disagreements });
  const diagnostics = buildWorldGateAuditDiagnostics(gateDecision, contract);
  const logGate = isPlaylistContractWorldGateEnabled() || isPlaylistContractWorldGateEvaluationEnabled();
  if (logGate) {
    log?.info({ playlistContractWorldGate: diagnostics }, "playlist_contract_world_gate");
  }

  // V39 applies gate to effectiveWorld; V40 uses gate for defer detection only when V39 off
  const applyGateToWorld = isPlaylistContractWorldGateEnabled();

  return {
    contract,
    rawWorld,
    effectiveWorld: applyGateToWorld ? gateDecision.effectiveWorld : rawWorld,
    gateDecision,
    diagnostics,
    shadowDiagnostics,
  };
}

/** Soften delivery boundary when world gate deferred hard lock. */
export function softenWorldBoundaryForGate(
  boundary: WorldBoundary,
  gateDecision: WorldGateDecision | null,
): WorldBoundary {
  if (!gateDecision?.deferHardLock || !boundary.hardLock) return boundary;
  return {
    ...boundary,
    hardLock: false,
    reason: boundary.reason?.startsWith("world_gate_soft:")
      ? boundary.reason
      : `world_gate_soft:${boundary.reason ?? "boundary"}`,
  };
}
