import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCulturalProfile,
  getCulturalProfileForCommitted,
  hasExplicitMusicalHardLock,
  resolveCommittedWorld,
  resolveWorldActivityContext,
} from "../core/committed-world";
import { inferWorldIdentityIdsFromPrompt } from "../core/editorial/world-identity-gate";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";

describe("V22 world resolution", () => {
  it("G-016: uk garage drive commits musical world with drive activity", () => {
    const prompt = "late night uk garage drive";
    const world = resolveCommittedWorld({ prompt })!;

    assert.equal(world.id, "uk_garage_world");
    assert.equal(world.musicalWorldId, "uk_garage_world");
    assert.equal(world.source, "explicit_genre");
    assert.equal(world.hardLock, true);
    assert.equal(resolveWorldActivityContext(prompt), "drive");
    assert.ok(getCulturalProfile("uk_garage_world"));
    assert.equal(getCulturalProfileForCommitted(world)?.worldId, "uk_garage_world");
    assert.ok(hasExplicitMusicalHardLock(world));

    const profile = getCulturalProfile("uk_garage_world")!;
    assert.ok(
      scoreTrackWorldIdentity({ artistName: "Craig David", trackName: "Rewind", energy: 0.72 }, profile) >= 0.8,
    );
    assert.equal(
      scoreTrackWorldIdentity({ artistName: "The Jungle Giants", trackName: "Used to Be", energy: 0.62 }, profile),
      0,
    );
  });

  it("G-030: hard techno gym preserves techno musical world over gym rock", () => {
    const prompt = "hard techno gym";
    const world = resolveCommittedWorld({ prompt })!;

    assert.equal(world.id, "gym_energy_world");
    assert.equal(world.musicalWorldId, "gym_energy_world");
    assert.equal(world.activityContext, "gym");
    assert.notEqual(world.id, "gym_rock_world");
    assert.ok(hasExplicitMusicalHardLock(world));
  });

  it("G-032/G-036: pop punk gym keeps pop_punk as primary musical identity", () => {
    for (const prompt of [
      "2000s pop punk gym workout",
      "2000s pop punk gym workout with no pop music",
    ]) {
      const world = resolveCommittedWorld({ prompt })!;

      assert.equal(world.id, "pop_punk_world", prompt);
      assert.equal(world.musicalWorldId, "pop_punk_world", prompt);
      assert.equal(world.activityContext, "gym", prompt);
      assert.ok(getCulturalProfile("pop_punk_world"), prompt);

      const profile = getCulturalProfile("pop_punk_world")!;
      assert.ok(
        scoreTrackWorldIdentity({ artistName: "Paramore", trackName: "Misery Business", energy: 0.88 }, profile) >=
          0.8,
        prompt,
      );
      assert.equal(
        scoreTrackWorldIdentity({ artistName: "Metallica", trackName: "Enter Sandman", energy: 0.92 }, profile),
        0,
        prompt,
      );
    }
  });

  it("G-023 regression: rainy motorway world preserved", () => {
    const prompt = "rain on the windscreen empty motorway at midnight";
    const world = resolveCommittedWorld({ prompt })!;

    assert.equal(world.id, "rainy_motorway_world");
    assert.ok(getCulturalProfile("rainy_motorway_world"));
  });

  it("G-027 regression: dad rock BBQ unchanged", () => {
    const prompt = "dad rock BBQ with beers";
    const world = resolveCommittedWorld({ prompt })!;

    assert.equal(world.id, "dad_rock_world");
    assert.ok(getCulturalProfile("dad_rock_world"));
  });

  it("inferWorldIdentityIdsFromPrompt skips gym_rock when pop_punk present", () => {
    const ids = inferWorldIdentityIdsFromPrompt("2000s pop punk gym workout");
    assert.ok(ids.includes("pop_punk_world"));
    assert.ok(!ids.includes("heavy_gym_world"));
    assert.ok(!ids.includes("gym_rock_world"));
  });
});
