/**
 * Offline Human Curation Score for V16 benchmark track lists.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateHumanCurationScore,
  applyHumanCurationSequencing,
  summariseHumanCurationBenchmark,
} from "../dist/core/editorial/human-curation-score.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const BASELINE_HUMAN = {
  country_cowboy: 4,
  dad_rock_bbq: 3,
  motorway_rain: 3,
  gym: 2,
  no_rap_gym: 2,
  madchester: 1,
  disco: 1,
  "80s_night_drive": 0,
};

const DELIVERED = {
  dad_rock_bbq: {
    prompt: "dad rock BBQ with beers",
    verdict: "KEEP",
    count: 9,
    tracks: [
      ["AC/DC", "Back In Black", 0.85, 88],
      ["AC/DC", "T.N.T.", 0.84, 85],
      ["Led Zeppelin", "Stairway to Heaven", 0.35, 90],
      ["Fleetwood Mac", "Silver Springs", 0.5, 70],
      ["Fleetwood Mac", "Hypnotized", 0.48, 55],
      ["Tom Petty and the Heartbreakers", "Breakdown", 0.62, 75],
      ["Tom Petty and the Heartbreakers", "Into The Great Wide Open", 0.58, 72],
      ["Led Zeppelin", "Tangerine", 0.42, 65],
      ["AC/DC", "It's a Long Way to the Top", 0.8, 78],
    ],
  },
  "80s_night_drive": {
    prompt: "80s night drive",
    verdict: "DROP",
    count: 1,
    tracks: [["The Vapors", "Turning Japanese", 0.72, 70]],
  },
  motorway_rain: {
    prompt: "empty motorway at midnight rain on the windscreen",
    verdict: "MAYBE",
    count: 5,
    tracks: [
      ["New Order", "Blue Monday '88", 0.72, 80],
      ["The Cure", "The Lovecats", 0.55, 75],
      ["The Cure", "Boys Don't Cry", 0.58, 78],
      ["Tears For Fears", "Head Over Heels", 0.62, 72],
      ["Tears For Fears", "Shout", 0.88, 85],
    ],
  },
  madchester: {
    prompt: "madchester pub walk",
    verdict: "DROP",
    count: 0,
    tracks: [],
  },
  disco: { prompt: "disco rooftop party 1978", verdict: "DROP", count: 0, tracks: [] },
  gym: {
    prompt: "heavy gym workout aggressive",
    verdict: "MAYBE",
    count: 5,
    tracks: [
      ["AC/DC", "T.N.T.", 0.84, 85],
      ["Guns N' Roses", "Welcome To The Jungle", 0.92, 82],
      ["AC/DC", "Back In Black", 0.85, 88],
      ["Guns N' Roses", "Don't Cry", 0.42, 80],
      ["Guns N' Roses", "Sweet Child O' Mine", 0.55, 85],
    ],
  },
  country_cowboy: {
    prompt: "country cowboy road trip",
    verdict: "KEEP",
    count: 8,
    tracks: [
      ["Johnny Cash", "Jackson", 0.6, 78],
      ["Luke Combs", "Beautiful Crazy", 0.62, 80],
      ["Zach Bryan", "Oklahoma Smokeshow", 0.58, 75],
      ["Zach Bryan", "Pink Skies", 0.55, 72],
      ["Johnny Cash", "Ring of Fire", 0.55, 85],
      ["Zach Bryan", "Condemned", 0.52, 68],
      ["Morgan Wallen", "Livin' The Dream", 0.65, 82],
      ["Waylon Jennings", "Mammas Don't Let Your Babies Grow up to Be Cowboys", 0.58, 70],
    ],
  },
  no_rap_gym: {
    prompt: "no rap gym workout",
    verdict: "MAYBE",
    count: 5,
    tracks: [
      ["Black Sabbath", "Rat Salad", 0.55, 12],
      ["Black Sabbath", "Iron Man", 0.85, 82],
      ["Iron Maiden", "Fear of the Dark", 0.88, 78],
      ["Nirvana", "In Bloom", 0.75, 80],
      ["Black Sabbath", "Paranoid", 0.9, 85],
    ],
  },
};

function mapTracks(rows) {
  return rows.map(([artistName, trackName, energy, popularity]) => ({
    artistName,
    trackName,
    energy,
    popularity,
  }));
}

const lines = ["# V16 Human Curation Score (offline from live benchmark delivery)", ""];
const results = [];

for (const [id, spec] of Object.entries(DELIVERED)) {
  const tracks = mapTracks(spec.tracks);
  const score = evaluateHumanCurationScore(spec.prompt, tracks);
  const seq = applyHumanCurationSequencing(tracks, { prompt: spec.prompt });
  const postSeqScore = evaluateHumanCurationScore(spec.prompt, seq.tracks);
  results.push({ id, score, trackCount: spec.count, verdict: spec.verdict });

  lines.push(`## ${id}`);
  lines.push(`V15 verdict: ${spec.verdict} | tracks: ${spec.count}`);
  lines.push(`Human Curation Score: ${score.totalScore}/100 (post-sequencer sim: ${postSeqScore.totalScore})`);
  lines.push(`Save: ${score.wouldSave} | Share: ${score.wouldShare} | AI: ${score.aiObviousness}`);
  lines.push(`Baseline human (0-5): ${BASELINE_HUMAN[id]}`);
  if (seq.diagnostics.length) lines.push(`Sequencer would apply: ${seq.diagnostics.join(", ")}`);
  lines.push("");
}

const summary = summariseHumanCurationBenchmark(
  results.map((r) => ({ id: r.id, score: r.score, trackCount: r.trackCount })),
);

lines.push("## KPI Dashboard");
lines.push(`Average Human Curation Score: ${summary.averageScore}/100`);
lines.push(`Human-level (≥80): ${summary.humanLevelCount}/8`);
lines.push(`Press Play YES: ${summary.pressPlayYes}/8 | Save YES: ${summary.saveYes}/8`);
lines.push(`Share YES: ${summary.shareYes}/8 | Human-made YES: ${summary.humanMadeYes}/8 | Low AI: ${summary.lowAiCount}/8`);
lines.push("");
lines.push("## Before vs After");
lines.push("| Prompt | Old Human | New Score/100 | Save | Share | AI | V15 KEEP |");
lines.push("|--------|-----------|---------------|------|-------|-----|----------|");
for (const r of results) {
  lines.push(
    `| ${r.id} | ${BASELINE_HUMAN[r.id]} | ${r.score.totalScore} | ${r.score.wouldSave} | ${r.score.wouldShare} | ${r.score.aiObviousness} | ${r.verdict} |`,
  );
}

const outPath = resolve(ROOT, "reports/playlist-evaluation/v16-offline-from-v15-playlists.log");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(lines.join("\n"));
console.log("\nWrote", outPath);
