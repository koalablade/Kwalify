/**
 * Opening five evaluation — first-impression quality (heavily weighted in regression gate).
 */

import { humanPlausibilityScore } from "../../core/editorial/human-playlist-patterns";
import { evaluateWouldISave } from "../../core/editorial/would-i-save-evaluator";
import type { PatternScoringTrack } from "../../core/editorial/human-playlist-patterns";
import type { LockedIntent } from "../../core/v3/intent";
import { resolveActivityProfile } from "../../lib/activity-profiles";
import type { OpeningFiveEvaluation } from "./types";

const LOCKED_INTENT_STUB: LockedIntent = {
  genreFamilies: [],
  primaryGenre: null,
  primarySubgenre: null,
  secondarySubgenre: null,
  subgenreTerms: [],
  eraRange: null,
  mood: [],
  activity: null,
  energy: null,
};

const OPENING_WEIGHTS = {
  identityImmediate: 0.3,
  continueListening: 0.3,
  firstTrackAppropriate: 0.25,
  sceneEstablished: 0.15,
};

const FOCUS_VETO_RE = /\b(?:ukg|uk\s*garage|grime|conducta|techno|artful\s*dodger|oliver\s*heldens|tchami|scooter)\b/i;
const PARTY_MAINSTREAM_RE = /\b(?:usher|daft\s*punk|mark\s*ronson|dj\s*snake|black\s*eyed\s*peas|uptown\s*funk|get\s*lucky|yeah!)\b/i;
const GYM_DRIVE_RE = /\b(?:eminem|kanye|guetta|macklemore|survivor|stronger|lose\s*yourself|titanium|can't\s*hold\s*us|eye\s*of\s*the\s*tiger)\b/i;
const GYM_SLOW_RE = /\b(?:led\s*zeppelin|fleetwood\s*mac|black\s*sabbath|cool\s*cat|planet\s*caravan|blondie|queen|bon\s*iver|holocene)\b/i;

function meanEnergy(tracks: PatternScoringTrack[]): number {
  const vals = tracks.map((t) => t.energy).filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.5;
}

function activityOpeningHeuristics(
  prompt: string,
  opening5: PatternScoringTrack[],
): { pass: boolean; issues: string[] } {
  const text = opening5.map((t) => `${t.artistName ?? ""} ${t.trackId ?? ""}`).join(" ").toLowerCase();
  const issues: string[] = [];
  const profile = resolveActivityProfile(prompt, {});

  if (profile?.id === "focus_coding" || profile?.id === "study") {
    if (FOCUS_VETO_RE.test(text)) issues.push("focus_veto_hit");
    const e = opening5[0]?.energy ?? 0.5;
    if (e > 0.55) issues.push("focus_opener_too_energetic");
  }
  if (profile?.id === "party_pregame") {
    if (!PARTY_MAINSTREAM_RE.test(text)) issues.push("party_missing_mainstream");
    const e = meanEnergy(opening5.slice(0, 3));
    if (e < 0.62) issues.push("party_opener_low_energy");
  }
  if (profile?.id === "gym") {
    if (GYM_SLOW_RE.test(text)) issues.push("gym_slow_opener");
    if (!GYM_DRIVE_RE.test(text)) issues.push("gym_missing_drive_track");
    const e = opening5[0]?.energy ?? 0.5;
    if (e < 0.55) issues.push("gym_opener_low_energy");
  }

  return { pass: issues.length === 0, issues };
}

export function evaluateOpeningFive(opts: {
  prompt: string;
  tracks: PatternScoringTrack[];
}): OpeningFiveEvaluation | null {
  if (opts.tracks.length < 5) return null;

  const opening5 = opts.tracks.slice(0, 5);
  const opener = opening5[0]!;
  const openerText = `${opener.artistName ?? "?"} — ${opener.trackId ?? "?"}`;

  const openingPlausibility = humanPlausibilityScore(opening5);
  const fullPlausibility = humanPlausibilityScore(opts.tracks);
  const identityImmediate = Math.max(0, Math.min(1, openingPlausibility * 1.05 - fullPlausibility * 0.15));

  const wouldSaveOpening = evaluateWouldISave({
    prompt: opts.prompt,
    tracks: opening5,
    context: null,
    lockedIntent: LOCKED_INTENT_STUB,
  });
  const continueListening = wouldSaveOpening.combinedScore;

  const activity = activityOpeningHeuristics(opts.prompt, opening5);
  const firstTrackAppropriate = activity.pass ? 0.85 : Math.max(0.15, 0.55 - activity.issues.length * 0.15);

  const energies = opening5.map((t) => t.energy ?? 0.5);
  const spread = Math.max(...energies) - Math.min(...energies);
  const sceneEstablished = Math.max(0, Math.min(1, openingPlausibility * 0.7 + Math.min(0.3, spread * 0.8)));

  const weightedScore =
    identityImmediate * OPENING_WEIGHTS.identityImmediate +
    continueListening * OPENING_WEIGHTS.continueListening +
    firstTrackAppropriate * OPENING_WEIGHTS.firstTrackAppropriate +
    sceneEstablished * OPENING_WEIGHTS.sceneEstablished;

  const issues = [...activity.issues];
  if (identityImmediate < 0.45) issues.push("weak_opening_identity");
  if (continueListening < 0.5) issues.push("low_continue_listening");

  return {
    score: Math.round(weightedScore * 100),
    pass: weightedScore >= 0.55 && activity.pass,
    identityImmediate: Math.round(identityImmediate * 100) / 100,
    continueListening: Math.round(continueListening * 100) / 100,
    firstTrackAppropriate: Math.round(firstTrackAppropriate * 100) / 100,
    sceneEstablished: Math.round(sceneEstablished * 100) / 100,
    weightedScore: Math.round(weightedScore * 100) / 100,
    issues,
    openerText,
  };
}

/** Playlist-level score with opening weighted at 50%, tracks 6-15 at 30%, rest at 20%. */
export function weightedPlaylistListeningScore(
  opening: OpeningFiveEvaluation | null,
  fullSaveLikelihood: number | null,
): number | null {
  if (!opening) return fullSaveLikelihood;
  const mid = fullSaveLikelihood ?? opening.continueListening;
  return opening.weightedScore * 0.5 + mid * 0.35 + (fullSaveLikelihood ?? mid) * 0.15;
}
