export interface ScoredTrack<TTrack = unknown> {
  trackId: string;
  score: number;
  features: Record<string, number>;
  track: TTrack;
}

export function scoreTracks<TTrack extends {
  trackId: string;
  score?: number;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
}>(
  tracks: TTrack[]
): Array<ScoredTrack<TTrack>> {
  return tracks.map((track) => ({
    trackId: track.trackId,
    score: track.score ?? 0.5,
    features: {
      energy: track.energy ?? 0.5,
      valence: track.valence ?? 0.5,
      tempo: track.tempo ?? 110,
      danceability: track.danceability ?? 0.5,
      acousticness: track.acousticness ?? 0.5,
    },
    track,
  }));
}
