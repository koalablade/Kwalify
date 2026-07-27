import { SCENE_TEMPLATES } from "./knowledge";
import type { ComposedScene, WorldConceptTaxonomy } from "./types";

type SceneTemplate = (typeof SCENE_TEMPLATES)[number];

function scoreScene(
  template: SceneTemplate,
  taxonomy: WorldConceptTaxonomy,
  matchedConceptIds: Record<string, string[]>,
): number {
  let score = 0;

  const check = (category: keyof typeof template.requires, ids: string[]): void => {
    const required = template.requires[category as keyof typeof template.requires] ?? [];
    if (!required.length) return;
    const pool = matchedConceptIds[category] ?? [];
    const hits = required.filter((id) => pool.includes(id));
    if (hits.length > 0) score += hits.length * 18;
    if (hits.length === required.length) score += 12;
  };

  check("activity", matchedConceptIds.activity);
  check("time", matchedConceptIds.time);
  check("social", matchedConceptIds.social);
  check("emotion", matchedConceptIds.emotion);
  check("lifeContext", matchedConceptIds.lifeContext);
  check("weather", matchedConceptIds.weather);
  check("environment", matchedConceptIds.environment);

  const boost = template.boostWhen ?? {};
  for (const [category, ids] of Object.entries(boost)) {
    const pool =
      category === "weather"
        ? matchedConceptIds.weather
        : category === "time"
          ? matchedConceptIds.time
          : matchedConceptIds[category] ?? [];
    for (const id of ids) {
      if (pool.includes(id)) score += 10;
    }
  }

  // Label overlap with taxonomy strings
  for (const env of taxonomy.environment) {
    if ((template.properties.environment ?? []).some((p) => env.toLowerCase().includes(p))) score += 4;
  }
  for (const emo of taxonomy.emotion) {
    if (template.properties.emotion.some((p) => emo.toLowerCase().includes(p))) score += 5;
  }

  return score;
}

export function composeScene(
  taxonomy: WorldConceptTaxonomy,
  matchedConceptIds: Record<string, string[]>,
  sceneHint?: string,
): ComposedScene {
  let best: { template: SceneTemplate; score: number } | null = null;

  for (const template of SCENE_TEMPLATES) {
    const s = scoreScene(template, taxonomy, matchedConceptIds);
    const boosted = sceneHint === template.id ? s + 40 : s;
    if (!best || boosted > best.score) {
      best = { template, score: boosted };
    }
  }

  const template = best && best.score >= 12 ? best.template : null;
  const resolved =
    template ??
    SCENE_TEMPLATES.find((s) => s.id === "WEATHER_REFLECTION") ??
    SCENE_TEMPLATES[0];
  const score = best?.score ?? 0;

  const environment = [
    ...new Set([
      ...(resolved.properties.environment ?? []),
      ...taxonomy.environment.slice(0, 4),
    ]),
  ].slice(0, 6);

  const emotion = [
    ...new Set([
      ...resolved.properties.emotion,
      ...taxonomy.emotion.slice(0, 4),
    ]),
  ].slice(0, 6);

  return {
    id: resolved.id,
    label: resolved.label,
    humanSummary: resolved.humanSummary,
    score,
    properties: {
      environment,
      emotion,
      musicBehaviourId: resolved.properties.musicBehaviourId,
    },
  };
}
