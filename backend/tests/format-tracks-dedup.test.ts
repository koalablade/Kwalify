import test from "node:test";
import assert from "node:assert/strict";

import { formatTracksForApi } from "../lib/generate-helpers";

/**
 * Regression guard for the trust-breaking duplicate-track defect: the
 * emergency-completion path used to pad short playlists by cloning tracks
 * (same trackId, even bypassing the artist cap). The response formatter is the
 * single choke point that must guarantee a user never receives the same track
 * twice, no matter what an upstream fill/recovery path does.
 */

function track(id: string, name: string, artist: string) {
  return {
    trackId: id,
    trackName: name,
    artistName: artist,
    albumName: "Album",
    energy: 0.5,
    valence: 0.5,
  };
}

test("formatTracksForApi removes duplicate track IDs (order preserved)", () => {
  const input = [
    track("a", "Song A", "Artist 1"),
    track("b", "Song B", "Artist 2"),
    track("a", "Song A", "Artist 1"), // clone that used to reach the user
    track("c", "Song C", "Artist 3"),
    track("b", "Song B", "Artist 2"), // clone
  ];

  const out = formatTracksForApi(input);

  assert.deepEqual(out.map((t) => t.id), ["a", "b", "c"]);
  assert.equal(new Set(out.map((t) => t.id)).size, out.length, "no duplicate ids");
});

test("formatTracksForApi keeps a fully-unique playlist unchanged", () => {
  const input = [track("a", "A", "1"), track("b", "B", "2"), track("c", "C", "3")];
  const out = formatTracksForApi(input);
  assert.deepEqual(out.map((t) => t.id), ["a", "b", "c"]);
});

test("formatTracksForApi collapses a single-track clone-storm to one entry", () => {
  // The worst observed case: uniqueSource.length === 1 → same song cloned to length.
  const input = Array.from({ length: 4 }, () => track("dup", "Only Song", "Artist"));
  const out = formatTracksForApi(input);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, "dup");
});
