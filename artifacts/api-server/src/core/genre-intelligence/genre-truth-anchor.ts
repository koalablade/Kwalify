/**
 * Truth anchor — fixed canonical genre per track; adaptations are deviations only.
 */

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { TrackGenreProfile } from "../../lib/genre-taxonomy";
import { profileToClassification } from "../../lib/genre-taxonomy";

export interface GenreTruthAnchor {
  trackId: string;
  canonicalFamily: RootGenre;
  canonicalSubgenre: string;
  confidence: number;
  locked: boolean;
}

export interface TruthAnchorStore {
  anchors: Map<string, GenreTruthAnchor>;
  builtAt: number;
}

/** Build anchors only for tracks that enter scoring (avoids O(library) on 9k+ maps). */
export function buildTruthAnchorStore(
  classifications: Map<string, TrackGenreProfile | TrackGenreClassification>,
  trackIds?: Iterable<string>
): TruthAnchorStore {
  const anchors = new Map<string, GenreTruthAnchor>();
  const ids = trackIds ? new Set(trackIds) : null;
  const entries = ids
    ? [...ids].map((id) => [id, classifications.get(id)] as const)
    : [...classifications.entries()];

  for (const [trackId, c] of entries) {
    if (!c) continue;
    const cl =
      "genreFamily" in c && typeof c.genreFamily === "string"
        ? (c as TrackGenreClassification)
        : profileToClassification(c as TrackGenreProfile);
    if (cl.genreFamily === "unknown") continue;
    anchors.set(trackId, {
      trackId,
      canonicalFamily: cl.genreFamily,
      canonicalSubgenre: cl.primarySubgenre,
      confidence: cl.confidenceScore,
      locked: cl.confidenceScore >= 0.72,
    });
  }
  return { anchors, builtAt: Date.now() };
}

export function getTruthAnchor(
  store: TruthAnchorStore,
  trackId: string
): GenreTruthAnchor | undefined {
  return store.anchors.get(trackId);
}

/**
 * Clamp live classification to anchor — graph/forecast may deviate in score only,
 * not rewrite primary family when locked.
 */
export function applyTruthAnchorGuard(
  classification: TrackGenreClassification,
  anchor: GenreTruthAnchor | undefined
): { classification: TrackGenreClassification; drift: number } {
  if (!anchor) return { classification, drift: 0 };

  const familyDrift = classification.genreFamily !== anchor.canonicalFamily ? 1 : 0;
  const subDrift =
    classification.primarySubgenre !== anchor.canonicalSubgenre ? 0.35 : 0;
  const drift = Math.min(1, familyDrift * 0.7 + subDrift);

  if (anchor.locked && classification.genreFamily !== anchor.canonicalFamily) {
    return {
      classification: {
        ...classification,
        genrePrimary: anchor.canonicalFamily,
        genreFamily: anchor.canonicalFamily,
        primarySubgenre: anchor.canonicalSubgenre,
        confidenceScore: Math.max(classification.confidenceScore, anchor.confidence),
      },
      drift,
    };
  }

  if (familyDrift > 0 && !anchor.locked) {
    return {
      classification: {
        ...classification,
        genreSecondary: classification.genreFamily,
        genreFamily: anchor.canonicalFamily,
        genrePrimary: anchor.canonicalFamily,
      },
      drift,
    };
  }

  return { classification, drift };
}

export function truthAnchorDriftScore(
  store: TruthAnchorStore,
  liveClassifications: Map<string, TrackGenreClassification>
): number {
  let driftSum = 0;
  let n = 0;
  for (const [id, anchor] of store.anchors) {
    const live = liveClassifications.get(id);
    if (!live) continue;
    n++;
    if (live.genreFamily !== anchor.canonicalFamily) driftSum += 1;
    else if (live.primarySubgenre !== anchor.canonicalSubgenre) driftSum += 0.35;
  }
  return n === 0 ? 0 : Math.round((driftSum / n) * 1000) / 1000;
}
