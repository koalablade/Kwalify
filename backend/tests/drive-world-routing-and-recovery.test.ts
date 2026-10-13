import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommittedWorld } from "../core/committed-world";
import { resolveWorldBoundary, hardRejectOffWorldTracks } from "../core/world-boundary";
import {
  identityProfileForWorld,
  inferWorldIdentityIdsFromPrompt,
  passesWorldIdentity,
} from "../core/editorial/world-identity-gate";
import { identityTextMatcher, normalizeUniversalIdentityTerm } from "../lib/identity-term-match";
import { classifyTrack } from "../lib/genre-taxonomy";

// "\b(?:driv|…)\b" never matched "drive" or "driving" (no word end after "driv"), so every rainy
// drive prompt fell through to sunday_chill / night_drive.
test("rainy drive prompts reach the rainy-drive world", () => {
  for (const p of ["rainy drive", "rainy driving", "rainy drive home", "driving in the rain", "rainy drive at sunrise"]) {
    assert.ok(inferWorldIdentityIdsFromPrompt(p).includes("rainy_drive_world"), p);
    assert.equal(resolveCommittedWorld({ prompt: p })?.id, "rainy_drive_world", p);
  }
});

test("drive routing keeps other worlds and stated times", () => {
  assert.equal(resolveCommittedWorld({ prompt: "rainy motorway" })?.id, "rainy_motorway_world");
  assert.equal(resolveCommittedWorld({ prompt: "lonely motorway at 2am" })?.id, "late_night_calm_world");
  for (const p of ["empty highway at sunset", "rainy drive at sunrise"]) {
    assert.notEqual(resolveCommittedWorld({ prompt: p })?.id, "night_drive_world", p);
    assert.equal(inferWorldIdentityIdsFromPrompt(p).includes("night_drive_world"), false, p);
  }
  for (const p of ["rainy day", "driveway hangout", "night out", "train ride home"]) {
    assert.notEqual(resolveCommittedWorld({ prompt: p })?.id, "rainy_drive_world", p);
  }
});

test("driving worlds reject dancefloor club styles; party worlds keep them", () => {
  const track = (genres: string[]) => ({ trackName: "Song", artistName: "Artist", spotifyArtistGenres: genres });
  for (const world of ["night_drive_world", "rainy_drive_world", "evening_drive_world"]) {
    const profile = identityProfileForWorld(world)!;
    assert.equal(passesWorldIdentity(track(["bass house"]), [profile], { hardLock: true }), false, world);
    assert.equal(passesWorldIdentity(track(["g-house", "slap house"]), [profile], { hardLock: true }), false, world);
    // Night-drive worlds are usually soft-locked, where only rejections apply ("leydown" came in via criticRepair).
    assert.equal(passesWorldIdentity(track(["jersey club"]), [profile], { hardLock: false }), false, world);
    assert.equal(passesWorldIdentity(track(["deep house"]), [profile], { hardLock: false }), true, world);
    assert.equal(passesWorldIdentity(track(["dream pop"]), [profile], { hardLock: true }), true, world);
  }
  const party = identityProfileForWorld("party_prep_world")!;
  assert.equal(passesWorldIdentity(track(["bass house"]), [party], { hardLock: true }), true);
  assert.equal(passesWorldIdentity(track(["jersey club"]), [party], { hardLock: false }), true); // not rejected there
});

// The contract-recovery filter drops tagged fillers this check rejects (country / doo-wop / trance
// in "rainy drive") and leaves in-world tags alone.
test("the rainy-drive boundary rejects tagged off-world recovery fillers", () => {
  const boundary = { ...resolveWorldBoundary({ prompt: "rainy drive", sceneAliases: [], scenePrediction: {}, sceneLock: null } as never), hardLock: false };
  assert.equal(boundary.active, true);
  const song = (id: string, genres: string[]) => {
    const c = classifyTrack({ trackName: id, artistName: id, albumName: "", spotifyArtistGenres: genres } as never);
    return { trackId: id, trackName: id, artistName: id, spotifyArtistGenres: genres, genreFamily: c.genreFamily, genrePrimary: c.genrePrimary, genres: c.subGenres };
  };
  const { rejected } = hardRejectOffWorldTracks(
    [song("country", ["country", "red dirt"]), song("doowop", ["doo-wop"]), song("trance", ["trance"]), song("indie", ["indie rock"]), song("dream", ["dream pop"])],
    boundary,
    new Map(),
  );
  assert.deepEqual(rejected.map((t) => t.trackId).sort(), ["country", "doowop", "trance"]);
});

test("prompt words match whole words in a song's text, never inside another word", () => {
  const has = (text: string, term: string) => identityTextMatcher(normalizeUniversalIdentityTerm(text))(normalizeUniversalIdentityTerm(term));
  assert.equal(has("Insane in the Brain hip hop", "rain"), false);
  assert.equal(has("Homecoming Graduation", "home"), false);
  assert.equal(has("Purple Rain", "rain"), true);
  assert.equal(has("Driving Home for Christmas", "home"), true);
  assert.equal(has("late night drive home", "night drive"), true);
  assert.equal(has("Night Driver", "night drive"), false);
});
