export function buildFallbackExplanation(opts: {
  fastFallback?: boolean;
  spotifyPartial?: boolean;
  spotifyUnavailable?: boolean;
  featureCoverage?: number;
  insufficientMatches?: boolean;
}): string | null {
  const parts: string[] = [];

  if (opts.fastFallback) {
    parts.push(
      "Generation used a simplified path because scoring ran out of time — results may be less tailored to your vibe."
    );
  }

  if (opts.spotifyPartial) {
    parts.push("Some tracks were unavailable during Spotify playlist creation.");
  }

  if (opts.spotifyUnavailable && !opts.spotifyPartial) {
    parts.push("Your playlist was built locally; Spotify playlist creation did not complete.");
  }

  const coverage = opts.featureCoverage ?? 100;
  if (coverage < 50 && !opts.fastFallback) {
    parts.push(
      "We used partial library data due to missing audio features on many liked songs."
    );
  }

  if (opts.insufficientMatches) {
    parts.push(
      "Not enough tracks matched this vibe with your library, even after relaxing constraints."
    );
  }

  if (parts.length === 0) return null;
  return parts.join(" ");
}

/** Subtle title suffix when generation used degraded data — transparent, not alarming. */
export function applyFallbackPlaylistTitle(
  baseName: string,
  fallbackExplanation: string | null | undefined
): string {
  if (!fallbackExplanation || baseName.includes("(")) return baseName;

  const lower = fallbackExplanation.toLowerCase();
  if (lower.includes("partial library") || lower.includes("missing audio features")) {
    return `${baseName} (built from partial library data)`;
  }
  if (lower.includes("simplified path") || lower.includes("time")) {
    return `${baseName} (quick-build version)`;
  }
  if (lower.includes("unavailable during spotify")) {
    return `${baseName} (partial Spotify sync)`;
  }
  if (lower.includes("not enough tracks")) {
    return baseName;
  }
  return `${baseName} (expanded library match)`;
}
