/**
 * V53 — Positive atmospheric/context scoring from audio features + genre metadata.
 * Supports night drive, cozy morning, and lo-fi focus worlds without prompt-specific hacks.
 */

export type AtmosphericContextKind = "night_drive" | "cozy_morning" | "lofi_focus";

export type AtmosphericTrackFeatures = {
  trackName?: string | null;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo?: number | null;
  genreFamily?: string | null;
  genrePrimary?: string | null;
};

export const ATMOSPHERIC_WORLD_IDS = new Set([
  "night_drive_world",
  "evening_drive_world",
  "melancholy_drive",
  "rainy_drive_world",
  "80s_night_drive_world",
  "sunday_chill_world",
  "acoustic_sunday_world",
  "coffee_soft_focus_world",
  "lofi_world",
  "focus_study_world",
  "ambient_world",
  "quiet_night_world",
  "late_night_calm_world",
]);

const LEXICAL_ATMOSPHERE =
  /\b(?:lo-?fi|lofi|chill\s*hop|study\s+beats?|focus\s+music|cozy|coffee|morning\s+vibes?|bedroom\s+pop)\b/i;

const LIVE_OR_BROADCAST =
  /\b(?:like\s+a\s+version|triple\s+j|live\s+at|live\s+from|live\s+acoustic|\bacoustic\b.*\blive\b|\bconcerto|festival\s+set|session)\b/i;

const LOFI_TITLE_CLAIM = /\b(?:lo-?fi|lofi|chillhop|study\s+beats?|focus)\b/i;

