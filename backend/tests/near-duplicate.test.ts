import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTitle,
  normalizeArtist,
  nearDuplicateKey,
  collapseNearDuplicates,
} from "../lib/near-duplicate";
import { formatTracksForApi } from "../lib/generate-helpers";

test("normalizeTitle strips version/edition qualifiers to a shared base", () => {
  const base = normalizeTitle("Welcome to the Jungle");
  assert.equal(normalizeTitle("Welcome to the Jungle - Remastered"), base);
  assert.equal(normalizeTitle("Welcome to the Jungle (2012 Remaster)"), base);
  assert.equal(normalizeTitle("Welcome to the Jungle - Live"), base);
  assert.equal(normalizeTitle("Welcome to the Jungle (Acoustic Version)"), base);
  assert.equal(normalizeTitle("Welcome to the Jungle - Radio Edit"), base);
  assert.equal(normalizeTitle("Welcome to the Jungle (feat. Someone)"), base);
});

test("normalizeTitle keeps genuinely different works distinct", () => {
  // A remix is a materially different arrangement — must NOT collapse.
  assert.notEqual(
    normalizeTitle("Song - Club Remix"),
    normalizeTitle("Song"),
  );
  // Different songs stay different.
  assert.notEqual(normalizeTitle("Paranoid"), normalizeTitle("Paranoid Android"));
});

test("normalizeArtist reduces to the primary credited artist", () => {
  const primary = normalizeArtist("Calvin Harris");
  assert.equal(normalizeArtist("Calvin Harris feat. Rihanna"), primary);
  assert.equal(normalizeArtist("Calvin Harris & Dua Lipa"), primary);
  assert.equal(normalizeArtist("Calvin Harris, Sam Smith"), primary);
});

test("nearDuplicateKey groups same recording across ids, splits different artists", () => {
  const a = nearDuplicateKey({ name: "Hurt", artist: "Johnny Cash" });
  const b = nearDuplicateKey({ name: "Hurt - Remastered", artist: "Johnny Cash" });
  const c = nearDuplicateKey({ name: "Hurt", artist: "Nine Inch Nails" });
  assert.equal(a, b, "same song+artist across ids share a key");
  assert.notEqual(a, c, "same title, different artist -> different key (cover)");
});

test("nearDuplicateKey returns null when it cannot compare confidently", () => {
  assert.equal(nearDuplicateKey({ name: "", artist: "X" }), null);
  assert.equal(nearDuplicateKey({ name: "X", artist: "" }), null);
});

test("collapseNearDuplicates keeps first occurrence and preserves order", () => {
  const input = [
    { name: "A", artist: "One" },
    { name: "B", artist: "Two" },
    { name: "A - 2011 Remaster", artist: "One" }, // near-dup of index 0
    { name: "C", artist: "Three" },
  ];
  const { kept, removed } = collapseNearDuplicates(input);
  assert.deepEqual(kept.map((t) => t.name), ["A", "B", "C"]);
  assert.equal(removed.length, 1);
});

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

test("formatTracksForApi collapses near-duplicate recordings across ids", () => {
  const input = [
    track("id1", "Welcome to the Jungle", "Guns N' Roses"),
    track("id2", "Welcome to the Jungle - 2012 Remaster", "Guns N' Roses"),
    track("id3", "Welcome to the Jungle (Live)", "Guns N' Roses"),
    track("id4", "Sweet Child O' Mine", "Guns N' Roses"),
  ];
  const out = formatTracksForApi(input);
  assert.deepEqual(out.map((t) => t.id), ["id1", "id4"]);
});

test("formatTracksForApi keeps covers by different artists", () => {
  const input = [
    track("id1", "Hurt", "Nine Inch Nails"),
    track("id2", "Hurt", "Johnny Cash"),
  ];
  const out = formatTracksForApi(input);
  assert.deepEqual(out.map((t) => t.id), ["id1", "id2"]);
});
