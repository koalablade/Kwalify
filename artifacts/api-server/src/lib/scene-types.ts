import type { JourneyArc } from "./emotion-destination";

/** A human *experience* — not a genre. Same place can have many scenes (e.g. petrol 2am vs 10am). */
export interface SceneEntry {
  id: string;
  /** Substrings that activate this scene (longer phrases should be listed). */
  terms: string[];
  time?: string;
  environment?: string;
  motion?: string;
  /** Target emotional profile (0–1). */
  energy: number;
  valence: number;
  tension: number;
  nostalgia: number;
  calm: number;
  journeyArc?: JourneyArc;
  /** Tags for docs / future UI — introspection, liminality, decompression, etc. */
  qualities?: string[];
  lifeSituation?: string;
  socialContext?: "alone" | "partner" | "friends" | "family" | "party" | "crowd";
  season?: "spring" | "summer" | "autumn" | "winter";
  memoryWeight?: number;
}

export interface SceneMatch {
  scene: SceneEntry;
  matchedTerm: string;
  score: number;
}
