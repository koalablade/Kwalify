/**
 * V41 — Contract composition metadata carried on candidates through the pipeline.
 */

import type { PlaylistContract } from "./types";

export type ContractCompositionMeta = {
  contractScore: number;
  admissible: boolean;
  /** Per-dimension fit 0–1 (tension axes, must/prefer dimensions). */
  axisScores: Record<string, number>;
  /** Dimensions above activation threshold. */
  axesActive: string[];
  /** Strength when multiple required dimensions co-occur. */
  intersectionStrength: number;
  mustMatches: string[];
  preferMatches: string[];
  violations: string[];
};

export type ContractCompositionContext = {
  enabled: boolean;
  contract: PlaylistContract;
  deferredWorldGate: boolean;
};

/** V41 authority active — compound preserve_both and/or deferred world gate. */
export function contractCompositionAuthorityActive(
  ctx: ContractCompositionContext | undefined,
): boolean {
  return ctx?.enabled === true;
}

export type ContractCompositionTrack = {
  trackId: string;
  contractCompositionMeta?: ContractCompositionMeta;
};

export function getContractCompositionMeta(
  track: ContractCompositionTrack,
): ContractCompositionMeta | undefined {
  return track.contractCompositionMeta;
}

export function requiredContractDimensions(contract: PlaylistContract): string[] {
  const dims = new Set<string>();
  for (const t of contract.tension) {
    if (t.resolution === "preserve_both") {
      dims.add(t.axes[0]);
      dims.add(t.axes[1]);
    }
  }
  for (const g of contract.must.genres) {
    if (g.confidence >= 0.55) dims.add(`must:${g.value}`);
  }
  for (const e of contract.must.eras) {
    if (e.confidence >= 0.55) dims.add(`must:era:${e.value}`);
  }
  for (const e of contract.prefer.energy) dims.add(`prefer:energy:${e.value}`);
  for (const m of contract.prefer.moods) dims.add(`prefer:mood:${m.value}`);
  return [...dims];
}
