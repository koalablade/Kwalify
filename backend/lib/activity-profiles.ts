/**
 * Activity profiles — hard functional constraints for focus, study, gym, and party prompts.
 * Biases candidate pools and scoring before hybrid tri-score runs.
 */

export type ActivityProfileId = "focus_coding" | "study" | "gym" | "party_pregame";

export type ActivityIntentInput = {
  activity?: string | null;
  energyLevel?: string | null;
  energy?: string | null;
};

export type ActivityTrackInput = {
  trackName?: string | null;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  loudness?: number | null;
  popularity?: number | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
};

export type ActivityClassificationInput = {
  genrePrimary?: string;
  genreFamily?: string;
  primarySubgenre?: string;
  secondarySubgenre?: string | null;
  subGenres?: string[];
} | null;

export type ActivityProfile = {
  id: ActivityProfileId;
  energyMin: number;
  energyMax: number;
  tempoMin: number | null;
  tempoMax: number | null;
  maxSpeechiness: number | null;
  minDanceability: number | null;
  preferInstrumental: boolean;
  genreVetoPatterns: RegExp[];
  genreBoostPatterns: RegExp[];
  boostFamilies: string[];
  vetoFamilies: string[];
};

const FOCUS_VETO_PATTERNS = [
  /\b(?:uk\s*garage|ukg|2-?step|speed\s*garage|garage\s*beat|bassline|bass\s*music)\b/i,
  /\b(?:grime|uk\s*grime|road\s*rap)\b/i,
  /\b(?:hard\s*techno|schranz|gabber|tekno|tekkno|industrial\s*techno|acid\s*techno|stutter\s*techno)\b/i,
  /\b(?:dnb|drum\s*(?:and|&|n)\s*bass|jungle|breakbeat|footwork|dubstep)\b/i,
  /\b(?:rave|squat\s*rave|donk|hardcore|jump\s*up)\b/i,
  /\b(?:techno\s*remix|garage\s*remix|dance\s*for\s*me)\b/i,
  /\b(?:conducta|mj\s*cole|kurupt|korrupt|shy\s*fx|dj\s*ez|so\s*solid|fyex|sonny\s*wern|artful\s*dodger|craig\s*david|astech|airod|scooter|zapravka)\b/i,
  /\btechno\b/i,
];

const PARTY_BOOST_FAMILIES = ["pop", "hip_hop", "electronic", "rnb", "soul"];
const PARTY_VETO_PATTERNS = [
  /\b(?:hard\s*techno|schranz|gabber|tekno|tekkno|industrial|acid\s*techno)\b/i,
  /\b(?:uk\s*garage|ukg|speed\s*garage|jungle|breakcore|footwork)\b/i,
  /\b(?:rave\s*edit|niche\s*rave|donk|hardcore)\b/i,
];

const PROFILES: Record<ActivityProfileId, ActivityProfile> = {
  focus_coding: {
    id: "focus_coding",
    energyMin: 0.15,
    energyMax: 0.40,
    tempoMin: 50,
    tempoMax: 130,
    maxSpeechiness: 0.28,
    minDanceability: null,
    preferInstrumental: true,
    genreVetoPatterns: FOCUS_VETO_PATTERNS,
    genreBoostPatterns: [/\b(?:ambient|idm|downtempo|chillout|lo-?fi|electronica)\b/i],
    boostFamilies: ["electronic", "ambient"],
    vetoFamilies: [],
  },
  study: {
    id: "study",
    energyMin: 0.20,
    energyMax: 0.45,
    tempoMin: 55,
    tempoMax: 135,
    maxSpeechiness: 0.30,
    minDanceability: null,
    preferInstrumental: false,
    genreVetoPatterns: FOCUS_VETO_PATTERNS,
    genreBoostPatterns: [/\b(?:ambient|classical|jazz|folk|acoustic|lo-?fi)\b/i],
    boostFamilies: ["folk", "classical", "jazz", "electronic"],
    vetoFamilies: [],
  },
  gym: {
    id: "gym",
    energyMin: 0.70,
    energyMax: 1.0,
    tempoMin: 108,
    tempoMax: null,
    maxSpeechiness: null,
    minDanceability: 0.52,
    preferInstrumental: false,
    genreVetoPatterns: [/\b(?:ballad|slowcore|lullaby|sleep|ambient)\b/i],
    genreBoostPatterns: [/\b(?:edm|house|trap|drill|phonk|rock|pop|hip.?hop)\b/i],
    boostFamilies: ["hip_hop", "electronic", "rock", "pop"],
    vetoFamilies: ["classical", "folk", "ambient"],
  },
  party_pregame: {
    id: "party_pregame",
    energyMin: 0.75,
    energyMax: 1.0,
    tempoMin: 100,
    tempoMax: null,
    maxSpeechiness: 0.38,
    minDanceability: 0.58,
    preferInstrumental: false,
    genreVetoPatterns: PARTY_VETO_PATTERNS,
    genreBoostPatterns: [/\b(?:pop|dance|edm|house|hip.?hop|rap|funk|disco)\b/i],
    boostFamilies: PARTY_BOOST_FAMILIES,
    vetoFamilies: ["classical", "folk", "ambient", "soundtrack"],
  },
};

