/**
 * Suggest alias promotions from harvested unknown terms (weekly review helper).
 *
 * Usage: npm run promote:aliases [--days=30] [--min=3]
 */

import { initPool } from "../lib/pg-pool";
import { initDb } from "../db";
import { runDbInit } from "../lib/db-init";
import { summarizeHarvestedTerms } from "../lib/unknown-term-harvest";
import { resolveSceneAliases } from "../lib/scene-alias-graph";

const GENRE_HINTS = ["rock", "metal", "indie", "punk", "blues", "folk", "country", "electronic", "hip_hop", "pop", "rnb"];

function inferWeakMapping(term: string): string[] {
  const normalized = term.toLowerCase().trim().replace(/\s+/g, "-");
  const existing = resolveSceneAliases(normalized);
  if (existing.length > 0 && existing[0] !== normalized) return existing;
  const hits = GENRE_HINTS.filter((genre) => normalized.includes(genre.replace("_", "")));
  return hits.length > 0 ? hits : ["indie", "rock"];
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to promote harvested aliases");
  }
  const days = Number(process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1] ?? 30);
  const min = Number(process.argv.find((arg) => arg.startsWith("--min="))?.split("=")[1] ?? 3);

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

  process.stdout.write(`${JSON.stringify({ days, minOccurrences: min, suggestions }, null, 2)}\n`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
