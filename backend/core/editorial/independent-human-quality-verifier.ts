/**
 * V49 — Independent human-quality verifier.
 *
 * Evaluates delivered playlists WITHOUT re-running contract-axis selection scores.
 * Uses semantic profiles, world fit, contrast violations, keyword-literal detection,
 * artist/style clustering, compound intersection weakness, and filler detection.
 *
 * Must NOT import contract-axis-scoring, contract-composition-select, or retrieval seed.
 */

import { enrichTrackSemanticProfile } from "../../lib/track-semantic-enrichment";
import type { TrackSemanticProfile } from "../../lib/track-semantic-types";
import { resolveCommittedWorld } from "../committed-world";
import { culturalProfileForCommittedWorld, getCulturalProfile } from "./cultural-identity-profile";
import { scoreTrackWorldIdentity } from "./world-identity-score";

export const INDEPENDENT_HUMAN_QUALITY_VERIFIER = "v49-independent-human-quality";

export type TrackFitFlag = "strong" | "borderline" | "misfit";

export type VerifierTrackInput = {
  trackName: string;
  artistName: string;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  popularity?: number | null;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  genres?: string[] | null;
  releaseYear?: number | null;
};

export type VerifierTrackSignal = {
  semanticMomentFit: number;
  worldFit: number;
  contrastViolation: boolean;
  keywordLiteral: boolean;
  fillerSuspect: boolean;
  compoundWeakness: number | null;
  spamSuspect: boolean;
};

export type VerifierTrackVerdict = {
  position: number;
  artistName: string;
  trackName: string;
  flag: TrackFitFlag;
  signals: VerifierTrackSignal;
  reasons: string[];
};

export type PlaylistVerdict = "strong" | "mixed" | "weak";

export type RoiFailure = {
  reason: string;
  code: string;
  impact: number;
  affectedTracks: number;
  trackRefs: string[];
};

export type IndependentHumanQualityResult = {
  verifierVersion: typeof INDEPENDENT_HUMAN_QUALITY_VERIFIER;
  prompt: string;
  trackCount: number;
  tracks: VerifierTrackVerdict[];
  playlistVerdict: PlaylistVerdict;
  failureReasons: string[];
  roiFailures: RoiFailure[];
  clustering: {
    maxArtistRun: number;
    dominantStyleShare: number;
    styleFamilies: string[];
  };
  compoundSummary: {
    isCompound: boolean;
    weakIntersectionShare: number;
    avgIntersection: number | null;
  };
};

type PromptExpectation = {
  compoundAxes: Array<{ positive: string; negative?: string; label: string }>;
  negations: string[];
  momentTags: string[];
  activityTags: string[];
  atmosphereTags: string[];
  worldHint: string | null;
  promptLower: string;
};

const CHEESY_MARKERS =
  /\b(?:cheesy|cheesey|novelty|eurovision|kidz bop|gummy bear|party all the time|ymca|macarena|chicken dance|cotton eye)\b/i;

const SPAM_MARKERS =
  /\b(?:sped up|slowed \+ reverb|phonk|stutter techno|tiktok|vip mix|club mix|\bvip\b|on sp33d|sp33d|\btechno\b.*\bremix\b|hardstyle|brostep)\b/i;

const TECHNO_SPAM =
  /\b(?:techno|hard techno|stutter|vip|hardstyle|trance remix|club mix)\b/i;

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function artistKey(t: VerifierTrackInput): string {
  return norm(t.artistName ?? "");
}

function titleKey(t: VerifierTrackInput): string {
  return norm(t.trackName ?? "");
}

function trackBlob(t: VerifierTrackInput): string {
  return `${t.artistName ?? ""} ${t.trackName ?? ""} ${t.genreFamily ?? ""} ${t.genrePrimary ?? ""}`.toLowerCase();
}