function isStudyPrompt(vibe: string, intent: ActivityIntentInput): boolean {
  if (/\b(?:study|studying|homework|exam|revision|textbook|read(?:ing)?)\b/i.test(vibe)) return true;
  return intent.activity === "study";
}

function isCodingFocusPrompt(vibe: string, intent: ActivityIntentInput): boolean {
  if (isStudyPrompt(vibe, intent)) return false;
  if (intent.activity === "focus") return true;
  return /\b(?:focus|coding|deep\s+work|programming|developer|no\s+distractions?|concentrat(?:e|ion))\b/i.test(vibe);
}

function isGymPrompt(vibe: string, intent: ActivityIntentInput): boolean {
  return intent.activity === "gym" ||
    /\b(?:gym|workout|training|pump|cardio|run(?:ning)?|lifting|weights|\blift\b)\b/i.test(vibe);
}

export function isPartyPregamePrompt(vibe: string, intent: ActivityIntentInput): boolean {
  if (/\b(?:pre.?drinks?|pregame|pre-game|going\s+out|before\s+(?:town|the\s+club)|warm.?up|getting\s+ready\s+(?:to\s+go|for\s+(?:town|the\s+night)))\b/i.test(vibe)) {
    return true;
  }
  return (intent.activity === "party" || /\b(?:pregame|pre.?drinks?)\b/i.test(vibe)) &&
    !/\b(?:rave|techno|ukg|uk\s+garage|hardcore|niche)\b/i.test(vibe);
}

export function promptExplicitlyRequestsRave(vibe: string): boolean {
  return /\b(?:rave|hard\s*techno|ukg|uk\s+garage|niche|gabber|schranz|tekno|tekkno|jungle|donk)\b/i.test(vibe);
}

export function resolveActivityProfile(
  vibe: string,
  intent: ActivityIntentInput,
): ActivityProfile | null {
  if (isGymPrompt(vibe, intent)) return PROFILES.gym;
  if (isPartyPregamePrompt(vibe, intent)) return PROFILES.party_pregame;
  if (isStudyPrompt(vibe, intent)) return PROFILES.study;
  if (isCodingFocusPrompt(vibe, intent)) return PROFILES.focus_coding;
  return null;
}

function normalizeGenreBlob(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) return [value];
  return [];
}

