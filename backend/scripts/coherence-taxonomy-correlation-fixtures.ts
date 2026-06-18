/**
 * Taxonomy correlation regression — ensures genres, moods, activities, places,
 * times, and eras map to the intended dimensions without cross-contamination.
 *
 * Usage: npm run coherence:taxonomy
 */

import { buildLockedIntent } from "../core/v3/intent";
import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import {
  EXPANDED_PLACE_TERMS,
  EXPANDED_TIME_TERMS,
  termRegex,
} from "../lib/expanded-intent-vocabulary";

type TimeOfDay = "morning" | "afternoon" | "evening" | "late_night";
type Place = "rural" | "outdoors" | "city" | "beach" | "bedroom" | "car";

function parseTimeOfDay(prompt: string): TimeOfDay[] {
  const lower = prompt.toLowerCase();
  if (/\bmourning\b/i.test(lower)) {
    return [
      termRegex(EXPANDED_TIME_TERMS.afternoon).test(lower) ? "afternoon" : null,
      termRegex(EXPANDED_TIME_TERMS.evening).test(lower) ? "evening" : null,
      termRegex(EXPANDED_TIME_TERMS.late_night).test(lower) ? "late_night" : null,
    ].filter((value): value is TimeOfDay => !!value);
  }
  return [
    termRegex(EXPANDED_TIME_TERMS.morning).test(lower) ? "morning" : null,
    termRegex(EXPANDED_TIME_TERMS.afternoon).test(lower) ? "afternoon" : null,
    termRegex(EXPANDED_TIME_TERMS.evening).test(lower) ? "evening" : null,
    termRegex(EXPANDED_TIME_TERMS.late_night).test(lower) ? "late_night" : null,
  ].filter((value): value is TimeOfDay => !!value);
}

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
    timeOfDay: TimeOfDay[];
    places: Place[];
  }) => { pass: boolean; detail: string };
};

const FIXTURES: Fixture[] = [
  {
    id: "mourning-not-morning",
    prompt: "mourning playlist after losing someone",
    check: ({ locked, timeOfDay }) => ({
      pass: !timeOfDay.includes("morning") && locked.mood.includes("melancholic"),
      detail: `time=${timeOfDay.join(",")} mood=${locked.mood.join(",")}`,
    }),
  },
  {
    id: "volvo-garage-not-electronic",
    prompt: "music for working on my volvo in the garage late at night",
    check: ({ locked, pipeline }) => ({
      pass:
        !locked.genreFamilies.includes("electronic") &&
        pipeline.sceneLockStatus.active &&
        pipeline.sceneLockStatus.anchors.some((a) => a === "garage_repair" || a === "garage_workshop") &&
        pipeline.sceneLockStatus.offSceneGenreFamilies.includes("electronic"),
      detail: `families=${locked.genreFamilies.join(",")} lock=${pipeline.sceneLockStatus.anchors.join(",")}`,
    }),
  },
  {
    id: "uk-garage-not-workshop",
    prompt: "late night uk garage chill ukg",
    check: ({ locked, pipeline }) => ({
      pass:
        locked.genreFamilies.includes("electronic") &&
        !pipeline.sceneLockStatus.anchors.includes("garage_workshop"),
      detail: `families=${locked.genreFamilies.join(",")} lock=${pipeline.sceneLockStatus.anchors.join(",")}`,
    }),
  },
  {
    id: "uk-grime-scene-lock",
    prompt: "uk grime classics workout",
    check: ({ pipeline }) => ({
      pass: pipeline.sceneLockStatus.active && pipeline.sceneLockStatus.anchors.some((a) => a.startsWith("uk_")),
      detail: `lock=${pipeline.sceneLockStatus.anchors.join(",")}`,
    }),
  },
  {
    id: "dream-pop-prefers-rock",
    prompt: "shoegaze dream pop rainy night",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("rock") && !locked.genreFamilies.includes("pop"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "hyperpop-prefers-electronic",
    prompt: "hyperpop night drive chaotic energy",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("electronic") && !locked.genreFamilies.includes("pop"),
      detail: `families=${locked.genreFamilies.join(",")}`,
    }),
  },
  {
    id: "modern-vibe-not-2020s-era",
    prompt: "modern chill vibes for cooking",
    check: ({ locked }) => ({
      pass: locked.eraRange == null,
      detail: `era=${locked.eraRange ? `${locked.eraRange.start}-${locked.eraRange.end}` : "none"}`,
    }),
  },
  {
    id: "90s-music-era-locks",
    prompt: "90s music throwback hits",
    check: ({ locked }) => ({
      pass: locked.eraRange?.start === 1990 && locked.eraRange?.end === 1999,
      detail: `era=${locked.eraRange ? `${locked.eraRange.start}-${locked.eraRange.end}` : "none"}`,
    }),
  },
  {
    id: "warehouse-rave-electronic-not-city",
    prompt: "warehouse rave techno hardgroove",
    check: ({ locked, places }) => ({
      pass: locked.genreFamilies.includes("electronic") && !places.includes("city"),
      detail: `families=${locked.genreFamilies.join(",")} places=${places.join(",")}`,
    }),
  },
  {
    id: "uk-drill-subgenre",
    prompt: "uk drill gym playlist",
    check: ({ locked }) => ({
      pass: locked.primarySubgenre === "uk_drill" || locked.subgenreTerms.includes("uk_drill"),
      detail: `primarySub=${locked.primarySubgenre ?? "none"} terms=${locked.subgenreTerms.join(",")}`,
    }),
  },
  {
    id: "rave-not-energised-mood-only",
    prompt: "warehouse rave techno",
    check: ({ locked }) => ({
      pass: locked.genreFamilies.includes("electronic") && !locked.mood.includes("energised"),
      detail: `mood=${locked.mood.join(",")} families=${locked.genreFamilies.join(",")}`,
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
    id: "grime-classics-not-us-hip-hop-only",
    prompt: "grime classics workout",
    check: ({ locked, pipeline }) => ({
      pass:
        locked.genreFamilies.includes("hip_hop") &&
        (locked.primarySubgenre === "grime" || locked.subgenreTerms.includes("grime")) &&
        pipeline.sceneLockStatus.anchors.includes("uk_grime"),
      detail: `sub=${locked.primarySubgenre ?? "none"} lock=${pipeline.sceneLockStatus.anchors.join(",")}`,
    }),
  },
];

function main(): void {
  const results = FIXTURES.map((fixture) => {
    const locked = buildLockedIntent(fixture.prompt);
    const pipeline = buildIntentPipelineContext(fixture.prompt, "balanced");
    const timeOfDay = parseTimeOfDay(fixture.prompt);
    const places = parsePlaces(fixture.prompt);
    const outcome = fixture.check({ locked, pipeline, timeOfDay, places });
    return {
      id: fixture.id,
      pass: outcome.pass,
      detail: outcome.detail,
    };
  });

  const failed = results.filter((row) => !row.pass);
  process.stdout.write(`${JSON.stringify({ pass: failed.length === 0, results }, null, 2)}\n`);
  if (failed.length > 0) process.exit(1);
}

main();
