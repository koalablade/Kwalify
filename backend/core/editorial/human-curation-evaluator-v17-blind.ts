/**
 * Blind human-listenability evaluator — V17 calibration pass.
 * Version: human-curation-evaluator-v17-blind
 *
 * Observes final playlists only. Does NOT import generator, sequencer, purity,
 * roster, or world-identity pipeline modules.
 */

export const HUMAN_CURATION_EVALUATOR_V17_BLIND = "human-curation-evaluator-v17-blind";

export type BlindVerdict = "YES" | "MAYBE" | "NO";

export type BlindTrackInput = {
  trackName: string;
  artistName: string;
  albumName?: string | null;
  releaseYear?: number | null;
  energy?: number | null;
  popularity?: number | null;
  durationMs?: number | null;
  explicit?: boolean | null;
};

export type TransitionQuality = "GREAT" | "GOOD" | "ACCEPTABLE" | "WEAK" | "JARRING";

export type DeepCutVerdict = "GOOD_DEEP_CUT" | "NEUTRAL_DEEP_CUT" | "BAD_DEEP_CUT" | "NOT_DEEP_CUT";

export type CloserVerdict = "PAYOFF" | "SATISFYING" | "ACCEPTABLE" | "ARBITRARY" | "LEFTOVER";

export type AiObviousness = "LOW" | "MEDIUM" | "HIGH";

export type BlindTrackEvaluation = {
  position: number;
  artistName: string;
  trackName: string;
  promptFit: number;
  momentFit: number;
  songFit: number;
  positionFit: number;
  humanPlausibility: number;
  contribution: number;
  deepCut: DeepCutVerdict;
  filler: boolean;
  notes: string[];
};

export type BlindTransitionEvaluation = {
  fromPosition: number;
  toPosition: number;
  from: string;
  to: string;
  quality: TransitionQuality;
  reason: string;
};

export type BlindHumanCurationEvaluation = {
  evaluatorVersion: typeof HUMAN_CURATION_EVALUATOR_V17_BLIND;
  prompt: string;
  momentInterpretation: string;
  activityContext: string | null;
  trackCount: number;
  tracks: BlindTrackEvaluation[];
  transitions: BlindTransitionEvaluation[];
  dimensions: {
    momentFit: { score: number; max: 25; evidence: string[] };
    trackFit: { score: number; max: 20; evidence: string[] };
    opener: { score: number; max: 10; evidence: string[] };
    firstThree: { score: number; max: 10; evidence: string[] };
    sequencing: { score: number; max: 10; evidence: string[] };
    transitions: { score: number; max: 10; evidence: string[] };
    humanPlausibility: { score: number; max: 10; evidence: string[] };
  };
  repetitionAnalysis: string[];
  canonicalOmissions: string[];
  fillerTracks: string[];
  deepCutNotes: string[];
  closer: { verdict: CloserVerdict; evidence: string[] };
  aiObviousness: AiObviousness;
  aiObviousnessReasons: string[];
  wouldPressPlay: BlindVerdict;
  wouldSave: BlindVerdict;
  wouldShare: BlindVerdict;
  wouldBelieveHumanMade: BlindVerdict;
  aggregateScore: number;
  evaluatorConfidence: "HIGH" | "MEDIUM" | "LOW";
  explanations: string[];
};

