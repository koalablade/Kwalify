import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";
import {
  assessWorldCoverage,
  coverageLevelToMaxTracks,
  coverageUserMessage,
  shouldExpandWorldCoverage,
} from "../core/editorial/world-coverage";
import {
  buildAnchorSearchQueries,
  filterWorldAnchorCandidates,
} from "../core/editorial/world-anchor-retrieval";
import { enforceThesisOpenerGate } from "../core/editorial/thesis-opener-gate";
import { evaluateHumanQualityGate } from "../core/editorial/human-quality-gate";

function weakMotorwayLibrary() {
  return [
    { trackId: "1", artistName: "BLK", trackName: "Keycaps", energy: 0.55 },
    { trackId: "2", artistName: "Arctic Monkeys", trackName: "Do I Wanna Know?", energy: 0.62 },
    { trackId: "3", artistName: "Tame Impala", trackName: "The Less I Know", energy: 0.58 },
    { trackId: "4", artistName: "Bon Iver", trackName: "Holocene", energy: 0.3 },
  ];
}

function weak80sNightLibrary() {
  return [
    { trackId: "1", artistName: "Florence + The Machine", trackName: "Spectrum (Say My Name)", energy: 0.65 },
    { trackId: "2", artistName: "The 1975", trackName: "Somebody Else", energy: 0.55 },
    { trackId: "3", artistName: "Arctic Monkeys", trackName: "R U Mine?", energy: 0.7 },
  ];
}

function weakMadchesterLibrary() {
  return [
    { trackId: "1", artistName: "James Righton", trackName: "Waterloo Sunset", energy: 0.55 },
    { trackId: "2", artistName: "Arctic Monkeys", trackName: "Fluorescent Adolescent", energy: 0.62 },
    { trackId: "3", artistName: "Bon Iver", trackName: "Skinny Love", energy: 0.35 },
  ];
}

function weakDiscoLibrary() {
  return [
    { trackId: "1", artistName: "Panic! At The Disco", trackName: "High Hopes", energy: 0.7 },
    { trackId: "2", artistName: "Dua Lipa", trackName: "Don't Start Now", energy: 0.75 },
    { trackId: "3", artistName: "The Weeknd", trackName: "Blinding Lights", energy: 0.68 },
  ];
}

