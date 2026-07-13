import type { PipelineInvariantResult, PipelineValidationContext, PipelineValidationReport } from "./types";
import { enforcePerPlaylistArtistCap } from "../playlist-artist-cap";
import { isOpeningOrderPreserved } from "../opening-lock";
import { DELIVERY_OWNER, SCORING_OWNER } from "./types";
import {
  countDuplicateSongIdentities,
  countDuplicateTrackIds,
} from "./track-identity";

function invariant(
  id: string,
  pass: boolean,
  severity: "info" | "warn" | "error",
  expected: unknown,
  actual: unknown,
): PipelineInvariantResult {
  return { id, pass, severity, expected, actual };
}

function effectiveDeliveryLength(ctx: PipelineValidationContext): number {
  if (ctx.thinLibraryPolicy?.action === "honest_partial") {
    return Math.min(ctx.requestedLength, ctx.thinLibraryPolicy.targetLength);
  }
  return ctx.requestedLength;
}

/** Playlist quality / editorial invariants only — never authority mechanics. */
export function validatePlaylistQuality(ctx: PipelineValidationContext): PipelineValidationReport {
  const invariants: PipelineInvariantResult[] = [];
  const tracks = ctx.tracks;
  const deliveryLength = effectiveDeliveryLength(ctx);

  const artistCap = enforcePerPlaylistArtistCap(tracks, {
    vibe: ctx.vibe,
    playlistSize: ctx.requestedLength,
    promptCentralArtists: ctx.promptCentralArtists,
    defaultCap: ctx.maxPerArtist,
  });
  invariants.push(
    invariant(
      "artist_cap",
      artistCap.dropped === 0,
      ctx.checkpoint === "pre_response" ? "error" : "warn",
      "no artist over cap",
      { dropped: artistCap.dropped, cap: artistCap.cap },
    ),
  );

  const duplicateTrackIds = countDuplicateTrackIds(tracks);
  invariants.push(
    invariant(
      "duplicate_track_ids",
      duplicateTrackIds === 0,
      "error",
      0,
      duplicateTrackIds,
    ),
  );

  const duplicateIdentities = countDuplicateSongIdentities(tracks);
  invariants.push(
    invariant(
      "duplicate_song_identities",
      duplicateIdentities === 0,
      "error",
      0,
      duplicateIdentities,
    ),
  );

  invariants.push(
    invariant(
      "playlist_length",
      tracks.length <= deliveryLength,
      "error",
      `<= ${deliveryLength}`,
      tracks.length,
    ),
  );

  if (ctx.thinLibraryPolicy?.action === "honest_partial") {
    invariants.push(
      invariant(
        "thin_library_cap",
        tracks.length <= ctx.thinLibraryPolicy.targetLength,
        "error",
        `<= ${ctx.thinLibraryPolicy.targetLength}`,
        tracks.length,
      ),
    );
  }

  if (ctx.openingLock?.enabled) {
    const preserved = isOpeningOrderPreserved(tracks, ctx.openingLock);
    invariants.push(
      invariant(
        "opening_lock",
        preserved,
        ctx.checkpoint === "pre_response" ? "error" : "warn",
        ctx.openingLock.lockedTrackIds,
        tracks.slice(0, ctx.openingLock.lockedTrackIds.length).map((t) => t.trackId),
      ),
    );
  }

  if (ctx.hasExplicitGenreIntent && ctx.genreHardCheck) {
    const failures = tracks.filter((track) => !ctx.genreHardCheck!(track)).length;
    invariants.push(
      invariant(
        "genre_hard_constraints",
        failures === 0,
        ctx.checkpoint === "post_evidence" || ctx.checkpoint === "pre_response" ? "error" : "warn",
        0,
        failures,
      ),
    );
  }

  if (ctx.hasExplicitEraIntent && ctx.eraHardCheck) {
    const failures = tracks.filter((track) => !ctx.eraHardCheck!(track)).length;
    invariants.push(
      invariant(
        "era_hard_constraints",
        failures === 0,
        ctx.checkpoint === "post_evidence" || ctx.checkpoint === "pre_response" ? "error" : "warn",
        0,
        failures,
      ),
    );
  }

  if (
    ctx.genreEvidenceRequiredCount !== undefined &&
    ctx.genreEvidenceVerifiedCount !== undefined &&
    (ctx.checkpoint === "post_evidence" || ctx.checkpoint === "pre_response")
  ) {
    invariants.push(
      invariant(
        "genre_evidence_ratio",
        ctx.genreEvidenceVerifiedCount >= ctx.genreEvidenceRequiredCount || tracks.length === 0,
        "warn",
        `>= ${ctx.genreEvidenceRequiredCount}`,
        ctx.genreEvidenceVerifiedCount,
      ),
    );
  }

  if (ctx.checkpoint === "pre_response") {
    const emptyWithRecovery =
      tracks.length === 0 &&
      (ctx.recoveryPoolSize ?? 0) > 0;
    invariants.push(
      invariant(
        "recovery_floor_consistency",
        !emptyWithRecovery,
        "error",
        "non-empty when pools exist",
        { trackCount: tracks.length, recoveryPoolSize: ctx.recoveryPoolSize ?? 0 },
      ),
    );
  }

  if (ctx.requireTelemetry && (ctx.checkpoint === "post_refill" || ctx.checkpoint === "pre_response")) {
    const withTelemetry = tracks.filter(
      (track) => track.scoreBreakdown != null || track.scoreChannels != null,
    ).length;
    const coverage = tracks.length === 0 ? 1 : withTelemetry / tracks.length;
    invariants.push(
      invariant(
        "telemetry_coverage",
        coverage >= 1,
        ctx.checkpoint === "pre_response" ? "warn" : "info",
        1,
        coverage,
      ),
    );
  }

  if (ctx.confidence) {
    const percent = ctx.confidence.percent;
    invariants.push(
      invariant(
        "confidence_bounds",
        Number.isFinite(percent) && percent >= 0 && percent <= 100,
        "warn",
        "[0, 100]",
        percent,
      ),
    );
  }

  const violations = invariants.filter((entry) => !entry.pass);
  const hasError = violations.some((entry) => entry.severity === "error");
  const pass = !hasError;

  return {
    checkpoint: ctx.checkpoint,
    pass,
    trackCount: tracks.length,
    invariants,
    violations,
    ownership: {
      scoringOwner: SCORING_OWNER,
      deliveryOwner: DELIVERY_OWNER,
      lastMutationStage: ctx.lastMutationStage ?? null,
    },
    executedAt: new Date().toISOString(),
  };
}
