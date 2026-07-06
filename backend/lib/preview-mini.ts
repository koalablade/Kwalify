import type { EmotionProfile } from "./emotion";
import { sampleTracksForProfile } from "./library-sample";
import { getUserGenreProfileForGenerate } from "./genre-profile-cache";

const PREVIEW_SCAN_MAX = 280;
const PREVIEW_PICK = 3;

function emotionFit(
  track: { energy: number | null; valence: number | null },
  profile: EmotionProfile
): number {
  const e = track.energy ?? 0.5;
  const v = track.valence ?? 0.5;
  return 1 - (Math.abs(e - profile.energy) + Math.abs(v - profile.valence)) / 2;
}

export interface PreviewMiniTrack {
  trackId: string;
  name: string;
  artist: string;
}

/**
 * Fast track hints for preview — uses warmed genre profile cache when available.
 */
export function pickPreviewMiniTracks<
  T extends {
    trackId: string;
    trackName: string;
    artistName: string;
    energy: number | null;
    valence: number | null;
  }
>(opts: {
  userId: string;
  tracks: T[];
  profile: EmotionProfile;
}): { tracks: PreviewMiniTrack[]; cacheHit: boolean } {
  if (!opts.tracks.length) {
    return { tracks: [], cacheHit: false };
  }

  const { cacheHit } = getUserGenreProfileForGenerate(
    opts.userId,
    opts.tracks.map((t) => ({
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: "",
      energy: t.energy,
      valence: t.valence,
      tempo: null,
      danceability: null,
      acousticness: null,
    })),
    ""
  );

  const pool =
    opts.tracks.length > PREVIEW_SCAN_MAX
      ? sampleTracksForProfile(opts.tracks, PREVIEW_SCAN_MAX, Date.now())
      : opts.tracks;

  const ranked = pool
    .map((t) => ({ t, fit: emotionFit(t, opts.profile) }))
    .sort((a, b) => b.fit - a.fit);

  const seenArtists = new Set<string>();
  const picks: PreviewMiniTrack[] = [];

  for (const { t } of ranked) {
    const artistKey = t.artistName.toLowerCase().trim();
    if (seenArtists.has(artistKey)) continue;
    seenArtists.add(artistKey);
    picks.push({
      trackId: t.trackId,
      name: t.trackName,
      artist: t.artistName,
    });
    if (picks.length >= PREVIEW_PICK) break;
  }

  return { tracks: picks, cacheHit };
}
