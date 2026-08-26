import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";
import {
  enforceThesisOpener,
  selectThesisOpener,
} from "../core/editorial/thesis-opener-gate";
import {
  applyWorldPurityGate,
  filterByWorldPurity,
  worldPurityThresholdForPosition,
  scoreTrackPurityPercent,
} from "../core/editorial/world-purity-gate";
import {
  assessCandidateCoverageTier,
  getDeliveryCap,
  getDeliveryTarget,
  buildDeliveryMessage,
  countGenuineWorldCandidates,
} from "../core/editorial/world-coverage";
import { getPriorityAnchorOrder } from "../core/editorial/cultural-identity-profile";
import { evaluateHumanUnderstoodGate } from "../core/editorial/human-understood-gate";
import { matchesAvoidArtist } from "../core/editorial/cultural-identity-profile";

describe("V15 delivery recovery", () => {
  it("coverage tiers map to correct delivery caps", () => {
    assert.deepEqual(getDeliveryTarget("HIGH"), { min: 20, max: 25 });
    assert.deepEqual(getDeliveryTarget("MEDIUM"), { min: 15, max: 20 });
    assert.deepEqual(getDeliveryTarget("LOW"), { min: 6, max: 12 });
    assert.deepEqual(getDeliveryTarget("VERY_LOW"), { min: 3, max: 5 });
    assert.equal(getDeliveryTarget("NONE"), null);

    assert.equal(getDeliveryCap("HIGH", 25), 25);
    assert.equal(getDeliveryCap("MEDIUM", 25), 25);
    assert.equal(getDeliveryCap("LOW", 25), 25);
    assert.equal(getDeliveryCap("VERY_LOW", 25), 5);
    assert.equal(getDeliveryCap("NONE", 25), 0);
  });

  it("assesses candidate coverage tier from genuine pool size", () => {
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const genuine = Array.from({ length: 8 }, (_, i) => ({
      artistName: i % 2 === 0 ? "The Cure" : "New Order",
      trackName: `Track ${i + 1}`,
      energy: 0.6,
    }));
    assert.equal(assessCandidateCoverageTier(genuine, profile), "LOW");
    assert.equal(countGenuineWorldCandidates(genuine, profile), 8);
  });

  it("8 excellent tracks ships 8 not 0", () => {
    const world = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const tracks = [
      { artistName: "The Cure", trackName: "Just Like Heaven", energy: 0.58 },
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
      { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.52 },
      { artistName: "Pet Shop Boys", trackName: "West End Girls", energy: 0.6 },
      { artistName: "Tears for Fears", trackName: "Everybody Wants to Rule the World", energy: 0.62 },
      { artistName: "Simple Minds", trackName: "Don't You", energy: 0.6 },
      { artistName: "M83", trackName: "Midnight City", energy: 0.58 },
      { artistName: "A Flock of Seagulls", trackName: "I Ran", energy: 0.55 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
    assert.equal(thesis.passed, true);
    const purity = applyWorldPurityGate(thesis.tracks, world, {
      prompt: "80s night drive",
      requestedLength: 25,
      coverageTier: "LOW",
    });
    assert.equal(purity.tracks.length, 8);
    assert.ok(purity.salvageableCount >= 3);
  });

  it("thesis fallback promotes best anchor when no 95+ opener", () => {
    const world = resolveCommittedWorld({ prompt: "madchester pub walk" })!;
    const profile = getCulturalProfile("madchester_world")!;
    const tracks = [
      { artistName: "Bon Iver", trackName: "Skinny Love", energy: 0.4 },
      { artistName: "Oasis", trackName: "Wonderwall", energy: 0.55 },
      { artistName: "The Stone Roses", trackName: "Fools Gold", energy: 0.62 },
      { artistName: "Happy Mondays", trackName: "Step On", energy: 0.6 },
    ];
    const selected = selectThesisOpener(tracks, profile, 20);
    assert.ok(selected);
    assert.equal(selected!.track.artistName, "The Stone Roses");
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
    assert.equal(thesis.passed, true);
    assert.equal(thesis.tracks[0]!.artistName, "The Stone Roses");
    const purity = applyWorldPurityGate(thesis.tracks, world, { requestedLength: 25, coverageTier: "VERY_LOW" });
    assert.ok(purity.tracks.length >= 3);
    assert.equal(purity.tracks[0]!.artistName, "The Stone Roses");
  });

  it("VERY_LOW ships 3-5 not refuse when anchors exist", () => {
    const world = resolveCommittedWorld({ prompt: "disco rooftop party 1978" })!;
    const profile = getCulturalProfile("disco_1970s_world")!;
    const tracks = [
      { artistName: "Michael Jackson", trackName: "Don't Stop 'Til You Get Enough", energy: 0.68 },
      { artistName: "Donna Summer", trackName: "Hot Stuff", energy: 0.72 },
      { artistName: "Chic", trackName: "Le Freak", energy: 0.7 },
    ];
    const tier = assessCandidateCoverageTier(tracks, profile);
    assert.equal(tier, "VERY_LOW");
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
    const purity = applyWorldPurityGate(thesis.tracks, world, { requestedLength: 25, coverageTier: tier });
    assert.ok(purity.tracks.length >= 3 && purity.tracks.length <= 5);
    const gate = evaluateHumanUnderstoodGate({
      trackCount: purity.tracks.length,
      requestedLength: 25,
      committed: world,
      thesis,
      worldProof: null,
      negationViolations: 0,
      openerNegationViolations: 0,
      coverageTier: tier,
      tracks: purity.tracks,
      anchorHitsInPool: 3,
    });
    assert.notEqual(gate.action, "refuse");
  });

  it("motorway/madchester/disco/gym fixtures ship when anchors in pool", () => {
    const cases = [
      {
        prompt: "empty motorway at midnight rain on the windscreen",
        tracks: [
          { artistName: "M83", trackName: "Midnight City", energy: 0.58 },
          { artistName: "Chromatics", trackName: "Tick of the Clock", energy: 0.45 },
          { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.52 },
          { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
        ],
      },
      {
        prompt: "madchester pub walk",
        tracks: [
          { artistName: "The Stone Roses", trackName: "Fools Gold", energy: 0.62 },
          { artistName: "Happy Mondays", trackName: "Step On", energy: 0.6 },
          { artistName: "Oasis", trackName: "Wonderwall", energy: 0.55 },
        ],
      },
      {
        prompt: "disco rooftop party 1978",
        tracks: [
          { artistName: "Michael Jackson", trackName: "Rock with You", energy: 0.68 },
          { artistName: "Donna Summer", trackName: "Hot Stuff", energy: 0.66 },
          { artistName: "Chic", trackName: "Le Freak", energy: 0.7 },
        ],
      },
      {
        prompt: "heavy gym workout aggressive",
        tracks: [
          { artistName: "Metallica", trackName: "Enter Sandman", energy: 0.9 },
          { artistName: "AC/DC", trackName: "Back In Black", energy: 0.88 },
          { artistName: "Slayer", trackName: "Raining Blood", energy: 0.87 },
        ],
      },
    ];

    for (const { prompt, tracks } of cases) {
      const world = resolveCommittedWorld({ prompt })!;
      const profile = getCulturalProfile(world.id)!;
      const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
      const purity = applyWorldPurityGate(thesis.tracks, world, { prompt, requestedLength: 25, coverageTier: "VERY_LOW" });
      assert.ok(purity.tracks.length >= 3, `${prompt} should ship >= 3 tracks, got ${purity.tracks.length}`);
      assert.equal(thesis.passed, true, `${prompt} thesis should pass`);
    }
  });

  it("tail purity thresholds unchanged (T6+ regression)", () => {
    assert.equal(worldPurityThresholdForPosition(0), 95);
    assert.equal(worldPurityThresholdForPosition(5), 85);
    assert.equal(worldPurityThresholdForPosition(9), 85);
    assert.equal(worldPurityThresholdForPosition(10), 80);
    assert.equal(worldPurityThresholdForPosition(20), 80);
  });

  it("V15 first-five thresholds: T1 95, T2-3 90, T4-5 85", () => {
    assert.equal(worldPurityThresholdForPosition(1), 90);
    assert.equal(worldPurityThresholdForPosition(2), 90);
    assert.equal(worldPurityThresholdForPosition(3), 85);
    assert.equal(worldPurityThresholdForPosition(4), 85);
  });

  it("delivery message is honest when shortened", () => {
    const msg = buildDeliveryMessage(7, "LOW");
    assert.match(msg ?? "", /focused 7-track version/i);
    assert.match(msg ?? "", /limited matches/i);
  });

  it("priority anchor order is defined for key worlds", () => {
    const worlds = [
      "80s_night_drive_world",
      "rainy_motorway_world",
      "madchester_world",
      "disco_1970s_world",
      "gym_rock_world",
      "classic_rock_world",
      "country_world",
    ];
    for (const worldId of worlds) {
      const profile = getCulturalProfile(worldId)!;
      const order = getPriorityAnchorOrder(profile);
      assert.ok(order.length >= 3, `${worldId} should have priority anchors`);
    }
  });

  it("forbidden artists still stripped (V14 regression)", () => {
    const profile = getCulturalProfile("80s_night_drive_world")!;
    assert.ok(matchesAvoidArtist("Fred again..", profile));
    const world = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const tracks = [
      { artistName: "The Cure", trackName: "Just Like Heaven", energy: 0.58 },
      { artistName: "Fred again..", trackName: "Marea", energy: 0.7 },
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
    ];
    const filtered = filterByWorldPurity(tracks, world);
    assert.ok(!filtered.tracks.some((t) => String(t.artistName).includes("Fred")));
  });

  it("human gate passes with 3+ pure tracks", () => {
    const world = resolveCommittedWorld({ prompt: "country cowboy road trip" })!;
    const tracks = [
      { artistName: "Luke Combs", trackName: "Beautiful Crazy", energy: 0.58 },
      { artistName: "Johnny Cash", trackName: "Ring of Fire", energy: 0.55 },
      { artistName: "Chris Stapleton", trackName: "Tennessee Whiskey", energy: 0.52 },
    ];
    const profile = getCulturalProfile("country_world")!;
    assert.ok(tracks.every((t) => scoreTrackWorldIdentity(t, profile) >= 0.5));
    const gate = evaluateHumanUnderstoodGate({
      trackCount: 3,
      requestedLength: 25,
      committed: world,
      thesis: { tracks, passed: true, promoted: false, fromIndex: 0, openerScore: 0.9, failures: [], refuseMessage: null },
      worldProof: null,
      negationViolations: 0,
      openerNegationViolations: 0,
      coverageTier: "VERY_LOW",
      tracks,
      anchorHitsInPool: 2,
    });
    assert.equal(gate.action, "pass");
  });
});
