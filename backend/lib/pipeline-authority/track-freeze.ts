/**
 * Deep-freeze delivery track snapshots returned from PipelineDeliveryBuffer.
 * Internal state uses the same freezing so in-place element mutation is blocked.
 */

import type { DeliveryTrack } from "./types";

function freezePlainObject(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezePlainObject(entry)));
  }
  const source = value as Record<string, unknown>;
  const obj: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    obj[key] = freezePlainObject(source[key]);
  }
  return Object.freeze(obj);
}

export function deepFreezeDeliveryTrack<T extends DeliveryTrack>(track: T): T {
  const frozen = { ...track } as T & Record<string, unknown>;
  if (frozen.scoreBreakdown != null) {
    frozen.scoreBreakdown = freezePlainObject(frozen.scoreBreakdown);
  }
  if (frozen.scoreChannels != null) {
    frozen.scoreChannels = freezePlainObject(frozen.scoreChannels);
  }
  return Object.freeze(frozen) as T;
}

export function deepFreezeTrackArray<T extends DeliveryTrack>(tracks: readonly T[]): T[] {
  const frozen = tracks.map((track) => deepFreezeDeliveryTrack(track));
  return Object.seal(frozen) as T[];
}

export function cloneFrozenTrackSnapshot<T extends DeliveryTrack>(tracks: readonly T[]): T[] {
  return deepFreezeTrackArray(tracks);
}
