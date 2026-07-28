import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";
import { enforceThesisOpener } from "../core/editorial/thesis-opener-gate";
import {
  applyWorldPurityGate,
  filterByWorldPurity,
  worldPurityThresholdForPosition,
  wouldStillBelieveSameCurator,
  scoreTrackPurityPercent,
} from "../core/editorial/world-purity-gate";
import { matchesAvoidArtist } from "../core/editorial/cultural-identity-profile";

describe("V13 world purity (V14 thresholds)", () => {
  it("position thresholds: 95/90/85/80 (V14)", () => {
    assert.equal(worldPurityThresholdForPosition(0), 95);
    assert.equal(worldPurityThresholdForPosition(1), 95);
    assert.equal(worldPurityThresholdForPosition(2), 90);
    assert.equal(worldPurityThresholdForPosition(4), 90);
    assert.equal(worldPurityThresholdForPosition(5), 85);
    assert.equal(worldPurityThresholdForPosition(9), 85);
    assert.equal(worldPurityThresholdForPosition(10), 80);
    assert.equal(worldPurityThresholdForPosition(20), 80);
  });

  it("80s night drive bans Fred again.., French Montana, Gray Squat Rave", () => {
    const profile = getCulturalProfile("80s_night_drive_world")!;
    assert.ok(matchesAvoidArtist("Fred again..", profile));
    assert.ok(matchesAvoidArtist("French Montana", profile));
    assert.ok(matchesAvoidArtist("Gray Squat Rave", profile));
    assert.equal(
      scoreTrackWorldIdentity({ artistName: "Fred again..", trackName: "Marea", energy: 0.7 }, profile),
      0,
    );
    assert.equal(
      scoreTrackWorldIdentity({ artistName: "French Montana", trackName: "Unforgettable", energy: 0.65 }, profile),
      0,
    );

    const world = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const tracks = [
      { artistName: "Tears For Fears", trackName: "Everybody Wants to Rule the World", energy: 0.62 },
      { artistName: "The Cure", trackName: "Just Like Heaven", energy: 0.58 },
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
      { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.52 },
      { artistName: "Pet Shop Boys", trackName: "West End Girls", energy: 0.6 },
      { artistName: "Fred again..", trackName: "Marea", energy: 0.7 },
      { artistName: "French Montana", trackName: "Unforgettable", energy: 0.65 },
      { artistName: "Simple Minds", trackName: "Don't You", energy: 0.6 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
    const purity = applyWorldPurityGate(thesis.tracks, world, { prompt: "80s night drive", requestedLength: 25 });
    assert.ok(!purity.tracks.some((t) => t.artistName?.includes("Fred")));
    assert.ok(!purity.tracks.some((t) => t.artistName === "French Montana"));
    assert.ok(purity.removed >= 2);
  });

  it("motorway bans Oasis, Onyx Deimos, party artists", () => {
    const prompt = "empty motorway at midnight rain on the windscreen";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("rainy_motorway_world") ?? getCulturalProfile(world.id)!;
    assert.ok(matchesAvoidArtist("Oasis", profile));
    assert.ok(matchesAvoidArtist("Onyx Deimos", profile));
    assert.equal(scoreTrackWorldIdentity({ artistName: "Oasis", trackName: "Wonderwall", energy: 0.55 }, profile), 0);

    const tracks = [
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
      { artistName: "M83", trackName: "Midnight City", energy: 0.58 },
      { artistName: "Chromatics", trackName: "Tick of the Clock", energy: 0.45 },
      { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.52 },
      { artistName: "New Order", trackName: "True Faith", energy: 0.58 },
      { artistName: "Oasis", trackName: "Wonderwall", energy: 0.55 },
      { artistName: "Onyx Deimos", trackName: "Rave", energy: 0.88 },
      { artistName: "M83", trackName: "Wait", energy: 0.5 },
    ];
    const filtered = filterByWorldPurity(tracks, world);
    assert.ok(!filtered.tracks.some((t) => t.artistName === "Oasis"));
    assert.ok(!filtered.tracks.some((t) => t.artistName === "Onyx Deimos"));
    assert.equal(filtered.tracks[0]!.artistName, "New Order");
  });

  it("country bans Florence + The Machine", () => {
    const world = resolveCommittedWorld({ prompt: "country cowboy road trip" })!;
    const profile = getCulturalProfile("country_world")!;
    assert.ok(matchesAvoidArtist("Florence + The Machine", profile));
    assert.equal(
      scoreTrackWorldIdentity(
        { artistName: "Florence + The Machine", trackName: "Dog Days Are Over", energy: 0.62 },
        profile,
      ),
      0,
    );

    const tracks = [
      { artistName: "Luke Combs", trackName: "Beautiful Crazy", energy: 0.58 },
      { artistName: "Johnny Cash", trackName: "Ring of Fire", energy: 0.55 },
      { artistName: "Chris Stapleton", trackName: "Tennessee Whiskey", energy: 0.52 },
      { artistName: "Willie Nelson", trackName: "On the Road Again", energy: 0.5 },
      { artistName: "Luke Combs", trackName: "Forever After All", energy: 0.48 },
      { artistName: "Florence + The Machine", trackName: "Dog Days Are Over", energy: 0.62 },
    ];
    const purity = applyWorldPurityGate(tracks, world, { prompt: "country cowboy road trip", requestedLength: 25 });
    assert.ok(!purity.tracks.some((t) => String(t.artistName).includes("Florence")));
  });

  it("regression: madchester/dad rock/disco/gym pass opener + purity", () => {
    const madchester = resolveCommittedWorld({ prompt: "madchester pub walk" })!;
    const madProfile = getCulturalProfile("madchester_world")!;
    const madTracks = [
      { artistName: "James Righton", trackName: "Waterloo Sunset", energy: 0.55 },
      { artistName: "Oasis", trackName: "Wonderwall", energy: 0.55 },
      { artistName: "The Stone Roses", trackName: "Fools Gold", energy: 0.62 },
      { artistName: "Happy Mondays", trackName: "Step On", energy: 0.6 },
    ];
    const madThesis = enforceThesisOpener(madTracks, madProfile, madchester, undefined, 20);
    const madPurity = applyWorldPurityGate(madThesis.tracks, madchester, { requestedLength: 25 });
    assert.equal(madThesis.tracks[0]!.artistName, "Oasis");
    assert.ok(scoreTrackPurityPercent(madPurity.tracks[0]!, madProfile) >= 95);

    const dadRock = resolveCommittedWorld({ prompt: "dad rock BBQ with beers" })!;
    const dadProfile = getCulturalProfile("dad_rock_world")!;
    const dadThesis = enforceThesisOpener(
      [
        { artistName: "Bon Iver", trackName: "Skinny Love", energy: 0.4 },
        { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85 },
        { artistName: "Queen", trackName: "Don't Stop Me Now", energy: 0.78 },
      ],
      dadProfile,
      dadRock,
      undefined,
      20,
    );
    const dadPurity = applyWorldPurityGate(dadThesis.tracks, dadRock, { requestedLength: 25 });
    assert.equal(dadThesis.tracks[0]!.artistName, "AC/DC");
    assert.ok(dadPurity.tracks.length >= 1);

    const disco = resolveCommittedWorld({ prompt: "disco rooftop party 1978" })!;
    const discoProfile = getCulturalProfile("disco_1970s_world")!;
    const discoThesis = enforceThesisOpener(
      [
        { artistName: "Panic! At The Disco", trackName: "High Hopes", energy: 0.7 },
        { artistName: "Michael Jackson", trackName: "Rock with You", energy: 0.68 },
        { artistName: "Bee Gees", trackName: "Stayin' Alive", energy: 0.72 },
      ],
      discoProfile,
      disco,
      undefined,
      20,
    );
    const discoPurity = applyWorldPurityGate(discoThesis.tracks, disco, { requestedLength: 25 });
    assert.equal(discoThesis.tracks[0]!.artistName, "Michael Jackson");
    assert.ok(discoPurity.tracks.length >= 1);

    const gym = resolveCommittedWorld({ prompt: "heavy gym workout aggressive" })!;
    const gymProfile = getCulturalProfile(gym.id)!;
    const gymThesis = enforceThesisOpener(
      [
        { artistName: "Paramore", trackName: "Hard Times", energy: 0.74 },
        { artistName: "AC/DC", trackName: "T.N.T.", energy: 0.88 },
        { artistName: "Metallica", trackName: "Enter Sandman", energy: 0.9 },
      ],
      gymProfile,
      gym,
      undefined,
      20,
    );
    const gymPurity = applyWorldPurityGate(gymThesis.tracks, gym, { requestedLength: 25 });
    assert.ok(gymThesis.tracks[0]!.artistName === "AC/DC" || gymThesis.tracks[0]!.artistName === "Metallica");
    assert.ok(gymPurity.tracks.length >= 2);
  });

  it("checkpoint belief fails when track 10 betrays world", () => {
    const world = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const profile = getCulturalProfile("80s_night_drive_world")!;
    const tracks = Array.from({ length: 10 }, (_, i) => ({
      artistName: i === 9 ? "French Montana" : "The Cure",
      trackName: `Track ${i + 1}`,
      energy: 0.6,
    }));
    const belief = wouldStillBelieveSameCurator("80s night drive", tracks, world, profile);
    assert.equal(belief.believe, false);
    assert.ok(belief.failures.length > 0);
  });
});
