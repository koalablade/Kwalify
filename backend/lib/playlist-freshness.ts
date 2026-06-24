/**
 * Anti-repetition: soft cooldowns — never hard-ban, progressively reduce weight.
 */

import type { EmotionProfile } from "./emotion";

export interface PlaylistHistoryRow {
  vibe: string;
  trackIds: string[] | null;
  emotionProfile?: EmotionProfile | null;
  createdAt?: Date | string;
}

export interface FreshnessStats {
  trackAppearances: Map<string, number>;
  artistAppearances: Map<string, number>;
  albumAppearances: Map<string, number>;
  recentSceneFingerprints: string[];
  playlistsScanned: number;
}

/** Progressive track cooldown: recent playlists should not dominate the next pick. */
export function trackCooldownMultiplier(appearances: number, maxPlaylists = 12): number {
  if (appearances <= 0) return 1;
  const share = appearances / Math.max(1, maxPlaylists);
  if (share >= 0.30) return 0.12;
  if (appearances === 1) return 0.34;
  if (appearances === 2) return 0.18;
  if (appearances === 3) return 0.10;
  return Math.max(0.06, 0.08 * Math.pow(0.72, appearances - 3));
}

/** Artist used heavily across recent playlists. */
export function artistCooldownMultiplier(appearances: number, maxPlaylists = 12): number {
  if (appearances <= 0) return 1;
  const share = appearances / Math.max(1, maxPlaylists);
  if (share >= 0.35) return 0.38;
  if (appearances === 1) return 0.82;
  if (appearances === 2) return 0.62;
  if (appearances === 3) return 0.48;
  return Math.max(0.32, 0.42 * Math.pow(0.78, appearances - 3));
}

export function albumCooldownMultiplier(appearances: number): number {
  if (appearances <= 0) return 1;
  if (appearances === 1) return 0.88;
  if (appearances === 2) return 0.72;
  return 0.55;
}

/** Emotional journey arc recently used — soft penalty. */
export function journeyArcCooldownMultiplier(recentArcCount: number): number {
  if (recentArcCount <= 0) return 1;
  if (recentArcCount === 1) return 0.94;
  if (recentArcCount === 2) return 0.88;
  return 0.82;
}

function sceneFingerprint(vibe: string, profile?: EmotionProfile | null): string {
  const p = profile;
  const parts = [
    vibe.slice(0, 80).toLowerCase().replace(/\s+/g, " "),
    p?.timeOfDay ?? "",
    p?.environment ?? "",
    Math.round((p?.energy ?? 0.5) * 10),
    Math.round((p?.nostalgia ?? 0.2) * 10),
    Math.round((p?.valence ?? 0.5) * 10),
  ];
  return parts.join("|");
}

export function countRecentJourneyArc(
  history: PlaylistHistoryRow[],
  arc: string,
  maxPlaylists = 8
): number {
  let n = 0;
  for (const pl of history.slice(0, maxPlaylists)) {
    const ep = pl.emotionProfile as { journeyArc?: string } | null;
    if (ep?.journeyArc === arc) n++;
  }
  return n;
}

export function buildFreshnessStats(
  history: PlaylistHistoryRow[],
  maxPlaylists = 20
): FreshnessStats {
  const trackAppearances = new Map<string, number>();
  const artistAppearances = new Map<string, number>();
  const albumAppearances = new Map<string, number>();
  const recentSceneFingerprints: string[] = [];

  const slice = history.slice(0, maxPlaylists);
  for (const pl of slice) {
    const ids = (pl.trackIds as string[]) ?? [];
    for (const id of ids) {
      trackAppearances.set(id, (trackAppearances.get(id) ?? 0) + 1);
    }
    recentSceneFingerprints.push(sceneFingerprint(pl.vibe, pl.emotionProfile as EmotionProfile | null));
  }

  return {
    trackAppearances,
    artistAppearances,
    albumAppearances,
    recentSceneFingerprints,
    playlistsScanned: slice.length,
  };
}

/** Build artist appearance counts from history track IDs + library artist map. */
export function buildArtistAppearanceMap(
  history: PlaylistHistoryRow[],
  trackIdToArtist: Map<string, string>,
  maxPlaylists = 12
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pl of history.slice(0, maxPlaylists)) {
    const ids = (pl.trackIds as string[]) ?? [];
    const artistsInPl = new Set<string>();
    for (const id of ids) {
      const artist = trackIdToArtist.get(id);
      if (artist) artistsInPl.add(artist.toLowerCase());
    }
    for (const a of artistsInPl) {
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
  }
  return counts;
}

