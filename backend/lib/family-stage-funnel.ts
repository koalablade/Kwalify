/**
 * Family × stage funnel histograms for compound-prompt retrieval forensics.
 * Diagnosis counters only — no ranking / scoring behaviour.
 */

import { getGenreFamily } from "../core/v3/global-diversity-controller";

export const FUNNEL_FAMILIES = [
  "disco",
  "funk",
  "soul",
  "rnb",
  "pop",
  "electronic",
  "rock",
  "indie",
  "metal",
  "other",
  "unknown",
] as const;

export type FunnelFamily = (typeof FUNNEL_FAMILIES)[number];

export type FamilyHistogram = Record<string, number>;

export type StageFamilySnapshot = {
  stage: string;
  total: number;
  /** Raw genreFamily / genrePrimary labels (pre getGenreFamily). */
  raw: FamilyHistogram;
  /** Coarse families after getGenreFamily(). */
  normalized: FamilyHistogram;
  /** Intent-relevant share: disco/funk/soul/rnb vs rock/indie. */
  intentRelevantRaw: number;
  offTargetRockIndieRaw: number;
};

export type TrackClassLike = {
  genreFamily?: string | null;
  genrePrimary?: string | null;
  primarySubgenre?: string | null;
  secondarySubgenre?: string | null;
  subGenres?: string[] | null;
} | null | undefined;

function emptyHist(): FamilyHistogram {
  const hist: FamilyHistogram = {};
  for (const family of FUNNEL_FAMILIES) hist[family] = 0;
  return hist;
}

function bucketRaw(label: string | null | undefined): FunnelFamily {
  const raw = String(label ?? "").toLowerCase().replace(/\s+/g, "_").trim();
  if (!raw) return "unknown";
  if (raw.includes("disco")) return "disco";
  if (raw.includes("funk")) return "funk";
  if (raw === "soul" || raw.includes("motown") || raw.includes("disco")) return "soul";
  if (raw === "rnb" || raw === "r&b" || raw.includes("neo_soul") || raw.includes("neo-soul")) return "rnb";
  if (raw.includes("electronic") || raw.includes("house") || raw.includes("techno") || raw.includes("edm")) {
    return "electronic";
  }
  if (raw.includes("indie")) return "indie";
  if (raw.includes("metal")) return "metal";
  if (raw.includes("rock") || raw.includes("punk")) return "rock";
  if (raw.includes("pop")) return "pop";
  return "other";
}

function bucketNormalized(label: string | null | undefined): FunnelFamily {
  const family = getGenreFamily(String(label ?? "unknown"));
  return bucketRaw(family);
}

export function classifyTrackFamilyLabels(classification: TrackClassLike): {
  raw: FunnelFamily;
  normalized: FunnelFamily;
} {
  const primary =
    classification?.genreFamily ??
    classification?.genrePrimary ??
    classification?.primarySubgenre ??
    classification?.subGenres?.[0] ??
    null;
  return {
    raw: bucketRaw(primary),
    normalized: bucketNormalized(primary),
  };
}

export function histogramFamiliesForTracks<T extends { trackId: string }>(
  tracks: T[],
  classMap: Map<string, TrackClassLike> | ((trackId: string) => TrackClassLike),
  stage: string,
): StageFamilySnapshot {
  const resolve =
    typeof classMap === "function"
      ? classMap
      : (trackId: string) => classMap.get(trackId) ?? null;
  const raw = emptyHist();
  const normalized = emptyHist();
  for (const track of tracks) {
    const labels = classifyTrackFamilyLabels(resolve(track.trackId));
    raw[labels.raw] = (raw[labels.raw] ?? 0) + 1;
    normalized[labels.normalized] = (normalized[labels.normalized] ?? 0) + 1;
  }
  const intentRelevantRaw =
    (raw.disco ?? 0) + (raw.funk ?? 0) + (raw.soul ?? 0) + (raw.rnb ?? 0) + (raw.pop ?? 0) + (raw.electronic ?? 0);
  const offTargetRockIndieRaw = (raw.rock ?? 0) + (raw.indie ?? 0) + (raw.metal ?? 0);
  return {
    stage,
    total: tracks.length,
    raw,
    normalized,
    intentRelevantRaw,
    offTargetRockIndieRaw,
  };
}

export function compactStageSnapshot(snapshot: StageFamilySnapshot): Record<string, unknown> {
  const pick = (hist: FamilyHistogram): FamilyHistogram => {
    const out: FamilyHistogram = {};
    for (const key of ["disco", "funk", "soul", "rnb", "pop", "electronic", "rock", "indie", "metal", "other", "unknown"]) {
      const value = hist[key] ?? 0;
      if (value > 0) out[key] = value;
    }
    return out;
  };
  return {
    stage: snapshot.stage,
    total: snapshot.total,
    raw: pick(snapshot.raw),
    normalized: pick(snapshot.normalized),
    intentRelevantRaw: snapshot.intentRelevantRaw,
    offTargetRockIndieRaw: snapshot.offTargetRockIndieRaw,
  };
}
