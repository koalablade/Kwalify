import { eq } from "drizzle-orm";
import { db, userFeedbackMemoryTable } from "../db";

export type FeedbackMemory = {
  badArtists: string[];
  badGenres: string[];
  badEnergyTypes: string[];
  badMoodMatches: string[];
  badBridges: string[];
  overplayedTracks: string[];
  skipCountByTrack: Record<string, number>;
  saveCountByTrack: Record<string, number>;
  artistAffinityGraph: Record<string, ArtistAffinityNode>;
  albumAffinityGraph: Record<string, AlbumAffinityNode>;
  sceneEmbeddings: SceneEmbedding[];
};

export type ArtistAffinityNode = {
  artistId: string;
  score: number;
  coArtists: string[];
  genres: string[];
  decayFactor: number;
};

export type AlbumAffinityNode = {
  albumId: string;
  artistId: string;
  score: number;
};

export type SceneEmbedding = {
  genreCluster: string;
  eraCluster?: string;
  moodCluster?: string;
  vectorHint?: number[];
};

export type FeedbackTrack = {
  trackId: string;
  trackName?: string | null;
  artistId?: string | null;
  artistName?: string | null;
  albumId?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genres?: string[] | null;
  energy?: number | null;
};

const EMPTY_FEEDBACK_MEMORY: FeedbackMemory = {
  badArtists: [],
  badGenres: [],
  badEnergyTypes: [],
  badMoodMatches: [],
  badBridges: [],
  overplayedTracks: [],
  skipCountByTrack: {},
  saveCountByTrack: {},
  artistAffinityGraph: {},
  albumAffinityGraph: {},
  sceneEmbeddings: [],
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isFinite(count)) out[key] = count;
  }
  return out;
}

function asArtistAffinityGraph(value: unknown): Record<string, ArtistAffinityNode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, ArtistAffinityNode> = {};
  for (const [key, node] of Object.entries(value as Record<string, unknown>)) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    const artistId = typeof n.artistId === "string" ? n.artistId : key;
    out[key] = {
      artistId,
      score: typeof n.score === "number" && Number.isFinite(n.score) ? n.score : 0,
      coArtists: asStringArray(n.coArtists),
      genres: asStringArray(n.genres),
      decayFactor: typeof n.decayFactor === "number" && Number.isFinite(n.decayFactor) ? n.decayFactor : 0.98,
    };
  }
  return out;
}

function asAlbumAffinityGraph(value: unknown): Record<string, AlbumAffinityNode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, AlbumAffinityNode> = {};
  for (const [key, node] of Object.entries(value as Record<string, unknown>)) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    out[key] = {
      albumId: typeof n.albumId === "string" ? n.albumId : key,
      artistId: typeof n.artistId === "string" ? n.artistId : "",
      score: typeof n.score === "number" && Number.isFinite(n.score) ? n.score : 0,
    };
  }
  return out;
}

function asSceneEmbeddings(value: unknown): SceneEmbedding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const scene = item as Record<string, unknown>;
      const genreCluster = typeof scene.genreCluster === "string" ? scene.genreCluster : "";
      if (!genreCluster) return null;
      return {
        genreCluster,
        eraCluster: typeof scene.eraCluster === "string" ? scene.eraCluster : undefined,
        moodCluster: typeof scene.moodCluster === "string" ? scene.moodCluster : undefined,
        vectorHint: Array.isArray(scene.vectorHint)
          ? scene.vectorHint.filter((value): value is number => typeof value === "number")
          : undefined,
      };
    })
    .filter((scene): scene is SceneEmbedding => !!scene)
    .slice(0, 120);
}

function uniquePush(values: string[], value: string | null | undefined, max = 200): string[] {
  if (!value?.trim()) return values;
  return [value, ...values.filter((item) => item !== value)].slice(0, max);
}

function clampAffinity(score: number): number {
  return Math.max(-10, Math.min(10, Math.round(score * 1000) / 1000));
}

function artistKey(track: FeedbackTrack): string | null {
  return track.artistId || track.artistName || null;
}

function albumKey(track: FeedbackTrack): string | null {
  return track.albumId || track.albumName || null;
}

function updateArtistAffinity(memory: FeedbackMemory, track: FeedbackTrack, delta: number): void {
  const key = artistKey(track);
  if (!key) return;
  const existing = memory.artistAffinityGraph[key] ?? {
    artistId: key,
    score: 0,
    coArtists: [],
    genres: [],
    decayFactor: 0.98,
  };
  const genres = [
    ...new Set([
      ...existing.genres,
      ...(Array.isArray(track.genres) ? track.genres : []),
      ...(track.genrePrimary ? [track.genrePrimary] : []),
    ]),
  ].slice(0, 20);
  memory.artistAffinityGraph[key] = {
    ...existing,
    score: clampAffinity(existing.score * existing.decayFactor + delta),
    genres,
  };
}

function updateAlbumAffinity(memory: FeedbackMemory, track: FeedbackTrack, delta: number): void {
  const key = albumKey(track);
  if (!key) return;
  const artistId = artistKey(track) ?? "";
  const existing = memory.albumAffinityGraph[key] ?? { albumId: key, artistId, score: 0 };
  memory.albumAffinityGraph[key] = {
    albumId: existing.albumId,
    artistId: existing.artistId || artistId,
    score: clampAffinity(existing.score + delta),
  };
}

