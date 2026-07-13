import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrack } from "../lib/genre-taxonomy";
import { estimateThinLibraryIntentSupply } from "../lib/thin-library-intent-supply";
import {
  applyThinLibraryDeliveryCap,
  effectiveFinalizeRequestedLength,
  evaluateThinLibraryPolicy,
  isAmbientFocusThinLibraryPrompt,
  resolveThinLibraryMinBestAvailableCount,
  shouldCompoundThinLibraryBypass,
  shouldEarlyThinLibraryHardStop,
  shouldSkipThinLibraryRecoveryInflate,
  THIN_LIBRARY_INSUFFICIENT_THRESHOLD,
} from "../lib/thin-library-policy";

function popTrack(id: string, energy = 0.72, danceability = 0.75) {
  return {
    trackId: id,
    trackName: `Pop Song ${id}`,
    artistName: "Pop Artist",
    albumName: "Pop Album",
    releaseYear: 2020,
    energy,
    valence: 0.65,
    danceability,
    tempo: 120,
  };
}

function latinTrack(id: string) {
  return {
    trackId: id,
    trackName: `Latin Heat ${id}`,
    artistName: "Latin Artist",
    albumName: "Latin Album",
    releaseYear: 2020,
    energy: 0.74,
    valence: 0.7,
    danceability: 0.8,
    tempo: 110,
  };
}

function folkAcousticTrack(id: string) {
  return {
    trackId: id,
    trackName: `Sunday Song ${id} - Acoustic`,
    artistName: "Folk Artist",
    albumName: "Acoustic Sessions",
    releaseYear: 2018,
    energy: 0.32,
    valence: 0.48,
    danceability: 0.42,
    acousticness: 0.82,
    tempo: 92,
  };
}

function eraTekkTrack(id: string, year: number) {
  return {
    trackId: id,
    trackName: `Tekk Rave ${id}`,
    artistName: "Rave Artist",
    albumName: "Warehouse",
    releaseYear: year,
    energy: 0.8,
    valence: 0.55,
    danceability: 0.7,
    tempo: 140,
  };
}

function buildClassMap(tracks: Array<{ trackId: string; trackName: string; artistName: string; albumName: string; energy?: number; valence?: number; danceability?: number; acousticness?: number }>) {
  const classMap = new Map<string, ReturnType<typeof classifyTrack>>();
  for (const track of tracks) {
    classMap.set(track.trackId, classifyTrack({
      trackName: track.trackName,
      artistName: track.artistName,
      albumName: track.albumName,
      energy: track.energy ?? null,
      valence: track.valence ?? null,
      danceability: track.danceability ?? null,
      acousticness: track.acousticness ?? null,
    }));
  }
  return classMap;
}

test("ambient focus prompt with 1-2 matches publishes honest partial instead of insufficient", () => {
  assert.ok(isAmbientFocusThinLibraryPrompt("focus ambient morning instrumental"));
  const supply = {
    requestedLength: 30,
    strictSupply: 2,
    adjacentSupply: 0,
    intentPreservingSupply: 0,
    relaxedSupply: 40,
    excludedRelaxedSupply: 38,
    recoverySupply: 0,
    maxAchievable: 0,
    maxAchievableReason: "explicit ambient intent prevents broad relaxed supply",
    hasExplicitGenreIntent: true,
    eraConstrained: false,
  };
  const policy = evaluateThinLibraryPolicy(supply, { vibe: "focus ambient morning" });
  assert.equal(policy.action, "honest_partial");
  assert.equal(policy.reason, "ambient_focus_thin_library_partial");
  assert.equal(policy.targetLength, 2);
});

