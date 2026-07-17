import type { EmotionProfile } from "./emotion";

/**
 * Interpretation confidence.
 *
 * The interpreter should know when it is *uncertain* rather than fabricating
 * certainty. Confidence here is grounded, not invented: each axis is scored by
 * how *decisive* the interpreted signal is (distance from neutral), then
 * discounted when the prompt carries explicit ambiguity — contradiction phrases
 * ("happy but sad"), hedges ("ish", "kind of"), or "X but Y" tension.
 *
 * This is deliberately side-effect free. Low confidence is a signal a caller MAY
 * use to widen retrieval / soften constraints; it never silently changes output.
 * The energy axis is the one the pipeline acts on today (via the decisive-only
 * world-energy override in intent-collapse-layer), so it is the most load-bearing.
 */

export interface InterpretationConfidence {
  energy: number;
  valence: number;
  intensity: number;
  nostalgia: number;
  intimacy: number;
  socialness: number;
  /** Weighted blend (energy-led), discounted by prompt ambiguity. */
  overall: number;
  /** True when the strongest actionable axis (energy) is genuinely uncertain. */
  energyUncertain: boolean;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Decisiveness of a [0,1] axis relative to a neutral point, scaled to [0,1]. */
function decisiveness(value: number, neutral: number, span: number): number {
  return clamp01(Math.abs(value - neutral) / span);
}

/** Explicit ambiguity in the prompt that should lower confidence on every axis. */
function ambiguityDiscount(text: string): number {
  const lower = text.toLowerCase();
  let discount = 0;
  if (/\bbut\b|\byet\b|\bthough\b|\beven though\b/.test(lower)) discount += 0.18;
  if (/-?ish\b|\bkind ?of\b|\bsort ?of\b|\bmaybe\b|\bsomehow\b|\bnot sure\b/.test(lower)) discount += 0.18;
  if (/happy.*sad|sad.*happy|bittersweet|mixed feelings|don'?t know (?:how|what)/.test(lower)) discount += 0.22;
  if (/\bor\b/.test(lower)) discount += 0.08;
  return Math.min(discount, 0.55);
}

/** Presence of an explicit social OR solitary cue (either way = a clear reading). */
function socialCueStrength(text: string): number {
  const lower = text.toLowerCase();
  const social = /\b(friends|mates|crowd|party|together|group|everyone|lads|squad|social|reunion)\b/.test(lower);
  const solo = /\b(alone|solo|by myself|on my own|lonely|empty|no one|nobody)\b/.test(lower);
  if (social || solo) return 0.85;
  return 0.35;
}

export function computeInterpretationConfidence(
  text: string,
  profile: EmotionProfile,
): InterpretationConfidence {
  const discount = ambiguityDiscount(text);
  const apply = (raw: number): number => clamp01(raw * (1 - discount));

  // Energy/valence are centred on 0.5; a full swing to 0 or 1 is maximally decisive.
  const energy = apply(decisiveness(profile.energy, 0.5, 0.5));
  const valence = apply(decisiveness(profile.valence, 0.5, 0.5));
  // Tension baselines at 0.3, nostalgia at 0.2 (see analyzeVibe defaults).
  const intensity = apply(decisiveness(profile.tension, 0.3, 0.5));
  const nostalgia = apply(decisiveness(profile.nostalgia, 0.2, 0.6));
  // Intimacy is read from calm (still, close) vs energetic (open, loud).
  const intimacy = apply(decisiveness(profile.calm, 0.5, 0.5));
  const socialness = apply(socialCueStrength(text));

  const overall = clamp01(
    (energy * 0.35 + valence * 0.2 + intensity * 0.15 + nostalgia * 0.1 + intimacy * 0.1 + socialness * 0.1),
  );

  return {
    energy,
    valence,
    intensity,
    nostalgia,
    intimacy,
    socialness,
    overall,
    energyUncertain: energy < 0.34,
  };
}