function maxArtistRun(tracks: VerifierTrackInput[]): number {
  let best = tracks.length > 0 ? 1 : 0;
  let run = 1;
  for (let i = 1; i < tracks.length; i += 1) {
    if (artistKey(tracks[i]!) === artistKey(tracks[i - 1]!)) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return best;
}

function inferStyleFamily(t: VerifierTrackInput): string {
  const blob = trackBlob(t);
  if (/\b(?:techno|house|trance|edm|electronic|dance)\b/.test(blob)) return "electronic";
  if (/\b(?:hip.?hop|rap|trap|drill|grime)\b/.test(blob)) return "hip_hop";
  if (/\b(?:rock|metal|punk|grunge|indie rock)\b/.test(blob)) return "rock";
  if (/\b(?:pop|synth.?pop|dance.?pop)\b/.test(blob)) return "pop";
  if (/\b(?:soul|r&b|funk|disco)\b/.test(blob)) return "soul_funk";
  if (/\b(?:jazz|blues|classical|orchestral)\b/.test(blob)) return "jazz_classical";
  if (/\b(?:country|folk|americana)\b/.test(blob)) return "country_folk";
  if (/\b(?:reggae|ska|dub)\b/.test(blob)) return "reggae";
  if (/\b(?:indie|bedroom|lo.?fi)\b/.test(blob)) return "indie";
  return "other";
}

/** Parse prompt expectations independently — no contract builder. */
export function parsePromptExpectation(prompt: string): PromptExpectation {
  const lower = norm(prompt);
  const compoundAxes: PromptExpectation["compoundAxes"] = [];
  const negations: string[] = [];
  const momentTags: string[] = [];
  const activityTags: string[] = [];
  const atmosphereTags: string[] = [];

  if (/\bnot\s+cheesy\b|\bwithout\s+cheesy\b|\bno\s+cheesy\b/.test(lower)) negations.push("cheesy");
  if (/\bnot\s+boring\b/.test(lower)) negations.push("boring");
  if (/\bnot\s+techno\b|\bwithout\s+techno\b/.test(lower)) negations.push("techno");

  if (
    (/\bsad\b|\bmelanchol|\bheartbreak/.test(lower) && /\bparty\b|\bbanger/.test(lower)) ||
    lower.includes("sad party")
  ) {
    compoundAxes.push({ positive: "melancholy", negative: "techno_spam", label: "sad party bangers" });
  }
  if (/\bparty\b/.test(lower) && negations.includes("cheesy")) {
    compoundAxes.push({ positive: "party_energy", negative: "cheesy", label: "party but not cheesy" });
  }
  if (/\bparty\b/.test(lower) && /\b(?:restrain(?:ed)?|controlled|understated)\b/.test(lower)) {
    compoundAxes.push({ positive: "party_energy", negative: "cheesy", label: "party but restrained" });
  }
  if (/\benergetic\b/.test(lower) && negations.includes("cheesy")) {
    compoundAxes.push({ positive: "high_energy", negative: "cheesy", label: "energetic but not cheesy" });
  }
  if (/\bchill/.test(lower) && negations.includes("boring")) {
    compoundAxes.push({ positive: "low_energy", negative: "boring", label: "chilled but not boring" });
  }
  if (/\bdark\b/.test(lower) && /\bdanceable\b|\bdance\b/.test(lower)) {
    compoundAxes.push({ positive: "melancholy", negative: undefined, label: "dark and danceable" });
  }
  if (/\bmelanchol|\bsad\b/.test(lower) && /\bdanceable\b/.test(lower)) {
    compoundAxes.push({ positive: "melancholy", negative: undefined, label: "melancholic and danceable" });
  }
  if (/\bemotional\b/.test(lower) && /\bupbeat\b/.test(lower)) {
    compoundAxes.push({ positive: "melancholy", negative: undefined, label: "emotional but upbeat" });
  }
  if (/\baggressive\b/.test(lower) && /\bcontrolled\b/.test(lower)) {
    compoundAxes.push({ positive: "high_energy", negative: undefined, label: "aggressive but controlled" });
  }
  if (/\bwarm\b/.test(lower) && /\bmelanchol/.test(lower)) {
    compoundAxes.push({ positive: "melancholy", negative: "low_energy", label: "warm and melancholic" });
  }
  if (/\brelaxed\b/.test(lower) && /\binteresting\b/.test(lower)) {
    compoundAxes.push({ positive: "low_energy", negative: "not_boring", label: "relaxed but interesting" });
  }
  if (/\bnostalgic\b/.test(lower) && /\bdriv/.test(lower)) {
    momentTags.push("nostalgic", "road-trip");
    activityTags.push("driving");
    atmosphereTags.push("reflective", "nostalgic");
  }

  if (/\b(?:late night|night drive|midnight|3\s?am|2\s?am)\b/.test(lower)) {
    momentTags.push("night", "late-night", "nocturnal", "driving");
    activityTags.push("driving");
    atmosphereTags.push("reflective", "nocturnal", "hypnotic");
  }
  if (/\b(?:rainy|rain)\b/.test(lower)) {
    momentTags.push("rain");
    atmosphereTags.push("melancholic", "reflective");
  }
  if (/\b(?:nostalg|90s|80s|old songs)\b/.test(lower)) {
    momentTags.push("nostalgic");
    atmosphereTags.push("nostalgic", "reflective");
  }
  if (/\b(?:summer evening|sunset)\b/.test(lower)) {
    momentTags.push("sunset", "evening");
    atmosphereTags.push("warm", "hopeful");
  }
  if (/\b(?:cozy|sunday morning|coffee)\b/.test(lower)) {
    momentTags.push("morning");
    atmosphereTags.push("cozy", "reflective");
  }
  if (/\b(?:lo.?fi|study|focus)\b/.test(lower)) {
    momentTags.push("studying");
    activityTags.push("studying");
    atmosphereTags.push("reflective", "intellectual");
  }
  if (/\b(?:party|banger|dance)\b/.test(lower) && compoundAxes.length === 0) {
    activityTags.push("dancing");
    atmosphereTags.push("euphoric");
  }
  if (/\b(?:bbq|dad rock)\b/.test(lower)) {
    activityTags.push("bbq");
    atmosphereTags.push("singalong");
  }
  if (/\b(?:gym|workout|pop punk)\b/.test(lower)) {
    activityTags.push("gym");
  }
  if (/\b(?:reggae|beach)\b/.test(lower)) {
    momentTags.push("beach");
    activityTags.push("relaxing");
  }
  if (/\b(?:road trip|driving|drive)\b/.test(lower)) {
    activityTags.push("driving");
    momentTags.push("road-trip");
  }
  if (/\bnostalgic driving\b/.test(lower)) {
    compoundAxes.push({ positive: "melancholy", negative: undefined, label: "nostalgic driving" });
  }

  let worldHint: string | null = null;
  if (/\bdad rock\b/.test(lower)) worldHint = "dad_rock_world";
  else if (/\bpop punk\b/.test(lower)) worldHint = "pop_punk_world";
  else if (/\breggae\b/.test(lower)) worldHint = "reggae_world";
  else if (/\b(?:late night drive|night drive|long drive|road trip|something for driving)\b/.test(lower)) {
    worldHint = "night_drive_world";
  }
  else if (/\b(?:rainy sunday|rainy day)\b/.test(lower)) worldHint = "rainy_drive_world";

  return { compoundAxes, negations, momentTags, activityTags, atmosphereTags, worldHint, promptLower: lower };
}

function tagOverlap(trackTags: string[], expected: string[]): number {
  if (expected.length === 0) return 0.55;
  const set = new Set(trackTags.map(norm));
  let hits = 0;
  for (const tag of expected) {
    if (set.has(norm(tag))) hits += 1;
  }
  return hits / expected.length;
}

function audioDrivingSignal(t: VerifierTrackInput): number {
  const e = t.energy ?? 0.5;
  const v = t.valence ?? 0.5;
  if (e >= 0.42 && e <= 0.82 && v >= 0.22 && v <= 0.72) return 0.74;
  if (e >= 0.35 && e <= 0.88) return 0.56;
  return 0.32;
}

function audioNostalgicSignal(t: VerifierTrackInput, profile: TrackSemanticProfile): number {
  const year = t.releaseYear ?? null;
  const narrative = profile.musicSemantic?.narrativeTags ?? [];
  let score = narrative.some((tag) => /nostalg|retro|throwback|memory/.test(tag)) ? 0.68 : 0.42;
  if (year != null && year <= 2005) score = Math.max(score, 0.72);
  else if (year != null && year <= 2012) score = Math.max(score, 0.58);
  return score;
}

function semanticMomentFit(
  profile: TrackSemanticProfile,
  expectation: PromptExpectation,
  track: VerifierTrackInput,
): number {
  const sceneTags = [
    ...profile.scene.places,
    ...profile.scene.times,
    ...profile.scene.activities,
    ...profile.scene.weather,
    ...profile.scene.atmospheres,
    ...profile.culturalTags,
    ...profile.themes,
    ...profile.sceneConcepts,
  ];
  const momentOverlap = tagOverlap(sceneTags, [
    ...expectation.momentTags,
    ...expectation.activityTags,
    ...expectation.atmosphereTags,
  ]);
  const musicNarrative = profile.musicSemantic?.narrativeTags ?? [];
  const narrativeOverlap = tagOverlap(musicNarrative, expectation.atmosphereTags);
  let score = momentOverlap * 0.7 + narrativeOverlap * 0.3;
  if (expectation.activityTags.includes("driving")) {
    score = Math.max(score, audioDrivingSignal(track) * 0.82);
  }
  if (expectation.momentTags.includes("nostalgic")) {
    score = Math.max(score, audioNostalgicSignal(track, profile) * 0.78);
  }
  return Math.min(1, score);
}

function audioMelancholySignal(t: VerifierTrackInput): number {
  const v = t.valence ?? 0.5;
  const e = t.energy ?? 0.5;
  if (v < 0.35) return 0.85;
  if (v < 0.45 && e < 0.7) return 0.72;
  if (v < 0.52) return 0.55;
  return Math.max(0, 0.5 - (v - 0.52) * 1.2);
}

function audioPartySignal(t: VerifierTrackInput): number {
  const e = t.energy ?? 0.5;
  const d = t.danceability ?? e;
  const v = t.valence ?? 0.5;
  let score = 0;
  if (e >= 0.62) score += 0.35;
  if (d >= 0.55) score += 0.35;
  if (v >= 0.45 && v <= 0.75) score += 0.15;
  if (e >= 0.75 && d >= 0.65) score += 0.15;
  return Math.min(1, score);
}

function audioHighEnergySignal(t: VerifierTrackInput): number {
  const e = t.energy ?? 0.5;
  if (e >= 0.78) return 0.9;
  if (e >= 0.65) return 0.72;
  if (e >= 0.55) return 0.5;
  return Math.max(0, e - 0.2);
}

function audioLowEnergySignal(t: VerifierTrackInput): number {
  const e = t.energy ?? 0.5;
  if (e <= 0.35) return 0.88;
  if (e <= 0.48) return 0.7;
  if (e <= 0.58) return 0.5;
  return Math.max(0, 0.55 - (e - 0.58));
}

function axisSignal(axis: string, t: VerifierTrackInput, profile: TrackSemanticProfile): number {
  const atm = profile.scene.atmospheres;
  switch (axis) {
    case "melancholy":
      return Math.max(audioMelancholySignal(t), atm.includes("melancholic") ? 0.75 : 0);
    case "party_energy":
      return Math.max(audioPartySignal(t), atm.includes("euphoric") ? 0.65 : 0);
    case "high_energy":
      return audioHighEnergySignal(t);
    case "low_energy":
      return audioLowEnergySignal(t);
    case "not_cheesy":
      return CHEESY_MARKERS.test(trackBlob(t)) ? 0.15 : 0.82;
    case "not_boring":
      return audioHighEnergySignal(t) >= 0.5 || audioPartySignal(t) >= 0.45 ? 0.75 : 0.35;
    default:
      return 0.5;
  }
}

function compoundPartnerAxis(axes: { positive: string; negative?: string; label: string }): string {
  if (axes.negative) return axes.negative;
  const label = axes.label.toLowerCase();
  if (/\bdanceable\b|\bdance\b/.test(label)) return "party_energy";
  if (/\bwarm\b/.test(label) && /\bmelanchol/.test(label)) return "low_energy";
  if (/\bemotional\b/.test(label) && /\bupbeat\b/.test(label)) return "party_energy";
  if (/\bdark\b/.test(label)) return "party_energy";
  if (/\baggressive\b/.test(label)) return "high_energy";
  return axes.positive === "melancholy" ? "low_energy" : "melancholy";
}

/** Independent compound intersection — harmonic mean of semantic+audio axis signals. */
function independentCompoundIntersection(
  t: VerifierTrackInput,
  profile: TrackSemanticProfile,
  axes: { positive: string; negative?: string; label: string },
): number {
  const a = axisSignal(axes.positive, t, profile);
  const partner = compoundPartnerAxis(axes);
  const b = axisSignal(partner, t, profile);
  if (a <= 0 || b <= 0) return 0;
  return (2 * a * b) / (a + b);
}

function detectKeywordLiteral(
  prompt: string,
  t: VerifierTrackInput,
  semanticFit: number,
  partySignal: number,
): boolean {
  const words = norm(prompt).split(/\s+/).filter((w) => w.length > 3);
  const title = titleKey(t);
  const skipLiteral = new Set(["drive", "driving", "night", "long", "nostalgic", "party", "study", "focus"]);
  for (const word of words) {
    if (skipLiteral.has(word)) continue;
    if (title.includes(word) && semanticFit < 0.42) {
      if (word === "party" && partySignal < 0.45) return true;
      if (word !== "party" && semanticFit < 0.35) return true;
    }
  }
  return false;
}

function detectContrastViolation(
  t: VerifierTrackInput,
  expectation: PromptExpectation,
  profile: TrackSemanticProfile,
): { violated: boolean; reason: string | null } {
  const blob = trackBlob(t);
  if (expectation.negations.includes("cheesy") && CHEESY_MARKERS.test(blob)) {
    return { violated: true, reason: "cheesy track violates not-cheesy constraint" };
  }
  if (expectation.negations.includes("techno") && TECHNO_SPAM.test(blob)) {
    return { violated: true, reason: "techno track violates anti-techno constraint" };
  }
  if (expectation.negations.includes("cheesy") && audioPartySignal(t) >= 0.85 && (t.valence ?? 0.5) > 0.78) {
    if (/\b(?:cotton|macarena|ymca|party rock|cheesy)\b/.test(blob)) {
      return { violated: true, reason: "hyper-cheerful party track violates restraint" };
    }
  }
  const atm = profile.scene.atmospheres;
  if (expectation.atmosphereTags.includes("nocturnal") && atm.includes("euphoric") && (t.energy ?? 0) > 0.85) {
    if (/\b(?:anthem|stadium|shout|rock you)\b/.test(blob)) {
      return { violated: true, reason: "stadium anthem breaks nocturnal/drive mood" };
    }
  }
  return { violated: false, reason: null };
}

function detectSpamSuspect(t: VerifierTrackInput): boolean {
  return SPAM_MARKERS.test(trackBlob(t)) || TECHNO_SPAM.test(titleKey(t));
}

function detectFillerSuspect(
  semanticFit: number,
  worldFit: number,
  compoundWeakness: number | null,
  contrastViolation: boolean,
  keywordLiteral: boolean,
  spamSuspect: boolean,
): boolean {
  if (spamSuspect) return true;
  if (contrastViolation) return true;
  if (keywordLiteral) return true;
  if (compoundWeakness != null && compoundWeakness < 0.28) return true;
  if (semanticFit < 0.32 && worldFit < 0.38) return true;
  return false;
}

function classifyTrackFlag(
  semanticFit: number,
  worldFit: number,
  compoundWeakness: number | null,
  fillerSuspect: boolean,
  contrastViolation: boolean,
): TrackFitFlag {
  if (fillerSuspect || contrastViolation) return "misfit";
  if (compoundWeakness != null && compoundWeakness < 0.38) return "misfit";
  if (semanticFit < 0.38 || worldFit < 0.35) return "misfit";
  if (compoundWeakness != null && compoundWeakness < 0.48) return "borderline";
  if (semanticFit < 0.52 || worldFit < 0.48) return "borderline";
  return "strong";
}

function scoreIndependentWorldFit(
  t: VerifierTrackInput,
  expectation: PromptExpectation,
  profile: TrackSemanticProfile,
): number {
  // Compound-only prompts: do not inherit generator world-lock — use semantic coherence.
  if (expectation.compoundAxes.length > 0 && !expectation.worldHint) {
    const atm = profile.scene.atmospheres;
    const act = profile.scene.activities;
    let score = 0.52;
    if (expectation.atmosphereTags.some((tag) => atm.includes(tag))) score += 0.18;
    if (expectation.activityTags.some((tag) => act.includes(tag))) score += 0.12;
    if (atm.includes("melancholic") || atm.includes("reflective")) score += 0.08;
    if (act.includes("dancing") || atm.includes("euphoric")) score += 0.08;
    return Math.min(1, score);
  }

  if (expectation.worldHint) {
    const profileWorld = getCulturalProfile(expectation.worldHint);
    if (profileWorld) {
      const raw = scoreTrackWorldIdentity(t, profileWorld);
      return Math.max(raw, 0.38);
    }
  }

  const committed = resolveCommittedWorld({ prompt: expectation.promptLower });
  if (committed && (expectation.worldHint || (committed.hardLock && expectation.compoundAxes.length === 0))) {
    const primaryId = committed.musicalWorldId ?? committed.id;
    const cultural = culturalProfileForCommittedWorld(committed.worldIds, primaryId);
    if (cultural) return scoreTrackWorldIdentity(t, cultural);
  }

  // Vague / moment prompts — semantic scene overlap is the world signal.
  const sceneTags = [
    ...profile.scene.places,
    ...profile.scene.atmospheres,
    ...profile.scene.activities,
    ...profile.culturalTags,
  ];
  return Math.min(1, 0.42 + tagOverlap(sceneTags, [
    ...expectation.momentTags,
    ...expectation.activityTags,
    ...expectation.atmosphereTags,
  ]) * 0.5);
}

function buildSemanticProfile(t: VerifierTrackInput): TrackSemanticProfile {
  return enrichTrackSemanticProfile({
    trackId: `${t.artistName}|${t.trackName}`,
    trackName: t.trackName,
    artistName: t.artistName,
    energy: t.energy,
    valence: t.valence,
    danceability: t.danceability,
    acousticness: t.acousticness,
    popularity: t.popularity,
    releaseYear: t.releaseYear,
  });
}

function derivePlaylistVerdict(
  tracks: VerifierTrackVerdict[],
  trackCount: number,
  maxArtistRun: number,
  weakIntersectionShare: number,
): PlaylistVerdict {
  if (trackCount === 0) return "weak";
  const misfitCount = tracks.filter((t) => t.flag === "misfit").length;
  const borderlineCount = tracks.filter((t) => t.flag === "borderline").length;
  const strongCount = tracks.filter((t) => t.flag === "strong").length;
  const misfitShare = misfitCount / trackCount;
  const fillerCount = tracks.filter((t) => t.signals.fillerSuspect).length;

  if (trackCount < 5 && misfitCount === 0 && strongCount >= trackCount - 1) return "mixed";
  if (misfitShare >= 0.2 || fillerCount >= 3 || maxArtistRun >= 4) return "weak";
  if (weakIntersectionShare >= 0.35 && trackCount >= 10) return "weak";
  if (misfitShare >= 0.08 || borderlineCount >= Math.ceil(trackCount * 0.35)) return "mixed";
  if (strongCount >= trackCount * 0.72 && misfitCount <= 1) return "strong";
  if (misfitCount === 0 && borderlineCount <= 3) return "strong";
  return "mixed";
}

function aggregateRoiFailures(tracks: VerifierTrackVerdict[]): RoiFailure[] {
  const buckets = new Map<string, { code: string; reason: string; refs: string[] }>();

  function add(code: string, reason: string, ref: string) {
    const key = code;
    const existing = buckets.get(key);
    if (existing) {
      existing.refs.push(ref);
    } else {
      buckets.set(key, { code, reason, refs: [ref] });
    }
  }

  for (const t of tracks) {
    const ref = `${t.artistName} — ${t.trackName}`;
    if (t.signals.spamSuspect) add("spam_suspect", "Techno/spam/novelty track detected", ref);
    if (t.signals.contrastViolation) add("contrast_violation", "Track violates prompt contrast/negation", ref);
    if (t.signals.keywordLiteral) add("keyword_literal", "Title-bait keyword match without semantic fit", ref);
    if (t.signals.fillerSuspect && !t.signals.spamSuspect && !t.signals.contrastViolation) {
      add("filler_suspect", "Low semantic/world fit filler", ref);
    }
    if (t.signals.compoundWeakness != null && t.signals.compoundWeakness < 0.38) {
      add("compound_weakness", "Weak compound axis intersection", ref);
    }
    if (t.signals.worldFit < 0.35) add("world_misfit", "Track outside committed musical world", ref);
    if (t.signals.semanticMomentFit < 0.35) add("moment_misfit", "Track fails semantic moment fit", ref);
  }

  const maxRun = maxArtistRun(
    tracks.map((t) => ({ artistName: t.artistName, trackName: t.trackName })),
  );
  if (maxRun >= 3) {
    add("artist_clustering", `${maxRun} consecutive tracks from same artist`, `#clustering`);
  }

  return [...buckets.values()]
    .map((b) => ({
      code: b.code,
      reason: b.reason,
      affectedTracks: b.refs.filter((r) => !r.startsWith("#")).length || 1,
      trackRefs: b.refs.slice(0, 6),
      impact: b.refs.filter((r) => !r.startsWith("#")).length * (b.code === "spam_suspect" ? 3 : b.code === "compound_weakness" ? 2 : 1),
    }))
    .sort((a, b) => b.impact - a.impact);
}

/** Primary entry — independent human-quality verification. */
export function verifyIndependentHumanQuality(
  prompt: string,
  tracks: VerifierTrackInput[],
): IndependentHumanQualityResult {
  const expectation = parsePromptExpectation(prompt);
  const compoundAxis = expectation.compoundAxes[0] ?? null;

  const trackVerdicts: VerifierTrackVerdict[] = tracks.map((t, i) => {
    const profile = buildSemanticProfile(t);
    const semanticFit = semanticMomentFit(profile, expectation, t);
    const worldFit = scoreIndependentWorldFit(t, expectation, profile);
    const spamSuspect = detectSpamSuspect(t);
    const compoundWeakness = compoundAxis
      ? independentCompoundIntersection(t, profile, compoundAxis)
      : null;
    const { violated: contrastViolation, reason: contrastReason } = detectContrastViolation(
      t,
      expectation,
      profile,
    );
    const keywordLiteral = detectKeywordLiteral(prompt, t, semanticFit, audioPartySignal(t));
    const fillerSuspect = detectFillerSuspect(
      semanticFit,
      worldFit,
      compoundWeakness,
      contrastViolation,
      keywordLiteral,
      spamSuspect,
    );
    const flag = classifyTrackFlag(semanticFit, worldFit, compoundWeakness, fillerSuspect, contrastViolation);

    const reasons: string[] = [];
    if (spamSuspect) reasons.push("spam/techno/novelty smell");
    if (contrastViolation && contrastReason) reasons.push(contrastReason);
    if (keywordLiteral) reasons.push("keyword-literal title bait");
    if (compoundWeakness != null && compoundWeakness < 0.45) {
      reasons.push(`weak compound intersection (${compoundWeakness.toFixed(2)})`);
    }
    if (semanticFit < 0.45) reasons.push(`low semantic moment fit (${semanticFit.toFixed(2)})`);
    if (worldFit < 0.42) reasons.push(`weak world fit (${worldFit.toFixed(2)})`);
    if (fillerSuspect && reasons.length === 0) reasons.push("possible filler");

    return {
      position: i + 1,
      artistName: t.artistName,
      trackName: t.trackName,
      flag,
      signals: {
        semanticMomentFit: Math.round(semanticFit * 1000) / 1000,
        worldFit: Math.round(worldFit * 1000) / 1000,
        contrastViolation,
        keywordLiteral,
        fillerSuspect,
        compoundWeakness: compoundWeakness != null ? Math.round(compoundWeakness * 1000) / 1000 : null,
        spamSuspect,
      },
      reasons,
    };
  });

  const styleFamilies = tracks.map(inferStyleFamily);
  const familyCounts = new Map<string, number>();
  for (const f of styleFamilies) familyCounts.set(f, (familyCounts.get(f) ?? 0) + 1);
  const dominantStyleShare =
    tracks.length > 0 ? Math.max(...familyCounts.values()) / tracks.length : 0;

  const compoundValues = trackVerdicts
    .map((t) => t.signals.compoundWeakness)
    .filter((v): v is number => v != null);
  const weakIntersectionShare =
    compoundValues.length > 0
      ? compoundValues.filter((v) => v < 0.38).length / compoundValues.length
      : 0;
  const avgIntersection =
    compoundValues.length > 0
      ? compoundValues.reduce((s, v) => s + v, 0) / compoundValues.length
      : null;

  const maxRun = maxArtistRun(tracks);
  const playlistVerdict = derivePlaylistVerdict(
    trackVerdicts,
    tracks.length,
    maxRun,
    weakIntersectionShare,
  );

  const roiFailures = aggregateRoiFailures(trackVerdicts);
  const failureReasons = [
    ...new Set([
      ...roiFailures.slice(0, 5).map((r) => r.reason),
      ...(playlistVerdict === "weak" ? ["Playlist-level quality below human save bar"] : []),
    ]),
  ];

  return {
    verifierVersion: INDEPENDENT_HUMAN_QUALITY_VERIFIER,
    prompt,
    trackCount: tracks.length,
    tracks: trackVerdicts,
    playlistVerdict,
    failureReasons,
    roiFailures,
    clustering: {
      maxArtistRun: maxRun,
      dominantStyleShare: Math.round(dominantStyleShare * 1000) / 1000,
      styleFamilies: [...new Set(styleFamilies)],
    },
    compoundSummary: {
      isCompound: expectation.compoundAxes.length > 0,
      weakIntersectionShare: Math.round(weakIntersectionShare * 1000) / 1000,
      avgIntersection: avgIntersection != null ? Math.round(avgIntersection * 1000) / 1000 : null,
    },
  };
}
