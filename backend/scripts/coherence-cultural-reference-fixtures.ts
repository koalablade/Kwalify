/**
 * CI gate for cultural reference expansion fixtures.
 *
 * Usage: npm run coherence:cultural-references
 */

import { buildIntentPipelineContext } from "../lib/intent-pipeline-orchestrator";
import { buildPromptSceneProfile } from "../lib/scene-semantic-retrieval";
import { expandCulturalReferences } from "../lib/cultural-reference-expansion";

type Fixture = {
  id: string;
  prompt: string;
  expectSceneId: string;
  minCulturalTags: string[];
  expectAliases: string[];
};

const FIXTURES: Fixture[] = [
  {
    id: "agatha-christie",
    prompt: "reading agatha christie books",
    expectSceneId: "cozy-mystery",
    minCulturalTags: ["mystery", "detective"],
    expectAliases: ["jazz", "classical"],
  },
  {
    id: "sherlock-holmes",
    prompt: "Reading Sherlock Holmes",
    expectSceneId: "victorian-detective",
    minCulturalTags: ["detective", "victorian"],
    expectAliases: ["classical", "jazz"],
  },
  {
    id: "murder-mystery",
    prompt: "Solving a murder mystery",
    expectSceneId: "cozy-mystery",
    minCulturalTags: ["mystery", "detective"],
    expectAliases: ["jazz", "classical"],
  },
  {
    id: "tokyo-midnight",
    prompt: "Tokyo after midnight",
    expectSceneId: "tokyo-night",
    minCulturalTags: ["tokyo", "urban"],
    expectAliases: ["electronic", "ambient"],
  },
  {
    id: "paris-rain",
    prompt: "Parisian café in the rain",
    expectSceneId: "paris-cafe",
    minCulturalTags: ["paris", "romantic"],
    expectAliases: ["jazz", "classical"],
  },
];

function main(): void {
  let failed = 0;
  for (const fixture of FIXTURES) {
    const expansion = expandCulturalReferences(fixture.prompt);
    const profile = buildPromptSceneProfile(fixture.prompt);
    const ctx = buildIntentPipelineContext(fixture.prompt, "balanced");
    const culturalHits = fixture.minCulturalTags.filter((tag) =>
      profile.culturalTags.some((t) => t.toLowerCase().includes(tag)),
    );
    const aliasHits = fixture.expectAliases.filter((alias) => ctx.sceneAliases.includes(alias));
    const pass =
      expansion.sceneId === fixture.expectSceneId &&
      culturalHits.length >= Math.min(2, fixture.minCulturalTags.length) &&
      aliasHits.length >= 1 &&
      profile.retrievalSignature.length > 0 &&
      ctx.decomposedIntent.culturalRefs.length > 0;
    if (!pass) failed += 1;
    console.log(JSON.stringify({
      id: fixture.id,
      pass,
      sceneId: expansion.sceneId,
      culturalTags: profile.culturalTags.slice(0, 8),
      aliases: ctx.sceneAliases.slice(0, 6),
    }));
  }

  if (failed > 0) {
    console.error(`coherence cultural references failed: ${failed}/${FIXTURES.length}`);
    process.exit(1);
  }
  console.log(`coherence cultural references passed (${FIXTURES.length} fixtures)`);
}

main();
