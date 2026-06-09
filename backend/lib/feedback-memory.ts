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
};

export type FeedbackTrack = {
  trackId: string;
  artistName?: string | null;
  genrePrimary?: string | null;
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

function uniquePush(values: string[], value: string | null | undefined, max = 200): string[] {
  if (!value?.trim()) return values;
  return [value, ...values.filter((item) => item !== value)].slice(0, max);
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
  return saveFeedbackMemory(userId, memory);
}

export async function onTrackSkip(userId: string, track: FeedbackTrack): Promise<FeedbackMemory> {
  const memory = await getFeedbackMemory(userId);
  memory.skipCountByTrack[track.trackId] = (memory.skipCountByTrack[track.trackId] ?? 0) + 1;
  if (memory.skipCountByTrack[track.trackId] >= 3) {
    memory.overplayedTracks = uniquePush(memory.overplayedTracks, track.trackId);
  }
  return saveFeedbackMemory(userId, memory);
}

export async function onTrackSave(userId: string, track: FeedbackTrack): Promise<FeedbackMemory> {
  const memory = await getFeedbackMemory(userId);
  memory.saveCountByTrack[track.trackId] = (memory.saveCountByTrack[track.trackId] ?? 0) + 1;
  memory.overplayedTracks = memory.overplayedTracks.filter((trackId) => trackId !== track.trackId);
  return saveFeedbackMemory(userId, memory);
}
