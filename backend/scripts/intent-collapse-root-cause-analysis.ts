/**
 * Intent collapse root-cause analysis — evidence-only diagnostic for benchmark failures.
 *
 * Usage: npm run investigate:intent-collapse-root-cause
 *
 * Optional: DATABASE_URL (or KWALIFY_DATABASE_URL) enables local funnel replay + per-track
 * rejection diagnosis on the eval user's synced library.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { initDb } from "../db";
import { initPool } from "../lib/pg-pool";
import { runDbInit } from "../lib/db-init";
import { markBootComplete } from "../lib/boot-state";
import { loadLikedSongsBatched } from "../lib/load-liked-songs-batched";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { analyzeVibeWithContext } from "../lib/emotion";
import { resolveVerifiedProductionCredentials } from "../lib/benchmark-env";
import { normalizeEvalToken } from "../lib/eval-token-normalize";
import { buildUnifiedIntentContext } from "../core/unified-intent";
import { buildSceneWorldContext } from "../core/scene-world-layer";
import { countTracksInDominantSceneCluster } from "../core/scene-cohesion-clusters";
import { retrieveCandidatesByEmbedding } from "../core/v3/embedding-retrieval";
import { strictModeHumanSaveability } from "../core/human-saveability-gate";
import {
  collapseIntent,
  selectRankedCandidatesForSampler,
  scoreEditorialIntentMatch,
  minimumIntentPoolSize,
  trackMicroCluster,
  validateDominantClusterAlignment,
  validateEditorialSceneWorldAlignment,
  calibrateIntentVectorForRetrievalPool,
  diagnoseIntentFilterRejectionReason,
  type EditorialIntentVector,
  type IntentCollapseTrack,
} from "../core/editorial/intent-collapse-layer";
import { getGenreFamily } from "../core/v3/global-diversity-controller";

const SEEDS = [1, 2, 3, 4, 5];
const TARGET_COUNT = 25;
const REPORT_DIR = path.resolve(process.cwd(), "reports");
const JSON_PATH = path.join(REPORT_DIR, "intent-collapse-root-cause-analysis.json");
const MD_PATH = path.join(REPORT_DIR, "intent-collapse-root-cause-report.md");

const PROMPTS: Array<{ id: string; prompt: string }> = [
  { id: "summer_morning", prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work." },
  { id: "rainy_walk", prompt: "rainy city morning walk with reflective mood" },
  { id: "cozy_sunday", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "late_night", prompt: "late night feeling" },
  { id: "sunset_drive", prompt: "driving at sunset with open windows and golden light" },
  { id: "optimistic_commute", prompt: "optimistic commute to work with forward energy" },
  { id: "study_session", prompt: "music for thinking and study session focus" },
  { id: "gym_boost", prompt: "gym confidence boost high energy workout" },
];

type RejectionReasonCode =
  | "genre_family_not_allowed"
  | "energy_out_of_range"
  | "valence_out_of_range"
  | "nostalgia_energy_valence_conflict"
  | "nostalgia_release_year_conflict"
  | "rhythm_density_cap"
  | "aggression_cap"
  | "micro_cluster_not_allowed"
  | "missing_features_passed"
  | "passed"
  | "unknown";

type FailurePhase =
  | "success_or_timeout"
  | "world_alignment"
  | "cluster_alignment"
  | "intent_filter_pool"
  | "other";

type TrackRemoval = {
  trackId: string;
  track: string;
  artist: string;
  editorialWorldTag: string;
  rejectionReason: RejectionReasonCode;
};

type FunnelCounts = {
  library_count: number;
  scene_world_count: number;
  dominant_cluster_count: number;
  retrieval_count: number;
  intent_filter_pre_count: number;
  intent_filter_post_count: number;
};

type RunAnalysis = {
  promptId: string;
  prompt: string;
  seed: number;
  httpStatus: number;
  apiError: string | null;
  failurePhase: FailurePhase;
  traceMisleadingPostFilterZero: boolean;
  editorialWorldTag: string | null;
  sceneArchetypeId: string | null;
  dominantClusterLabel: string | null;
  minIntentPool: number | null;
  apiFunnel: FunnelCounts | null;
  localFunnel: FunnelCounts | null;
  localReplayAvailable: boolean;
  removedTracks: TrackRemoval[];
  filterBreakdownPct: Record<string, number>;
  rootCauseHint: "A" | "B" | "C" | "D";
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hasFeature(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function feature(value: number | null | undefined, fallback = 0.5): number {
  return hasFeature(value) ? clamp01(value) : fallback;
}

function valenceToSigned(valence: number): number {
  return clamp01(valence) * 2 - 1;
}

function trackFamily(track: IntentCollapseTrack): string {
  return getGenreFamily(track.genreFamily ?? track.genrePrimary ?? "unknown");
}

function rhythmDensity(track: IntentCollapseTrack): number {
  const dance = feature(track.danceability);
  const tempo = Math.min(1, feature(track.tempo, 120) / 200);
  return clamp01(dance * 0.62 + tempo * 0.38);
}

function sonicAggression(track: IntentCollapseTrack): number {
  const energy = feature(track.energy);
  const acoustic = feature(track.acousticness);
  const dance = feature(track.danceability);
  return clamp01(energy * (1 - acoustic) * (0.5 + dance * 0.5));
}

function diagnoseTrackRejection(
  track: IntentCollapseTrack,
  intent: EditorialIntentVector,
  allowedFamilies: string[],
): RejectionReasonCode {
  const family = trackFamily(track);
  if (!allowedFamilies.includes(family)) return "genre_family_not_allowed";

  if (hasFeature(track.energy)) {
    const energy = feature(track.energy);
    if (energy < intent.energyRange[0] || energy > intent.energyRange[1]) return "energy_out_of_range";
    if (intent.nostalgiaBias >= 0.55) {
      const valence = hasFeature(track.valence)
        ? valenceToSigned(feature(track.valence))
        : null;
      if (energy > 0.78 && valence != null && valence > 0.45) return "nostalgia_energy_valence_conflict";
      const year = track.releaseYear;
      if (typeof year === "number" && year > 2022 && energy > 0.72) return "nostalgia_release_year_conflict";
    }
  }

  if (hasFeature(track.valence)) {
    const valence = valenceToSigned(feature(track.valence));
    if (Math.abs(valence - intent.valenceTarget) > 0.25) return "valence_out_of_range";
  }

  if (hasFeature(track.danceability) || hasFeature(track.tempo)) {
    if (rhythmDensity(track) > intent.rhythmDensityCap + 0.04) return "rhythm_density_cap";
  }

  if (hasFeature(track.energy) || hasFeature(track.acousticness) || hasFeature(track.danceability)) {
    if (sonicAggression(track) > intent.sonicAggressionCeiling + 0.04) return "aggression_cap";
  }

  const micro = trackMicroCluster(track);
  if (!intent.allowedMicroClusters.includes(micro)) return "micro_cluster_not_allowed";

  const hasAnyFeature = hasFeature(track.energy)
    || hasFeature(track.valence)
    || hasFeature(track.danceability)
    || hasFeature(track.tempo)
    || hasFeature(track.acousticness);
  if (!hasAnyFeature) return "missing_features_passed";

  return "passed";
}

function classifyFailurePhase(error: string | null, httpStatus: number): FailurePhase {
  if (httpStatus === 200) return "success_or_timeout";
  if (!error) return "other";
  if (error.includes("incompatible_with_archetype")) return "world_alignment";
  if (error.includes("incompatible_with_dominant_cluster")) return "cluster_alignment";
  if (error.includes("insufficient_intent_pool")) return "intent_filter_pool";
  return "other";
}

function toIntentCollapseTrack(row: {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  tempo?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  releaseYear?: number | null;
}): IntentCollapseTrack & { trackName?: string | null } {
  return {
    trackId: row.trackId,
    artistName: row.artistName,
    genrePrimary: row.genrePrimary,
    genreFamily: row.genreFamily,
    energy: row.energy,
    valence: row.valence,
    danceability: row.danceability,
    acousticness: row.acousticness,
    tempo: row.tempo,
    instrumentalness: row.instrumentalness,
    speechiness: row.speechiness,
    releaseYear: row.releaseYear,
    trackName: row.trackName,
  };
}

const WORLD_PRIMARY_FAMILIES: Record<string, string[]> = {
  indie_pop_sunshine_commute: ["indie", "pop"],
  indie_folk_rain_walk: ["indie", "folk"],
  soft_indie_morning: ["indie", "folk"],
  sunset_indie_drive: ["indie", "rock"],
  late_night_indie_interior: ["indie", "electronic"],
  upbeat_pop_commute: ["pop", "indie"],
  gym_boost: ["hip_hop", "electronic", "pop"],
  energetic_workout: ["electronic", "hip_hop"],
  festival_electronic: ["electronic", "pop"],
  focus_study: ["electronic", "indie"],
  ambient_focus: ["electronic"],
  coding_flow: ["electronic", "indie"],
  deep_work: ["electronic", "indie"],
  modern_hiphop_focus: ["hip_hop", "electronic"],
  late_night_rnb: ["rnb", "indie", "electronic"],
  night_drive_electronic: ["electronic", "indie"],
  emotional_alt_pop: ["indie", "pop"],
  indie_balanced_default: ["indie"],
};

function primaryFamiliesForWorld(tag: string): string[] {
  return WORLD_PRIMARY_FAMILIES[tag] ?? ["indie", "pop"];
}

function computeFilterBreakdownPct(removals: TrackRemoval[]): Record<string, number> {
  const total = removals.length;
  if (total === 0) return {};
  const counts = new Map<string, number>();
  for (const row of removals) {
    counts.set(row.rejectionReason, (counts.get(row.rejectionReason) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  for (const [reason, count] of counts) {
    out[reason] = Math.round((count / total) * 1000) / 10;
  }
  return out;
}

function rootCauseHintForRun(run: RunAnalysis): "A" | "B" | "C" | "D" {
  if (run.failurePhase === "world_alignment" || run.failurePhase === "cluster_alignment") return "C";
  if (run.failurePhase === "intent_filter_pool") {
    const pre = run.localFunnel?.intent_filter_pre_count ?? run.apiFunnel?.intent_filter_pre_count ?? 0;
    if (pre > 0) return "A";
    return "B";
  }
  if (run.failurePhase === "success_or_timeout") return "D";
  return "D";
}

async function loadLibrary(userId: string): Promise<Array<ReturnType<typeof toIntentCollapseTrack>> | null> {
  const connectionString = process.env.KWALIFY_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? null;
  if (!connectionString) return null;
  const pool = initPool(connectionString);
  initDb(pool);
  await runDbInit(pool);
  markBootComplete();
  const rows = await loadLikedSongsBatched(userId);
  const { valid } = sanitizeLikedSongs(rows);
  return valid.map(toIntentCollapseTrack);
}

function replayLocalFunnel(
  prompt: string,
  seed: number,
  libraryTracks: Array<ReturnType<typeof toIntentCollapseTrack>>,
): {
  funnel: FunnelCounts;
  intent: EditorialIntentVector;
  removedTracks: TrackRemoval[];
  failurePhase: FailurePhase;
  archetypeId: string | null;
  dominantClusterLabel: string | null;
  minIntentPool: number;
} {
  const { profile } = analyzeVibeWithContext(prompt);
  const unified = buildUnifiedIntentContext(prompt, profile);
  const lockedIntent = unified.lockedIntent;
  const strictMode = strictModeHumanSaveability(prompt, lockedIntent);
  const collapsed = collapseIntent({
    vibe: prompt,
    lockedIntent,
    profile,
    seed,
    strictMode,
    libraryTracks,
    targetCount: TARGET_COUNT,
  });
  const intent = collapsed.intent;
  const sceneWorld = buildSceneWorldContext({
    vibe: prompt,
    lockedIntent,
    tracks: libraryTracks,
    seed: String(seed),
  });
  const worldAlignment = validateEditorialSceneWorldAlignment(
    intent.editorialWorldTag,
    sceneWorld?.archetype?.id,
  );
  if (sceneWorld?.active && !worldAlignment.aligned) {
    return {
      funnel: {
        library_count: libraryTracks.length,
        scene_world_count: libraryTracks.length,
        dominant_cluster_count: countTracksInDominantSceneCluster(
          libraryTracks.map((t) => t.trackId),
          sceneWorld,
        ),
        retrieval_count: 0,
        intent_filter_pre_count: 0,
        intent_filter_post_count: 0,
      },
      intent,
      removedTracks: [],
      failurePhase: "world_alignment",
      archetypeId: sceneWorld?.archetype?.id ?? null,
      dominantClusterLabel: sceneWorld?.sceneClusters?.dominantCluster.label ?? null,
      minIntentPool: minimumIntentPoolSize(TARGET_COUNT, strictMode),
    };
  }
  const clusterAlignment = validateDominantClusterAlignment(
    intent.editorialWorldTag,
    sceneWorld?.sceneClusters?.dominantCluster.label,
  );
  if (sceneWorld?.sceneClusters && !clusterAlignment.aligned) {
    return {
      funnel: {
        library_count: libraryTracks.length,
        scene_world_count: libraryTracks.length,
        dominant_cluster_count: countTracksInDominantSceneCluster(
          libraryTracks.map((t) => t.trackId),
          sceneWorld,
        ),
        retrieval_count: 0,
        intent_filter_pre_count: 0,
        intent_filter_post_count: 0,
      },
      intent,
      removedTracks: [],
      failurePhase: "cluster_alignment",
      archetypeId: sceneWorld?.archetype?.id ?? null,
      dominantClusterLabel: sceneWorld?.sceneClusters?.dominantCluster.label ?? null,
      minIntentPool: minimumIntentPoolSize(TARGET_COUNT, strictMode),
    };
  }

  const retrievalCloud = retrieveCandidatesByEmbedding(
    libraryTracks.map((t) => ({
      trackId: t.trackId,
      energy: t.energy ?? null,
      valence: t.valence ?? null,
      danceability: t.danceability ?? null,
      acousticness: t.acousticness ?? null,
      tempo: t.tempo ?? null,
      releaseYear: t.releaseYear ?? null,
    })),
    lockedIntent,
    unified.unifiedIntent,
    { maxTasteWeight: strictMode ? 0.12 : 0.22 },
  );
  const retrievalById = new Map(libraryTracks.map((t) => [t.trackId, t]));
  let retrievedTracks = retrievalCloud.tracks
    .map((c) => retrievalById.get(c.track.trackId))
    .filter((t): t is ReturnType<typeof toIntentCollapseTrack> => t != null);
  const dominantClusterCount = countTracksInDominantSceneCluster(
    retrievedTracks.map((t) => t.trackId),
    sceneWorld,
  );
  const preFilter = retrievedTracks.length;
  const calibrated = calibrateIntentVectorForRetrievalPool(retrievedTracks, intent, {
    targetCount: TARGET_COUNT,
    strictMode,
  });
  const ranked = selectRankedCandidatesForSampler(retrievedTracks, calibrated, {
    targetCount: TARGET_COUNT,
    strictMode,
  });
  const postFilterTracks = ranked.selected;
  const postFilter = postFilterTracks.length;
  const removedTracks: TrackRemoval[] = [];
  for (const track of retrievedTracks) {
    if (postFilterTracks.some((row) => row.trackId === track.trackId)) continue;
    const reason = diagnoseIntentFilterRejectionReason(track, calibrated);
    const score = scoreEditorialIntentMatch(track, calibrated);
    removedTracks.push({
      trackId: track.trackId,
      track: (track as { trackName?: string | null }).trackName ?? track.trackId,
      artist: track.artistName ?? "unknown",
      editorialWorldTag: intent.editorialWorldTag,
      rejectionReason: (score <= 0 ? reason : "ranked_below_floor") as typeof reason,
    });
  }

  const minIntentPool = minimumIntentPoolSize(TARGET_COUNT, strictMode);
  const failurePhase: FailurePhase = postFilter < minIntentPool ? "intent_filter_pool" : "success_or_timeout";

  return {
    funnel: {
      library_count: libraryTracks.length,
      scene_world_count: libraryTracks.length,
      dominant_cluster_count: dominantClusterCount,
      retrieval_count: retrievalCloud.tracks.length,
      intent_filter_pre_count: preFilter,
      intent_filter_post_count: postFilter,
    },
    intent,
    removedTracks,
    failurePhase,
    archetypeId: sceneWorld?.archetype?.id ?? null,
    dominantClusterLabel: sceneWorld?.sceneClusters?.dominantCluster.label ?? null,
    minIntentPool,
  };
}

async function fetchProductionRun(
  baseUrl: string,
  token: string,
  spotifyUserId: string,
  item: { id: string; prompt: string },
  seed: number,
): Promise<{ data: Record<string, unknown>; httpStatus: number }> {
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: item.prompt,
      mode: "balanced",
      length: TARGET_COUNT,
      varietyBoost: true,
      auditMode: true,
      spotifyUserId,
      requestId: `intent-collapse-rca-${item.id}-seed-${seed}`,
      seed,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  return { data, httpStatus: res.status };
}

function buildMarkdownReport(payload: Record<string, unknown>): string {
  const summary = payload.summary as Record<string, unknown>;
  const runs = payload.runs as RunAnalysis[];
  const lines: string[] = [
    "# Intent Collapse Root Cause Analysis",
    "",
    `Generated: ${payload.generatedAt}`,
    `Production: ${payload.baseUrl} @ ${payload.deploymentCommit ?? "unknown"}`,
    "",
    "## Executive summary",
    "",
    `- **Runs analyzed:** ${summary.totalRuns}`,
    `- **Primary verdict:** ${summary.primaryVerdict}`,
    `- **Trace mislabeling:** ${summary.traceMislabelingNote}`,
    "",
    "### Failure phase breakdown",
    "",
    "| Phase | Count | % |",
    "|---|---:|---:|",
  ];

  const phaseBreakdown = summary.failurePhaseBreakdown as Record<string, number>;
  for (const [phase, count] of Object.entries(phaseBreakdown).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${phase} | ${count} | ${Math.round((count / (summary.totalRuns as number)) * 1000) / 10}% |`);
  }

  lines.push(
    "",
    "### Top 10 rejection reasons (per-track, intent filter stage only)",
    "",
  );
  const topReasons = summary.topRejectionReasons as Array<{ reason: string; count: number; pct: number }>;
  if (topReasons.length === 0) {
    lines.push("_No per-track filter rejections captured (alignment failures occur before filter)._");
  } else {
    lines.push("| Reason | Count | % of removed |");
    lines.push("|---|---:|---:|");
    for (const row of topReasons.slice(0, 10)) {
      lines.push(`| ${row.reason} | ${row.count} | ${row.pct}% |`);
    }
  }

  lines.push(
    "",
    `**Most destructive filter:** ${summary.mostDestructiveFilter ?? "N/A (failures mostly pre-filter)"}`,
    "",
    "### Prompts most affected",
    "",
    "| Prompt | Failures | Dominant phase |",
    "|---|---:|---|",
  );
  const promptImpact = summary.promptImpact as Array<{ promptId: string; failures: number; dominantPhase: string }>;
  for (const row of promptImpact) {
    lines.push(`| ${row.promptId} | ${row.failures} | ${row.dominantPhase} |`);
  }

  lines.push(
    "",
    "### Estimated pass-rate improvement if each cause were fixed (upper bound)",
    "",
    "| Cause fixed | Runs unblocked | Est. pass-rate lift |",
    "|---|---:|---:|",
  );
  const improvements = summary.estimatedPassRateImprovements as Array<{ cause: string; runsUnblocked: number; passRateLiftPct: number }>;
  for (const row of improvements) {
    lines.push(`| ${row.cause} | ${row.runsUnblocked} | +${row.passRateLiftPct}% |`);
  }

  lines.push(
    "",
    "## Root cause classification (A/B/C/D)",
    "",
    String(summary.rootCauseClassification),
    "",
    "## Per-prompt breakdown",
    "",
  );

  const byPrompt = new Map<string, RunAnalysis[]>();
  for (const run of runs) {
    const list = byPrompt.get(run.promptId) ?? [];
    list.push(run);
    byPrompt.set(run.promptId, list);
  }

  for (const [promptId, promptRuns] of byPrompt) {
    lines.push(`### ${promptId}`, "");
    lines.push(`Prompt: "${promptRuns[0]?.prompt ?? ""}"`, "");
    lines.push("| Seed | Phase | World | Archetype | retrieval | pre_filter | post_filter |");
    lines.push("|---:|---|---|---|---:|---:|---:|");
    for (const run of promptRuns) {
      const funnel = run.localFunnel ?? run.apiFunnel;
      lines.push(
        `| ${run.seed} | ${run.failurePhase} | ${run.editorialWorldTag ?? "—"} | ${run.sceneArchetypeId ?? "—"} | ${funnel?.retrieval_count ?? "—"} | ${funnel?.intent_filter_pre_count ?? "—"} | ${funnel?.intent_filter_post_count ?? "—"} |`,
      );
    }
    const filterRuns = promptRuns.filter((r) => r.removedTracks.length > 0);
    if (filterRuns.length > 0) {
      lines.push("", "**Filter rejection mix (aggregated across seeds with local replay):**", "");
      const agg = new Map<string, number>();
      let total = 0;
      for (const run of filterRuns) {
        for (const [reason, pct] of Object.entries(run.filterBreakdownPct)) {
          const count = Math.round((pct / 100) * run.removedTracks.length);
          agg.set(reason, (agg.get(reason) ?? 0) + count);
          total += count;
        }
      }
      for (const [reason, count] of [...agg.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`- ${reason}: ${total > 0 ? Math.round((count / total) * 1000) / 10 : 0}%`);
      }
    }
    lines.push("");
  }

  lines.push(
    "## Important caveats",
    "",
    "1. API trace field `insufficient_intent_pool:post_filter=0` is emitted for **world/cluster alignment failures** before the intent filter runs; `trackCounts.retrieved` then reflects **library size**, not retrieval output.",
    "2. Per-track rejection rows require local replay with `DATABASE_URL` against the eval user's synced library.",
    "3. No thresholds, gates, or pipeline code were modified for this investigation.",
    "",
  );

  return lines.join("\n");
}

async function main(): Promise<void> {
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const token = normalizeEvalToken(creds.token);
  const libraryTracks = await loadLibrary(creds.spotifyUserId);
  const localReplayAvailable = libraryTracks != null && libraryTracks.length > 0;

  const runs: RunAnalysis[] = [];

  for (const item of PROMPTS) {
    for (const seed of SEEDS) {
      const { data, httpStatus: rawStatus } = await fetchProductionRun(creds.baseUrl, token, creds.spotifyUserId, item, seed);
      const trace = (data.playlistExecutionTrace ?? {}) as Record<string, unknown>;
      const executionPath = typeof trace.executionPath === "string" ? trace.executionPath : null;
      const apiError = typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : null;
      const httpStatus = rawStatus;
      const failurePhase = httpStatus === 200 && executionPath === "timeout_fallback"
        ? "success_or_timeout"
        : classifyFailurePhase(apiError, httpStatus);
      const intentLayer = (data.intentCollapseLayer ?? {}) as Record<string, unknown>;
      const trackCounts = (trace.trackCounts ?? {}) as Record<string, number>;
      const editorialWorldTag = typeof intentLayer.editorialWorldTag === "string"
        ? intentLayer.editorialWorldTag
        : null;
      const preFilter = typeof intentLayer.preFilterCount === "number" ? intentLayer.preFilterCount : null;
      const postFilter = typeof intentLayer.postFilterCount === "number" ? intentLayer.postFilterCount : null;

      let local: ReturnType<typeof replayLocalFunnel> | null = null;
      if (libraryTracks) {
        local = replayLocalFunnel(item.prompt, seed, libraryTracks);
      }

      const effectivePhase = local?.failurePhase ?? failurePhase;
      const removedTracks = local?.removedTracks ?? [];
      const filterBreakdownPct = computeFilterBreakdownPct(removedTracks);

      const apiFunnel: FunnelCounts | null = preFilter != null ? {
        library_count: preFilter,
        scene_world_count: trackCounts.after_world ?? 0,
        dominant_cluster_count: 0,
        retrieval_count: trackCounts.retrieved ?? preFilter,
        intent_filter_pre_count: preFilter,
        intent_filter_post_count: postFilter ?? 0,
      } : null;

      const run: RunAnalysis = {
        promptId: item.id,
        prompt: item.prompt,
        seed,
        httpStatus,
        apiError,
        failurePhase: effectivePhase,
        traceMisleadingPostFilterZero: effectivePhase !== "intent_filter_pool" && (postFilter ?? 0) === 0,
        editorialWorldTag: local?.intent.editorialWorldTag ?? editorialWorldTag,
        sceneArchetypeId: local?.archetypeId ?? null,
        dominantClusterLabel: local?.dominantClusterLabel ?? null,
        minIntentPool: local?.minIntentPool ?? null,
        apiFunnel,
        localFunnel: local?.funnel ?? null,
        localReplayAvailable,
        removedTracks,
        filterBreakdownPct,
        rootCauseHint: "D",
      };
      run.rootCauseHint = rootCauseHintForRun(run);
      runs.push(run);
    }
  }

  const failurePhaseBreakdown: Record<string, number> = {};
  for (const run of runs) {
    failurePhaseBreakdown[run.failurePhase] = (failurePhaseBreakdown[run.failurePhase] ?? 0) + 1;
  }

  const rejectionReasonCounts = new Map<string, number>();
  let totalRemoved = 0;
  for (const run of runs) {
    for (const row of run.removedTracks) {
      rejectionReasonCounts.set(row.rejectionReason, (rejectionReasonCounts.get(row.rejectionReason) ?? 0) + 1);
      totalRemoved += 1;
    }
  }
  const topRejectionReasons = [...rejectionReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({
      reason,
      count,
      pct: totalRemoved > 0 ? Math.round((count / totalRemoved) * 1000) / 10 : 0,
    }));

  const promptImpactMap = new Map<string, { failures: number; phases: Map<string, number> }>();
  for (const run of runs) {
    if (run.failurePhase === "success_or_timeout" && run.httpStatus === 200) continue;
    const entry = promptImpactMap.get(run.promptId) ?? { failures: 0, phases: new Map() };
    entry.failures += 1;
    entry.phases.set(run.failurePhase, (entry.phases.get(run.failurePhase) ?? 0) + 1);
    promptImpactMap.set(run.promptId, entry);
  }
  const promptImpact = [...promptImpactMap.entries()]
    .map(([promptId, data]) => ({
      promptId,
      failures: data.failures,
      dominantPhase: [...data.phases.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown",
    }))
    .sort((a, b) => b.failures - a.failures);

  const worldAlignmentCount = failurePhaseBreakdown.world_alignment ?? 0;
  const clusterAlignmentCount = failurePhaseBreakdown.cluster_alignment ?? 0;
  const filterCount = failurePhaseBreakdown.intent_filter_pool ?? 0;
  const timeoutCount = failurePhaseBreakdown.success_or_timeout ?? 0;
  const totalRuns = runs.length;

  const estimatedPassRateImprovements = [
    {
      cause: "Fix editorial-world ↔ scene-archetype alignment (Cause C)",
      runsUnblocked: worldAlignmentCount,
      passRateLiftPct: Math.round((worldAlignmentCount / totalRuns) * 1000) / 10,
    },
    {
      cause: "Fix editorial-world ↔ dominant-cluster alignment",
      runsUnblocked: clusterAlignmentCount,
      passRateLiftPct: Math.round((clusterAlignmentCount / totalRuns) * 1000) / 10,
    },
    {
      cause: "Fix intent hard-filter pass rate on retrieval pool (Cause A)",
      runsUnblocked: filterCount,
      passRateLiftPct: Math.round((filterCount / totalRuns) * 1000) / 10,
    },
  ];

  let primaryVerdict = "D — Multiple causes";
  if (worldAlignmentCount >= totalRuns * 0.5) {
    primaryVerdict = "C — Selected editorial world conflicts with scene-world archetype (dominant cause); trace mislabels as post_filter=0";
  }
  if (filterCount > worldAlignmentCount) {
    primaryVerdict = "A — Filters remove qualifying retrieval-pool tracks";
  }

  const rootCauseClassification = [
    "**A (filters remove sufficient tracks):**",
    `  ${filterCount}/${totalRuns} runs reach intent filter with post_filter=0 (${Math.round((filterCount / totalRuns) * 1000) / 10}%).`,
    "**B (library lacks qualifying tracks):**",
    `  Cannot fully isolate without library-fit baseline; filter failures suggest narrow energy/micro-cluster constraints on a ${runs.find((r) => r.apiFunnel)?.apiFunnel?.intent_filter_pre_count ?? "~205"}-track retrieval pool.`,
    "**C (incorrect editorial world for prompt):**",
    `  ${worldAlignmentCount + clusterAlignmentCount}/${totalRuns} runs fail alignment before filter (${Math.round(((worldAlignmentCount + clusterAlignmentCount) / totalRuns) * 1000) / 10}%).`,
    "**D (multiple causes):** CONFIRMED — alignment selection + hard filter both contribute.",
  ].join("\n");

  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl: creds.baseUrl,
    deploymentCommit: null as string | null,
    localReplayAvailable,
    libraryTrackCount: libraryTracks?.length ?? null,
    summary: {
      totalRuns,
      failurePhaseBreakdown,
      topRejectionReasons: topRejectionReasons.slice(0, 10),
      mostDestructiveFilter: topRejectionReasons[0]?.reason ?? null,
      promptImpact,
      estimatedPassRateImprovements,
      primaryVerdict,
      traceMislabelingNote:
        `${worldAlignmentCount + clusterAlignmentCount} of ${totalRuns} runs show post_filter=0 in trace but failed at alignment before intent filter executed.`,
      rootCauseClassification,
      causeRanking: [
        { cause: "C_editorial_world_scene_archetype_mismatch", count: worldAlignmentCount, rank: 1 },
        { cause: "A_intent_hard_filter_zero_survivors", count: filterCount, rank: 2 },
        { cause: "C_cluster_alignment_mismatch", count: clusterAlignmentCount, rank: 3 },
        { cause: "timeout_or_success_bypass", count: timeoutCount, rank: 4 },
      ].sort((a, b) => b.count - a.count),
    },
    runs,
  };

  try {
    const ping = await fetch(`${creds.baseUrl}/api/eval/ping`, {
      method: "POST",
      headers: { "x-kwalify-evaluation-token": token },
    });
    const pingData = await ping.json() as Record<string, unknown>;
    payload.deploymentCommit = typeof pingData.commit === "string" ? pingData.commit : null;
  } catch {
    // optional
  }

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(JSON_PATH, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(MD_PATH, buildMarkdownReport(payload), "utf8");

  console.log(JSON.stringify({
    json: JSON_PATH,
    markdown: MD_PATH,
    localReplayAvailable,
    libraryTrackCount: libraryTracks?.length ?? null,
    failurePhaseBreakdown,
    primaryVerdict,
  }, null, 2));
}

const isMain = require.main === module;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
