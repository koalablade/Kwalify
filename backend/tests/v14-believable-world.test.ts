import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import {
  applyWorldPurityGate,
  filterByWorldPurity,
  worldPurityThresholdForPosition,
  wouldStillBelieveSameCurator,
  scoreTrackPurityPercent,
  WORLD_PURITY_CHECKPOINT_INDICES,
} from "../core/editorial/world-purity-gate";
import { enforceThesisOpener } from "../core/editorial/thesis-opener-gate";
import { sequenceAfterPurityFilter } from "../core/editorial/world-sequencer";
import { committedWorldsMatch, enforceCommittedWorldImmutability } from "../core/editorial/committed-world-guard";
import { matchesAvoidArtist } from "../core/editorial/cultural-identity-profile";

describe("V14 believable world", () => {
  it("V14 position thresholds: 95/90/85/80", () => {
    assert.equal(worldPurityThresholdForPosition(0), 95);
    assert.equal(worldPurityThresholdForPosition(1), 95);
    assert.equal(worldPurityThresholdForPosition(2), 90);
    assert.equal(worldPurityThresholdForPosition(4), 90);
    assert.equal(worldPurityThresholdForPosition(5), 85);
    assert.equal(worldPurityThresholdForPosition(9), 85);
    assert.equal(worldPurityThresholdForPosition(10), 80);
    assert.equal(worldPurityThresholdForPosition(20), 80);
  });

  it("checkpoints cover thesis, confirmation, mid-body, and landing", () => {
    assert.deepEqual([...WORLD_PURITY_CHECKPOINT_INDICES], [0, 1, 4, 9, 14]);
  });

  it("purity gate removes sub-threshold tracks with no backfill", () => {
    const world = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const tracks = [
      { artistName: "The Cure", trackName: "Just Like Heaven", energy: 0.58 },
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
      { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.52 },
      { artistName: "Pet Shop Boys", trackName: "West End Girls", energy: 0.6 },
      { artistName: "Fred again..", trackName: "Marea", energy: 0.7 },
      { artistName: "French Montana", trackName: "Unforgettable", energy: 0.65 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
    const purity = applyWorldPurityGate(thesis.tracks, world, { prompt: "80s night drive", requestedLength: 25 });
    assert.ok(!purity.tracks.some((t) => matchesAvoidArtist(String(t.artistName), profile)));
    assert.ok(purity.tracks.length < tracks.length);
    assert.ok(purity.tracks.every((t, i) => scoreTrackPurityPercent(t, profile) >= worldPurityThresholdForPosition(i)));
  });

  it("sequencer preserves thesis opener and orders believable arc", () => {
    const world = resolveCommittedWorld({ prompt: "dad rock BBQ with beers" })!;
    const profile = getCulturalProfile("dad_rock_world")!;
    const tracks = [
      { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85, popularity: 80 },
      { artistName: "Queen", trackName: "Don't Stop Me Now", energy: 0.78, popularity: 75 },
      { artistName: "Tom Petty", trackName: "Free Fallin'", energy: 0.55, popularity: 70 },
      { artistName: "Journey", trackName: "Don't Stop Believin'", energy: 0.72, popularity: 82 },
      { artistName: "Eagles", trackName: "Hotel California", energy: 0.48, popularity: 78 },
    ];
    const sequenced = sequenceAfterPurityFilter(tracks, world, profile);
    assert.equal(sequenced[0]!.artistName, "AC/DC");
    assert.ok(sequenced.length === tracks.length);
  });

  it("committed world immutability blocks drift between stages", () => {
    const frozen = resolveCommittedWorld({ prompt: "madchester pub walk" })!;
    const drifted = { ...frozen, id: "lofi_world", worldIds: ["lofi_world"] };
    const enforced = enforceCommittedWorldImmutability(frozen, drifted, "test");
    assert.equal(enforced.drift.drifted, true);
    assert.equal(enforced.world?.id, frozen.id);
    assert.ok(committedWorldsMatch(frozen, enforced.world));
  });

  it("belief fails when track 2 drops below 95 threshold", () => {
    const world = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const tracks = [
      { artistName: "The Cure", trackName: "Track 1", energy: 0.6 },
      { artistName: "French Montana", trackName: "Track 2", energy: 0.6 },
      ...Array.from({ length: 8 }, (_, i) => ({
        artistName: "Pet Shop Boys",
        trackName: `Track ${i + 3}`,
        energy: 0.6,
      })),
    ];
    const belief = wouldStillBelieveSameCurator("80s night drive", tracks, world, profile);
    assert.equal(belief.believe, false);
    const filtered = filterByWorldPurity(tracks, world);
    assert.ok(!filtered.tracks.some((t) => t.artistName === "French Montana"));
  });
});
