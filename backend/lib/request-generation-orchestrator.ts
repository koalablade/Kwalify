import {
  buildPlaylistPipeline,
  type BuildPlaylistPipelineOpts,
  type BuildPlaylistPipelineResult,
} from "../core/output";

export type RequestGenerationOrchestration = {
  layer: "request";
  candidateGenerator: "v3";
  selectionOwner: "request-layer";
  repairOwner: "request-layer";
};

type RequestGenerationTrack = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
};

export async function runRequestLayerGeneration<T extends RequestGenerationTrack>(
  opts: BuildPlaylistPipelineOpts<T>,
): Promise<BuildPlaylistPipelineResult<T> & { requestOrchestration: RequestGenerationOrchestration }> {
  const pipeline = await buildPlaylistPipeline(opts);
  return {
    ...pipeline,
    requestOrchestration: {
      layer: "request",
      candidateGenerator: "v3",
      selectionOwner: "request-layer",
      repairOwner: "request-layer",
    },
  };
}
