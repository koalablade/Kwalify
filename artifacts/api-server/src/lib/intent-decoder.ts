/**
 * Intent decoder — runs BEFORE scoring; overrides pure energy matching.
 */

export type HumanIntent =
  | "escape"
  | "reflect"
  | "energise"
  | "heal"
  | "focus"
  | "nostalgia"
  | "social_recovery"
  | "emotional_processing"
  | "neutral";

export interface IntentDecodeResult {
  intent: HumanIntent;
  confidence: number;
  scoringOverrides: {
    energyBias: number;
    valenceBias: number;
    allowEnergyMismatch: number;
  };
}

const RULES: { intent: HumanIntent; re: RegExp; confidence: number }[] = [
  { intent: "emotional_processing", re: /after an argument|after a fight|processing|need to process/i, confidence: 0.88 },
  { intent: "heal", re: /heal(ing)?|heartbreak recovery|getting better|grieving|mourning/i, confidence: 0.85 },
  { intent: "reflect", re: /reflect|introspect|thinking about|journal|overthink|clarity/i, confidence: 0.82 },
  { intent: "nostalgia", re: /nostalg|take me back|forgot you loved|childhood|memory|archaeology/i, confidence: 0.84 },
  { intent: "energise", re: /motivated|hyped|gym|workout|party|unstoppable|locked in|energiz/i, confidence: 0.8 },
  { intent: "social_recovery", re: /social recovery|recharge alone|introvert recovery|after party alone/i, confidence: 0.8 },
  { intent: "escape", re: /escape|zone out|numb|dissociate|disconnect from/i, confidence: 0.78 },
  { intent: "focus", re: /focus|study|exam|deadline|coding|deep work|revision/i, confidence: 0.78 },
];

const OVERRIDES: Record<HumanIntent, IntentDecodeResult["scoringOverrides"]> = {
  escape: { energyBias: -0.05, valenceBias: 0, allowEnergyMismatch: 0.15 },
  reflect: { energyBias: -0.12, valenceBias: -0.05, allowEnergyMismatch: 0.22 },
  energise: { energyBias: 0.22, valenceBias: 0.12, allowEnergyMismatch: 0.1 },
  heal: { energyBias: -0.08, valenceBias: 0.05, allowEnergyMismatch: 0.25 },
  focus: { energyBias: 0.05, valenceBias: 0, allowEnergyMismatch: 0.12 },
  nostalgia: { energyBias: -0.05, valenceBias: 0.08, allowEnergyMismatch: 0.2 },
  social_recovery: { energyBias: -0.12, valenceBias: 0.05, allowEnergyMismatch: 0.18 },
  emotional_processing: { energyBias: -0.1, valenceBias: -0.08, allowEnergyMismatch: 0.28 },
  neutral: { energyBias: 0, valenceBias: 0, allowEnergyMismatch: 0 },
};

export function decodeIntent(vibe: string): IntentDecodeResult {
  let best: IntentDecodeResult = {
    intent: "neutral",
    confidence: 0.3,
    scoringOverrides: OVERRIDES.neutral,
  };

  for (const rule of RULES) {
    if (rule.re.test(vibe) && rule.confidence > best.confidence) {
      best = {
        intent: rule.intent,
        confidence: rule.confidence,
        scoringOverrides: OVERRIDES[rule.intent],
      };
    }
  }

  return best;
}

export function applyIntentToProfile(
  profile: { energy: number; valence: number },
  intent: IntentDecodeResult
): void {
  const o = intent.scoringOverrides;
  const c = intent.confidence;
  profile.energy = Math.max(0, Math.min(1, profile.energy + o.energyBias * c));
  profile.valence = Math.max(0, Math.min(1, profile.valence + o.valenceBias * c));
}

/** Back-compat alias */
export { decodeIntent as decodeHumanIntent };
export type IntentParse = IntentDecodeResult;
