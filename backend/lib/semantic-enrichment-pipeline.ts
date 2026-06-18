/**
 * Post-sync semantic enrichment orchestration.
 */

import { db, likedSongsTable } from "../db";
import { sql } from "drizzle-orm";
import { SEMANTIC_ENRICHMENT_VERSION } from "./track-semantic-types";
import { enrichTrackSemanticProfile, parseTrackSemanticProfile } from "./track-semantic-enrichment";
import {
  buildArtistEcosystemGraph,
  persistArtistEcosystemGraph,
} from "./artist-ecosystem-graph";
import { invalidateSemanticProfileCache, warmSemanticProfileCache, type SemanticTrackRow } from "./semantic-profile-store";
import { logger } from "./logger";

export async function enrichLibrarySemanticProfiles(
  userId: string,
  rows: SemanticTrackRow[],
): Promise<{ enriched: number; skipped: number }> {
  let enriched = 0;
  let skipped = 0;
  const updates: Array<{ trackId: string; profile: ReturnType<typeof enrichTrackSemanticProfile> }> = [];

  for (const row of rows) {
    const existing = parseTrackSemanticProfile(row.semanticProfile);
    if (existing && existing.version === SEMANTIC_ENRICHMENT_VERSION) {
      skipped += 1;
      continue;
    }
    const profile = enrichTrackSemanticProfile(row);
    updates.push({ trackId: row.trackId, profile });
    enriched += 1;
  }

  const batchSize = 100;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await Promise.all(
      batch.map((item) =>
        db
          .update(likedSongsTable)
          .set({
            semanticProfile: item.profile as unknown as Record<string, unknown>,
            enrichmentVersion: SEMANTIC_ENRICHMENT_VERSION,
            enrichedAt: new Date(),
          })
          .where(
            sql`${likedSongsTable.spotifyUserId} = ${userId} AND ${likedSongsTable.trackId} = ${item.trackId}`,
          ),
      ),
    );
  }

  invalidateSemanticProfileCache(userId);
  warmSemanticProfileCache(userId, rows);

  try {
    const graph = buildArtistEcosystemGraph({
      likedTracks: rows.map((r) => ({ artistName: r.artistName, trackId: r.trackId })),
    });
    await persistArtistEcosystemGraph(userId, graph);
  } catch (err) {
    logger.warn({ err, userId }, "Artist ecosystem graph persistence failed");
  }

  return { enriched, skipped };
}

function parseArtistIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((id): id is string => typeof id === "string");
}

export async function backfillMissingSemanticProfiles(
  userId: string,
  limit = 5000,
): Promise<number> {
  const rows = await db
    .select()
    .from(likedSongsTable)
    .where(
      sql`${likedSongsTable.spotifyUserId} = ${userId} AND (${likedSongsTable.semanticProfile} IS NULL OR ${likedSongsTable.enrichmentVersion} IS DISTINCT FROM ${SEMANTIC_ENRICHMENT_VERSION})`,
    )
    .limit(limit);

  if (rows.length === 0) return 0;

  const mapped: SemanticTrackRow[] = rows.map((r) => ({
    trackId: r.trackId,
    trackName: r.trackName,
    artistName: r.artistName,
    albumName: r.albumName,
    energy: r.energy,
    valence: r.valence,
    tempo: r.tempo,
    danceability: r.danceability,
    acousticness: r.acousticness,
    instrumentalness: r.instrumentalness,
    speechiness: r.speechiness,
    loudness: r.loudness,
    spotifyArtistGenres: r.spotifyArtistGenres,
    albumGenres: r.albumGenres,
    releaseYear: r.releaseYear,
    popularity: r.popularity,
    semanticProfile: r.semanticProfile,
    primaryArtistId: r.primaryArtistId,
    artistIds: parseArtistIds(r.artistIds),
  }));

  const result = await enrichLibrarySemanticProfiles(userId, mapped);
  return result.enriched;
}
