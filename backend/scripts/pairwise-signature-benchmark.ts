/**
 * Pairwise prompt signature comparison — detect prompt collapse.
 *
 * Usage: npm run benchmark:pairwise-signatures
 */

import { buildDominantIntentContract } from "../core/dominant-intent-contract";
import { buildPromptSceneProfile } from "../lib/scene-semantic-retrieval";

const DISTINCT_PROMPTS = [
  "Tokyo at 3am after missing the last train",
  "Rain on the motorway driving home",
  "Fixing my Volvo in the garage at midnight",
  "Warehouse rave at sunrise",
  "90s boom bap studying",
  "UK drill road trip",
  "Chill Sunday morning coffee",
  "Industrial techno warehouse bunker",
];

function signaturesForPrompt(prompt: string): {
  promptSignature: string;
  retrievalSignature: string;
  finalSignature: string;
} {
  const scene = buildPromptSceneProfile(prompt);
  const contract = buildDominantIntentContract({
    prompt,
    intentContract: {
      primarySubgenre: null,
      genreFamilies: [],
      activity: null,
      places: [],
      eraRange: null,
      explicitDimensions: [],
    },
    mode: "balanced",
    noLibraryMode: false,
  });
  return {
    promptSignature: scene.retrievalSignature,
    retrievalSignature: contract.retrievalSignature || contract.intentSignature,
    finalSignature: `${scene.retrievalSignature}|${contract.intentSignature}`,
  };
}

function main(): void {
  const rows = DISTINCT_PROMPTS.map((prompt) => ({
    prompt,
    ...signaturesForPrompt(prompt),
  }));

  let collisions = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      const sameFinal = a.finalSignature === b.finalSignature;
      const samePrompt = a.promptSignature === b.promptSignature;
      if (sameFinal || (samePrompt && a.promptSignature.length > 0)) {
        collisions += 1;
        console.log(JSON.stringify({ collision: true, a: a.prompt, b: b.prompt, sameFinal, samePrompt }));
      }
    }
  }

  const uniqueFinal = new Set(rows.map((r) => r.finalSignature)).size;
  console.log(JSON.stringify({ prompts: rows.length, uniqueFinal, collisions, ok: collisions === 0 && uniqueFinal === rows.length }));
  if (collisions > 0 || uniqueFinal < rows.length) process.exit(1);
  console.log("pairwise signature benchmark passed");
}

main();
