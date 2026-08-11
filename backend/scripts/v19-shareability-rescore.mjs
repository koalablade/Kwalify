/**
 * V19 Experiment E — re-score frozen V19-C playlists for Share before/after (no live gen).
 * Usage: node backend/scripts/v19-shareability-rescore.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT = resolve(ROOT, "reports/playlist-evaluation/v19-experiment-e-rescore.json");

/** Same frozen V19-C deliveries as Experiment D rescore. */
const V19_C_PLAYLISTS = [
  {
    id: "country_cowboy",
    prompt: "country cowboy road trip",
    tracks: [
      { artistName: "Johnny Cash", trackName: "Jackson" },
      { artistName: "Luke Combs", trackName: "Dive - Recorded At Sound Stage Nashville" },
      { artistName: "Zach Bryan", trackName: "Oklahoma Smokeshow" },
      { artistName: "Luke Combs", trackName: "Beautiful Crazy" },
      { artistName: "Zach Bryan", trackName: "Pink Skies" },
      { artistName: "Zach Bryan", trackName: "Condemned" },
      { artistName: "Waylon Jennings", trackName: "Mammas Don't Let Your Babies Grow up to Be Cowboys" },
    ],
  },
  {
    id: "dad_rock_bbq",
    prompt: "dad rock BBQ with beers",
    tracks: [
      { artistName: "AC/DC", trackName: "T.N.T." },
      { artistName: "AC/DC", trackName: "Back In Black" },
      { artistName: "Fleetwood Mac", trackName: "Silver Springs - 2004 Remaster" },
      { artistName: "AC/DC", trackName: "It's a Long Way to the Top (If You Wanna Rock 'N' Roll)" },
      { artistName: "Fleetwood Mac", trackName: "Hypnotized" },
      { artistName: "Tom Petty and the Heartbreakers", trackName: "Breakdown - Remastered" },
      { artistName: "Tom Petty and the Heartbreakers", trackName: "Into The Great Wide Open" },
      { artistName: "Led Zeppelin", trackName: "Stairway to Heaven - 1990 Remaster" },
      { artistName: "Led Zeppelin", trackName: "Tangerine - Remaster" },
    ],
  },
  {
    id: "motorway_rain",
    prompt: "empty motorway at midnight rain on the windscreen",
    tracks: [
      { artistName: "New Order", trackName: "Blue Monday '88" },
      { artistName: "Chromatics", trackName: "Cherry" },
      { artistName: "The Cure", trackName: "The Lovecats" },
      { artistName: "The Cure", trackName: "Boys Don't Cry" },
      { artistName: "Tears For Fears", trackName: "Head Over Heels" },
    ],
  },
  {
    id: "gym",
    prompt: "heavy gym workout aggressive",
    tracks: [
      { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85, popularity: 88 },
      { artistName: "AC/DC", trackName: "T.N.T.", energy: 0.85, popularity: 70 },
      { artistName: "Guns N' Roses", trackName: "Welcome To The Jungle", energy: 0.92, popularity: 80 },
    ],
  },
  {
    id: "no_rap_gym",
    prompt: "no rap gym workout",
    tracks: [
      { artistName: "Black Sabbath", trackName: "Paranoid", energy: 0.78, popularity: 70 },
      { artistName: "Black Sabbath", trackName: "Rat Salad", energy: 0.55, popularity: 12 },
      { artistName: "Iron Maiden", trackName: "Fear of the Dark", energy: 0.82, popularity: 75 },
      { artistName: "Nirvana", trackName: "In Bloom", energy: 0.85, popularity: 80 },
      { artistName: "Black Sabbath", trackName: "Iron Man", energy: 0.85, popularity: 78 },
    ],
  },
  {
    id: "madchester",
    prompt: "madchester pub walk",
    tracks: [
      { artistName: "The Stone Roses", trackName: "Made of Stone - Remastered 2009" },
      { artistName: "Oasis", trackName: "Wonderwall" },
      { artistName: "Oasis", trackName: "Champagne Supernova" },
      { artistName: "Blur", trackName: "Song 2 - 2012 Remaster" },
    ],
  },
  {
    id: "disco",
    prompt: "disco rooftop party 1978",
    tracks: [
      { artistName: "Michael Jackson", trackName: "Rock with You - Single Version" },
      { artistName: "ABBA", trackName: "Gimme! Gimme! Gimme! (A Man After Midnight)" },
    ],
  },
  {
    id: "80s_night_drive",
    prompt: "80s night drive",
    tracks: [
      { artistName: "The Cure", trackName: "The Lovecats" },
      { artistName: "Tears For Fears", trackName: "Everybody Wants To Rule The World" },
      { artistName: "Tears For Fears", trackName: "Head Over Heels - Dave Bascombe 7\" N.Mix" },
      { artistName: "Gary Numan", trackName: "Cars" },
      { artistName: "The Human League", trackName: "Don't You Want Me" },
      { artistName: "Tears For Fears", trackName: "Head Over Heels" },
      { artistName: "Pet Shop Boys", trackName: "West End Girls - 2001 Remaster" },
    ],
  },
];

async function main() {
  const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
  const { legacyFlatSequencingWouldShare } = await import("../dist/core/editorial/shareability-verdict.js");

  const rows = [];
  for (const pl of V19_C_PLAYLISTS) {
    const score = evaluateHumanCurationScore(pl.prompt, pl.tracks);
    const oldShare = legacyFlatSequencingWouldShare(score.totalScore, score.dimensions.sequencing.score);
    rows.push({
      id: pl.id,
      tracks: pl.tracks.length,
      hcs: score.totalScore,
      sequencing: score.dimensions.sequencing.score,
      sequencingEvidence: score.dimensions.sequencing.evidence,
      deliveryTier: score.saveabilityDeliveryTier,
      save: score.wouldSave,
      oldShare,
      newShare: score.wouldShare,
      changed: oldShare !== score.wouldShare,
    });
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));

  console.log("| Prompt | Tracks | HCS | Seq | Old Share | New Share | Save | Changed? |");
  console.log("| ------ | -----: | --: | --: | --------- | --------- | ---- | -------- |");
  for (const r of rows) {
    console.log(
      `| ${r.id} | ${r.tracks} | ${r.hcs} | ${r.sequencing} | ${r.oldShare} | ${r.newShare} | ${r.save} | ${r.changed ? "YES" : "no"} |`,
    );
  }
  console.log(`\nWrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
