/**
 * Segment-level playlist analysis (opening, sustained, tail).
 * Observational only — does not affect generation.
 */

import type { SegmentBand } from "./types";

type TrackRow = {
  position: number;
  name: string;
  artist: string;
  misfit?: boolean;
  semanticFit?: number | null;
};

const RANGES: Array<[number, number, string]> = [
  [1, 3, "1-3 (opening)"],
  [4, 5, "4-5"],
  [6, 10, "6-10"],
  [11, 15, "11-15"],
  [16, 20, "16-20"],
  [21, 999, "21+ (tail)"],
];

export function analyzeSegments(
  tracks: TrackRow[],
  misfitPositions: Set<number>,
  semanticByPosition: Map<number, number>,
): SegmentBand[] {
  return RANGES.map(([start, end, label]) => {
    const slice = tracks.filter((t) => t.position >= start && t.position <= end);
    if (slice.length === 0) {
      return { range: label, trackCount: 0, misfitCount: 0, avgSemanticFit: null };
    }
    const misfits = slice.filter((t) => misfitPositions.has(t.position)).length;
    const fits = slice
      .map((t) => semanticByPosition.get(t.position))
      .filter((v): v is number => typeof v === "number");
    const avg = fits.length > 0 ? fits.reduce((a, b) => a + b, 0) / fits.length : null;
    let note: string | undefined;
    if (label.includes("tail") && misfits > slice.length * 0.3) {
      note = "Elevated misfits in tail segment";
    }
    if (label.includes("opening") && misfits > 0) {
      note = "Opening contains misfit tracks";
    }
    return {
      range: label,
      trackCount: slice.length,
      misfitCount: misfits,
      avgSemanticFit: avg != null ? Math.round(avg * 100) / 100 : null,
      note,
    };
  }).filter((s) => s.trackCount > 0);
}

export function detectTailCollapse(segments: SegmentBand[]): boolean {
  const opening = segments.find((s) => s.range.startsWith("1-3"));
  const tail = segments.find((s) => s.range.includes("tail"));
  if (!opening || !tail || opening.trackCount === 0 || tail.trackCount === 0) return false;
  const openingMisfitRate = opening.misfitCount / opening.trackCount;
  const tailMisfitRate = tail.misfitCount / tail.trackCount;
  return tailMisfitRate > openingMisfitRate + 0.25;
}
