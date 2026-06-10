import type { TrackGenreClassification } from "../lib/genre-taxonomy";
import type { UserGenreProfile } from "../lib/user-genre-profile";
import { eraEvidenceStatusForRange, type EraEvidenceStatus, type EraRange } from "../lib/era-evidence";

type PersonalIntent = {
  genreFamilies: string[];
  eraRange: EraRange | null;
  mood: string[];
  activity: string | null;
  energy: "low" | "medium" | "high" | null;
};

export type PersonalCompilerTrack = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  score?: number | null;
  rediscoveryScore?: number | null;
  releaseYear?: number | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  tempo: number | null;
};

export type PersonalCompilerDiagnostics = {
  architecture: "personal_playlist_compiler_v1";
  selectedCount: number;
  inputCandidateCount: number;
  rankedCandidateCount: number;
  rejectedMustCount: number;
  quality: {
    promptFit: number;
    tasteFit: number;
    evidenceConfidence: number;
    saveLikelihood: number;
  };
  tasteModel: {
    dominantGenres: string[];
    artistAffinityCount: number;
  };
  scoringWeights: Record<string, number>;
  roleDistribution: Record<string, number>;
  topRejectedReasons: Record<string, number>;
};

type RankedCandidate<T extends PersonalCompilerTrack> = {
  track: T;
  score: number;
  promptFit: number;
  tasteFit: number;
  playlistRoleFit: number;
  evidenceConfidence: number;
  freshnessDiversity: number;
  discoveryValue: number;
  role: PlaylistRole;
  rejectedReason: string | null;
};

type PlaylistRole = "anchor" | "core" | "bridge" | "deep_cut" | "discovery" | "closer";

const WEIGHTS = {
  promptFit: 0.30,
  tasteFit: 0.30,
  playlistRoleFit: 0.15,
  evidenceConfidence: 0.10,
  freshnessDiversity: 0.10,
  discoveryValue: 0.05,
} as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function uniqueByTrackId<T extends PersonalCompilerTrack>(tracks: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const track of tracks) {
    if (seen.has(track.trackId)) continue;
    seen.add(track.trackId);
    out.push(track);
  }
  return out;
}

function classificationForTrack(
  track: PersonalCompilerTrack,
  classMap: UserGenreProfile["trackClassifications"],
): TrackGenreClassification | undefined {
  return classMap.get(track.trackId);
}

function genreFamilyForTrack(
  track: PersonalCompilerTrack,
  classMap: UserGenreProfile["trackClassifications"],
): string | null {
  const classification = classificationForTrack(track, classMap);
  return (
    track.genreFamily ??
    classification?.genreFamily ??
    classification?.genrePrimary ??
    track.genrePrimary ??
    null
  );
}

function genreEvidence(
  track: PersonalCompilerTrack,
  intent: PersonalIntent,
  classMap: UserGenreProfile["trackClassifications"],
): "match" | "mismatch" | "unknown" {
  if (intent.genreFamilies.length === 0) return "match";
  const family = genreFamilyForTrack(track, classMap);
  if (!family || family === "unknown") return "unknown";
  return intent.genreFamilies.includes(family) ? "match" : "mismatch";
}

function eraEvidence(track: PersonalCompilerTrack, range: EraRange | null): EraEvidenceStatus {
  if (!range) return "match";
  return eraEvidenceStatusForRange(track, range);
}

function moodFit(track: PersonalCompilerTrack, intent: PersonalIntent): number {
  if (intent.mood.length === 0) return 0.72;
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const acousticness = track.acousticness ?? 0.45;
  const fits = intent.mood.map((mood) => {
    switch (mood) {
      case "melancholic":
        return clamp01((1 - valence) * 0.70 + (1 - energy) * 0.30);
      case "calm":
        return clamp01((1 - energy) * 0.55 + acousticness * 0.45);
      case "nostalgic":
        return clamp01(acousticness * 0.45 + (track.releaseYear ? (2029 - track.releaseYear) / 70 : 0.35));
      case "warm":
        return clamp01(valence * 0.45 + acousticness * 0.35 + 0.20);
      case "energised":
        return clamp01(energy * 0.75 + (track.tempo != null && track.tempo >= 115 ? 0.25 : 0));
      default:
        return 0.65;
    }
  });
  return fits.reduce((sum, fit) => sum + fit, 0) / Math.max(1, fits.length);
}

function activityFit(track: PersonalCompilerTrack, intent: PersonalIntent): number {
  if (!intent.activity) return 0.72;
  const energy = track.energy ?? 0.5;
  const tempo = track.tempo ?? 110;
  const danceability = track.danceability ?? 0.5;
  const acousticness = track.acousticness ?? 0.45;
  switch (intent.activity) {
    case "driving":
      return clamp01((energy >= 0.30 && energy <= 0.84 ? 0.55 : 0.25) + (tempo >= 75 ? 0.25 : 0) + 0.20);
    case "gym":
      return clamp01(energy * 0.65 + (tempo >= 120 ? 0.25 : 0) + danceability * 0.10);
    case "focus":
      return clamp01((1 - Math.abs(energy - 0.48)) * 0.45 + (1 - danceability) * 0.25 + acousticness * 0.30);
    case "party":
      return clamp01(energy * 0.45 + danceability * 0.45 + 0.10);
    case "relaxing":
      return clamp01((1 - energy) * 0.55 + acousticness * 0.45);
    default:
      return 0.65;
  }
}

