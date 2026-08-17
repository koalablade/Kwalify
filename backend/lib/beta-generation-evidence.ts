/**
 * Closed-beta generation evidence — append-only snapshots for human feedback correlation.
 * Observability only; does not affect playlist generation.
 */

import type { PlaylistExecutionTrace } from "../core/observability/playlist-execution-trace";
import { deploymentVersion } from "./deployment-version";
import { hashedIdTag } from "./pii";

/** Standard beta feedback reason codes (align with docs/beta-evidence-log.md categories). */
export const BETA_EVIDENCE_REASON_CODES = [
  "misunderstanding",
  "wrong_world",
  "taste",
  "repetition",
  "opening",
  "tail",
  "sequencing",
  "too_short",
  "generic",
  "library_limit",
  "ui",
  "expectation",
  "engine",
  "isolated",
] as const;

export type BetaEvidenceReasonCode = (typeof BETA_EVIDENCE_REASON_CODES)[number];
export type BetaEvidenceVerdict = "good" | "mixed" | "bad";

export type BetaEvidenceTrack = {
  position: number;
  name: string;
  artists: string[];
  album: string | null;
  spotifyId: string;
  spotifyUri: string;
  durationMs: number | null;
  releaseYear: number | null;
};

export type BetaGenerationEvidence = {
  kind: "generation";
  generationEvidenceId: string;
  requestId: string;
  userTag: string;
  capturedAt: string;
  kwalify: {
    version: string;
    commit: string;
    nodeEnv: string | null;
    hostMode: string | null;
  };
  prompt: {
    raw: string;
    length: number;
    mode: string;
    noLibraryMode: boolean;
  };
  interpretation: Record<string, unknown>;
  playlist: {
    title: string | null;
    description: string | null;
    requestedTrackCount: number;
    deliveredTrackCount: number;
    honestPartial: boolean;
    outcome: "success" | "partial" | "failure";
  };
  tracks: BetaEvidenceTrack[];
  artistDiversity: {
    uniqueArtistCount: number;
    repeatedArtists: Array<{ artist: string; count: number }>;
    maxTracksPerArtist: number;
  };
  pipeline: Record<string, unknown>;
  spotify: {
    playlistCreated: boolean;
    playlistId: string | null;
    playlistUrl: string | null;
    savedPlaylistId: string | null;
  };
};

export type BetaEvidenceFeedback = {
  kind: "feedback";
  generationEvidenceId: string;
  requestId: string;
  recordedAt: string;
  testerId?: string | null;
  verdict?: BetaEvidenceVerdict | null;
  reasons?: BetaEvidenceReasonCode[] | string[];
  ratings?: Record<string, number | boolean | string | null>;
  opinion?: string | null;
  trackFeedback?: Array<{
    position: number;
    verdict?: string | null;
    comment?: string | null;
  }>;
};

type ApiTrack = {
  id?: string;
  trackId?: string;
  name?: string;
  trackName?: string;
  artist?: string;
  artistName?: string;
  album?: string;
  albumName?: string;
  durationMs?: number | null;
  releaseYear?: number | null;
};

export function isBetaEvidenceCaptureEnabled(): boolean {
  const explicit = (process.env.BETA_EVIDENCE_CAPTURE ?? "").trim().toLowerCase();
  if (explicit === "0" || explicit === "false" || explicit === "off") return false;
  if (explicit === "1" || explicit === "true" || explicit === "on") return true;
  return process.env.KWALIFY_HOST_MODE === "selfhost";
}

export function buildArtistDiversity(tracks: BetaEvidenceTrack[]): BetaGenerationEvidence["artistDiversity"] {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const primary = track.artists[0]?.trim().toLowerCase() ?? "";
    if (!primary) continue;
    counts.set(primary, (counts.get(primary) ?? 0) + 1);
  }
  const repeatedArtists = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([artist, count]) => ({ artist, count }));
  const maxTracksPerArtist = repeatedArtists.length > 0 ? repeatedArtists[0]!.count : counts.size > 0 ? 1 : 0;
  return {
    uniqueArtistCount: counts.size,
    repeatedArtists,
    maxTracksPerArtist,
  };
}

export function mapApiTracksToEvidence(tracks: ApiTrack[]): BetaEvidenceTrack[] {
  return tracks
    .map((track, index) => {
      const spotifyId = String(track.id ?? track.trackId ?? "").trim();
      const name = String(track.name ?? track.trackName ?? "").trim();
      const artist = String(track.artist ?? track.artistName ?? "").trim();
      if (!spotifyId || !name) return null;
      return {
        position: index + 1,
        name,
        artists: artist ? [artist] : [],
        album: track.album ?? track.albumName ?? null,
        spotifyId,
        spotifyUri: `spotify:track:${spotifyId}`,
        durationMs: typeof track.durationMs === "number" ? track.durationMs : null,
        releaseYear: typeof track.releaseYear === "number" ? track.releaseYear : null,
      } satisfies BetaEvidenceTrack;
    })
    .filter((t): t is BetaEvidenceTrack => t !== null);
}

export function mapFeedbackTypeToVerdict(type: string): BetaEvidenceVerdict | null {
  switch (type) {
    case "captured":
    case "save":
      return "good";
    case "missed":
      return "bad";
    default:
      return null;
  }
}

