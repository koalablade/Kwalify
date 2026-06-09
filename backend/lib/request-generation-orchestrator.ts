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

export function runRequestLayerGeneration<T extends { trackId: string }>(
  opts: BuildPlaylistPipelineOpts<T>,
): BuildPlaylistPipelineResult<T> & { requestOrchestration: RequestGenerationOrchestration } {
  const pipeline = buildPlaylistPipeline(opts);
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
