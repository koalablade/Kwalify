import type { JourneyArc } from "./emotion-destination";

export type TrackNarrativeRole =
  | "introduction"
  | "early_build"
  | "momentum"
  | "peak"
  | "reflection"
  | "resolution";

/**
 * v2 spec 4-phase mapping:
 *   intro     → introduction + early_build  (0–28%)
 *   core      → momentum                   (28–68%)
 *   peak      → peak                       (68–78%)
 *   cooldown  → reflection + resolution    (78–100%)
 */
export type PlaylistPhase = "intro" | "core" | "peak" | "cooldown";

const ROLE_SEGMENTS: { role: TrackNarrativeRole; endRatio: number }[] = [
  { role: "introduction", endRatio: 0.12 },
  { role: "early_build", endRatio: 0.28 },
  { role: "momentum", endRatio: 0.68 },
  { role: "peak", endRatio: 0.78 },
  { role: "reflection", endRatio: 0.90 },
  { role: "resolution", endRatio: 1 },
];

const ROLE_TO_PHASE: Record<TrackNarrativeRole, PlaylistPhase> = {
  introduction: "intro",
  early_build:  "intro",
  momentum:     "core",
  peak:         "peak",
  reflection:   "cooldown",
  resolution:   "cooldown",
};

export function roleForIndex(index: number, total: number): TrackNarrativeRole {
  if (total <= 0) return "introduction";
  const ratio = (index + 1) / total;
  for (const seg of ROLE_SEGMENTS) {
    if (ratio <= seg.endRatio) return seg.role;
  }
  return "resolution";
}

export function phaseForIndex(index: number, total: number): PlaylistPhase {
  return ROLE_TO_PHASE[roleForIndex(index, total)];
}

export function assignNarrativeRoles<T>(
  tracks: T[],
  _journeyArc: JourneyArc = "default"
): Array<T & { narrativeRole: TrackNarrativeRole; playlistPhase: PlaylistPhase }> {
  const n = tracks.length;
  return tracks.map((t, i) => ({
    ...t,
    narrativeRole: roleForIndex(i, n),
    playlistPhase: phaseForIndex(i, n),
  }));
}
