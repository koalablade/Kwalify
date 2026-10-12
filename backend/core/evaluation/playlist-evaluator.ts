import {
  estimateHumanPlaylistBenchmark,
  type BenchmarkTrack,
  type HumanPlaylistBenchmark,
} from "./human-benchmark";

export type EvaluationTrack = BenchmarkTrack & {
  id?: string;
  name?: string;
  artist?: string;
  albumName?: string | null;
  durationMs?: number | null;
  moodTags?: string[] | null;
};

export type PlaylistEvaluationInput = {
  prompt: string;
  tracks: EvaluationTrack[];
  expectedTrackCount?: number;
  metadata: {
    genres: string[];
    eras: number[];
    moods: string[];
  };
};

export type PlaylistEvaluationReport = {
  overallScore: number;
  humanLikelihoodScore: number;
  emotionalCoherence: number;
  genreConsistency: number;
  eraConsistency: number;
  intentMatch: number;
  playlistFlow: number;
  completenessScore: number;
  critique: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
  };
  mismatchAnalysis: {
    genreOutliers: EvaluationTrack[];
    eraOutliers: EvaluationTrack[];
    moodBreaks: EvaluationTrack[];
    sequencingIssues: string[];
  };
  humanSimulation: {
    what_a_human_would_do_differently: string[];
    expected_playlist_shape: string;
    human_vs_model_gap: string;
  };
  humanBenchmark: HumanPlaylistBenchmark;
  failureClassification: string[];
  report: {
    humanScoreSummary: string;
    emotionalArcAnalysis: string;
    genreRealism: string;
    eraRealism: string;
    intentMatching: string;
    humanVsModelGap: string;
    suggestedImprovements: string[];
  };
};

type MoodPoint = {
  label: "low" | "reflective" | "steady" | "hopeful" | "energised";
  energy: number;
  valence: number;
};

const GENRE_FAMILIES: Record<string, string[]> = {
  rock: ["rock", "alternative", "indie", "punk", "post_rock", "blues"],
  electronic: ["electronic", "ambient", "techno", "house", "dance", "synthwave", "dream_pop"],
  hip_hop: ["hip_hop", "rap", "grime", "trap", "rnb"],
  cinematic: ["ambient", "post_rock", "soundtrack", "classical", "instrumental"],
  roots: ["folk", "americana", "country", "blues", "soul"],
  global: ["world", "latin", "afrobeat", "reggae", "folk"],
};

const PROMPT_GENRE_TERMS: Array<{ pattern: RegExp; genres: string[] }> = [
  { pattern: /\b(?:indie|alternative|alt)\b/i, genres: ["indie", "alternative", "rock"] },
  { pattern: /\b(?:electronic|ambient|synth|synthwave|techno|house|dance)\b/i, genres: ["electronic", "ambient"] },
  { pattern: /\b(?:hip\s*hop|rap|grime|trap)\b/i, genres: ["hip_hop", "rap"] },
  { pattern: /\b(?:post-?rock|cinematic|soundtrack|score)\b/i, genres: ["post_rock", "ambient", "soundtrack"] },
  { pattern: /\b(?:folk|acoustic|americana)\b/i, genres: ["folk", "americana"] },
  { pattern: /\b(?:dream\s*pop|shoegaze)\b/i, genres: ["dream_pop", "indie"] },
  { pattern: /\b(?:blues)\b/i, genres: ["blues", "rock"] },
  { pattern: /\b(?:rock)\b/i, genres: ["rock", "alternative"] },
  { pattern: /\b(?:world|global|around the world|international)\b/i, genres: ["world", "global", "latin", "afrobeat"] },
];

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function average(values: number[], fallback = 0): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeTerm(value: string): string {
  return value.toLowerCase().trim().replace(/&/g, "and").replace(/[\s-]+/g, "_");
}

function trackName(track: EvaluationTrack): string {
  return track.trackName ?? track.name ?? "Unknown track";
}

function artistName(track: EvaluationTrack): string {
  return track.artistName ?? track.artist ?? "Unknown artist";
}

function trackGenres(track: EvaluationTrack): string[] {
  return uniq([
    track.genrePrimary ?? "",
    track.genreFamily ?? "",
    ...(Array.isArray(track.genres) ? track.genres : []),
  ].map(normalizeTerm));
}

