import { interpretWorld } from "./index";
import { WORLD_EVAL_CASES } from "./evaluation-prompts";

export type FailureGroup =
  | "wrong_scene"
  | "missing_context"
  | "abstract_meaning"
  | "conflicting_concepts"
  | "emotion_miss";

export interface FailedPrompt {
  id: string;
  prompt: string;
  category: string;
  expectedScene: string;
  actualScene: string;
  expectedEmotions: string[];
  actualEmotions: string[];
  group: FailureGroup;
  topCandidates: Array<{ id: string; label: string; score: number }>;
}

function classifyFailure(
  sceneOk: boolean,
  emotionOk: boolean,
  prompt: string,
  category: string,
): FailureGroup {
  if (!sceneOk && !emotionOk) {
    if (/main character|feels like|abstract|peaceful loneliness|feeling alive/i.test(prompt)) {
      return "abstract_meaning";
    }
    if (category === "Abstract feelings" || category === "Music language") return "abstract_meaning";
    return "conflicting_concepts";
  }
  if (!sceneOk) return "wrong_scene";
  if (!emotionOk) return "emotion_miss";
  if (prompt.split(" ").length <= 3) return "missing_context";
  return "missing_context";
}

export function analyzeFailedPrompts(limit = 100): {
  failures: FailedPrompt[];
  grouped: Record<FailureGroup, number>;
} {
  const failures: FailedPrompt[] = [];
  const grouped: Record<FailureGroup, number> = {
    wrong_scene: 0,
    missing_context: 0,
    abstract_meaning: 0,
    conflicting_concepts: 0,
    emotion_miss: 0,
  };

  for (const evalCase of WORLD_EVAL_CASES) {
    const result = interpretWorld(evalCase.prompt);
    const sceneOk =
      result.scene.id === evalCase.expectedScene ||
      (evalCase.acceptableScenes?.includes(result.scene.id) ?? false);
    const emotionOk = evalCase.expectedEmotions.some((expected) =>
      result.taxonomy.emotion.some((actual) => actual.toLowerCase().includes(expected.toLowerCase())),
    );
    const momentOk = sceneOk && emotionOk && result.confidence >= 0.35;

    if (momentOk) continue;

    const group = classifyFailure(sceneOk, emotionOk, evalCase.prompt, evalCase.category);
    grouped[group] += 1;
    if (failures.length < limit) {
      failures.push({
        id: evalCase.id,
        prompt: evalCase.prompt,
        category: evalCase.category,
        expectedScene: evalCase.expectedScene,
        actualScene: result.scene.id,
        expectedEmotions: evalCase.expectedEmotions,
        actualEmotions: result.taxonomy.emotion,
        group,
        topCandidates: (result.debug.sceneCandidates ?? []).map((c) => ({
          id: c.id,
          label: c.label,
          score: c.score,
        })),
      });
    }
  }

  return { failures, grouped };
}
