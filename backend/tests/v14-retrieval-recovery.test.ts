import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import {
  beginRejectionTrace,
  recordRetrievalRejection,
  getRejectionStats,
  getRejectionTrace,
  diagnoseRetrievalShortfall,
} from "../core/editorial/retrieval-rejection-trace";
import {
  getNeighbourWorlds,
  isNeighbourExcluded,
} from "../core/editorial/world-neighbour-graph";
import {
  buildTieredExpansionQueries,
  capArtistDiversityInPool,
  filterWorldAnchorCandidates,
} from "../core/editorial/world-anchor-retrieval";
import {
  worldPurityThresholdForPosition,
  filterByWorldPurity,
} from "../core/editorial/world-purity-gate";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";

describe("V14 retrieval recovery", () => {
  it("rejection trace records rejections and aggregates stats", () => {
    beginRejectionTrace();
    recordRetrievalRejection({
      worldId: "madchester_world",
      artistName: "Bon Iver",
      trackName: "Skinny Love",
      reason: "avoid_artist",
      stage: "expansion_filter",
      expansionSource: "deep_cuts",
    });
    recordRetrievalRejection({
      worldId: "madchester_world",
      artistName: "Phoebe Bridgers",
      trackName: "Motion Sickness",
      reason: "avoid_artist",
      stage: "purity_gate",
      worldIdentityScore: 0.2,
    });

    const stats = getRejectionStats("madchester_world");
    assert.equal(stats.total, 2);
    assert.equal(stats.byStage.expansion_filter, 1);
    assert.equal(stats.byStage.purity_gate, 1);
    assert.equal(getRejectionTrace().length, 2);
  });

  it("neighbour graph does not include bedroom indie / lofi for madchester", () => {
    const neighbours = getNeighbourWorlds("madchester_world");
    assert.ok(!neighbours.includes("lofi_world"));
    assert.ok(!neighbours.includes("focus_study_world"));
    assert.ok(!neighbours.includes("chill_rainy_world"));
    assert.ok(isNeighbourExcluded("madchester_world", "lofi_world"));
    assert.ok(neighbours.includes("britpop_world"));
  });

  it("tiered expansion includes deep cuts and forgotten artists tiers", () => {
    const profile = getCulturalProfile("madchester_world")!;
    const round0 = buildTieredExpansionQueries(profile, 0);
    const round1 = buildTieredExpansionQueries(profile, 1);
    const allTiers = [...round0, ...round1].map((b) => b.tier);
    assert.ok(allTiers.includes("deep_cut"));
    assert.ok(allTiers.includes("forgotten") || round1.some((b) => b.tier === "forgotten"));
    assert.ok(allTiers.includes("cult") || round1.some((b) => b.tier === "cult"));
  });

  it("artist diversity cap limits same artist in pool", () => {
    const profile = getCulturalProfile("classic_rock_world")!;
    const tracks = Array.from({ length: 8 }, (_, i) => ({
      artistName: "Queen",
      trackName: `Track ${i + 1}`,
      energy: 0.75,
    }));
    const capped = capArtistDiversityInPool(tracks, profile, 3, profile.worldId);
    assert.equal(capped.length, 3);
    assert.equal(capped.filter((t) => t.artistName === "Queen").length, 3);
  });

  it("expansion filter rejects forbidden artists for dad rock", () => {
    const world = resolveCommittedWorld({ prompt: "dad rock BBQ with beers" })!;
    const profile = getCulturalProfile(world.id)!;
    const worldIds = world.worldIds ?? [world.id];
    const filtered = filterWorldAnchorCandidates(
      [
        { artistName: "Bon Iver", trackName: "Skinny Love", energy: 0.4 },
        { artistName: "Queen", trackName: "Don't Stop Me Now", energy: 0.78 },
        { artistName: "Tom Petty", trackName: "Free Fallin'", energy: 0.62 },
      ],
      profile,
      worldIds,
    );
    assert.ok(!filtered.some((t) => t.artistName === "Bon Iver"));
    assert.ok(filtered.some((t) => t.artistName === "Queen"));
    assert.ok(filtered.some((t) => t.artistName === "Tom Petty"));
  });

  it("acceptable adjacency boosts world identity for classic rock", () => {
    const profile = getCulturalProfile("classic_rock_world")!;
    const journeyScore = scoreTrackWorldIdentity(
      { artistName: "Journey", trackName: "Don't Stop Believin'", energy: 0.72 },
      profile,
    );
    assert.ok(journeyScore >= 0.78);
  });

  it("diagnoseRetrievalShortfall suggests deep cuts when pool is thin", () => {
    beginRejectionTrace();
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const { suggestions, gap } = diagnoseRetrievalShortfall(
      profile.worldId,
      getRejectionTrace(),
      5,
      25,
      profile,
    );
    assert.equal(gap, 20);
    assert.ok(suggestions.some((s) => s.includes("deep_cuts") || s.includes("neighbour")));
  });

  it("V14 purity gate thresholds: 95/90/85/80", () => {
    assert.equal(worldPurityThresholdForPosition(0), 95);
    assert.equal(worldPurityThresholdForPosition(1), 95);
    assert.equal(worldPurityThresholdForPosition(2), 90);
    assert.equal(worldPurityThresholdForPosition(4), 90);
    assert.equal(worldPurityThresholdForPosition(5), 85);
    assert.equal(worldPurityThresholdForPosition(9), 85);
    assert.equal(worldPurityThresholdForPosition(10), 80);
    assert.equal(worldPurityThresholdForPosition(20), 80);

    const world = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const tracks = Array.from({ length: 12 }, (_, i) => ({
      artistName: i < 5 ? "The Cure" : "Pet Shop Boys",
      trackName: `Track ${i + 1}`,
      energy: 0.6,
    }));
    const filtered = filterByWorldPurity(tracks, world);
    assert.ok(filtered.tracks.length >= 5);
  });
});
