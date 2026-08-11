/**
 * Offline V14 vs V15 before/after — no live API required.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolveCommittedWorld, getCulturalProfile } from "../dist/core/committed-world.js";
import { retrieveWithRecovery } from "../dist/core/editorial/layered-world-retrieval.js";
import { selectThesisOpener, enforceThesisOpener } from "../dist/core/editorial/thesis-opener-gate.js";
import { applyWorldPurityGate } from "../dist/core/editorial/world-purity-gate.js";
import { assessCandidateCoverageTier, getDeliveryCap } from "../dist/core/editorial/world-coverage.js";

const FIXTURES = [
  {
    id: "motorway_rain",
    prompt: "empty motorway at midnight rain on the windscreen",
    pool: ["M83", "Chromatics", "Bon Iver", "Oasis", "David Guetta"],
  },
  {
    id: "madchester",
    prompt: "madchester pub walk",
    pool: ["The Stone Roses", "Happy Mondays", "Oasis", "Bon Iver"],
  },
  {
    id: "dad_rock_bbq",
    prompt: "dad rock BBQ with beers",
    pool: ["Queen", "Tom Petty", "AC/DC", "Eagles", "Fleetwood Mac", "Guns N' Roses", "Journey", "Bon Iver"],
  },
  {
    id: "gym",
    prompt: "heavy gym workout aggressive",
    pool: ["Metallica", "AC/DC", "Paramore", "Bon Iver"],
  },
  {
    id: "80s_night_drive",
    prompt: "80s night drive",
    pool: ["The Cure", "Pet Shop Boys", "Depeche Mode", "Fred again.."],
  },
  {
    id: "disco",
    prompt: "disco rooftop party 1978",
    pool: ["Chic", "Bee Gees", "Donna Summer", "Dua Lipa"],
  },
  {
    id: "country_cowboy",
    prompt: "country cowboy road trip",
    pool: ["Johnny Cash", "Willie Nelson", "Bon Iver", "Arctic Monkeys"],
  },
];

function mockTracks(artists) {
  return artists.map((artist, i) => ({
    trackId: `t${i}`,
    trackName: `Track ${i + 1}`,
    artistName: artist,
    albumName: "Album",
    energy: 0.7,
    valence: 0.5,
    releaseYear: 1985,
  }));
}

/** V14 behaviour: refuse when thesis opener < 95 and no explicit pass. */
function simulateV14(tracks, world, profile, prompt) {
  const purity = applyWorldPurityGate(tracks, world, { prompt, requestedLength: 25 });
  const thesis = selectThesisOpener(purity.tracks, profile);
  const openerPct = thesis ? Math.round(thesis.score * 100) : 0;
  const v14Refuse =
    purity.tracks.length === 0 || (thesis != null && openerPct < 95 && !thesis.passed);
  const delivered = v14Refuse ? [] : purity.tracks;
  return {
    count: delivered.length,
    opener: delivered[0]?.artistName ?? "(none)",
    openerPct,
    verdict: delivered.length === 0 ? "DROP — zero tracks" : `${delivered.length} tracks`,
  };
}

/** V15 behaviour: layered retrieval + thesis fallback + coverage tiers. */
function simulateV15(tracks, world, profile, prompt) {
  const retrieval = retrieveWithRecovery({
    prompt,
    userLibrary: tracks,
    culturalProfile: profile,
    committedWorld: world,
  });
  const tier = assessCandidateCoverageTier(retrieval.tracks, profile);
  const cap = getDeliveryCap(tier, 25) || retrieval.tracks.length;
  const pool = retrieval.tracks.slice(0, cap);
  const purity = applyWorldPurityGate(pool, world, {
    prompt,
    requestedLength: 25,
    coverageLevel: tier,
  });
  const thesis = enforceThesisOpener(purity.tracks, profile);
  const delivered = thesis.tracks.length > 0 ? thesis.tracks : purity.tracks;
  return {
    count: delivered.length,
    opener: delivered[0]?.artistName ?? "(none)",
    tier,
    retrievalHits: retrieval.tracks.length,
    verdict:
      delivered.length === 0
        ? "DROP — zero tracks"
        : delivered.length <= 5
          ? `MAYBE — honest partial (${delivered.length})`
          : `KEEP — ${delivered.length} tracks`,
  };
}

const lines = [
  "# V15 Offline Before/After — Retrieval + Delivery Recovery",
  "",
  "Simulates V14 (strict 95+ thesis refuse) vs V15 (layered retrieval + thesis fallback + coverage tiers).",
  "Purity gates unchanged: 95/90/85/80.",
  "",
  "| Prompt | V14 | V15 | Opener V14 → V15 |",
  "|--------|-----|-----|------------------|",
];

for (const fixture of FIXTURES) {
  const world = resolveCommittedWorld({ prompt: fixture.prompt });
  const profile = getCulturalProfile(world.id);
  const tracks = mockTracks(fixture.pool);
  const v14 = simulateV14(tracks, world, profile, fixture.prompt);
  const v15 = simulateV15(tracks, world, profile, fixture.prompt);
  lines.push(
    `| ${fixture.id} | ${v14.verdict} | ${v15.verdict} | ${v14.opener} (${v14.openerPct}%) → ${v15.opener} |`,
  );
}

lines.push("", "## Track lists (V15)", "");

for (const fixture of FIXTURES) {
  const world = resolveCommittedWorld({ prompt: fixture.prompt });
  const profile = getCulturalProfile(world.id);
  const tracks = mockTracks(fixture.pool);
  const v15 = simulateV15(tracks, world, profile, fixture.prompt);
  const retrieval = retrieveWithRecovery({
    prompt: fixture.prompt,
    userLibrary: tracks,
    culturalProfile: profile,
    committedWorld: world,
  });
  lines.push(`### ${fixture.id}`);
  lines.push(`Retrieval pool (${retrieval.tracks.length}): ${retrieval.tracks.map((t) => t.artistName).join(", ")}`);
  lines.push(`Delivered (${v15.count}, tier ${v15.tier}):`);
  const deliveredTracks = enforceThesisOpener(
    applyWorldPurityGate(
      retrieval.tracks.slice(0, getDeliveryCap(v15.tier, 25) || retrieval.tracks.length),
      world,
      { prompt: fixture.prompt, requestedLength: 25, coverageLevel: v15.tier },
    ).tracks,
    profile,
  ).tracks;
  for (const [i, t] of deliveredTracks.entries()) {
    lines.push(`${i + 1}. ${t.artistName} — ${t.trackName}`);
  }
  lines.push("");
}

const outPath = "reports/playlist-evaluation/v15-offline-before-after-2026-07-28.md";
mkdirSync("reports/playlist-evaluation", { recursive: true });
writeFileSync(outPath, lines.join("\n"));
console.log(`Wrote ${outPath}`);
console.log(lines.slice(0, 12).join("\n"));
