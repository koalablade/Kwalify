/**
 * Era Detection — 4-layer recommendation architecture support.
 *
 * Treats era references as "sonic aesthetic universes," not strict date filters.
 * A prompt like "80s songs that feel unreal" = synth-heavy cinematic atmosphere,
 * not a 1980–1989 release-date query.
 *
 * Produces an EraContext that the scoring pipeline uses to amplify nostalgia,
 * adjust the adjacent-era tolerance, and surface culturally coherent tracks.
 */

export interface EraContext {
  /** Primary detected decade label, e.g. "80s". Null if no era keyword found. */
  decade: string | null;
  /** 0–1: how strongly the prompt anchors to a specific era */
  eraConfidence: number;
  /**
   * Nostalgia boost to layer on top of the base emotion profile (0–0.35).
   * Higher for decades further in the past or with strong cultural gravity.
   */
  nostalgiaBoost: number;
  /**
   * Energy modifier for the era's sonic signature (+/- 0.15 max).
   * 80s = slightly elevated (synth drive); 90s = grunge tension; 60s = gentle lift.
   */
  energyDelta: number;
  /**
   * How broad the "adjacent era" window should be (in decades, 0–2).
   * 0 = strict — only that era. 1 = ±1 decade. Used to loosen genre scoring.
   */
  adjacentEraWindow: number;
  /** Human-readable descriptor of the sonic aesthetic, for logging/debug. */
  sonicAesthetic: string;
}

interface DecadeProfile {
  patterns: RegExp[];
  label: string;
  nostalgiaBoost: number;
  energyDelta: number;
  adjacentEraWindow: number;
  sonicAesthetic: string;
}

const DECADE_PROFILES: DecadeProfile[] = [
  {
    patterns: [/\b(1950s|50s|fifties)\b/i],
    label: "50s",
    nostalgiaBoost: 0.35,
    energyDelta: 0.02,
    adjacentEraWindow: 1,
    sonicAesthetic: "warm analogue, doo-wop, clean electric, Americana",
  },
  {
    patterns: [/\b(1960s|60s|sixties)\b/i],
    label: "60s",
    nostalgiaBoost: 0.33,
    energyDelta: 0.05,
    adjacentEraWindow: 1,
    sonicAesthetic: "psychedelic, British invasion, folk-rock, idealistic brightness",
  },
  {
    patterns: [/\b(1970s|70s|seventies)\b/i],
    label: "70s",
    nostalgiaBoost: 0.32,
    energyDelta: 0.04,
    adjacentEraWindow: 1,
    sonicAesthetic: "warm funk, soul, expansive rock, analogue warmth, groove",
  },
  {
    patterns: [/\b(1980s|80s|eighties)\b/i],
    label: "80s",
    nostalgiaBoost: 0.35,
    energyDelta: 0.12,
    adjacentEraWindow: 1,
    sonicAesthetic:
      "synth-pop, neon-lit cinematic, new wave, reverb-drenched, surreal and unreal, gated drums",
  },
  {
    patterns: [/\b(1990s|90s|nineties)\b/i],
    label: "90s",
    nostalgiaBoost: 0.32,
    energyDelta: 0.08,
    adjacentEraWindow: 1,
    sonicAesthetic: "grunge, alt-rock, neo-soul, R&B crossover, bittersweet raw emotion",
  },
  {
    patterns: [/\b(2000s|00s|noughties|y2k)\b/i],
    label: "00s",
    nostalgiaBoost: 0.28,
    energyDelta: 0.06,
    adjacentEraWindow: 1,
    sonicAesthetic: "polished pop-rock, rap crossover, emo, post-punk revival, bittersweet digital",
  },
  {
    patterns: [/\b(2010s|twenty[- ]tens|tens)\b/i],
    label: "10s",
    nostalgiaBoost: 0.18,
    energyDelta: 0.04,
    adjacentEraWindow: 1,
    sonicAesthetic: "indie bloom, bedroom pop, EDM crossover, wistful streaming-era",
  },
  {
    patterns: [/\b(2020s|twenty[- ]twenties)\b/i],
    label: "20s",
    nostalgiaBoost: 0.08,
    energyDelta: 0.0,
    adjacentEraWindow: 0,
    sonicAesthetic: "contemporary, hyperpop-adjacent, lo-fi, emotionally complex",
  },
];

/**
 * Confidence boost patterns — if the prompt explicitly frames the era as
 * an aesthetic (e.g. "make me feel like it's the 80s"), confidence rises.
 */
const HIGH_CONFIDENCE_FRAMES = [
  /\b(feels? like|sounds? like|vibe of|aesthetic of|era of|time of)\b.*\b(80s|90s|70s|60s|50s|00s|nineties|eighties|seventies|sixties|fifties|noughties)\b/i,
  /\b(80s|90s|70s|60s|50s|00s|nineties|eighties|seventies|sixties|fifties|noughties)\b.*\b(feel|sound|vibe|aesthetic|era|time)\b/i,
  /\b(classic|vintage|retro|throwback|nostalgic)\b.*\b(80s|90s|70s|60s|50s|00s)\b/i,
  /\b(80s|90s|70s|60s|50s|00s)\b.*\b(classic|vintage|retro|throwback|nostalgic)\b/i,
];

const NULL_ERA: EraContext = {
  decade: null,
  eraConfidence: 0,
  nostalgiaBoost: 0,
  energyDelta: 0,
  adjacentEraWindow: 0,
  sonicAesthetic: "",
};

/**
 * Detects era references in a free-text vibe prompt and returns a structured
 * EraContext. Returns null-era when no decade is found.
 */
export function detectEra(vibe: string): EraContext {
  if (!vibe?.trim()) return NULL_ERA;

  for (const profile of DECADE_PROFILES) {
    for (const pattern of profile.patterns) {
      if (pattern.test(vibe)) {
        let confidence = 0.6;

        for (const frame of HIGH_CONFIDENCE_FRAMES) {
          if (frame.test(vibe)) {
            confidence = Math.min(1.0, confidence + 0.3);
            break;
          }
        }

        // Additional signals that push confidence up
        if (/\b(only|strictly|pure|classic)\b/i.test(vibe)) {
          confidence = Math.min(1.0, confidence + 0.1);
        }
        // Vague references lower confidence slightly
        if (/\b(bit of|hint of|touch of)\b/i.test(vibe)) {
          confidence = Math.max(0.3, confidence - 0.15);
        }

        return {
          decade: profile.label,
          eraConfidence: confidence,
          nostalgiaBoost: profile.nostalgiaBoost * confidence,
          energyDelta: profile.energyDelta * Math.min(1, confidence + 0.2),
          adjacentEraWindow: profile.adjacentEraWindow,
          sonicAesthetic: profile.sonicAesthetic,
        };
      }
    }
  }

  return NULL_ERA;
}

/** Returns true when the era context has a meaningful era signal. */
export function hasEraSignal(ctx: EraContext): ctx is EraContext & { decade: string } {
  return ctx.decade !== null && ctx.eraConfidence > 0;
}
