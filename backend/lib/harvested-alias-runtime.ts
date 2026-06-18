/**
 * Runtime promotion of frequently harvested unknown terms into scene alias lookups.
 */

import type pg from "pg";
import { evaluateHarvestedAlias } from "./semantic-collision-guards";
import { summarizeHarvestedTerms } from "./unknown-term-harvest";
import { warmSceneAliasPromotionsFromDb, queueHarvestedAliasesForReview } from "./alias-promotion-store";
import { logger } from "./logger";

const GENRE_HINTS = ["rock", "metal", "indie", "punk", "blues", "folk", "country", "electronic", "hip_hop", "pop", "rnb"];

const runtimePromotions = new Map<string, string[]>();

function normalizeTerm(term: string): string {
  return term.toLowerCase().trim().replace(/\s+/g, "-");
}

function inferPromotion(term: string): string[] {
  const normalized = normalizeTerm(term);
  const hits = GENRE_HINTS.filter((genre) => normalized.includes(genre.replace("_", "")));
  if (hits.length >= 2) return hits.slice(0, 4);
  if (hits.length === 1) return [hits[0]!, "indie", "rock"];
  if (/\b(?:ukg|uk\s+garage|grime|uk\s+rap|uk\s+drill)\b/i.test(term)) {
    return ["hip_hop", "electronic"];
  }
  if (/\b(?:workshop|volvo|saab|bmw|mx-?5|e46|fixing\s+cars?|project\s+car)\b/i.test(term)) {
    return ["blues", "indie", "rock", "folk"];
  }
  if (/\b(kerrang|emo|skate|punk)\b/i.test(term)) {
    return ["rock", "metal", "indie", "punk"];
  }
  if (/\b(nfs|forza|driving|horizon)\b/i.test(term)) {
    return ["rock", "electronic", "metal", "hip_hop"];
  }
  return ["indie", "rock"];
}

export function registerRuntimeSceneAliases(term: string, aliases: string[]): void {
  const key = normalizeTerm(term);
  if (!key || aliases.length === 0) return;
  runtimePromotions.set(key, aliases.slice(0, 6));
}

export function getRuntimePromotedAliases(sceneKey: string): string[] | null {
  const key = normalizeTerm(sceneKey);
  return runtimePromotions.get(key) ?? null;
}

export function listRuntimePromotedTerms(): string[] {
  return [...runtimePromotions.keys()];
}

export async function warmHarvestedAliasPromotions(
  rawPool: pg.Pool,
  opts?: { days?: number; minOccurrences?: number; limit?: number; autoPromote?: boolean },
): Promise<number> {
  const days = opts?.days ?? 60;
  const minOccurrences = opts?.minOccurrences ?? 4;
  const limit = opts?.limit ?? 40;

  try {
    const dbCount = await warmSceneAliasPromotionsFromDb(rawPool);
    if (opts?.autoPromote !== false) {
      await queueHarvestedAliasesForReview(rawPool, {
        days,
        minOccurrences: Math.max(minOccurrences, 5),
        limit,
        inferAliases: inferPromotion,
      });
      await warmSceneAliasPromotionsFromDb(rawPool);
    } else {
      const rows = await summarizeHarvestedTerms(rawPool, { days, minOccurrences, limit });
      for (const row of rows) {
        if (evaluateHarvestedAlias(row.term).rejected) continue;
        registerRuntimeSceneAliases(row.term, inferPromotion(row.term));
      }
      if (rows.length > 0) {
        logger.info({ count: rows.length, terms: rows.slice(0, 8).map((r) => r.term) }, "Runtime scene alias promotions warmed");
      }
      return rows.length + dbCount;
    }
    return dbCount;
  } catch (err) {
    logger.warn({ err }, "Failed to warm harvested alias promotions");
    return 0;
  }
}
