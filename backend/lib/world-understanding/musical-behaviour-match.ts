import {
  getMusicalBehaviourDef,
  MUSICAL_BEHAVIOUR_DEFS,
  type MusicalBehaviourDef,
} from "./atlas-loader";
import type { HumanExperience, MusicBehaviourModel } from "./types";

export interface MusicalBehaviourMatch {
  behaviourId: string;
  label: string;
  score: number;
  matchedTextures: string[];
}

export function scoreMusicalBehaviourAlignment(
  experience: HumanExperience,
  trackTextures: string[] = [],
  trackEnergy?: number,
): MusicalBehaviourMatch[] {
  const requested = experience.musicalBehaviours;
  const matches: MusicalBehaviourMatch[] = [];

  for (const raw of requested) {
    const def = getMusicalBehaviourDef(raw);
    if (!def) continue;

    let score = 0.35;
    const matchedTextures: string[] = [];

    for (const texture of def.textures) {
      if (trackTextures.some((t) => t.toLowerCase().includes(texture.toLowerCase()))) {
        score += 0.12;
        matchedTextures.push(texture);
      }
    }

    if (trackEnergy != null) {
      const [min, max] = def.energyRange;
      if (trackEnergy >= min - 0.1 && trackEnergy <= max + 0.1) {
        score += 0.2;
      }
    }

    matches.push({
      behaviourId: def.id,
      label: def.label,
      score: Math.min(1, score),
      matchedTextures,
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}

export function applyMusicalBehavioursToModel(
  model: MusicBehaviourModel,
  experience: HumanExperience,
  weight = 0.22,
): MusicBehaviourModel {
  if (!experience.musicalBehaviours.length) return model;

  const w = Math.min(0.35, weight * experience.playlistIntentConfidence);
  const defs: MusicalBehaviourDef[] = [];

  for (const raw of experience.musicalBehaviours.slice(0, 4)) {
    const def = getMusicalBehaviourDef(raw);
    if (def) defs.push(def);
  }

  if (!defs.length) return model;

  const avgEnergy =
    defs.reduce((s, d) => s + (d.energyRange[0] + d.energyRange[1]) / 2, 0) / defs.length;
  const textures = [...new Set(defs.flatMap((d) => d.textures))].slice(0, 6);
  const lerp = (a: number, b: number) => a * (1 - w) + b * w;

  return {
    ...model,
    energy: lerp(model.energy, avgEnergy),
    textures: [...new Set([...textures, ...model.textures])].slice(0, 8),
  };
}

export function computeBehaviourBoost(
  experience: HumanExperience,
  trackTextures: string[] = [],
  trackEnergy?: number,
): number {
  const matches = scoreMusicalBehaviourAlignment(experience, trackTextures, trackEnergy);
  if (!matches.length) return 0;
  const top = matches[0]!.score;
  return Math.round(top * 0.15 * experience.playlistIntentConfidence * 100) / 100;
}

export function getMusicalBehaviourCatalog(): MusicalBehaviourDef[] {
  return MUSICAL_BEHAVIOUR_DEFS;
}
