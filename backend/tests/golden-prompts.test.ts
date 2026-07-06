import { analyzeMomentPipeline } from "../lib/moment-pipeline";
import { scorePromptConfidence } from "../lib/prompt-confidence";
import { detectMixedEmotions } from "../lib/multi-emotion";
import { parseEmotionalDestination } from "../lib/emotion-destination";
import { GOLDEN_PROMPT_CASES } from "./golden-prompts.data";

export function runGoldenPromptTests(): { passed: number; failed: number; failures: string[] } {
  const failures: string[] = [];
  let passed = 0;

  for (const testCase of GOLDEN_PROMPT_CASES) {
    const moment = analyzeMomentPipeline(testCase.prompt);
    const mixed = detectMixedEmotions(testCase.prompt);
    const dest = parseEmotionalDestination(testCase.prompt);
    const confidence = scorePromptConfidence(testCase.prompt, moment.profile, {
      experienceSceneMatched: !!moment.experienceScene,
      hasJourneyDestination: !!dest.desired,
      mixedEmotions: mixed,
    });

    const sceneId = moment.canonicalScene?.sceneId;
    const energy = moment.profile.energy;

    if (testCase.expectedSceneId && sceneId !== testCase.expectedSceneId) {
      failures.push(
        `[scene] "${testCase.prompt}" expected ${testCase.expectedSceneId}, got ${sceneId ?? "null"}`
      );
      continue;
    }

    if (testCase.expectedTier && confidence.tier !== testCase.expectedTier) {
      failures.push(
        `[tier] "${testCase.prompt}" expected ${testCase.expectedTier}, got ${confidence.tier}`
      );
      continue;
    }

    if (testCase.energyMin != null && energy < testCase.energyMin) {
      failures.push(`[energy] "${testCase.prompt}" energy ${energy} < min ${testCase.energyMin}`);
      continue;
    }

    if (testCase.energyMax != null && energy > testCase.energyMax) {
      failures.push(`[energy] "${testCase.prompt}" energy ${energy} > max ${testCase.energyMax}`);
      continue;
    }

    passed++;
  }

  return { passed, failed: failures.length, failures };
}

if (require.main === module) {
  const result = runGoldenPromptTests();
  for (const line of result.failures) console.error(line);
  console.log(`Golden prompts: ${result.passed} passed, ${result.failed} failed`);
  process.exit(result.failed > 0 ? 1 : 0);
}