export function buildAlbumAppearanceMap(
  history: PlaylistHistoryRow[],
  trackIdToAlbum: Map<string, string>,
  maxPlaylists = 12
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pl of history.slice(0, maxPlaylists)) {
    const ids = (pl.trackIds as string[]) ?? [];
    const albumsInPl = new Set<string>();
    for (const id of ids) {
      const album = trackIdToAlbum.get(id);
      if (album) albumsInPl.add(album.toLowerCase());
    }
    for (const a of albumsInPl) {
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
  }
  return counts;
}

/** Near-identical vibe/scene combo used recently — light anti-clone on all scores. */
export function sceneClonePenalty(
  vibe: string,
  profile: EmotionProfile,
  recentFingerprints: string[],
  experienceSceneId?: string | null
): number {
  const fp = `${sceneFingerprint(vibe, profile)}|${experienceSceneId ?? ""}`;
  let hits = 0;
  for (const r of recentFingerprints.slice(0, 6)) {
    if (r === fp || (r.length > 20 && fp.startsWith(r.slice(0, 40)))) hits++;
  }
  if (hits >= 2) return 0.88;
  if (hits >= 1) return 0.94;
  return 1;
}

/** Penalty for hybrid pool pre-filter (last playlists weighted heavier). */
export function buildRecentTrackPoolPenalty(
  recentPlaylistTrackIds: string[][],
  maxPlaylists = 12,
  scale = 1
): Map<string, number> {
  const map = new Map<string, number>();
  const playlists = recentPlaylistTrackIds.slice(0, maxPlaylists);
  const trackCounts = new Map<string, number>();
  for (const ids of playlists) {
    for (const id of ids) {
      trackCounts.set(id, (trackCounts.get(id) ?? 0) + 1);
    }
  }
  for (const [i, ids] of playlists.entries()) {
    const recencyWeight = Math.pow(0.82, i) * scale;
    for (const id of ids) {
      const appearances = trackCounts.get(id) ?? 0;
      const share = appearances / Math.max(1, playlists.length);
      const appearanceWeight = share >= 0.30
        ? 0.78
        : share >= 0.20
          ? 0.52
          : share >= 0.12
            ? 0.34
            : Math.min(0.28, 0.10 + appearances * 0.06);
      map.set(id, (map.get(id) ?? 0) + recencyWeight * appearanceWeight);
    }
  }
  return map;
}

export function applyFreshnessToScore(
  baseScore: number,
  opts: {
    trackId: string;
    artistName: string;
    albumName: string;
    stats: FreshnessStats;
    artistAppearances: Map<string, number>;
    albumAppearances: Map<string, number>;
    globalCloneMultiplier: number;
  }
): number {
  const scanned = Math.max(1, opts.stats.playlistsScanned);
  const trackMult = trackCooldownMultiplier(
    opts.stats.trackAppearances.get(opts.trackId) ?? 0,
    scanned,
  );
  const artistMult = artistCooldownMultiplier(
    opts.artistAppearances.get(opts.artistName.toLowerCase()) ?? 0,
    scanned,
  );
  const albumMult = albumCooldownMultiplier(
    opts.albumAppearances.get(opts.albumName.toLowerCase()) ?? 0
  );
  const broadTasteMultiplier = artistMult * albumMult * opts.globalCloneMultiplier;
  return baseScore * trackMult * Math.max(0.72, broadTasteMultiplier);
}

// ---------------------------------------------------------------------------
// Structural / perceptual cross-run diversity (PATCH 18–20)
// ---------------------------------------------------------------------------

export type PromptDiversityKind = "strong" | "blended" | "vague" | "edge";

type StructuralTrack = {
  trackId: string;
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  danceability?: number | null;
  genrePrimary?: string | null;
  score?: number;
};

type ClassMap = Map<string, { genreFamily?: string; genrePrimary?: string }>;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
}

function normalizedLabelEntropy(labels: string[]): number {
  if (labels.length <= 1) return 0;
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / labels.length;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(counts.size);
}

function familyForTrack(
  track: StructuralTrack,
  classMap?: ClassMap,
): string {
  return classMap?.get(track.trackId)?.genreFamily ??
    classMap?.get(track.trackId)?.genrePrimary ??
    track.genrePrimary ??
    "unknown";
}

function clusterKeyForTrack(track: StructuralTrack, classMap?: ClassMap): string {
  const e = track.energy ?? 0.5;
  const band = e <= 0.42 ? "lo" : e >= 0.55 ? "hi" : "md";
  return `${familyForTrack(track, classMap)}|${band}`;
}

