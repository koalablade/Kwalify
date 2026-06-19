/**
 * Scene knowledge accuracy benchmark — atmosphere tag survival across ordinary prompts.
 *
 * Usage: npm run benchmark:scene-knowledge
 */

import { buildPromptSceneProfile } from "../lib/scene-semantic-retrieval";
import { expandCulturalReferences } from "../lib/cultural-reference-expansion";
import { SCENE_KNOWLEDGE_ENTRIES } from "../lib/scene-knowledge";

type Case = {
  prompt: string;
  expectTags: string[];
  expectSceneId?: string;
};

const CASES: Case[] = [
  { prompt: "reading agatha christie books", expectTags: ["mystery", "detective"], expectSceneId: "cozy-mystery" },
  { prompt: "Tokyo at 3am", expectTags: ["tokyo", "urban", "nocturnal"], expectSceneId: "tokyo-night" },
  { prompt: "Driving through rural France", expectTags: ["france", "countryside"], expectSceneId: "france-atmosphere" },
  { prompt: "Fixing a Volvo in the garage at midnight", expectTags: ["garage", "volvo"], expectSceneId: "garage-midnight" },
  { prompt: "Victorian detective story", expectTags: ["victorian", "detective"], expectSceneId: "victorian-detective" },
  { prompt: "Last train home", expectTags: ["last-train", "commute"], expectSceneId: "last-train" },
  { prompt: "Berlin warehouse at sunrise", expectTags: ["berlin", "warehouse"], expectSceneId: "berlin-warehouse" },
  { prompt: "Small-town America in autumn", expectTags: ["americana", "autumn"], expectSceneId: "small-town-america" },
  { prompt: "Paris café in the rain", expectTags: ["paris", "rain"], expectSceneId: "paris-cafe" },
  { prompt: "Walking through London at midnight", expectTags: ["london", "midnight"], expectSceneId: "london-night" },
  { prompt: "Blade Runner night city", expectTags: ["cyberpunk", "neon"], expectSceneId: "cyberpunk-night" },
  { prompt: "Skyrim exploration vibes", expectTags: ["fantasy", "nordic"], expectSceneId: "epic-fantasy" },
  { prompt: "1980s synth nostalgia", expectTags: ["1980s", "synth"], expectSceneId: "eighties-retro" },
  { prompt: "moving house playlist", expectTags: ["moving", "transition"], expectSceneId: "life-transition" },
  { prompt: "late night coding session", expectTags: ["coding", "nocturnal"], expectSceneId: "night-shift" },
  { prompt: "rainy motorway drive", expectTags: ["rain", "motorway"], expectSceneId: "rainy-scene" },
  { prompt: "motorcycle ride at sunset", expectTags: ["motorbike", "sunset"], expectSceneId: "motorbike-open-road" },
  { prompt: "Lost in Translation hotel night", expectTags: ["tokyo", "isolation"], expectSceneId: "tokyo-night" },
  { prompt: "Red Dead Redemption frontier", expectTags: ["western", "frontier"], expectSceneId: "western-frontier" },
  { prompt: "breakup on a rainy night", expectTags: ["breakup", "rain"], expectSceneId: "heartbreak" },
];

const MIN_ACCURACY = 0.8;

function tagHit(tags: string[], expected: string): boolean {
  const lower = tags.map((t) => t.toLowerCase());
  return lower.some((t) => t.includes(expected) || expected.includes(t));
}

function main(): void {
  let hits = 0;
  let total = 0;
  const failures: Array<{ prompt: string; missing: string[] }> = [];

  for (const c of CASES) {
    const profile = buildPromptSceneProfile(c.prompt);
    const expansion = expandCulturalReferences(c.prompt);
    const allTags = [
      ...profile.culturalTags,
      ...profile.atmospheres,
      ...profile.themes,
      ...profile.sceneConcepts,
      ...expansion.atmospheres,
      ...expansion.culturalTags,
    ];
    const sceneOk = !c.expectSceneId || expansion.sceneId === c.expectSceneId;
    const tagHits = c.expectTags.filter((t) => tagHit(allTags, t));
    const tagOk = tagHits.length >= Math.min(2, c.expectTags.length);
    total += 2;
    if (sceneOk) hits += 1;
    else failures.push({ prompt: c.prompt, missing: [`scene:${c.expectSceneId}`] });
    if (tagOk) hits += 1;
    else failures.push({ prompt: c.prompt, missing: c.expectTags.filter((t) => !tagHit(allTags, t)) });
  }

  const accuracy = hits / total;
  console.log(JSON.stringify({
    kbEntries: SCENE_KNOWLEDGE_ENTRIES.length,
    cases: CASES.length,
    accuracy: Math.round(accuracy * 1000) / 10,
    targetPercent: MIN_ACCURACY * 100,
    pass: accuracy >= MIN_ACCURACY,
    failures: failures.slice(0, 12),
  }, null, 2));

  if (accuracy < MIN_ACCURACY) {
    console.error(`scene knowledge accuracy ${(accuracy * 100).toFixed(1)}% below ${MIN_ACCURACY * 100}% target`);
    process.exit(1);
  }
  console.log("scene knowledge accuracy benchmark passed");
}

main();
