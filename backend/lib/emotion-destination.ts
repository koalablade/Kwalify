import type { EmotionProfile } from "./emotion";

/** How the playlist should move emotionally over its runtime. */
export type JourneyArc =
  | "default"
  | "flat"
  | "recovery"
  | "linear_rise"
  | "linear_fall"
  | "peak_release"
  | "slow_burn"
  | "wave";

interface StateNudge {
  energy?: number;
  valence?: number;
  tension?: number;
  nostalgia?: number;
  calm?: number;
}

/** Maps feeling words → profile nudges (destination targets). */
const FEELING_STATES: Record<string, StateNudge> = {
  calm: { energy: -0.15, valence: 0.1, tension: -0.25, calm: 0.35 },
  relaxed: { energy: -0.2, valence: 0.15, tension: -0.2, calm: 0.4 },
  peaceful: { energy: -0.25, valence: 0.2, tension: -0.3, calm: 0.45 },
  comfort: { energy: -0.1, valence: 0.2, tension: -0.2, nostalgia: 0.15, calm: 0.35 },
  comforted: { energy: -0.1, valence: 0.25, tension: -0.25, calm: 0.35 },
  hopeful: { energy: 0.05, valence: 0.35, tension: -0.15, nostalgia: 0.1 },
  motivated: { energy: 0.35, valence: 0.25, tension: 0.05, calm: -0.15 },
  energized: { energy: 0.45, valence: 0.3, tension: 0.05, calm: -0.2 },
  hyped: { energy: 0.5, valence: 0.35, tension: 0.1, calm: -0.25 },
  confident: { energy: 0.25, valence: 0.35, tension: -0.05, calm: 0.05 },
  happy: { energy: 0.2, valence: 0.45, tension: -0.1, calm: 0.1 },
  lighter: { energy: 0.1, valence: 0.3, tension: -0.2, calm: 0.15 },
  optimistic: { energy: 0.15, valence: 0.35, tension: -0.15 },
  focused: { energy: 0.1, valence: 0.05, tension: 0.05, calm: 0.25 },
  productive: { energy: 0.2, valence: 0.15, tension: 0.0, calm: 0.15 },
  creative: { energy: 0.15, valence: 0.15, tension: 0.05, calm: 0.1 },
  dreamy: { energy: -0.15, valence: 0.1, tension: -0.1, nostalgia: 0.2, calm: 0.25 },
  reflective: { energy: -0.1, valence: -0.05, tension: 0.1, nostalgia: 0.35, calm: 0.2 },
  nostalgic: { energy: -0.05, valence: 0.05, tension: 0.05, nostalgia: 0.45, calm: 0.15 },
  melancholy: { energy: -0.15, valence: -0.25, tension: 0.15, nostalgia: 0.35, calm: 0.15 },
  sad: { energy: -0.2, valence: -0.35, tension: 0.1, nostalgia: 0.25, calm: 0.1 },
  anxious: { energy: 0.1, valence: -0.2, tension: 0.4, calm: -0.2 },
  angry: { energy: 0.35, valence: -0.3, tension: 0.45, calm: -0.25 },
  frustrated: { energy: 0.25, valence: -0.25, tension: 0.4, calm: -0.2 },
  tired: { energy: -0.35, valence: -0.1, tension: -0.1, calm: 0.25 },
  exhausted: { energy: -0.4, valence: -0.15, tension: -0.05, calm: 0.3 },
  drained: { energy: -0.35, valence: -0.1, tension: 0.05, calm: 0.15 },
  burnt: { energy: -0.4, valence: -0.1, tension: 0.1, calm: 0.2 },
  overwhelmed: { energy: 0.05, valence: -0.2, tension: 0.35, calm: -0.15 },
  euphoric: { energy: 0.45, valence: 0.5, tension: 0.05, calm: -0.2 },
  romantic: { energy: 0.05, valence: 0.25, tension: 0.05, nostalgia: 0.2, calm: 0.15 },
  vulnerable: { energy: -0.1, valence: -0.1, tension: 0.2, nostalgia: 0.25, calm: 0.1 },
  content: { energy: -0.05, valence: 0.25, tension: -0.2, calm: 0.35 },
  contentment: { energy: -0.05, valence: 0.25, tension: -0.2, calm: 0.35 },
};

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function applyNudge(profile: EmotionProfile, nudge: StateNudge, strength: number): EmotionProfile {
  const p = { ...profile };
  const s = strength;
  if (nudge.energy !== undefined) p.energy = clamp(p.energy + nudge.energy * s);
  if (nudge.valence !== undefined) p.valence = clamp(p.valence + nudge.valence * s);
  if (nudge.tension !== undefined) p.tension = clamp(p.tension + nudge.tension * s);
  if (nudge.nostalgia !== undefined) p.nostalgia = clamp(p.nostalgia + nudge.nostalgia * s);
  if (nudge.calm !== undefined) p.calm = clamp(p.calm + nudge.calm * s);
  return p;
}