function expectedGenresForPrompt(prompt: string, metadataGenres: string[]): string[] {
  const fromPrompt = PROMPT_GENRE_TERMS.flatMap((entry) => entry.pattern.test(prompt) ? entry.genres : []);
  return uniq([...fromPrompt, ...metadataGenres.slice(0, 4).map(normalizeTerm)]);
}

function genreCompatible(a: string, b: string): boolean {
  if (!a || !b || a === b || a.includes(b) || b.includes(a)) return true;
  return Object.values(GENRE_FAMILIES).some((family) => family.includes(a) && family.includes(b));
}

function moodPoint(track: EvaluationTrack): MoodPoint {
  const energy = typeof track.energy === "number" ? track.energy : 0.5;
  const valence = typeof track.valence === "number" ? track.valence : 0.5;
  const label =
    valence < 0.34 && energy < 0.58 ? "low" :
    valence < 0.48 ? "reflective" :
    valence > 0.62 && energy > 0.62 ? "energised" :
    valence > 0.56 ? "hopeful" :
    "steady";
  return { label, energy, valence };
}

function expectedArcKind(prompt: string): "rising" | "steady" | "bittersweet" | "high_energy" {
  const lower = prompt.toLowerCase();
  if (/\b(?:gym|workout|build intensity|intensity throughout)\b/.test(lower)) return "high_energy";
  if (/\b(?:sad and hopeful|both sad and hopeful|bittersweet)\b/.test(lower)) return "bittersweet";
  if (/\b(?:starts?|begin|gradually|transition|ends?|rebuilding|move through|surviving|relief)\b/.test(lower)) return "rising";
  return "steady";
}

function scoreEmotionalCoherence(tracks: EvaluationTrack[], prompt: string): {
  score: number;
  moodBreaks: EvaluationTrack[];
  sequencingIssues: string[];
  beginning: string;
  midpoint: string;
  ending: string;
} {
  if (tracks.length === 0) {
    return { score: 0, moodBreaks: [], sequencingIssues: ["Playlist is empty."], beginning: "unknown", midpoint: "unknown", ending: "unknown" };
  }
  const points = tracks.map(moodPoint);
  const jumps = points.slice(1).map((point, index) =>
    Math.abs(point.energy - points[index]!.energy) + Math.abs(point.valence - points[index]!.valence)
  );
  const largeJumpIndexes = jumps
    .map((jump, index) => ({ jump, index: index + 1 }))
    .filter(({ jump }) => jump > 0.78);
  const arc = expectedArcKind(prompt);
  const firstThird = points.slice(0, Math.max(1, Math.ceil(points.length / 3)));
  const finalThird = points.slice(Math.max(0, points.length - Math.ceil(points.length / 3)));
  const startValence = average(firstThird.map((point) => point.valence), 0.5);
  const endValence = average(finalThird.map((point) => point.valence), 0.5);
  const startEnergy = average(firstThird.map((point) => point.energy), 0.5);
  const endEnergy = average(finalThird.map((point) => point.energy), 0.5);
  const risingArcOk = arc !== "rising" || (endValence >= startValence - 0.03 && endEnergy >= startEnergy - 0.08);
  const highEnergyOk = arc !== "high_energy" || endEnergy >= startEnergy - 0.02;
  const bittersweetOk = arc !== "bittersweet" || points.filter((point) => point.label === "reflective" || point.label === "hopeful").length >= Math.ceil(points.length * 0.45);
  const jumpPenalty = Math.min(32, largeJumpIndexes.length * 8 + average(jumps, 0) * 22);
  const arcPenalty = (risingArcOk ? 0 : 24) + (highEnergyOk ? 0 : 18) + (bittersweetOk ? 0 : 16);
  const moodBreaks = largeJumpIndexes.slice(0, 6).map(({ index }) => tracks[index]!).filter(Boolean);
  const sequencingIssues = [
    largeJumpIndexes.length > 0 ? `${largeJumpIndexes.length} abrupt emotional transition(s) detected.` : null,
    risingArcOk ? null : "Prompt implies emotional lift, but the ending does not feel more resolved than the beginning.",
    highEnergyOk ? null : "Workout/intensity prompt does not build or sustain energy clearly.",
    bittersweetOk ? null : "Bittersweet prompt needs more reflective-to-hopeful balance.",
  ].filter((value): value is string => !!value);
  const midpoint = points[Math.floor(points.length / 2)]?.label ?? "unknown";
  return {
    score: clampScore(100 - jumpPenalty - arcPenalty),
    moodBreaks,
    sequencingIssues,
    beginning: points[0]?.label ?? "unknown",
    midpoint,
    ending: points.at(-1)?.label ?? "unknown",
  };
}

