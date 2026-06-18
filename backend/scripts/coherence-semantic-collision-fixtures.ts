/**
 * Semantic collision regression — P0 disambiguation fixtures.
 *
 * Usage: npm run coherence:semantic-collisions
 */

import { buildLockedIntent } from "../core/v3/intent";
import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import {
  EXPANDED_PLACE_TERMS,
  EXPANDED_TIME_TERMS,
  termRegex,
} from "../lib/expanded-intent-vocabulary";
import { evaluateHarvestedAlias } from "../lib/semantic-collision-guards";

type Place = "rural" | "outdoors" | "city" | "beach" | "bedroom" | "car";

function parsePlaces(prompt: string): Place[] {
  const lower = prompt.toLowerCase();
  return [
    termRegex(EXPANDED_PLACE_TERMS.rural).test(lower) ? "rural" : null,
    termRegex(EXPANDED_PLACE_TERMS.outdoors).test(lower) ? "outdoors" : null,
    termRegex(EXPANDED_PLACE_TERMS.city).test(lower) ? "city" : null,
    termRegex(EXPANDED_PLACE_TERMS.beach).test(lower) ? "beach" : null,
    termRegex(EXPANDED_PLACE_TERMS.bedroom).test(lower) ? "bedroom" : null,
    termRegex(EXPANDED_PLACE_TERMS.car).test(lower) ? "car" : null,
  ].filter((value): value is Place => !!value);
}

type Fixture = {
  id: string;
  prompt: string;
  check: (ctx: {
    locked: ReturnType<typeof buildLockedIntent>;
    pipeline: ReturnType<typeof buildIntentPipelineContext>;
    places: Place[];
  }) => { pass: boolean; detail: string };
};

