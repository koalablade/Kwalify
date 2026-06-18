/**
 * Persistent scene alias promotions (Q3) — with review queue.
 */

import type pg from "pg";
import { db, sceneAliasPromotionsTable } from "../db";
import { eq, sql, and } from "drizzle-orm";
import { registerRuntimeSceneAliases } from "./harvested-alias-runtime";
import { registerPromotedGraphAliases } from "./scene-alias-graph";
import { evaluateHarvestedAlias } from "./semantic-collision-guards";
import { summarizeHarvestedTerms } from "./unknown-term-harvest";
import { logger } from "./logger";

// Avoid circular import — inferPromotion duplicated lightly for queue path
function defaultInferAliases(term: string): string[] {
  const normalized = term.toLowerCase().trim();
  if (/\b(?:volvo|workshop|saab|bmw|mx-?5|e46|fixing)\b/i.test(normalized)) return ["blues", "indie", "rock", "folk"];
  if (/\b(kerrang|emo|punk)\b/i.test(normalized)) return ["rock", "metal", "indie", "punk"];
  return ["indie", "rock"];
}

export type AliasPromotionStatus = "pending" | "approved" | "rejected";

export type SceneAliasPromotion = {
  term: string;
  aliases: string[];
  occurrences: number;
  source: string;
  status: AliasPromotionStatus;
};

function normalizeTerm(term: string): string {
  return term.toLowerCase().trim().replace(/\s+/g, "-");
}

function activatePromotion(term: string, aliases: string[]): void {
  registerRuntimeSceneAliases(term, aliases);
  registerPromotedGraphAliases(term, aliases);
}

export async function upsertSceneAliasPromotion(
  promotion: SceneAliasPromotion,
): Promise<void> {
  const normalizedTerm = normalizeTerm(promotion.term);
  if (!normalizedTerm || promotion.aliases.length === 0) return;

  await db
    .insert(sceneAliasPromotionsTable)
    .values({
      term: normalizedTerm,
      aliases: promotion.aliases.slice(0, 8),
      occurrences: promotion.occurrences,
      source: promotion.source,
      status: promotion.status,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: sceneAliasPromotionsTable.term,
      set: {
        aliases: promotion.aliases.slice(0, 8),
        occurrences: promotion.occurrences,
        source: promotion.source,
        status: promotion.status,
        updatedAt: new Date(),
      },
    });

  if (promotion.status === "approved") {
    activatePromotion(normalizedTerm, promotion.aliases);
  }
}

export async function listPendingAliasPromotions(): Promise<SceneAliasPromotion[]> {
  const rows = await db
    .select()
    .from(sceneAliasPromotionsTable)
    .where(eq(sceneAliasPromotionsTable.status, "pending"))
    .orderBy(sql`${sceneAliasPromotionsTable.occurrences} DESC`)
    .limit(100);

  return rows.map((row) => ({
    term: row.term,
    aliases: Array.isArray(row.aliases) ? row.aliases as string[] : [],
    occurrences: row.occurrences,
    source: row.source,
    status: (row.status ?? "pending") as AliasPromotionStatus,
  }));
}

export async function approveAliasPromotion(term: string): Promise<SceneAliasPromotion | null> {
  const normalized = normalizeTerm(term);
  const rejection = evaluateHarvestedAlias(normalized.replace(/-/g, " "));
  if (rejection.rejected) {
    logger.warn({ term: normalized, reason: rejection.reason }, "Rejected alias promotion with collision risk");
    return rejectAliasPromotion(term);
  }
  const [row] = await db
    .select()
    .from(sceneAliasPromotionsTable)
    .where(eq(sceneAliasPromotionsTable.term, normalized))
    .limit(1);
  if (!row) return null;

  await db
    .update(sceneAliasPromotionsTable)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(sceneAliasPromotionsTable.term, normalized));

  const promotion: SceneAliasPromotion = {
    term: row.term,
    aliases: Array.isArray(row.aliases) ? row.aliases as string[] : [],
    occurrences: row.occurrences,
    source: row.source,
    status: "approved",
  };
  activatePromotion(promotion.term, promotion.aliases);
  return promotion;
}

export async function rejectAliasPromotion(term: string): Promise<SceneAliasPromotion | null> {
  const normalized = normalizeTerm(term);
  const [row] = await db
    .select()
    .from(sceneAliasPromotionsTable)
    .where(eq(sceneAliasPromotionsTable.term, normalized))
    .limit(1);
  if (!row) return null;

  await db
    .update(sceneAliasPromotionsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(sceneAliasPromotionsTable.term, normalized));

  return {
    term: row.term,
    aliases: Array.isArray(row.aliases) ? row.aliases as string[] : [],
    occurrences: row.occurrences,
    source: row.source,
    status: "rejected",
  };
}

export async function queueHarvestedAliasesForReview(
  rawPool?: pg.Pool,
  opts?: { days?: number; minOccurrences?: number; limit?: number; inferAliases?: (term: string) => string[] },
): Promise<SceneAliasPromotion[]> {
  const days = opts?.days ?? 60;
  const minOccurrences = opts?.minOccurrences ?? 5;
  const limit = opts?.limit ?? 40;
  const infer = opts?.inferAliases ?? ((term: string) => [term]);

  if (!rawPool) return [];

  const harvested = await summarizeHarvestedTerms(rawPool, { days, minOccurrences, limit });

  const queued: SceneAliasPromotion[] = [];
  for (const row of harvested) {
    const rejection = evaluateHarvestedAlias(row.term);
    if (rejection.rejected) {
      await upsertSceneAliasPromotion({
        term: row.term,
        aliases: [],
        occurrences: row.occurrences,
        source: `harvest_review:${rejection.reason}`,
        status: "rejected",
      });
      continue;
    }
    const aliases = infer(row.term);
    const promotion: SceneAliasPromotion = {
      term: row.term,
      aliases,
      occurrences: row.occurrences,
      source: "harvest_review",
      status: "pending",
    };
    await upsertSceneAliasPromotion(promotion);
    queued.push(promotion);
  }
  return queued;
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
      status: string;
    }>(
      `SELECT term, aliases, occurrences, source, status
       FROM scene_alias_promotions
       WHERE status = 'approved'
       ORDER BY occurrences DESC, updated_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      term: row.term,
      aliases: Array.isArray(row.aliases) ? row.aliases : [],
      occurrences: Number(row.occurrences),
      source: row.source,
      status: (row.status as AliasPromotionStatus) ?? "approved",
    }));
  }

  const rows = await db
    .select()
    .from(sceneAliasPromotionsTable)
    .where(eq(sceneAliasPromotionsTable.status, "approved"))
    .orderBy(sql`${sceneAliasPromotionsTable.occurrences} DESC`)
    .limit(limit);

  return rows.map((row) => ({
    term: row.term,
    aliases: Array.isArray(row.aliases) ? row.aliases as string[] : [],
    occurrences: row.occurrences,
    source: row.source,
    status: (row.status ?? "approved") as AliasPromotionStatus,
  }));
}

export async function warmSceneAliasPromotionsFromDb(
  rawPool?: pg.Pool,
): Promise<number> {
  try {
    const rows = await loadSceneAliasPromotions(rawPool);
    for (const row of rows) {
      if (row.status === "approved") {
        activatePromotion(row.term, row.aliases);
      }
    }
    if (rows.length > 0) {
      logger.info({ count: rows.length }, "Approved scene alias promotions loaded");
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
  return queueHarvestedAliasesForReview(rawPool, opts);
}