function num(v: number | null | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function inBand(value: number, min: number, max: number, width = 0.12): number {
  if (value >= min && value <= max) return 1;
  const dist = value < min ? min - value : value - max;
  return Math.max(0, 1 - dist / width);
}

function genreBlob(track: AtmosphericTrackFeatures): string {
  return [track.genreFamily, track.genrePrimary].filter(Boolean).join(" ").toLowerCase();
}

function titleBlob(track: AtmosphericTrackFeatures): string {
  return `${track.artistName ?? ""} ${track.trackName ?? ""}`.toLowerCase();
}

/** Map committed world id → atmospheric sonic context (generic, not prompt regex). */
export function resolveAtmosphericContext(
  worldId: string | null | undefined,
): AtmosphericContextKind | null {
  switch (worldId) {
    case "night_drive_world":
    case "evening_drive_world":
    case "melancholy_drive":
    case "rainy_drive_world":
    case "80s_night_drive_world":
      return "night_drive";
    case "sunday_chill_world":
    case "acoustic_sunday_world":
    case "coffee_soft_focus_world":
    case "quiet_night_world":
    case "late_night_calm_world":
      return "cozy_morning";
    case "lofi_world":
    case "focus_study_world":
    case "ambient_world":
      return "lofi_focus";
    default:
      return null;
  }
}

export function isAtmosphericWorld(worldId: string | null | undefined): boolean {
  return worldId != null && ATMOSPHERIC_WORLD_IDS.has(worldId);
}

/** 0–1 positive fit — higher = more sonically appropriate for the atmospheric context. */
export function scoreAtmosphericContextFit(
  track: AtmosphericTrackFeatures,
  context: AtmosphericContextKind,
): number {
  const energy = num(track.energy, 0.5);
  const valence = num(track.valence, 0.5);
  const dance = num(track.danceability, energy);
  const acoustic = num(track.acousticness, 0.45);
  const instrumental = num(track.instrumentalness, 0.15);
  const speech = num(track.speechiness, 0.08);
  const genre = genreBlob(track);

  switch (context) {
    case "night_drive": {
      let score = 0.38;
      score += inBand(energy, 0.34, 0.66, 0.18) * 0.28;
      score += inBand(valence, 0.26, 0.62, 0.2) * 0.18;
      score += inBand(dance, 0.32, 0.64, 0.18) * 0.14;
      if (/\b(?:indie|electronic|rock|synth|dream\s+pop|alt)\b/.test(genre)) score += 0.1;
      if (energy >= 0.35 && energy <= 0.68 && valence <= 0.68) score += 0.06;
      if (energy > 0.78 || valence > 0.78) score -= 0.22;
      if (energy < 0.22) score -= 0.12;
      return Math.max(0, Math.min(1, score));
    }
    case "cozy_morning": {
      let score = 0.36;
      score += inBand(energy, 0.2, 0.54, 0.16) * 0.26;
      score += inBand(valence, 0.4, 0.74, 0.18) * 0.2;
      score += inBand(acoustic, 0.32, 0.82, 0.22) * 0.14;
      if (dance <= 0.58) score += 0.08;
      if (/\b(?:folk|acoustic|indie|jazz|soul|singer)\b/.test(genre)) score += 0.08;
      if (energy > 0.64 || valence > 0.82) score -= 0.18;
      if (LIVE_OR_BROADCAST.test(titleBlob(track))) score -= 0.28;
      return Math.max(0, Math.min(1, score));
    }
    case "lofi_focus": {
      let score = 0.34;
      score += inBand(energy, 0.12, 0.46, 0.14) * 0.28;
      score += inBand(valence, 0.22, 0.58, 0.2) * 0.12;
      score += inBand(dance, 0.08, 0.52, 0.18) * 0.1;
      if (instrumental >= 0.22 || speech <= 0.14) score += 0.14;
      else if (speech > 0.08 && instrumental < 0.12) score -= 0.18;
      if (/\b(?:electronic|jazz|hip_hop|indie|classical|ambient)\b/.test(genre)) score += 0.08;
      if (energy > 0.55 || speech > 0.22) score -= 0.2;
      if (/\b(?:symphony|concerto|orchestra)\b/i.test(titleBlob(track)) && speech > 0.05) score -= 0.22;
      return Math.max(0, Math.min(1, score));
    }
    default:
      return 0.5;
  }
}

/** Penalty when title claims an atmospheric mood but audio profile contradicts it. */
export function atmosphericLexicalHackPenalty(
  track: AtmosphericTrackFeatures,
  context: AtmosphericContextKind,
): number {
  const title = titleBlob(track);
  const energy = num(track.energy, 0.5);
  const valence = num(track.valence, 0.5);
  const speech = num(track.speechiness, 0.08);
  const instrumental = num(track.instrumentalness, 0.15);
  const sonicFit = scoreAtmosphericContextFit(track, context);

  let penalty = 0;

  if (LEXICAL_ATMOSPHERE.test(title) && sonicFit < 0.42) {
    penalty = Math.max(penalty, 0.38 + (0.42 - sonicFit) * 0.45);
  }

  if (context === "lofi_focus" && LOFI_TITLE_CLAIM.test(title)) {
    if (energy > 0.52 || speech > 0.2) penalty = Math.max(penalty, 0.48);
    if (instrumental < 0.08 && speech > 0.16) penalty = Math.max(penalty, 0.42);
  }

  if (context === "cozy_morning") {
    if (LIVE_OR_BROADCAST.test(title)) penalty = Math.max(penalty, 0.52);
    if (/\b(?:acoustic|live)\b/i.test(title) && energy > 0.42) penalty = Math.max(penalty, 0.48);
    if (/\b(?:bored yet|party|banger|hype)\b/i.test(title)) penalty = Math.max(penalty, 0.45);
    if (energy > 0.62 && valence > 0.72) penalty = Math.max(penalty, 0.35);
  }

  if (context === "night_drive" && /\b(?:sped|nightcore|chillhop\s+beats)\b/i.test(title)) {
    penalty = Math.max(penalty, 0.55);
  }

  return Math.min(0.72, penalty);
}

export function isAtmosphericLexicalHack(
  track: AtmosphericTrackFeatures,
  context: AtmosphericContextKind,
): boolean {
  return atmosphericLexicalHackPenalty(track, context) >= 0.42;
}

/** Retrieval rank modifier — positive boost for sonic neighborhood, negative for lexical hacks. */
export function atmosphericRetrievalBoost(
  track: AtmosphericTrackFeatures,
  worldId: string | null | undefined,
): number {
  const context = resolveAtmosphericContext(worldId);
  if (!context) return 0;
  const fit = scoreAtmosphericContextFit(track, context);
  const hack = atmosphericLexicalHackPenalty(track, context);
  return fit * 0.32 - hack * 0.55;
}

/** Minimum atmospheric fit to admit a track when world identity is borderline thin. */
export function atmosphericRetrievalAdmissionFit(
  track: AtmosphericTrackFeatures,
  worldId: string | null | undefined,
): number {
  const context = resolveAtmosphericContext(worldId);
  if (!context) return 0;
  if (isAtmosphericLexicalHack(track, context)) return 0;
  return scoreAtmosphericContextFit(track, context);
}

/** Shared flat admission floor when per-context resolution is unavailable. */
export const ATMOSPHERIC_ADMISSION_FLOOR = 0.5;

/** Shared admission floor — retrieval, refill, and hard-lock filters use the same sonic bar. */
export function atmosphericAdmissionFloor(context: AtmosphericContextKind): number {
  switch (context) {
    case "lofi_focus":
      return 0.56;
    case "cozy_morning":
      return 0.52;
    case "night_drive":
      return 0.5;
    default:
      return 0.52;
  }
}

export function passesAtmosphericDeliverableAdmission(
  track: AtmosphericTrackFeatures,
  worldId: string | null | undefined,
): boolean {
  const context = resolveAtmosphericContext(worldId);
  if (!context) return false;
  if (isAtmosphericLexicalHack(track, context)) return false;
  const fit = scoreAtmosphericContextFit(track, context);
  if (fit < atmosphericAdmissionFloor(context)) return false;
  if (context === "lofi_focus") {
    const speech = num(track.speechiness, 0.08);
    const instrumental = num(track.instrumentalness, 0.15);
    if (speech > 0.16 && instrumental < 0.12) return false;
  }
  return true;
}

/** Depth multiplier for atmospheric committed worlds — widen candidate pool before composition. */
export function atmosphericPoolDepthMultiplier(worldId: string | null | undefined): number {
  return isAtmosphericWorld(worldId) ? 1.85 : 1;
}