test("compound thin-library bypass does not require maxAchievable >= 3", () => {
  const supply = {
    requestedLength: 30,
    strictSupply: 0,
    adjacentSupply: 0,
    intentPreservingSupply: 0,
    relaxedSupply: 120,
    excludedRelaxedSupply: 120,
    recoverySupply: 80,
    maxAchievable: 0,
    maxAchievableReason: "explicit soul intent prevents broad relaxed supply",
    hasExplicitGenreIntent: true,
    eraConstrained: true,
  };
  assert.equal(shouldCompoundThinLibraryBypass(
    supply,
    {
      genreFamilies: ["soul"],
      primaryGenres: ["soul"],
      eraRange: { start: 1970, end: 1982 },
      activity: "party",
      mood: ["party"],
    },
    14,
    80,
  ), true);
});

test("early thin-library hard stop only when supply is truly empty", () => {
  const supply = {
    requestedLength: 30,
    strictSupply: 0,
    adjacentSupply: 0,
    intentPreservingSupply: 0,
    relaxedSupply: 0,
    excludedRelaxedSupply: 0,
    recoverySupply: 0,
    maxAchievable: 0,
    maxAchievableReason: "none",
    hasExplicitGenreIntent: true,
    eraConstrained: false,
  };
  const policy = evaluateThinLibraryPolicy(supply);
  assert.equal(shouldEarlyThinLibraryHardStop(policy, supply, {
    compoundBypass: false,
    strictValidCount: 0,
    thinMinRequired: 14,
  }), true);
  assert.equal(shouldEarlyThinLibraryHardStop(policy, supply, {
    compoundBypass: false,
    strictValidCount: 20,
    thinMinRequired: 14,
  }), false);
});

test("Test 1 — explicit latin prompt with huge unrelated library → insufficient", () => {
  const unrelated = Array.from({ length: 120 }, (_, i) => popTrack(`pop-${i}`));
  const latin = [latinTrack("latin-1"), latinTrack("latin-2")];
  const tracks = [...unrelated, ...latin];
  const classMap = buildClassMap(tracks);
  for (const id of ["latin-1", "latin-2"]) {
    const row = classMap.get(id)!;
    row.genreFamily = "latin";
    row.genrePrimary = "latin";
    row.primarySubgenre = "salsa";
    classMap.set(id, row);
  }

  const supply = estimateThinLibraryIntentSupply({
    tracks,
    vibe: "latin summer beach party",
    intent: {
      activity: "party",
      genreFamilies: ["latin"],
      primaryGenres: ["latin"],
      primarySubgenre: "salsa",
      subgenreTerms: ["salsa", "reggaeton"],
      secondarySubgenre: null,
      eraStart: null,
      eraEnd: null,
      eraRange: null,
    },
    classMap,
    requestedLength: 30,
  });

  assert.ok(supply.relaxedSupply > supply.intentPreservingSupply);
  assert.ok(supply.excludedRelaxedSupply > 0);
  assert.ok(supply.maxAchievable <= 2, `expected maxAchievable <= 2, got ${supply.maxAchievable}`);
  assert.match(supply.maxAchievableReason, /explicit latin intent prevents broad relaxed supply/);

  const policy = evaluateThinLibraryPolicy(supply);
  assert.equal(policy.action, "insufficient");
  assert.ok(policy.maxAchievable < THIN_LIBRARY_INSUFFICIENT_THRESHOLD);
  assert.equal(policy.diagnostics.strictSupply + policy.diagnostics.adjacentSupply, policy.diagnostics.intentPreservingSupply);
});

