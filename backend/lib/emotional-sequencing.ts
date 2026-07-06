import { separateAdjacentArtists } from "./emotion";
import { isExperimentEnabled } from "./experiment-flags";

export type EmotionalPhase = "intro" | "build" | "peak" | "cooldown";

export type TrackRole = "anchor" | "build" | "peak" | "release" | "transition";

export interface EmotionalSequencePhases {
  intro: number;
  build: number;
  peak: number;
  cooldown: number;
}

export interface EmotionalSequenceResult<T> {
  tracks: T[];
  phases: EmotionalSequencePhases;
}

type SequencableTrack = {
  trackId: string;
  artistName: string;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  narrativeRole?: string;
  trackRole?: TrackRole;
  score?: number;
  scoringDebug?: { sceneMatch?: number; finalScore?: number };
  emphasisAnchor?: boolean;
};

function energyOf(t: SequencableTrack): number {
  return t.energy ?? 0.5;
}

function valenceOf(t: SequencableTrack): number {
  return t.valence ?? 0.5;
}

function tempoOf(t: SequencableTrack): number {
  return t.tempo != null ? Math.min(1, t.tempo / 200) : 0.5;
}

function tempoBucket(t: SequencableTrack): number {
  const bpm = t.tempo ?? 120;
  return Math.floor(bpm / 25);
}

function phaseCounts(n: number): EmotionalSequencePhases {
  if (n < 4) {
    return { intro: n, build: 0, peak: 0, cooldown: 0 };
  }
  let intro = Math.max(1, Math.round(n * 0.2));
  let build = Math.max(1, Math.round(n * 0.25));
  let peak = Math.max(1, Math.round(n * 0.3));
  let cooldown = n - intro - build - peak;
  while (cooldown < 1 && peak > 1) {
    peak--;
    cooldown++;
  }
  while (cooldown < 1 && build > 1) {
    build--;
    cooldown++;
  }
  return { intro, build, peak, cooldown };
}

function phaseEnergyTarget(phase: EmotionalPhase, targetEnergy: number): number {
  if (phase === "intro") return Math.max(0.2, targetEnergy - 0.22);
  if (phase === "build") return targetEnergy;
  if (phase === "peak") return Math.min(1, targetEnergy + 0.12);
  return Math.max(0.25, targetEnergy - 0.15);
}

function similarToLast(
  last: SequencableTrack,
  cand: SequencableTrack,
  streak: number
): boolean {
  if (streak < 2) return false;
  const eClose = Math.abs(energyOf(cand) - energyOf(last)) < 0.07;
  const vClose = Math.abs(valenceOf(cand) - valenceOf(last)) < 0.08;
  const tSame = tempoBucket(cand) === tempoBucket(last);
  return eClose && (vClose || tSame);
}

function phaseEnergyTolerance(phase: EmotionalPhase): number {
  if (phase === "intro") return 0.18;
  if (phase === "build") return 0.22;
  if (phase === "peak") return 0.2;
  return 0.18;
}

function withinPhaseEnergy(
  track: SequencableTrack,
  phase: EmotionalPhase,
  targetEnergy: number
): boolean {
  const target = phaseEnergyTarget(phase, targetEnergy);
  return Math.abs(energyOf(track) - target) <= phaseEnergyTolerance(phase);
}

/** Max 2 consecutive tracks outside phase energy band — swap within phase. */
function enforcePhaseDriftGuard<T extends SequencableTrack>(
  tracks: T[],
  phase: EmotionalPhase,
  targetEnergy: number
): T[] {
  if (tracks.length <= 2) return [...tracks];

  const result = [...tracks];
  let driftStreak = 0;

  for (let i = 0; i < result.length; i++) {
    const ok = withinPhaseEnergy(result[i]!, phase, targetEnergy);
    if (ok) {
      driftStreak = 0;
      continue;
    }

    driftStreak++;
    if (driftStreak <= 2) continue;

    let swapIdx = -1;
    let bestDist = Infinity;
    for (let j = i + 1; j < result.length; j++) {
      if (!withinPhaseEnergy(result[j]!, phase, targetEnergy)) continue;
      const dist = Math.abs(energyOf(result[j]!) - energyOf(result[i]!));
      if (dist < bestDist) {
        bestDist = dist;
        swapIdx = j;
      }
    }
    if (swapIdx < 0) {
      for (let j = 0; j < i; j++) {
        if (!withinPhaseEnergy(result[j]!, phase, targetEnergy)) continue;
        const dist = Math.abs(energyOf(result[j]!) - energyOf(result[i]!));
        if (dist < bestDist) {
          bestDist = dist;
          swapIdx = j;
        }
      }
    }

    if (swapIdx >= 0) {
      const tmp = result[i]!;
      result[i] = result[swapIdx]!;
      result[swapIdx] = tmp;
      driftStreak = withinPhaseEnergy(result[i]!, phase, targetEnergy) ? 0 : 1;
    } else {
      driftStreak = 2;
    }
  }

  return result;
}