function scoreGenreConsistency(
  tracks: EvaluationTrack[],
  expectedGenres: string[],
  opts: { allowControlledDiversity: boolean } = { allowControlledDiversity: false }
): {
  score: number;
  outliers: EvaluationTrack[];
  realism: "coherent" | "semi-coherent" | "incoherent";
} {
  if (tracks.length === 0) return { score: 0, outliers: [], realism: "incoherent" };
  const primaryByTrack = tracks.map((track) => trackGenres(track)[0] ?? "unknown");
  const known = primaryByTrack.filter((genre) => genre !== "unknown");
  const counts = new Map<string, number>();
  for (const genre of known) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  const expected = expectedGenres.map(normalizeTerm);
  const outliers = tracks.filter((track) => {
    const genres = trackGenres(track);
    if (genres.length === 0) return false;
    if (expected.length > 0 && genres.some((genre) => expected.some((exp) => genreCompatible(genre, exp)))) return false;
    return dominant !== "unknown" && !genres.some((genre) => genreCompatible(genre, dominant));
  });
  const diversity = known.length ? counts.size / known.length : 0.5;
  const outlierRatio = outliers.length / tracks.length;
  const expectedHitRatio = expected.length === 0 ? 0.75 : tracks.filter((track) =>
    trackGenres(track).some((genre) => expected.some((exp) => genreCompatible(genre, exp)))
  ).length / tracks.length;
  const diversityAllowance = opts.allowControlledDiversity ? 0.52 : 0.34;
  const outlierPenalty = opts.allowControlledDiversity ? 38 : 55;
  const score = clampScore(92 - outlierRatio * outlierPenalty - Math.max(0, diversity - diversityAllowance) * 50 + (expectedHitRatio - 0.65) * 24);
  return {
    score,
    outliers: outliers.slice(0, 8),
    realism: score >= 78 ? "coherent" : score >= 55 ? "semi-coherent" : "incoherent",
  };
}

function scoreEraConsistency(tracks: EvaluationTrack[], prompt: string): {
  score: number;
  outliers: EvaluationTrack[];
  realism: "natural" | "forced" | "randomised";
} {
  const known = tracks.filter((track) => typeof track.releaseYear === "number");
  if (tracks.length === 0) return { score: 0, outliers: [], realism: "randomised" };
  if (known.length < Math.ceil(tracks.length * 0.35)) return { score: 68, outliers: [], realism: "natural" };
  const years = known.map((track) => track.releaseYear!);
  const min = Math.min(...years);
  const max = Math.max(...years);
  const span = max - min;
  const lower = prompt.toLowerCase();
  const eraPrompted = /\b(?:1970s|1980s|1990s|2000s|2010s|2020s|70s|80s|90s|modern|classic|old)\b/.test(lower);
  const median = [...years].sort((a, b) => a - b)[Math.floor(years.length / 2)]!;
  const outliers = known.filter((track) => Math.abs(track.releaseYear! - median) > 22 && !eraPrompted);
  const score = clampScore(eraPrompted
    ? 84 - Math.max(0, span - 24) * 0.8
    : 88 - Math.max(0, span - 32) * 0.9 - outliers.length * 3);
  return {
    score,
    outliers: outliers.slice(0, 8),
    realism: score >= 76 ? "natural" : score >= 55 ? "forced" : "randomised",
  };
}

