/**
 * Genre Leak Detector — identifies anti-genre tracks that slipped
 * into the final playlist despite the scene's antiGenres constraint.
 *
 * "Leakage" is any track whose root genre belongs to the scene's antiGenres list.
 * The detector reports count, percentage, and the leaking track IDs.
 */

import type { SemanticSceneVector } from "./semantic-scene-engine";
import type { TrackGenreClassification } from "./genre-taxonomy";

export interface GenreLeakReport {
  leakCount: number;
  leakPct: number;
  leakedGenres: string[];
  leakedTrackIds: string[];
  /** True if leakage is within acceptable tolerance (≤5%) */
  acceptable: boolean;
  severity: "none" | "low" | "moderate" | "high" | "critical";
}

interface TrackStub {
  trackId: string;
  genrePrimary?: string | null;
}

function leakSeverity(pct: number): GenreLeakReport["severity"] {
  if (pct === 0) return "none";
  if (pct <= 0.05) return "low";
  if (pct <= 0.12) return "moderate";
  if (pct <= 0.25) return "high";
  return "critical";
}

/**
 * Detect anti-genre tracks in the final playlist for a given scene.
 */
export function detectGenreLeaks(
  tracks: TrackStub[],
  classifications: Map<string, TrackGenreClassification>,
  scene: SemanticSceneVector
): GenreLeakReport {
  if (!tracks.length || !scene.antiGenres?.length) {
    return {
      leakCount: 0,
      leakPct: 0,
      leakedGenres: [],
      leakedTrackIds: [],
      acceptable: true,
      severity: "none",
    };
  }

  const antiGenreSet = new Set<string>(scene.antiGenres);
  const leakedGenreCounts: Record<string, number> = {};
  const leakedTrackIds: string[] = [];

  for (const track of tracks) {
    const cls = classifications.get(track.trackId);
    const genre = cls?.genrePrimary ?? track.genrePrimary ?? "";
    if (genre && antiGenreSet.has(genre)) {
      leakedTrackIds.push(track.trackId);
      leakedGenreCounts[genre] = (leakedGenreCounts[genre] ?? 0) + 1;
    }
  }

  const leakCount = leakedTrackIds.length;
  const leakPct = leakCount / tracks.length;

  // Sort leaked genres by frequency
  const leakedGenres = Object.entries(leakedGenreCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);

  return {
    leakCount,
    leakPct,
    leakedGenres,
    leakedTrackIds,
    acceptable: leakPct <= 0.05,
    severity: leakSeverity(leakPct),
  };
}

/**
 * Generate a human-readable leak summary for debug panels.
 */
export function formatLeakSummary(report: GenreLeakReport): string {
  if (report.severity === "none") return "No genre leakage detected";
  const pctStr = `${Math.round(report.leakPct * 100)}%`;
  const genreStr = report.leakedGenres.join(", ");
  return `${report.leakCount} leak${report.leakCount !== 1 ? "s" : ""} (${pctStr}) — genres: ${genreStr}`;
}
