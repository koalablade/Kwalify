/**
 * V14 world neighbour graph — culturally adjacent worlds for retrieval expansion only.
 * Neighbours supply anchor/deepCut lists; never bedroom indie for madchester, etc.
 */

/** Worlds that must never be used as neighbours for a given world. */
const NEIGHBOUR_EXCLUSIONS: Record<string, string[]> = {
  madchester_world: ["lofi_world", "focus_study_world", "chill_rainy_world", "bedroom_indie_world"],
  classic_rock_world: ["lofi_world", "chill_rainy_world", "focus_study_world"],
  rainy_motorway_world: ["lofi_world", "focus_study_world"],
  "80s_night_drive_world": ["lofi_world", "focus_study_world"],
  grunge_world: ["lofi_world", "pop_punk_world"],
  country_world: ["lofi_world", "britpop_world", "madchester_world"],
  disco_1970s_world: ["lofi_world", "goth_world"],
  gym_rock_world: ["lofi_world", "chill_rainy_world"],
};

const WORLD_NEIGHBOUR_GRAPH: Record<string, string[]> = {
  madchester_world: ["britpop_world"],
  britpop_world: ["madchester_world"],
  classic_rock_world: ["arena_rock_world", "dad_rock_world", "yacht_rock_world"],
  dad_rock_world: ["classic_rock_world", "arena_rock_world", "yacht_rock_world"],
  arena_rock_world: ["classic_rock_world", "dad_rock_world"],
  rainy_motorway_world: ["night_drive_world", "80s_night_drive_world", "evening_drive_world"],
  rainy_drive_world: ["rainy_motorway_world", "night_drive_world"],
  night_drive_world: ["rainy_motorway_world", "80s_night_drive_world"],
  "80s_night_drive_world": ["rainy_motorway_world", "night_drive_world", "goth_world"],
  grunge_world: ["angry_rock_world", "gym_rock_world"],
  gym_rock_world: ["heavy_gym_world", "angry_rock_world", "arena_rock_world"],
  gym_world: ["gym_rock_world", "heavy_gym_world"],
  heavy_gym_world: ["gym_rock_world", "angry_rock_world"],
  disco_1970s_world: ["disco_world", "feel_good_world", "party_prep_world"],
  disco_world: ["disco_1970s_world", "feel_good_world"],
  country_world: ["dad_rock_world", "yacht_rock_world"],
};

export function getNeighbourWorlds(worldId: string): string[] {
  const raw = WORLD_NEIGHBOUR_GRAPH[worldId] ?? [];
  const exclusions = new Set(NEIGHBOUR_EXCLUSIONS[worldId] ?? []);
  return raw.filter((id) => id !== worldId && !exclusions.has(id));
}

export function isNeighbourExcluded(primaryWorldId: string, candidateWorldId: string): boolean {
  const exclusions = NEIGHBOUR_EXCLUSIONS[primaryWorldId] ?? [];
  return exclusions.includes(candidateWorldId);
}

export function neighbourWorldIdsForExpansion(worldId: string): string[] {
  return getNeighbourWorlds(worldId);
}