function updateSceneEmbedding(
  memory: FeedbackMemory,
  track: FeedbackTrack,
  opts: { mood?: string | null; era?: string | null } = {},
): void {
  const genreCluster = track.genrePrimary || track.genres?.[0];
  if (!genreCluster) return;
  const scene: SceneEmbedding = {
    genreCluster,
    eraCluster: opts.era ?? undefined,
    moodCluster: opts.mood ?? undefined,
    vectorHint: typeof track.energy === "number" ? [track.energy] : undefined,
  };
  memory.sceneEmbeddings = [scene, ...memory.sceneEmbeddings].slice(0, 120);
}

function energyBucket(energy?: number | null): string | null {
  if (typeof energy !== "number") return null;
  if (energy <= 0.35) return "low";
  if (energy >= 0.70) return "high";
  return "medium";
}

function normalizeRow(row: typeof userFeedbackMemoryTable.$inferSelect | undefined): FeedbackMemory {
  if (!row) return { ...EMPTY_FEEDBACK_MEMORY };
  return {
    badArtists: asStringArray(row.badArtists),
    badGenres: asStringArray(row.badGenres),
    badEnergyTypes: asStringArray(row.badEnergyTypes),
    badMoodMatches: asStringArray(row.badMoodMatches),
    badBridges: asStringArray(row.badBridges),
    overplayedTracks: asStringArray(row.overplayedTracks),
    skipCountByTrack: asCountMap(row.skipCountByTrack),
    saveCountByTrack: asCountMap(row.saveCountByTrack),
    artistAffinityGraph: asArtistAffinityGraph(row.artistAffinityGraph),
    albumAffinityGraph: asAlbumAffinityGraph(row.albumAffinityGraph),
    sceneEmbeddings: asSceneEmbeddings(row.sceneEmbeddings),
  };
}

export async function getFeedbackMemory(userId: string): Promise<FeedbackMemory> {
  const rows = await db
    .select()
    .from(userFeedbackMemoryTable)
    .where(eq(userFeedbackMemoryTable.userId, userId))
    .limit(1);
  return normalizeRow(rows[0]);
}

async function saveFeedbackMemory(userId: string, memory: FeedbackMemory): Promise<FeedbackMemory> {
  const existing = await db
    .select({ id: userFeedbackMemoryTable.id })
    .from(userFeedbackMemoryTable)
    .where(eq(userFeedbackMemoryTable.userId, userId))
    .limit(1);

  const values = {
    userId,
    badArtists: memory.badArtists,
    badGenres: memory.badGenres,
    badEnergyTypes: memory.badEnergyTypes,
    badMoodMatches: memory.badMoodMatches,
    badBridges: memory.badBridges,
    overplayedTracks: memory.overplayedTracks,
    skipCountByTrack: memory.skipCountByTrack,
    saveCountByTrack: memory.saveCountByTrack,
    artistAffinityGraph: memory.artistAffinityGraph,
    albumAffinityGraph: memory.albumAffinityGraph,
    sceneEmbeddings: memory.sceneEmbeddings,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await db
      .update(userFeedbackMemoryTable)
      .set(values)
      .where(eq(userFeedbackMemoryTable.userId, userId));
  } else {
    await db.insert(userFeedbackMemoryTable).values(values);
  }

  return memory;
}

export async function onTrackRemoved(
  userId: string,
  track: FeedbackTrack,
  opts: { mood?: string | null; bridgeGenre?: string | null } = {},
): Promise<FeedbackMemory> {
  const memory = await getFeedbackMemory(userId);
  memory.badArtists = uniquePush(memory.badArtists, track.artistName);
  memory.badGenres = uniquePush(memory.badGenres, track.genrePrimary);
  memory.badEnergyTypes = uniquePush(memory.badEnergyTypes, energyBucket(track.energy), 20);
  memory.badMoodMatches = uniquePush(memory.badMoodMatches, opts.mood, 80);
  memory.badBridges = uniquePush(memory.badBridges, opts.bridgeGenre, 80);
  memory.overplayedTracks = uniquePush(memory.overplayedTracks, track.trackId);
  updateArtistAffinity(memory, track, -1.2);
  updateAlbumAffinity(memory, track, -0.8);
  updateSceneEmbedding(memory, track, opts);
  return saveFeedbackMemory(userId, memory);
}

export async function onTrackSkip(userId: string, track: FeedbackTrack, weight = 1): Promise<FeedbackMemory> {
  const memory = await getFeedbackMemory(userId);
  memory.skipCountByTrack[track.trackId] = (memory.skipCountByTrack[track.trackId] ?? 0) + weight;
  if (memory.skipCountByTrack[track.trackId] >= 3) {
    memory.overplayedTracks = uniquePush(memory.overplayedTracks, track.trackId);
  }
  updateArtistAffinity(memory, track, -0.45 * weight);
  updateAlbumAffinity(memory, track, -0.30 * weight);
  return saveFeedbackMemory(userId, memory);
}

export async function onTrackSave(userId: string, track: FeedbackTrack, weight = 1): Promise<FeedbackMemory> {
  const memory = await getFeedbackMemory(userId);
  memory.saveCountByTrack[track.trackId] = (memory.saveCountByTrack[track.trackId] ?? 0) + weight;
  memory.overplayedTracks = memory.overplayedTracks.filter((trackId) => trackId !== track.trackId);
  updateArtistAffinity(memory, track, 0.55 * weight);
  updateAlbumAffinity(memory, track, 0.35 * weight);
  updateSceneEmbedding(memory, track);
  return saveFeedbackMemory(userId, memory);
}
