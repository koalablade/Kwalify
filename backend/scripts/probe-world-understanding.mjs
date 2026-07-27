import { interpretWorld } from "../dist/lib/world-understanding/index.js";

const prompts = [
  "I took the long way home tonight because I wasn't ready to go back yet",
  "Couldn't sleep so I went for a drive",
  "Everyone left and the house went quiet",
  "Feeling like a kid again",
  "Rainy drive home after a difficult day",
  "I drove around because I wasn't ready to go home",
  "The house felt strange after everyone went home",
  "I walked around town until I felt better",
  "I kept the lights off and listened to music",
  "The last day of summer",
  "Empty motorway at midnight, rain on the windscreen",
];

for (const p of prompts) {
  const r = interpretWorld(p);
  console.log("---");
  console.log("PROMPT:", p);
  console.log("SCENE:", r.scene.label, `(${r.scene.id})`);
  console.log("ENV:", r.taxonomy.environment.join(", ") || "—");
  console.log("ACT:", r.taxonomy.activity.join(", ") || "—");
  console.log("EMO:", r.taxonomy.emotion.join(", ") || "—");
  console.log("LIFE:", r.taxonomy.lifeContext.join(", ") || "—");
  console.log("SENS:", r.taxonomy.sensory.join(", ") || "—");
  console.log("MUSIC:", r.musicBehaviour.preferredGenres.slice(0, 3).join(", "), "energy", r.musicBehaviour.energy);
  console.log("PHRASES:", r.matchedPhrases.map((x) => x.phrase).join(" | ") || "—");
  console.log("FUZZY:", r.fuzzyExpansions.map((x) => x.id).join(" | ") || "—");
}
