/**
 * V3 buildV3CandidatePool input routing.
 * When V28 pre-V3 world sampling expands contractGuardedScoredPool but
 * retrievalSafetyExpanded selects the smaller safetyRetrievalPool as candidate.pool,
 * merge the contract universe so V3 receives the expanded pool (deduped, capped).
 */

export type V3InputPoolRoutingReason =
  | "hard_lock_verified"
  | "pre_v3_contract_universe_merge"
  | "contract_deferred_universe"
  | "candidate_pool"
  | "contract_guarded_fallback";

export type ResolveV3BuildInputPoolParams<T extends { trackId: string }> = {
  hardLockVerifiedCandidatePool: T[] | null;
  preV3WorldSamplingApplied: boolean;
  retrievalSafetyExpanded: boolean;
  contractDeferredWorldGate?: boolean;
  contractGuardedScoredPool: T[];
  safetyRetrievalPool: T[];
  candidatePool: T[];
  capContractPool: (pool: T[]) => T[];
  mergeUniverse: (primary: T[], secondary: T[]) => T[];
};

export type ResolveV3BuildInputPoolResult<T extends { trackId: string }> = {
  inputPool: T[];
  routingReason: V3InputPoolRoutingReason;
};

export function resolveV3BuildInputPool<T extends { trackId: string }>(
  params: ResolveV3BuildInputPoolParams<T>,
): ResolveV3BuildInputPoolResult<T> {
  const {
    hardLockVerifiedCandidatePool,
    preV3WorldSamplingApplied,
    retrievalSafetyExpanded,
    contractDeferredWorldGate,
    contractGuardedScoredPool,
    safetyRetrievalPool,
    candidatePool,
    capContractPool,
    mergeUniverse,
  } = params;

  if (hardLockVerifiedCandidatePool && hardLockVerifiedCandidatePool.length > 0) {
    return {
      inputPool: hardLockVerifiedCandidatePool,
      routingReason: "hard_lock_verified",
    };
  }

  if (
    preV3WorldSamplingApplied &&
    retrievalSafetyExpanded &&
    contractGuardedScoredPool.length > 0
  ) {
    return {
      inputPool: mergeUniverse(
        capContractPool(contractGuardedScoredPool),
        safetyRetrievalPool,
      ),
      routingReason: "pre_v3_contract_universe_merge",
    };
  }

  if (contractDeferredWorldGate && contractGuardedScoredPool.length > 0) {
    return {
      inputPool: capContractPool(contractGuardedScoredPool),
      routingReason: "contract_deferred_universe",
    };
  }

  if (candidatePool.length > 0) {
    return {
      inputPool: candidatePool,
      routingReason: "candidate_pool",
    };
  }

  return {
    inputPool: contractGuardedScoredPool,
    routingReason: "contract_guarded_fallback",
  };
}
