import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPerPlaylistArtistCap,
  enforcePerPlaylistArtistCap,
  hasExplicitArtistPlaylistRequest,
} from "../lib/playlist-artist-cap";

test("defaultPerPlaylistArtistCap allows 3-4 tracks per artist", () => {
  assert.equal(defaultPerPlaylistArtistCap(20, "gym pop punk"), 3);
  assert.equal(defaultPerPlaylistArtistCap(30, "party disco"), 4);
  assert.equal(defaultPerPlaylistArtistCap(30, "songs by paramore"), Number.MAX_SAFE_INTEGER);
  assert.ok(hasExplicitArtistPlaylistRequest("songs by paramore"));
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
  assert.equal(capped.dropped, 3);
  assert.equal(capped.tracks.length, 6);
  assert.equal(capped.tracks.filter((t) => t.artistName === "Paramore").length, 3);
});

test("enforcePerPlaylistArtistCap bypasses cap for central artist prompts", () => {
  const tracks = Array.from({ length: 8 }, () => ({ artistName: "Paramore" }));
  const capped = enforcePerPlaylistArtistCap(tracks, {
    vibe: "paramore greatest hits",
    playlistSize: 30,
    promptCentralArtists: new Set(["paramore"]),
  });
  assert.equal(capped.dropped, 0);
  assert.equal(capped.tracks.length, 8);
});
