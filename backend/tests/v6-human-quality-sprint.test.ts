import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
