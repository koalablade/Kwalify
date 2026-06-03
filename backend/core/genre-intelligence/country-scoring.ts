/**
 * Country detection score — separates country from folk / indie acoustic.
 */

import type { TrackGenreClassification } from "../../lib/genre-taxonomy";

const COUNTRY_TEXT_RE =
  /\b(country|honky|nashville|americana|outlaw|red dirt|western swing|bro-?country|texas country|uk country|country pop)\b/i;

const RURAL_RE = /\b(highway|road trip|truck|barn|prairie|ranch|cowboy|cowgirl|pickup|dusty road|small town)\b/i;

const FOLK_INDIE_RE = /\b(folk|indie folk|singer-?songwriter|acoustic session|bedroom folk)\b/i;

export interface CountryScoreInput {
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  danceability: number | null;
  speechiness: number | null;
  tempo: number | null;
}

export interface CountryScoreBreakdown {
  total: number;
  storytelling: number;
  acousticGuitar: number;
  ruralImagery: number;
  twangFeatures: number;
  bpmFit: number;
  folkPenalty: number;
  indiePenalty: number;
}

export function computeCountryScore(track: CountryScoreInput): CountryScoreBreakdown {
  const blob = `${track.trackName} ${track.artistName} ${track.albumName}`;
  const a = track.acousticness ?? 0.5;
  const e = track.energy ?? 0.5;
  const d = track.danceability ?? 0.5;
  const sp = track.speechiness ?? 0.2;
  const tempo = track.tempo ?? 110;

  let storytelling = 0;
  if (COUNTRY_TEXT_RE.test(blob)) storytelling += 0.45;
  if (sp > 0.22 && sp < 0.42) storytelling += 0.12;

  let acousticGuitar = 0;
  if (a > 0.45 && a < 0.92) acousticGuitar += 0.35;
  if (e > 0.3 && e < 0.72) acousticGuitar += 0.1;

  let ruralImagery = RURAL_RE.test(blob) ? 0.4 : 0;
  if (/\b(story|stories|heartland|dust|gravel|whiskey|beer|neon diner)\b/i.test(blob)) {
    ruralImagery += 0.15;
  }

  let twangFeatures = 0;
  if (a > 0.5 && d < 0.68 && sp < 0.35) twangFeatures += 0.25;
  if (/\b(twang|steel guitar|banjo|fiddle|pedal steel)\b/i.test(blob)) twangFeatures += 0.35;

  let bpmFit = 0;
  if (tempo >= 80 && tempo <= 140) bpmFit += 0.3;
  else if (tempo >= 70 && tempo <= 155) bpmFit += 0.12;

  let folkPenalty = FOLK_INDIE_RE.test(blob) && !COUNTRY_TEXT_RE.test(blob) ? 0.35 : 0;
  let indiePenalty =
    /\b(indie|lo-?fi|bedroom|dream pop)\b/i.test(blob) && !COUNTRY_TEXT_RE.test(blob) ? 0.28 : 0;

  const total = Math.max(
    0,
    Math.min(
      1,
      storytelling + acousticGuitar + ruralImagery + twangFeatures + bpmFit - folkPenalty - indiePenalty
    )
  );

  return {
    total,
    storytelling,
    acousticGuitar,
    ruralImagery,
    twangFeatures,
    bpmFit,
    folkPenalty,
    indiePenalty,
  };
}

export function applyCountryClassificationBias(
  classification: TrackGenreClassification,
  track: CountryScoreInput
): TrackGenreClassification {
  const cs = computeCountryScore(track);
  if (cs.total < 0.42) return classification;
  if (classification.genreFamily === "country" && classification.confidenceScore >= 0.55) {
    return {
      ...classification,
      confidenceScore: Math.min(1, classification.confidenceScore + cs.total * 0.15),
    };
  }
  if (
    cs.total >= 0.55 &&
    (classification.genreFamily === "folk" ||
      classification.genreFamily === "indie" ||
      classification.confidenceScore < 0.5)
  ) {
    return {
      ...classification,
      genrePrimary: "country",
      genreFamily: "country",
      primarySubgenre: classification.primarySubgenre.includes("country")
        ? classification.primarySubgenre
        : "folk_country",
      subGenres: [...new Set(["folk_country", ...classification.subGenres])],
      confidenceScore: Math.max(classification.confidenceScore, cs.total * 0.92),
      holidayBound: false,
    };
  }
  if (cs.total >= 0.48 && classification.genreFamily === "folk") {
    return {
      ...classification,
      genreSecondary: "country",
      confidenceScore: Math.max(classification.confidenceScore, cs.total * 0.75),
    };
  }
  return classification;
}