const POWER_BALLAD =
  /\b(?:don'?t\s+cry|sweet\s+child|stairway|november\s+rain|nothing\s+else\s+matters|patience|wind\s+of\s+change|with\s+or\s+without\s+you|dream\s+on|free\s+bird|bohemian\s+rhapsody|somebody\s+to\s+love|gypsy|tide\s+is\s+high)\b/i;

const ANTHEMIC =
  /\b(?:shout|livin'? on a prayer|don'?t\s+stop\s+believin|we\s+will\s+rock\s+you|eye\s+of\s+the\s+tiger|final\s+countdown)\b/i;

const INSTRUMENTAL_DEEP =
  /\b(?:rat\s+salad|intro|outro|interlude|skit|reprise|instrumental|jam|movement)\b/i;

const OFF_MOMENT_ARTISTS =
  /\b(?:pop\s+smoke|warren\s+g|her\b|princess\s+nokia|otis\s+redding|dua\s+lipa|the\s+weeknd)\b/i;

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function artistKey(t: BlindTrackInput): string {
  return norm(t.artistName ?? "");
}

function titleKey(t: BlindTrackInput): string {
  return norm(t.trackName ?? "");
}

function hasEnergy(t: BlindTrackInput): boolean {
  return typeof t.energy === "number" && Number.isFinite(t.energy);
}

function energyOf(t: BlindTrackInput): number | null {
  return hasEnergy(t) ? t.energy! : null;
}

function popOf(t: BlindTrackInput): number {
  const p = t.popularity;
  return typeof p === "number" && Number.isFinite(p) ? p : 50;
}

const GYM_ANTHEM =
  /\b(?:t\.?n\.?t|back in black|welcome to the jungle|iron man|paranoid|fear of the dark|in bloom|highway to hell|you shook me|whole lotta rosie|enter sandman|master of puppets|crazy train|breaking the law|smoke on the water|walk|kickstart my heart|bark at the moon)\b/i;

const BBQ_SINGALONG =
  /\b(?:back in black|sweet home alabama|born to run|don't stop believin|livin'? on a prayer|we will rock you|summer of '69|more than a feeling|carry on wayward|free bird|sweet child|somebody to love)\b/i;

/** Evaluator-side moment interpretation — no generator imports. */
export function interpretPromptMoment(prompt: string): { interpretation: string; activity: string | null } {
  const p = norm(prompt);
  if (/\b(?:motorway|midnight|rain|windscreen)\b/.test(p)) {
    return {
      activity: "motorway_rain",
      interpretation:
        "Late-night motorway driving in rain — reflective, cinematic, forward motion, isolation, headlights, wet road, nocturnal atmosphere.",
    };
  }
  if (/\b(?:bbq|barbecue|beers)\b/.test(p) || /\bdad\s+rock\b/.test(p)) {
    return {
      activity: "bbq",
      interpretation:
        "Outdoor social BBQ with beers — familiar singalong rock, upbeat energy, guitar-driven, communal, not slow epics or ballads.",
    };
  }
  if (/\b(?:gym|workout)\b/.test(p)) {
    return {
      activity: "gym",
      interpretation:
        "Workout session — sustained aggressive energy, momentum, no power ballads or slow emotional songs mid-set.",
    };
  }
  if (/\b(?:country|cowboy|road\s+trip)\b/.test(p)) {
    return {
      activity: "country",
      interpretation:
        "Country road trip — open road, modern and classic country blend, believable variety, not algorithmic artist stacking.",
    };
  }
  if (/\b(?:madchester|baggy)\b/.test(p)) {
    return {
      activity: "madchester",
      interpretation:
        "Madchester pub walk — late-80s/early-90s Manchester baggy scene, Stone Roses/Happy Mondays energy, not default Oasis playlist.",
    };
  }
  if (/\b(?:disco|1978|rooftop)\b/.test(p)) {
    return {
      activity: "disco",
      interpretation:
        "1978 disco rooftop party — danceable four-on-the-floor joy, era-appropriate, coherent party arc, not random genre filler.",
    };
  }
  if (/\b(?:80s|night\s+drive)\b/.test(p)) {
    return {
      activity: "night_drive",
      interpretation:
        "80s night drive — synth-pop/new wave/nocturnal 80s atmosphere, neon motorway mood, not one random edit.",
    };
  }
  return { activity: null, interpretation: `Moment inferred from prompt: "${prompt.trim()}".` };
}

function maxArtistRun(tracks: BlindTrackInput[]): number {
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

function scoreSongFit(t: BlindTrackInput, activity: string | null): number {
  const title = titleKey(t);
  const energy = energyOf(t);
  let score = 0.65;

  if (activity === "gym") {
    if (POWER_BALLAD.test(title)) score -= 0.55;
    else if (GYM_ANTHEM.test(title)) score += 0.2;
    if (energy !== null) {
      if (energy < 0.58 && !GYM_ANTHEM.test(title)) score -= 0.35;
      if (energy >= 0.78) score += 0.15;
    }
  }
  if (activity === "bbq") {
    if (BBQ_SINGALONG.test(title)) score += 0.15;
    else if (/\b(?:gypsy|tide is high)\b/.test(title)) score -= 0.35;
    else if (POWER_BALLAD.test(title) && !BBQ_SINGALONG.test(title)) score -= 0.25;
    if (energy !== null && energy < 0.42 && !BBQ_SINGALONG.test(title)) score -= 0.2;
  }
  if (activity === "motorway_rain") {
    if (ANTHEMIC.test(title)) score -= 0.5;
    if (energy !== null) {
      if (energy > 0.85) score -= 0.35;
      if (energy >= 0.35 && energy <= 0.72) score += 0.12;
    }
  }
  if (activity === "disco") {
    if (OFF_MOMENT_ARTISTS.test(artistKey(t)) || OFF_MOMENT_ARTISTS.test(title)) score -= 0.55;
    if (energy !== null && energy >= 0.55 && energy <= 0.88) score += 0.1;
  }
  if (activity === "madchester") {
    if (artistKey(t).includes("oasis")) score -= 0.08;
    if (artistKey(t).includes("stone roses") || artistKey(t).includes("happy mondays")) score += 0.2;
  }
  if (activity === "night_drive") {
    if (/\b(?:turning\s+japanese|vapors)\b/.test(title) && !/\b(?:new order|depeche|cure|pet shop|simple minds|m83)\b/.test(artistKey(t))) {
      score -= 0.4;
    }
  }
  if (activity === "country") {
    if (/\b(?:cash|combs|bryan|jennings|brooks|pardi|musgraves)\b/.test(artistKey(t))) score += 0.1;
  }
  return Math.max(0, Math.min(1, score));
}

function scorePositionFit(t: BlindTrackInput, position: number, total: number, activity: string | null): number {
  const rel = total > 1 ? position / (total - 1) : 0;
  const title = titleKey(t);
  const energy = energyOf(t);
  const pop = popOf(t) / 100;
  let score = 0.55;

  if (position === 0) {
    score += pop * 0.25;
    if (pop < 0.2 || INSTRUMENTAL_DEEP.test(title)) score -= 0.45;
    if (activity === "gym" && (GYM_ANTHEM.test(title) || (energy !== null && energy >= 0.75))) score += 0.15;
    if (activity === "bbq" && (BBQ_SINGALONG.test(title) || (energy !== null && energy >= 0.6))) score += 0.1;
  }

  if (activity === "gym" && position >= 1 && position < total - 1) {
    if (POWER_BALLAD.test(title)) score -= 0.5;
    else if (energy !== null && energy < 0.55 && !GYM_ANTHEM.test(title)) score -= 0.35;
  }
  if (activity === "motorway_rain" && rel >= 0.75) {
    if (ANTHEMIC.test(title)) score -= 0.55;
    else if (energy !== null && energy > 0.82) score -= 0.35;
  }
  if (activity === "bbq" && position <= 2 && /\b(?:gypsy|tide is high)\b/.test(title)) {
    score -= 0.35;
  }

  return Math.max(0, Math.min(1, score));
}

function classifyDeepCut(t: BlindTrackInput, position: number, activity: string | null): DeepCutVerdict {
  const pop = popOf(t);
  const title = titleKey(t);
  if (pop >= 35) return "NOT_DEEP_CUT";
  if (position === 0 && (pop < 25 || INSTRUMENTAL_DEEP.test(title))) return "BAD_DEEP_CUT";
  if (pop < 30 && activity === "gym" && position === 0) return "BAD_DEEP_CUT";
  if (pop < 35 && position >= 3) return "NEUTRAL_DEEP_CUT";
  return "NEUTRAL_DEEP_CUT";
}

function evaluateTransition(a: BlindTrackInput, b: BlindTrackInput, activity: string | null): BlindTransitionEvaluation {
  const from = `${a.artistName} — ${a.trackName}`;
  const to = `${b.artistName} — ${b.trackName}`;
  const eDrop = (energyOf(a) ?? 0) - (energyOf(b) ?? 0);
  const sameArtist = artistKey(a) === artistKey(b);

  const bEnergy = energyOf(b);
  if (activity === "gym" && POWER_BALLAD.test(titleKey(b))) {
    return {
      fromPosition: 0,
      toPosition: 0,
      from,
      to,
      quality: "JARRING",
      reason: "Mid-workout shift into power ballad breaks momentum.",
    };
  }
  if (activity === "gym" && bEnergy !== null && bEnergy < 0.55 && !GYM_ANTHEM.test(titleKey(b))) {
    return {
      fromPosition: 0,
      toPosition: 0,
      from,
      to,
      quality: "JARRING",
      reason: "Mid-workout shift into low-energy track breaks momentum.",
    };
  }
  if (activity === "motorway_rain" && ANTHEMIC.test(titleKey(b))) {
    return {
      fromPosition: 0,
      toPosition: 0,
      from,
      to,
      quality: "JARRING",
      reason: "Anthemic stadium track breaks nocturnal rain/motorway mood.",
    };
  }
  if (activity === "disco" && OFF_MOMENT_ARTISTS.test(artistKey(b))) {
    return {
      fromPosition: 0,
      toPosition: 0,
      from,
      to,
      quality: "JARRING",
      reason: "Off-era/off-genre artist after disco opener.",
    };
  }
  if (sameArtist) {
    return { fromPosition: 0, toPosition: 0, from, to, quality: "ACCEPTABLE", reason: "Back-to-back same artist — acceptable if intentional." };
  }
  if (energyOf(a) !== null && energyOf(b) !== null && Math.abs(eDrop) > 0.35) {
    return { fromPosition: 0, toPosition: 0, from, to, quality: "WEAK", reason: `Large energy shift (${eDrop.toFixed(2)}).` };
  }
  return { fromPosition: 0, toPosition: 0, from, to, quality: "GOOD", reason: "Reasonable continuation." };
}

function detectCanonicalOmissions(tracks: BlindTrackInput[], activity: string | null): string[] {
  const artists = new Set(tracks.map(artistKey));
  const omissions: string[] = [];
  if (activity === "madchester") {
    if (!artists.has("the stone roses") && ![...artists].some((a) => a.includes("stone roses"))) {
      omissions.push("No Stone Roses — scene spine missing for Madchester.");
    }
    if (![...artists].some((a) => a.includes("happy mondays"))) {
      omissions.push("No Happy Mondays — weak Madchester identity.");
    }
  }
  if (activity === "disco" && tracks.length >= 5) {
    const hasDiscoCore = [...artists].some((a) =>
      /abba|chic|donna summer|bee gees|sister sledge|earth, wind|michael jackson|diana ross|gloria gaynor/.test(a),
    );
    if (!hasDiscoCore) omissions.push("Missing obvious disco vocabulary among delivered tracks.");
  }
  if (activity === "night_drive" && tracks.length <= 2) {
    omissions.push("Structurally insufficient for a night-drive arc (≤2 tracks).");
  }
  return omissions;
}

function classifyCloser(t: BlindTrackInput, activity: string | null): CloserVerdict {
  const title = titleKey(t);
  const energy = energyOf(t);
  if (activity === "motorway_rain" && (ANTHEMIC.test(title) || (energy !== null && energy > 0.82))) return "LEFTOVER";
  if (activity === "gym" && (POWER_BALLAD.test(title) || (energy !== null && energy < 0.55))) return "LEFTOVER";
  if (energy !== null && energy >= 0.45 && energy <= 0.75) return "SATISFYING";
  return "ACCEPTABLE";
}

function classifyOutcomes(input: {
  stub: boolean;
  openerScore: number;
  firstThreeScore: number;
  momentScore: number;
  humanScore: number;
  fillerCount: number;
  jarringCount: number;
  ai: AiObviousness;
  closer: CloserVerdict;
  trackCount: number;
  canonicalOmissionCount: number;
  badDeepCutOpener: boolean;
  avgSongFit: number;
}): Pick<BlindHumanCurationEvaluation, "wouldPressPlay" | "wouldSave" | "wouldShare" | "wouldBelieveHumanMade"> {
  if (input.stub || input.trackCount <= 1) {
    return {
      wouldPressPlay: "NO",
      wouldSave: "NO",
      wouldShare: "NO",
      wouldBelieveHumanMade: "NO",
    };
  }

  const hardFail =
    input.badDeepCutOpener ||
    input.jarringCount >= 2 ||
    input.fillerCount >= 3 ||
    input.canonicalOmissionCount >= 2 ||
    input.avgSongFit < 4.5;

  const wouldPressPlay: BlindVerdict =
    hardFail || input.badDeepCutOpener || input.openerScore < 5
      ? "NO"
      : input.openerScore >= 7 &&
          input.firstThreeScore >= 6 &&
          input.momentScore >= 14 &&
          input.jarringCount <= 1 &&
          input.fillerCount <= 1
        ? "YES"
        : input.momentScore >= 10 && input.jarringCount <= 2
          ? "MAYBE"
          : "NO";

  const wouldBelieveHumanMade: BlindVerdict =
    hardFail || input.ai === "HIGH" || input.canonicalOmissionCount >= 2
      ? "NO"
      : input.humanScore >= 7 &&
          input.fillerCount <= 1 &&
          input.jarringCount <= 1
        ? "YES"
        : input.humanScore >= 5 && input.ai === "LOW" && input.jarringCount <= 2
          ? "MAYBE"
          : "NO";

  const wouldSave: BlindVerdict =
    wouldPressPlay === "NO" ||
    wouldBelieveHumanMade === "NO" ||
    input.fillerCount >= 1 ||
    input.jarringCount >= 1 ||
    input.closer === "LEFTOVER" ||
    input.canonicalOmissionCount >= 1 ||
    input.trackCount < 5 ||
    input.momentScore < 16 ||
    input.humanScore < 8 ||
    input.badDeepCutOpener
      ? "NO"
      : input.openerScore >= 8 &&
          input.firstThreeScore >= 7 &&
          input.momentScore >= 18 &&
          input.humanScore >= 8 &&
          input.ai === "LOW"
        ? "YES"
        : "NO";

  const wouldShare: BlindVerdict =
    wouldSave === "YES" && input.humanScore >= 8 && input.ai === "LOW" && input.jarringCount === 0
      ? "YES"
      : wouldSave === "YES"
        ? "MAYBE"
        : "NO";

  return { wouldPressPlay, wouldSave, wouldShare, wouldBelieveHumanMade };
}

/** Primary blind evaluation entry point. */
export function evaluateBlindHumanCuration(
  prompt: string,
  tracks: BlindTrackInput[],
): BlindHumanCurationEvaluation {
  const { interpretation, activity } = interpretPromptMoment(prompt);
  const explanations: string[] = [];
  const stub = tracks.length <= 1;

  if (tracks.length === 0) {
    return {
      evaluatorVersion: HUMAN_CURATION_EVALUATOR_V17_BLIND,
      prompt,
      momentInterpretation: interpretation,
      activityContext: activity,
      trackCount: 0,
      tracks: [],
      transitions: [],
      dimensions: {
        momentFit: { score: 0, max: 25, evidence: ["Empty playlist."] },
        trackFit: { score: 0, max: 20, evidence: ["No tracks."] },
        opener: { score: 0, max: 10, evidence: ["No opener."] },
        firstThree: { score: 0, max: 10, evidence: ["No tracks."] },
        sequencing: { score: 0, max: 10, evidence: ["No sequence."] },
        transitions: { score: 0, max: 10, evidence: ["No transitions."] },
        humanPlausibility: { score: 0, max: 10, evidence: ["No tracks."] },
      },
      repetitionAnalysis: [],
      canonicalOmissions: [],
      fillerTracks: [],
      deepCutNotes: [],
      closer: { verdict: "LEFTOVER", evidence: ["Empty."] },
      aiObviousness: "HIGH",
      aiObviousnessReasons: ["Empty delivery."],
      wouldPressPlay: "NO",
      wouldSave: "NO",
      wouldShare: "NO",
      wouldBelieveHumanMade: "NO",
      aggregateScore: 0,
      evaluatorConfidence: "HIGH",
      explanations: ["Empty playlist cannot pass human listenability."],
    };
  }

  const trackEvals: BlindTrackEvaluation[] = tracks.map((t, i) => {
    const songFit = scoreSongFit(t, activity);
    const momentFit = scoreSongFit(t, activity);
    const positionFit = scorePositionFit(t, i, tracks.length, activity);
    const promptFit = (songFit + momentFit) / 2;
    const deepCut = classifyDeepCut(t, i, activity);
    const filler =
      songFit < 0.4 ||
      (activity === "disco" && OFF_MOMENT_ARTISTS.test(artistKey(t))) ||
      (deepCut === "BAD_DEEP_CUT");
    const humanPlausibility = filler ? Math.max(0, (promptFit + positionFit) / 2 - 0.25) : (promptFit + positionFit) / 2;
    const contribution = (promptFit + momentFit + positionFit + humanPlausibility) / 4;
    const notes: string[] = [];
    if (filler) notes.push("possible filler");
    if (deepCut === "BAD_DEEP_CUT") notes.push("bad deep cut for slot");
    if (POWER_BALLAD.test(titleKey(t)) && activity === "gym") notes.push("power ballad in workout context");
    return {
      position: i + 1,
      artistName: t.artistName,
      trackName: t.trackName,
      promptFit: Math.round(promptFit * 100) / 10,
      momentFit: Math.round(momentFit * 100) / 10,
      songFit: Math.round(songFit * 100) / 10,
      positionFit: Math.round(positionFit * 100) / 10,
      humanPlausibility: Math.round(humanPlausibility * 100) / 10,
      contribution: Math.round(contribution * 100) / 10,
      deepCut,
      filler,
      notes,
    };
  });

  const transitions: BlindTransitionEvaluation[] = [];
  for (let i = 0; i < tracks.length - 1; i += 1) {
    const tr = evaluateTransition(tracks[i]!, tracks[i + 1]!, activity);
    transitions.push({
      ...tr,
      fromPosition: i + 1,
      toPosition: i + 2,
    });
  }

  const avgMoment = trackEvals.reduce((s, t) => s + t.momentFit, 0) / trackEvals.length;
  const avgTrack = trackEvals.reduce((s, t) => s + t.songFit, 0) / trackEvals.length;
  const openerFit = trackEvals[0]?.positionFit ?? 0;
  const firstThree =
    trackEvals.slice(0, 3).reduce((s, t) => s + t.momentFit + t.positionFit, 0) /
    Math.min(3, trackEvals.length) /
    2;

  const maxRun = maxArtistRun(tracks);
  const repetitionAnalysis: string[] = [];
  if (maxRun >= 3) repetitionAnalysis.push(`${maxRun} consecutive tracks from same artist — algorithmic tell.`);
  else if (maxRun === 2) repetitionAnalysis.push("Some back-to-back same-artist pairs.");
  else repetitionAnalysis.push("No excessive artist clustering.");

  const canonicalOmissions = detectCanonicalOmissions(tracks, activity);
  const fillerTracks = trackEvals.filter((t) => t.filler).map((t) => `#${t.position} ${t.artistName} — ${t.trackName}`);
  const deepCutNotes = trackEvals
    .filter((t) => t.deepCut !== "NOT_DEEP_CUT")
    .map((t) => `#${t.position} ${t.deepCut}: ${t.artistName} — ${t.trackName}`);

  const jarringCount = transitions.filter((t) => t.quality === "JARRING").length;
  const weakCount = transitions.filter((t) => t.quality === "WEAK" || t.quality === "JARRING").length;

  const momentEvidence: string[] = [`Interpretation: ${interpretation}`];
  if (stub) momentEvidence.push("Single-track stub cannot sustain moment arc.");
  if (avgMoment < 5) momentEvidence.push(`Low average moment fit (${avgMoment.toFixed(1)}/10).`);

  const momentScore = Math.round(
    Math.max(
      0,
      Math.min(
        25,
        (avgMoment / 10) * 20 +
          (stub ? 0 : 5) -
          (stub ? 15 : 0) -
          canonicalOmissions.length * 3,
      ),
    ),
  );

  const trackFitScore = Math.round(Math.max(0, Math.min(20, (avgTrack / 10) * 18 - fillerTracks.length * 2)));
  const openerScore = Math.round(Math.max(0, Math.min(10, (openerFit / 10) * 10)));
  const firstThreeScore = Math.round(Math.max(0, Math.min(10, (firstThree / 10) * 10)));
  const sequencingScore = Math.round(Math.max(0, Math.min(10, 10 - maxRun * 2 - (stub ? 5 : 0))));
  const transitionScore = Math.round(Math.max(0, Math.min(10, 10 - jarringCount * 3 - weakCount)));
  const humanPlausScore = Math.round(
    Math.max(0, Math.min(10, 10 - fillerTracks.length * 1.5 - (maxRun >= 3 ? 3 : 0) - jarringCount * 2)),
  );

  const closerTrack = tracks[tracks.length - 1]!;
  const closerVerdict = classifyCloser(closerTrack, activity);
  const closerEvidence = [`Final track: ${closerTrack.artistName} — ${closerTrack.trackName} → ${closerVerdict}`];

  const aiReasons: string[] = [];
  if (maxRun >= 3) aiReasons.push("Excessive artist repetition.");
  if (fillerTracks.length >= 3) aiReasons.push("Multiple filler/off-moment tracks.");
  if (stub) aiReasons.push("Stub playlist.");
  if (activity === "madchester" && canonicalOmissions.length > 0) aiReasons.push("Oasis-default without scene spine.");
  if (trackEvals[0]?.deepCut === "BAD_DEEP_CUT") aiReasons.push("Obscure deep-cut opener.");
  const aiObviousness: AiObviousness =
    aiReasons.length >= 3 || stub ? "HIGH" : aiReasons.length >= 1 ? "MEDIUM" : "LOW";

  const badDeepCutOpener = trackEvals[0]?.deepCut === "BAD_DEEP_CUT";
  const avgSongFit = trackEvals.reduce((s, t) => s + t.songFit, 0) / trackEvals.length;

  const outcomes = classifyOutcomes({
    stub,
    openerScore,
    firstThreeScore,
    momentScore,
    humanScore: humanPlausScore,
    fillerCount: fillerTracks.length,
    jarringCount,
    ai: aiObviousness,
    closer: closerVerdict,
    trackCount: tracks.length,
    canonicalOmissionCount: canonicalOmissions.length,
    badDeepCutOpener,
    avgSongFit,
  });

  const aggregateScore =
    momentScore + trackFitScore + openerScore + firstThreeScore + sequencingScore + transitionScore + humanPlausScore;

  if (outcomes.wouldSave === "NO" && aggregateScore >= 70) {
    explanations.push("Aggregate score exceeds Save bar — Save withheld due to filler/jarring/moment failures.");
  }
  if (fillerTracks.length > 0) explanations.push(`Filler flagged: ${fillerTracks.join("; ")}`);
  if (jarringCount > 0) {
    explanations.push(
      `Jarring transitions: ${transitions.filter((t) => t.quality === "JARRING").map((t) => `${t.fromPosition}→${t.toPosition}`).join(", ")}`,
    );
  }

  return {
    evaluatorVersion: HUMAN_CURATION_EVALUATOR_V17_BLIND,
    prompt,
    momentInterpretation: interpretation,
    activityContext: activity,
    trackCount: tracks.length,
    tracks: trackEvals,
    transitions,
    dimensions: {
      momentFit: { score: momentScore, max: 25, evidence: momentEvidence },
      trackFit: { score: trackFitScore, max: 20, evidence: [`Avg song fit ${avgTrack.toFixed(1)}/10`, `${fillerTracks.length} filler track(s).`] },
      opener: { score: openerScore, max: 10, evidence: [`Opener position fit ${openerFit.toFixed(1)}/10`] },
      firstThree: { score: firstThreeScore, max: 10, evidence: [`First-three establishment ${firstThree.toFixed(1)}/10`] },
      sequencing: { score: sequencingScore, max: 10, evidence: repetitionAnalysis },
      transitions: { score: transitionScore, max: 10, evidence: transitions.map((t) => `${t.fromPosition}→${t.toPosition} ${t.quality}: ${t.reason}`) },
      humanPlausibility: { score: humanPlausScore, max: 10, evidence: [`Filler count ${fillerTracks.length}`, ...repetitionAnalysis] },
    },
    repetitionAnalysis,
    canonicalOmissions,
    fillerTracks,
    deepCutNotes,
    closer: { verdict: closerVerdict, evidence: closerEvidence },
    aiObviousness,
    aiObviousnessReasons: aiReasons,
    ...outcomes,
    aggregateScore,
    evaluatorConfidence: stub ? "HIGH" : tracks.length >= 5 ? "MEDIUM" : "LOW",
    explanations,
  };
}

/** Map human 0–5 anchor to approximate /100 band for calibration comparison only. */
export function humanAnchorToBand(score0to5: number): { min: number; max: number } {
  const bands: Record<number, { min: number; max: number }> = {
    0: { min: 0, max: 25 },
    1: { min: 20, max: 40 },
    2: { min: 35, max: 55 },
    3: { min: 50, max: 70 },
    4: { min: 65, max: 85 },
    5: { min: 80, max: 100 },
  };
  return bands[score0to5] ?? { min: 0, max: 100 };
}
