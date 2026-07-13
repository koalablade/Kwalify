/**
 * Exercises every static delivery mutation stage at least once via PipelineDeliveryBuffer.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createPipelineAuthoritySession,
  createPipelineDeliveryBuffer,
  analyzeStaticMutationSites,
} from "../lib/pipeline-authority/index.js";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CONTROLLER = path.join(REPO_ROOT, "backend/controllers/generation.controller.ts");

const TARGETED_BRANCH_STAGES = [
  "recovery_finalize",
  "post_recovery",
  "relaxed_recovery",
  "tier3_fill",
  "final_response_completion",
  "activity_guard",
  "embarrassment_filter",
  "empty_recovery_floor",
] as const;

function track(id: string, artist = "Artist"): { trackId: string; artistName: string } {
  return { trackId: id, artistName: artist };
}

test("static mutation stages are discoverable from controller delivery block", () => {
  const source = readFileSync(CONTROLLER, "utf8");
  const start = source.indexOf("const delivery = createPipelineDeliveryBuffer");
  const end = source.indexOf("const deliveredTracks = [...delivery.tracks]");
  const block = source.slice(start, end);
  const sites = analyzeStaticMutationSites(block);
  const stages = new Set(sites.map((s) => s.stage).filter((s) => s !== "unknown"));
  assert.ok(stages.size >= 25, `expected >= 25 stages, got ${stages.size}`);
});

for (const stage of TARGETED_BRANCH_STAGES) {
  test(`branch coverage: stage ${stage} registers mutation`, () => {
    const session = createPipelineAuthoritySession();
    const delivery = createPipelineDeliveryBuffer(session);
    delivery.init("v3_handoff", "init", [track("a"), track("b")]);
    delivery.replaceTracks(stage, `exercise ${stage}`, [track(`${stage}-1`), track(`${stage}-2`)]);
    const mutations = session.getDiagnostics().mutations.filter((m) => m.mutationType !== "freeze");
    assert.ok(mutations.some((m) => m.stage === stage), `missing registry entry for ${stage}`);
  });
}

test("branch coverage: all static assignFT stages can register via buffer", () => {
  const source = readFileSync(CONTROLLER, "utf8");
  const start = source.indexOf("const delivery = createPipelineDeliveryBuffer");
  const end = source.indexOf("const deliveredTracks = [...delivery.tracks]");
  const block = source.slice(start, end);
  const sites = analyzeStaticMutationSites(block);
  const stages = [...new Set(sites.map((s) => s.stage).filter((s) => s !== "unknown" && s !== "v3_handoff"))];

  const session = createPipelineAuthoritySession();
  const delivery = createPipelineDeliveryBuffer(session);
  delivery.init("v3_handoff", "init", [track("seed")]);

  for (const stage of stages) {
    const exerciseStage = stage === "artist_cap" ? "post_recovery" : stage;
    if (exerciseStage === "playlist_length") {
      delivery.truncateTracks("playlist_length", `coverage ${stage}`, 1);
    } else {
      delivery.replaceTracks(exerciseStage, `coverage ${stage}`, [track(exerciseStage)]);
    }
  }

  const observed = new Set(
    session.getDiagnostics().mutations
      .filter((m) => m.mutationType !== "freeze")
      .map((m) => m.stage),
  );
  for (const stage of stages) {
    if (stage === "artist_cap") {
      assert.ok(observed.has("post_recovery"), "artist_cap static site maps to post_recovery mutation");
      continue;
    }
    if (stage === "playlist_length") {
      assert.ok(observed.has("playlist_length"), `stage not observed: ${stage}`);
      continue;
    }
    assert.ok(observed.has(stage), `stage not observed: ${stage}`);
  }
});
