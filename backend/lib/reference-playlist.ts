import {
  fetchAudioFeatures,
  fetchPlaylistTrackIds,
  getClientCredentialsToken,
  parseSpotifyPlaylistId,
  type SpotifyAudioFeatures,
} from "./spotify";
import type { EmotionProfile } from "./emotion";

interface SongFeatures {
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
}

export { parseSpotifyPlaylistId };

export interface ReferenceFingerprint {
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  tempo: number;
  tension: number;
  nostalgia: number;
  calm: number;
  sampleCount: number;
}

function clamp(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n));
}

function median(values: number[]): number {
  if (values.length === 0) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function buildFingerprint(features: SpotifyAudioFeatures[]): ReferenceFingerprint | null {
  const valid = features.filter(
    (f) => f && typeof f.energy === "number" && typeof f.valence === "number"
  );
  if (valid.length < 5) return null;

  const energy = median(valid.map((f) => f.energy));
  const valence = median(valid.map((f) => f.valence));
  const danceability = median(valid.map((f) => f.danceability ?? 0.5));
  const acousticness = median(valid.map((f) => f.acousticness ?? 0.5));
  const tempo = median(valid.map((f) => f.tempo ?? 120));

  const tension = clamp(energy * 0.55 + (1 - valence) * 0.45);
  const nostalgia = clamp(acousticness * 0.7 + (1 - danceability) * 0.2);
  const calm = clamp((1 - energy) * 0.45 + acousticness * 0.35 + (1 - tension) * 0.2);

  return {
    energy,
    valence,
    danceability,
    acousticness,
    tempo,
    tension,
    nostalgia,
    calm,
    sampleCount: valid.length,
  };
}

export function fingerprintToEmotionProfile(fp: ReferenceFingerprint): EmotionProfile {
  let timeOfDay: string | null = null;
  if (fp.energy < 0.42 && fp.valence < 0.48) timeOfDay = "late_night";
  else if (fp.valence >= 0.58 && fp.energy >= 0.5) timeOfDay = "day";

  return {
    energy: fp.energy,
    valence: fp.valence,
    tension: fp.tension,
    nostalgia: fp.nostalgia,
    calm: fp.calm,
    environment: null,
    timeOfDay,
    motionState: null,
  };
}

export function blendEmotionProfiles(
  text: EmotionProfile,
  ref: EmotionProfile,
  refWeight: number
): EmotionProfile {
  const w = clamp(refWeight);
  const t = 1 - w;
  return {
    energy: text.energy * t + ref.energy * w,
    valence: text.valence * t + ref.valence * w,
    tension: text.tension * t + ref.tension * w,
    nostalgia: text.nostalgia * t + ref.nostalgia * w,
    calm: text.calm * t + ref.calm * w,
    environment: w >= 0.45 ? (ref.environment ?? text.environment) : text.environment,
    timeOfDay: w >= 0.45 ? (ref.timeOfDay ?? text.timeOfDay) : text.timeOfDay ?? ref.timeOfDay,
    motionState: text.motionState ?? ref.motionState,
  };
}

/** How closely a liked song matches the reference playlist's audio fingerprint (0–1). */
export function referenceSimilarity(song: SongFeatures, fp: ReferenceFingerprint): number {
  const normTempo = song.tempo != null ? clamp((song.tempo - 60) / 140) : 0.5;
  const refNormTempo = clamp((fp.tempo - 60) / 140);

  const e = song.energy ?? 0.5;
  const v = song.valence ?? 0.5;
  const d = song.danceability ?? 0.5;
  const a = song.acousticness ?? 0.5;

  const delta =
    Math.abs(e - fp.energy) * 0.28 +
    Math.abs(v - fp.valence) * 0.32 +
    Math.abs(d - fp.danceability) * 0.22 +
    Math.abs(a - fp.acousticness) * 0.1 +
    Math.abs(normTempo - refNormTempo) * 0.08;

  return clamp(1 - delta);
}

export function referenceSimilarityBonus(
  song: SongFeatures,
  fp: ReferenceFingerprint,
  mode: "strict" | "balanced" | "chaotic"
): number {
  const sim = referenceSimilarity(song, fp);
  const scale = mode === "strict" ? 0.32 : mode === "balanced" ? 0.26 : 0.18;
  return sim * scale;
}

export async function loadReferenceFingerprint(
  userAccessToken: string,
  playlistUrlOrId: string,
  maxTracks = 100
): Promise<{ fingerprint: ReferenceFingerprint; playlistId: string } | null> {
  const playlistId = parseSpotifyPlaylistId(playlistUrlOrId);
  if (!playlistId) return null;

  let trackIds = await fetchPlaylistTrackIds(userAccessToken, playlistId, maxTracks);
  if (trackIds.length < 5) {
    try {
      const cc = await getClientCredentialsToken();
      trackIds = await fetchPlaylistTrackIds(cc, playlistId, maxTracks);
    } catch {
      /* keep empty */
    }
  }
  if (trackIds.length < 5) return null;

  const ccToken = await getClientCredentialsToken();
  const features = await fetchAudioFeatures(ccToken, trackIds);
  const fingerprint = buildFingerprint(features);
  if (!fingerprint) return null;

  return { fingerprint, playlistId };
}
