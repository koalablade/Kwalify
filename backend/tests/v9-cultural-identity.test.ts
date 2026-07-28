import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCommittedWorld, getCulturalProfile } from "../core/committed-world";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";
import { enforceThesisOpenerGate, trackMeetsThesisOpener } from "../core/editorial/thesis-opener-gate";
import { evaluateWorldProof } from "../core/editorial/world-proof-gate";
import { applyWorldSequencing } from "../core/editorial/world-sequencer";
import { artistForbiddenInWorld } from "../core/editorial/artist-identity-map";
import { passesWorldIdentity, worldIdentityProfilesForLock } from "../core/editorial/world-identity-gate";

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

describe("V9 cultural identity", () => {
  it("rainy motorway: M83/Chromatics/Depeche style, reject hip hop/party/indie drift", () => {
    const prompt = "empty motorway at midnight rain on the windscreen";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("rainy_motorway_world") ?? getCulturalProfile(world.id)!;

    assert.ok(scoreTrackWorldIdentity({ artistName: "M83", trackName: "Midnight City", energy: 0.58 }, profile) >= 0.8);
    assert.ok(scoreTrackWorldIdentity({ artistName: "Chromatics", trackName: "Tick of the Clock", energy: 0.45 }, profile) >= 0.8);
    assert.equal(scoreTrackWorldIdentity({ artistName: "Drake", trackName: "God's Plan", energy: 0.7 }, profile), 0);
    assert.equal(scoreTrackWorldIdentity({ artistName: "Jungle Giants", trackName: "Used to Be", energy: 0.62 }, profile), 0);
    assert.equal(artistForbiddenInWorld("Jungle Giants", [world.id]), true);
  });

  it("dad rock: classic rock, reject Bon Iver/Phoebe", () => {
    const prompt = "dad rock BBQ with beers";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile(world.id)!;

    assert.ok(scoreTrackWorldIdentity({ artistName: "Fleetwood Mac", trackName: "Go Your Own Way", energy: 0.72 }, profile) >= 0.8);
    assert.ok(scoreTrackWorldIdentity({ artistName: "Queen", trackName: "Don't Stop Me Now", energy: 0.78 }, profile) >= 0.8);
    assert.equal(scoreTrackWorldIdentity({ artistName: "Bon Iver", trackName: "Holocene", energy: 0.3 }, profile), 0);
    assert.equal(scoreTrackWorldIdentity({ artistName: "Phoebe Bridgers", trackName: "Motion Sickness", energy: 0.42 }, profile), 0);
    assert.equal(artistForbiddenInWorld("Bon Iver", [world.id]), true);
  });

  it("madchester: Manchester identity, reject Destructo Disk", () => {
    const prompt = "madchester pub walk";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("madchester_world")!;

    assert.ok(scoreTrackWorldIdentity({ artistName: "The Stone Roses", trackName: "Fools Gold", energy: 0.58 }, profile) >= 0.8);
    assert.ok(scoreTrackWorldIdentity({ artistName: "Happy Mondays", trackName: "Step On", energy: 0.62 }, profile) >= 0.8);
    assert.equal(scoreTrackWorldIdentity({ artistName: "Destructo Disk", trackName: "Track 1", energy: 0.7 }, profile), 0);
    assert.equal(artistForbiddenInWorld("Destructo Disk", [world.id]), true);
  });

  it("grunge: reject Green Day", () => {
    const prompt = "90s grunge";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("grunge_world")!;

    assert.ok(scoreTrackWorldIdentity({ artistName: "Nirvana", trackName: "Smells Like Teen Spirit", energy: 0.8 }, profile) >= 0.8);
    assert.equal(scoreTrackWorldIdentity({ artistName: "Green Day", trackName: "Basket Case", energy: 0.78 }, profile), 0);
    assert.equal(artistForbiddenInWorld("Green Day", [world.id]), true);
  });

  it("disco: reject Panic At The Disco", () => {
    const prompt = "disco rooftop party 1978";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile("disco_1970s_world")!;

    assert.ok(scoreTrackWorldIdentity({ artistName: "Chic", trackName: "Le Freak", energy: 0.72 }, profile) >= 0.8);
    assert.equal(scoreTrackWorldIdentity({ artistName: "Panic! At The Disco", trackName: "High Hopes", energy: 0.7 }, profile), 0);
    assert.equal(artistForbiddenInWorld("Panic! At The Disco", [world.id]), true);
  });

  it("gym: reject slow acoustic and Fall Out Boy opener", () => {
    const prompt = "heavy gym workout aggressive";
    const world = resolveCommittedWorld({ prompt })!;
    const profile = getCulturalProfile(world.id)!;

    assert.ok(scoreTrackWorldIdentity({ artistName: "Metallica", trackName: "Enter Sandman", energy: 0.88 }, profile) >= 0.8);
    assert.equal(scoreTrackWorldIdentity({ artistName: "Bon Iver", trackName: "Holocene", energy: 0.3 }, profile), 0);
    assert.equal(scoreTrackWorldIdentity({ artistName: "Fall Out Boy", trackName: "Sugar We're Goin Down", energy: 0.75 }, profile), 0);

    const tracks = [
      { artistName: "Fall Out Boy", trackName: "Sugar We're Goin Down", energy: 0.75 },
      { artistName: "Metallica", trackName: "Enter Sandman", energy: 0.88 },
      { artistName: "AC/DC", trackName: "Back in Black", energy: 0.85 },
    ];
    const thesis = enforceThesisOpenerGate(tracks, world);
    assert.equal(thesis.tracks[0]!.artistName, "Metallica");
    assert.ok(thesis.openerScore >= 0.8);
  });

  it("thesis opener gate promotes anchor when track 1 fails", () => {
    const prompt = "dad rock";
    const world = resolveCommittedWorld({ prompt })!;
    const tracks = [
      { artistName: "Bon Iver", trackName: "Holocene", energy: 0.3 },
      { artistName: "Fleetwood Mac", trackName: "Go Your Own Way", energy: 0.72 },
      { artistName: "Queen", trackName: "Don't Stop Me Now", energy: 0.78 },
    ];
    const result = enforceThesisOpenerGate(tracks, world);
    const opener = result.tracks[0]!;
    const check = trackMeetsThesisOpener(opener, world);
    assert.ok(check.passed, `opener should pass thesis gate: ${opener.artistName}`);
  });

  it("world proof gate: first 10 tracks cultural identity", () => {
    const prompt = "madchester";
    const world = resolveCommittedWorld({ prompt })!;
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
    ];
    const proof = evaluateWorldProof({
      tracks: goodTracks,
      committed: world,
      prompt,
      requestedLength: 25,
    });
    assert.ok(proof.trackOnePassed);
    assert.ok(proof.openerAvgIdentityScore >= 0.65);
  });

  it("world sequencer: gym high energy first", () => {
    const prompt = "heavy gym workout";
    const world = resolveCommittedWorld({ prompt })!;
    const tracks = [
      { artistName: "Metallica", trackName: "Enter Sandman", energy: 0.88 },
      { artistName: "AC/DC", trackName: "Back in Black", energy: 0.85 },
      { artistName: "Foo Fighters", trackName: "The Pretender", energy: 0.72 },
      { artistName: "Metallica", trackName: "Nothing Else Matters", energy: 0.45 },
    ];
    const sequenced = applyWorldSequencing(tracks, world);
    assert.equal(sequenced[0]!.artistName, "Metallica");
    assert.ok((sequenced[sequenced.length - 1]!.energy ?? 1) <= (sequenced[1]!.energy ?? 0));
  });

  it("80s night drive: synthpop anchors pass world gate", () => {
    const prompt = "80s night drive";
    const world = resolveCommittedWorld({ prompt })!;
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
        trackName: "Holocene",
        artistName: "Bon Iver",
        genreFamily: "indie",
        energy: 0.3,
      }),
      false,
    );
  });
});