export function buildBetaGenerationEvidence(input: {
  requestId: string;
  userTag?: string | null;
  prompt: string;
  mode: string;
  noLibraryMode: boolean;
  requestedTrackCount: number;
  tracks: ApiTrack[];
  playlistTitle?: string | null;
  playlistDescription?: string | null;
  honestPartial?: boolean;
  spotifyPlaylistId?: string | null;
  spotifyPlaylistUrl?: string | null;
  savedPlaylistId?: string | number | null;
  playlistExecutionTrace?: PlaylistExecutionTrace | null;
  interpretation?: Record<string, unknown>;
  pipelineExtras?: Record<string, unknown>;
  appVersion?: string;
}): BetaGenerationEvidence {
  const evidenceTracks = mapApiTracksToEvidence(input.tracks);
  const delivered = evidenceTracks.length;
  const requested = input.requestedTrackCount;
  const partial = input.honestPartial === true || (delivered > 0 && delivered < requested);
  const trace = input.playlistExecutionTrace;

  return {
    kind: "generation",
    generationEvidenceId: input.requestId,
    requestId: input.requestId,
    userTag: input.userTag ?? "anon",
    capturedAt: new Date().toISOString(),
    kwalify: {
      version: input.appVersion ?? process.env.npm_package_version ?? "1.0.0",
      commit: deploymentVersion(),
      nodeEnv: process.env.NODE_ENV ?? null,
      hostMode: process.env.KWALIFY_HOST_MODE ?? null,
    },
    prompt: {
      raw: input.prompt,
      length: input.prompt.length,
      mode: input.mode,
      noLibraryMode: input.noLibraryMode,
    },
    interpretation: input.interpretation ?? {},
    playlist: {
      title: input.playlistTitle ?? null,
      description: input.playlistDescription ?? null,
      requestedTrackCount: requested,
      deliveredTrackCount: delivered,
      honestPartial: partial,
      outcome: delivered === 0 ? "failure" : partial ? "partial" : "success",
    },
    tracks: evidenceTracks,
    artistDiversity: buildArtistDiversity(evidenceTracks),
    pipeline: {
      executionPath: trace?.executionPath ?? null,
      humanSaveable: trace?.humanSaveable ?? null,
      trackCounts: trace?.trackCounts ?? null,
      rejectionReasons: trace?.rejectionReasons ?? [],
      funnelCollapseStage: trace?.funnelCollapseStage ?? null,
      dominantCluster: trace?.dominantCluster ?? null,
      ...(input.pipelineExtras ?? {}),
    },
    spotify: {
      playlistCreated: Boolean(input.spotifyPlaylistId || input.spotifyPlaylistUrl),
      playlistId: input.spotifyPlaylistId ?? null,
      playlistUrl: input.spotifyPlaylistUrl ?? null,
      savedPlaylistId:
        input.savedPlaylistId != null && input.savedPlaylistId !== 0
          ? String(input.savedPlaylistId)
          : null,
    },
  };
}

export function formatEvidenceMarkdown(record: BetaGenerationEvidence, feedback?: BetaEvidenceFeedback | null): string {
  const lines: string[] = [
    "--------------------------------",
    "KWALIFY GENERATION EVIDENCE",
    "--------------------------------",
    "",
    `Evidence ID: ${record.generationEvidenceId}`,
    `Request ID: ${record.requestId}`,
    `User tag: ${record.userTag}`,
    "",
    "Kwalify:",
    `  commit: ${record.kwalify.commit}`,
    `  version: ${record.kwalify.version}`,
    `  environment: ${record.kwalify.nodeEnv ?? "unknown"}`,
    `  captured: ${record.capturedAt}`,
    "",
    "Prompt:",
    record.prompt.raw,
    "",
    "Interpretation:",
    ...Object.entries(record.interpretation).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`),
    "",
    "Playlist:",
    `  title: ${record.playlist.title ?? ""}`,
    `  requested: ${record.playlist.requestedTrackCount}`,
    `  delivered: ${record.playlist.deliveredTrackCount}`,
    `  outcome: ${record.playlist.outcome}`,
    "",
  ];
  for (const track of record.tracks) {
    lines.push(`${track.position}. ${track.name} — ${track.artists.join(", ")} — ${track.album ?? ""}`);
  }
  lines.push(
    "",
    "Artist diversity:",
    `  unique artists: ${record.artistDiversity.uniqueArtistCount}`,
    `  max per artist: ${record.artistDiversity.maxTracksPerArtist}`,
    ...(record.artistDiversity.repeatedArtists.length
      ? record.artistDiversity.repeatedArtists.map((r) => `  repeat: ${r.artist} (${r.count})`)
      : []),
    "",
    "Pipeline:",
    ...Object.entries(record.pipeline).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`),
    "",
    "Spotify:",
    `  created: ${record.spotify.playlistCreated ? "yes" : "no"}`,
    `  playlist ID: ${record.spotify.playlistId ?? ""}`,
    "",
  );
  if (feedback) {
    lines.push(
      "USER FEEDBACK:",
      `  recorded: ${feedback.recordedAt}`,
      ...(feedback.verdict ? [`  verdict: ${feedback.verdict}`] : []),
      ...(feedback.reasons?.length ? [`  reasons: ${feedback.reasons.join(", ")}`] : []),
      ...(feedback.opinion ? [`  opinion: ${feedback.opinion}`] : []),
      ...(feedback.ratings
        ? Object.entries(feedback.ratings).map(([k, v]) => `  ${k}: ${String(v)}`)
        : []),
      ...(feedback.trackFeedback?.length
        ? feedback.trackFeedback.map(
            (tf) => `  track ${tf.position}: ${tf.verdict ?? ""} ${tf.comment ?? ""}`.trim(),
          )
        : []),
      "",
    );
  }
  lines.push("--------------------------------");
  return lines.join("\n");
}