function lookupState(word: string): StateNudge | null {
  const key = word.toLowerCase().replace(/[^a-z]/g, "");
  return FEELING_STATES[key] ?? null;
}

export interface DestinationParse {
  current: StateNudge | null;
  desired: StateNudge | null;
  journeyArc: JourneyArc;
}

/** Detect "want to feel X", "from tired to motivated", "anxious but want calm". */
export function parseEmotionalDestination(text: string): DestinationParse {
  const lower = text.toLowerCase();
  let current: StateNudge | null = null;
  let desired: StateNudge | null = null;

  const fromTo = lower.match(/\bfrom\s+(\w+)\s+to\s+(\w+)/);
  if (fromTo) {
    current = lookupState(fromTo[1]!);
    desired = lookupState(fromTo[2]!);
  }

  const butWant = lower.match(
    /\b(\w+)\s+but\s+(?:want(?:ing)?|need(?:ing)?)\s+(?:to\s+)?(?:feel\s+)?(\w+)/
  );
  if (butWant) {
    current = current ?? lookupState(butWant[1]!);
    desired = desired ?? lookupState(butWant[2]!);
  }

  const wantFeel = lower.match(
    /\b(?:want|need|wanna)\s+(?:to\s+)?(?:feel|be|get)\s+(\w+)/
  );
  if (wantFeel) {
    desired = desired ?? lookupState(wantFeel[1]!);
  }

  const feelAfter = lower.match(/\bfeel\s+(\w+)\s+(?:after|by the end|later)\b/);
  if (feelAfter) {
    desired = desired ?? lookupState(feelAfter[1]!);
  }

  const currently = lower.match(/\b(?:currently|right now|im|i'm|feeling)\s+(\w+)/);
  if (currently && !current) {
    current = lookupState(currently[1]!);
  }

  const drainedComfort =
    /\b(?:mentally\s+)?drained\b.*\b(?:comfort|calm|lighter|better)\b/i.test(lower) ||
    /\b(?:exhausted|tired)\b.*\b(?:hopeful|motivated|energy)\b/i.test(lower);
  if (drainedComfort && !desired) {
    current = current ?? FEELING_STATES.drained;
    desired = FEELING_STATES.comfort ?? FEELING_STATES.hopeful;
  }

  let journeyArc: JourneyArc = "default";
  if (desired && current) {
    const rise = (desired.valence ?? 0) > (current.valence ?? 0) + 0.1;
    const moreCalm = (desired.calm ?? 0) > (current.calm ?? 0) + 0.1;
    const moreEnergy = (desired.energy ?? 0) > (current.energy ?? 0) + 0.1;
    if (rise || moreCalm) journeyArc = "recovery";
    else if (moreEnergy) journeyArc = "linear_rise";
    else journeyArc = "linear_fall";
  } else if (desired) {
    journeyArc = "recovery";
  }

  if (/\bheal(ing)?\b|\bheartbreak recovery\b|\bfeel better\b/i.test(lower)) {
    journeyArc = "recovery";
  }
  if (/\bslow burn\b|\bgradual\b|\bease into\b/i.test(lower)) journeyArc = "slow_burn";
  if (/\bpeak\b|\bclimax\b|\bbuild up\b|\beuphoric\b/i.test(lower)) journeyArc = "peak_release";

  return { current, desired, journeyArc };
}

/** Blend profile toward an emotional destination (current → desired). */
export function applyEmotionalDestination(
  text: string,
  profile: EmotionProfile
): EmotionProfile {
  const { current, desired } = parseEmotionalDestination(text);
  let p = profile;

  if (current) p = applyNudge(p, current, 0.25);
  if (desired) p = applyNudge(p, desired, 0.4);

  return p;
}

export function detectJourneyArc(text: string, profile: EmotionProfile): JourneyArc {
  return parseEmotionalDestination(text).journeyArc;
}

// ─── Aftermath / comedown (compositional energy reader) ──────────────────────
//
// A human "aftermath" moment is the low-arousal trailing state that FOLLOWS an
// intense or eventful experience: the comedown after a rave, the day after a
// holiday ends, the drive home after a long shift. Lexically these prompts still
// contain the energetic noun ("rave", "party", "holiday"), so the keyword bank
// reads them as high energy — but a human hears them as *deflation*, not hype.
//
// This is intentionally compositional, not a keyword dump: it looks for a decline
// CUE and then dampens whatever energy the rest of the prompt accumulated. It
// only ever lowers energy (a cap toward a ceiling), never raises it, and it backs
// off entirely when the prompt explicitly asks to stay up ("still lively",
// "not sleepy", "second wind"), so genuine ambiguity is preserved.

export type AftermathStrength = "none" | "soft" | "strong";

/** Prompt explicitly wants to stay energetic despite the aftermath framing. */
const STAY_UP_CUE =
  /\bstill (?:lively|going|pumped|buzzing|energetic|hyped|up|awake)\b|\bbut (?:still )?(?:lively|energetic|pumped|hype|upbeat|going)\b|\bnot (?:sleepy|tired|slow|dead|boring)\b|\bsecond wind\b|\bkeep (?:it |)(?:up|going)\b/;

/** Strong comedown: unambiguous low-arousal exhaustion / post-high crash. */
const STRONG_AFTERMATH_CUE =
  /\bcome ?down\b|\bcoming down\b|\bhang ?over\b|\bhung ?over\b|\bhalf dead\b|\bhalf-dead\b|\bdead on my feet\b|\brunning on empty\b|\bwiped out\b|\bcompletely drained\b/;

/** Soft aftermath: the quiet "after" of an event or a long stretch. */
const SOFT_AFTERMATH_CUE =
  /\bthe day after\b|\bday after\b|\bmorning after\b|\bnight after\b|\bafter (?:a |the |my |)(?:long )?(?:work ?day|shift|day|week|night out|holiday|trip|festival|rave|party|gig|tour|weekend)\b|\bback (?:home )?from (?:a |the |my |)(?:holiday|trip|tour|vacation|festival)\b|\bholiday (?:ends?|is over|over)\b|\bwind(?:ing)? down\b|\bwinding down\b|\bcoming home from\b/;

export function detectAftermath(text: string): AftermathStrength {
  const lower = text.toLowerCase();
  if (STAY_UP_CUE.test(lower)) return "none";
  if (STRONG_AFTERMATH_CUE.test(lower)) return "strong";
  if (SOFT_AFTERMATH_CUE.test(lower)) return "soft";
  return "none";
}

/**
 * Dampen energy for aftermath/comedown moments. Only lowers energy (cap toward a
 * ceiling) and nudges calm up; never fabricates energy. Preserves ambiguity by
 * doing nothing when there is no decline cue or the prompt asks to stay up.
 */
export function applyAftermath(text: string, profile: EmotionProfile): EmotionProfile {
  const strength = detectAftermath(text);
  if (strength === "none") return profile;

  const energyCeiling = strength === "strong" ? 0.32 : 0.46;
  const calmFloor = strength === "strong" ? 0.6 : 0.52;

  const p = { ...profile };
  p.energy = Math.min(p.energy, energyCeiling);
  p.calm = Math.max(p.calm, calmFloor);
  if (strength === "strong") p.tension = clamp(p.tension * 0.85);
  return p;
}

// ─── Low-arousal negative states (setback / suspended dread) ─────────────────
//
// Two human moments the keyword bank reads as energetic because of an incidental
// active verb ("walking", "waiting"): the *deflation* after a setback ("walking
// home after failing a job interview") and *suspended dread* ("nervously waiting
// for test results"). Both are low-arousal — heavy, slow, quiet — not hype. Like
// the aftermath reader these only ever cap energy downward and back off when the
// prompt explicitly wants to stay up.

/** A defeat/rejection whose emotional temperature is deflation, not anger. */
const SETBACK_CUE =
  /\b(?:after )?fail(?:ed|ing)?\b|\bdidn'?t get\b|\bdid not get\b|\bgot rejected\b|\brejected\b|\bturned down\b|\bdidn'?t work out\b|\bbad news\b|\bmade redundant\b|\blaid off\b|\bgot dumped\b|\blost (?:the|my) (?:job|game|match|deal)\b/;

/** Anxious suspension — the tense, held-breath wait, not a panic sprint. */
const DREAD_WAIT_CUE =
  /\bwaiting (?:for|on) (?:the |my |)(?:test |exam |)results?\b|\bwaiting room\b|\bnervously waiting\b|\bwaiting to hear\b|\bdreading\b/;

export function applyLowArousalNegative(text: string, profile: EmotionProfile): EmotionProfile {
  const lower = text.toLowerCase();
  if (STAY_UP_CUE.test(lower)) return profile;

  const setback = SETBACK_CUE.test(lower);
  const dread = DREAD_WAIT_CUE.test(lower);
  if (!setback && !dread) return profile;

  const p = { ...profile };
  p.energy = Math.min(p.energy, 0.38);
  if (setback) p.valence = clamp(p.valence - 0.15);
  if (dread) p.tension = clamp(p.tension + 0.1);
  p.calm = Math.max(p.calm, 0.5);
  return p;
}
