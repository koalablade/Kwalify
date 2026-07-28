import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import { evaluateIntentFidelity, selectIntentFidelityHonestPartialTracks } from "../core/editorial/intent-fidelity-gate";
import {
  inferWorldIdentityIdsFromPrompt,
  isSafetyBlanketOutsideWorld,
  passesWorldIdentity,
  worldIdentityProfilesForLock,
} from "../core/editorial/world-identity-gate";
import { evaluateHumanQualityGate } from "../core/editorial/human-quality-gate";
import { selectEditorialWorld } from "../core/editorial/intent-collapse-layer";
import { buildLockedIntent } from "../core/v3/intent";
import { analyzeVibe } from "../lib/emotion";

describe("V6 human quality sprint", () => {
  it("resolveCommittedWorld locks dad rock to classic_rock_world", () => {
    const world = resolveCommittedWorld({ prompt: "dads rock BBQ" });
    assert.ok(world);
    assert.equal(world.id, "classic_rock_world");
    assert.equal(world.hardLock, true);
    assert.equal(world.source, "explicit_genre");
  });

  it("resolveCommittedWorld locks motorway rain to rainy_drive_world", () => {
    const world = resolveCommittedWorld({
      prompt: "empty motorway at midnight, rain on the windscreen",
    });
    assert.ok(world);
    assert.equal(world.id, "rainy_drive_world");
    assert.equal(world.hardLock, true);
  });

  it("resolveCommittedWorld locks yacht rock and gym aggressive worlds", () => {
    const yacht = resolveCommittedWorld({ prompt: "yacht rock sunset by the pool" });
    assert.equal(yacht?.id, "yacht_rock_world");
    assert.equal(yacht?.hardLock, true);

    const gym = resolveCommittedWorld({ prompt: "heavy gym workout, aggressive" });
    assert.equal(gym?.id, "angry_rock_world");
    assert.equal(gym?.hardLock, true);

    const disco = resolveCommittedWorld({ prompt: "70s disco party rooftop" });
    assert.equal(disco?.id, "disco_party_world");
    assert.equal(disco?.hardLock, true);
  });

  it("intent fidelity rejects Bon Iver opener on dad rock hard lock", () => {
    const committed = resolveCommittedWorld({ prompt: "dad rock" })!;
    const result = evaluateIntentFidelity({
      committed,
      prompt: "dad rock",
      requestedLength: 25,
      tracks: [
        { trackId: "1", trackName: "Holocene", artistName: "Bon Iver", genreFamily: "indie", energy: 0.3 },
        { trackId: "2", trackName: "Don't Stop Believin'", artistName: "Journey", genreFamily: "rock", energy: 0.7 },
        { trackId: "3", trackName: "Sweet Child O' Mine", artistName: "Guns N' Roses", genreFamily: "rock", energy: 0.75 },
      ],
    });
    assert.equal(result.openerPassed, false);
    assert.equal(result.passed, false);
  });

  it("intent fidelity rejects Phoebe Bridgers on rainy motorway hard lock", () => {
    const committed = resolveCommittedWorld({
      prompt: "empty motorway at midnight, rain on the windscreen",
    })!;
    const result = evaluateIntentFidelity({
      committed,
      prompt: "empty motorway at midnight, rain on the windscreen",
      requestedLength: 25,
      tracks: [
        { trackId: "1", trackName: "Moon Song", artistName: "Phoebe Bridgers", genreFamily: "indie", energy: 0.35 },
        { trackId: "2", trackName: "Intro", artistName: "The xx", genreFamily: "electronic", energy: 0.4 },
        { trackId: "3", trackName: "Nightcall", artistName: "Kavinsky", genreFamily: "electronic", energy: 0.55 },
      ],
    });
    assert.equal(result.openerPassed, false);
    assert.equal(isSafetyBlanketOutsideWorld("Phoebe Bridgers", committed.worldIds), true);
  });

  it("honest partial salvage keeps only world-verified tracks", () => {
    const committed = resolveCommittedWorld({ prompt: "dad rock" })!;
    const tracks = [
      { trackId: "1", trackName: "Holocene", artistName: "Bon Iver", genreFamily: "indie", energy: 0.3 },
      { trackId: "2", trackName: "Don't Stop Believin'", artistName: "Journey", genreFamily: "rock", energy: 0.7 },
      { trackId: "3", trackName: "Sweet Child O' Mine", artistName: "Guns N' Roses", genreFamily: "rock", energy: 0.75 },
      { trackId: "4", trackName: "Back in Black", artistName: "AC/DC", genreFamily: "rock", energy: 0.8 },
      { trackId: "5", trackName: "Livin' on a Prayer", artistName: "Bon Jovi", genreFamily: "rock", energy: 0.78 },
    ];
    const result = evaluateIntentFidelity({
      committed,
      prompt: "dad rock",
      requestedLength: 25,
      tracks,
    });
    const salvaged = selectIntentFidelityHonestPartialTracks(tracks, result, committed);
    assert.ok(!salvaged.some((t) => /bon iver/i.test(t.artistName ?? "")));
    assert.equal(salvaged.length, result.worldVerifiedCount);
    assert.ok(salvaged.length <= result.honestPartialCap);
  });

  it("intent_fidelity_failed triggers honest partial not pass", () => {
    const result = evaluateHumanQualityGate({
      trackCount: 18,
      requestedLength: 25,
      humanSavePassed: true,
      wouldSpotifyMakeThis: true,
      dominantWorldDensity: 0.8,
      intentFidelityFailed: true,
      committedWorldHardLock: true,
      activeWorldId: "classic_rock_world",
    });
    assert.equal(result.action, "honest_partial");
    assert.ok(result.reasons.includes("intent_fidelity_failed"));
    assert.ok(result.salvageableCount <= 12);
  });

  it("dad rock maps to classic_rock_world and rejects Bon Iver under hard lock", () => {
    const ids = inferWorldIdentityIdsFromPrompt("dad rock playlist for the motorway");
    assert.ok(ids.includes("classic_rock_world"));

    const profiles = worldIdentityProfilesForLock({ prompt: "dad rock" });
    assert.ok(profiles.some((p) => p.id === "classic_rock_world"));
    assert.equal(
      passesWorldIdentity(
        {
          trackName: "Holocene",
          artistName: "Bon Iver",
          genreFamily: "indie",
          spotifyArtistGenres: ["indie folk"],
          energy: 0.35,
        },
        profiles,
        { hardLock: true },
      ),
      false,
    );
    assert.equal(isSafetyBlanketOutsideWorld("Bon Iver", ["classic_rock_world"]), true);
  });

  it("empty motorway at midnight rain maps to rainy drive world", () => {
    const ids = inferWorldIdentityIdsFromPrompt("empty motorway at midnight rain");
    assert.ok(ids.includes("rainy_drive_world"));

    const profiles = worldIdentityProfilesForLock({
      prompt: "empty motorway at midnight rain",
    });
    assert.ok(profiles.some((p) => p.id === "rainy_drive_world"));
    assert.equal(
      passesWorldIdentity(
        {
          trackName: "SICKO MODE",
          artistName: "Travis Scott",
          genreFamily: "hip_hop",
          spotifyArtistGenres: ["hip hop", "rap"],
          energy: 0.62,
        },
        profiles,
        { hardLock: true },
      ),
      false,
    );
  });

  it("rock anthem drive does not collapse to sunset indie editorial world", () => {
    const vibe = "dad rock anthems for a sunset drive";
    const lockedIntent = buildLockedIntent(vibe);
    const profile = analyzeVibe(vibe);
    const world = selectEditorialWorld({
      vibe,
      lockedIntent,
      profile,
      primaryMood: "nostalgic",
      sceneType: "drive",
      sceneArchetypeId: "rock_anthem_drive",
    });
    assert.notEqual(world.tag, "sunset_indie_drive");
    assert.equal(world.tag, "rock_anthem_drive");
  });

  it("human_save_failed never passes silently", () => {
    const partial = evaluateHumanQualityGate({
      trackCount: 20,
      requestedLength: 30,
      humanSavePassed: false,
      wouldSpotifyMakeThis: true,
      dominantWorldDensity: 0.75,
    });
    assert.equal(partial.action, "honest_partial");
    assert.ok(partial.reasons.includes("human_save_failed"));

    const refuse = evaluateHumanQualityGate({
      trackCount: 2,
      requestedLength: 30,
      humanSavePassed: false,
    });
    assert.equal(refuse.action, "refuse");
  });

  it("degraded delivery triggers honest partial not pass", () => {
    const result = evaluateHumanQualityGate({
      trackCount: 28,
      requestedLength: 30,
      wouldSpotifyMakeThis: true,
      dominantWorldDensity: 0.8,
      humanSavePassed: true,
      degradedDelivery: true,
    });
    assert.equal(result.action, "honest_partial");
    assert.ok(result.salvageableCount <= 12);
  });
});
