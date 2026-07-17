/**
 * Human embarrassment filter — remove tracks that make users ask "why is this here?"
 */

import { trackHasKnownEraMismatch } from "./era-evidence";
import { playlistFrequencyMultiplier } from "./playlist-frequency-penalty";

export type EmbarrassmentTrack = {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  releaseYear?: number | null;
  popularity?: number | null;
  energy?: number | null;
};

const MEME_ARTIST_RE = /\b(?:jack stauber|yung gravy|tommy cash|bbno\$|100 gecs|ojard|rat boy)\b/i;
const OBVIOUS_HOLIDAY_RE = /\b(?:last christmas|all i want for christmas|jingle bell|white christmas|feliz navidad)\b/i;

export function embarrassmentReason(
  track: EmbarrassmentTrack,
  opts: {
    vibe: string;
    eraRange?: { start: number; end: number } | null;
    frequencyPenalty?: Map<string, number>;
    nichePrompt?: boolean;
  },
): string | null {
  const text = `${track.trackName ?? ""} ${track.artistName ?? ""}`.toLowerCase();
  if (opts.eraRange && trackHasKnownEraMismatch(track, opts.eraRange)) {
    return "wrong_era";
  }
  if (MEME_ARTIST_RE.test(text)) return "meme_association";
  if (OBVIOUS_HOLIDAY_RE.test(text) && !/\b(?:christmas|xmas|festive|holiday\s+song|christmas\s+holiday|winter\s+holiday)\b/i.test(opts.vibe)) {
    return "seasonal_mismatch";
  }
  const freq = opts.frequencyPenalty?.get(track.trackId);
  if (freq != null && freq <= 0.35) return "overused_in_recent_playlists";
  if (opts.nichePrompt && typeof track.popularity === "number" && track.popularity >= 88) {
    return "too_obvious_for_niche_prompt";
  }
  const count = freq != null ? Math.round((1 - freq) * 20) : 0;
  if (count >= 15) return "playlist_fatigue";
  return null;
}

export function filterEmbarrassingTracks<T extends EmbarrassmentTrack>(
  tracks: T[],
  opts: {
    vibe: string;
    eraRange?: { start: number; end: number } | null;
    frequencyPenalty?: Map<string, number>;
    nichePrompt?: boolean;
    minKeep?: number;
  },
): { tracks: T[]; removed: Array<{ trackId: string; reason: string }> } {
  const minKeep = opts.minKeep ?? Math.max(8, Math.ceil(tracks.length * 0.65));
  const removed: Array<{ trackId: string; reason: string }> = [];
  const kept: T[] = [];
  for (const track of tracks) {
    const reason = embarrassmentReason(track, opts);
    if (reason && kept.length >= minKeep) {
      removed.push({ trackId: track.trackId, reason });
      continue;
    }
    if (reason && kept.length < minKeep) {
      removed.push({ trackId: track.trackId, reason: `${reason}_tail_kept` });
    }
    kept.push(track);
  }
  return { tracks: kept, removed };
}

export function buildFrequencyPenaltyFromSession(
  previousTrackIds: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of previousTrackIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const [id, count] of counts) out.set(id, playlistFrequencyMultiplier(count));
  return out;
}
