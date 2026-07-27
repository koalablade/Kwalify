import type { ComposedScene, MusicBehaviourModel, WorldConceptTaxonomy } from "./types";

export interface EmotionalSceneGraph {
  environment: string[];
  activity: string[];
  emotion: string[];
  lifeContext: string[];
  sensory: string[];
  social: string[];
  music: {
    tempoBpm: [number, number];
    energy: number;
    energyLabel: string;
    textures: string[];
    progression: string;
    preferredGenres: string[];
    avoidGenres: string[];
  };
}

function energyLabel(energy: number): string {
  if (energy <= 0.3) return "low";
  if (energy <= 0.55) return "low-medium";
  if (energy <= 0.75) return "medium";
  return "high";
}

export function buildEmotionalSceneGraph(
  taxonomy: WorldConceptTaxonomy,
  scene: ComposedScene,
  music: MusicBehaviourModel,
): EmotionalSceneGraph {
  const progression = `${music.sequence.beginning} → ${music.sequence.middle} → ${music.sequence.ending}`;
  return {
    environment: [...new Set([...scene.properties.environment, ...taxonomy.environment])].slice(0, 8),
    activity: taxonomy.activity.slice(0, 6),
    emotion: [...new Set([...scene.properties.emotion, ...taxonomy.emotion])].slice(0, 8),
    lifeContext: taxonomy.lifeContext.slice(0, 6),
    sensory: taxonomy.sensory.slice(0, 6),
    social: taxonomy.social.slice(0, 4),
    music: {
      tempoBpm: music.tempoBpm,
      energy: music.energy,
      energyLabel: energyLabel(music.energy),
      textures: music.textures,
      progression,
      preferredGenres: music.preferredGenres,
      avoidGenres: music.avoidGenres,
    },
  };
}
