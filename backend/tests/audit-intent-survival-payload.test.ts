import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apiTracksToSurvivalTracks,
  attachIntentSurvivalToSuccessPayload,
  intentSurvivalPayloadComplete,
} from "../lib/audit-intent-survival-payload";

describe("audit intent survival payload", () => {
  it("detects complete intent survival payloads", () => {
    assert.equal(intentSurvivalPayloadComplete({}), false);
    assert.equal(intentSurvivalPayloadComplete({
      intentSurvival: {
        scores: { overallIntentSurvival: 80, emotionSurvival: 70, subgenreSurvival: 65 },
        emotionSurvival: { survivalPercent: 72 },
      },
    }), true);
  });

  it("attaches intent survival diagnostics to success payloads without them", () => {
    const payload = attachIntentSurvivalToSuccessPayload({
      payload: {
        success: true,
        tracks: [{
          id: "t1",
          name: "Track",
          artist: "Artist",
          genrePrimary: "electronic",
          genreFamily: "electronic",
          energy: 0.8,
          valence: 0.5,
          releaseYear: 2018,
        }],
        generationDiagnostics: { recoveryTriggered: true },
      },
      ctx: {
        lockedIntent: {
          genreFamilies: ["electronic"],
          primaryGenre: "electronic",
          primarySubgenre: "techno",
          mood: ["dark"],
          activity: "party",
        },
        emotionProfile: { energy: 0.8, valence: 0.5 },
      },
      prompt: "industrial techno warehouse rave",
      apiTracks: [{
        id: "t1",
        name: "Track",
        artist: "Artist",
        genrePrimary: "electronic",
        genreFamily: "electronic",
        energy: 0.8,
        valence: 0.5,
        releaseYear: 2018,
      }],
    });

    assert.equal(intentSurvivalPayloadComplete(payload), true);
    assert.equal(typeof (payload.intentSurvival as { scores: { overallIntentSurvival: number } }).scores.overallIntentSurvival, "number");
    const v3 = payload.v3Diagnostics as { intentSurvival?: unknown };
    assert.ok(v3?.intentSurvival);
  });

  it("maps API tracks into survival tracks", () => {
    const mapped = apiTracksToSurvivalTracks([{
      id: "abc",
      name: "Song",
      artist: "Band",
      genrePrimary: "indie",
      energy: 0.4,
      valence: 0.3,
    }]);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0]?.trackId, "abc");
    assert.equal(mapped[0]?.genreFamily, "indie");
  });
});
