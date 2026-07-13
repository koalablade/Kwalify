/**
 * Human Expectation Layer — shared types.
 *
 * These describe (a) the compositional interpretation of a human moment and
 * (b) the unified expectation contract derived from it. They intentionally do
 * NOT duplicate existing engine types (EmotionProfile, SceneLatentVector,
 * SceneIntent, JourneyArc); instead they are produced *from* them.
 */

import type { JourneyArc } from "../../lib/emotion-destination";

/**
 * The reusable reasoning dimensions of a human moment. New dimensions can be
 * added by extending the anchor registry — no new pipeline stage required.
 */
export type DimensionGroup =
  | "emotional"
  | "social"
  | "environment"
  | "activity"
  | "energyTrajectory"
  | "atmosphere"
  | "lyrical"
  | "production"
  | "era"
  | "discovery";

export const DIMENSION_GROUPS: DimensionGroup[] = [
  "emotional",
  "social",
  "environment",
  "activity",
  "energyTrajectory",
  "atmosphere",
  "lyrical",
  "production",
  "era",
  "discovery",
];

export interface DimensionScore {
  /** Anchor key, e.g. "nostalgia", "night", "driving", "acoustic". */
  key: string;
  group: DimensionGroup;
  /** Salience 0..1 (blend of embedding affinity + direct lexical hits). */
  weight: number;
  /**
   * True when the anchor was matched by a direct lexical hit (or an engine
   * seed), i.e. it is lexically grounded in the prompt. Embedding-only matches
   * are false; candidate labels are built only from grounded evidence to avoid
   * hallucinated descriptors.
   */
  grounded: boolean;
}

export interface MomentDimensions {
  /** Salience per anchor key, 0..1. */
  scores: Record<string, number>;
  /** Top-scoring anchors per group (descending), for readable composition. */
  byGroup: Record<DimensionGroup, DimensionScore[]>;
}

/**
 * One plausible lived experience for the prompt. Humans rarely mean exactly one
 * thing; interpretation preserves several ranked candidates with confidences.
 */
export interface SubIntent {
  label: string;
  confidence: number;
  characteristics: string[];
  dominantGroups: DimensionGroup[];
}

export interface MomentInterpretation {
  vibe: string;
  /** Ranked lived-experience candidates (confidences roughly sum to 1). */
  candidates: SubIntent[];
  dimensions: MomentDimensions;
  embedderVersion: string;
  /**
   * True when the prompt has low direct lexical coverage and interpretation
   * leaned on embedding generalisation (i.e. an unseen/novel phrasing).
   */
  novelPrompt: boolean;
  /** Salience of the strongest matched anchor (interpretation strength). */
  peakSalience: number;
}

export type Band = [number, number];

export interface SonicBands {
  /** All bands normalised 0..1. `tempo` is a normalised proxy, not raw BPM. */
  energy: Band;
  valence: Band;
  tempo: Band;
  acoustic: Band;
  instrumental: Band;
}

export type LyricalExpectation =
  | "instrumental"
  | "minimal"
  | "vocal_forward"
  | "storytelling"
  | "any";

export type DiscoveryExpectation = "comfort" | "mixed" | "exploration";

/**
 * A single per-moment contract that unifies what four legacy structures express
 * separately (SonicProfile, ScenePrototype.blueprint, MusicSemanticConstraints,
 * PlaylistArchetype). Genre is expressed as musical *function*, never as a
 * primary label — genres remain a consequence of the moment.
 */
export interface ExpectationContract {
  atmosphere: string[];
  avoid: string[];
  sonicBands: SonicBands;
  genreFunction: { fits: string[]; failures: string[] };
  arc: JourneyArc;
  era: { label: string; strictness: number } | null;
  lyrical: LyricalExpectation;
  discovery: DiscoveryExpectation;
  source: "derived";
  /** Confidence of the winning interpretation this contract was derived from. */
  interpretationConfidence: number;
}

/**
 * Minimal, decoupled track shape the expectation engine reasons over. The
 * generation pipeline adapts its richer track objects into this at call sites,
 * so the engine never depends on controller/pipeline internals.
 */
export interface ExpectationTrack {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  releaseYear?: number | null;
  energy?: number | null;
  valence?: number | null;
  /** Raw BPM (normalised internally against a 60–200 range). */
  tempo?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
  danceability?: number | null;
  speechiness?: number | null;
  genreFamily?: string | null;
  genres?: string[] | null;
}

export interface TrackAdmissibility {
  /** 0..1 fit against the contract (bands + function). */
  score: number;
  /** False when the track inverts the moment (opposite side of a band, or a hard avoid). */
  admissible: boolean;
  /** Human-readable reasons a track is off-vibe (empty when clean). */
  violations: string[];
  /** Severity of the worst violation (drives repair priority). */
  severity: "none" | "low" | "medium" | "high";
}

export type FailureMode =
  | "MOOD_INVERSION"
  | "WRONG_WORLD"
  | "GENRE_BETRAYAL"
  | "ENERGY_MISMATCH"
  | "ARTIST_FATIGUE"
  | "IDENTITY_COLLAPSE"
  | "CULTURAL_MISMATCH"
  | "SEASON_MISMATCH"
  | "OPENING_MISREPRESENTS"
  | "TOO_GENERIC"
  | "GOOD_SONGS_BAD_PLAYLIST";

export interface FailureFinding {
  mode: FailureMode;
  severity: "low" | "medium" | "high";
  detail: string;
  trackIds: string[];
}

export interface SectionCritique {
  fit: number;
  problem?: string;
}

export interface EditorialAnswer {
  pass: boolean;
  note: string;
}

export type EditorialQuestion =
  | "promptUnderstanding"
  | "emotionalTruth"
  | "immersion"
  | "coherence"
  | "artistBalance"
  | "discovery"
  | "trust";

export interface PlaylistCritiqueResult {
  /** 0..100 — becomes the honest confidence signal for the moment. */
  overallFit: number;
  verdict: "publish" | "repair" | "reject";
  /** Short label of the imagined world (from the winning interpretation). */
  world: string;
  opening: SectionCritique;
  middle: SectionCritique;
  ending: SectionCritique;
  strengths: string[];
  problems: string[];
  failureModes: FailureFinding[];
  recommendedChanges: string[];
  editorial: Record<EditorialQuestion, EditorialAnswer>;
}

export interface RepairResult {
  /** Ordered track ids after repair (survivors first, then backfill). */
  orderedIds: string[];
  removedIds: string[];
  addedIds: string[];
  /** Internal reasoning: why it failed and what repair did. */
  explanation: string[];
  iterations: number;
}
