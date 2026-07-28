import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import { evaluateWorldProof } from "../core/editorial/world-proof-gate";
import {
  inferWorldIdentityIdsFromPrompt,
  passesWorldIdentity,
  worldIdentityProfilesForLock,
} from "../core/editorial/world-identity-gate";
import { artistForbiddenInWorld } from "../core/editorial/artist-identity-map";
import {
  parsePromptNegationEnforcement,
  trackViolatesPromptNegation,
} from "../lib/prompt-negation-enforcement";

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

describe("V7 human world regression", () => {
  it("maps V7 prompt phrases to explicit world ids", () => {
    assert.ok(inferWorldIdentityIdsFromPrompt("80s night drive").includes("80s_night_drive_world"));
    assert.ok(inferWorldIdentityIdsFromPrompt("madchester pub walk").includes("madchester_world"));
    assert.ok(inferWorldIdentityIdsFromPrompt("road trip singalong").includes("road_trip_singalong_world"));
    assert.ok(inferWorldIdentityIdsFromPrompt("petrol station 2am").includes("petrol_station_2am_world"));
    assert.ok(inferWorldIdentityIdsFromPrompt("gym workout").includes("heavy_gym_world"));
    assert.ok(inferWorldIdentityIdsFromPrompt("rainy motorway").includes("rainy_motorway_world"));
  });

  it("80s night drive: synth/post-punk passes, Bon Iver and Beach House rejected", () => {
    const prompt = "80s night drive";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "80s_night_drive_world");

    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Blue Monday",
        artistName: "New Order",
        genreFamily: "electronic",
        energy: 0.62,
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
    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Space Song",
        artistName: "Beach House",
        genreFamily: "indie",
        energy: 0.45,
      }),
      false,
    );
  });

  it("madchester: UK identity passes, American indie landfill rejected", () => {
    const prompt = "madchester pub walk";
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
    assert.equal(
      artistForbiddenInWorld("Bon Iver", [world.id]),
      true,
    );
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

  it("road trip singalong: big hooks pass, quiet acoustic rejected", () => {
    const prompt = "road trip singalong";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "road_trip_singalong_world");

    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Wonderwall",
        artistName: "Oasis",
        genreFamily: "rock",
        energy: 0.72,
      }),
      true,
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

  it("grunge: Nirvana/Pearl Jam pass, Green Day pop-punk rejected", () => {
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
        trackName: "Alive",
        artistName: "Pearl Jam",
        genreFamily: "rock",
        energy: 0.75,
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

  it("rainy motorway: cinematic driving passes, sad indie landfill rejected", () => {
    const prompt = "rainy motorway";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "rainy_motorway_world");

    assert.equal(
      trackPassesWorld(prompt, world.id, {
        trackName: "Enjoy the Silence",
        artistName: "Depeche Mode",
        genreFamily: "electronic",
        energy: 0.55,
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
  });

  it("gym: energy floor passes metal, rejects vulnerable acoustic", () => {
    const prompt = "gym workout";
    const world = resolveCommittedWorld({ prompt })!;
    assert.equal(world.id, "heavy_gym_world");

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
        trackName: "Naked As We Came",
        artistName: "Iron & Wine",
        genreFamily: "folk",
        energy: 0.22,
      }),
      false,
    );
  });

  it("world proof fails when track 1 is off-world and caps honest partial", () => {
    const committed = resolveCommittedWorld({ prompt: "80s night drive" })!;
    const proof = evaluateWorldProof({
      committed,
      prompt: "80s night drive",
      requestedLength: 25,
      tracks: [
        { trackId: "1", trackName: "Holocene", artistName: "Bon Iver", genreFamily: "indie", energy: 0.3 },
        { trackId: "2", trackName: "Blue Monday", artistName: "New Order", genreFamily: "electronic", energy: 0.62 },
        { trackId: "3", trackName: "Enjoy the Silence", artistName: "Depeche Mode", genreFamily: "electronic", energy: 0.55 },
        { trackId: "4", trackName: "Bizarre Love Triangle", artistName: "New Order", genreFamily: "electronic", energy: 0.58 },
        { trackId: "5", trackName: "Temptation", artistName: "New Order", genreFamily: "electronic", energy: 0.6 },
      ],
    });
    assert.equal(proof.trackOnePassed, false);
    assert.equal(proof.passed, false);
    assert.ok(proof.fidelity.openerFailures.length >= 1);
  });

  it("negation enforcement blocks rap, christmas, acoustic, sad, guitar", () => {
    const rap = parsePromptNegationEnforcement("gym workout no rap");
    assert.equal(trackViolatesPromptNegation({ artistName: "Drake", genreFamily: "hip_hop" }, rap), "negation:rap");

    const xmas = parsePromptNegationEnforcement("cozy winter no christmas");
    assert.equal(
      trackViolatesPromptNegation({ trackName: "Last Christmas", artistName: "Wham!" }, xmas),
      "negation:christmas",
    );

    const acoustic = parsePromptNegationEnforcement("party no acoustic");
    assert.equal(
      trackViolatesPromptNegation({ trackName: "Pink Moon", artistName: "Nick Drake", genreFamily: "folk", acousticness: 0.9 }, acoustic),
      "negation:acoustic",
    );

    const sad = parsePromptNegationEnforcement("upbeat morning no sad songs");
    assert.equal(
      trackViolatesPromptNegation({ trackName: "Sad Song", artistName: "Adele" }, sad),
      "negation:sad",
    );

    const guitar = parsePromptNegationEnforcement("electronic focus no guitar");
    assert.equal(
      trackViolatesPromptNegation({ trackName: "Sweet Child O' Mine", artistName: "Guns N' Roses", genreFamily: "rock" }, guitar),
      "negation:guitar",
    );
  });
});