export function buildTrackGenreEvidence(
  track: ActivityTrackInput,
  classification: ActivityClassificationInput,
  extraTerms: string[] = [],
): string {
  const parts = [
    track.trackName,
    track.artistName,
    ...normalizeGenreBlob(track.spotifyArtistGenres),
    ...normalizeGenreBlob(track.albumGenres),
    classification?.genrePrimary,
    classification?.genreFamily,
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
    ...extraTerms,
  ].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

function genreEvidenceText(
  classification: ActivityClassificationInput,
  track?: ActivityTrackInput,
  extraTerms: string[] = [],
): string {
  if (track) return buildTrackGenreEvidence(track, classification, extraTerms);
  const parts = [
    classification?.genrePrimary,
    classification?.genreFamily,
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
    ...extraTerms,
  ].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function activityGenreMultiplier(
  classification: ActivityClassificationInput,
  profile: ActivityProfile,
  vibe: string,
  track?: ActivityTrackInput,
  extraTerms: string[] = [],
): number {
  const text = genreEvidenceText(classification, track, extraTerms);
  const family = classification?.genreFamily ?? "";

  if (profile.id === "party_pregame" && promptExplicitlyRequestsRave(vibe)) {
    return 1;
  }

  if (profile.vetoFamilies.includes(family)) return 0.32;
  if (matchesAnyPattern(text, profile.genreVetoPatterns)) return 0.28;

  let mult = 1;
  if (profile.boostFamilies.includes(family)) mult += 0.12;
  if (matchesAnyPattern(text, profile.genreBoostPatterns)) mult += 0.10;

  if (profile.id === "party_pregame" && (family === "pop" || family === "hip_hop")) {
    mult += 0.14;
  }
  if (profile.id === "focus_coding" && family === "electronic" && !matchesAnyPattern(text, profile.genreVetoPatterns)) {
    mult += 0.08;
  }

  return Math.max(0.32, Math.min(1.28, mult));
}

export function activityEnergyFit(
  track: ActivityTrackInput,
  profile: ActivityProfile,
): number {
  const energy = track.energy ?? 0.5;
  const { energyMin, energyMax } = profile;

  if (energy >= energyMin && energy <= energyMax) {
    const center = (energyMin + energyMax) / 2;
    const halfSpan = Math.max(0.08, (energyMax - energyMin) / 2);
    const dist = Math.abs(energy - center) / halfSpan;
    return Math.max(0.72, 1 - dist * 0.22);
  }

  if (energy < energyMin) {
    const gap = energyMin - energy;
    return Math.max(0.12, 0.55 - gap * 1.8);
  }

  const gap = energy - energyMax;
  return Math.max(0.08, 0.48 - gap * 1.6);
}

function audioConstraintFit(track: ActivityTrackInput, profile: ActivityProfile): number {
  let score = 1;
  const tempo = track.tempo;
  const danceability = track.danceability;
  const speechiness = track.speechiness;
  const instrumentalness = track.instrumentalness;

  if (profile.tempoMin !== null && tempo !== null && tempo !== undefined && tempo < profile.tempoMin) {
    score -= Math.min(0.35, (profile.tempoMin - tempo) / 80);
  }
  if (profile.tempoMax !== null && tempo !== null && tempo !== undefined && tempo > profile.tempoMax) {
    score -= Math.min(0.35, (tempo - profile.tempoMax) / 90);
  }
  if (profile.minDanceability !== null && danceability !== null && danceability !== undefined && danceability < profile.minDanceability) {
    score -= Math.min(0.3, (profile.minDanceability - danceability) * 1.4);
  }
  if (profile.maxSpeechiness !== null && speechiness !== null && speechiness !== undefined && speechiness > profile.maxSpeechiness) {
    score -= Math.min(0.35, (speechiness - profile.maxSpeechiness) * 1.6);
  }
  if (profile.preferInstrumental && instrumentalness !== null && instrumentalness !== undefined && instrumentalness >= 0.45) {
    score += 0.08;
  }
  if (profile.id === "gym") {
    const rhythm = ((danceability ?? 0.5) * 0.55) + ((tempo ?? 120) >= 118 ? 0.25 : 0) + ((energyOf(track) >= 0.78) ? 0.2 : 0);
    score = score * 0.7 + Math.min(1, rhythm) * 0.3;
  }
  if (profile.id === "party_pregame") {
    const pop = typeof track.popularity === "number" ? Math.min(1, track.popularity / 100) : 0.45;
    score = score * 0.82 + pop * 0.18;
  }

  return Math.max(0.1, Math.min(1.2, score));
}

function energyOf(track: ActivityTrackInput): number {
  return track.energy ?? 0.5;
}

export function scoreActivityCandidateFit(
  track: ActivityTrackInput,
  classification: ActivityClassificationInput,
  profile: ActivityProfile,
  vibe: string,
): number {
  const energy = activityEnergyFit(track, profile);
  const genre = activityGenreMultiplier(classification, profile, vibe, track);
  const audio = audioConstraintFit(track, profile);
  return energy * 0.5 + genre * 0.28 + audio * 0.22;
}

export function activityHybridMultiplier(
  track: ActivityTrackInput,
  classification: ActivityClassificationInput,
  profile: ActivityProfile,
  vibe: string,
): number {
  const fit = scoreActivityCandidateFit(track, classification, profile, vibe);
  return Math.max(0.35, Math.min(1.22, 0.42 + fit * 0.72));
}

export function trackFailsActivityHardGate(
  track: ActivityTrackInput,
  classification: ActivityClassificationInput,
  profile: ActivityProfile,
  vibe: string,
): boolean {
  const energy = track.energy;
  const text = genreEvidenceText(classification, track);

  if (profile.id === "party_pregame" && promptExplicitlyRequestsRave(vibe)) return false;

  if (matchesAnyPattern(text, profile.genreVetoPatterns)) {
    if (profile.id === "focus_coding" || profile.id === "study") return true;
    if (profile.id === "party_pregame") return true;
    if (profile.id === "gym" && (energy ?? 0.5) < 0.82) return true;
  }

  if (energy !== null && energy !== undefined) {
    if (profile.id === "focus_coding" || profile.id === "study") {
      if (energy > profile.energyMax + 0.12) return true;
      if (energy < 0.06) return true;
    }
    if (profile.id === "gym" || profile.id === "party_pregame") {
      if (energy < profile.energyMin - 0.08) return true;
    }
  }

  if (profile.id === "gym") {
    const tempo = track.tempo;
    const danceability = track.danceability;
    const hasDrive =
      (energy !== null && energy !== undefined && energy >= 0.72) ||
      (tempo !== null && tempo !== undefined && tempo >= 112 && (danceability ?? 0) >= 0.58);
    if (!hasDrive) return true;
  }

  if (profile.maxSpeechiness !== null) {
    const speechiness = track.speechiness;
    if (speechiness !== null && speechiness !== undefined && speechiness > profile.maxSpeechiness + 0.10) {
      if (profile.id === "focus_coding" || profile.id === "study") return true;
    }
  }

  if (profile.id === "party_pregame") {
    const danceability = track.danceability;
    if (danceability !== null && danceability !== undefined && danceability < 0.50) return true;
    const pop = track.popularity;
    if (typeof pop === "number" && pop < 18 && (energy ?? 0) < 0.82) return true;
  }

  return false;
}

export function activityCoherenceDelta(
  track: ActivityTrackInput,
  classification: ActivityClassificationInput,
  profile: ActivityProfile,
  vibe: string,
): number {
  const fit = scoreActivityCandidateFit(track, classification, profile, vibe);
  if (fit >= 0.72) return Math.min(0.34, (fit - 0.55) * 0.55);
  if (fit <= 0.38) return -Math.min(0.48, (0.45 - fit) * 0.9);
  return (fit - 0.55) * 0.35;
}

export function activityTrustOutlierThreshold(profile: ActivityProfile | null): number {
  if (!profile) return -0.12;
  if (profile.id === "focus_coding" || profile.id === "study") return -0.08;
  if (profile.id === "gym" || profile.id === "party_pregame") return -0.06;
  return -0.12;
}

export function activityOpeningBoost(
  track: ActivityTrackInput,
  classification: ActivityClassificationInput,
  profile: ActivityProfile,
  vibe: string,
  position: number,
): number {
  if (trackFailsActivityHardGate(track, classification, profile, vibe)) return -0.35;
  const fit = scoreActivityCandidateFit(track, classification, profile, vibe);
  const positionWeight = position <= 0 ? 0.42 : position <= 2 ? 0.28 : 0.12;
  return fit * positionWeight;
}

export function filterTracksByActivityProfile<T extends ActivityTrackInput & { trackId?: string }>(
  tracks: T[],
  vibe: string,
  intent: ActivityIntentInput,
  classify: (track: T) => ActivityClassificationInput,
  minKeep = 5,
): { tracks: T[]; removed: number; profile: ActivityProfile | null } {
  const profile = resolveActivityProfile(vibe, intent);
  if (!profile) return { tracks, removed: 0, profile: null };
  const filtered = tracks.filter((track) =>
    !trackFailsActivityHardGate(track, classify(track), profile, vibe)
  );
  if (filtered.length >= minKeep) {
    return { tracks: filtered, removed: tracks.length - filtered.length, profile };
  }
  return { tracks, removed: 0, profile };
}
