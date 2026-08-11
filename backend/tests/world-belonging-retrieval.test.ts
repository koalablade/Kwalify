import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCulturalProfile } from "../core/committed-world";
import {
  artistOnWorldRoster,
  trackBelongsForWorldRetrieval,
  trackMatchesWorldInstrumentation,
} from "../core/editorial/world-belonging-retrieval";
import { runLayeredWorldRetrieval } from "../core/editorial/layered-world-retrieval";
import { resolveCommittedWorld } from "../core/committed-world";

describe("world belonging retrieval", () => {
  it("admits 1987 synth-pop on roster for 80s night drive", () => {
    const profile = getCulturalProfile("80s_night_drive_world")!;
    assert.equal(artistOnWorldRoster("Duran Duran", profile), true);
    const track = {
      artistName: "Duran Duran",
      trackName: "Hungry Like the Wolf",
      genreFamily: "pop",
      genrePrimary: "pop",
      genres: ["pop"],
      releaseYear: 1987,
      energy: 0.62,
    };
    assert.equal(trackBelongsForWorldRetrieval(track, profile), true);
  });

  it("admits darker new wave via instrumentation match", () => {
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const track = {
      artistName: "Some Library Artist",
      trackName: "Cold Wave",
      genreFamily: "rock",
      genrePrimary: "new wave",
      genres: ["new wave", "post-punk"],
      releaseYear: 1984,
      energy: 0.55,
    };
    assert.equal(trackMatchesWorldInstrumentation(track, profile), true);
    assert.equal(trackBelongsForWorldRetrieval(track, profile), true);
  });

  it("admits cinematic modern M83-style track for motorway rain", () => {
    const profile = getCulturalProfile("rainy_motorway_world")!;
    const track = {
      artistName: "M83",
      trackName: "Midnight City",
      genreFamily: "electronic",
      genrePrimary: "synth",
      genres: ["electronic"],
      releaseYear: 2011,
      energy: 0.58,
    };
    assert.equal(trackBelongsForWorldRetrieval(track, profile), true);
  });

  it("layered retrieval includes belonging layer hits beyond anchors", () => {
    const prompt = "80s night drive";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile(world.id)!;
    const library = [
      { trackId: "1", artistName: "The Cure", trackName: "Just Like Heaven", releaseYear: 1987, energy: 0.6 },
      { trackId: "2", artistName: "Duran Duran", trackName: "Rio", genrePrimary: "pop", genreFamily: "pop", genres: ["pop"], releaseYear: 1982, energy: 0.65 },
      { trackId: "3", artistName: "Bon Iver", trackName: "Skinny Love", releaseYear: 2008, energy: 0.3 },
    ];
    const result = runLayeredWorldRetrieval({
      prompt,
      userLibrary: library,
      culturalProfile: profile,
      committedWorld: world,
    });
    assert.ok((result.layerCounts.belonging ?? 0) >= 1);
    assert.ok(result.tracks.some((t) => t.artistName === "Duran Duran"));
    assert.ok(!result.tracks.some((t) => t.artistName === "Bon Iver"));
  });
});
