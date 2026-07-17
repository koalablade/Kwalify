/**
 * Reusable human-scene concepts — situations, not keywords.
 * Interpreters resolve text against these concepts; musical behaviour follows.
 */

export type ScenePhase =
  | "build_up"
  | "peak"
  | "aftermath"
  | "recovery"
  | "reflection"
  | "steady";

export type SocialContext =
  | "alone"
  | "partner"
  | "friends"
  | "family"
  | "party"
  | "crowd"
  | "public";

export type TimeContext =
  | "morning"
  | "afternoon"
  | "evening"
  | "late_night"
  | "dawn"
  | "any";

/** Expected musical behaviour — soft guidance, not genre locks. */
export type MusicalBehaviour =
  | "high_drive"
  | "peak_dance"
  | "soft_electronic"
  | "warm_acoustic"
  | "reflective_indie"
  | "melancholic_ballad"
  | "steady_focus"
  | "gentle_ambient"
  | "nostalgic_warm"
  | "tense_hold"
  | "celebratory"
  | "intimate"
  | "healing"
  | "motion_pulse";

export interface HumanSceneConcept {
  id: string;
  /** Human label for diagnostics. */
  label: string;
  /** Conceptual family (life event, place, emotion, activity, …). */
  family: string;
  /** Emotional direction the moment wants. */
  emotionalDirection: string;
  expectedEnergy: "low" | "medium" | "high";
  /** Continuous targets (0–1) when this scene dominates. */
  energy: number;
  valence: number;
  tension: number;
  intimacy: number;
  optimism: number;
  socialContext: SocialContext;
  timeContext: TimeContext;
  phase: ScenePhase;
  musicalBehaviour: MusicalBehaviour;
  /** Soft cues that activate this concept (phrases preferred over tokens). */
  cues: string[];
  /** Regex cues for compositional matching (optional). */
  cuePatterns?: RegExp[];
}

export interface SceneRelation {
  from: string;
  to: string;
  /** Why this transition exists in human life. */
  reason: string;
}

/** Ambiguous lexical forms resolved by surrounding context. */
export interface SenseDisambiguation {
  surface: string;
  senses: Array<{
    id: string;
    /** Prefer this sense when any of these cues are present. */
    when: RegExp[];
    /** Reject this sense when any of these cues are present. */
    unless?: RegExp[];
    /** Linked scene concept id when this sense wins. */
    sceneId?: string;
    /** Side effects on interpretation. */
    effects?: {
      suppressChristmas?: boolean;
      forceEnergy?: "low" | "medium" | "high";
      demotePartyActivity?: boolean;
      preferMusicalBehaviour?: MusicalBehaviour;
    };
  }>;
}

export interface HumanSceneReading {
  /** Best matching concept, if any. */
  primary: HumanSceneConcept | null;
  /** Related active concepts (lower weight). */
  secondary: HumanSceneConcept[];
  /** Winning sense ids from disambiguation (e.g. holiday.vacation). */
  senses: string[];
  phase: ScenePhase | null;
  energy: "low" | "medium" | "high" | null;
  suppressChristmas: boolean;
  demotePartyActivity: boolean;
  musicalBehaviour: MusicalBehaviour | null;
  confidence: number;
  matchedCues: string[];
}
