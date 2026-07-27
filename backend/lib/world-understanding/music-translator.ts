import { MUSIC_BEHAVIOURS } from "./knowledge";
import type { ComposedScene, MusicBehaviourModel, PhraseMatch } from "./types";

type BehaviourEntry = (typeof MUSIC_BEHAVIOURS)[keyof typeof MUSIC_BEHAVIOURS];

function behaviourToModel(id: string, entry: BehaviourEntry): MusicBehaviourModel {
  return {
    id,
    energy: entry.energy,
    tempoBpm: entry.tempoBpm as [number, number],
    preferredGenres: entry.preferredGenres,
    avoidGenres: entry.avoidGenres,
    textures: entry.textures,
    arrangement: entry.arrangement,
    sequence: entry.sequence,
  };
}

export function translateMusicBehaviour(
  scene: ComposedScene,
  phraseMatches: PhraseMatch[],
): MusicBehaviourModel {
  const behaviourId = scene.properties.musicBehaviourId;
  const base =
    MUSIC_BEHAVIOURS[behaviourId as keyof typeof MUSIC_BEHAVIOURS] ??
    MUSIC_BEHAVIOURS.default_reflective;

  let model = behaviourToModel(behaviourId, base);

  // Phrase-level music overrides (longest phrase wins for energy)
  const withMusic = phraseMatches.filter((p) => p.music);
  if (withMusic.length > 0) {
    const top = withMusic[0];
    if (top.music?.energy != null) {
      model = { ...model, energy: top.music.energy };
    }
    if (top.music?.tempoBpm) {
      model = { ...model, tempoBpm: top.music.tempoBpm };
    }
    if (top.music?.genres?.length) {
      model = {
        ...model,
        preferredGenres: [...new Set([...top.music.genres, ...model.preferredGenres])].slice(0, 8),
      };
    }
    if (top.music?.textures?.length) {
      model = {
        ...model,
        textures: [...new Set([...top.music.textures, ...model.textures])].slice(0, 6),
      };
    }
  }

  return model;
}
