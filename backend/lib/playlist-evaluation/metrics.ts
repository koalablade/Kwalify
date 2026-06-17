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

export type QualityFailureCategory =
  | "intent_loss"
  | "scene_mismatch"
  | "genre_drift"
  | "era_drift"
  | "emotional_mismatch"
  | "sequencing_issues"
  | "underfilling"
  | "overfilling"
  | "repetition"
  | "low_realism";

export type QualityFailureDatasetRow = {
  category: QualityFailureCategory;
  examples: Array<{ promptId: string; prompt: string; evidence: string }>;
  frequency: number;
  severity: number;
};

export type PromptUnderstandingConfidence = {
  promptId: string;
  prompt: string;
  intentConfidence: number;
  sceneConfidence: number;
  emotionConfidence: number;
  eraConfidence: number;
  activityConfidence: number;
  collapsedDimensions: string[];
};

export type TransitionQualityReport = {
  promptId: string;
  prompt: string;
  transitionQuality: number;
  harshTransitionCount: number;
  averageEnergyJump: number;
  averageValenceJump: number;
  harshTransitions: Array<{
    fromTrackId: string;
    toTrackId: string;
    position: number;
    energyJump: number;
    valenceJump: number;
  }>;
};

export type LaunchReadinessScore = {
  overallQualityScore: number;
  promptCoverageScore: number;
  humanRealismScore: number;
  sceneAccuracyScore: number;
  eraAccuracyScore: number;
  emotionalAccuracyScore: number;
  transitionQualityScore: number;
  launchReadinessScore: number;
};

export type QualityCalibrationContribution = {
  system: "retrieval" | "scoring" | "curator_scoring" | "validation" | "repair" | "sequencing";
  measurableContribution: number;
  positiveEvidence: string[];
  negativeEvidence: string[];
};

