import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyHumanCurationSequencing,
  ejectOrReplaceBadMomentTracks,
  MOMENT_REPLACEMENT_POOL_CAP,
} from "../core/editorial/human-curation-sequencer";
import { getCulturalProfile } from "../core/editorial/cultural-identity-profile";
import { scoreTrackWorldIdentity } from "../core/editorial/world-identity-score";

type T = {
  trackId?: string;
  trackName: string;
  artistName: string;
  energy?: number | null;
  popularity?: number | null;
};

function tr(id: string, name: string, artist: string, energy: number, pop = 70): T {
  return { trackId: id, trackName: name, artistName: artist, energy, popularity: pop };
}

describe("v19 cross-pool moment replacement", () => {
  it("Test 1: replacement exists — bad removed, replacement inserted", () => {
    const playlist = [
      tr("1", "T.N.T.", "AC/DC", 0.84, 85),
      tr("2", "Welcome To The Jungle", "Guns N' Roses", 0.92, 82),
      tr("3", "Back In Black", "AC/DC", 0.85, 88),
      tr("4", "Don't Cry", "Guns N' Roses", 0.42, 80),
      tr("5", "Paranoid", "Black Sabbath", 0.9, 85),
    ];
    const pool = [tr("pool-1", "Enter Sandman", "Metallica", 0.88, 84)];

    const result = ejectOrReplaceBadMomentTracks(playlist, "gym", {
      replacementPool: pool,
      prompt: "heavy gym workout aggressive",
    });

    const titles = result.tracks.map((t) => t.trackName.toLowerCase());
    assert.ok(!titles.some((t) => t.includes("don't cry")));
    assert.ok(titles.some((t) => t.includes("enter sandman")));
    assert.equal(result.tracks.length, playlist.length);
    assert.ok(result.crossPoolReplacements >= 1);
    assert.equal(result.momentReplacementDiagnostics[0]?.fallbackToEject, false);
  });

  it("Test 2: no suitable replacement — bad removed, shorter playlist", () => {
    const playlist = [
      tr("1", "T.N.T.", "AC/DC", 0.84, 85),
      tr("2", "Welcome To The Jungle", "Guns N' Roses", 0.92, 82),
      tr("3", "Back In Black", "AC/DC", 0.85, 88),
      tr("4", "Don't Cry", "Guns N' Roses", 0.42, 80),
    ];
    const result = ejectOrReplaceBadMomentTracks(playlist, "gym", {
      replacementPool: [tr("pool-bad", "Sweet Child O' Mine", "Guns N' Roses", 0.55, 85)],
      prompt: "heavy gym workout aggressive",
    });

    const titles = result.tracks.map((t) => t.trackName.toLowerCase());
    assert.ok(!titles.some((t) => t.includes("don't cry")));
    assert.ok(result.tracks.length < playlist.length);
    assert.ok(result.removals >= 1);
    assert.equal(result.momentReplacementDiagnostics[0]?.fallbackToEject, true);
  });

  it("Test 3: unsuitable candidate fails moment fit — no filler", () => {
    const playlist = [
      tr("1", "Rock with You", "Michael Jackson", 0.72, 85),
      tr("2", "Le Freak", "Chic", 0.78, 80),
      tr("3", "Regulate", "Warren G", 0.7, 80),
      tr("4", "Good Times", "Chic", 0.76, 78),
    ];
    const result = ejectOrReplaceBadMomentTracks(playlist, "disco", {
      replacementPool: [
        tr("pool-rap", "Regulate", "Warren G", 0.7, 80),
        tr("pool-rap2", "Dior", "Pop Smoke", 0.75, 82),
      ],
      prompt: "disco rooftop party 1978",
    });

    const artists = result.tracks.map((t) => t.artistName.toLowerCase());
    assert.ok(!artists.some((a) => a.includes("warren g")));
    assert.ok(!artists.some((a) => a.includes("pop smoke")));
    assert.ok(result.tracks.length < playlist.length);
    assert.equal(result.momentReplacementDiagnostics[0]?.momentFitCandidates, 0);
  });

  it("Test 4: duplicate in playlist rejected", () => {
    const playlist = [
      tr("1", "T.N.T.", "AC/DC", 0.84, 85),
      tr("2", "Welcome To The Jungle", "Guns N' Roses", 0.92, 82),
      tr("3", "Back In Black", "AC/DC", 0.85, 88),
      tr("4", "Don't Cry", "Guns N' Roses", 0.42, 80),
      tr("5", "Paranoid", "Black Sabbath", 0.9, 85),
    ];
    const result = ejectOrReplaceBadMomentTracks(playlist, "gym", {
      replacementPool: [tr("dup", "Paranoid", "Black Sabbath", 0.9, 85)],
      prompt: "heavy gym workout aggressive",
    });

    const titles = result.tracks.map((t) => t.trackName.toLowerCase());
    assert.ok(!titles.some((t) => t.includes("don't cry")));
    assert.equal(result.momentReplacementDiagnostics[0]?.momentFitCandidates, 0);
    assert.equal(result.momentReplacementDiagnostics[0]?.fallbackToEject, true);
  });

  it("Test 5: poor world identity rejected when profile wired", () => {
    const profile = getCulturalProfile("gym_rock_world");
    assert.ok(profile);
    const offWorld = tr("off", "God's Plan", "Drake", 0.88, 90);
    assert.ok(scoreTrackWorldIdentity(offWorld, profile) < 0.72);

    const playlist = [
      tr("1", "T.N.T.", "AC/DC", 0.84, 85),
      tr("2", "Welcome To The Jungle", "Guns N' Roses", 0.92, 82),
      tr("3", "Back In Black", "AC/DC", 0.85, 88),
      tr("4", "Don't Cry", "Guns N' Roses", 0.42, 80),
      tr("5", "Paranoid", "Black Sabbath", 0.9, 85),
    ];
    const result = ejectOrReplaceBadMomentTracks(playlist, "gym", {
      replacementPool: [offWorld],
      prompt: "heavy gym workout aggressive",
      culturalProfile: profile,
    });

    const artists = result.tracks.map((t) => t.artistName.toLowerCase());
    assert.ok(!artists.some((a) => a.includes("drake")));
    assert.equal(result.momentReplacementDiagnostics[0]?.fallbackToEject, true);
  });

  it("Test 6: bounded pool — large source does not scan beyond 256", () => {
    const filler = Array.from({ length: MOMENT_REPLACEMENT_POOL_CAP + 50 }, (_, i) =>
      tr(`filler-${i}`, `Track ${i}`, "Filler Band", 0.5, 40),
    );
    const goodReplacement = tr(
      "beyond-cap",
      "Enter Sandman",
      "Metallica",
      0.88,
      84,
    );
    const pool = [...filler, goodReplacement];

    const playlist = [
      tr("1", "T.N.T.", "AC/DC", 0.84, 85),
      tr("2", "Welcome To The Jungle", "Guns N' Roses", 0.92, 82),
      tr("3", "Back In Black", "AC/DC", 0.85, 88),
      tr("4", "Don't Cry", "Guns N' Roses", 0.42, 80),
      tr("5", "Paranoid", "Black Sabbath", 0.9, 85),
    ];

    const result = ejectOrReplaceBadMomentTracks(playlist, "gym", {
      replacementPool: pool,
      prompt: "heavy gym workout aggressive",
    });

    assert.equal(result.momentReplacementDiagnostics[0]?.candidatePoolSize, MOMENT_REPLACEMENT_POOL_CAP);
    const titles = result.tracks.map((t) => t.trackName.toLowerCase());
    assert.ok(!titles.some((t) => t.includes("enter sandman")));
    assert.equal(result.momentReplacementDiagnostics[0]?.fallbackToEject, true);
  });

  it("applyHumanCurationSequencing wires replacement pool through eject", () => {
    const playlist = [
      tr("1", "T.N.T.", "AC/DC", 0.84, 85),
      tr("2", "Welcome To The Jungle", "Guns N' Roses", 0.92, 82),
      tr("3", "Back In Black", "AC/DC", 0.85, 88),
      tr("4", "Don't Cry", "Guns N' Roses", 0.42, 80),
      tr("5", "Paranoid", "Black Sabbath", 0.9, 85),
    ];
    const seq = applyHumanCurationSequencing(playlist, {
      prompt: "heavy gym workout aggressive",
      replacementPool: [tr("pool-1", "Enter Sandman", "Metallica", 0.88, 84)],
    });
    assert.ok(seq.momentReplacementDiagnostics.length >= 1);
    assert.ok(seq.diagnostics.some((d) => d.includes("moment_eject")));
  });
});
