import type { LockedIntent } from "./intent";
import type { ScoredTrack } from "./v3-score";

export interface PickingConfig {
  diversityRatio: {
    core: number;
    secondary: number;
    exploration: number;
  };
  targetCount?: number;
  seed?: string;
}

type PickTrackLike = {
  trackId: string;
  artistName?: string;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  primarySubgenre?: string | null;
  energy?: number | null;
  tempo?: number | null;
};

function seededUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function energyBand(track: PickTrackLike): string {
  const energy = track.energy ?? 0.5;
  if (energy < 0.38) return "low";
  if (energy > 0.68) return "high";
  return "medium";
}

function clusterKey(track: PickTrackLike): string {
  return `${track.primarySubgenre ?? track.genrePrimary ?? track.genreFamily ?? "unknown"}:${energyBand(track)}`;
}

function weightedPick<TTrack extends PickTrackLike>(
  pool: Array<ScoredTrack<TTrack>>,
  seed: string,
  clusterCounts: Map<string, number>,
  artistCounts: Map<string, number>
): ScoredTrack<TTrack> | null {
  const available = pool.filter(({ track }) =>
    (clusterCounts.get(clusterKey(track)) ?? 0) < 2 &&
    (artistCounts.get((track.artistName ?? "").toLowerCase()) ?? 0) < 2
  );
  if (available.length === 0) return null;
  const total = available.reduce((sum, item) => {
    const repetitionPenalty = (clusterCounts.get(clusterKey(item.track)) ?? 0) * 0.12;
    const diversityBoost = clusterCounts.has(clusterKey(item.track)) ? 0 : 0.08;
    return sum + Math.max(0.05, item.score + diversityBoost - repetitionPenalty);
  }, 0);
  let cursor = seededUnit(seed) * total;
  for (const item of available) {
    const repetitionPenalty = (clusterCounts.get(clusterKey(item.track)) ?? 0) * 0.12;
    const diversityBoost = clusterCounts.has(clusterKey(item.track)) ? 0 : 0.08;
    cursor -= Math.max(0.05, item.score + diversityBoost - repetitionPenalty);
    if (cursor <= 0) return item;
  }
  return available[available.length - 1] ?? null;
}

function pickTracks<TTrack extends PickTrackLike>(
  tracks: Array<ScoredTrack<TTrack>>,
  config: PickingConfig
): Array<ScoredTrack<TTrack>> {
  const targetCount = config.targetCount ?? Math.min(50, tracks.length);
  const ranked = [...tracks].sort((a, b) => b.score - a.score);
  const coreEnd = Math.max(1, Math.ceil(ranked.length * 0.35));
  const secondaryEnd = Math.max(coreEnd + 1, Math.ceil(ranked.length * 0.75));
  const coreTarget = Math.ceil(targetCount * config.diversityRatio.core);
  const secondaryTarget = Math.ceil(targetCount * config.diversityRatio.secondary);
  const explorationTarget = Math.max(0, targetCount - coreTarget - secondaryTarget);
  const bands = [
    { name: "core", target: coreTarget, pool: ranked.slice(0, coreEnd) },
    { name: "secondary", target: secondaryTarget, pool: ranked.slice(coreEnd, secondaryEnd) },
    { name: "exploration", target: explorationTarget, pool: ranked.slice(secondaryEnd) },
  ];

  const selected: Array<ScoredTrack<TTrack>> = [];
  const selectedIds = new Set<string>();
  const clusterCounts = new Map<string, number>();
  const artistCounts = new Map<string, number>();

  const add = (item: ScoredTrack<TTrack>): boolean => {
    if (selected.length >= targetCount || selectedIds.has(item.trackId)) return false;
    selected.push(item);
    selectedIds.add(item.trackId);
    const c = clusterKey(item.track);
    clusterCounts.set(c, (clusterCounts.get(c) ?? 0) + 1);
    const artist = (item.track.artistName ?? "").toLowerCase();
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    return true;
  };

  for (const band of bands) {
    let attempts = 0;
    const start = selected.length;
    while (selected.length - start < band.target && attempts < band.pool.length * 4) {
      const pick = weightedPick(
        band.pool.filter((item) => !selectedIds.has(item.trackId)),
        `${config.seed ?? "cssp"}:${band.name}:${attempts}:${selected.length}`,
        clusterCounts,
        artistCounts
      );
      if (!pick) break;
      add(pick);
      attempts++;
    }
  }

  for (const item of ranked) {
    if (selected.length >= targetCount) break;
    add(item);
  }

  return selected;
}

function orderTracks<TTrack extends PickTrackLike>(
  tracks: Array<ScoredTrack<TTrack>>,
  intent: LockedIntent
): Array<ScoredTrack<TTrack>> {
  void intent;
  const sorted = [...tracks].sort((a, b) => {
    const energyDelta = (a.track.energy ?? 0.5) - (b.track.energy ?? 0.5);
    if (Math.abs(energyDelta) > 0.08) return energyDelta;
    return (a.track.tempo ?? 110) - (b.track.tempo ?? 110);
  });

  if (sorted.length < 5) return sorted;

  const low = sorted.slice(0, Math.ceil(sorted.length * 0.25));
  const mid = sorted.slice(Math.ceil(sorted.length * 0.25), Math.ceil(sorted.length * 0.65));
  const high = sorted.slice(Math.ceil(sorted.length * 0.65));
  const resolve = mid.splice(Math.floor(mid.length / 2));
  return [...low, ...mid, ...high, ...resolve.reverse()];
}

export function pickAndOrder<TTrack extends PickTrackLike>(
  tracks: Array<ScoredTrack<TTrack>>,
  config: PickingConfig,
  intent: LockedIntent
): Array<ScoredTrack<TTrack>> {
  return orderTracks(pickTracks(tracks, config), intent);
}
