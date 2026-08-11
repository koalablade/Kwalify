/**
 * Re-score authoritative V16 live archive with blind V17 evaluator.
 * Does NOT regenerate playlists or modify generator code.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const HUMAN_ANCHORS = {
  country_cowboy: 4,
  dad_rock_bbq: 3,
  motorway_rain: 3,
  gym: 2,
  no_rap_gym: 2,
  madchester: 1,
  disco: 1,
  "80s_night_drive": 0,
};

const V16_LIVE = {
  country_cowboy: {
    prompt: "country cowboy road trip",
    tracks: [
      ["Johnny Cash", "Jackson"],
      ["Luke Combs", "Beautiful Crazy"],
      ["Zach Bryan", "Oklahoma Smokeshow"],
      ["Zach Bryan", "Pink Skies"],
      ["Luke Combs", "Dive - Recorded At Sound Stage Nashville"],
      ["Zach Bryan", "Condemned"],
      ["Waylon Jennings", "Mammas Don't Let Your Babies Grow up to Be Cowboys"],
    ],
  },
  dad_rock_bbq: {
    prompt: "dad rock BBQ with beers",
    tracks: [
      ["Queen", "Somebody To Love - Remastered 2011"],
      ["Fleetwood Mac", "Gypsy"],
      ["Blondie", "The Tide Is High"],
    ],
  },
  motorway_rain: {
    prompt: "empty motorway at midnight rain on the windscreen",
    tracks: [
      ["New Order", "Blue Monday '88"],
      ["The Cure", "The Lovecats"],
      ["The Cure", "Boys Don't Cry"],
      ["Tears For Fears", "Head Over Heels"],
      ["Tears For Fears", "Shout"],
    ],
  },
  gym: {
    prompt: "heavy gym workout aggressive",
    tracks: [
      ["AC/DC", "T.N.T."],
      ["Guns N' Roses", "Welcome To The Jungle"],
      ["AC/DC", "Back In Black"],
      ["Guns N' Roses", "Don't Cry (Original)"],
      ["Guns N' Roses", "Sweet Child O' Mine"],
    ],
  },
  no_rap_gym: {
    prompt: "no rap gym workout",
    tracks: [
      ["Black Sabbath", "Rat Salad"],
      ["Black Sabbath", "Iron Man"],
      ["Iron Maiden", "Fear of the Dark"],
      ["Nirvana", "In Bloom"],
      ["Black Sabbath", "Paranoid"],
    ],
  },
  madchester: {
    prompt: "madchester pub walk",
    tracks: [
      ["Oasis", "Wonderwall"],
      ["Oasis", "Champagne Supernova"],
      ["Blur", "Song 2 - 2012 Remaster"],
    ],
  },
  disco: {
    prompt: "disco rooftop party 1978",
    tracks: [
      ["Michael Jackson", "Rock with You - Single Version"],
      ["Otis Redding", "(Sittin' On) the Dock of the Bay - Mono"],
      ["Rockwell", "Somebody's Watching Me"],
      ["ABBA", "Gimme! Gimme! Gimme! (A Man After Midnight)"],
      ["Princess Nokia", "Dragons"],
      ["H.E.R.", "Slide (Remix) (feat. Pop Smoke, A Boogie Wit da Hoodie & Chris Brown) (feat. Pop Smoke)"],
      ["ABBA", "Waterloo"],
      ["Discotronic", "Tricky Disco - Single Edit"],
      ["Warren G", "Regulate"],
      ["Waze & Odyssey", "Bump & Grind 2014 - Radio Edit"],
      ["The Black Keys", "Wild Child"],
      ["Funkadelic", "Can You Get To That"],
      ["The Supremes", "Where Did Our Love Go - Stereo Version"],
      ["ABBA", "Bang-A-Boomerang"],
      ["Princess Chelsea", "The Cigarette Duet"],
    ],
  },
  "80s_night_drive": {
    prompt: "80s night drive",
    tracks: [["The Vapors", "Turning Japanese - Non Stop Edit"]],
  },
};

const LEGACY_V16_SCORES = {
  country_cowboy: 91,
  dad_rock_bbq: 79,
  motorway_rain: 87,
  gym: 87,
  no_rap_gym: 87,
  madchester: 88,
  disco: 91,
  "80s_night_drive": 68,
};

function getCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const { evaluateBlindHumanCuration, humanAnchorToBand, HUMAN_CURATION_EVALUATOR_V17_BLIND } =
    await import("../dist/core/editorial/human-curation-evaluator-v17-blind.js");

  const outDir = resolve(ROOT, "reports/playlist-evaluation");
  mkdirSync(outDir, { recursive: true });

  const meta = {
    evaluatorVersion: HUMAN_CURATION_EVALUATOR_V17_BLIND,
    commit: getCommit(),
    timestamp: new Date().toISOString(),
    source: "v16-live-benchmark-terminal-archive.txt (task 31672, ba92495)",
    note: "Playlists NOT regenerated. Generator untouched.",
  };

  const results = [];

  for (const [id, spec] of Object.entries(V16_LIVE)) {
    const tracks = spec.tracks.map(([artistName, trackName]) => ({
      artistName,
      trackName,
      energy: null,
      popularity: null,
    }));
    const evalResult = evaluateBlindHumanCuration(spec.prompt, tracks);
    results.push({ id, evalResult, legacyScore: LEGACY_V16_SCORES[id], humanAnchor: HUMAN_ANCHORS[id] });
  }

  const jsonPath = resolve(outDir, "v17-blind-evaluation-of-v16-live.json");
  writeFileSync(jsonPath, JSON.stringify({ meta, results }, null, 2), "utf8");

  const avg = Math.round(results.reduce((s, r) => s + r.evalResult.aggregateScore, 0) / results.length);

  const lines = [
    "# V17 Blind Evaluation of V16 Live Archive",
    "",
    `Evaluator: \`${meta.evaluatorVersion}\``,
    `Commit: ${meta.commit}`,
    `Time: ${meta.timestamp}`,
    `Source: ${meta.source}`,
    "",
    "## KPI Dashboard (Blind V17)",
    "",
    "| KPI | Result |",
    "|-----|--------|",
    `| Avg aggregate | ${avg}/100 |`,
    `| Human-level ≥80 | ${results.filter((r) => r.evalResult.aggregateScore >= 80).length}/8 |`,
    `| Press Play YES | ${results.filter((r) => r.evalResult.wouldPressPlay === "YES").length}/8 |`,
    `| Save YES | ${results.filter((r) => r.evalResult.wouldSave === "YES").length}/8 |`,
    `| Share YES | ${results.filter((r) => r.evalResult.wouldShare === "YES").length}/8 |`,
    `| Human-made YES | ${results.filter((r) => r.evalResult.wouldBelieveHumanMade === "YES").length}/8 |`,
    `| Low AI | ${results.filter((r) => r.evalResult.aiObviousness === "LOW").length}/8 |`,
    "",
    "## Calibration vs Human Anchors",
    "",
    "| Prompt | Human 0-5 | Legacy V16 | Blind V17 | Band | Press Play | Save | Share | Human-made | AI |",
    "|--------|----------:|-----------:|----------:|-----|------------|------|-------|------------|-----|",
  ];

  for (const r of results) {
    const band = humanAnchorToBand(r.humanAnchor);
    lines.push(
      `| ${r.id} | ${r.humanAnchor} | ${r.legacyScore} | ${r.evalResult.aggregateScore} | ${band.min}-${band.max} | ${r.evalResult.wouldPressPlay} | ${r.evalResult.wouldSave} | ${r.evalResult.wouldShare} | ${r.evalResult.wouldBelieveHumanMade} | ${r.evalResult.aiObviousness} |`,
    );
  }

  lines.push("", "## Per-prompt detail", "");

  for (const r of results) {
    const e = r.evalResult;
    lines.push(`### ${r.id}`);
    lines.push(`Prompt: ${e.prompt}`);
    lines.push(`Moment interpretation: ${e.momentInterpretation}`);
    lines.push(`Aggregate: ${e.aggregateScore}/100 | Legacy coupled eval: ${r.legacyScore}/100`);
    lines.push(
      `Press Play: ${e.wouldPressPlay} | Save: ${e.wouldSave} | Share: ${e.wouldShare} | Human-made: ${e.wouldBelieveHumanMade}`,
    );
    lines.push(`AI: ${e.aiObviousness} — ${e.aiObviousnessReasons.join("; ") || "none"}`);
    if (e.canonicalOmissions.length) lines.push(`Canonical omissions: ${e.canonicalOmissions.join("; ")}`);
    if (e.fillerTracks.length) lines.push(`Filler: ${e.fillerTracks.join("; ")}`);
    lines.push("", "Tracklist:");
    for (const t of e.tracks) {
      lines.push(
        `  ${t.position}. ${t.artistName} — ${t.trackName} (song ${t.songFit}/10, pos ${t.positionFit}/10${t.filler ? ", FILLER" : ""})`,
      );
    }
    lines.push("", "Transitions:");
    for (const tr of e.transitions) {
      lines.push(`  ${tr.fromPosition}→${tr.toPosition} ${tr.quality}: ${tr.reason}`);
    }
    lines.push("");
  }

  const mdPath = resolve(outDir, "v17-blind-evaluation-of-v16-live.md");
  writeFileSync(mdPath, lines.join("\n"), "utf8");

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`Avg blind score: ${avg}/100`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
