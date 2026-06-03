/**
 * Signature Track Layer (v2 spec — Layer 1)
 *
 * Selects 5–10 "anchor tracks" that define the playlist's sonic identity.
 * These become the backbone around which the remaining tracks are arranged.
 *
 * Rules:
 *   - Ranked by combined score + emotional resonance
 *   - Max 1 track per artist
 *   - Spread across all 4 playlist phases (intro/core/peak/cooldown)
 *   - Exposed in the pipeline result for front-end highlighting
 */

export interface SignatureTrack<T extends { trackId: string }> {
  track: T;
  /** 0 = primary anchor (strongest identity), ascending = supporting */
  anchorRank: number;
  /** Which phase this anchor is assigned to */
  targetPhase: "intro" | "core" | "peak" | "cooldown";
}

type ScoredPoolTrack = {
  trackId: string;
  score: number;
  artistName?: string;
  energy?: number | null;
  valence?: number | null;
  emotionalMass?: number;
  historicalAffinity?: number;
};

/** Combined signature relevance: weighted score + emotional mass + historical affinity */
function anchorScore(t: ScoredPoolTrack): number {
  return (
    t.score * 0.6 +
    (t.emotionalMass ?? 0.3) * 0.25 +
    (t.historicalAffinity ?? 0.35) * 0.15
  );
}

/**
 * Selects signature tracks from a sorted candidate pool.
 *
 * Phase assignment distributes anchors so the playlist feels intentional:
 *   anchor 0        → peak        (strongest defines the climax)
 *   anchors 1–2     → core        (second & third tier own the main body)
 *   anchor 3        → intro       (fourth sets the opening tone)
 *   anchor 4        → cooldown    (fifth closes the loop)
 *   anchors 5–9     → distributed evenly across remaining phase slots
 */
export function selectSignatureTracks<T extends ScoredPoolTrack>(
  pool: T[],
  opts: { minCount?: number; maxCount?: number } = {}
): SignatureTrack<T>[] {
  const { minCount = 5, maxCount = 10 } = opts;
  if (pool.length === 0) return [];

  const byAnchorScore = [...pool].sort((a, b) => anchorScore(b) - anchorScore(a));
  const selected: T[] = [];
  const artistSeen = new Set<string>();

  for (const track of byAnchorScore) {
    if (selected.length >= maxCount) break;
    const artist = (track.artistName ?? track.trackId).toLowerCase();
    if (artistSeen.has(artist)) continue;
    artistSeen.add(artist);
    selected.push(track);
  }

  // Pad to minCount from remaining pool if needed
  if (selected.length < minCount) {
    const selectedIds = new Set(selected.map((t) => t.trackId));
    for (const track of byAnchorScore) {
      if (selected.length >= minCount) break;
      if (!selectedIds.has(track.trackId)) {
        selected.push(track);
        selectedIds.add(track.trackId);
      }
    }
  }

  const PHASE_SEQUENCE: SignatureTrack<T>["targetPhase"][] = [
    "peak",
    "core",
    "core",
    "intro",
    "cooldown",
    "intro",
    "core",
    "peak",
    "cooldown",
    "core",
  ];

  return selected.map((track, i) => ({
    track,
    anchorRank: i,
    targetPhase: PHASE_SEQUENCE[i] ?? "core",
  }));
}

/** Returns a Set of track IDs that are signature (anchor) tracks */
export function signatureTrackIds<T extends { trackId: string }>(
  signatures: SignatureTrack<T>[]
): Set<string> {
  return new Set(signatures.map((s) => s.track.trackId));
}
