/**
 * Persistent scene alias promotions (Q3 auto-promote).
 */

import type pg from "pg";
import { db, sceneAliasPromotionsTable } from "../db";
import { sql } from "drizzle-orm";
import { registerRuntimeSceneAliases } from "./harvested-alias-runtime";
import { registerPromotedGraphAliases } from "./scene-alias-graph";
import { summarizeHarvestedTerms } from "./unknown-term-harvest";
import { logger } from "./logger";

export type SceneAliasPromotion = {
  term: string;
  aliases: string[];
  occurrences: number;
  source: string;
};

export async function upsertSceneAliasPromotion(
  promotion: SceneAliasPromotion,
): Promise<void> {
  const normalizedTerm = promotion.term.toLowerCase().trim().replace(/\s+/g, "-");
  if (!normalizedTerm || promotion.aliases.length === 0) return;

  await db
    .insert(sceneAliasPromotionsTable)
    .values({
      term: normalizedTerm,
      aliases: promotion.aliases.slice(0, 8),
      occurrences: promotion.occurrences,
      source: promotion.source,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: sceneAliasPromotionsTable.term,
      set: {
        aliases: promotion.aliases.slice(0, 8),
        occurrences: promotion.occurrences,
        source: promotion.source,
        updatedAt: new Date(),
      },
    });

  registerRuntimeSceneAliases(normalizedTerm, promotion.aliases);
  registerPromotedGraphAliases(normalizedTerm, promotion.aliases);
}

export async function loadSceneAliasPromotions(
  rawPool?: pg.Pool,
  limit = 200,
): Promise<SceneAliasPromotion[]> {
  if (rawPool) {
    const result = await rawPool.query<{
      term: string;
      aliases: string[];
      occurrences: number;
      source: string;
    }>(
      `SELECT term, aliases, occurrences, source
       FROM scene_alias_promotions
       ORDER BY occurrences DESC, updated_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      term: row.term,
      aliases: Array.isArray(row.aliases) ? row.aliases : [],
      occurrences: Number(row.occurrences),
      source: row.source,
    }));
  }

  const rows = await db
    .select()
    .from(sceneAliasPromotionsTable)
    .orderBy(sql`${sceneAliasPromotionsTable.occurrences} DESC`)
    .limit(limit);

  return rows.map((row) => ({
    term: row.term,
    aliases: Array.isArray(row.aliases) ? row.aliases as string[] : [],
    occurrences: row.occurrences,
    source: row.source,
  }));
}

export async function warmSceneAliasPromotionsFromDb(
  rawPool?: pg.Pool,
): Promise<number> {
  try {
    const rows = await loadSceneAliasPromotions(rawPool);
    for (const row of rows) {
      registerRuntimeSceneAliases(row.term, row.aliases);
      registerPromotedGraphAliases(row.term, row.aliases);
    }
    if (rows.length > 0) {
      logger.info({ count: rows.length }, "Scene alias promotions loaded from DB");
    }
    return rows.length;
  } catch (err) {
    logger.warn({ err }, "Failed to load scene alias promotions");
    return 0;
  }
}

export async function autoPromoteHarvestedTerms(
  rawPool: pg.Pool,
  opts: { days?: number; minOccurrences?: number; limit?: number; inferAliases: (term: string) => string[] },
): Promise<SceneAliasPromotion[]> {
  const days = opts.days ?? 60;
  const minOccurrences = opts.minOccurrences ?? 5;
  const limit = opts.limit ?? 40;

  const harvested = await summarizeHarvestedTerms(rawPool, { days, minOccurrences, limit });
  const promoted: SceneAliasPromotion[] = [];

  for (const row of harvested) {
    const aliases = opts.inferAliases(row.term);
    const promotion: SceneAliasPromotion = {
      term: row.term,
      aliases,
      occurrences: row.occurrences,
      source: "harvest_auto",
    };
    await upsertSceneAliasPromotion(promotion);
    promoted.push(promotion);
  }

  return promoted;
}
