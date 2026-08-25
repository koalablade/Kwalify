import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPerPlaylistArtistCap,
  enforcePerPlaylistArtistCap,
  hasExplicitArtistPlaylistRequest,
} from "../lib/playlist-artist-cap";

test("defaultPerPlaylistArtistCap allows 2-3 tracks per artist", () => {
  assert.equal(defaultPerPlaylistArtistCap(15, "chill vibes"), 2);
  assert.equal(defaultPerPlaylistArtistCap(30, "party indie rock"), 4);
  assert.equal(defaultPerPlaylistArtistCap(30, "songs by paramore"), Number.MAX_SAFE_INTEGER);
  assert.ok(hasExplicitArtistPlaylistRequest("songs by paramore"));
});

test("defaultPerPlaylistArtistCap lofts named genre/era prompts at 20+", () => {
  assert.equal(defaultPerPlaylistArtistCap(25, "indie rock"), 4);
  assert.equal(defaultPerPlaylistArtistCap(25, "2000s indie"), 4);
  assert.equal(defaultPerPlaylistArtistCap(25, "90s alternative rock"), 4);
  assert.equal(defaultPerPlaylistArtistCap(25, "nostalgic"), 4);
  assert.equal(defaultPerPlaylistArtistCap(20, "gym pop punk"), 3);
  assert.equal(defaultPerPlaylistArtistCap(15, "indie rock"), 2);
  assert.equal(defaultPerPlaylistArtistCap(25, "melancholic"), 2);
});

test("defaultPerPlaylistArtistCap lofts niche dancefloor prompts modestly", () => {
  assert.equal(defaultPerPlaylistArtistCap(30, "70s disco party dancefloor"), 5);
  assert.equal(defaultPerPlaylistArtistCap(30, "latin summer beach party"), 5);
  assert.ok(defaultPerPlaylistArtistCap(30, "70s disco party") > 3);
});

test("enforcePerPlaylistArtistCap trims repeats but keeps central prompt artists", () => {
  const tracks = [
    { artistName: "Paramore" },
    { artistName: "Paramore" },
    { artistName: "Paramore" },
    { artistName: "Paramore" },
    { artistName: "Paramore" },
    { artistName: "Other Band" },
    { artistName: "Other Band" },
    { artistName: "Other Band" },
    { artistName: "Other Band" },
  ];
  const capped = enforcePerPlaylistArtistCap(tracks, {
    vibe: "2000s pop punk gym",
    playlistSize: 20,
  });
  assert.equal(capped.cap, 3);
  assert.equal(capped.dropped, 3);
  assert.equal(capped.tracks.length, 6);
  assert.equal(capped.tracks.filter((t) => t.artistName === "Paramore").length, 3);
});

test("enforcePerPlaylistArtistCap caps central artists near 22% not 45%", () => {
  const tracks = Array.from({ length: 12 }, () => ({ artistName: "Paramore" }));
  const capped = enforcePerPlaylistArtistCap(tracks, {
    vibe: "paramore vibes night",
    playlistSize: 30,
    promptCentralArtists: new Set(["paramore"]),
  });
  assert.equal(capped.centralArtistCap, 7);
  assert.equal(capped.tracks.length, 7);
  assert.equal(capped.dropped, 5);
});

test("enforcePerPlaylistArtistCap bypasses cap for explicit artist playlist requests", () => {
  const tracks = Array.from({ length: 8 }, () => ({ artistName: "Paramore" }));
  const capped = enforcePerPlaylistArtistCap(tracks, {
    vibe: "songs by paramore",
    playlistSize: 30,
  });
  assert.equal(capped.dropped, 0);
  assert.equal(capped.tracks.length, 8);
});
