import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOpeningWindowDedup,
  buildOpeningWindowHistory,
} from "../lib/opening-window-dedup";
import {
  applySessionArtistGravity,
  buildSessionArtistHistory,
  normalizeSessionArtist,
} from "../lib/session-artist-gravity";
import {
  applyPlaylistIdentityDistance,
  buildCrossSessionTrackHistory,
  buildPlaylistFingerprint,
  calculateTrackIdentityDistance,
  detectPromptExplicitAlbum,
  IDP_HIGH_DISTANCE_THRESHOLD,
} from "../lib/playlist-identity-distance";
import { detectPromptCentralArtists } from "../lib/session-artist-gravity";

type T = {
  trackId: string;
  artistName: string;
  score?: number;
  genreFamily?: string | null;
  releaseYear?: number | null;
  energy?: number | null;
  clusterId?: string | null;
};

function track(
  id: string,
  artist: string,
  score: number,
  extras?: Partial<T>,
): T {
  return { trackId: id, artistName: artist, score, ...extras };
}

const focusIntent = {
  genreFamilies: ["electronic", "ambient"],
  primarySubgenre: "ambient",
  eraRange: null,
  mood: ["calm", "focus"],
  activity: "focus",
  energy: "low" as const,
};

test("buildPlaylistFingerprint — uses locked intent and track distribution", () => {
  const tracks = [
    track("t1", "A", 0.8, { genreFamily: "ambient", energy: 0.3 }),
    track("t2", "B", 0.7, { genreFamily: "ambient", energy: 0.32 }),
    track("t3", "C", 0.6, { genreFamily: "electronic", energy: 0.35 }),
  ];
  const fingerprint = buildPlaylistFingerprint(tracks, focusIntent, { type: "focus_minimalist" }, {
    selectedClusterId: "cluster-focus",
  });
  assert.deepEqual(fingerprint.lockedIntentFamilies, ["electronic", "ambient"]);
  assert.equal(fingerprint.primarySubgenre, "ambient");
  assert.equal(fingerprint.curatorIdentityType, "focus_minimalist");
  assert.equal(fingerprint.dominantClusterId, "cluster-focus");
  assert.ok((fingerprint.genreFamilyDistribution["ambient"] ?? 0) > 0.5);
});

test("calculateTrackIdentityDistance — high for cluster and genre mismatch", () => {
  const tracks = [
    track("t1", "A", 0.8, { genreFamily: "ambient", energy: 0.3, clusterId: "cluster-focus" }),
    track("t2", "B", 0.7, { genreFamily: "ambient", energy: 0.32, clusterId: "cluster-focus" }),
  ];
  const fingerprint = buildPlaylistFingerprint(tracks, focusIntent, { type: "focus_minimalist" }, {
    selectedClusterId: "cluster-focus",
  });
  const close = calculateTrackIdentityDistance(
    track("close", "X", 0.7, { genreFamily: "ambient", energy: 0.31, clusterId: "cluster-focus" }),
    fingerprint,
    { energyBias: -0.52 },
  );
  const far = calculateTrackIdentityDistance(
    track("far", "Y", 0.7, { genreFamily: "rock", energy: 0.9, clusterId: "cluster-party" }),
    fingerprint,
    { energyBias: -0.52 },
  );
  assert.ok(far > close);
  assert.ok(far >= IDP_HIGH_DISTANCE_THRESHOLD);
});

test("applyPlaylistIdentityDistance — swaps high-distance cross-session winner", () => {
  const tracks: T[] = [
    track("repeat", "Laurindo Almeida", 0.82, { genreFamily: "rock", energy: 0.9, clusterId: "wrong" }),
    ...Array.from({ length: 10 }, (_, i) =>
      track(`mid-${i}`, `Artist ${i}`, 0.7, { genreFamily: "ambient", energy: 0.3, clusterId: "cluster-focus" }),
    ),
    track("fresh", "Fresh Artist", 0.8, { genreFamily: "ambient", energy: 0.31, clusterId: "cluster-focus" }),
    track("fresh2", "Another Fresh", 0.79, { genreFamily: "ambient", energy: 0.32, clusterId: "cluster-focus" }),
  ];
  const history = buildCrossSessionTrackHistory([
    ["repeat", "other"],
    ["repeat", "another"],
  ]);
  const result = applyPlaylistIdentityDistance(
    tracks,
    tracks,
    history,
    focusIntent,
    { type: "focus_minimalist", energyBias: -0.52 },
    { selectedClusterId: "cluster-focus" },
    {
      auditDeterministic: true,
      scoreFn: (row) => row.score ?? 0,
      canReplaceWith: () => true,
    },
  );
  assert.notEqual(result.tracks[0]!.trackId, "repeat");
  assert.ok(result.diagnostics.replacementCount >= 1);
  assert.ok(result.diagnostics.penalisedTracks.some((row) => row.replaced));
});

test("applyPlaylistIdentityDistance — thin library makes no swaps", () => {
  const tracks: T[] = [
    track("repeat", "GnR", 0.9, { genreFamily: "rock", energy: 0.9 }),
    track("only", "Other", 0.5, { genreFamily: "ambient", energy: 0.3 }),
  ];
  const history = buildCrossSessionTrackHistory([["repeat", "repeat"]]);
  const result = applyPlaylistIdentityDistance(
    tracks,
    tracks,
    history,
    focusIntent,
    { type: "focus_minimalist", energyBias: -0.52 },
    undefined,
    { thinLibraryRelaxed: true, scoreFn: (row) => row.score ?? 0 },
  );
  assert.equal(result.tracks.length, 2);
  assert.equal(result.diagnostics.replacementCount, 0);
  assert.ok(result.diagnostics.bypassReasons.includes("thin_library_relaxed"));
});