export type StabilityStatus = {
  regressionRiskLevel: "LOW" | "MEDIUM" | "HIGH";
  lockedBehaviours: string[];
  activeRisks: Array<{
    rule: string;
    severity: "warning" | "critical";
    evidence: string;
  }>;
  safeToTuneFurther: boolean;
  thresholds: {
    genreDriftTolerance: number;
    eraDriftTolerance: number;
    repetitionTolerance: number;
    skipLikelihoodTolerance: number;
    transitionHarshnessTolerance: number;
    underfillTolerance: number;
    minimumLaunchReadiness: number;
  };
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
  skipLikelihood: number;
  playlistAcceptance: number;
  realismScore: number;
  sceneFit: number;
  emotionalConsistency: number;
  transitionQuality: number;
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
  qualityFailureDataset: QualityFailureDatasetRow[];
  promptUnderstandingConfidence: PromptUnderstandingConfidence[];
  transitionQualityReports: TransitionQualityReport[];
  launchReadiness: LaunchReadinessScore;
  qualityCalibration: QualityCalibrationContribution[];
  topRemainingImprovements: Array<{
    rank: number;
    improvement: string;
    qualityGain: number;
    userImpact: number;
    frequency: number;
    complexity: number;
    regressionRisk: number;
    estimatedROI: number;
    evidence: string;
  }>;
  stabilityStatus: StabilityStatus;
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

type MetricComputationCache = {
  genreTermsByTrack: Map<string, string[]>;
  genreDriftByPrompt: Map<string, number>;
  eraDriftByPrompt: Map<string, number>;
  averageJumpByPrompt: Map<string, number>;
  harshTransitionsByPrompt: Map<string, TransitionQualityReport["harshTransitions"]>;
  transitionQualityByPrompt: Map<string, number>;
  promptConfidenceByPrompt: Map<string, PromptUnderstandingConfidence>;
};

function createMetricComputationCache(): MetricComputationCache {
  return {
    genreTermsByTrack: new Map(),
    genreDriftByPrompt: new Map(),
    eraDriftByPrompt: new Map(),
    averageJumpByPrompt: new Map(),
    harshTransitionsByPrompt: new Map(),
    transitionQualityByPrompt: new Map(),
    promptConfidenceByPrompt: new Map(),
  };
}

function trackCacheKey(track: EvaluationTrack): string {
  return trackId(track) || `${trackName(track)}:${artistName(track)}`.toLowerCase();
}

function resultCacheKey(result: GenerationEvaluationResult): string {
  return `${result.benchmark.id}:${result.tracks.map(trackCacheKey).join("|")}`;
}

function genreTerms(track: EvaluationTrack, cache?: MetricComputationCache): string[] {
  const key = cache ? trackCacheKey(track) : null;
  const cached = key ? cache?.genreTermsByTrack.get(key) : undefined;
  if (cached) return cached;
  const terms = [
    track.genrePrimary,
    track.genreFamily,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());
  if (key) cache?.genreTermsByTrack.set(key, terms);
  return terms;
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

function genreDrift(prompt: PlaylistBenchmarkPrompt, tracks: EvaluationTrack[], cache?: MetricComputationCache): number {
  if (!prompt.expectedGenres?.length || tracks.length === 0) return 0;
  const hits = tracks.filter((track) => expectedHit(genreTerms(track, cache), prompt.expectedGenres ?? [])).length;
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

function nestedObj(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function averageJump(
  tracks: EvaluationTrack[],
  key: "energy" | "valence",
): number {
  const jumps: number[] = [];
  for (let i = 1; i < tracks.length; i++) {
    const previous = num(tracks[i - 1]?.[key], 0.5);
    const current = num(tracks[i]?.[key], 0.5);
    jumps.push(Math.abs(current - previous));
  }
  return round(average(jumps));
}

function transitionQualityForTracks(tracks: EvaluationTrack[]): TransitionQualityReport["harshTransitions"] & { quality?: never } {
  const harsh: TransitionQualityReport["harshTransitions"] = [];
  for (let i = 1; i < tracks.length; i++) {
    const previous = tracks[i - 1]!;
    const current = tracks[i]!;
    const energyJump = round(Math.abs(num(current.energy, 0.5) - num(previous.energy, 0.5)));
    const valenceJump = round(Math.abs(num(current.valence, 0.5) - num(previous.valence, 0.5)));
    if (energyJump >= 0.46 || valenceJump >= 0.42 || energyJump + valenceJump >= 0.72) {
      harsh.push({
        fromTrackId: trackId(previous),
        toTrackId: trackId(current),
        position: i,
        energyJump,
        valenceJump,
      });
    }
  }
  return harsh;
}

function transitionQualityScore(tracks: EvaluationTrack[]): number {
  if (tracks.length <= 1) return tracks.length === 1 ? 0.7 : 0;
  const harsh = transitionQualityForTracks(tracks);
  const avgEnergyJump = averageJump(tracks, "energy");
  const avgValenceJump = averageJump(tracks, "valence");
  const harshPenalty = harsh.length / Math.max(1, tracks.length - 1);
  return round(clamp01(1 - harshPenalty * 0.62 - avgEnergyJump * 0.38 - avgValenceJump * 0.28));
}

function cachedGenreDrift(
  result: GenerationEvaluationResult,
  cache?: MetricComputationCache,
): number {
  if (!cache) return genreDrift(result.benchmark, result.tracks);
  const key = resultCacheKey(result);
  const cached = cache.genreDriftByPrompt.get(key);
  if (cached !== undefined) return cached;
  const value = genreDrift(result.benchmark, result.tracks, cache);
  cache.genreDriftByPrompt.set(key, value);
  return value;
}

function cachedEraDrift(
  result: GenerationEvaluationResult,
  cache?: MetricComputationCache,
): number {
  if (!cache) return eraDrift(result.benchmark, result.tracks);
  const key = resultCacheKey(result);
  const cached = cache.eraDriftByPrompt.get(key);
  if (cached !== undefined) return cached;
  const value = eraDrift(result.benchmark, result.tracks);
  cache.eraDriftByPrompt.set(key, value);
  return value;
}

function cachedAverageJump(
  result: GenerationEvaluationResult,
  key: "energy" | "valence",
  cache?: MetricComputationCache,
): number {
  if (!cache) return averageJump(result.tracks, key);
  const cacheKey = `${resultCacheKey(result)}:${key}`;
  const cached = cache.averageJumpByPrompt.get(cacheKey);
  if (cached !== undefined) return cached;
  const value = averageJump(result.tracks, key);
  cache.averageJumpByPrompt.set(cacheKey, value);
  return value;
}

function cachedTransitionQualityForTracks(
  result: GenerationEvaluationResult,
  cache?: MetricComputationCache,
): TransitionQualityReport["harshTransitions"] {
  if (!cache) return transitionQualityForTracks(result.tracks);
  const key = resultCacheKey(result);
  const cached = cache.harshTransitionsByPrompt.get(key);
  if (cached) return cached;
  const value = transitionQualityForTracks(result.tracks);
  cache.harshTransitionsByPrompt.set(key, value);
  return value;
}

function cachedTransitionQualityScore(
  result: GenerationEvaluationResult,
  cache?: MetricComputationCache,
): number {
  if (!cache) return transitionQualityScore(result.tracks);
  const key = resultCacheKey(result);
  const cached = cache.transitionQualityByPrompt.get(key);
  if (cached !== undefined) return cached;
  if (result.tracks.length <= 1) {
    const value = result.tracks.length === 1 ? 0.7 : 0;
    cache.transitionQualityByPrompt.set(key, value);
    return value;
  }
  const harsh = cachedTransitionQualityForTracks(result, cache);
  const avgEnergyJump = cachedAverageJump(result, "energy", cache);
  const avgValenceJump = cachedAverageJump(result, "valence", cache);
  const harshPenalty = harsh.length / Math.max(1, result.tracks.length - 1);
  const value = round(clamp01(1 - harshPenalty * 0.62 - avgEnergyJump * 0.38 - avgValenceJump * 0.28));
  cache.transitionQualityByPrompt.set(key, value);
  return value;
}

function promptConfidence(result: GenerationEvaluationResult, cache?: MetricComputationCache): PromptUnderstandingConfidence {
  if (cache) {
    const key = resultCacheKey(result);
    const cached = cache.promptConfidenceByPrompt.get(key);
    if (cached) return cached;
  }
  const gen = responseObj(result.response, "generationDiagnostics");
  const moment = nestedObj(gen, "momentPipeline");
  const semantic = nestedObj(moment, "semantic");
  const lockedIntent = nestedObj(gen, "lockedIntent");
  const intentContract = nestedObj(gen, "intentContract");
  const promptConfidenceDiagnostics = responseObj(result.response, "promptConfidence");
  const v3 = responseObj(result.response, "v3Diagnostics");
  const intentConfidence = clamp01(num(intentContract["contractSurvivalPercent"], num(promptConfidenceDiagnostics["intentConfidence"], num(promptConfidenceDiagnostics["score"], 0.65) * 100)) / 100);
  const rawSceneConfidence = clamp01(num(semantic["confidence"], num(gen["sceneConfidence"], num(gen["clusterConfidence"], num(v3["sceneConfidence"], 0.55)))));
  const emotionConfidence = clamp01(num(intentContract["emotionSurvivalPercent"], num(gen["humanCoherenceScore"], 0.55) * 100) / 100);
  const eraRange = lockedIntent["eraRange"];
  const eraConfidence = result.benchmark.expectedEra
    ? clamp01(1 - cachedEraDrift(result, cache))
    : eraRange ? 0.72 : 0.58;
  const activityConfidence = result.benchmark.expectedIdentity
    ? clamp01(num(gen["humanCoherenceScore"], 0.55) * 0.55 + (text(gen["identityType"]) === result.benchmark.expectedIdentity ? 0.45 : 0))
    : 0.62;
  const activityDetected = activityConfidence >= 0.70 ||
    !!result.benchmark.expectedIdentity ||
    result.benchmark.tags.some((tag) => ["activity", "gym", "work", "study", "party", "driving"].includes(tag));
  const sceneConfidence = activityDetected
    ? Math.max(rawSceneConfidence, Math.min(0.62, activityConfidence * 0.58))
    : rawSceneConfidence;
  const collapsedDimensions = [
    intentConfidence < 0.58 ? "intent" : null,
    sceneConfidence < 0.50 ? "scene" : null,
    emotionConfidence < 0.56 ? "emotion" : null,
    eraConfidence < 0.55 ? "era" : null,
    activityConfidence < 0.55 ? "activity" : null,
  ].filter((value): value is string => !!value);
  const confidence = {
    promptId: result.benchmark.id,
    prompt: result.benchmark.prompt,
    intentConfidence: round(intentConfidence),
    sceneConfidence: round(sceneConfidence),
    emotionConfidence: round(emotionConfidence),
    eraConfidence: round(eraConfidence),
    activityConfidence: round(activityConfidence),
    collapsedDimensions,
  };
  if (cache) cache.promptConfidenceByPrompt.set(resultCacheKey(result), confidence);
  return confidence;
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
    metrics.transitionQuality < 0.58 ? "harsh_transitions" : null,
    metrics.emotionalConsistency < 0.58 ? "emotional_mismatch" : null,
    metrics.sceneFit < 0.54 ? "scene_mismatch" : null,
    metrics.realismScore < 0.56 ? "low_realism" : null,
    metrics.skipLikelihood >= 0.52 ? "high_skip_likelihood" : null,
    metrics.playlistAcceptance < 0.58 ? "low_playlist_acceptance" : null,
    metrics.artistRepetition >= 0.18 ? "artist_repetition" : null,
    metrics.trackRepetition > 0 ? "duplicate_tracks" : null,
    metrics.trackCount > metrics.requestedLength ? "overfilled_playlist" : null,
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
  if (modes.includes("harsh_transitions")) return "Track-to-track energy or valence jumps are likely to feel jarring.";
  if (modes.includes("high_skip_likelihood")) return "The playlist has a high estimated skip risk from transition, drift, repetition, or fallback signals.";
  if (modes.includes("scene_mismatch")) return "The final playlist does not strongly fit the expected activity or scene.";
  if (modes.includes("low_realism")) return "The playlist may feel algorithmic rather than human-curated.";
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
  cache?: MetricComputationCache,
): PlaylistMetrics {
  const tracks = result.tracks;
  const gen = responseObj(result.response, "generationDiagnostics");
  const debug = responseObj(gen, "generationDebug");
  const confidence = responseObj(result.response, "playlistConfidence");
  const diversity = responseObj(result.response, "artistDiversity");
  const v3Diagnostics = responseObj(result.response, "v3Diagnostics");
  const finalization = responseObj(result.response, "finalization");
  const cluster = dominantShare(tracks.map(clusterKey));
  const debugDominantCluster = text(gen["dominantCluster"]) ?? text(debug["dominantCluster"]);
  const debugClusterPurity = num(gen["clusterPurity"], num(debug["clusterPurity"], cluster.share));
  const humanCoherence = num(gen["humanCoherenceScore"], num(responseObj(result.response, "v3Diagnostics")["avg_transition_score"], 0));
  const transitionQuality = cachedTransitionQualityScore(result, cache);
  const emotionalConsistency = round(clamp01(1 - cachedAverageJump(result, "valence", cache) * 1.6));
  const genreDriftValue = cachedGenreDrift(result, cache);
  const eraDriftValue = cachedEraDrift(result, cache);
  const fallbackUsed = !!(
    result.response?.["fastFallback"] ||
    result.response?.["fallbackReason"] ||
    gen["fallbackTriggered"] ||
    confidence["fallbackUsed"] ||
    (typeof gen["fallbackLevel"] === "string" && gen["fallbackLevel"] !== "none") ||
    (typeof finalization["fallbackMode"] === "string" && finalization["fallbackMode"] !== "none") ||
    v3Diagnostics["fastFallback"] === true
  );
  const recoveryUsed = !!(
    confidence["recoveryUsed"] ||
    (Array.isArray(gen["recoveryRelaxations"]) && gen["recoveryRelaxations"].length > 0) ||
    finalization["finalResponseCompletionLockApplied"] === true ||
    finalization["finalCompletionFillApplied"] === true
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
    trackRepetition: Math.max(
      duplicateRatio(tracks.map(trackId)),
      num(finalization["finalResponseDuplicateFillAdded"]) > 0 ? round(num(finalization["finalResponseDuplicateFillAdded"]) / Math.max(1, tracks.length)) : 0,
    ),
    genreDrift: genreDriftValue,
    eraDrift: eraDriftValue,
    fallbackUsed,
    recoveryUsed,
    clusterPurity: debugClusterPurity,
    personaAdherence: round(Math.max(0, Math.min(1, (humanCoherence || 0.5) * 0.45 + energyFit(result.benchmark, tracks) * 0.35 + valenceFit(result.benchmark, tracks) * 0.20 - (fallbackUsed ? 0.10 : 0)))),
    humanCoherenceScore: round(humanCoherence),
    skipLikelihood: round(clamp01(
      (1 - transitionQuality) * 0.34 +
      Math.max(0, duplicateRatio(tracks.map(artistName)) - 0.10) * 0.25 +
      genreDriftValue * 0.18 +
      eraDriftValue * 0.12 +
      (fallbackUsed ? 0.08 : 0) +
      Math.min(0.12, Math.max(0, result.benchmark.length - tracks.length) / Math.max(1, result.benchmark.length)),
    )),
    playlistAcceptance: 0,
    realismScore: 0,
    sceneFit: 0,
    emotionalConsistency,
    transitionQuality,
    playlistUniqueness: round(1 - duplicateRatio(tracks.map(trackId))),
    crossPlaylistOverlap: round(crossPlaylistOverlap),
    confidenceScore: num(confidence["score"], num(confidence["percent"]) / 100),
  };
  base.sceneFit = round(clamp01(
    base.personaAdherence * 0.36 +
    base.clusterPurity * 0.24 +
    (1 - base.genreDrift) * 0.18 +
    base.humanCoherenceScore * 0.14 +
    base.confidenceScore * 0.08,
  ));
  base.realismScore = round(clamp01(
    base.humanCoherenceScore * 0.28 +
    base.transitionQuality * 0.24 +
    base.playlistUniqueness * 0.18 +
    base.sceneFit * 0.18 +
    base.emotionalConsistency * 0.12 -
    (fallbackUsed ? 0.06 : 0),
  ));
  base.playlistAcceptance = round(clamp01(
    base.realismScore * 0.34 +
    base.personaAdherence * 0.24 +
    base.confidenceScore * 0.18 +
    (1 - base.genreDrift) * 0.14 +
    (1 - base.skipLikelihood) * 0.10,
  ));
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

function failureCategoryForMode(mode: string): QualityFailureCategory | null {
  if (mode === "genre_drift") return "genre_drift";
  if (mode === "era_drift") return "era_drift";
  if (mode === "underfilled_playlist") return "underfilling";
  if (mode === "overfilled_playlist") return "overfilling";
  if (mode === "artist_repetition" || mode === "duplicate_tracks" || mode === "high_cross_playlist_overlap") return "repetition";
  if (mode === "low_human_coherence" || mode === "emotional_mismatch") return "emotional_mismatch";
  if (mode === "harsh_transitions") return "sequencing_issues";
  if (mode === "weak_persona_adherence" || mode === "scene_mismatch") return "scene_mismatch";
  if (mode === "low_confidence") return "intent_loss";
  if (mode === "low_realism" || mode === "high_skip_likelihood" || mode === "low_playlist_acceptance") return "low_realism";
  return null;
}

function buildQualityFailureDataset(playlists: PlaylistMetrics[]): QualityFailureDatasetRow[] {
  const categories: QualityFailureCategory[] = [
    "intent_loss",
    "scene_mismatch",
    "genre_drift",
    "era_drift",
    "emotional_mismatch",
    "sequencing_issues",
    "underfilling",
    "overfilling",
    "repetition",
    "low_realism",
  ];
  return categories.map((category) => {
    const rows = playlists.filter((playlist) =>
      playlist.failureModes.some((mode) => failureCategoryForMode(mode) === category)
    );
    const severity = rows.length
      ? round(average(rows.map((row) => 1 - qualityScore(row))))
      : 0;
    return {
      category,
      examples: rows.slice(0, 8).map((row) => ({
        promptId: row.promptId,
        prompt: row.prompt,
        evidence: row.likelyCause,
      })),
      frequency: rows.length,
      severity,
    };
  }).sort((a, b) => b.frequency - a.frequency || b.severity - a.severity);
}

function buildTransitionQualityReports(
  results: GenerationEvaluationResult[],
  cache?: MetricComputationCache,
): TransitionQualityReport[] {
  return results.map((result) => {
    const harshTransitions = cachedTransitionQualityForTracks(result, cache);
    return {
      promptId: result.benchmark.id,
      prompt: result.benchmark.prompt,
      transitionQuality: cachedTransitionQualityScore(result, cache),
      harshTransitionCount: harshTransitions.length,
      averageEnergyJump: cachedAverageJump(result, "energy", cache),
      averageValenceJump: cachedAverageJump(result, "valence", cache),
      harshTransitions: harshTransitions.slice(0, 12),
    };
  }).sort((a, b) => a.transitionQuality - b.transitionQuality || b.harshTransitionCount - a.harshTransitionCount);
}

function buildLaunchReadiness(playlists: PlaylistMetrics[], confidenceRows: PromptUnderstandingConfidence[]): LaunchReadinessScore {
  const safeAvg = (values: number[]) => round(average(values));
  const overallQualityScore = safeAvg(playlists.map(qualityScore));
  const promptCoverageScore = safeAvg(confidenceRows.map((row) =>
    average([
      row.intentConfidence,
      row.sceneConfidence,
      row.emotionConfidence,
      row.eraConfidence,
      row.activityConfidence,
    ])
  ));
  const humanRealismScore = safeAvg(playlists.map((row) => row.realismScore));
  const sceneAccuracyScore = safeAvg(playlists.map((row) => row.sceneFit));
  const eraAccuracyScore = safeAvg(playlists.map((row) => 1 - row.eraDrift));
  const emotionalAccuracyScore = safeAvg(playlists.map((row) => row.emotionalConsistency));
  const transitionQualityScoreValue = safeAvg(playlists.map((row) => row.transitionQuality));
  const launchReadinessScore = round(
    overallQualityScore * 0.24 +
    promptCoverageScore * 0.16 +
    humanRealismScore * 0.18 +
    sceneAccuracyScore * 0.14 +
    eraAccuracyScore * 0.10 +
    emotionalAccuracyScore * 0.08 +
    transitionQualityScoreValue * 0.10,
  );
  return {
    overallQualityScore,
    promptCoverageScore,
    humanRealismScore,
    sceneAccuracyScore,
    eraAccuracyScore,
    emotionalAccuracyScore,
    transitionQualityScore: transitionQualityScoreValue,
    launchReadinessScore,
  };
}

function buildQualityCalibration(playlists: PlaylistMetrics[]): QualityCalibrationContribution[] {
  const total = Math.max(1, playlists.length);
  const count = (predicate: (row: PlaylistMetrics) => boolean) => playlists.filter(predicate).length;
  const fallbackCount = count((row) => row.fallbackUsed);
  const recoveryCount = count((row) => row.recoveryUsed);
  const lowConfidence = count((row) => row.confidenceScore < 0.58);
  const lowCoherence = count((row) => row.humanCoherenceScore < 0.56);
  const harshTransitions = count((row) => row.transitionQuality < 0.58);
  const genreDriftCount = count((row) => row.genreDrift >= 0.45);
  const weakPersona = count((row) => row.personaAdherence < 0.5);
  return [
    {
      system: "retrieval",
      measurableContribution: round(1 - fallbackCount / total),
      positiveEvidence: [`${total - fallbackCount}/${total} playlists completed without fallback signals.`],
      negativeEvidence: fallbackCount ? [`${fallbackCount}/${total} playlists used fallback or recovery-adjacent signals.`] : [],
    },
    {
      system: "scoring",
      measurableContribution: round(1 - (genreDriftCount + lowConfidence) / (total * 2)),
      positiveEvidence: [`${total - genreDriftCount}/${total} playlists avoided major genre drift.`],
      negativeEvidence: [`${genreDriftCount} genre drift failures; ${lowConfidence} low confidence playlists.`].filter(Boolean),
    },
    {
      system: "curator_scoring",
      measurableContribution: round(1 - weakPersona / total),
      positiveEvidence: [`${total - weakPersona}/${total} playlists met persona adherence threshold.`],
      negativeEvidence: weakPersona ? [`${weakPersona}/${total} playlists had weak persona adherence.`] : [],
    },
    {
      system: "validation",
      measurableContribution: round(1 - count((row) => row.trackCount === 0 || row.underfilledBy > 0) / total),
      positiveEvidence: [`${count((row) => row.trackCount > 0 && row.underfilledBy === 0)}/${total} playlists returned complete non-empty results.`],
      negativeEvidence: [`${count((row) => row.underfilledBy > 0)} underfilled; ${count((row) => row.trackCount === 0)} empty.`],
    },
    {
      system: "repair",
      measurableContribution: round(1 - recoveryCount / total),
      positiveEvidence: [`${total - recoveryCount}/${total} playlists did not need recovery relaxations.`],
      negativeEvidence: recoveryCount ? [`${recoveryCount}/${total} playlists used recovery, so repair/fallback impact should be reviewed.`] : [],
    },
    {
      system: "sequencing",
      measurableContribution: round(1 - (lowCoherence + harshTransitions) / (total * 2)),
      positiveEvidence: [`${total - harshTransitions}/${total} playlists avoided harsh transition threshold.`],
      negativeEvidence: [`${lowCoherence} low coherence; ${harshTransitions} harsh transition reports.`],
    },
  ];
}

function buildTopRemainingImprovements(dataset: QualityFailureDatasetRow[]): EvaluationSummaryMetrics["topRemainingImprovements"] {
  const frequencyFor = (category: QualityFailureCategory): number =>
    dataset.find((row) => row.category === category)?.frequency ?? 0;
  const severityFor = (category: QualityFailureCategory): number =>
    dataset.find((row) => row.category === category)?.severity ?? 0;
  const candidates = [
    { improvement: "Expand weird human prompt fixtures and confidence collapse reporting", categories: ["intent_loss"] as QualityFailureCategory[], gain: 82, impact: 92, complexity: 22, risk: 16, evidence: "Triggered by low confidence and intent-loss rows in the launch dataset." },
    { improvement: "Tune scene-fit evaluation thresholds by activity and environment", categories: ["scene_mismatch"] as QualityFailureCategory[], gain: 76, impact: 86, complexity: 28, risk: 20, evidence: "Scene mismatch and weak persona adherence are user-visible quality failures." },
    { improvement: "Add stricter transition-quality launch gate", categories: ["sequencing_issues"] as QualityFailureCategory[], gain: 74, impact: 84, complexity: 24, risk: 18, evidence: "Harsh transitions directly map to skip likelihood." },
    { improvement: "Calibrate human acceptance score against failure examples", categories: ["low_realism"] as QualityFailureCategory[], gain: 84, impact: 90, complexity: 35, risk: 24, evidence: "Low realism and high skip likelihood estimate why users dislike playlists." },
    { improvement: "Increase niche genre/era benchmark coverage", categories: ["genre_drift", "era_drift"] as QualityFailureCategory[], gain: 68, impact: 78, complexity: 26, risk: 18, evidence: "Genre and era drift remain measurable failure modes." },
    { improvement: "Report repair before/after contribution per playlist", categories: ["underfilling", "low_realism"] as QualityFailureCategory[], gain: 62, impact: 70, complexity: 20, risk: 14, evidence: "Recovery use needs measurable benefit, not only presence." },
    { improvement: "Add repetition and sameness launch blocker", categories: ["repetition"] as QualityFailureCategory[], gain: 64, impact: 74, complexity: 22, risk: 16, evidence: "Repetition failures make playlists feel algorithmic." },
    { improvement: "Tune validation thresholds for underfill vs drift tradeoffs", categories: ["underfilling", "genre_drift", "era_drift"] as QualityFailureCategory[], gain: 66, impact: 76, complexity: 34, risk: 28, evidence: "Underfilled playlists and drift are opposing launch risks." },
    { improvement: "Add overfill invariant check to CI reports", categories: ["overfilling"] as QualityFailureCategory[], gain: 40, impact: 58, complexity: 10, risk: 8, evidence: "Overfilling is rare but cheap to detect." },
    { improvement: "Separate emotional mismatch from scene mismatch in report UI", categories: ["emotional_mismatch", "scene_mismatch"] as QualityFailureCategory[], gain: 58, impact: 68, complexity: 16, risk: 10, evidence: "The dataset now separates emotional and scene failures." },
  ];
  return candidates
    .map((candidate) => {
      const frequency = candidate.categories.reduce((sum, category) => sum + frequencyFor(category), 0);
      const severity = average(candidate.categories.map(severityFor));
      const estimatedROI = round(clamp01(((candidate.gain / 100) * (candidate.impact / 100) * Math.max(1, frequency) * (0.65 + severity)) / ((candidate.complexity / 25) * Math.max(0.4, candidate.risk / 25))) * 100);
      return {
        rank: 0,
        improvement: candidate.improvement,
        qualityGain: candidate.gain,
        userImpact: candidate.impact,
        frequency,
        complexity: candidate.complexity,
        regressionRisk: candidate.risk,
        estimatedROI,
        evidence: candidate.evidence,
      };
    })
    .sort((a, b) => b.estimatedROI - a.estimatedROI)
    .slice(0, 20)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

const STABILITY_THRESHOLDS: StabilityStatus["thresholds"] = {
  genreDriftTolerance: 0.18,
  eraDriftTolerance: 0.22,
  repetitionTolerance: 0.12,
  skipLikelihoodTolerance: 0.36,
  transitionHarshnessTolerance: 0.18,
  underfillTolerance: 0,
  minimumLaunchReadiness: 0.78,
};

const LOCKED_BEHAVIOURS = [
  "The system must never return an empty playlist for a successful generation response.",
  "The system must never return more tracks than the requested benchmark length.",
  "The system must always keep average major genre drift at or below the launch tolerance.",
  "The system must always keep average era drift at or below the launch tolerance for era-specific prompts.",
  "The system must always keep track repetition at zero and artist repetition below tolerance.",
  "The system must never improve transition smoothness by collapsing diversity or playlist realism.",
  "The system must always report confidence collapse dimensions for low-confidence prompts.",
  "The system must always keep successful evaluation output shape compatible with the public playlist response.",
];

function buildStabilityStatus(
  playlists: PlaylistMetrics[],
  transitionReports: TransitionQualityReport[],
  launchReadiness: LaunchReadinessScore,
): StabilityStatus {
  const total = Math.max(1, playlists.length);
  const avgGenreDrift = average(playlists.map((row) => row.genreDrift));
  const eraRows = playlists.filter((row) => row.eraDrift > 0 || /\bera|90s|80s|70s|2000s|naughties|old school\b/i.test(row.prompt));
  const avgEraDrift = average(eraRows.map((row) => row.eraDrift));
  const avgArtistRepetition = average(playlists.map((row) => row.artistRepetition));
  const avgSkipLikelihood = average(playlists.map((row) => row.skipLikelihood));
  const harshTransitionRate = transitionReports.reduce((sum, row) => sum + row.harshTransitionCount, 0) /
    Math.max(1, playlists.reduce((sum, row) => sum + Math.max(0, row.trackCount - 1), 0));
  const underfilled = playlists.filter((row) => row.underfilledBy > STABILITY_THRESHOLDS.underfillTolerance);
  const overfilled = playlists.filter((row) => row.trackCount > row.requestedLength);
  const empty = playlists.filter((row) => row.trackCount === 0);
  const smoothButUnreal = playlists.filter((row) =>
    row.transitionQuality >= 0.78 &&
    (row.realismScore < 0.58 || row.playlistUniqueness < 0.78 || row.clusterPurity < 0.42)
  );
  const coherentButRejected = playlists.filter((row) =>
    row.humanCoherenceScore >= 0.72 &&
    (row.playlistAcceptance < 0.58 || row.skipLikelihood >= STABILITY_THRESHOLDS.skipLikelihoodTolerance)
  );
  const risks: StabilityStatus["activeRisks"] = [
    empty.length
      ? { rule: "never_empty_success", severity: "critical", evidence: `${empty.length}/${total} successful evaluation rows returned zero tracks.` }
      : null,
    overfilled.length
      ? { rule: "never_overfill", severity: "critical", evidence: `${overfilled.length}/${total} playlists exceeded requested length.` }
      : null,
    underfilled.length
      ? { rule: "no_underfill", severity: "critical", evidence: `${underfilled.length}/${total} playlists underfilled requested length.` }
      : null,
    avgGenreDrift > STABILITY_THRESHOLDS.genreDriftTolerance
      ? { rule: "genre_drift_tolerance", severity: "critical", evidence: `Average genre drift ${round(avgGenreDrift)} exceeds ${STABILITY_THRESHOLDS.genreDriftTolerance}.` }
      : null,
    eraRows.length > 0 && avgEraDrift > STABILITY_THRESHOLDS.eraDriftTolerance
      ? { rule: "era_drift_tolerance", severity: "warning", evidence: `Average era drift ${round(avgEraDrift)} across ${eraRows.length} era-like prompts exceeds ${STABILITY_THRESHOLDS.eraDriftTolerance}.` }
      : null,
    avgArtistRepetition > STABILITY_THRESHOLDS.repetitionTolerance
      ? { rule: "repetition_tolerance", severity: "warning", evidence: `Average artist repetition ${round(avgArtistRepetition)} exceeds ${STABILITY_THRESHOLDS.repetitionTolerance}.` }
      : null,
    avgSkipLikelihood > STABILITY_THRESHOLDS.skipLikelihoodTolerance
      ? { rule: "skip_likelihood_tolerance", severity: "warning", evidence: `Average skip likelihood ${round(avgSkipLikelihood)} exceeds ${STABILITY_THRESHOLDS.skipLikelihoodTolerance}.` }
      : null,
    harshTransitionRate > STABILITY_THRESHOLDS.transitionHarshnessTolerance
      ? { rule: "transition_harshness_tolerance", severity: "warning", evidence: `Harsh transition rate ${round(harshTransitionRate)} exceeds ${STABILITY_THRESHOLDS.transitionHarshnessTolerance}.` }
      : null,
    launchReadiness.launchReadinessScore < STABILITY_THRESHOLDS.minimumLaunchReadiness
      ? { rule: "minimum_launch_readiness", severity: "critical", evidence: `Launch readiness ${round(launchReadiness.launchReadinessScore)} is below ${STABILITY_THRESHOLDS.minimumLaunchReadiness}.` }
      : null,
    smoothButUnreal.length
      ? { rule: "smoothness_without_realism", severity: "warning", evidence: `${smoothButUnreal.length}/${total} playlists are smooth but lose realism, diversity, or cluster purity.` }
      : null,
    coherentButRejected.length
      ? { rule: "coherence_without_acceptance", severity: "warning", evidence: `${coherentButRejected.length}/${total} playlists have good coherence but weak acceptance or high skip likelihood.` }
      : null,
  ].filter((risk): risk is StabilityStatus["activeRisks"][number] => !!risk);
  const criticalCount = risks.filter((risk) => risk.severity === "critical").length;
  const regressionRiskLevel: StabilityStatus["regressionRiskLevel"] =
    criticalCount > 0 ? "HIGH" : risks.length >= 3 ? "MEDIUM" : "LOW";
  return {
    regressionRiskLevel,
    lockedBehaviours: LOCKED_BEHAVIOURS,
    activeRisks: risks,
    safeToTuneFurther: regressionRiskLevel === "LOW",
    thresholds: STABILITY_THRESHOLDS,
  };
}

export function summarizeEvaluation(results: GenerationEvaluationResult[]): EvaluationSummaryMetrics {
  const cache = createMetricComputationCache();
  const overlaps = computeCrossPlaylistOverlap(results);
  const playlists = results.map((result) => computePlaylistMetrics(result, overlaps.get(result.benchmark.id) ?? 0, cache));
  const promptUnderstandingConfidence = results.map((result) => promptConfidence(result, cache));
  const transitionQualityReports = buildTransitionQualityReports(results, cache);
  const qualityFailureDataset = buildQualityFailureDataset(playlists);
  const launchReadiness = buildLaunchReadiness(playlists, promptUnderstandingConfidence);
  const qualityCalibration = buildQualityCalibration(playlists);
  const topRemainingImprovements = buildTopRemainingImprovements(qualityFailureDataset);
  const stabilityStatus = buildStabilityStatus(playlists, transitionQualityReports, launchReadiness);
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
    qualityFailureDataset,
    promptUnderstandingConfidence,
    transitionQualityReports,
    launchReadiness,
    qualityCalibration,
    topRemainingImprovements,
    stabilityStatus,
  };
}

export function qualityScore(row: PlaylistMetrics): number {
  const score =
    row.humanCoherenceScore * 0.16 +
    row.personaAdherence * 0.14 +
    row.realismScore * 0.14 +
    row.playlistAcceptance * 0.12 +
    row.transitionQuality * 0.10 +
    row.sceneFit * 0.10 +
    (1 - row.genreDrift) * 0.10 +
    (1 - row.eraDrift) * 0.08 +
    row.playlistUniqueness * 0.08 +
    (1 - row.crossPlaylistOverlap) * 0.05 +
    row.confidenceScore * 0.03 -
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

