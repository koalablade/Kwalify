import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  committedWorldArtistForbidden,
  committedWorldArtistRepresentativeScore,
  resolveCommittedWorld,
} from "../core/committed-world";
import { evaluateWorldProof } from "../core/editorial/world-proof-gate";
import {
  inferWorldIdentityIdsFromPrompt,
  passesWorldIdentity,
  worldIdentityProfilesForLock,
} from "../core/editorial/world-identity-gate";
import { artistForbiddenInWorld } from "../core/editorial/artist-identity-map";
import { promoteWorldThesisOpener } from "../core/editorial/opener-hygiene";

function profilesForPrompt(prompt: string, worldId: string) {
  return worldIdentityProfilesForLock({
    prompt,
    anchors: [worldId],
    reason: `committed_world:explicit_genre:${worldId}`,
  });
}

function trackPassesWorld(
  prompt: string,
  worldId: string,
  track: {
    trackName: string;
    artistName: string;
    genreFamily?: string;
    genrePrimary?: string;
    energy?: number;
  },
): boolean {
  const profiles = profilesForPrompt(prompt, worldId);
  return passesWorldIdentity(
    {
      trackName: track.trackName,
      artistName: track.artistName,
      genreFamily: track.genreFamily ?? null,
      genrePrimary: track.genrePrimary ?? null,
      energy: track.energy ?? null,
    },
    profiles,
    { hardLock: true },
  );
}

