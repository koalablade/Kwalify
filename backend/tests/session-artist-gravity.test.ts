import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOpeningWindowDedup,
  buildOpeningWindowHistory,
} from "../lib/opening-window-dedup";
import {
  applySessionArtistGravity,
  buildSessionArtistHistory,
  detectPromptCentralArtists,
  normalizeSessionArtist,
} from "../lib/session-artist-gravity";
import {
  clearSessionArtistGravitySession,
  getSessionArtistHistory,
  recordSessionArtistPlaylist,
} from "../lib/session-artist-gravity-session";

type T = { trackId: string; artistName: string; score?: number };

function track(id: string, artist: string, score: number): T {
  return { trackId: id, artistName: artist, score };
}

test("buildSessionArtistHistory — position-weighted artist counts", () => {
  const history = buildSessionArtistHistory([
    ["Fleetwood Mac", "Fleetwood Mac", "Other Artist"],
    ["Fred again..", "Someone Else"],
  ]);
  assert.equal(history.sessionArtistHistorySize, 2);
  assert.ok((history.artistPlaylistCount.get(normalizeSessionArtist("Fleetwood Mac")) ?? 0) === 1);
  assert.ok((history.artistWeightedCount.get(normalizeSessionArtist("Fleetwood Mac")) ?? 0) > 1);
  assert.equal(history.artistPlaylistCount.get(normalizeSessionArtist("Fred again..")), 1);
});

test("applySessionArtistGravity — fatigued artist swaps on later playlist", () => {
  const tracks: T[] = [
    track("t1", "Laurindo Almeida", 0.82),
    ...Array.from({ length: 10 }, (_, i) => track(`mid-${i}`, `Artist ${i}`, 0.7)),
    track("fresh", "Fresh Artist", 0.8),
    track("fresh2", "Another Fresh", 0.79),
  ];
  const history = buildSessionArtistHistory([
    ["Laurindo Almeida", "Laurindo Almeida", "Other"],
    ["Laurindo Almeida", "Someone"],
  ]);
  const result = applySessionArtistGravity(tracks, history, {
    auditDeterministic: true,
    scoreFn: (row) => row.score ?? 0,
  });
  assert.notEqual(normalizeSessionArtist(result.tracks[0]!.artistName), normalizeSessionArtist("Laurindo Almeida"));
  assert.ok(result.tracks.some((row) => normalizeSessionArtist(row.artistName) === normalizeSessionArtist("Laurindo Almeida")));
  assert.ok(result.diagnostics.replacementsMade >= 1);
  assert.ok(result.diagnostics.artistsPenalized.length > 0);
});

test("applySessionArtistGravity — thin library preserves playlist length", () => {
  const tracks: T[] = [
    track("repeat", "GnR", 0.9),
    track("only", "Other", 0.5),
  ];
  const history = buildSessionArtistHistory([["GnR", "GnR"]]);
  const result = applySessionArtistGravity(tracks, history, {
    thinLibraryRelaxed: true,
    scoreFn: (row) => row.score ?? 0,
  });
  assert.equal(result.tracks.length, 2);
  assert.equal(result.diagnostics.relaxedDueToSupply, true);
  assert.equal(result.diagnostics.replacementsMade, 0);
});

test("applySessionArtistGravity — artist-specific prompt avoids over-penalization", () => {
  const tracks: T[] = [
    track("q1", "Queen", 0.92),
    ...Array.from({ length: 10 }, (_, i) => track(`alt-${i}`, `Alt ${i}`, 0.7)),
  ];
  const history = buildSessionArtistHistory([
    tracks.map((row) => row.artistName),
    tracks.map((row) => row.artistName),
  ]);
  const central = detectPromptCentralArtists("Queen greatest hits workout");
  assert.ok(central.has(normalizeSessionArtist("queen")));
  const result = applySessionArtistGravity(tracks, history, {
    promptCentralArtists: central,
    scoreFn: (row) => row.score ?? 0,
  });
  assert.equal(normalizeSessionArtist(result.tracks[0]!.artistName), normalizeSessionArtist("Queen"));
  assert.equal(result.diagnostics.replacementsMade, 0);
});

test("opening-window dedup and session artist gravity coexist", () => {
  const tracks: T[] = [
    track("gnr-opener", "GnR", 0.92),
    track("gnr-mid", "GnR", 0.8),
    ...Array.from({ length: 8 }, (_, i) => track(`mid-${i}`, `Artist ${i}`, 0.7 - i * 0.01)),
    track("fresh1", "Fresh Artist", 0.75),
    track("fresh2", "Another Fresh", 0.74),
  ];
  const openingHistory = buildOpeningWindowHistory([tracks.slice(0, 10).map((row) => row.trackId)]);
  openingHistory.trackAppearanceCount.set("gnr-opener", 2);
  const openerDedup = applyOpeningWindowDedup(tracks, openingHistory, {
    auditDeterministic: true,
    scoreFn: (row) => row.score ?? 0,
  });
  const artistHistory = buildSessionArtistHistory([
    tracks.map((row) => row.artistName),
    tracks.map((row) => row.artistName),
  ]);
  const gravity = applySessionArtistGravity(openerDedup.tracks, artistHistory, {
    auditDeterministic: true,
    scoreFn: (row) => row.score ?? 0,
  });
  assert.equal(gravity.tracks.length, tracks.length);
  assert.ok(gravity.tracks.some((row) => row.trackId === "gnr-opener" || row.trackId === "gnr-mid"));
});

test("applySessionArtistGravity — genre constraint blocks invalid replacements", () => {
  const tracks: T[] = [
    track("fatigued", "Fleetwood Mac", 0.82),
    track("invalid-genre", "Fresh Artist", 0.8),
    track("valid", "Another Fresh", 0.79),
    ...Array.from({ length: 10 }, (_, i) => track(`pad-${i}`, `Pad ${i}`, 0.6)),
  ];
  const history = buildSessionArtistHistory([
    ["Fleetwood Mac", "Fleetwood Mac"],
    ["Fleetwood Mac"],
  ]);
  const blockedReplacementIds: string[] = [];
  const result = applySessionArtistGravity(tracks, history, {
    scoreFn: (row) => row.score ?? 0,
    canReplaceWith: (_current, candidate) => {
      if (candidate.trackId === "invalid-genre") {
        blockedReplacementIds.push(candidate.trackId);
        return false;
      }
      return true;
    },
  });
  assert.notEqual(result.tracks[0]!.trackId, "fatigued");
  assert.equal(result.tracks[0]!.trackId, "valid");
  assert.ok(blockedReplacementIds.length >= 0);
  assert.equal(result.tracks.length, tracks.length);
});

test("session artist gravity session — ephemeral record and retrieve", () => {
  clearSessionArtistGravitySession("user-sagb");
  recordSessionArtistPlaylist("user-sagb", ["Taylor Swift", "Taylor Swift", "Other"]);
  const history = getSessionArtistHistory("user-sagb");
  assert.equal(history.length, 1);
  assert.equal(history[0]!.length, 3);
  clearSessionArtistGravitySession("user-sagb");
});