function promptFit(
  track: PersonalCompilerTrack,
  intent: PersonalIntent,
  classMap: UserGenreProfile["trackClassifications"],
): { value: number; rejectedReason: string | null; evidenceConfidence: number } {
  const genre = genreEvidence(track, intent, classMap);
  const era = eraEvidence(track, intent.eraRange);
  if (genre === "mismatch") return { value: 0, rejectedReason: "genre_must_mismatch", evidenceConfidence: 0.9 };
  if (era === "mismatch") return { value: 0, rejectedReason: "era_must_mismatch", evidenceConfidence: 0.9 };

  const genreFit = intent.genreFamilies.length === 0 ? 0.74 : genre === "match" ? 1 : 0.42;
  const eraFit = !intent.eraRange ? 0.74 : era === "match" ? 1 : 0.32;
  const mood = moodFit(track, intent);
  const activity = activityFit(track, intent);
  const explicitParts = [
    intent.genreFamilies.length > 0 ? genreFit : null,
    intent.eraRange ? eraFit : null,
  ].filter((value): value is number => value !== null);
  const softParts = [mood, activity];
  const explicitFit = explicitParts.length > 0
    ? explicitParts.reduce((sum, value) => sum + value, 0) / explicitParts.length
    : 0.72;
  const softFit = softParts.reduce((sum, value) => sum + value, 0) / softParts.length;
  const evidenceConfidence = clamp01(
    0.35 +
      (genre === "match" ? 0.22 : genre === "unknown" ? 0.06 : 0) +
      (era === "match" ? 0.22 : era === "unknown" ? 0.06 : 0) +
      (typeof track.score === "number" ? 0.10 : 0) +
      (track.energy != null || track.valence != null ? 0.11 : 0),
  );
  return {
    value: clamp01(explicitFit * 0.72 + softFit * 0.28),
    rejectedReason: null,
    evidenceConfidence,
  };
}