export function promptClassKey(vibe: string, profile?: EmotionProfile | null): string {
  const tokens = vibe.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const genreHints = tokens.filter((token) =>
    /^(pop|rock|country|electronic|hip|hop|rap|jazz|classical|metal|punk|folk|soul|rnb|indie|ambient|house|techno|garage|disco|blues|latin|reggae|trance|dubstep|shoegaze)$/.test(token),
  );
  const anchor = genreHints.slice(0, 2).join("+") || tokens.slice(0, 3).join("+") || "general";
  return `${anchor}|e${Math.round((profile?.energy ?? 0.5) * 10)}`;
}

export function buildStructuralFingerprint(
  tracks: StructuralTrack[],
  classMap?: ClassMap,
): string {
  if (tracks.length === 0) return "empty";
  const buckets = 8;
  const step = Math.max(1, Math.floor(tracks.length / buckets));
  const energyParts: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const slice = tracks.slice(i * step, (i + 1) * step);
    energyParts.push(Math.round(mean(slice.map((track) => track.energy ?? 0.5)) * 10));
  }
  const quartiles = 4;
  const qStep = Math.max(1, Math.ceil(tracks.length / quartiles));
  const clusterParts: string[] = [];
  for (let q = 0; q < quartiles; q++) {
    const slice = tracks.slice(q * qStep, (q + 1) * qStep);
    const families = new Map<string, number>();
    for (const track of slice) {
      const family = familyForTrack(track, classMap).slice(0, 8);
      families.set(family, (families.get(family) ?? 0) + 1);
    }
    clusterParts.push(
      [...families.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "x",
    );
  }
  const genreEntropy = normalizedLabelEntropy(tracks.map((track) => familyForTrack(track, classMap)));
  const energyVar = variance(tracks.map((track) => track.energy ?? 0.5));
  const density = energyVar >= 0.045 ? "spread" : energyVar >= 0.018 ? "mid" : "flat";
  return `${energyParts.join("-")}::${clusterParts.join("|")}::${genreEntropy.toFixed(2)}::${density}`;
}

export function structuralSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const [aEnergy, aCluster, aEntropy, aDensity] = a.split("::");
  const [bEnergy, bCluster, bEntropy, bDensity] = b.split("::");
  const aE = (aEnergy ?? "").split("-").map(Number);
  const bE = (bEnergy ?? "").split("-").map(Number);
  let energySim = 0;
  const len = Math.max(aE.length, bE.length, 1);
  for (let i = 0; i < len; i++) {
    energySim += 1 - Math.min(1, Math.abs((aE[i] ?? 0) - (bE[i] ?? 0)) / 10);
  }
  energySim /= len;
  const aClusters = (aCluster ?? "").split("|");
  const bClusters = (bCluster ?? "").split("|");
  const clusterMatch = aClusters.filter((label, index) => label === bClusters[index]).length /
    Math.max(aClusters.length, bClusters.length, 1);
  const entropySim = 1 - Math.min(1, Math.abs(Number(aEntropy) - Number(bEntropy)));
  const densitySim = aDensity === bDensity ? 1 : 0.5;
  return energySim * 0.40 + clusterMatch * 0.35 + entropySim * 0.15 + densitySim * 0.10;
}

function buildRecentStructuralFingerprints(
  history: PlaylistHistoryRow[],
  trackById: Map<string, StructuralTrack>,
  classMap?: ClassMap,
  maxPlaylists = 8,
): string[] {
  const fingerprints: string[] = [];
  for (const row of history.slice(0, maxPlaylists)) {
    const ids = (row.trackIds as string[]) ?? [];
    const tracks = ids.map((id) => trackById.get(id)).filter(Boolean) as StructuralTrack[];
    if (tracks.length >= 4) fingerprints.push(buildStructuralFingerprint(tracks, classMap));
  }
  return fingerprints;
}

function perceptualProfile(tracks: StructuralTrack[]) {
  const valences = tracks.map((track) => track.valence ?? 0.5);
  const energies = tracks.map((track) => track.energy ?? 0.5);
  const textures = tracks.map((track) => {
    const acoustic = track.acousticness ?? 0.5;
    const dance = track.danceability ?? 0.5;
    return (acoustic + dance) / 2;
  });
  return {
    moodVar: variance(valences),
    energyVar: variance(energies),
    textureVar: variance(textures),
    moodMean: mean(valences),
    energyMean: mean(energies),
    textureMean: mean(textures),
  };
}

