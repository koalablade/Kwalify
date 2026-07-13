/**

 * Single writable owner of delivery-track arrays.

 * All mutations register with PipelineAuthoritySession automatically.

 */



import { DELIVERY_OWNER } from "./types";

import type { DeliveryTrack, PipelineMutationType } from "./types";

import type { PipelineAuthoritySession } from "./session";

import { PipelineAuthorityFrozenError } from "./errors";

import { cloneFrozenTrackSnapshot, deepFreezeTrackArray } from "./track-freeze";



export type PipelineDeliveryBufferOptions = {

  owner?: string;

};



export class PipelineDeliveryBuffer<T extends DeliveryTrack> {

  private tracks_: T[] = [];

  private readonly owner: string;



  constructor(

    private readonly session: PipelineAuthoritySession,

    opts: PipelineDeliveryBufferOptions = {},

  ) {

    this.owner = opts.owner ?? DELIVERY_OWNER;

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

    const next = deepFreezeTrackArray(after) as T[];

    this.session.recordMutation({

      stage,

      reason,

      owner: this.owner,

      mutationType,

      before,

      after: next,

    });

    this.tracks_ = next;

    return this.tracks_;

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


