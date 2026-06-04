/**
 * V2 Sequencer — flow-optimized track ordering.
 *
 * After selection, reorder for smooth listening experience:
 *
 *   smoothness = tempoDelta + energyCurve + keyCompatibility + vibeContinuity
 *
 * Strategy: greedy nearest-neighbour from an energy-arc start point.
 *   - Start with a low-mid energy track to open
 *   - Build energy through the playlist (arc: rise → peak → resolve)
 *   - Minimize consecutive tempo jumps
 *   - Keep valence continuity
 *
 * Never removes tracks. Outputs the same set, reordered.
 */

interface SequenceTrack {
  trackId: string;
  energy: number | null;
  tempo: number | null;
  valence: number | null;
}

/**
 * Compute transition cost between two consecutive tracks.
 * Lower cost = smoother transition.
 */
function transitionCost(a: SequenceTrack, b: SequenceTrack): number {
  const ea = a.energy ?? 0.5;
  const eb = b.energy ?? 0.5;
  const ta = (a.tempo ?? 120) / 200;
  const tb = (b.tempo ?? 120) / 200;
  const va = a.valence ?? 0.5;
  const vb = b.valence ?? 0.5;

  const tempoDelta = Math.abs(ta - tb);
  const energyDelta = Math.abs(ea - eb);
  const valenceDelta = Math.abs(va - vb);

  // Weight: energy continuity most important, then tempo, then valence
  return energyDelta * 0.50 + tempoDelta * 0.30 + valenceDelta * 0.20;
}

/**
 * Build a target energy arc for the playlist.
 * Arc: intro (0.35) → build → peak (0.75) → resolve (0.45)
 */
function buildEnergyArc(length: number): number[] {
  if (length === 0) return [];
  const arc: number[] = [];
  for (let i = 0; i < length; i++) {
    const t = i / (length - 1 || 1);
    if (t < 0.20) {
      // Intro: build from 0.38 to 0.55
      arc.push(0.38 + (t / 0.20) * 0.17);
    } else if (t < 0.55) {
      // Core: rise to peak
      arc.push(0.55 + ((t - 0.20) / 0.35) * 0.20);
    } else if (t < 0.75) {
      // Peak zone
      arc.push(0.75 - ((t - 0.55) / 0.20) * 0.10);
    } else {
      // Resolve: wind down
      arc.push(0.65 - ((t - 0.75) / 0.25) * 0.20);
    }
  }
  return arc;
}

/**
 * Sequence tracks to minimize transition cost while following the energy arc.
 *
 * Algorithm: greedy nearest-neighbour, biased by arc position.
 * Time complexity: O(n²) — fine for playlist lengths (20-50 tracks).
 */
export function sequenceTracks<T extends SequenceTrack>(tracks: T[]): T[] {
  if (tracks.length <= 2) return tracks;

  const arc = buildEnergyArc(tracks.length);
  const remaining = [...tracks];
  const result: T[] = [];

  // Start with the track whose energy best matches arc[0]
  let bestStartIdx = 0;
  let bestStartDist = Infinity;
  for (let i = 0; i < remaining.length; i++) {
    const d = Math.abs((remaining[i]!.energy ?? 0.5) - (arc[0] ?? 0.4));
    if (d < bestStartDist) {
      bestStartDist = d;
      bestStartIdx = i;
    }
  }

  result.push(remaining[bestStartIdx]!);
  remaining.splice(bestStartIdx, 1);

  // Greedily pick next track minimizing (transition cost + arc deviation)
  while (remaining.length > 0) {
    const currentPos = result.length;
    const arcTarget = arc[currentPos] ?? 0.55;
    const last = result[result.length - 1]!;

    let bestIdx = 0;
    let bestCost = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const arcDeviation = Math.abs((candidate.energy ?? 0.5) - arcTarget);
      const transition = transitionCost(last, candidate);
      const cost = transition * 0.60 + arcDeviation * 0.40;

      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }

    result.push(remaining[bestIdx]!);
    remaining.splice(bestIdx, 1);
  }

  return result;
}

/**
 * Quick smoothness score for a playlist order (0–1, higher = smoother).
 * Used for diagnostics.
 */
export function computeSmoothnessScore(tracks: SequenceTrack[]): number {
  if (tracks.length < 2) return 1.0;
  let totalCost = 0;
  for (let i = 0; i < tracks.length - 1; i++) {
    totalCost += transitionCost(tracks[i]!, tracks[i + 1]!);
  }
  const avgCost = totalCost / (tracks.length - 1);
  return Math.max(0, 1 - avgCost * 2);
}
