import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeVibe } from "../lib/emotion";
import { buildLockedIntent } from "../core/v3/intent";
import {
  buildIntentDecomposerDiagnostics,
  decomposeIntent,
  isInfluenceMapUnclear,
  shouldUseFallbackEnsemble,
} from "../core/v3/intent-decomposer";
import { buildLanes } from "../core/v3/lane-router";

describe("compound intent fallback routing", () => {
  it("party-70s-disco suppresses rock fallback and preserves adjacent genre lanes", () => {
    const vibe = "70s disco party dancefloor";
    const profile = analyzeVibe(vibe);
    const locked = buildLockedIntent(vibe);
    const decomposed = decomposeIntent(vibe, profile);
    const diagnostics = buildIntentDecomposerDiagnostics(decomposed, vibe, locked);
    const lanes = buildLanes(decomposed, { vibe, lockedIntent: locked });

    assert.equal(isInfluenceMapUnclear(decomposed), true, "influence map remains sparse (party-only)");
    assert.equal(diagnostics.isCompoundIntent, true);
    assert.equal(diagnostics.fallbackSuppressed, true);
    assert.equal(diagnostics.fallbackReason, "compound_anchors_preserve_genre");
    assert.equal(shouldUseFallbackEnsemble(decomposed, vibe, locked), false);

    const laneIds = lanes.map((lane) => lane.id);
    assert.ok(!laneIds.includes("lane_mainstream"), "must not use rock-biased mainstream fallback");
    assert.ok(!laneIds.includes("lane_nostalgia"), "must not use rock-biased nostalgia fallback");
    assert.ok(laneIds.includes("lane_core"), "must keep core lane");
    assert.ok(laneIds.includes("lane_contrast"), "must keep contrast lane");

    const coreBonus = lanes.find((lane) => lane.id === "lane_core")?.scoringBias.genreBonus ?? {};
    assert.ok(
      ["soul", "funk", "disco", "pop", "rnb"].some((family) => (coreBonus[family] ?? 0) > 0),
      `core genreBonus should preserve disco-adjacent families, got ${JSON.stringify(coreBonus)}`,
    );
    assert.ok((coreBonus.rock ?? 0) === 0, "core must not inject rock bonus");
  });

  it("generic unclear prompts still receive fallback ensemble", () => {
    const vibe = "something chill tonight";
    const profile = analyzeVibe(vibe);
    const locked = buildLockedIntent(vibe);
    const decomposed = decomposeIntent(vibe, profile);
    const diagnostics = buildIntentDecomposerDiagnostics(decomposed, vibe, locked);
    const lanes = buildLanes(decomposed, { vibe, lockedIntent: locked });

    assert.equal(diagnostics.isCompoundIntent, false);
    assert.equal(diagnostics.fallbackSuppressed, false);
    assert.equal(shouldUseFallbackEnsemble(decomposed, vibe, locked), true);
    assert.equal(diagnostics.fallbackReason, "unclear_intent_multi_lane_ensemble");

    const laneIds = lanes.map((lane) => lane.id);
    assert.deepEqual(laneIds, [
      "lane_mainstream",
      "lane_nostalgia",
      "lane_discovery",
      "lane_ambient",
    ]);
  });

  it("latin force injection behaviour remains unchanged (no unclear fallback)", () => {
    const vibe = "latin summer beach party";
    const profile = analyzeVibe(vibe);
    const locked = buildLockedIntent(vibe);
    const decomposed = decomposeIntent(vibe, profile);
    const diagnostics = buildIntentDecomposerDiagnostics(decomposed, vibe, locked);
    const lanes = buildLanes(decomposed, { vibe, lockedIntent: locked });

    assert.equal(isInfluenceMapUnclear(decomposed), false, "latin still injects multi-force map");
    assert.equal(shouldUseFallbackEnsemble(decomposed, vibe, locked), false);
    assert.equal(diagnostics.fallbackSuppressed, false);
    assert.ok(
      diagnostics.fallbackReason === "nominal" || diagnostics.fallbackReason === "clear_influence_map",
    );

    const laneIds = lanes.map((lane) => lane.id);
    assert.ok(!laneIds.includes("lane_mainstream"));
    assert.ok(laneIds.includes("lane_core"));
    assert.ok(Object.keys(decomposed.sceneInfluenceMap).length >= 2);
  });
});
