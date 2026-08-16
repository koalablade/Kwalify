/**
 * V18 song-level moment fit — generator-side, distinct from world identity.
 * Answers: "Would a human choose THIS song for THIS moment?"
 */

export type SongMomentActivityHint =
  | "gym"
  | "bbq"
  | "motorway_rain"
  | "disco"
  | "country"
  | "madchester"
  | "night_drive"
  | null;

export type SongMomentTrack = {
  trackName?: string | null;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  popularity?: number | null;
  acousticness?: number | null;
  tempo?: number | null;
  instrumentalness?: number | null;
  danceability?: number | null;
};

export type MomentRejectSeverity = "hard" | "soft" | null;

const POWER_BALLAD =
  /\b(?:don'?t\s+cry|sweet\s+child|stairway|november\s+rain|every\s+rose|nothing\s+else\s+matters|patience|wind\s+of\s+change|with\s+or\s+without\s+you|dream\s+on|more\s+than\s+a\s+feeling|carry\s+on\s+wayward|free\s+bird|bohemian\s+rhapsody|gypsy|tide\s+is\s+high)\b/i;

const ANTHEMIC =
  /\b(?:shout|livin'? on a prayer|don'?t\s+stop\s+believin|we\s+will\s+rock\s+you|we\s+are\s+the\s+champions|eye\s+of\s+the\s+tiger|final\s+countdown|jump|here\s+i\s+go\s+again)\b/i;

const INSTRUMENTAL_DEEP =
  /\b(?:rat\s+salad|intro|outro|interlude|skit|reprise|instrumental|jam|movement|suite)\b/i;

const GYM_ANTHEM =
  /\b(?:t\.?n\.?t|back in black|welcome to the jungle|iron man|paranoid|fear of the dark|in bloom|highway to hell|enter sandman|master of puppets|crazy train|breaking the law|kickstart my heart|whole lotta rosie|you shook me)\b/i;

const BBQ_SINGALONG =
  /\b(?:back in black|sweet home alabama|born to run|don't stop believin|livin'? on a prayer|we will rock you|summer of '69|somebody to love|sweet child|more than a feeling)\b/i;

const DISCO_OFF_MOMENT =
  /\b(?:pop\s+smoke|warren\s+g|otis\s+redding|dock of the bay|princess\s+nokia|regulate|bump\s+&\s+grind)\b/i;

const NIGHT_DRIVE_WEAK =
  /\b(?:turning\s+japanese|non\s+stop\s+edit|radio\s+edit|club\s+mix|uk\s+garage|speed\s+garage|eurodance|happy\s+hardcore|sped\s+up|sp33d|on\s+sp33d|vip\s+mix)\b/i;

const NIGHT_DRIVE_CLUB_SPAM =
  /\b(?:sped\s+up|sp33d|on\s+sp33d|vip\s+mix|club\s+mix|stutter\s+techno|phonk|nightcore|speed\s+up)\b/i;

function titleOf(t: SongMomentTrack): string {
  return String(t.trackName ?? "").toLowerCase();
}

function artistOf(t: SongMomentTrack): string {
  return String(t.artistName ?? "").toLowerCase().trim();
}

function hasEnergy(t: SongMomentTrack): boolean {
  return typeof t.energy === "number" && Number.isFinite(t.energy);
}

function energyOf(t: SongMomentTrack): number | null {
  return hasEnergy(t) ? t.energy! : null;
}

function popOf(t: SongMomentTrack): number {
  const p = t.popularity;
  return typeof p === "number" && Number.isFinite(p) ? p : 50;
}

function instrumentalOf(t: SongMomentTrack): number {
  const v = t.instrumentalness;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 0–1 song-level moment fit (position-agnostic baseline). */
export function scoreSongMomentFit(
  track: SongMomentTrack,
  activity: SongMomentActivityHint,
): number {
  const title = titleOf(track);
  const artist = artistOf(track);
  const energy = energyOf(track);
  let score = 0.62;

  switch (activity) {
    case "gym": {
      if (POWER_BALLAD.test(title)) score -= 0.55;
      else if (GYM_ANTHEM.test(title)) score += 0.22;
      if (energy !== null) {
        if (energy < 0.58 && !GYM_ANTHEM.test(title)) score -= 0.32;
        if (energy >= 0.78) score += 0.12;
      }
      if (instrumentalOf(track) > 0.55 && popOf(track) < 30) score -= 0.25;
      break;
    }
    case "bbq": {
      if (BBQ_SINGALONG.test(title)) score += 0.15;
      else if (/\b(?:gypsy|tide is high|stairway)\b/.test(title)) score -= 0.4;
      else if (POWER_BALLAD.test(title)) score -= 0.28;
      if (energy !== null && energy < 0.42 && !BBQ_SINGALONG.test(title)) score -= 0.22;
      break;
    }
    case "motorway_rain": {
      if (ANTHEMIC.test(title)) score -= 0.52;
      if (energy !== null) {
        if (energy > 0.85) score -= 0.35;
        if (energy >= 0.35 && energy <= 0.72) score += 0.1;
      }
      break;
    }
    case "disco": {
      if (DISCO_OFF_MOMENT.test(artist) || DISCO_OFF_MOMENT.test(title)) score -= 0.55;
      if (energy !== null && energy >= 0.55 && energy <= 0.88) score += 0.08;
      break;
    }
    case "madchester": {
      if (artist.includes("stone roses") || artist.includes("happy mondays")) score += 0.18;
      if (artist.includes("oasis") && popOf(track) > 80) score -= 0.05;
      break;
    }
    case "night_drive": {
      if (NIGHT_DRIVE_WEAK.test(title) && !/\b(?:new order|depeche|cure|pet shop|simple minds|m83|a-ha|talking heads)\b/.test(artist)) {
        score -= 0.35;
      }
      break;
    }
    case "country": {
      if (/\b(?:cash|combs|bryan|jennings|brooks|pardi|musgraves|waylon|willie)\b/.test(artist)) {
        score += 0.08;
      }
      break;
    }
    default:
      break;
  }

  return Math.max(0, Math.min(1, score));
}

/** Whether this song is unsuitable for the activity (hard = remove/replace). */
export function momentRejectSeverity(
  track: SongMomentTrack,
  activity: SongMomentActivityHint,
  position?: number,
  totalLength?: number,
): MomentRejectSeverity {
  const title = titleOf(track);
  const energy = energyOf(track);
  const rel =
    typeof position === "number" && typeof totalLength === "number" && totalLength > 1
      ? position / (totalLength - 1)
      : null;

  if (activity === "gym") {
    if (POWER_BALLAD.test(title)) return "hard";
    if (energy !== null && energy < 0.52 && !GYM_ANTHEM.test(title)) return "hard";
    if (INSTRUMENTAL_DEEP.test(title) && popOf(track) < 25) return position === 0 ? "hard" : "soft";
  }

  if (activity === "bbq") {
    if (/\b(?:stairway|gypsy|tide is high)\b/.test(title)) return rel !== null && rel <= 0.35 ? "hard" : "soft";
    if (POWER_BALLAD.test(title) && energy !== null && energy < 0.48) return rel !== null && rel <= 0.4 ? "hard" : "soft";
  }

  if (activity === "motorway_rain") {
    if (rel !== null && rel >= 0.75 && ANTHEMIC.test(title)) return "hard";
    if (rel !== null && rel >= 0.75 && energy !== null && energy > 0.82) return "hard";
  }

  if (activity === "disco") {
    if (DISCO_OFF_MOMENT.test(titleOf(track)) || DISCO_OFF_MOMENT.test(artistOf(track))) return "hard";
  }

  if (activity === "night_drive") {
    if (NIGHT_DRIVE_CLUB_SPAM.test(title)) return "hard";
    const dance = track.danceability ?? null;
    if (NIGHT_DRIVE_WEAK.test(title) && dance !== null && dance > 0.68 && popOf(track) < 55) return "hard";
    if (NIGHT_DRIVE_WEAK.test(title) && popOf(track) < 40) return "soft";
  }

  if (position === 0) {
    if (INSTRUMENTAL_DEEP.test(title)) return "hard";
    if (instrumentalOf(track) > 0.65 && popOf(track) < 35) return "hard";
  }

  const fit = scoreSongMomentFit(track, activity);
  if (fit < 0.28) return "hard";
  if (fit < 0.38) return "soft";
  return null;
}

/** Gate for completion refill — reject obvious off-moment filler. */
export function passesMomentFitForRefill(track: SongMomentTrack, prompt: string): boolean {
  const p = prompt.toLowerCase();
  let activity: SongMomentActivityHint = null;
  if (/\b(?:gym|workout)\b/.test(p)) activity = "gym";
  else if (/\b(?:bbq|barbecue|dad\s+rock|beers)\b/.test(p)) activity = "bbq";
  else if (/\b(?:motorway|midnight\s+rain|windscreen)\b/.test(p)) activity = "motorway_rain";
  else if (/\b(?:disco|rooftop\s+party|1978)\b/.test(p)) activity = "disco";
  else if (/\b(?:madchester|baggy)\b/.test(p)) activity = "madchester";
  else if (/\b(?:80s|night\s+drive)\b/.test(p)) activity = "night_drive";
  else if (/\b(?:country|cowboy)\b/.test(p)) activity = "country";

  if (!activity) return true;
  const severity = momentRejectSeverity(track, activity);
  return severity !== "hard";
}

/** Minimum viable playlist length after quality ejection. */
export const MOMENT_FIT_MIN_VIABLE_LENGTH = 3;
