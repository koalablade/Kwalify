import pg from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const JSON_PATH = resolve(ROOT, "reports/playlist-evaluation/v31-forensic-post-purity-audit.json");
const MD_PATH = resolve(ROOT, "reports/playlist-evaluation/V31_FORENSIC_POST_PURITY_AUDIT.md");

const env = readFileSync(resolve(ROOT, ".env"), "utf8");
const dbUrl = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "");
const payload = JSON.parse(readFileSync(JSON_PATH, "utf8"));
const reggae = payload.liveResults.find((r) => r.prompt === "sunset beach reggae");

const ids = reggae?.underfillStages?.find((s) => s.stage === "genre_evidence_guard")?.removedTrackIds ?? [];
let idMap = {};
if (dbUrl && ids.length) {
  const pool = new pg.Pool({ connectionString: dbUrl });
  const { rows } = await pool.query(
    "SELECT track_id, artist_name, track_name FROM liked_songs WHERE spotify_user_id = $1 AND track_id = ANY($2)",
    ["koalablade", ids],
  );
  await pool.end();
  idMap = Object.fromEntries(rows.map((r) => [r.track_id, { artist: r.artist_name, track: r.track_name }]));
}

reggae.genreEvidenceGuardRejections = ids.map((id, i) => ({
  index: i + 1,
  trackId: id,
  spotifyUri: `spotify:track:${id}`,
  artist: idMap[id]?.artist ?? null,
  track: idMap[id]?.track ?? null,
  stage: "genre_evidence_guard",
  bucket: "G",
  rejectionFunction: "strictGenreEvidenceDiagnostics → genre_evidence_guard constrained publish",
}));

const anchors = ["bob marley", "peter tosh", "toots", "jimmy cliff", "gregory isaacs", "shaggy", "sean paul", "ub40", "damian marley", "burning spear"];
if (dbUrl) {
  const pool = new pg.Pool({ connectionString: dbUrl });
  const { rows } = await pool.query("SELECT artist_name FROM liked_songs WHERE spotify_user_id = $1", ["koalablade"]);
  await pool.end();
  const norm = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  const counts = { total: rows.length };
  for (const a of anchors) counts[a] = rows.filter((x) => norm(x.artist_name).includes(a)).length;
  payload.libraryReggaeSupply = counts;
}

payload.reggaeExactFunnel = {
  v3Survivors: 36,
  v3Composed: 25,
  afterGenreEvidenceGuard: 15,
  prePurity: 15,
  postPurityPositionFilter: 6,
  delivered: 6,
  losses: {
    v3Composition: 11,
    genreEvidenceGuard: 10,
    worldPurityGate: 9,
    note: "genre_evidence_guard runs BEFORE world_purity_gate; combined 25→6 = 19 track loss",
  },
};

payload.executiveConclusion =
  "V30 fixed routing (36 survivors) but delivery stays at 6 because genre_evidence_guard removes 10/25 composed tracks before world_purity_gate removes 9/15 — same six tracks as the old 17-input path.";

payload.rootCauseVerdict = {
  code: 6,
  label: "Multiple bottlenecks — PRIMARY: genre_evidence_guard (25→15); SECONDARY: world_purity_gate position-tier filter (15→6); TERTIARY: V3 composition (36→25)",
  evidence: payload.reggaeExactFunnel.losses.note,
};

payload.depthAnalysis = {
  verdict: "B",
  label: "Many more acceptable tracks exist in library and V3 pool but are rejected downstream — not that only 6 are acceptable",
  libraryHasDepth: true,
  sameSixTracksAsOldPath: true,
  deliveryCapLimiting: false,
};

writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2), "utf8");

let md = readFileSync(MD_PATH, "utf8");
const insert = `

## K. Exact reggae funnel (36 → 6)

| Stage | Count | Removed | Function |
|---|---:|---:|---|
| V3 pre-filter survivors | 36 | — | buildV3CandidatePool |
| V3 composed | 25 | 11 | runV3Pipeline |
| After genre_evidence_guard | 15 | **10** | strictGenreEvidenceDiagnostics → constrained publish |
| Pre-purity (entering applyWorldPurityGate) | 15 | 0 | — |
| Post-purity position filter | 6 | **9** | filterByWorldPurity |
| Delivered | 6 | 0 | — |

**Critical:** 10 tracks are lost at \`genre_evidence_guard\` **before** purity runs. Purity alone does not explain 36→6.

### Genre-evidence guard rejections (10 tracks)

${reggae.genreEvidenceGuardRejections.map((t) => `- ${t.artist ?? t.trackId} — ${t.track ?? "?"} (\`${t.trackId}\`)`).join("\n")}

## L. Depth analysis

- **Verdict B:** Library contains substantial reggae supply (${payload.libraryReggaeSupply?.total ?? "?"} liked; Bob Marley ${payload.libraryReggaeSupply?.["bob marley"] ?? "?"} tracks). V30 expanded pool to 36 survivors but **same 6 tracks deliver** as V29/V30 old path.
- Delivery cap is **not** limiting (6 < 25 requested; honest partial from filtering).
- Checkpoint strip **not applied** (checkpointStripApplied=false); losses are position-tier filter scores (62 vs 80–85 threshold).
`;

if (!md.includes("## K. Exact reggae funnel")) {
  md = md.replace("**No production code was modified for this audit.**", insert + "\n**No production code was modified for this audit.**");
  md = md.replace("## A. Executive conclusion\n\nV30 expanded", "## A. Executive conclusion\n\n" + payload.executiveConclusion + "\n\n_Original:_ V30 expanded");
  md = md.replace("## G. Root-cause verdict\n\n**6**", "## G. Root-cause verdict\n\n**6** — " + payload.rootCauseVerdict.label);
  md = md.replace('"libraryReggaeSupply": {}', JSON.stringify(payload.libraryReggaeSupply, null, 2));
}
writeFileSync(MD_PATH, md, "utf8");
console.log("Enriched report");
