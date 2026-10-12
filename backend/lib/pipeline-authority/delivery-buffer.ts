/**

 * Single writable owner of delivery-track arrays.

 * All mutations register with PipelineAuthoritySession automatically.

 */



import { DELIVERY_OWNER } from "./types";

import { traceSelectionStage } from "../selection-trace";

import type { DeliveryTrack, PipelineMutationType } from "./types";

import type { PipelineAuthoritySession } from "./session";

import { PipelineAuthorityFrozenError } from "./errors";

import { cloneFrozenTrackSnapshot, deepFreezeTrackArray } from "./track-freeze";



export type PipelineDeliveryBufferOptions = {

  owner?: string;

  /**

   * Stages that reject individual songs (quality / genre / era / world purity). Once one of them

   * removes a song, no other stage (refill, repair, completion, opener locks) may add it back;

   * guard stages themselves may still re-evaluate it.

   */

  guardStages?: readonly string[];

  /** Stages that re-check a song themselves (e.g. the world purity gate) and may re-admit it. */

  reEvaluatorStages?: readonly string[];

};



export type BlockedGuardReAdd = { stage: string; trackId: string; removedBy: string[] };



export class PipelineDeliveryBuffer<T extends DeliveryTrack> {

  private tracks_: T[] = [];

  private readonly owner: string;

  /** Stages that removed each track id — lets late refills avoid re-adding what a guard removed. */

  private readonly removedByStage = new Map<string, Set<string>>();

  private readonly guardStages: ReadonlySet<string>;

  private readonly reEvaluatorStages: ReadonlySet<string>;

  private readonly blockedReAdds: BlockedGuardReAdd[] = [];



  constructor(

    private readonly session: PipelineAuthoritySession,

    opts: PipelineDeliveryBufferOptions = {},

  ) {

    this.owner = opts.owner ?? DELIVERY_OWNER;

    this.guardStages = new Set(opts.guardStages ?? []);

    this.reEvaluatorStages = new Set(opts.reEvaluatorStages ?? []);

  }



  /** Returns a deep-frozen shallow copy — array and track objects cannot mutate delivery state. */

  get tracks(): T[] {

    return cloneFrozenTrackSnapshot(this.tracks_);

  }



  get trackCount(): number {

    return this.tracks_.length;

  }



  getTracks(): T[] {

    return cloneFrozenTrackSnapshot(this.tracks_);

  }



  /** Re-adds of guard-rejected songs that were blocked (diagnostics). */

  blockedGuardReAdds(): readonly BlockedGuardReAdd[] {

    return this.blockedReAdds.slice();

  }



  /** Track ids that any of these stages removed at some point (still readable after the freeze). */

  trackIdsRemovedBy(stages: readonly string[]): Set<string> {

    const out = new Set<string>();

    for (const [trackId, removedBy] of this.removedByStage) {

      if (stages.some((stage) => removedBy.has(stage))) out.add(trackId);

    }

    return out;

  }



  private assertWritable(stage: string, reason: string): void {

    if (this.session.isTerminalFrozen()) {

      throw new PipelineAuthorityFrozenError(stage, reason);

    }

  }



  private commit(

    stage: string,

    reason: string,

    mutationType: PipelineMutationType,

    before: readonly T[],

    after: readonly T[],

  ): T[] {

    this.assertWritable(stage, reason);

    const admitted = this.withoutGuardRejectedReAdds(stage, before, after);

    const next = deepFreezeTrackArray(admitted) as T[];

    const kept = new Set(admitted.map((track) => track.trackId));

    for (const track of before) {

      if (kept.has(track.trackId)) continue;

      const stages = this.removedByStage.get(track.trackId) ?? new Set<string>();

      stages.add(stage);

      this.removedByStage.set(track.trackId, stages);

    }

    this.session.recordMutation({

      stage,

      reason,

      owner: this.owner,

      mutationType,

      before,

      after: next,

    });

    this.tracks_ = next;

    traceSelectionStage(`delivery.${stage}`, next as unknown as Array<{ trackId: string }>, { reason, mutationType });

    return this.tracks_;

  }



  /** Songs a non-guard stage newly adds that a guard stage already rejected are dropped. */

  private withoutGuardRejectedReAdds(stage: string, before: readonly T[], after: readonly T[]): readonly T[] {

    if (this.guardStages.size === 0 || this.guardStages.has(stage) || this.reEvaluatorStages.has(stage)) return after;

    const present = new Set(before.map((track) => track.trackId));

    let blocked = false;

    const admitted = after.filter((track) => {

      if (present.has(track.trackId)) return true;

      const removedBy = [...(this.removedByStage.get(track.trackId) ?? [])].filter((s) => this.guardStages.has(s));

      if (removedBy.length === 0) return true;

      this.blockedReAdds.push({ stage, trackId: track.trackId, removedBy });

      blocked = true;

      return false;

    });

    return blocked ? admitted : after;

  }



  replaceTracks(stage: string, reason: string, next: readonly T[]): T[] {

    return this.commit(stage, reason, "replace", this.tracks_, next);

  }



  appendTracks(stage: string, reason: string, items: readonly T[]): T[] {

    if (items.length === 0) return this.tracks_;

    return this.commit(stage, reason, "append", this.tracks_, [...this.tracks_, ...items]);

  }



  removeTracks(stage: string, reason: string, trackIds: ReadonlySet<string>): T[] {

    return this.filterTracks(stage, reason, (track) => !trackIds.has(track.trackId));

  }



  filterTracks(stage: string, reason: string, predicate: (track: T, index: number) => boolean): T[] {

    return this.commit(stage, reason, "filter", this.tracks_, this.tracks_.filter(predicate));

  }



  reorderTracks(

    stage: string,

    reason: string,

    compareFn: (a: T, b: T) => number,

  ): T[] {

    return this.commit(stage, reason, "reorder", this.tracks_, [...this.tracks_].sort(compareFn));

  }



  truncateTracks(stage: string, reason: string, maxLength: number): T[] {

    return this.commit(stage, reason, "truncate", this.tracks_, this.tracks_.slice(0, maxLength));

  }



  init(stage: string, reason: string, initial: readonly T[]): T[] {

    return this.commit(stage, reason, "replace", [], initial);

  }

}



export function createPipelineDeliveryBuffer<T extends DeliveryTrack>(

  session: PipelineAuthoritySession,

  opts?: PipelineDeliveryBufferOptions,

): PipelineDeliveryBuffer<T> {

  return new PipelineDeliveryBuffer(session, opts);

}


