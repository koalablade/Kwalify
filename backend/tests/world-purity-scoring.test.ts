import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";
import { matchesAvoidArtist, matchesAdjacentArtist } from "../core/editorial/cultural-identity-profile";
import {
  worldPurityThresholdForPosition,
  trackPassesWorldPurity,
  scoreTrackPurityPercent,
  effectivePurityThresholdForTrack,
  filterByWorldPurity,
  stripFromCheckpointFailure,
} from "../core/editorial/world-purity-gate";

describe("world purity roster-tier scoring (V15 fix)", () => {
  it("80s night drive: rostered adjacent and acceptable artists score >= 80", () => {
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const garyNuman = {
      artistName: "Gary Numan",
      trackName: "Cars",
      energy: 0.65,
      releaseYear: 1979,
    };
    const humanLeague = {
      artistName: "The Human League",
      trackName: "Don't You Want Me",
      energy: 0.62,
      releaseYear: 1981,
    };

    assert.ok(scoreTrackPurityPercent(garyNuman, profile) >= 80);
    assert.ok(scoreTrackPurityPercent(humanLeague, profile) >= 80);
    assert.ok(trackPassesWorldPurity(garyNuman, profile, 10));
    assert.ok(trackPassesWorldPurity(humanLeague, profile, 10));
  });

  it("country: Waylon Jennings scores >= 80 under country_world", () => {
    const profile = getCulturalProfile("country_world")!;
    const waylon = {
      artistName: "Waylon Jennings",
      trackName: "Mammas Don't Let Your Babies Grow up to Be Cowboys",
      energy: 0.55,
      releaseYear: 1978,
    };

    assert.ok(scoreTrackPurityPercent(waylon, profile) >= 80);
    assert.ok(trackPassesWorldPurity(waylon, profile, 10));
    assert.ok(trackPassesWorldPurity(waylon, profile, 7));
    assert.equal(effectivePurityThresholdForTrack(waylon, profile, 7), 80);
  });

  it("gym: heavy gym workout aggressive resolves to gym_rock_world", () => {
    const world = resolveCommittedWorld({ prompt: "heavy gym workout aggressive" })!;
    assert.equal(world.id, "gym_rock_world");

    const profile = getCulturalProfile(world.id)!;
    const gnr = {
      artistName: "Guns N' Roses",
      trackName: "Welcome To The Jungle",
      energy: 0.92,
      releaseYear: 1987,
    };

    assert.ok(scoreTrackPurityPercent(gnr, profile) >= 80);
    assert.ok(trackPassesWorldPurity(gnr, profile, 5));
  });

  it("calibration invariant: acceptableAdjacency artists pass tail threshold", () => {
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const tailThreshold = worldPurityThresholdForPosition(20);

    for (const adj of profile.acceptableAdjacency ?? []) {
      const score = scoreTrackPurityPercent(
        { artistName: adj, trackName: "Test Track", energy: 0.6, releaseYear: 1984 },
        profile,
      );
      assert.ok(
        score >= tailThreshold,
        `${adj} adjacency score ${score} < tail threshold ${tailThreshold}`,
      );
    }
  });

  it("metadata-only tracks do not auto-qualify at >= 80", () => {
    const profile80s = getCulturalProfile("80s_night_drive_world")!;
    const energyOnly = {
      artistName: "Unknown Library Artist",
      trackName: "Night Drive",
      energy: 0.62,
      releaseYear: 1984,
    };
    assert.ok(scoreTrackWorldIdentity(energyOnly, profile80s) < 0.8);

    const profileCountry = getCulturalProfile("country_world")!;
    const genreOnly = {
      artistName: "Some Band",
      trackName: "Road Song",
      energy: 0.55,
      releaseYear: 2019,
      genres: ["country"],
      genrePrimary: "country",
    };
    assert.ok(scoreTrackWorldIdentity(genreOnly, profileCountry) < 0.8);

    assert.equal(
      scoreTrackWorldIdentity(
        { artistName: "French Montana", trackName: "Unforgettable", energy: 0.65 },
        profile80s,
      ),
      0,
    );
  });

  it("checkpoint uses composition position not survivor rank (H2)", () => {
    const world = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const filler = { artistName: "Drake", trackName: "Jungle", energy: 0.58, releaseYear: 2015 };
    const tracks = [
      { artistName: "The Cure", trackName: "Just Like Heaven", energy: 0.58, releaseYear: 1987 },
      filler,
      filler,
      filler,
      filler,
      filler,
      filler,
      filler,
      filler,
      filler,
      {
        artistName: "The Human League",
        trackName: "Don't You Want Me",
        energy: 0.62,
        releaseYear: 1981,
      },
    ];
    const filtered = filterByWorldPurity(tracks, world);
    assert.equal(filtered.tracks.length, 2);
    assert.deepEqual(filtered.survivorCompositionPositions, [0, 10]);

    const stripped = stripFromCheckpointFailure(
      filtered.tracks,
      world,
      profile,
      filtered.survivorCompositionPositions,
    );
    assert.equal(stripped.tracks.length, 2);
    assert.ok(stripped.checkpointDecisions.every((d) => d.passed));
  });

  it("non-roster metadata track keeps strict position threshold at pos 7", () => {
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const metadataOnly = {
      artistName: "Unknown Artist",
      trackName: "Night Song",
      energy: 0.62,
      releaseYear: 1984,
    };
    assert.equal(scoreTrackPurityPercent(metadataOnly, profile), 58);
    assert.equal(effectivePurityThresholdForTrack(metadataOnly, profile, 7), 85);
    assert.ok(!trackPassesWorldPurity(metadataOnly, profile, 7));
  });

  it("madchester: James Blake blocked and does not match adjacent James token", () => {
    const profile = getCulturalProfile("madchester_world")!;
    assert.ok(matchesAvoidArtist("James Blake", profile));
    assert.ok(!matchesAdjacentArtist("James Blake", profile));
    assert.ok(matchesAdjacentArtist("James", profile));
    assert.equal(
      scoreTrackWorldIdentity(
        { artistName: "James Blake", trackName: "Coming Back", energy: 0.55, releaseYear: 2021 },
        profile,
      ),
      0,
    );
  });
});