test("applyPlaylistIdentityDistance — artist-specific prompt bypass", () => {
  const tracks: T[] = [
    track("q1", "Queen", 0.92, { genreFamily: "rock", energy: 0.8 }),
    ...Array.from({ length: 10 }, (_, i) =>
      track(`alt-${i}`, `Alt ${i}`, 0.7, { genreFamily: "rock", energy: 0.75 }),
    ),
  ];
  const history = buildCrossSessionTrackHistory([tracks.map((row) => row.trackId)]);
  const central = detectPromptCentralArtists("Queen greatest hits workout");
  const result = applyPlaylistIdentityDistance(
    tracks,
    tracks,
    history,
    { genreFamilies: ["rock"], primarySubgenre: null, eraRange: null, mood: [], activity: null, energy: "high" },
    { type: "party_social", energyBias: 0.76 },
    undefined,
    {
      promptCentralArtists: central,
      scoreFn: (row) => row.score ?? 0,
    },
  );
  assert.equal(normalizeSessionArtist(result.tracks[0]!.artistName), normalizeSessionArtist("Queen"));
  assert.equal(result.diagnostics.replacementCount, 0);
});

test("applyPlaylistIdentityDistance — genre constraint blocks invalid replacements", () => {
  const tracks: T[] = [
    track("fatigued", "Fleetwood Mac", 0.82, { genreFamily: "rock", energy: 0.9, clusterId: "wrong" }),
    track("invalid-genre", "Fresh Artist", 0.8, { genreFamily: "rock", energy: 0.85 }),
    track("valid", "Another Fresh", 0.79, { genreFamily: "ambient", energy: 0.31, clusterId: "cluster-focus" }),
    ...Array.from({ length: 10 }, (_, i) =>
      track(`pad-${i}`, `Pad ${i}`, 0.6, { genreFamily: "ambient", energy: 0.3, clusterId: "cluster-focus" }),
    ),
  ];
  const history = buildCrossSessionTrackHistory([
    ["fatigued"],
    ["fatigued"],
  ]);
  const result = applyPlaylistIdentityDistance(
    tracks,
    tracks,
    history,
    focusIntent,
    { type: "focus_minimalist", energyBias: -0.52 },
    { selectedClusterId: "cluster-focus" },
    {
      scoreFn: (row) => row.score ?? 0,
      canReplaceWith: (_current, candidate) => candidate.trackId !== "invalid-genre",
    },
  );
  assert.notEqual(result.tracks[0]!.trackId, "fatigued");
  assert.equal(result.tracks[0]!.trackId, "valid");
});

test("applyPlaylistIdentityDistance — max two swaps per playlist", () => {
  const tracks: T[] = [
    track("repeat-a", "Artist A", 0.82, { genreFamily: "rock", energy: 0.9, clusterId: "wrong" }),
    track("repeat-b", "Artist B", 0.81, { genreFamily: "rock", energy: 0.88, clusterId: "wrong" }),
    track("repeat-c", "Artist C", 0.8, { genreFamily: "rock", energy: 0.87, clusterId: "wrong" }),
    ...Array.from({ length: 12 }, (_, i) =>
      track(`fresh-${i}`, `Fresh ${i}`, 0.75 - i * 0.01, {
        genreFamily: "ambient",
        energy: 0.3,
        clusterId: "cluster-focus",
      }),
    ),
  ];
  const history = buildCrossSessionTrackHistory([
    ["repeat-a", "repeat-b", "repeat-c"],
    ["repeat-a", "repeat-b", "repeat-c"],
  ]);
  const result = applyPlaylistIdentityDistance(
    tracks,
    tracks,
    history,
    focusIntent,
    { type: "focus_minimalist", energyBias: -0.52 },
    { selectedClusterId: "cluster-focus" },
    { scoreFn: (row) => row.score ?? 0, canReplaceWith: () => true },
  );
  assert.ok(result.diagnostics.replacementCount <= 2);
});

test("opening dedup, SAGB, and IDP coexist", () => {
  const tracks: T[] = [
    track("gnr-opener", "GnR", 0.92, { genreFamily: "rock", energy: 0.9, clusterId: "wrong" }),
    track("gnr-mid", "GnR", 0.8, { genreFamily: "rock", energy: 0.85, clusterId: "wrong" }),
    ...Array.from({ length: 8 }, (_, i) =>
      track(`mid-${i}`, `Artist ${i}`, 0.7 - i * 0.01, {
        genreFamily: "ambient",
        energy: 0.3,
        clusterId: "cluster-focus",
      }),
    ),
    track("fresh1", "Fresh Artist", 0.75, { genreFamily: "ambient", energy: 0.31, clusterId: "cluster-focus" }),
    track("fresh2", "Another Fresh", 0.74, { genreFamily: "ambient", energy: 0.32, clusterId: "cluster-focus" }),
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
  const trackHistory = buildCrossSessionTrackHistory([
    ["gnr-opener", "gnr-mid"],
    ["gnr-opener"],
  ]);
  const idp = applyPlaylistIdentityDistance(
    gravity.tracks,
    gravity.tracks,
    trackHistory,
    focusIntent,
    { type: "focus_minimalist", energyBias: -0.52 },
    { selectedClusterId: "cluster-focus" },
    { auditDeterministic: true, scoreFn: (row) => row.score ?? 0 },
  );
  assert.equal(idp.tracks.length, tracks.length);
});

test("detectPromptExplicitAlbum — flags album-centric prompts", () => {
  assert.equal(detectPromptExplicitAlbum("Dark Side of the Moon full album"), true);
  assert.equal(detectPromptExplicitAlbum("focus study beats"), false);
});