function scoreIntentMatch(tracks: EvaluationTrack[], expectedGenres: string[], prompt: string, benchmark: HumanPlaylistBenchmark): number {
  if (tracks.length === 0) return 0;
  const expected = expectedGenres.map(normalizeTerm);
  const genreScore = expected.length === 0 ? 72 : tracks.filter((track) =>
    trackGenres(track).some((genre) => expected.some((exp) => genreCompatible(genre, exp)))
  ).length / tracks.length * 100;
  const lower = prompt.toLowerCase();
  const wantsDiscovery = /\b(?:hidden gems|deep cuts|probably don't know|avoid obvious|discovery)\b/.test(lower);
  const discoveryBonus = wantsDiscovery ? 4 : 0;
  return clampScore(genreScore * 0.62 + benchmark.deviationScore * 0.34 + discoveryBonus);
}

function scorePlaylistFlow(tracks: EvaluationTrack[], emotionalScore: number): number {
  if (tracks.length <= 1) return tracks.length === 1 ? 45 : 0;
  const points = tracks.map(moodPoint);
  const energyJumps = points.slice(1).map((point, index) => Math.abs(point.energy - points[index]!.energy));
  const valenceJumps = points.slice(1).map((point, index) => Math.abs(point.valence - points[index]!.valence));
  return clampScore(emotionalScore * 0.58 + (100 - average(energyJumps, 0) * 95 - average(valenceJumps, 0) * 70) * 0.42);
}

function humanSummary(score: number): string {
  return score >= 78 ? "yes" : score >= 58 ? "partial" : "no";
}

function summarizeTrack(track: EvaluationTrack): EvaluationTrack {
  return {
    trackId: track.trackId ?? track.id,
    trackName: trackName(track),
    artistName: artistName(track),
    genrePrimary: track.genrePrimary ?? null,
    genreFamily: track.genreFamily ?? null,
    genres: Array.isArray(track.genres) ? track.genres.slice(0, 6) : null,
    releaseYear: track.releaseYear ?? null,
    energy: track.energy ?? null,
    valence: track.valence ?? null,
  };
}

export function evaluatePlaylist(input: PlaylistEvaluationInput): PlaylistEvaluationReport {
  const tracks = input.tracks;
  const expectedTrackCount = Math.max(1, input.expectedTrackCount ?? tracks.length);
  const completenessScore = Math.max(0, Math.min(1, tracks.length / expectedTrackCount));
  const incomplete = tracks.length < expectedTrackCount;
  const severeUnderfill = tracks.length < expectedTrackCount * 0.7;
  const expectedGenres = expectedGenresForPrompt(input.prompt, input.metadata.genres);
  const humanBenchmark = estimateHumanPlaylistBenchmark(input.prompt, tracks);
  const emotional = scoreEmotionalCoherence(tracks, input.prompt);
  const allowControlledDiversity = /\b(?:mix|eclectic|genreless|varied|variety|diverse)\b/i.test(input.prompt);
  const genre = scoreGenreConsistency(
    tracks,
    expectedGenres.length ? expectedGenres : humanBenchmark.expectedGenres,
    { allowControlledDiversity }
  );
  const era = scoreEraConsistency(tracks, input.prompt);
  const rawIntentMatch = scoreIntentMatch(tracks, expectedGenres.length ? expectedGenres : humanBenchmark.expectedGenres, input.prompt, humanBenchmark);
  const playlistFlow = scorePlaylistFlow(tracks, emotional.score);
  const completenessPenalty = severeUnderfill
    ? 42
    : incomplete
      ? Math.min(28, (1 - completenessScore) * 55)
      : 0;
  const intentMatch = clampScore(rawIntentMatch - (severeUnderfill ? 24 : incomplete ? Math.min(16, (1 - completenessScore) * 35) : 0));
  const humanLikelihoodScore = clampScore(
    emotional.score * 0.24 +
    genre.score * 0.22 +
    era.score * 0.13 +
    intentMatch * 0.24 +
    playlistFlow * 0.17 -
    completenessPenalty
  );
  const overallScore = clampScore(
    humanLikelihoodScore * 0.45 +
    emotional.score * 0.18 +
    genre.score * 0.15 +
    intentMatch * 0.15 +
    playlistFlow * 0.07 -
    completenessPenalty * 0.8
  );
  const weaknesses = [
    incomplete ? `Playlist is incomplete: ${tracks.length}/${expectedTrackCount} tracks returned.` : null,
    emotional.score < 65 ? "The emotional arc has abrupt transitions or does not resolve naturally." : null,
    genre.score < 65 ? "Genre spread feels wider than a human editor would usually allow." : null,
    era.score < 62 ? "Era choices risk feeling random rather than intentionally blended." : null,
    intentMatch < 65 ? "The playlist reflects the prompt only partially or superficially." : null,
    playlistFlow < 65 ? "Sequencing may feel more algorithmic than curated." : null,
  ].filter((value): value is string => !!value);
  const strengths = [
    !incomplete ? "Playlist satisfies requested track count." : null,
    emotional.score >= 75 ? "Emotional movement is believable for the prompt." : null,
    genre.score >= 75 ? "Genres sit in a coherent musical universe." : null,
    era.score >= 75 ? "Era spread feels intentional." : null,
    intentMatch >= 75 ? "Track metadata broadly matches the requested intent." : null,
    playlistFlow >= 75 ? "Flow between tracks looks smooth from audio metadata." : null,
  ].filter((value): value is string => !!value);
  const suggestedImprovements = [
    incomplete ? "repair incomplete playlist before judging quality" : null,
    genre.score < 70 ? "reduce genre diversity" : null,
    emotional.score < 70 ? "increase emotional continuity" : null,
    genre.outliers.length > 0 || era.outliers.length > 0 ? "remove outliers" : null,
    playlistFlow < 70 ? "improve sequencing logic" : null,
    intentMatch < 70 ? "tighten retrieval around the prompt's core identity" : null,
  ].filter((value): value is string => !!value);
  const failureClassification = [
    incomplete ? "INCOMPLETE_PLAYLIST_FAILURE" : null,
    intentMatch < 55 && genre.outliers.length >= Math.ceil(tracks.length * 0.20) ? "retrieval mismatch" : null,
    emotional.score < 62 ? "emotional arc failure" : null,
    genre.score < 62 ? "genre incoherence" : null,
    era.score < 62 ? "era mismatch" : null,
    playlistFlow < 62 ? "sequencing unnaturalness" : null,
    humanLikelihoodScore < 58 && weaknesses.length >= 3 ? "over-algorithmic behaviour" : null,
  ].filter((value): value is string => !!value);
  const humanFixes = suggestedImprovements.length
    ? suggestedImprovements
    : ["preserve current shape; only make small sequencing or outlier checks"];

  return {
    overallScore,
    humanLikelihoodScore,
    emotionalCoherence: emotional.score,
    genreConsistency: genre.score,
    eraConsistency: era.score,
    intentMatch,
    playlistFlow,
    completenessScore: Math.round(completenessScore * 100) / 100,
    critique: {
      summary: `Human-likelihood assessment: ${humanSummary(humanLikelihoodScore)} (${humanLikelihoodScore}/100).`,
      strengths: strengths.length ? strengths : ["The playlist has enough usable metadata to evaluate its shape."],
      weaknesses: weaknesses.length ? weaknesses : ["No major quality gap detected by the heuristic evaluator."],
    },
    mismatchAnalysis: {
      genreOutliers: genre.outliers.map(summarizeTrack),
      eraOutliers: era.outliers.map(summarizeTrack),
      moodBreaks: emotional.moodBreaks.map(summarizeTrack),
      sequencingIssues: emotional.sequencingIssues,
    },
    humanSimulation: {
      what_a_human_would_do_differently: humanFixes,
      expected_playlist_shape: `Expected shape: ${humanBenchmark.expectedMoodArc}; genres: ${humanBenchmark.expectedGenres.join(", ") || "prompt-led but flexible"}; era: ${humanBenchmark.expectedEraDistribution}.`,
      human_vs_model_gap: humanBenchmark.biggestDeviations.length
        ? humanBenchmark.biggestDeviations.join(" ")
        : "The model output is close to the expected human playlist shape by metadata heuristics.",
    },
    humanBenchmark,
    failureClassification,
    report: {
      humanScoreSummary: `Would a human like this? ${humanSummary(humanLikelihoodScore)}. Score ${humanLikelihoodScore}/100.`,
      emotionalArcAnalysis: `Beginning emotion: ${emotional.beginning}. Midpoint emotion: ${emotional.midpoint}. Ending emotion: ${emotional.ending}. Flow quality: ${emotional.score >= 75 ? "strong" : emotional.score >= 55 ? "mixed" : "weak"}. Completeness: ${tracks.length}/${expectedTrackCount}.`,
      genreRealism: `${genre.realism}. ${genre.outliers.length ? `${genre.outliers.length} likely genre outlier(s) detected.` : "No obvious genre outliers detected."}`,
      eraRealism: `${era.realism}. ${era.outliers.length ? `${era.outliers.length} likely era outlier(s) detected.` : "Era blend looks acceptable for the prompt."}`,
      intentMatching: `${intentMatch >= 75 ? "direct match" : intentMatch >= 55 ? "partial" : "failed interpretation"}.`,
      humanVsModelGap: humanBenchmark.biggestDeviations.length
        ? humanBenchmark.biggestDeviations.join(" ")
        : "No major human-vs-model gap detected.",
      suggestedImprovements: suggestedImprovements.length ? suggestedImprovements : ["no major suggested improvements"],
    },
  };
}
