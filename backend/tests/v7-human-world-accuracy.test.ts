import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import {
  artistForbiddenInWorld,
  artistSupportsWorld,
} from "../core/editorial/artist-identity-map";
import { evaluateIntentFidelity } from "../core/editorial/intent-fidelity-gate";
import {
  inferWorldIdentityIdsFromPrompt,
  passesWorldIdentity,
  worldIdentityProfilesForLock,
} from "../core/editorial/world-identity-gate";
import { evaluateWorldProof } from "../core/editorial/world-proof-gate";
import {
  parsePromptNegationEnforcement,
  trackViolatesPromptNegation,
} from "../lib/prompt-negation-enforcement";

describe("V7 human world accuracy", () => {
  it("80s night drive commits to synth/post-punk world and rejects Bon Iver and Beach House", () => {
    const prompt = "80s night drive — synthpop and post-punk";
    const world = resolveCommittedWorld({ prompt });
    assert.ok(world);
    assert.equal(world.id, "80s_night_drive_world");
    assert.equal(world.hardLock, true);

    const profiles = worldIdentityProfilesForLock({ prompt, anchors: world.worldIds });
    assert.equal(
      passesWorldIdentity(
        { artistName: "New Order", genreFamily: "electronic", spotifyArtistGenres: ["new wave", "synthpop"] },
        profiles,
        { hardLock: true },
      ),
      true,
    );
    assert.equal(
      passesWorldIdentity(
        { artistName: "Bon Iver", genreFamily: "indie", spotifyArtistGenres: ["indie folk"] },
        profiles,
        { hardLock: true },
      ),
      false,
    );
    assert.equal(
      passesWorldIdentity(
        { artistName: "Beach House", genreFamily: "indie", spotifyArtistGenres: ["dream pop"] },
        profiles,
        { hardLock: true },
      ),
      false,
    );
    assert.equal(artistForbiddenInWorld("Bon Iver", world.worldIds), true);
  });

  it("madchester locks UK/Manchester identity and rejects American indie", () => {
    const prompt = "madchester baggy Manchester night";
    const world = resolveCommittedWorld({ prompt });
    assert.ok(world);
    assert.ok(world.worldIds.includes("madchester_world"));

    const profiles = worldIdentityProfilesForLock({ prompt, anchors: world.worldIds });
    assert.equal(
      passesWorldIdentity(
        { artistName: "Happy Mondays", genreFamily: "rock", spotifyArtistGenres: ["madchester", "britpop"] },
        profiles,
        { hardLock: true },
      ),
      true,
    );
    assert.equal(
      passesWorldIdentity(
        { artistName: "Bon Iver", genreFamily: "indie", spotifyArtistGenres: ["indie folk"] },
        profiles,
        { hardLock: true },
      ),
      false,
    );
    assert.equal(artistSupportsWorld("Oasis", world.worldIds), true);
  });

  it("road trip singalong rejects quiet acoustic filler", () => {
    const prompt = "road trip singalong anthems";
    const world = resolveCommittedWorld({ prompt });
    assert.ok(world);
    assert.equal(world.id, "road_trip_singalong_world");

    const profiles = worldIdentityProfilesForLock({ prompt, anchors: world.worldIds });
    assert.equal(
      passesWorldIdentity(
        { artistName: "Oasis", genreFamily: "rock", spotifyArtistGenres: ["britpop", "rock"] },
        profiles,
        { hardLock: true },
      ),
      true,
    );
    assert.equal(
      passesWorldIdentity(
        { artistName: "Iron & Wine", genreFamily: "folk", spotifyArtistGenres: ["folk", "acoustic"] },
        profiles,
        { hardLock: true },
      ),
      false,
    );
  });

  it("grunge accepts Nirvana and rejects Green Day pop-punk", () => {
    const prompt = "90s grunge Seattle";
    const world = resolveCommittedWorld({ prompt });
    assert.ok(world);
    assert.ok(world.worldIds.includes("grunge_world"));

    const profiles = worldIdentityProfilesForLock({ prompt, anchors: world.worldIds });
    assert.equal(
      passesWorldIdentity(
        { artistName: "Nirvana", genreFamily: "rock", spotifyArtistGenres: ["grunge", "alternative rock"] },
        profiles,
        { hardLock: true },
      ),
      true,
    );
    assert.equal(
      passesWorldIdentity(
        { artistName: "Green Day", genreFamily: "rock", spotifyArtistGenres: ["pop punk"] },
        profiles,
        { hardLock: true },
      ),
      false,
    );
    assert.equal(artistForbiddenInWorld("Green Day", ["grunge_world"]), true);
    assert.equal(artistSupportsWorld("Nirvana", ["grunge_world"]), true);
  });

  it("rainy motorway routes to cinematic driving world, not sad indie landfill", () => {
    const prompt = "rainy motorway drive";
    const ids = inferWorldIdentityIdsFromPrompt(prompt);
    assert.ok(ids.includes("rainy_motorway_world"));
    assert.ok(!ids.includes("chill_rainy_world"));

    const world = resolveCommittedWorld({ prompt });
    assert.ok(world);
    assert.equal(world.id, "rainy_motorway_world");

    const profiles = worldIdentityProfilesForLock({ prompt, anchors: world.worldIds });
    assert.equal(
      passesWorldIdentity(
        { artistName: "Depeche Mode", genreFamily: "electronic", spotifyArtistGenres: ["synthpop", "new wave"] },
        profiles,
        { hardLock: true },
      ),
      true,
    );
    assert.equal(
      passesWorldIdentity(
        { artistName: "Phoebe Bridgers", genreFamily: "indie", spotifyArtistGenres: ["indie rock"] },
        profiles,
        { hardLock: true },
      ),
      false,
    );
  });

  it("gym energy world rejects soft acoustic tracks", () => {
    const prompt = "heavy gym workout metal";
    const world = resolveCommittedWorld({ prompt });
    assert.ok(world);
    assert.ok(
      world.worldIds.includes("heavy_gym_world") ||
        world.worldIds.includes("gym_rock_world") ||
        world.worldIds.includes("angry_rock_world"),
    );

    const profiles = worldIdentityProfilesForLock({ prompt, anchors: world.worldIds });
    assert.equal(
      passesWorldIdentity(
        { artistName: "Metallica", genreFamily: "metal", spotifyArtistGenres: ["metal", "thrash metal"], energy: 0.85 },
        profiles,
        { hardLock: true },
      ),
      true,
    );
    assert.equal(
      passesWorldIdentity(
        { artistName: "Bon Iver", genreFamily: "indie", spotifyArtistGenres: ["indie folk"], energy: 0.3 },
        profiles,
        { hardLock: true },
      ),
      false,
    );
  });

  it("world proof gate fails when track 1 breaks world but tail is fine", () => {
    const committed = resolveCommittedWorld({ prompt: "80s night drive synthpop" })!;
    const tracks = [
      { trackId: "1", trackName: "Holocene", artistName: "Bon Iver", genreFamily: "indie", energy: 0.3 },
      { trackId: "2", trackName: "Blue Monday", artistName: "New Order", genreFamily: "electronic", energy: 0.72 },
      { trackId: "3", trackName: "Enjoy the Silence", artistName: "Depeche Mode", genreFamily: "electronic", energy: 0.68 },
      { trackId: "4", trackName: "Temptation", artistName: "New Order", genreFamily: "electronic", energy: 0.7 },
      { trackId: "5", trackName: "A Forest", artistName: "The Cure", genreFamily: "rock", energy: 0.62 },
    ];
    const proof = evaluateWorldProof({
      committed,
      prompt: "80s night drive synthpop",
      requestedLength: 25,
      tracks,
    });
    assert.equal(proof.trackOnePassed, false);
    assert.equal(proof.passed, false);
    assert.ok(proof.verifiedTracks.length < tracks.length);
  });

  it("world proof passes when first five tracks continue the world", () => {
    const committed = resolveCommittedWorld({ prompt: "80s night drive synthpop" })!;
    const tracks = [
      { trackId: "1", trackName: "Blue Monday", artistName: "New Order", genreFamily: "electronic", energy: 0.72 },
      { trackId: "2", trackName: "Enjoy the Silence", artistName: "Depeche Mode", genreFamily: "electronic", energy: 0.68 },
      { trackId: "3", trackName: "Temptation", artistName: "New Order", genreFamily: "electronic", energy: 0.7 },
      { trackId: "4", trackName: "A Forest", artistName: "The Cure", genreFamily: "rock", energy: 0.62 },
      { trackId: "5", trackName: "Head Over Heels", artistName: "Tears For Fears", genreFamily: "pop", energy: 0.66 },
    ];
    const proof = evaluateWorldProof({
      committed,
      prompt: "80s night drive synthpop",
      requestedLength: 25,
      tracks,
    });
    assert.equal(proof.trackOnePassed, true);
    assert.equal(proof.passed, true);
  });

  it("negation enforcement strips no-acoustic and no-sad at delivery", () => {
    const profile = parsePromptNegationEnforcement("rainy motorway no acoustic no sad");
    assert.equal(profile.suppressAcoustic, true);
    assert.equal(profile.suppressSad, true);
    assert.equal(
      trackViolatesPromptNegation(
        { artistName: "Iron & Wine", trackName: "Naked As We Came", genreFamily: "folk", acousticness: 0.88 },
        profile,
      ),
      "negation:acoustic",
    );
    assert.equal(
      trackViolatesPromptNegation(
        { artistName: "Adele", trackName: "Sad Songs", genreFamily: "pop" },
        profile,
      ),
      "negation:sad",
    );
  });

  it("intent fidelity requires high verified share under hard lock", () => {
    const committed = resolveCommittedWorld({ prompt: "grunge 90s" })!;
    const mixed = [
      { trackId: "1", trackName: "Smells Like Teen Spirit", artistName: "Nirvana", genreFamily: "rock", energy: 0.8 },
      { trackId: "2", trackName: "Alive", artistName: "Pearl Jam", genreFamily: "rock", energy: 0.75 },
      { trackId: "3", trackName: "Basket Case", artistName: "Green Day", genreFamily: "rock", energy: 0.78 },
      { trackId: "4", trackName: "Black Hole Sun", artistName: "Soundgarden", genreFamily: "rock", energy: 0.7 },
      { trackId: "5", trackName: "Man in the Box", artistName: "Alice In Chains", genreFamily: "rock", energy: 0.72 },
    ];
    const result = evaluateIntentFidelity({
      committed,
      prompt: "grunge 90s",
      requestedLength: 25,
      tracks: mixed,
    });
    assert.equal(result.passed, false);
    assert.ok(result.worldVerifiedCount < mixed.length);
    assert.ok(!result.salvageableTracks.some((t) => /green day/i.test(t.artistName ?? "")));
  });
});