function orderPhaseWithContrast<T extends SequencableTrack>(
  tracks: T[],
  phase: EmotionalPhase,
  targetEnergy: number
): T[] {
  if (tracks.length <= 2) return [...tracks];

  const remaining = [...tracks];
  const target = phaseEnergyTarget(phase, targetEnergy);
  remaining.sort(
    (a, b) => Math.abs(energyOf(a) - target) - Math.abs(energyOf(b) - target)
  );

  const result: T[] = [remaining.shift()!];
  let streak = 1;

  while (remaining.length > 0) {
    const last = result[result.length - 1]!;
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]!;
      const eDiff = Math.abs(energyOf(cand) - energyOf(last));
      const vDiff = Math.abs(valenceOf(cand) - valenceOf(last));
      const tDiff = tempoBucket(cand) !== tempoBucket(last) ? 1 : 0;

      const oscillation =
        eDiff >= 0.05 && eDiff <= 0.28 ? 0.55 : eDiff < 0.05 ? -0.35 : 0.25;
      const valenceBreak = vDiff >= 0.06 ? 0.2 : -0.15;
      const tempoBreak = tDiff * 0.25;
      const streakPenalty = similarToLast(last, cand, streak) ? -0.6 : 0;
      const targetPull = -Math.abs(energyOf(cand) - target) * 0.15;

      const score = oscillation + valenceBreak + tempoBreak + streakPenalty + targetPull;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const picked = remaining.splice(bestIdx, 1)[0]!;
    if (Math.abs(energyOf(picked) - energyOf(last)) < 0.07) streak++;
    else streak = 1;
    result.push(picked);
  }

  return enforcePhaseDriftGuard(result, phase, targetEnergy);
}

function roleForPosition(
  phase: EmotionalPhase,
  index: number,
  count: number
): TrackRole {
  if (count <= 0) return "transition";
  if (phase === "intro") return index === 0 ? "anchor" : "transition";
  if (phase === "build") {
    if (index === count - 1) return "transition";
    return "build";
  }
  if (phase === "peak") {
    if (count === 1) return "peak";
    if (index === 0) return "build";
    if (index === count - 1) return "release";
    return "peak";
  }
  return index === 0 ? "release" : "release";
}

function emphasisScore(t: SequencableTrack): number {
  const match = t.score ?? t.scoringDebug?.finalScore ?? 0.7;
  const scene = t.scoringDebug?.sceneMatch ?? 0.5;
  return match * 0.6 + scene * 0.4;
}

/** Tag peak-phase emphasis anchors — ordering unchanged. */
function markEmphasisAnchors<T extends SequencableTrack>(
  tracks: T[],
  phases: EmotionalSequencePhases
): T[] {
  if (!tracks.length) return tracks;

  const peakStart = phases.intro + phases.build;
  const peakEnd = peakStart + phases.peak;
  let candidateIndices: number[] = [];

  if (phases.peak > 0) {
    for (let i = peakStart; i < peakEnd && i < tracks.length; i++) {
      candidateIndices.push(i);
    }
  }

  if (candidateIndices.length === 0) {
    candidateIndices = tracks.map((_, i) => i);
  }

  const ranked = candidateIndices
    .map((i) => ({ i, s: emphasisScore(tracks[i]!) }))
    .sort((a, b) => b.s - a.s);

  const anchorCount = Math.max(1, Math.min(2, ranked.length));
  const anchorSet = new Set(ranked.slice(0, anchorCount).map((r) => r.i));

  return tracks.map((t, i) => ({
    ...t,
    emphasisAnchor: anchorSet.has(i) ? true : undefined,
  }));
}

function tagPhaseAndRole<T extends SequencableTrack>(
  tracks: T[],
  phase: EmotionalPhase
): T[] {
  return tracks.map((t, i) => ({
    ...t,
    narrativeRole: phase,
    trackRole: roleForPosition(phase, i, tracks.length),
  }));
}

