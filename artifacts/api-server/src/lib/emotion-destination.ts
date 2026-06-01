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
