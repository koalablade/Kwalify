import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrack } from "../lib/genre-taxonomy";
import { buildLockedIntent } from "../core/v3/intent";
import { resolveCommittedWorld } from "../core/committed-world";
import { inferWorldIdentityIdsFromPrompt, passesWorldIdentity, worldIdentityProfilesForLock } from "../core/editorial/world-identity-gate";
import { buildPlaylistContract } from "../core/playlist-contract/build-playlist-contract";
import { compareContractWithWorld } from "../core/playlist-contract/compare-with-world";
import { evaluateWorldGate } from "../core/playlist-contract/world-gate";

const track = (artistName: string, genres: string[]) => ({
  trackId: `t-${artistName}`,
  trackName: "song",
  artistName,
  albumName: "",
  spotifyArtistGenres: genres,
});

test("Spotify 'britpop' / 'madchester' tags classify as rock/britpop, not dance pop", () => {
  for (const genres of [["britpop"], ["madchester", "britpop", "jangle pop"]]) {
    const c = classifyTrack(track("Band", genres));
    assert.equal(c.genreFamily, "rock", JSON.stringify(genres));
    assert.equal(c.primarySubgenre, "britpop", JSON.stringify(genres));
  }
  // Other tags keep their existing subgenres.
  assert.equal(classifyTrack(track("Slowdive", ["shoegaze", "dream pop"])).primarySubgenre, "shoegaze");
  assert.equal(classifyTrack(track("AM", ["indie", "garage rock"])).primarySubgenre, "indie_general");
});

test("'British indie' names Britpop; the bare 'indie' inside it does not outvote it", () => {
  for (const prompt of ["90s British indie", "90s British indie for a sunny Sunday afternoon", "uk indie"]) {
    assert.equal(buildLockedIntent(prompt).primarySubgenre, "britpop", prompt);
  }
  // Longer phrases keep winning over their substrings exactly as before.
  assert.equal(buildLockedIntent("indie rock").primarySubgenre, "indie_rock");
  assert.equal(buildLockedIntent("pop punk").primarySubgenre, "pop_punk");
  assert.equal(buildLockedIntent("emo rap").primarySubgenre, "melodic_rap");
  assert.equal(buildLockedIntent("indie").primarySubgenre, "indie_general");
});

test("British indie commits britpop_world alone; plain indie stays indie_dream_world", () => {
  for (const prompt of ["90s British indie", "90s British indie for a sunny Sunday afternoon"]) {
    const world = resolveCommittedWorld({ prompt });
    assert.equal(world?.id, "britpop_world", prompt);
    assert.deepEqual(world?.worldIds, ["britpop_world"], prompt);
    assert.deepEqual(inferWorldIdentityIdsFromPrompt(prompt), ["britpop_world"], prompt);
  }
  assert.equal(resolveCommittedWorld({ prompt: "indie" })?.id, "indie_dream_world");
  assert.ok(inferWorldIdentityIdsFromPrompt("british indie and indie folk").includes("indie_dream_world"));
});

test("the world gate keeps the Britpop hard lock for British indie (contract and world agree)", () => {
  const prompt = "90s British indie";
  const world = resolveCommittedWorld({ prompt });
  const contract = buildPlaylistContract({ prompt, committedWorld: world });
  const decision = evaluateWorldGate({ contract, world, disagreements: compareContractWithWorld(contract, world) });
  assert.equal(decision.deferHardLock, false);
  assert.equal(decision.effectiveWorld?.id, "britpop_world");
});

test("a second Spotify tag naming another subgenre is kept as secondary evidence (Blur: alt rock + britpop)", () => {
  const blur = classifyTrack(track("Blur", ["britpop", "alternative rock"]));
  assert.equal(blur.primarySubgenre, "alt_rock");
  assert.equal(blur.secondarySubgenre, "britpop");
  // A single tag still has no invented secondary.
  assert.equal(classifyTrack(track("Oasis", ["britpop"])).secondarySubgenre, null);
});

test("the Britpop world admits its low-valence canon but keeps its energy floor", () => {
  const profiles = worldIdentityProfilesForLock({ anchors: ["britpop_world"] } as never);
  const row = (trackName: string, energy: number, valence: number) => ({
    trackId: trackName, trackName, artistName: "Oasis", albumName: "", spotifyArtistGenres: ["britpop"],
    genreFamily: "rock", genrePrimary: "rock", genres: ["britpop"], energy, valence,
  });
  assert.equal(passesWorldIdentity(row("Champagne Supernova", 0.85, 0.12), profiles, { hardLock: true }), true);
  assert.equal(passesWorldIdentity(row("quiet acoustic demo", 0.31, 0.10), profiles, { hardLock: true }), false);
});