/**
 * Reorders the final playlist into intro → build → peak → cooldown.
 * Within each phase, injects contrast so energy/tempo/valence do not plateau.
 */
export function sequencePlaylistEmotionally<T extends SequencableTrack>(
  tracks: T[],
  targetEnergy: number
): EmotionalSequenceResult<T> {
  if (tracks.length < 2) {
    const single = tracks.map((t) => ({
      ...t,
      narrativeRole: "intro" as const,
      trackRole: "anchor" as TrackRole,
      emphasisAnchor: true,
    }));
    return {
      tracks: separateAdjacentArtists(single),
      phases: { intro: tracks.length, build: 0, peak: 0, cooldown: 0 },
    };
  }

  const counts = phaseCounts(tracks.length);
  const pool = [...tracks];
  const used = new Set<string>();

  const takeLowest = (n: number) => {
    const picked = [...pool]
      .filter((t) => !used.has(t.trackId))
      .sort((a, b) => energyOf(a) - energyOf(b))
      .slice(0, n);
    picked.forEach((t) => used.add(t.trackId));
    return picked;
  };

  const takeHighest = (n: number) => {
    const picked = [...pool]
      .filter((t) => !used.has(t.trackId))
      .sort((a, b) => energyOf(b) - energyOf(a))
      .slice(0, n);
    picked.forEach((t) => used.add(t.trackId));
    return picked;
  };

  const introRaw = takeLowest(counts.intro);
  const peakTarget = Math.min(1, targetEnergy + 0.12);
  const peakRaw = takeHighest(counts.peak).sort(
    (a, b) =>
      Math.abs(energyOf(a) - peakTarget) - Math.abs(energyOf(b) - peakTarget)
  );
  const buildRaw = [...pool]
    .filter((t) => !used.has(t.trackId))
    .sort((a, b) => energyOf(a) - energyOf(b))
    .slice(0, counts.build);
  buildRaw.forEach((t) => used.add(t.trackId));
  const cooldownRaw = [...pool]
    .filter((t) => !used.has(t.trackId))
    .sort((a, b) => energyOf(b) - energyOf(a));

  const intro = orderPhaseWithContrast(introRaw, "intro", targetEnergy);
  const build = orderPhaseWithContrast(buildRaw, "build", targetEnergy);
  const peak = orderPhaseWithContrast(peakRaw, "peak", targetEnergy);
  const cooldown = orderPhaseWithContrast(cooldownRaw, "cooldown", targetEnergy);

  const ordered = separateAdjacentArtists([
    ...tagPhaseAndRole(intro, "intro"),
    ...tagPhaseAndRole(build, "build"),
    ...tagPhaseAndRole(peak, "peak"),
    ...tagPhaseAndRole(cooldown, "cooldown"),
  ]);

  const withAnchors = markEmphasisAnchors(ordered, counts);

  return { tracks: withAnchors, phases: counts };
}

export function trackRoleLabel(role: TrackRole): string {
  const labels: Record<TrackRole, string> = {
    anchor: "Anchor",
    build: "Build",
    peak: "Peak",
    release: "Release",
    transition: "Transition",
  };
  return labels[role];
}

/** Experimental: swap first two peak-phase tracks after standard sequencing. */
function sequencePlaylistAlternative<T extends SequencableTrack>(
  tracks: T[],
  targetEnergy: number
): EmotionalSequenceResult<T> {
  const base = sequencePlaylistEmotionally(tracks, targetEnergy);
  const peakStart = base.phases.intro + base.phases.build;
  if (base.phases.peak < 2 || peakStart + 1 >= base.tracks.length) {
    return base;
  }
  const result = [...base.tracks];
  const a = peakStart;
  const b = peakStart + 1;
  const tmp = result[a]!;
  result[a] = result[b]!;
  result[b] = tmp;
  return { tracks: result, phases: base.phases };
}

/** Generation entry — respects EXPERIMENT_FLAGS alternative_sequencing at runtime. */
export function sequencePlaylistForGeneration<T extends SequencableTrack>(
  tracks: T[],
  targetEnergy: number
): EmotionalSequenceResult<T> {
  if (isExperimentEnabled("alternative_sequencing")) {
    return sequencePlaylistAlternative(tracks, targetEnergy);
  }
  return sequencePlaylistEmotionally(tracks, targetEnergy);
}
