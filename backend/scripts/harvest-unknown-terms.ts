/**
 * Summarize harvested unknown prompt terms for alias/scene review.
 *
 * Usage: npm run harvest:unknown-terms
 */

import { initPool } from "../lib/pg-pool";
import { initDb } from "../db";
import { runDbInit } from "../lib/db-init";
import { summarizeHarvestedTerms } from "../lib/unknown-term-harvest";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to harvest unknown terms");
  }
  const days = Number(process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1] ?? 30);
  const min = Number(process.argv.find((arg) => arg.startsWith("--min="))?.split("=")[1] ?? 2);

  const pool = initPool(connectionString);
  initDb(pool);
  await runDbInit(pool);

  const rows = await summarizeHarvestedTerms(pool, { days, minOccurrences: min, limit: 100 });
  if (rows.length === 0) {
    console.log(`No harvested terms in the last ${days} days (min occurrences: ${min}).`);
    await pool.end();
    return;
  }

  console.log(`Top harvested terms (last ${days} days, min ${min} occurrences):\n`);
  for (const row of rows) {
    console.log(`- ${row.term}`);
    console.log(`  occurrences: ${row.occurrences}, unique prompts: ${row.uniquePrompts}, avg confidence: ${row.avgConfidence.toFixed(2)}`);
    if (row.samplePrompts.length) {
      console.log(`  samples: ${row.samplePrompts.map((p) => JSON.stringify(p.slice(0, 80))).join(" | ")}`);
    }
    console.log("");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
