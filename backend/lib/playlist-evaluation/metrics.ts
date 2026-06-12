import type { PlaylistBenchmarkPrompt } from "./benchmark-prompts";

export type EvaluationTrack = {
  id?: string;
  trackId?: string;
  name?: string;
  trackName?: string;
  artist?: string;
  artistName?: string;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  releaseYear?: number | null;
  energy?: number | null;
  valence?: number | null;
  clusterId?: string | null;
  clusterIds?: string[] | null;
  laneId?: string | null;
};

export type GenerationEvaluationResult = {
  benchmark: PlaylistBenchmarkPrompt;
  ok: boolean;
  status?: number;
  error?: string;
  response: Record<string, unknown> | null;
  tracks: EvaluationTrack[];
  elapsedMs: number;
};

export type PlaylistMetrics = {
  promptId: string;
  prompt: string;
  category: string;
  playlistTitle: string;
  persona: string | null;
  dominantCluster: string | null;
  trackCount: number;
  requestedLength: number;
  underfilledBy: number;
  artistRepetition: number;
  trackRepetition: number;
  genreDrift: number;
  eraDrift: number;
  fallbackUsed: boolean;
  recoveryUsed: boolean;
  clusterPurity: number;
  personaAdherence: number;
  humanCoherenceScore: number;
  playlistUniqueness: number;
  crossPlaylistOverlap: number;
  confidenceScore: number;
  failureModes: string[];
  likelyCause: string;
};

export type EvaluationSummaryMetrics = {
  playlists: PlaylistMetrics[];
  categorySummaries: Array<{
    category: string;
    count: number;
    averageQuality: number;
    fallbackRate: number;
    emptyCount: number;
    averageCoherence: number;
    averageOverlap: number;
  }>;
  mostRepeatedArtists: Array<{ artist: string; appearances: number; playlists: number }>;
  mostRepeatedTracks: Array<{ trackId: string; name: string; artist: string; appearances: number; playlists: number }>;
  failureModes: Array<{ mode: string; count: number; promptIds: string[] }>;
};

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function trackId(track: EvaluationTrack): string {
  return track.trackId || track.id || "";
}

function artistName(track: EvaluationTrack): string {
  return track.artistName || track.artist || "Unknown Artist";
}

function trackName(track: EvaluationTrack): string {
  return track.trackName || track.name || "Unknown Track";
}

function genreTerms(track: EvaluationTrack): string[] {
  return [
    track.genrePrimary,
    track.genreFamily,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());
}

function expectedHit(terms: string[], expected: string[]): boolean {
  return terms.some((term) =>
    expected.some((exp) => term.includes(exp.toLowerCase()) || exp.toLowerCase().includes(term)),
  );
}

function duplicateRatio(values: string[]): number {
  const known = values.filter(Boolean);
  if (known.length === 0) return 0;
  return round(1 - new Set(known.map((value) => value.toLowerCase())).size / known.length);
}