const FIXTURES: Fixture[] = [
  // Prior P0 fixes (regression)
  {
    id: "mourning-not-morning",
    prompt: "mourning playlist after losing someone",
    check: ({ locked }) => ({
      pass: !termRegex(EXPANDED_TIME_TERMS.morning).test("mourning playlist after losing someone") &&
        locked.mood.includes("melancholic"),
      detail: `mood=${locked.mood.join(",")}`,
    }),
  },
  {
    id: "volvo-garage-workshop",
    prompt: "music for fixing a volvo in the garage late at night",
    check: ({ locked, pipeline }) => ({
      pass: !locked.genreFamilies.includes("electronic") &&
        pipeline.sceneLockStatus.anchors.some((a) => a.includes("garage")),
      detail: `families=${locked.genreFamilies.join(",")} lock=${pipeline.sceneLockStatus.anchors.join(",")}`,
    }),
  },
  {
    id: "uk-garage-not-workshop",
    prompt: "UK garage classics late night ukg",
    check: ({ locked, pipeline }) => ({
      pass: locked.genreFamilies.includes("electronic") &&
        !pipeline.sceneLockStatus.anchors.includes("garage_workshop"),
      detail: `families=${locked.genreFamilies.join(",")} lock=${pipeline.sceneLockStatus.anchors.join(",")}`,
    }),
  },
  {
    id: "dream-pop-rock-not-pop",
    prompt: "shoegaze dream pop rainy night",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("rock") && !locked.genreFamilies.includes("pop"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "hyperpop-electronic-not-pop",
    prompt: "hyperpop night drive chaotic energy",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("electronic") && !locked.genreFamilies.includes("pop"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "warehouse-rave-not-city",
    prompt: "warehouse rave techno hardgroove",
    check: ({ locked, places }) => ({
      pass: locked.genreFamilies.includes("electronic") && !places.includes("city"),
      detail: `families=${locked.genreFamilies.join(",")} places=${places.join(",")}`,
    }),
  },
  {
    id: "uk-drill-not-construction",
    prompt: "uk drill gym playlist",
    check: ({ locked }) => ({
      pass: locked.primarySubgenre === "uk_drill" || locked.subgenreTerms.includes("uk_drill"),
      detail: `sub=${locked.primarySubgenre ?? "none"}`,
    }),
  },
  // New collision batch
  {
    id: "moving-house-not-house-music",
    prompt: "moving house playlist boxes everywhere",
    check: ({ locked }) => ({
      pass: !locked.genreFamilies.includes("electronic"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "house-music-workout",
    prompt: "house music workout high energy",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("electronic"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "house-party-not-house-genre",
    prompt: "house party with friends pre drinks",
    check: ({ locked }) => ({
      pass: !locked.genreFamilies.includes("electronic") && locked.activity === "party",
      detail: `families=${locked.genreFamilies.join(",")} activity=${locked.activity ?? "none"}`,
    }),
  },
  {
    id: "country-roads-not-country-music",
    prompt: "country roads driving at sunset",
    check: ({ locked, places }) => ({
      pass: !locked.genreFamilies.includes("country") && places.includes("rural"),
      detail: `families=${locked.genreFamilies.join(",")} places=${places.join(",")}`,
    }),
  },
  {
    id: "country-music-driving",
    prompt: "country music driving playlist open road",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("country"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "feeling-blues-mood-not-genre",
    prompt: "feeling the blues after a hard week",
    check: ({ locked }) => ({
      pass: locked.mood.includes("melancholic") && !locked.genreFamilies.includes("blues"),
      detail: `mood=${locked.mood.join(",")} families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "blues-guitar-legends",
    prompt: "blues guitar legends playlist",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("blues"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "jungle-dnb-classics",
    prompt: "jungle DnB classics 90s",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("electronic"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "walking-through-jungle-nature",
    prompt: "walking through a jungle in the rain",
    check: ({ locked }) => ({
      pass: !locked.genreFamilies.includes("electronic"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "industrial-techno-warehouse",
    prompt: "industrial techno warehouse rave",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("electronic"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "industrial-work-not-techno",
    prompt: "playlist for industrial work in a factory",
    check: ({ locked }) => ({
      pass: !locked.genreFamilies.includes("electronic") && !locked.genreFamilies.includes("metal"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "fire-drill-not-uk-drill",
    prompt: "fire drill at school calming music",
    check: ({ locked }) => ({
      pass: locked.primarySubgenre !== "drill" && locked.primarySubgenre !== "uk_drill",
      detail: `sub=${locked.primarySubgenre ?? "none"} families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "trap-house-not-trap-genre",
    prompt: "life near a trap house sad playlist",
    check: ({ locked }) => ({
      pass: !locked.genreFamilies.includes("hip_hop"),
      detail: `families=${locked.genreFamilies.join(",")} mood=${locked.mood.join(",")}`,
    }),
  },
  {
    id: "tube-underground-not-underground-rap",
    prompt: "commute on the london underground rainy morning",
    check: ({ locked }) => ({
      pass: !locked.genreFamilies.includes("hip_hop"),
      detail: `families=${locked.genreFamilies.join(",")} activity=${locked.activity ?? "none"}`,
    }),
  },
  {
    id: "calm-ambient-atmosphere-not-genre",
    prompt: "calm ambient morning study vibes",
    check: ({ locked }) => ({
      pass: locked.mood.includes("calm") && !locked.genreFamilies.includes("electronic"),
      detail: `mood=${locked.mood.join(",")} families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "ambient-music-explicit-genre",
    prompt: "ambient music for deep focus coding",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("electronic"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "grime-classics-scene-lock",
    prompt: "grime classics workout",
    check: ({ locked, pipeline }) => ({
      pass: locked.genreFamilies.includes("hip_hop") &&
        pipeline.sceneLockStatus.anchors.includes("uk_grime"),
      detail: `lock=${pipeline.sceneLockStatus.anchors.join(",")}`,
    }),
  },
  {
    id: "winter-calm-not-warm",
    prompt: "quiet winter snowy evening calm",
    check: ({ locked }) => ({
      pass: locked.mood.includes("calm") && !locked.mood.includes("warm"),
      detail: `mood=${locked.mood.join(",")}`,
    }),
  },
  {
    id: "drill-workout-not-rap",
    prompt: "drill workout football training playlist",
    check: ({ locked }) => ({
      pass: !locked.genreFamilies.includes("hip_hop") && locked.primarySubgenre !== "drill",
      detail: `families=${locked.genreFamilies.join(",")} sub=${locked.primarySubgenre ?? "none"}`,
    }),
  },
  {
    id: "uk-drill-workout-keeps-rap",
    prompt: "uk drill workout gym playlist",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("hip_hop") && (locked.primarySubgenre === "uk_drill" || locked.subgenreTerms.includes("uk_drill")),
      detail: `families=${locked.genreFamilies.join(",")} sub=${locked.primarySubgenre ?? "none"}`,
    }),
  },
  {
    id: "progressive-overload-not-house",
    prompt: "progressive overload leg day gym playlist",
    check: ({ locked }) => ({
      pass: !locked.genreFamilies.includes("electronic") && locked.primarySubgenre !== "progressive_house",
      detail: `families=${locked.genreFamilies.join(",")} sub=${locked.primarySubgenre ?? "none"}`,
    }),
  },
  {
    id: "progressive-house-keeps-electronic",
    prompt: "progressive house sunset drive playlist",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("electronic"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
];

const ALIAS_REJECTION_FIXTURES: Array<{ id: string; term: string; expectRejected: boolean; reason?: string }> = [
  { id: "alias-reject-bare-garage", term: "garage", expectRejected: true, reason: "bare_collision" },
  { id: "alias-reject-bare-house", term: "house", expectRejected: true, reason: "bare_collision" },
  { id: "alias-reject-bare-drill", term: "drill", expectRejected: true, reason: "bare_collision" },
  { id: "alias-accept-uk-garage", term: "uk garage", expectRejected: false },
  { id: "alias-reject-fitness-drill", term: "drill workout", expectRejected: true, reason: "fitness_drill" },
];

function main(): void {
  const results = FIXTURES.map((fixture) => {
    const locked = buildLockedIntent(fixture.prompt);
    const pipeline = buildIntentPipelineContext(fixture.prompt, "balanced");
    const places = parsePlaces(fixture.prompt);
    const outcome = fixture.check({ locked, pipeline, places });
    return { id: fixture.id, pass: outcome.pass, detail: outcome.detail };
  });
  const aliasResults = ALIAS_REJECTION_FIXTURES.map((fixture) => {
    const outcome = evaluateHarvestedAlias(fixture.term);
    const pass = fixture.expectRejected
      ? outcome.rejected && (!fixture.reason || outcome.reason.startsWith(fixture.reason))
      : !outcome.rejected;
    return {
      id: fixture.id,
      pass,
      detail: outcome.rejected ? outcome.reason : "accepted",
    };
  });
  const allResults = [...results, ...aliasResults];
  const failed = allResults.filter((row) => !row.pass);
  process.stdout.write(`${JSON.stringify({ pass: failed.length === 0, total: allResults.length, failed: failed.length, results: allResults }, null, 2)}\n`);
  if (failed.length > 0) process.exit(1);
}

main();