describe("V8 human save regression", () => {
  it("dad rock: classic rock identity, no Bon Iver/Phoebe/Clairo", () => {
    const prompt = "dad rock";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "dad_rock_world");
    assert.ok(world.hardLock);
    assert.ok(world.forbiddenArtists.length > 0);

    assert.equal(
      committedWorldArtistForbidden(world, "Bon Iver", "Holocene"),
      true,
    );
    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Don't Stop Me Now",
        artistName: "Queen",
        genreFamily: "rock",
        energy: 0.72,
      }),
      true,
    );
    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Skinny Love",
        artistName: "Bon Iver",
        genreFamily: "indie",
        energy: 0.25,
      }),
      false,
    );
    assert.equal(artistForbiddenInWorld("Phoebe Bridgers", [world.id]), true);
    assert.equal(artistForbiddenInWorld("Clairo", [world.id]), true);
  });

  it("empty motorway midnight rain: night drive, no hip hop/party/acoustic", () => {
    const prompt = "empty motorway at midnight rain on the windscreen";
    const world = resolveCommittedWorld({ prompt })!;
    assert.ok(
      world.id === "rainy_drive_world" ||
        world.id === "rainy_motorway_world" ||
        world.id === "night_drive_world",
    );

    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Midnight City",
        artistName: "M83",
        genreFamily: "electronic",
        energy: 0.58,
      }),
      true,
    );
    assert.equal(
      committedWorldArtistForbidden(world, "Drake", "God's Plan"),
      false,
    );
    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Pink Moon",
        artistName: "Nick Drake",
        genreFamily: "folk",
        energy: 0.28,
      }),
      false,
    );
  });

  it("gym heavy rock: high energy, no Bon Iver/slow acoustic", () => {
    const prompt = "heavy gym workout rock";
    const world = resolveCommittedWorld({ prompt })!;
    assert.ok(
      world.id === "gym_rock_world" ||
        world.id === "heavy_gym_world" ||
        world.id === "angry_rock_world",
    );

    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Enter Sandman",
        artistName: "Metallica",
        genreFamily: "metal",
        energy: 0.88,
      }),
      true,
    );
    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Holocene",
        artistName: "Bon Iver",
        genreFamily: "indie",
        energy: 0.3,
      }),
      false,
    );
    assert.equal(artistForbiddenInWorld("Scooter", [world.id]), true);
  });

  it("90s grunge: Seattle identity, Green Day not grunge", () => {
    const prompt = "90s grunge";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "grunge_world");

    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Smells Like Teen Spirit",
        artistName: "Nirvana",
        genreFamily: "rock",
        energy: 0.8,
      }),
      true,
    );
    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Basket Case",
        artistName: "Green Day",
        genreFamily: "rock",
        energy: 0.78,
      }),
      false,
    );
  });

  it("madchester: UK/Manchester, no American sad indie", () => {
    const prompt = "madchester";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "madchester_world");

    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Fools Gold",
        artistName: "The Stone Roses",
        genreFamily: "rock",
        energy: 0.58,
      }),
      true,
    );
    assert.equal(artistForbiddenInWorld("Bon Iver", [world.id]), true);
    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Myth",
        artistName: "Beach House",
        genreFamily: "indie",
        energy: 0.42,
      }),
      false,
    );
  });

  it("disco: 70s dance identity", () => {
    const prompt = "70s disco rooftop party";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "disco_1970s_world");

    assert.ok(
      committedWorldArtistRepresentativeScore(world, "Donna Summer") >= 0.9 ||
        committedWorldArtistRepresentativeScore(world, "Chic") >= 0.9,
    );
    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Le Freak",
        artistName: "Chic",
        genreFamily: "soul",
        energy: 0.72,
      }),
      true,
    );
  });

  it("world proof fails body tracks 6-10 when off-world", () => {
    const committed = resolveCommittedWorld({ prompt: "dad rock" })!;
    const proof = evaluateWorldProof({
      committed,
      prompt: "dad rock",
      requestedLength: 25,
      tracks: [
        { trackId: "1", trackName: "Don't Stop Me Now", artistName: "Queen", genreFamily: "rock", energy: 0.72 },
        { trackId: "2", trackName: "Highway to Hell", artistName: "AC/DC", genreFamily: "rock", energy: 0.78 },
        { trackId: "3", trackName: "Hotel California", artistName: "Eagles", genreFamily: "rock", energy: 0.65 },
        { trackId: "4", trackName: "Go Your Own Way", artistName: "Fleetwood Mac", genreFamily: "rock", energy: 0.68 },
        { trackId: "5", trackName: "Free Fallin'", artistName: "Tom Petty", genreFamily: "rock", energy: 0.62 },
        { trackId: "6", trackName: "Holocene", artistName: "Bon Iver", genreFamily: "indie", energy: 0.3 },
        { trackId: "7", trackName: "Motion Sickness", artistName: "Phoebe Bridgers", genreFamily: "indie", energy: 0.42 },
        { trackId: "8", trackName: "Bags", artistName: "Clairo", genreFamily: "indie", energy: 0.45 },
        { trackId: "9", trackName: "Skinny Love", artistName: "Bon Iver", genreFamily: "indie", energy: 0.25 },
        { trackId: "10", trackName: "Yellow", artistName: "Coldplay", genreFamily: "rock", energy: 0.55 },
      ],
    });
    assert.equal(proof.bodyPassed, false);
    assert.equal(proof.passed, false);
    assert.ok(proof.fidelity.bodyFailures.length >= 1);
  });

  it("promoteWorldThesisOpener moves representative artist to track 1", () => {
    const committed = resolveCommittedWorld({ prompt: "dad rock" })!;
    const tracks = [
      { artistName: "Bon Iver", trackName: "Holocene" },
      { artistName: "Queen", trackName: "Don't Stop Me Now" },
      { artistName: "AC/DC", trackName: "Highway to Hell" },
    ];
    const result = promoteWorldThesisOpener(tracks, (t) =>
      committedWorldArtistRepresentativeScore(committed, t.artistName),
    );
    assert.equal(result.promoted, true);
    assert.match(result.tracks[0]!.artistName ?? "", /queen/i);
  });

  it("80s night drive: The 1975 forbidden, Depeche Mode passes", () => {
    const prompt = "80s night drive";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "80s_night_drive_world");
    assert.equal(artistForbiddenInWorld("The 1975", [world.id]), true);
    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Enjoy the Silence",
        artistName: "Depeche Mode",
        genreFamily: "electronic",
        energy: 0.55,
      }),
      true,
    );
  });

  it("Fleetwood Mac is yacht/classic rock, not grunge", () => {
    assert.equal(artistForbiddenInWorld("Fleetwood Mac", ["grunge_world"]), true);
    assert.equal(artistForbiddenInWorld("Fleetwood Mac", ["classic_rock_world"]), false);
    assert.ok(
      committedWorldArtistRepresentativeScore(
        resolveCommittedWorld({ prompt: "yacht rock" })!,
        "Fleetwood Mac",
      ) >= 0.9,
    );
  });
});