function dominantShare(values: string[]): { key: string | null; share: number } {
  const known = values.filter(Boolean);
  if (known.length === 0) return { key: null, share: 0 };
  const counts = new Map<string, number>();
  for (const value of known) counts.set(value, (counts.get(value) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { key: top?.[0] ?? null, share: top ? round(top[1] / known.length) : 0 };
}

function clusterKey(track: EvaluationTrack): string {
  if (track.clusterId) return track.clusterId;
  if (Array.isArray(track.clusterIds) && track.clusterIds[0]) return track.clusterIds[0];
  if (track.laneId) return track.laneId;
  const genre = track.genreFamily || track.genrePrimary || "unknown";
  const energy = typeof track.energy === "number"
    ? track.energy >= 0.67
      ? "high"
      : track.energy <= 0.38
        ? "low"
        : "medium"
    : "unknown";
  return `${genre}:${energy}`;
}

function genreDrift(prompt: PlaylistBenchmarkPrompt, tracks: EvaluationTrack[]): number {
  if (!prompt.expectedGenres?.length || tracks.length === 0) return 0;
  const hits = tracks.filter((track) => expectedHit(genreTerms(track), prompt.expectedGenres ?? [])).length;
  return round(1 - hits / tracks.length);
}

function eraDrift(prompt: PlaylistBenchmarkPrompt, tracks: EvaluationTrack[]): number {
  if (!prompt.expectedEra || tracks.length === 0) return 0;
  const known = tracks.filter((track) => typeof track.releaseYear === "number");
  if (known.length === 0) return 1;
  const hits = known.filter((track) =>
    typeof track.releaseYear === "number" &&
    track.releaseYear >= prompt.expectedEra!.start &&
    track.releaseYear <= prompt.expectedEra!.end,
  ).length;
  return round(1 - hits / known.length);
}

function energyFit(prompt: PlaylistBenchmarkPrompt, tracks: EvaluationTrack[]): number {
  if (!prompt.expectedEnergy || tracks.length === 0) return 1;
  const avg = tracks.reduce((sum, track) => sum + num(track.energy, 0.5), 0) / tracks.length;
  if (prompt.expectedEnergy === "high") return Math.max(0, Math.min(1, (avg - 0.45) / 0.35));
  if (prompt.expectedEnergy === "low") return Math.max(0, Math.min(1, (0.62 - avg) / 0.34));
  return Math.max(0, 1 - Math.abs(avg - 0.55) / 0.35);
}

function valenceFit(prompt: PlaylistBenchmarkPrompt, tracks: EvaluationTrack[]): number {
  if (!prompt.expectedValence || tracks.length === 0) return 1;
  const avg = tracks.reduce((sum, track) => sum + num(track.valence, 0.5), 0) / tracks.length;
  if (prompt.expectedValence === "high") return Math.max(0, Math.min(1, (avg - 0.45) / 0.35));
  if (prompt.expectedValence === "low") return Math.max(0, Math.min(1, (0.62 - avg) / 0.34));
  return Math.max(0, 1 - Math.abs(avg - 0.52) / 0.35);
}

function responseObj(response: Record<string, unknown> | null, key: string): Record<string, unknown> {
  const value = response?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function failureModesFor(metrics: Omit<PlaylistMetrics, "failureModes" | "likelyCause">): string[] {
  const modes = [
    metrics.trackCount === 0 ? "empty_playlist" : null,
    metrics.underfilledBy > 0 ? "underfilled_playlist" : null,
    metrics.genreDrift >= 0.45 ? "genre_drift" : null,
    metrics.eraDrift >= 0.45 ? "era_drift" : null,
    metrics.fallbackUsed ? "fallback_used" : null,
    metrics.recoveryUsed ? "recovery_used" : null,
    metrics.clusterPurity > 0 && metrics.clusterPurity < 0.45 ? "low_cluster_purity" : null,
    metrics.personaAdherence < 0.5 ? "weak_persona_adherence" : null,
    metrics.humanCoherenceScore < 0.56 ? "low_human_coherence" : null,
    metrics.artistRepetition >= 0.18 ? "artist_repetition" : null,
    metrics.trackRepetition > 0 ? "duplicate_tracks" : null,
    metrics.crossPlaylistOverlap >= 0.35 ? "high_cross_playlist_overlap" : null,
    metrics.confidenceScore < 0.58 ? "low_confidence" : null,
  ];
  return modes.filter((value): value is string => !!value);
}

function likelyCause(modes: string[]): string {
  if (modes.includes("empty_playlist")) return "No tracks survived final filtering or recovery.";
  if (modes.includes("underfilled_playlist")) return "Final constraints or recovery could not fill the requested length.";
  if (modes.includes("genre_drift") && modes.includes("fallback_used")) return "Fallback/recovery likely widened the pool away from the requested genre.";
  if (modes.includes("era_drift")) return "Era evidence was weak or relaxed during recovery.";
  if (modes.includes("artist_repetition")) return "Artist gravity remains too strong for this prompt/library slice.";
  if (modes.includes("high_cross_playlist_overlap")) return "The generator is reusing familiar high-score tracks across unrelated prompts.";
  if (modes.includes("weak_persona_adherence")) return "The final set does not match the expected activity/identity energy profile.";
  if (modes.includes("low_cluster_purity")) return "The selected tracks span too many clusters to feel curated.";
  if (modes.includes("low_human_coherence")) return "Energy or emotional transitions look unstable.";
  return modes[0] ?? "No obvious failure detected.";
}

export function computePlaylistMetrics(
  result: GenerationEvaluationResult,
  crossPlaylistOverlap = 0,
): PlaylistMetrics {
  const tracks = result.tracks;
  const gen = responseObj(result.response, "generationDiagnostics");
  const debug = responseObj(gen, "generationDebug");
  const confidence = responseObj(result.response, "playlistConfidence");
  const diversity = responseObj(result.response, "artistDiversity");
  const cluster = dominantShare(tracks.map(clusterKey));
  const debugDominantCluster = text(gen["dominantCluster"]) ?? text(debug["dominantCluster"]);
  const debugClusterPurity = num(gen["clusterPurity"], num(debug["clusterPurity"], cluster.share));
  const humanCoherence = num(gen["humanCoherenceScore"], num(responseObj(result.response, "v3Diagnostics")["avg_transition_score"], 0));
  const fallbackUsed = !!(
    result.response?.["fastFallback"] ||
    result.response?.["fallbackReason"] ||
    gen["fallbackTriggered"] ||
    confidence["fallbackUsed"]
  );
  const recoveryUsed = !!(
    confidence["recoveryUsed"] ||
    (Array.isArray(gen["recoveryRelaxations"]) && gen["recoveryRelaxations"].length > 0)
  );
  const base = {
    promptId: result.benchmark.id,
    prompt: result.benchmark.prompt,
    category: result.benchmark.category,
    playlistTitle: text(result.response?.["playlistName"]) ?? text(result.response?.["name"]) ?? "(no title)",
    persona: text(gen["identityType"]),
    dominantCluster: debugDominantCluster ?? cluster.key,
    trackCount: tracks.length,
    requestedLength: result.benchmark.length,
    underfilledBy: Math.max(0, result.benchmark.length - tracks.length),
    artistRepetition: num(diversity["topRepeatedArtistCount"]) > 0
      ? round(Math.max(0, num(diversity["topRepeatedArtistCount"]) - 1) / Math.max(1, tracks.length))
      : duplicateRatio(tracks.map(artistName)),
    trackRepetition: duplicateRatio(tracks.map(trackId)),
    genreDrift: genreDrift(result.benchmark, tracks),
    eraDrift: eraDrift(result.benchmark, tracks),
    fallbackUsed,
    recoveryUsed,
    clusterPurity: debugClusterPurity,
    personaAdherence: round(Math.max(0, Math.min(1, (humanCoherence || 0.5) * 0.45 + energyFit(result.benchmark, tracks) * 0.35 + valenceFit(result.benchmark, tracks) * 0.20 - (fallbackUsed ? 0.10 : 0)))),
    humanCoherenceScore: round(humanCoherence),
    playlistUniqueness: round(1 - duplicateRatio(tracks.map(trackId))),
    crossPlaylistOverlap: round(crossPlaylistOverlap),
    confidenceScore: num(confidence["score"], num(confidence["percent"]) / 100),
  };
  const failureModes = failureModesFor(base);
  return {
    ...base,
    failureModes,
    likelyCause: likelyCause(failureModes),
  };
}

export function computeCrossPlaylistOverlap(results: GenerationEvaluationResult[]): Map<string, number> {
  const playlistTrackSets = new Map<string, Set<string>>();
  for (const result of results) {
    playlistTrackSets.set(result.benchmark.id, new Set(result.tracks.map(trackId).filter(Boolean)));
  }
  const out = new Map<string, number>();
  for (const [id, ids] of playlistTrackSets) {
    if (ids.size === 0) {
      out.set(id, 0);
      continue;
    }
    let maxOverlap = 0;
    for (const [otherId, otherIds] of playlistTrackSets) {
      if (otherId === id) continue;
      const shared = [...ids].filter((value) => otherIds.has(value)).length;
      maxOverlap = Math.max(maxOverlap, shared / ids.size);
    }
    out.set(id, round(maxOverlap));
  }
  return out;
}

export function summarizeEvaluation(results: GenerationEvaluationResult[]): EvaluationSummaryMetrics {
  const overlaps = computeCrossPlaylistOverlap(results);
  const playlists = results.map((result) => computePlaylistMetrics(result, overlaps.get(result.benchmark.id) ?? 0));
  const byCategory = new Map<string, PlaylistMetrics[]>();
  for (const playlist of playlists) {
    byCategory.set(playlist.category, [...(byCategory.get(playlist.category) ?? []), playlist]);
  }
  const categorySummaries = [...byCategory.entries()].map(([category, rows]) => ({
    category,
    count: rows.length,
    averageQuality: round(rows.reduce((sum, row) => sum + qualityScore(row), 0) / rows.length),
    fallbackRate: round(rows.filter((row) => row.fallbackUsed).length / rows.length),
    emptyCount: rows.filter((row) => row.trackCount === 0).length,
    averageCoherence: round(rows.reduce((sum, row) => sum + row.humanCoherenceScore, 0) / rows.length),
    averageOverlap: round(rows.reduce((sum, row) => sum + row.crossPlaylistOverlap, 0) / rows.length),
  })).sort((a, b) => b.averageQuality - a.averageQuality);

  const artistStats = new Map<string, { appearances: number; playlists: Set<string> }>();
  const trackStats = new Map<string, { name: string; artist: string; appearances: number; playlists: Set<string> }>();
  for (const result of results) {
    for (const track of result.tracks) {
      const artist = artistName(track);
      const artistRow = artistStats.get(artist) ?? { appearances: 0, playlists: new Set<string>() };
      artistRow.appearances += 1;
      artistRow.playlists.add(result.benchmark.id);
      artistStats.set(artist, artistRow);
      const id = trackId(track);
      if (id) {
        const trackRow = trackStats.get(id) ?? { name: trackName(track), artist, appearances: 0, playlists: new Set<string>() };
        trackRow.appearances += 1;
        trackRow.playlists.add(result.benchmark.id);
        trackStats.set(id, trackRow);
      }
    }
  }

  const failureStats = new Map<string, { count: number; promptIds: string[] }>();
  for (const playlist of playlists) {
    for (const mode of playlist.failureModes) {
      const row = failureStats.get(mode) ?? { count: 0, promptIds: [] };
      row.count += 1;
      row.promptIds.push(playlist.promptId);
      failureStats.set(mode, row);
    }
  }

  return {
    playlists,
    categorySummaries,
    mostRepeatedArtists: [...artistStats.entries()]
      .map(([artist, row]) => ({ artist, appearances: row.appearances, playlists: row.playlists.size }))
      .sort((a, b) => b.playlists - a.playlists || b.appearances - a.appearances)
      .slice(0, 100),
    mostRepeatedTracks: [...trackStats.entries()]
      .map(([id, row]) => ({ trackId: id, name: row.name, artist: row.artist, appearances: row.appearances, playlists: row.playlists.size }))
      .sort((a, b) => b.playlists - a.playlists || b.appearances - a.appearances)
      .slice(0, 100),
    failureModes: [...failureStats.entries()]
      .map(([mode, row]) => ({ mode, count: row.count, promptIds: row.promptIds }))
      .sort((a, b) => b.count - a.count),
  };
}

export function qualityScore(row: PlaylistMetrics): number {
  const score =
    row.humanCoherenceScore * 0.24 +
    row.personaAdherence * 0.18 +
    (1 - row.genreDrift) * 0.14 +
    (1 - row.eraDrift) * 0.10 +
    row.clusterPurity * 0.12 +
    row.playlistUniqueness * 0.10 +
    (1 - row.crossPlaylistOverlap) * 0.08 +
    row.confidenceScore * 0.04 -
    (row.fallbackUsed ? 0.08 : 0) -
    (row.recoveryUsed ? 0.04 : 0) -
    Math.min(0.12, row.underfilledBy / Math.max(1, row.requestedLength));
  return round(Math.max(0, Math.min(1, score)));
}

export function rawTrackIdentity(track: EvaluationTrack): { id: string; name: string; artist: string } {
  return { id: trackId(track), name: trackName(track), artist: artistName(track) };
}

export function containsChristmasLeak(result: GenerationEvaluationResult): boolean {
  const prompt = lower(result.benchmark.prompt);
  const allowed = /\b(?:christmas|xmas|holiday|festive)\b/.test(prompt);
  if (allowed) return false;
  return result.tracks.some((track) => /\b(?:christmas|xmas|santa|mistletoe|holiday)\b/i.test(`${trackName(track)} ${genreTerms(track).join(" ")}`));
}

