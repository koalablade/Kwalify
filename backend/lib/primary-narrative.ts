import type { PlaylistWhySummary } from "./playlist-why-summary";
import {
  wrapVersionedPrimaryNarrative,
  type VersionedPrimaryNarrative,
} from "./primary-narrative-schema";

/** Core narrative fields — schema version applied at wrap time. */
export interface PrimaryNarrative {
  momentLabel: string;
  summary: string;
  /** Derived from playlist arc structure — not a separate generation field. */
  arcSummary: string;
}

export function buildPrimaryNarrative(playlistWhy: PlaylistWhySummary): VersionedPrimaryNarrative {
  return wrapVersionedPrimaryNarrative({
    momentLabel: playlistWhy.dominantMomentLabel,
    summary: playlistWhy.summary,
    arcSummary: playlistWhy.structureExplanation,
  });
}