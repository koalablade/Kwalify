import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";
import { enforceThesisOpener, trackMeetsThesisOpener } from "../core/editorial/thesis-opener-gate";
import {
  evaluateWorldProof,
  stripTailWorldViolations,
  filterTracksByFullWorldProof,
} from "../core/editorial/world-proof-gate";
import {
  trackViolatesPromptNegation,
  parsePromptNegationEnforcement,
  filterTracksForDeliveryNegation,
} from "../lib/prompt-negation-enforcement";
import { isRemixBaitTrackTitle } from "../core/editorial/opener-hygiene";

describe("V12 keep conversion", () => {
  it("80s night drive rejects remix T1, promotes Cure/New Order", () => {
    const prompt = "80s night drive";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("80s_night_drive_world")!;
    assert.equal(scoreTrackWorldIdentity({ artistName: "nimino", trackName: "Badger Remix", energy: 0.6 }, profile), 0);
    assert.ok(isRemixBaitTrackTitle("I Only Smoke When I Drink - Badger Remix"));

    const tracks = [
      { artistName: "nimino", trackName: "I Only Smoke When I Drink - Badger Remix", energy: 0.6 },
      { artistName: "Calvin Harris", trackName: "I'm Not Alone - CamelPhat Remix", energy: 0.62 },
      { artistName: "The Cure", trackName: "Just Like Heaven", energy: 0.58 },
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
    const opener = thesis.tracks[0]!;
    assert.ok(
      opener.artistName === "The Cure" || opener.artistName === "New Order",
      `expected 80s anchor opener, got ${opener.artistName}`,
    );
    assert.ok(!isRemixBaitTrackTitle(opener.trackName));
    assert.ok(thesis.openerScore >= 0.8);
    assert.ok(trackMeetsThesisOpener(opener, world).passed);
  });

  it("motorway tail strips party/phonky tracks 5-10", () => {
    const prompt = "empty motorway at midnight rain on the windscreen";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("rainy_motorway_world") ?? getCulturalProfile(world.id)!;
    assert.equal(
      scoreTrackWorldIdentity({ artistName: "Destructo Disk", trackName: "Glenda", energy: 0.55 }, profile),
      0,
    );
    assert.equal(
      scoreTrackWorldIdentity({ artistName: "Mungo's Hi Fi", trackName: "Jump Up Quickly", energy: 0.62 }, profile),
      0,
    );

    const tracks = [
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
      { artistName: "M83", trackName: "Midnight City", energy: 0.58 },
      { artistName: "Chromatics", trackName: "Tick of the Clock", energy: 0.45 },
      { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.52 },
      { artistName: "Destructo Disk", trackName: "Glenda", energy: 0.55 },
      { artistName: "Mungo's Hi Fi", trackName: "Jump Up Quickly", energy: 0.62 },
      { artistName: "Oliver Heldens", trackName: "Gecko - Radio Edit", energy: 0.7 },
      { artistName: "New Order", trackName: "True Faith", energy: 0.58 },
      { artistName: "M83", trackName: "Wait", energy: 0.5 },
      { artistName: "Chromatics", trackName: "Cherry", energy: 0.48 },
    ];
    const stripped = stripTailWorldViolations(tracks, world);
    assert.ok(stripped.removed >= 2);
    assert.ok(!stripped.tracks.some((t) => t.artistName === "Destructo Disk"));
    assert.ok(!stripped.tracks.some((t) => t.artistName?.includes("Mungo")));
    assert.equal(stripped.tracks[0]!.artistName, "New Order");
  });

  it("country routes to country_world, rejects Arctic Monkeys", () => {
    const prompt = "country cowboy road trip";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "country_world");
    assert.equal(world.hardLock, true);
    const profile = getCulturalProfile("country_world")!;
    assert.equal(
      scoreTrackWorldIdentity({ artistName: "Arctic Monkeys", trackName: "Fluorescent Adolescent", energy: 0.62 }, profile),
      0,
    );
    assert.ok(
      scoreTrackWorldIdentity({ artistName: "Johnny Cash", trackName: "Ring of Fire", energy: 0.55 }, profile) >= 0.8,
    );
    const tracks = [
      { artistName: "The Jungle Giants", trackName: "Lights & Music", energy: 0.62 },
      { artistName: "Johnny Cash", trackName: "Ring of Fire", energy: 0.55 },
      { artistName: "Luke Combs", trackName: "Beautiful Crazy", energy: 0.58 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
    assert.equal(thesis.tracks[0]!.artistName, "Johnny Cash");
  });

  it("no rap gym returns rock/metal not 0 tracks", () => {
    const prompt = "no rap gym workout";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "gym_rock_world");
    const profile = getCulturalProfile(world.id)!;
    const negation = parsePromptNegationEnforcement(prompt);
    const pool = [
      { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85, genreFamily: "rock" },
      { artistName: "Metallica", trackName: "Enter Sandman", energy: 0.88, genreFamily: "metal" },
      { artistName: "Drake", trackName: "God's Plan", energy: 0.6, genreFamily: "hip_hop" },
      { artistName: "The Prodigy", trackName: "Firestarter", energy: 0.9, genreFamily: "electronic" },
    ];
    const filtered = filterTracksForDeliveryNegation(pool, negation);
    assert.ok(filtered.tracks.length >= 3);
    assert.ok(filtered.tracks.some((t) => t.artistName === "AC/DC"));
    assert.ok(filtered.tracks.some((t) => t.artistName === "Metallica"));
    assert.ok(!filtered.tracks.some((t) => t.artistName === "Drake"));
    assert.equal(trackViolatesPromptNegation({ artistName: "AC/DC", trackName: "T.N.T.", genreFamily: "rock" }, negation), null);

    const tracks = [
      { artistName: "Green Day", trackName: "Brain Stew", energy: 0.72 },
      { artistName: "Metallica", trackName: "Enter Sandman", energy: 0.88 },
      { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85 },
    ];
    const thesis = enforceThesisOpener(tracks, profile, world, undefined, 20);
    assert.ok(
      thesis.tracks[0]!.artistName === "Metallica" || thesis.tracks[0]!.artistName === "AC/DC",
      `expected gym anchor opener, got ${thesis.tracks[0]!.artistName}`,
    );
  });

  it("regression: madchester/dad rock/disco/gym still KEEP anchors", () => {
    const madchester = resolveCommittedWorld({ prompt: "madchester pub walk" })!;
    const madProfile = getCulturalProfile("madchester_world")!;
    const madThesis = enforceThesisOpener(
      [
        { artistName: "James Righton", trackName: "Waterloo Sunset", energy: 0.55 },
        { artistName: "Oasis", trackName: "Wonderwall", energy: 0.55 },
      ],
      madProfile,
      madchester,
      undefined,
      20,
    );
    assert.equal(madThesis.tracks[0]!.artistName, "Oasis");

    const dadRock = resolveCommittedWorld({ prompt: "dad rock BBQ with beers" })!;
    const dadProfile = getCulturalProfile("dad_rock_world")!;
    const dadThesis = enforceThesisOpener(
      [
        { artistName: "Bon Iver", trackName: "Skinny Love", energy: 0.4 },
        { artistName: "AC/DC", trackName: "Back In Black", energy: 0.85 },
      ],
      dadProfile,
      dadRock,
      undefined,
      20,
    );
    assert.equal(dadThesis.tracks[0]!.artistName, "AC/DC");

    const disco = resolveCommittedWorld({ prompt: "disco rooftop party 1978" })!;
    const discoProfile = getCulturalProfile("disco_1970s_world")!;
    const discoThesis = enforceThesisOpener(
      [
        { artistName: "Panic! At The Disco", trackName: "High Hopes", energy: 0.7 },
        { artistName: "Michael Jackson", trackName: "Rock with You", energy: 0.68 },
      ],
      discoProfile,
      disco,
      undefined,
      20,
    );
    assert.equal(discoThesis.tracks[0]!.artistName, "Michael Jackson");

    const gym = resolveCommittedWorld({ prompt: "heavy gym workout aggressive" })!;
    const gymProfile = getCulturalProfile(gym.id)!;
    const gymThesis = enforceThesisOpener(
      [
        { artistName: "Paramore", trackName: "Hard Times", energy: 0.74 },
        { artistName: "AC/DC", trackName: "T.N.T.", energy: 0.88 },
      ],
      gymProfile,
      gym,
      undefined,
      20,
    );
    assert.ok(gymThesis.tracks[0]!.artistName === "AC/DC" || gymThesis.tracks[0]!.artistName === "Metallica");
  });

  it("full world proof uses tail sample indices 0,2,4,9", () => {
    const prompt = "80s night drive";
    const world = resolveCommittedWorld({ prompt })!;
    const tracks = [
      { artistName: "The Cure", trackName: "Just Like Heaven", energy: 0.58 },
      { artistName: "nimino", trackName: "Badger Remix", energy: 0.6 },
      { artistName: "New Order", trackName: "Blue Monday", energy: 0.65 },
      { artistName: "Depeche Mode", trackName: "Enjoy the Silence", energy: 0.52 },
      { artistName: "Pet Shop Boys", trackName: "West End Girls", energy: 0.6 },
      { artistName: "The Cure", trackName: "Friday I'm in Love", energy: 0.58 },
      { artistName: "New Order", trackName: "True Faith", energy: 0.58 },
      { artistName: "Depeche Mode", trackName: "Personal Jesus", energy: 0.62 },
      { artistName: "Simple Minds", trackName: "Don't You", energy: 0.6 },
      { artistName: "The Cure", trackName: "Lovesong", energy: 0.55 },
    ];
    const proof = evaluateWorldProof({ tracks, committed: world, prompt, requestedLength: 15, coverageLevel: "HIGH" });
    assert.ok(proof.fullPlaylistPassed);
    const filtered = filterTracksByFullWorldProof(tracks, world);
    assert.ok(filtered.tracks.length >= 8);
  });
});
