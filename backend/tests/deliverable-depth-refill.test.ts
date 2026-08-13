import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCulturalProfile } from "../core/editorial/cultural-identity-profile";
import {
  mergeDeliverableCandidatePools,
  rankDeliverableCandidates,
  refillDeliverableDepth,
  refillAfterArtistCap,
  trackIdentityKey,
} from "../core/editorial/deliverable-depth-refill";
import type { CommittedWorld } from "../core/committed-world";
import { resolveCommittedWorld } from "../core/committed-world";

function reggaeHardLockWorld(): CommittedWorld {
  return resolveCommittedWorld({ prompt: "sunset beach reggae" })!;
}

describe("deliverable-depth-refill", () => {
  it("mergeDeliverableCandidatePools dedupes by track id", () => {
    const a = { trackId: "1", artistName: "A", trackName: "One" };
    const b = { trackId: "2", artistName: "B", trackName: "Two" };
    const merged = mergeDeliverableCandidatePools([a, b], [a, { ...b, trackName: "Two dup" }]);
    assert.equal(merged.length, 2);
    assert.equal(trackIdentityKey(merged[0]!), "1");
  });

  it("refills hard-lock playlist from ranked survivor pool after purity losses", () => {
    const profile = getCulturalProfile("reggae_world");
    assert.ok(profile);
    const rosterMember = {
      trackId: "g1",
      artistName: "Bob Marley",
      trackName: "Three Little Birds",
      energy: 0.55,
      releaseYear: 1977,
      genres: ["reggae"],
      genrePrimary: "reggae",
    };
    const instrumentationMember = (id: string, artist: string) => ({
      trackId: id,
      artistName: artist,
      trackName: `Instrumental ${id}`,
      energy: 0.55,
      releaseYear: 1985,
      genres: ["reggae"],
      genrePrimary: "reggae",
    });
    const composed = [
      rosterMember,
      ...Array.from({ length: 8 }, (_, i) => instrumentationMember(`c${i}`, `Reggae Artist ${i}`)),
      {
        trackId: "wrong",
        artistName: "Arctic Monkeys",
        trackName: "Wrong World",
        energy: 0.6,
        releaseYear: 2014,
        genres: ["indie rock"],
      },
    ];
    const pool = [
      ...composed,
      ...Array.from({ length: 40 }, (_, i) => instrumentationMember(`p${i}`, `Pool Artist ${i}`)),
    ];
    const result = refillDeliverableDepth(composed, pool, {
      requestedLength: 15,
      committed: reggaeHardLockWorld(),
      profile,
      preserveOpener: true,
    });
    assert.ok(result.tracks.length > composed.length - 3, `expected refill above composed survivors, got ${result.tracks.length}`);
    assert.ok(result.diagnostics.refilledCount > 0);
    assert.ok(result.diagnostics.tailAppends > 0 || result.diagnostics.positionReplacements > 0);
    assert.ok(!result.tracks.some((t) => String(t.artistName).includes("Arctic")));
  });

  it("rankDeliverableCandidates orders by world identity score", () => {
    const profile = getCulturalProfile("reggae_world");
    assert.ok(profile);
    const ranked = rankDeliverableCandidates(
      [
        { artistName: "Unknown", trackName: "Weak", energy: 0.5, releaseYear: 2020 },
        {
          artistName: "Lee Perry Jr",
          trackName: "Session",
          energy: 0.55,
          releaseYear: 1985,
          genres: ["reggae"],
          genrePrimary: "reggae",
        },
      ],
      profile,
    );
    assert.equal(ranked[0]?.artistName, "Lee Perry Jr");
  });

  it("no-op refill when hard lock inactive", () => {
    const profile = getCulturalProfile("reggae_world");
    assert.ok(profile);
    const seed = [{ trackId: "1", artistName: "A", trackName: "T" }];
    const result = refillDeliverableDepth(seed, seed, {
      requestedLength: 25,
      committed: null,
      profile,
    });
    assert.equal(result.tracks.length, 1);
    assert.equal(result.diagnostics.refilledCount, 0);
  });

  it("V36: refillAfterArtistCap fills with diverse artists under cap", () => {
    const profile = getCulturalProfile("reggae_world");
    assert.ok(profile);
    const instrumentationMember = (id: string, artist: string) => ({
      trackId: id,
      artistName: artist,
      trackName: `Track ${id}`,
      energy: 0.55,
      releaseYear: 1985,
      genres: ["reggae"],
      genrePrimary: "reggae",
    });
    const capped = Array.from({ length: 10 }, (_, i) =>
      instrumentationMember(`c${i}`, `Artist ${i % 5}`),
    );
    const pool = [
      ...capped,
      ...Array.from({ length: 30 }, (_, i) => instrumentationMember(`p${i}`, `Pool Artist ${i}`)),
    ];
    const result = refillAfterArtistCap(capped, pool, {
      requestedLength: 20,
      committed: reggaeHardLockWorld(),
      profile,
      perArtistCap: 2,
      promptCentralArtists: new Set(),
      preserveOpener: true,
      enforceWorldPurity: true,
    });
    assert.ok(result.tracks.length > capped.length, `expected growth beyond ${capped.length}, got ${result.tracks.length}`);
    assert.ok(result.diagnostics.refilledCount > 0);
    const counts = new Map<string, number>();
    for (const t of result.tracks) {
      const a = String(t.artistName);
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    for (const [, n] of counts) assert.ok(n <= 2);
  });
});
