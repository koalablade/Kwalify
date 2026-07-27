/**
 * Diagnosis-only: library supply + classification for tier-1 underfill prompts.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { buildLockedIntent } from "../core/v3/intent";
import { buildUserGenreProfile } from "../lib/user-genre-profile";

const USER = "koalablade";

const TARGETS = [
  { id: "party-latin-summer", vibe: "latin summer beach party" },
  { id: "drive-late-garage", vibe: "late night uk garage drive" },
  { id: "gym-2000s-pop-punk", vibe: "2000s pop punk gym workout" },
] as const;

function readDbUrl(): string {
  const env = readFileSync(".env", "utf8");
  const match = env.match(/^DATABASE_URL=(.+)$/m);
  if (!match) throw new Error("DATABASE_URL missing");
  return match[1].trim().replace(/^"|"$/g, "");
}

function termHit(hay: string, term: string): boolean {
  return hay.includes(term);
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: readDbUrl() });
  const rows = (await pool.query("SELECT * FROM liked_songs WHERE spotify_user_id = $1", [USER])).rows;
  const profile = buildUserGenreProfile(rows);
  const classMap = profile.trackClassifications;

  const countWhere = (pred: (terms: string, family: string) => boolean): number => {
    let n = 0;
    for (const [, c] of classMap) {
      const terms = [c.genreFamily, c.genrePrimary, c.primarySubgenre, c.secondarySubgenre, ...c.subGenres]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (pred(terms, c.genreFamily.toLowerCase())) n += 1;
    }
    return n;
  };

  console.log(JSON.stringify({
    libraryTotal: rows.length,
    latinFamily: countWhere((t, f) => f === "latin" || t.includes("latin")),
    reggaeton: countWhere((t) => t.includes("reggaeton")),
    salsa: countWhere((t) => t.includes("salsa")),
    ukGarageSub: countWhere((t) => t.includes("uk_garage") || t.includes("uk garage")),
    garageAny: countWhere((t) => t.includes("garage")),
    popPunkSub: countWhere((t) => t.includes("pop_punk") || t.includes("pop punk")),
    punkFamily: countWhere((t, f) => f === "punk" || t.includes("punk")),
    rockFamily: countWhere((t, f) => f === "rock"),
  }, null, 2));

  for (const target of TARGETS) {
    const intent = buildLockedIntent(target.vibe);
    const expectedFamilies = intent.genreFamilies;
    const samples: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const c = classMap.get(row.track_id);
      if (!c) continue;
      const terms = [c.genreFamily, c.genrePrimary, c.primarySubgenre, c.secondarySubgenre, ...c.subGenres]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      let relevant = false;
      if (target.id === "party-latin-summer") {
        relevant = termHit(terms, "latin") || termHit(terms, "reggaeton") || termHit(terms, "salsa");
      } else if (target.id === "drive-late-garage") {
        relevant = termHit(terms, "garage") || termHit(terms, "ukg") || termHit(terms, "2-step");
      } else {
        relevant = termHit(terms, "punk") || termHit(terms, "pop_punk");
      }
      if (!relevant) continue;
      samples.push({
        artist: row.artist_name,
        track: row.track_name,
        year: row.release_year,
        family: c.genreFamily,
        subgenre: c.primarySubgenre,
        subgenres: c.subGenres,
      });
    }
    console.log(`\n=== ${target.id} ===`);
    console.log(JSON.stringify({
      lockedIntent: {
        genreFamilies: intent.genreFamilies,
        primarySubgenre: intent.primarySubgenre,
        subgenreTerms: intent.subgenreTerms,
        eraRange: intent.eraRange,
      },
      libraryMatchCount: samples.length,
      byFamily: samples.reduce<Record<string, number>>((acc, s) => {
        const f = String(s.family);
        acc[f] = (acc[f] ?? 0) + 1;
        return acc;
      }, {}),
      bySubgenre: samples.reduce<Record<string, number>>((acc, s) => {
        const f = String(s.subgenre);
        acc[f] = (acc[f] ?? 0) + 1;
        return acc;
      }, {}),
      samples: samples.slice(0, 20),
    }, null, 2));
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
