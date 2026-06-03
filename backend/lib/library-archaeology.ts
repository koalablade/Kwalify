/**
 * Library Archaeology — excavate forgotten relationship with music from vibe text.
 */

import type { RediscoveryMode } from "./forgotten-favourites";

export type ArchaeologyConcept =
  | "forgotten_loved"
  | "lost_summer"
  | "played_to_death"
  | "midnight_favourites"
  | "hidden_corners"
  | "general_excavation";

export interface ArchaeologyIntent {
  active: boolean;
  concept: ArchaeologyConcept;
  rediscoveryMode: RediscoveryMode;
  label: string;
}

const CONCEPTS: { concept: ArchaeologyConcept; re: RegExp; label: string; mode: RediscoveryMode }[] = [
  {
    concept: "forgotten_loved",
    re: /music you forgot you loved|forgot you loved|completely forgot this song/i,
    label: "Music You Forgot You Loved",
    mode: "forgotten_favourites",
  },
  {
    concept: "lost_summer",
    re: /lost summer soundtrack|forgotten summer|your lost summer/i,
    label: "Your Lost Summer Soundtrack",
    mode: "nostalgic_rediscovery",
  },
  {
    concept: "played_to_death",
    re: /played to death|then abandoned|old obsession/i,
    label: "Played To Death Then Abandoned",
    mode: "old_obsessions",
  },
  {
    concept: "midnight_favourites",
    re: /forgotten midnight|midnight favourites/i,
    label: "Forgotten Midnight Favourites",
    mode: "deep_cuts",
  },
  {
    concept: "hidden_corners",
    re: /hidden corners of your library|hidden corners|excavate my library|library archaeology/i,
    label: "Hidden Corners Of Your Library",
    mode: "hidden_gems",
  },
  {
    concept: "general_excavation",
    re: /archaeology|excavat|rediscover my library|dig through my likes/i,
    label: "Library Archaeology",
    mode: "forgotten_favourites",
  },
];

export function detectArchaeologyIntent(vibe: string): ArchaeologyIntent | null {
  for (const c of CONCEPTS) {
    if (c.re.test(vibe)) {
      return {
        active: true,
        concept: c.concept,
        rediscoveryMode: c.mode,
        label: c.label,
      };
    }
  }
  return null;
}

/** Extra rediscovery weight when archaeology framing is explicit. */
export function archaeologyRediscoveryBoost(concept: ArchaeologyConcept): number {
  switch (concept) {
    case "forgotten_loved":
      return 0.06;
    case "lost_summer":
      return 0.05;
    case "played_to_death":
      return 0.07;
    case "midnight_favourites":
      return 0.05;
    case "hidden_corners":
      return 0.08;
    default:
      return 0.05;
  }
}
