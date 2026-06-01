import type { JourneyArc } from "./emotion-destination";

export type TrackNarrativeRole =
  | "introduction"
  | "early_build"
  | "momentum"
  | "peak"
  | "reflection"
  | "resolution";

const ROLE_SEGMENTS: { role: TrackNarrativeRole; endRatio: number }[] = [
  { role: "introduction", endRatio: 0.12 },
  { role: "early_build", endRatio: 0.28 },
  { role: "momentum", endRatio: 0.48 },
  { role: "peak", endRatio: 0.68 },
  { role: "reflection", endRatio: 0.85 },
  { role: "resolution", endRatio: 1 },
];

export function roleForIndex(index: number, total: number): TrackNarrativeRole {
  if (total <= 0) return "introduction";
  const ratio = (index + 1) / total;
  for (const seg of ROLE_SEGMENTS) {
    if (ratio <= seg.endRatio) return seg.role;
  }
  return "resolution";
}

export function assignNarrativeRoles<T>(
  tracks: T[],
  _journeyArc: JourneyArc = "default"
): Array<T & { narrativeRole: TrackNarrativeRole }> {
  const n = tracks.length;
  return tracks.map((t, i) => ({
    ...t,
    narrativeRole: roleForIndex(i, n),
  }));
}
