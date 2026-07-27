/**
 * Fallback UX payload — when generation truly cannot deliver, explain options instead of silent bad playlists.
 */

import type { LockedIntent } from "../core/v3/intent";
import type { LibraryCapability } from "./playlist-retrieval-orchestrator";

export type FallbackSuggestionOption = {
  id: "discovery_blend" | "library_closest" | "broaden_prompt" | "add_favourites";
  label: string;
  description: string;
};

export type FallbackUxPayload = {
  message: string;
  silentFallbackBlocked: boolean;
  options: FallbackSuggestionOption[];
  limitingFactors: string[];
};

export function buildFallbackUxPayload(opts: {
  vibe: string;
  lockedIntent: LockedIntent;
  libraryCapability?: LibraryCapability | null;
  limitingFactors?: string[];
  identityFailures?: string[];
  genreLabel?: string | null;
  noLibraryMode?: boolean;
}): FallbackUxPayload {
  if (opts.noLibraryMode) {
    return buildNoLibraryFallbackUx(opts);
  }
  const genreHint = opts.genreLabel
    ?? (opts.lockedIntent.genreFamilies[0] ?? opts.lockedIntent.primaryGenre ?? null);
  const eraHint = opts.lockedIntent.eraRange
    ? `${opts.lockedIntent.eraRange.start}s–${opts.lockedIntent.eraRange.end}s`
    : null;
  const activityHint = opts.lockedIntent.activity ?? null;

  const parts = [
    genreHint ? `${genreHint}` : null,
    eraHint,
    activityHint,
  ].filter((p): p is string => !!p);

  const subject = parts.length > 0 ? parts.join(" ") : opts.vibe.trim() || "this prompt";
  const message = `Your library has limited high-confidence matches for ${subject}. I can still help, but a generic playlist would not represent what you asked for.`;

  const options: FallbackSuggestionOption[] = [
    {
      id: "discovery_blend",
      label: "Disco-inspired blend from your library",
      description: "Combine closest era, genre-adjacent, and danceable tracks instead of generic fillers.",
    },
    {
      id: "library_closest",
      label: "Closest match from your liked songs",
      description: "Use the best available matches from your library with clear identity trade-offs.",
    },
    {
      id: "broaden_prompt",
      label: "Broaden the prompt slightly",
      description: eraHint
        ? `Try widening era (e.g. late ${eraHint}) or dropping one constraint.`
        : "Try a slightly broader wording while keeping the core mood.",
    },
    {
      id: "add_favourites",
      label: "Add more on-theme favourites",
      description: genreHint
        ? `Like more ${genreHint} tracks on Spotify to strengthen future playlists.`
        : "Like more tracks that match this vibe to improve supply.",
    },
  ];

  return {
    message,
    silentFallbackBlocked: true,
    options,
    limitingFactors: [
      ...(opts.limitingFactors ?? []),
      ...(opts.identityFailures ?? []),
    ],
  };
}

export function buildNoLibraryFallbackUx(opts: {
  vibe: string;
  lockedIntent: LockedIntent;
  genreLabel?: string | null;
}): FallbackUxPayload {
  const genreHint = opts.genreLabel
    ?? (opts.lockedIntent.genreFamilies[0] ?? opts.lockedIntent.primaryGenre ?? null);
  const subject = genreHint || opts.vibe.trim() || "this prompt";
  return {
    message: `Spotify search did not find enough on-genre tracks for ${subject}. Try a broader genre, switch to Balanced mode, or turn off Discovery Mode to use your liked songs.`,
    silentFallbackBlocked: true,
    options: [
      {
        id: "broaden_prompt",
        label: "Broaden the prompt",
        description: "Add a wider era or drop one constraint (e.g. 90s party instead of 1994 garage).",
      },
      {
        id: "library_closest",
        label: "Use your liked songs instead",
        description: "Turn off Discovery Mode and generate from your library.",
      },
      {
        id: "discovery_blend",
        label: "Try Balanced mode",
        description: "Balanced mode is more forgiving when Spotify search supply is thin.",
      },
      {
        id: "add_favourites",
        label: "Like more on-theme tracks",
        description: genreHint
          ? `Like more ${genreHint} tracks on Spotify for better future playlists.`
          : "Like more tracks that match this vibe on Spotify.",
      },
    ],
    limitingFactors: ["spotify_search_supply"],
  };
}