test("Test 2 — era-specific calibration with huge relaxed pool → honest partial", () => {
  const offIntentEraParty = Array.from({ length: 80 }, (_, i) => ({
    ...popTrack(`relaxed-${i}`),
    releaseYear: 1995,
  }));
  const eraHits = [
    eraTekkTrack("tekk-1", 1993),
    eraTekkTrack("tekk-2", 1995),
    eraTekkTrack("tekk-3", 1997),
  ];
  const tracks = [...offIntentEraParty, ...eraHits];
  const classMap = buildClassMap(tracks);
  for (const id of ["tekk-1", "tekk-2", "tekk-3"]) {
    const row = classMap.get(id)!;
    row.genreFamily = "electronic";
    row.genrePrimary = "electronic";
    row.primarySubgenre = "rave";
    row.subGenres = ["rave", "hard_techno"];
    classMap.set(id, row);
  }

  const supply = estimateThinLibraryIntentSupply({
    tracks,
    vibe: "90s tekk rave warehouse party",
    intent: {
      activity: "party",
      genreFamilies: ["electronic"],
      primaryGenres: ["electronic"],
      primarySubgenre: "rave",
      subgenreTerms: ["rave", "tekk", "hard_techno"],
      secondarySubgenre: null,
      eraRange: { start: 1990, end: 1999 },
      eraStart: 1990,
      eraEnd: 1999,
    },
    classMap,
    requestedLength: 30,
  });

  assert.ok(supply.relaxedSupply > supply.intentPreservingSupply);
  assert.equal(supply.maxAchievable, supply.intentPreservingSupply);
  assert.ok(supply.maxAchievable <= 5);
  assert.match(supply.maxAchievableReason, /prevents broad/);

  const policy = evaluateThinLibraryPolicy(supply);
  assert.equal(policy.action, "honest_partial");
  assert.equal(effectiveFinalizeRequestedLength(30, policy), supply.maxAchievable);
});

test("Test 3 — chill acoustic keeps expanded folk supply", () => {
  const unrelated = Array.from({ length: 40 }, (_, i) => popTrack(`noise-${i}`, 0.75, 0.8));
  const acousticFolk = Array.from({ length: 24 }, (_, i) => folkAcousticTrack(`folk-${i}`));
  const tracks = [...unrelated, ...acousticFolk];
  const classMap = buildClassMap(tracks);

  const supply = estimateThinLibraryIntentSupply({
    tracks,
    vibe: "acoustic chill Sunday",
    intent: {
      activity: "chill",
      genreFamilies: ["folk", "indie"],
      primaryGenres: ["folk"],
      primarySubgenre: null,
      subgenreTerms: [],
      secondarySubgenre: null,
      eraStart: null,
      eraEnd: null,
      eraRange: null,
      energyLevel: "low",
    },
    classMap,
    requestedLength: 25,
  });

  assert.ok(supply.intentPreservingSupply >= 20, `expected expanded folk supply, got ${supply.intentPreservingSupply}`);
  const policy = evaluateThinLibraryPolicy(supply);
  assert.equal(policy.action, "normal");
  assert.equal(policy.targetLength, 25);
});

test("honest partial caps delivery and recovery inflate", () => {
  const tracks = [
    eraTekkTrack("t1", 1994),
    eraTekkTrack("t2", 1995),
    eraTekkTrack("t3", 1996),
  ];
  const supply = estimateThinLibraryIntentSupply({
    tracks,
    vibe: "90s tekk rave",
    intent: {
      genreFamilies: ["electronic"],
      primarySubgenre: "rave",
      subgenreTerms: ["rave"],
      secondarySubgenre: null,
      eraRange: { start: 1990, end: 1999 },
      eraStart: 1990,
      eraEnd: 1999,
    },
    classMap: (() => {
      const m = buildClassMap(tracks);
      for (const id of ["t1", "t2", "t3"]) {
        const row = m.get(id)!;
        row.genreFamily = "electronic";
        row.primarySubgenre = "rave";
        m.set(id, row);
      }
      return m;
    })(),
    requestedLength: 30,
  });
  const policy = evaluateThinLibraryPolicy(supply);
  assert.equal(policy.action, "honest_partial");
  assert.equal(resolveThinLibraryMinBestAvailableCount(30, policy), Math.min(supply.maxAchievable, Math.max(1, Math.ceil(supply.maxAchievable * 0.67))));
  assert.equal(shouldSkipThinLibraryRecoveryInflate(policy, supply.maxAchievable), true);
  const capped = applyThinLibraryDeliveryCap(
    [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }],
    policy,
  );
  if (supply.maxAchievable < 6) {
    assert.equal(capped.applied, true);
    assert.equal(capped.tracks.length, supply.maxAchievable);
  }
});