describe("V10 world coverage", () => {
  it("coverage scoring: strong library = HIGH", () => {
    const prompt = "dad rock BBQ with beers";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile(world.id)!;
    const strongLibrary = [
      { artistName: "Queen", trackName: "Don't Stop Me Now", energy: 0.78 },
      { artistName: "Fleetwood Mac", trackName: "Go Your Own Way", energy: 0.72 },
      { artistName: "AC/DC", trackName: "Back in Black", energy: 0.85 },
      { artistName: "Eagles", trackName: "Hotel California", energy: 0.55 },
      { artistName: "Tom Petty", trackName: "Free Fallin'", energy: 0.62 },
    ];
    const coverage = assessWorldCoverage(world, strongLibrary, profile);
    assert.equal(coverage.score, "HIGH");
    assert.ok(coverage.anchorHits >= 3);
  });

  it("coverage scoring: weak motorway library = LOW or VERY_LOW", () => {
    const prompt = "empty motorway at midnight rain on the windscreen";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("rainy_motorway_world") ?? getCulturalProfile(world.id)!;
    const coverage = assessWorldCoverage(world, weakMotorwayLibrary(), profile);
    assert.ok(coverage.score === "LOW" || coverage.score === "VERY_LOW");
    assert.equal(coverage.anchorHits, 0);
    assert.ok(shouldExpandWorldCoverage(coverage.score));
  });

  it("motorway rain weak library: expansion filters to cinematic drive, not indie filler", () => {
    const prompt = "empty motorway at midnight rain on the windscreen";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("rainy_motorway_world") ?? getCulturalProfile(world.id)!;

    const expansionPool = [
      { artistName: "M83", trackName: "Midnight City", energy: 0.58 },
      { artistName: "Chromatics", trackName: "Tick of the Clock", energy: 0.45 },
      { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.52 },
      { artistName: "Bon Iver", trackName: "Holocene", energy: 0.3 },
      { artistName: "Phoebe Bridgers", trackName: "Motion Sickness", energy: 0.42 },
    ];
    const filtered = filterWorldAnchorCandidates(expansionPool, profile, world.worldIds);
    const artists = filtered.map((t) => t.artistName);
    assert.ok(artists.includes("M83"));
    assert.ok(artists.includes("Chromatics"));
    assert.ok(artists.includes("Depeche Mode"));
    assert.ok(!artists.includes("Bon Iver"));
    assert.ok(!artists.includes("Phoebe Bridgers"));

    const queries = buildAnchorSearchQueries(profile);
    assert.ok(queries.some((q) => q.includes("M83") || q.includes("Depeche")));
  });

  it("80s night drive weak: New Order/Depeche identity from expansion", () => {
    const prompt = "80s night drive";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("80s_night_drive_world") ?? getCulturalProfile(world.id)!;
    const coverage = assessWorldCoverage(world, weak80sNightLibrary(), profile);
    assert.ok(coverage.anchorHits === 0);

    const expansion = filterWorldAnchorCandidates(
      [
        { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
        { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.52 },
        { artistName: "Florence + The Machine", trackName: "Spectrum", energy: 0.65 },
      ],
      profile,
      world.worldIds,
    );
    assert.ok(expansion.some((t) => t.artistName === "New Order"));
    assert.ok(expansion.some((t) => t.artistName === "Depeche Mode"));
    assert.ok(!expansion.some((t) => t.artistName?.includes("Florence")));
  });

  it("madchester weak: Manchester identity from expansion", () => {
    const prompt = "madchester pub walk";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("madchester_world")!;
    const coverage = assessWorldCoverage(world, weakMadchesterLibrary(), profile);
    assert.equal(coverage.anchorHits, 0);

    const expansion = filterWorldAnchorCandidates(
      [
        { artistName: "The Stone Roses", trackName: "Fools Gold", energy: 0.58 },
        { artistName: "Happy Mondays", trackName: "Step On", energy: 0.62 },
        { artistName: "James Righton", trackName: "Waterloo Sunset", energy: 0.55 },
      ],
      profile,
      world.worldIds,
    );
    assert.ok(expansion.some((t) => t.artistName === "The Stone Roses"));
    assert.ok(expansion.some((t) => t.artistName === "Happy Mondays"));
    assert.ok(!expansion.some((t) => t.artistName === "James Righton"));
  });

  it("disco weak: real disco, not Panic At The Disco", () => {
    const prompt = "disco rooftop party 1978";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("disco_1970s_world")!;
    const coverage = assessWorldCoverage(world, weakDiscoLibrary(), profile);
    assert.equal(coverage.anchorHits, 0);

    const expansion = filterWorldAnchorCandidates(
      [
        { artistName: "Chic", trackName: "Le Freak", energy: 0.72 },
        { artistName: "Bee Gees", trackName: "Stayin' Alive", energy: 0.68 },
        { artistName: "Panic! At The Disco", trackName: "High Hopes", energy: 0.7 },
      ],
      profile,
      world.worldIds,
    );
    assert.ok(expansion.some((t) => t.artistName === "Chic"));
    assert.ok(expansion.some((t) => t.artistName === "Bee Gees"));
    assert.ok(!expansion.some((t) => t.artistName?.includes("Panic")));
  });

  it("thesis opener: expansion candidate promoted over weak liked opener", () => {
    const prompt = "empty motorway at midnight rain on the windscreen";
    const world = resolveCommittedWorld({ prompt })!;
    const tracks = weakMotorwayLibrary();
    const expansion = [
      { artistName: "M83", trackName: "Midnight City", energy: 0.58 },
      { artistName: "Chromatics", trackName: "Tick of the Clock", energy: 0.45 },
    ];
    const thesis = enforceThesisOpenerGate(tracks, world, 15, expansion);
    const opener = thesis.tracks[0]!;
    assert.ok(
      opener.artistName === "M83" || opener.artistName === "Chromatics",
      `expected cinematic opener, got ${opener.artistName}`,
    );
    assert.ok(thesis.openerScore >= 0.8);
  });

  it("coverage-aware HQG caps tracks by coverage level", () => {
    const highCap = coverageLevelToMaxTracks("HIGH", 25);
    const mediumCap = coverageLevelToMaxTracks("MEDIUM", 25);
    const lowCap = coverageLevelToMaxTracks("LOW", 25);
    const veryLowCap = coverageLevelToMaxTracks("VERY_LOW", 25);

    assert.equal(highCap, 25);
    assert.ok(mediumCap >= 15 && mediumCap <= 20);
    assert.ok(lowCap >= 8 && lowCap <= 12);
    assert.ok(veryLowCap <= 5);

    const lowHqg = evaluateHumanQualityGate({
      trackCount: 20,
      requestedLength: 25,
      committedWorldHardLock: true,
      coverageLevel: "LOW",
    });
    assert.equal(lowHqg.action, "honest_partial");
    assert.ok(lowHqg.salvageableCount <= 12);
  });

  it("coverage user messages are honest", () => {
    assert.match(coverageUserMessage("HIGH"), /library/i);
    assert.match(coverageUserMessage("MEDIUM"), /wider search/i);
    assert.match(coverageUserMessage("LOW"), /thin/i);
    assert.match(coverageUserMessage("VERY_LOW"), /doesn't have enough/i);
  });

  it("coverage unit: anchor artist scores world identity >= 0.8", () => {
    const profile = getCulturalProfile("rainy_motorway_world")!;
    assert.ok(scoreTrackWorldIdentity({ artistName: "M83", trackName: "Midnight City" }, profile) >= 0.8);
    assert.ok(scoreTrackWorldIdentity({ artistName: "Depeche Mode", trackName: "Enjoy the Silence" }, profile) >= 0.8);
  });
});