function buildArtistAffinity<T extends PersonalCompilerTrack>(tracks: T[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    counts.set(track.artistName, (counts.get(track.artistName) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  return new Map([...counts.entries()].map(([artist, count]) => [artist, count / max]));
}

function tasteFit<T extends PersonalCompilerTrack>(
  track: T,
  userGenreProfile: UserGenreProfile,
  artistAffinity: Map<string, number>,
  classMap: UserGenreProfile["trackClassifications"],
): number {
  const family = genreFamilyForTrack(track, classMap);
  const genreTaste = family ? (userGenreProfile.vector[family as keyof typeof userGenreProfile.vector] ?? 0.04) : 0.04;
  const artistTaste = artistAffinity.get(track.artistName) ?? 0.08;
  const existingScore = typeof track.score === "number" ? clamp01(track.score) : 0.50;
  return clamp01(genreTaste * 1.8 + artistTaste * 0.35 + existingScore * 0.45);
}

function playlistRoleFor<T extends PersonalCompilerTrack>(
  track: T,
  index: number,
  prompt: number,
  taste: number,
  evidenceConfidence: number,
): PlaylistRole {
  if (index === 0 || (prompt >= 0.86 && taste >= 0.55 && evidenceConfidence >= 0.65)) return "anchor";
  if ((track.rediscoveryScore ?? 0.5) <= 0.38 && evidenceConfidence >= 0.45) return "deep_cut";
  if (prompt >= 0.72 && taste < 0.38) return "discovery";
  if (prompt >= 0.55 && taste >= 0.45) return "core";
  return "bridge";
}

function playlistRoleFit(role: PlaylistRole): number {
  switch (role) {
    case "anchor":
      return 0.95;
    case "core":
      return 0.84;
    case "deep_cut":
      return 0.78;
    case "bridge":
      return 0.68;
    case "discovery":
      return 0.64;
    case "closer":
      return 0.74;
  }
}

function freshnessDiversity(track: PersonalCompilerTrack, artistCounts: Map<string, number>): number {
  const count = artistCounts.get(track.artistName) ?? 0;
  return count === 0 ? 1 : count === 1 ? 0.72 : 0.32;
}

function discoveryValue(track: PersonalCompilerTrack): number {
  const rediscovery = typeof track.rediscoveryScore === "number" ? 1 - clamp01(track.rediscoveryScore) : 0.35;
  const obscurity = typeof track.score === "number" ? 1 - Math.min(1, Math.max(0, track.score)) : 0.40;
  return clamp01(rediscovery * 0.65 + obscurity * 0.35);
}

function rankCandidate<T extends PersonalCompilerTrack>(
  track: T,
  index: number,
  intent: PersonalIntent,
  userGenreProfile: UserGenreProfile,
  artistAffinity: Map<string, number>,
  selectedArtistCounts: Map<string, number>,
): RankedCandidate<T> {
  const classMap = userGenreProfile.trackClassifications;
  const prompt = promptFit(track, intent, classMap);
  const taste = tasteFit(track, userGenreProfile, artistAffinity, classMap);
  const role = playlistRoleFor(track, index, prompt.value, taste, prompt.evidenceConfidence);
  const roleFit = playlistRoleFit(role);
  const freshness = freshnessDiversity(track, selectedArtistCounts);
  const discovery = discoveryValue(track);
  const score = prompt.rejectedReason
    ? 0
    : clamp01(
        prompt.value * WEIGHTS.promptFit +
        taste * WEIGHTS.tasteFit +
        roleFit * WEIGHTS.playlistRoleFit +
        prompt.evidenceConfidence * WEIGHTS.evidenceConfidence +
        freshness * WEIGHTS.freshnessDiversity +
        discovery * WEIGHTS.discoveryValue,
      );
  return {
    track,
    score,
    promptFit: prompt.value,
    tasteFit: taste,
    playlistRoleFit: roleFit,
    evidenceConfidence: prompt.evidenceConfidence,
    freshnessDiversity: freshness,
    discoveryValue: discovery,
    role,
    rejectedReason: prompt.rejectedReason,
  };
}

function qualityFor<T extends PersonalCompilerTrack>(ranked: Array<RankedCandidate<T>>): PersonalCompilerDiagnostics["quality"] {
  if (ranked.length === 0) {
    return { promptFit: 0, tasteFit: 0, evidenceConfidence: 0, saveLikelihood: 0 };
  }
  const avg = (selector: (candidate: RankedCandidate<T>) => number) =>
    ranked.reduce((sum, candidate) => sum + selector(candidate), 0) / ranked.length;
  const prompt = avg((candidate) => candidate.promptFit);
  const taste = avg((candidate) => candidate.tasteFit);
  const confidence = avg((candidate) => candidate.evidenceConfidence);
  return {
    promptFit: round3(prompt),
    tasteFit: round3(taste),
    evidenceConfidence: round3(confidence),
    saveLikelihood: round3(clamp01(prompt * 0.40 + taste * 0.35 + confidence * 0.25)),
  };
}

export function compilePersonalPlaylist<T extends PersonalCompilerTrack>(opts: {
  seedTracks: T[];
  candidatePool: T[];
  intent: PersonalIntent;
  userGenreProfile: UserGenreProfile;
  playlistLength: number;
  maxPerArtist: number;
}): { tracks: T[]; diagnostics: PersonalCompilerDiagnostics } {
  const candidates = uniqueByTrackId([...opts.seedTracks, ...opts.candidatePool]);
  const artistAffinity = buildArtistAffinity(candidates);
  const selectedArtistCounts = new Map<string, number>();
  const rejectedReasons: Record<string, number> = {};
  const ranked = candidates
    .map((track, index) =>
      rankCandidate(track, index, opts.intent, opts.userGenreProfile, artistAffinity, selectedArtistCounts)
    )
    .sort((a, b) => b.score - a.score);

  const selected: Array<RankedCandidate<T>> = [];
  for (const candidate of ranked) {
    if (candidate.rejectedReason) {
      rejectedReasons[candidate.rejectedReason] = (rejectedReasons[candidate.rejectedReason] ?? 0) + 1;
    }
  }
  for (const candidate of ranked) {
    if (candidate.rejectedReason) {
      continue;
    }
    const artistCount = selectedArtistCounts.get(candidate.track.artistName) ?? 0;
    if (artistCount >= opts.maxPerArtist) {
      rejectedReasons["artist_repetition"] = (rejectedReasons["artist_repetition"] ?? 0) + 1;
      continue;
    }
    selected.push(candidate);
    selectedArtistCounts.set(candidate.track.artistName, artistCount + 1);
    if (selected.length >= opts.playlistLength) break;
  }

  if (selected.length > 0) {
    selected[selected.length - 1] = { ...selected[selected.length - 1], role: "closer" };
  }

  const roleDistribution = selected.reduce<Record<string, number>>((acc, candidate) => {
    acc[candidate.role] = (acc[candidate.role] ?? 0) + 1;
    return acc;
  }, {});

  return {
    tracks: selected.map((candidate) => candidate.track),
    diagnostics: {
      architecture: "personal_playlist_compiler_v1",
      selectedCount: selected.length,
      inputCandidateCount: candidates.length,
      rankedCandidateCount: ranked.length,
      rejectedMustCount: Object.entries(rejectedReasons)
        .filter(([reason]) => reason.endsWith("_must_mismatch"))
        .reduce((sum, [, count]) => sum + count, 0),
      quality: qualityFor(selected),
      tasteModel: {
        dominantGenres: opts.userGenreProfile.dominant.slice(0, 8),
        artistAffinityCount: artistAffinity.size,
      },
      scoringWeights: { ...WEIGHTS },
      roleDistribution,
      topRejectedReasons: rejectedReasons,
    },
  };
}
