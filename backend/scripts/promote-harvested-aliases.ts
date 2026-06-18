/**
 * Promote harvested unknown terms into persistent scene alias graph.
 *
 * Usage:
 *   npm run promote:aliases              # suggestions only
 *   npm run promote:aliases -- --apply   # write to DB + runtime graph
 */

import { initPool } from "../lib/pg-pool";
import { initDb } from "../db";
import { runDbInit } from "../lib/db-init";
import { summarizeHarvestedTerms } from "../lib/unknown-term-harvest";
import { resolveSceneAliases } from "../lib/scene-alias-graph";
import { autoPromoteHarvestedTerms, loadSceneAliasPromotions } from "../lib/alias-promotion-store";

const GENRE_HINTS = ["rock", "metal", "indie", "punk", "blues", "folk", "country", "electronic", "hip_hop", "pop", "rnb"];

function inferWeakMapping(term: string): string[] {
  const normalized = term.toLowerCase().trim().replace(/\s+/g, "-");
  const existing = resolveSceneAliases(normalized);
  if (existing.length > 0 && existing[0] !== normalized) return existing;
  const hits = GENRE_HINTS.filter((genre) => normalized.includes(genre.replace("_", "")));
  if (hits.length > 0) return hits;
  if (/\b(car|garage|workshop|volvo|saab|bmw|mx-?5|e46)\b/i.test(term)) {
    return ["blues", "indie", "rock", "folk"];
  }
  if (/\b(kerrang|emo|skate|punk)\b/i.test(term)) return ["rock", "metal", "indie", "punk"];
  if (/\b(nfs|forza|driving|horizon|gta)\b/i.test(term)) {
    return ["rock", "electronic", "metal", "hip_hop"];
  }
  return ["indie", "rock"];
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to promote harvested aliases");
  }
  const apply = process.argv.includes("--apply");
  const days = Number(process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1] ?? 30);
  const min = Number(process.argv.find((arg) => arg.startsWith("--min="))?.split("=")[1] ?? 5);

  const pool = initPool(connectionString);
  initDb(pool);
  await runDbInit(pool);

  const rows = await summarizeHarvestedTerms(pool, { days, minOccurrences: min, limit: 40 });
  const suggestions = rows.map((row) => ({
    term: row.term,
    occurrences: row.occurrences,
    suggestedAliases: inferWeakMapping(row.term),
    samplePrompt: row.samplePrompts[0] ?? null,
  }));

  let promoted: unknown[] = [];
  if (apply) {
    promoted = await autoPromoteHarvestedTerms(pool, {
      days,
      minOccurrences: min,
      limit: 40,
      inferAliases: inferWeakMapping,
    });
  }

  const active = await loadSceneAliasPromotions(pool);
  process.stdout.write(`${JSON.stringify({
    apply,
    days,
    minOccurrences: min,
    suggestions,
    promotedCount: promoted.length,
    activePromotions: active.slice(0, 20),
  }, null, 2)}\n`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
