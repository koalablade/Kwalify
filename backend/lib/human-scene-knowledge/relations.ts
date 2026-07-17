import type { SceneRelation } from "./types";

/**
 * Reusable life transitions — not playlist arcs.
 * Interpreters can walk these to prefer aftermath/recovery over peak when cues point there.
 */
export const SCENE_RELATIONS: SceneRelation[] = [
  // Festival / rave timeline
  { from: "festival", to: "after_party", reason: "the field empties into smaller rooms" },
  { from: "festival", to: "rave_comedown", reason: "peak music night drains into morning" },
  { from: "rave", to: "after_party", reason: "club closes; kitchen continues" },
  { from: "rave", to: "rave_comedown", reason: "ecstatic peak → depleted quiet" },
  { from: "after_party", to: "rave_comedown", reason: "talk fades into empty tiredness" },
  { from: "rave_comedown", to: "late_night_bus", reason: "going home half-awake" },
  { from: "rave_comedown", to: "recovery", reason: "body and mind need softness" },
  { from: "late_night_bus", to: "returning_home", reason: "threshold back to ordinary life" },
  { from: "returning_home", to: "reflection", reason: "the night settles into thought" },

  // Holiday / vacation timeline
  { from: "holiday_vacation", to: "airport", reason: "leaving / returning travel nodes" },
  { from: "holiday_vacation", to: "after_holiday", reason: "vacation ends; ordinary life resumes" },
  { from: "airport", to: "returning_home", reason: "landing into familiar streets" },
  { from: "after_holiday", to: "returning_home", reason: "bags down, house quiet" },
  { from: "after_holiday", to: "reflection", reason: "memory of elsewhere vs now" },
  { from: "moving_house", to: "first_apartment", reason: "unpacking into independence" },
  { from: "leaving_home", to: "first_apartment", reason: "threshold into own space" },

  // Hospital / waiting
  { from: "hospital", to: "waiting_room", reason: "time stretches before answers" },
  { from: "waiting_room", to: "relief_after_results", reason: "suspense breaks either way — often soft release" },
  { from: "waiting_room", to: "grief", reason: "sometimes the answer is loss" },
  { from: "relief_after_results", to: "healing", reason: "nervous system uncoils" },

  // Work arcs
  { from: "interview", to: "failed_interview", reason: "rejection lands as deflation" },
  { from: "interview", to: "new_job", reason: "acceptance opens a chapter" },
  { from: "failed_interview", to: "walking", reason: "body carries the news home" },
  { from: "failed_interview", to: "reflection", reason: "private processing" },
  { from: "lost_job", to: "reflection", reason: "identity wobble" },
  { from: "lost_job", to: "healing", reason: "rebuilding takes time" },
  { from: "new_job", to: "monday_morning", reason: "routine begins" },
  { from: "promotion", to: "quiet_confidence", reason: "earned steadiness" },
  { from: "burnout", to: "healing", reason: "depletion needs recovery, not hype" },
  { from: "burnout", to: "recovery", reason: "rest before ambition" },

  // Relationship arcs
  { from: "new_relationship", to: "long_distance", reason: "distance can follow early attachment" },
  { from: "long_distance", to: "missing_someone", reason: "absence becomes texture" },
  { from: "breakup", to: "loneliness", reason: "shared life → empty evenings" },
  { from: "breakup", to: "healing", reason: "slow repair" },
  { from: "divorce", to: "fresh_start", reason: "ending enables rebuild" },
  { from: "missing_someone", to: "reflection", reason: "yearning turns inward" },
  { from: "old_friendship", to: "nostalgia", reason: "shared past surfaces" },

  // Life milestones
  { from: "graduation", to: "leaving_school", reason: "ceremony ends a chapter" },
  { from: "leaving_school", to: "fresh_start", reason: "unknown next" },
  { from: "leaving_university", to: "fresh_start", reason: "adult life begins" },
  { from: "birth", to: "quiet_confidence", reason: "identity expands quietly" },
  { from: "funeral", to: "grief", reason: "ritual into mourning" },
  { from: "grief", to: "acceptance", reason: "time softens edges" },
  { from: "grief", to: "healing", reason: "living alongside loss" },

  // Exercise arc
  { from: "gym_peak", to: "gym_cooldown", reason: "effort → cool-down" },
  { from: "gym_cooldown", to: "recovery", reason: "body needs soft music" },
  { from: "competition", to: "gym_cooldown", reason: "adrenaline drains" },

  // Time textures
  { from: "summer_evening", to: "sunday_evening", reason: "warmth can tilt melancholy" },
  { from: "sunday_evening", to: "monday_morning", reason: "week ahead presses in" },
  { from: "night_shift", to: "late_night_petrol", reason: "altered-hour liminal stops" },

  // Focus
  { from: "writers_block", to: "creative_flow", reason: "stuckness ↔ flow" },
  { from: "quiet_revision", to: "creative_flow", reason: "quiet work can open flow" },
  { from: "hope", to: "fresh_start", reason: "hope fuels beginning" },
  { from: "acceptance", to: "healing", reason: "settling enables repair" },
  { from: "personal_growth", to: "quiet_confidence", reason: "growth settles into self" },
];

/** Virtual recovery node referenced by transitions (concept may also be healing). */
export const RELATION_ALIASES: Record<string, string> = {
  recovery: "healing",
  nostalgia: "reflection",
  leaving_university: "leaving_school",
};
