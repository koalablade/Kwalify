/**
 * Track persistence memory — stickiness from strong emotional playlist contexts (decays, capped).
 */

import type { TrackGenreClassification } from "../../lib/genre-taxonomy";

const MAX_STICKINESS = 0.35;
const DECAY_PER_SLOT = 0.88;
const BOOST_PER_APPEARANCE = 0.06;

export interface TrackPersistenceStore {
  stickinessByTrack: Map<string, number>;
  strongContextCount: number;
}

export function buildTrackPersistenceMemory(opts: {
  recentPlaylistTrackIds: string[][];
  classifications: Map<string, TrackGenreClassification>;
  emotionalTrackIds?: string[];
}): TrackPersistenceStore {
  const stickinessByTrack = new Map<string, number>();
  const playlists = opts.recentPlaylistTrackIds.slice(0, 12);

  playlists.forEach((ids, slotIndex) => {
    const decay = Math.pow(DECAY_PER_SLOT, slotIndex);
    const weight = decay * (slotIndex === 0 ? 1.15 : 1);
    for (const id of ids) {
      const prev = stickinessByTrack.get(id) ?? 0;
      const next = Math.min(MAX_STICKINESS, prev + BOOST_PER_APPEARANCE * weight);
      stickinessByTrack.set(id, next);
    }
  });

  for (const id of opts.emotionalTrackIds ?? []) {
    const prev = stickinessByTrack.get(id) ?? 0;
    stickinessByTrack.set(id, Math.min(MAX_STICKINESS, prev + 0.08));
  }

  return {
    stickinessByTrack,
    strongContextCount: stickinessByTrack.size,
  };
}

export function persistenceStickiness(
  trackId: string,
  store: TrackPersistenceStore
): number {
  return store.stickinessByTrack.get(trackId) ?? 0;
}
