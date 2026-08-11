/**
 * Apply V18 human curation pass to archived V16 deliveries (no regeneration).
 * Measures blind evaluator impact of generator-side moment-fit + eject/replace.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

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

function getCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const { applyHumanCurationSequencing } = await import(
    "../dist/core/editorial/human-curation-sequencer.js"
  );
  const { evaluateBlindHumanCuration, HUMAN_CURATION_EVALUATOR_V17_BLIND } = await import(
    "../dist/core/editorial/human-curation-evaluator-v17-blind.js"
  );
  const { getCulturalProfile } = await import("../dist/core/editorial/cultural-identity-profile.js");

  const profileByPrompt = {
    madchester: getCulturalProfile("madchester_world"),
    disco: getCulturalProfile("disco_1970s_world") ?? getCulturalProfile("disco_world"),
    dad_rock_bbq: getCulturalProfile("dad_rock_world"),
  };

  const outDir = resolve(ROOT, "reports/playlist-evaluation/v18-live-benchmark");
  mkdirSync(outDir, { recursive: true });

  const results = [];

  for (const [id, spec] of Object.entries(V16_LIVE)) {
    const before = spec.tracks.map(([artistName, trackName]) => ({ artistName, trackName, energy: null, popularity: null }));
    const beforeEval = evaluateBlindHumanCuration(spec.prompt, before);

    const seq = applyHumanCurationSequencing(before, {
      prompt: spec.prompt,
      preserveThesisOpener: true,
      culturalProfile: profileByPrompt[id] ?? null,
    });
    const after = seq.tracks.map((t) => ({
      artistName: t.artistName,
      trackName: t.trackName,
      energy: t.energy ?? null,
      popularity: t.popularity ?? null,
    }));
    const afterEval = evaluateBlindHumanCuration(spec.prompt, after);

    const closerAfterTrack = after[after.length - 1];
    const closerAfterStr = closerAfterTrack
      ? `${closerAfterTrack.artistName} — ${closerAfterTrack.trackName}`
      : "—";

    results.push({
      id,
      prompt: spec.prompt,
      v16Blind: beforeEval.aggregateScore,
      v18PostSeqBlind: afterEval.aggregateScore,
      trackCountBefore: before.length,
      trackCountAfter: after.length,
      openerBefore: `${before[0]?.artistName} — ${before[0]?.trackName}`,
      openerAfter: after[0] ? `${after[0].artistName} — ${after[0].trackName}` : "—",
      closerBefore: `${before[before.length - 1]?.artistName} — ${before[before.length - 1]?.trackName}`,
      closerAfter: closerAfterStr,
      sequencer: { swaps: seq.swaps, reorders: seq.reorders, removals: seq.removals, replacements: seq.replacements, diagnostics: seq.diagnostics },
      pressPlay: afterEval.wouldPressPlay,
      save: afterEval.wouldSave,
      humanMade: afterEval.wouldBelieveHumanMade,
      afterTracks: after.map((t, i) => `${i + 1}. ${t.artistName} — ${t.trackName}`),
    });
  }

  const payload = {
    meta: {
      type: "v18-sequencer-simulation-on-v16-archive",
      commit: getCommit(),
      evaluatorVersion: HUMAN_CURATION_EVALUATOR_V17_BLIND,
      note: "Applies V18 human curation pass to frozen V16 deliveries. Full live regeneration not run.",
      timestamp: new Date().toISOString(),
    },
    results,
  };

  writeFileSync(resolve(outDir, "generation-simulated.json"), JSON.stringify(payload, null, 2), "utf8");

  const lines = [
    "# V18 Simulated Benchmark (V16 archive + V18 sequencer)",
    "",
    `Commit: ${payload.meta.commit}`,
    `Evaluator: ${payload.meta.evaluatorVersion} (frozen)`,
    "",
    "| Prompt | V16 blind | V18 post-seq | Tracks | Save | Press Play | Opener change |",
    "|--------|----------:|-------------:|-------:|------|------------|---------------|",
  ];

  for (const r of results) {
    lines.push(
      `| ${r.id} | ${r.v16Blind} | ${r.v18PostSeqBlind} | ${r.trackCountBefore}→${r.trackCountAfter} | ${r.save} | ${r.pressPlay} | ${r.openerBefore !== r.openerAfter ? "yes" : "—"} |`,
    );
  }

  writeFileSync(resolve(outDir, "report-simulated.md"), lines.join("\n"), "utf8");
  console.log(`Wrote ${outDir}/generation-simulated.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
