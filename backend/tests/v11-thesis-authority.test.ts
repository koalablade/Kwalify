import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";
import { enforceThesisOpener, trackMeetsThesisOpener } from "../core/editorial/thesis-opener-gate";
import {
  evaluateWorldProof,
  filterTracksByFullWorldProof,
  V11_FULL_PLAYLIST_SAMPLE_INDICES,
} from "../core/editorial/world-proof-gate";
import { filterWorldAnchorCandidates } from "../core/editorial/world-anchor-retrieval";
import { evaluateHumanUnderstoodGate, wouldPersonFeelUnderstood } from "../core/editorial/human-understood-gate";

describe("V11 thesis authority", () => {
  it("madchester: Oasis/Stone Roses promoted over James Righton", () => {
    const prompt = "madchester pub walk";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("madchester_world")!;
    const tracks = [
      { artistName: "James Righton", trackName: "Waterloo Sunset", energy: 0.55 },
      { artistName: "Arctic Monkeys", trackName: "Fluorescent Adolescent", energy: 0.62 },
      { artistName: "Oasis", trackName: "Wonderwall", energy: 0.55 },
      { artistName: "The Stone Roses", trackName: "Fools Gold", energy: 0.58 },
    ];
    const expansion = filterWorldAnchorCandidates(
      [
        { artistName: "The Stone Roses", trackName: "Fools Gold", energy: 0.58 },
        { artistName: "Happy Mondays", trackName: "Step On", energy: 0.62 },
        { artistName: "James Righton", trackName: "Waterloo Sunset", energy: 0.55 },
      ],
      profile,
      world.worldIds,
    );
    const thesis = enforceThesisOpener(tracks, profile, world, expansion as typeof tracks, 20);
    const opener = thesis.tracks[0]!;
    assert.ok(
      opener.artistName === "Oasis" ||
        opener.artistName === "The Stone Roses" ||
        opener.artistName === "Happy Mondays",
      `expected Manchester anchor opener, got ${opener.artistName}`,
    );
    assert.notEqual(opener.artistName, "James Righton");
    assert.ok(thesis.openerScore >= 0.8);
  });

  it("motorway: Chromatics/M83 promoted over KURUPT FM/BLK", () => {
    const prompt = "empty motorway at midnight rain on the windscreen";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("rainy_motorway_world") ?? getCulturalProfile(world.id)!;
    const tracks = [
      { artistName: "KURUPT FM", trackName: "Summertime", energy: 0.55 },
      { artistName: "BLK", trackName: "Keycaps", energy: 0.55 },
      { artistName: "Arctic Monkeys", trackName: "Do I Wanna Know?", energy: 0.62 },
    ];
    const expansion = [
      { artistName: "M83", trackName: "Midnight City", energy: 0.58 },
      { artistName: "Chromatics", trackName: "Tick of the Clock", energy: 0.45 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, expansion as typeof tracks, 20);
    const opener = thesis.tracks[0]!;
    assert.ok(
      opener.artistName === "M83" || opener.artistName === "Chromatics",
      `expected cinematic opener, got ${opener.artistName}`,
    );
    assert.ok(thesis.openerScore >= 0.8);
  });

  it("gym: AC/DC/Metallica promoted over Paramore soft tracks", () => {
    const prompt = "heavy gym workout aggressive";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile(world.id)!;
    const tracks = [
      { artistName: "Paramore", trackName: "Hard Times", energy: 0.74 },
      { artistName: "Fall Out Boy", trackName: "Sugar We're Goin Down", energy: 0.75 },
      { artistName: "Metallica", trackName: "Enter Sandman", energy: 0.88 },
      { artistName: "AC/DC", trackName: "Back in Black", energy: 0.85 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
    const opener = thesis.tracks[0]!;
    assert.ok(
      opener.artistName === "Metallica" || opener.artistName === "AC/DC",
      `expected gym anchor opener, got ${opener.artistName}`,
    );
    assert.notEqual(opener.artistName, "Paramore");
    assert.ok(thesis.openerScore >= 0.8);
  });

  it("disco: no Panic At The Disco in expansion or opener", () => {
    const prompt = "disco rooftop party 1978";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("disco_1970s_world")!;
    assert.equal(scoreTrackWorldIdentity({ artistName: "Panic! At The Disco", trackName: "High Hopes", energy: 0.7 }, profile), 0);
    const expansion = filterWorldAnchorCandidates(
      [
        { artistName: "Chic", trackName: "Le Freak", energy: 0.72 },
        { artistName: "Bee Gees", trackName: "Stayin' Alive", energy: 0.68 },
        { artistName: "Panic! At The Disco", trackName: "High Hopes", energy: 0.7 },
      ],
      profile,
      world.worldIds,
    );
    assert.ok(!expansion.some((t) => t.artistName?.includes("Panic")));
    const tracks = [
      { artistName: "Panic! At The Disco", trackName: "High Hopes", energy: 0.7 },
      { artistName: "Chic", trackName: "Le Freak", energy: 0.72 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, expansion as typeof tracks, 20);
    assert.notEqual(thesis.tracks[0]!.artistName, "Panic! At The Disco");
    assert.equal(thesis.tracks[0]!.artistName, "Chic");
  });

  it("80s night drive: The Cure passes world identity", () => {
    const prompt = "80s night drive";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("80s_night_drive_world") ?? getCulturalProfile(world.id)!;
    const cureScore = scoreTrackWorldIdentity(
      { artistName: "The Cure", trackName: "Just Like Heaven", energy: 0.58 },
      profile,
    );
    assert.ok(cureScore >= 0.8, `The Cure should pass 80s night drive, score=${cureScore}`);
  });

  it("full playlist: 80%+ sampled tracks pass world identity on hard lock", () => {
    const prompt = "madchester pub walk";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("madchester_world")!;
    const goodTracks = [
      { artistName: "The Stone Roses", trackName: "Fools Gold", energy: 0.58 },
      { artistName: "Happy Mondays", trackName: "Step On", energy: 0.62 },
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
      { artistName: "Oasis", trackName: "Wonderwall", energy: 0.55 },
      { artistName: "The Stone Roses", trackName: "I Am the Resurrection", energy: 0.7 },
      { artistName: "Happy Mondays", trackName: "Kinky Afro", energy: 0.6 },
      { artistName: "New Order", trackName: "Bizarre Love Triangle", energy: 0.58 },
      { artistName: "Oasis", trackName: "Don't Look Back in Anger", energy: 0.62 },
      { artistName: "The Stone Roses", trackName: "Waterfall", energy: 0.55 },
      { artistName: "Happy Mondays", trackName: "Loose Fit", energy: 0.6 },
      { artistName: "Oasis", trackName: "Live Forever", energy: 0.58 },
      { artistName: "New Order", trackName: "True Faith", energy: 0.6 },
      { artistName: "The Stone Roses", trackName: "She Bangs the Drums", energy: 0.62 },
      { artistName: "Happy Mondays", trackName: "Hallelujah", energy: 0.58 },
      { artistName: "Oasis", trackName: "Champagne Supernova", energy: 0.55 },
    ];
    const proof = evaluateWorldProof({
      tracks: goodTracks,
      committed: world,
      prompt,
      requestedLength: 15,
      coverageLevel: "HIGH",
    });
    assert.ok(proof.fullPlaylistPassed, `sample pass rate ${proof.samplePassRate}`);
    assert.equal(V11_FULL_PLAYLIST_SAMPLE_INDICES.length, 6);

    const mixed = [
      ...goodTracks.slice(0, 5),
      { artistName: "James Righton", trackName: "Waterloo Sunset", energy: 0.55 },
      ...goodTracks.slice(6),
    ];
    const filtered = filterTracksByFullWorldProof(mixed, world, "HIGH");
    assert.ok(filtered.tracks.length >= 3);
    assert.ok(!filtered.tracks.some((t) => t.artistName === "James Righton"));
  });

  it("human understood gate: wrong world refuses, good world passes", () => {
    const prompt = "madchester pub walk";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("madchester_world")!;
    const badTracks = [
      { artistName: "James Righton", trackName: "Waterloo Sunset", energy: 0.55 },
      { artistName: "Bon Iver", trackName: "Holocene", energy: 0.3 },
      { artistName: "Phoebe Bridgers", trackName: "Motion Sickness", energy: 0.42 },
    ];
    const badThesis = enforceThesisOpener(badTracks, profile, world, [], 20);
    const badProof = evaluateWorldProof({
      tracks: badThesis.tracks,
      committed: world,
      prompt,
      requestedLength: 15,
    });
    const badUnderstood = evaluateHumanUnderstoodGate({
      trackCount: badThesis.tracks.length,
      requestedLength: 15,
      committed: world,
      thesis: badThesis,
      worldProof: badProof,
      negationViolations: 0,
      openerNegationViolations: 0,
    });
    assert.ok(badUnderstood.action === "refuse" || badUnderstood.action === "honest_partial");

    const goodTracks = [
      { artistName: "Oasis", trackName: "Wonderwall", energy: 0.55 },
      { artistName: "The Stone Roses", trackName: "Fools Gold", energy: 0.58 },
      { artistName: "Happy Mondays", trackName: "Step On", energy: 0.62 },
    ];
    const goodThesis = enforceThesisOpener(goodTracks, profile, world, undefined, 20);
    const goodProof = evaluateWorldProof({
      tracks: goodThesis.tracks,
      committed: world,
      prompt,
      requestedLength: 15,
    });
    assert.ok(
      wouldPersonFeelUnderstood({
        trackCount: goodThesis.tracks.length,
        requestedLength: 15,
        committed: world,
        thesis: goodThesis,
        worldProof: goodProof,
        negationViolations: 0,
        openerNegationViolations: 0,
      }),
    );
    const openerCheck = trackMeetsThesisOpener(goodThesis.tracks[0]!, world);
    assert.ok(openerCheck.passed);
  });
});