function perceptualDelta(
  a: ReturnType<typeof perceptualProfile>,
  b: ReturnType<typeof perceptualProfile>,
): number {
  return (
    Math.abs(a.moodMean - b.moodMean) * 0.35 +
    Math.abs(a.energyMean - b.energyMean) * 0.35 +
    Math.abs(a.textureMean - b.textureMean) * 0.15 +
    Math.abs(a.moodVar - b.moodVar) * 0.05 +
    Math.abs(a.energyVar - b.energyVar) * 0.05 +
    Math.abs(a.textureVar - b.textureVar) * 0.05
  );
}

function minPerceptualSeparation(kind: PromptDiversityKind): number {
  if (kind === "strong") return 0.14;
  return 0.22;
}

function resampleRatioForKind(kind: PromptDiversityKind): number {
  if (kind === "strong") return 0.20;
  if (kind === "vague") return 0.28;
  return 0.30;
}

function countRecentClusterUsage(
  recentPlaylistTrackIds: string[][],
  trackById: Map<string, StructuralTrack>,
  classMap?: ClassMap,
  maxPlaylists = 10,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ids of recentPlaylistTrackIds.slice(0, maxPlaylists)) {
    const seen = new Set<string>();
    for (const id of ids) {
      const track = trackById.get(id);
      if (!track) continue;
      const key = clusterKeyForTrack(track, classMap);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function resampleFromUnderusedClusters<T extends StructuralTrack>(
  tracks: T[],
  pool: T[],
  replaceCount: number,
  recentClusterUsage: Map<string, number>,
  classMap?: ClassMap,
): T[] {
  if (replaceCount <= 0 || pool.length === 0 || tracks.length === 0) return tracks;
  const usedIds = new Set(tracks.map((track) => track.trackId));
  const playlistClusterCounts = new Map<string, number>();
  for (const track of tracks) {
    const key = clusterKeyForTrack(track, classMap);
    playlistClusterCounts.set(key, (playlistClusterCounts.get(key) ?? 0) + 1);
  }
  const underusedClusters = [...new Set(pool.map((track) => clusterKeyForTrack(track, classMap)))]
    .sort((a, b) => (recentClusterUsage.get(a) ?? 0) - (recentClusterUsage.get(b) ?? 0));
  const out = [...tracks];
  let replaced = 0;
  const replaceCandidates = [...out]
    .map((track, index) => ({ track, index, score: track.score ?? 0 }))
    .sort((a, b) => a.score - b.score);
  for (const { index } of replaceCandidates) {
    if (replaced >= replaceCount) break;
    const current = out[index]!;
    const currentKey = clusterKeyForTrack(current, classMap);
    if ((playlistClusterCounts.get(currentKey) ?? 0) <= 1) continue;
    const replacement = pool.find((candidate) => {
      if (usedIds.has(candidate.trackId)) return false;
      const key = clusterKeyForTrack(candidate, classMap);
      if (key === currentKey) return false;
      return underusedClusters.indexOf(key) <= Math.max(2, Math.floor(underusedClusters.length / 3));
    });
    if (!replacement) continue;
    usedIds.delete(current.trackId);
    usedIds.add(replacement.trackId);
    playlistClusterCounts.set(currentKey, (playlistClusterCounts.get(currentKey) ?? 1) - 1);
    const replacementKey = clusterKeyForTrack(replacement, classMap);
    playlistClusterCounts.set(replacementKey, (playlistClusterCounts.get(replacementKey) ?? 0) + 1);
    out[index] = replacement;
    replaced += 1;
  }
  return out;
}

export function perturbOrderingForFingerprintDiversity<T extends StructuralTrack>(
  tracks: T[],
  recentFingerprints: string[],
  currentFingerprint: string,
): { tracks: T[]; perturbed: boolean; strategy?: string } {
  if (tracks.length < 8) return { tracks, perturbed: false };
  const collision = recentFingerprints.slice(0, 8).some((fp) =>
    fp === currentFingerprint || structuralSimilarity(fp, currentFingerprint) >= 0.88,
  );
  if (!collision) return { tracks, perturbed: false };

  const n = tracks.length;
  const q = Math.max(2, Math.floor(n / 4));
  const strategyIndex = recentFingerprints.filter((fp) => fp === currentFingerprint).length % 3;
  const out = [...tracks];
  if (strategyIndex === 0) {
    const head = out.slice(0, q);
    const mid = out.slice(q, q * 2);
    const tail = out.slice(q * 2, q * 3);
    const rest = out.slice(q * 3);
    return { tracks: [...tail, ...mid, ...head, ...rest].slice(0, n), perturbed: true, strategy: "swap_quartiles" };
  }
  if (strategyIndex === 1) {
    const mid = Math.floor(n / 2);
    return { tracks: [...out.slice(0, mid), ...out.slice(mid).reverse()], perturbed: true, strategy: "reverse_tail" };
  }
  return { tracks: [...out.slice(q), ...out.slice(0, q)], perturbed: true, strategy: "rotate_opening" };
}

export function applyStructuralDiversityGuards<T extends StructuralTrack>(
  tracks: T[],
  opts: {
    candidatePool: T[];
    recentPlaylistTrackIds?: string[][];
    recentPlaylistHistory?: PlaylistHistoryRow[];
    trackById: Map<string, T>;
    classMap?: ClassMap;
    vibe: string;
    emotionProfile: EmotionProfile;
    diversityKind: PromptDiversityKind;
  },
): { tracks: T[]; diagnostics: Record<string, unknown> } {
  if (tracks.length < 6) {
    return { tracks, diagnostics: { applied: false, reason: "too_short" } };
  }

  const recentHistory = opts.recentPlaylistHistory ?? [];
  const recentFingerprints = buildRecentStructuralFingerprints(
    recentHistory,
    opts.trackById,
    opts.classMap,
  );
  const promptClass = promptClassKey(opts.vibe, opts.emotionProfile);
  const sameClassHistory = recentHistory.filter(
    (row) => promptClassKey(row.vibe, row.emotionProfile as EmotionProfile | null) === promptClass,
  );
  const sameClassFingerprints = buildRecentStructuralFingerprints(
    sameClassHistory,
    opts.trackById,
    opts.classMap,
  );
  const recentClusterUsage = countRecentClusterUsage(
    opts.recentPlaylistTrackIds ?? [],
    opts.trackById,
    opts.classMap,
  );

  let working = [...tracks];
  const diagnostics: Record<string, unknown> = { applied: true, promptClass };

  let currentFingerprint = buildStructuralFingerprint(working, opts.classMap);
  diagnostics.initialFingerprint = currentFingerprint;

  const perturb = perturbOrderingForFingerprintDiversity(working, recentFingerprints, currentFingerprint);
  if (perturb.perturbed) {
    working = perturb.tracks;
    currentFingerprint = buildStructuralFingerprint(working, opts.classMap);
    diagnostics.orderPerturbed = true;
    diagnostics.orderStrategy = perturb.strategy;
  }

  let maxSameClassSimilarity = 0;
  for (const fp of sameClassFingerprints) {
    maxSameClassSimilarity = Math.max(maxSameClassSimilarity, structuralSimilarity(currentFingerprint, fp));
  }
  diagnostics.maxSameClassSimilarity = Math.round(maxSameClassSimilarity * 1000) / 1000;

  if (maxSameClassSimilarity >= 0.72) {
    const replaceCount = Math.max(1, Math.ceil(working.length * 0.25));
    working = resampleFromUnderusedClusters(
      working,
      opts.candidatePool,
      replaceCount,
      recentClusterUsage,
      opts.classMap,
    );
    currentFingerprint = buildStructuralFingerprint(working, opts.classMap);
    diagnostics.crossRunResampled = true;
    diagnostics.crossRunReplaceCount = replaceCount;
  }

  const currentPerceptual = perceptualProfile(working);
  let minRecentDelta = 1;
  for (const row of recentHistory.slice(0, 8)) {
    const ids = (row.trackIds as string[]) ?? [];
    const recentTracks = ids.map((id) => opts.trackById.get(id)).filter(Boolean) as T[];
    if (recentTracks.length < 4) continue;
    minRecentDelta = Math.min(minRecentDelta, perceptualDelta(currentPerceptual, perceptualProfile(recentTracks)));
  }
  diagnostics.minPerceptualDelta = Math.round(minRecentDelta * 1000) / 1000;

  const separationFloor = minPerceptualSeparation(opts.diversityKind);
  if (minRecentDelta < separationFloor) {
    const replaceCount = Math.max(1, Math.ceil(working.length * resampleRatioForKind(opts.diversityKind)));
    working = resampleFromUnderusedClusters(
      working,
      opts.candidatePool,
      replaceCount,
      recentClusterUsage,
      opts.classMap,
    );
    diagnostics.perceptualResampled = true;
    diagnostics.perceptualReplaceCount = replaceCount;
  }

  diagnostics.finalFingerprint = buildStructuralFingerprint(working, opts.classMap);
  return { tracks: working, diagnostics };
}
