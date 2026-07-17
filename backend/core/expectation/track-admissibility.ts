/**
 * Human Expectation Layer — track admissibility.
 *
 * Scores a single track against the ExpectationContract: does this song belong
 * in the imagined moment? This is where mood/energy inversions are caught
 * (e.g. a rave track in an "ambient sleep" moment, aggressive rap in a "first
 * date" moment). It reasons about musical FUNCTION (energy/valence/production),
 * never genre labels.
 */

import type { ExpectationContract, ExpectationTrack, SonicBands, TrackAdmissibility } from "./types";

const TEMPO_MIN = 60;
const TEMPO_MAX = 200;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function normTempo(bpm: number | null | undefined): number | null {
  if (typeof bpm !== "number" || !Number.isFinite(bpm)) return null;
  return clamp01((bpm - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN));
}

/** 1 inside the band, decaying to 0 as the value moves a band-width outside. */
function bandFit(value: number, band: [number, number]): number {
  const [lo, hi] = band;
  if (value >= lo && value <= hi) return 1;
  const width = Math.max(0.15, hi - lo);
  const dist = value < lo ? lo - value : value - hi;
  return clamp01(1 - dist / width);
}

/** Signed distance outside the band (positive = above hi, negative = below lo, 0 = inside). */
function bandOvershoot(value: number, band: [number, number]): number {
  const [lo, hi] = band;
  if (value > hi) return value - hi;
  if (value < lo) return value - lo;
  return 0;
}

const GENTLE_ATMOSPHERE = [
  "romance",
  "intimate",
  "tender",
  "warm",
  "calm",
  "comfort",
  "melancholy",
  "longing",
  "nostalgia",
  "peaceful",
  "serene",
  "relaxing",
];

function isNoveltyOrComedy(track: ExpectationTrack): boolean {
  const blob = `${track.trackName ?? ""} ${(track.genres ?? []).join(" ")}`.toLowerCase();
  return /\b(comedy|parody|novelty|spoof|joke|meme|sketch)\b/.test(blob);
}

function isChristmas(track: ExpectationTrack): boolean {
  const blob = `${track.trackName ?? ""} ${track.genreFamily ?? ""} ${(track.genres ?? []).join(" ")}`.toLowerCase();
  // Bare "holiday" is too broad (UK vacation). Require festive Christmas cues.
  return /\b(christmas|xmas|santa|jingle|noel|sleigh|feliz navidad|silent night|holiday song|holiday classic)\b/.test(blob);
}

/**
 * Evaluate a track against the contract. Returns a 0..1 fit score, an
 * admissible flag (false when it clearly inverts the moment), and the specific
 * violations for diagnostics/repair.
 */
export function evaluateTrackAdmissibility(
  track: ExpectationTrack,
  contract: ExpectationContract,
): TrackAdmissibility {
  const bands: SonicBands = contract.sonicBands;
  const violations: string[] = [];
  const RANK = { low: 1, medium: 2, high: 3 } as const;
  const SEVERITY = ["none", "low", "medium", "high"] as const;
  let worstRank = 0;

  const bump = (level: "low" | "medium" | "high") => {
    worstRank = Math.max(worstRank, RANK[level]);
  };

  // Severity scales with how far outside the band the value sits, relative to
  // the band width — a value a full band-width past the edge is a hard inversion.
  const overshootRatio = (value: number, band: [number, number]): number => {
    const width = Math.max(0.15, band[1] - band[0]);
    return bandOvershoot(value, band) / width;
  };

  // Energy — the strongest inversion signal.
  let energyFit = 1;
  if (typeof track.energy === "number") {
    energyFit = bandFit(track.energy, bands.energy);
    const ratio = overshootRatio(track.energy, bands.energy);
    if (ratio >= 0.5) {
      violations.push(`energy too high for the moment (${track.energy.toFixed(2)} vs ${bands.energy.map((x) => x.toFixed(2)).join("–")})`);
      bump(ratio >= 1 ? "high" : "medium");
    } else if (ratio <= -0.5) {
      violations.push(`energy too low for the moment (${track.energy.toFixed(2)} vs ${bands.energy.map((x) => x.toFixed(2)).join("–")})`);
      bump(ratio <= -1 ? "high" : "medium");
    }
  }

  // Valence — emotional-tone inversion (romantic moment vs bleak track, etc.).
  let valenceFit = 1;
  if (typeof track.valence === "number") {
    valenceFit = bandFit(track.valence, bands.valence);
    const ratio = overshootRatio(track.valence, bands.valence);
    if (Math.abs(ratio) >= 0.7) {
      violations.push(
        ratio > 0
          ? `too upbeat for the emotional tone (valence ${track.valence.toFixed(2)})`
          : `too bleak for the emotional tone (valence ${track.valence.toFixed(2)})`,
      );
      bump(Math.abs(ratio) >= 1.4 ? "high" : "medium");
    }
  }

  // Tempo / acoustic / instrumental — softer signals.
  const tempo = normTempo(track.tempo);
  const tempoFit = tempo === null ? 1 : bandFit(tempo, bands.tempo);
  const acousticFit = typeof track.acousticness === "number" ? bandFit(track.acousticness, bands.acoustic) : 1;
  const instrumentalFit =
    typeof track.instrumentalness === "number" ? bandFit(track.instrumentalness, bands.instrumental) : 1;

  // Explicit avoid conditions (novelty always breaks immersion; christmas is
  // seasonal and handled as a separate mismatch by the critic).
  if (contract.avoid.some((a) => /novelty|comedy/.test(a)) && isNoveltyOrComedy(track)) {
    violations.push("novelty/comedy track breaks immersion");
    bump("high");
  }

  // Hostility quadrant: loud AND dark (energy × (1−valence)) reads as
  // aggression. That breaks tender/warm moments (first date, sleep, cozy
  // evening) even when energy alone looks plausible — but is welcome in
  // moments that want aggression (gym, rage), so it's gated on the contract.
  const wantsGentle =
    contract.atmosphere.some((a) => GENTLE_ATMOSPHERE.some((g) => a.includes(g))) ||
    contract.avoid.some((a) => /aggress|harsh|abrasive|hostile/.test(a));
  if (wantsGentle && typeof track.energy === "number" && typeof track.valence === "number") {
    const aggression = track.energy * (1 - track.valence);
    if (aggression > 0.6) {
      violations.push(
        `aggressive/hostile tone breaks a tender moment (energy ${track.energy.toFixed(2)}, valence ${track.valence.toFixed(2)})`,
      );
      bump("high");
    }
  }

  const score =
    energyFit * 0.4 +
    valenceFit * 0.3 +
    tempoFit * 0.12 +
    acousticFit * 0.09 +
    instrumentalFit * 0.09;

  const admissible = worstRank < 3 && !(worstRank === 2 && violations.length >= 2);

  return { score: clamp01(score), admissible, violations, severity: SEVERITY[worstRank]! };
}

export { isChristmas as trackIsChristmas };
