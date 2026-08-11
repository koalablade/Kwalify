import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCulturalProfile } from "../core/editorial/cultural-identity-profile";
import {
  applySceneAnchorRetrievalQuota,
  SCENE_ANCHOR_RETRIEVAL_INJECT_MAX,
  SCENE_ANCHOR_RETRIEVAL_POOL_SCAN_CAP,
} from "../core/editorial/scene-anchor-retrieval-quota";

describe("v19 scene-anchor retrieval quota", () => {
  const madchester = getCulturalProfile("madchester_world")!;
  const country = getCulturalProfile("country_world")!;

  const track = (
    id: string,
    artist: string,
    title: string,
    extras: Record<string, unknown> = {},
  ) => ({
    trackId: id,
    artistName: artist,
    trackName: title,
    energy: 0.72,
    popularity: 55,
    ...extras,
  });

  it("Test 1: eligible anchor exists — anchor promoted into retrieval pool", () => {
    const retrieved = [
      track("1", "Oasis", "Wonderwall"),
      track("2", "Blur", "Song 2"),
    ];
    const library = [
      ...retrieved,
      track("3", "Happy Mondays", "Step On"),
      track("4", "The Stone Roses", "Made of Stone"),
    ];
    const result = applySceneAnchorRetrievalQuota(retrieved, library, madchester, {
      prompt: "madchester pub walk",
    });
    assert.ok(result.diagnostics.injected.length >= 1);
    assert.ok(
      result.tracks.some((t) => /happy mondays|stone roses/i.test(String(t.artistName))),
      "missing priority anchor should enter retrieval pool",
    );
    assert.equal(result.tracks.length, retrieved.length + result.diagnostics.injected.length);
  });

  it("Test 2: no eligible anchor exists — retrieval unchanged, no fake track", () => {
    const retrieved = [
      track("1", "Oasis", "Wonderwall"),
      track("2", "The Stone Roses", "Made of Stone"),
    ];
    const library = [...retrieved];
    const result = applySceneAnchorRetrievalQuota(retrieved, library, madchester, {
      prompt: "madchester pub walk",
    });
    assert.deepEqual(
      result.tracks.map((t) => t.trackId),
      retrieved.map((t) => t.trackId),
    );
    assert.equal(result.diagnostics.injected.length, 0);
  });

  it("Test 3: unsuitable candidate fails moment fit — anchor not forced", () => {
    const retrieved = [track("1", "Oasis", "Wonderwall")];
    const library = [
      ...retrieved,
      track("2", "Happy Mondays", "Step On", { energy: 0.25 }),
      track("3", "The Stone Roses", "Don't Cry", { energy: 0.3 }),
    ];
    const result = applySceneAnchorRetrievalQuota(retrieved, library, madchester, {
      prompt: "heavy gym workout aggressive",
    });
    assert.equal(result.diagnostics.injected.length, 0);
    assert.equal(result.tracks.length, 1);
  });

  it("Test 4: duplicate track in playlist rejected", () => {
    const retrieved = [track("1", "Happy Mondays", "Step On")];
    const library = [
      ...retrieved,
      track("1", "Happy Mondays", "Step On"),
      track("2", "The Stone Roses", "Made of Stone"),
    ];
    const result = applySceneAnchorRetrievalQuota(retrieved, library, madchester, {
      prompt: "madchester pub walk",
    });
    assert.ok(result.tracks.filter((t) => t.trackId === "1").length === 1);
  });

  it("Test 5: poor world identity rejected when not anchor artist", () => {
    const retrieved = [track("1", "Oasis", "Wonderwall")];
    const library = [
      ...retrieved,
      track("2", "Random Pop Act", "Generic Song", {
        genreFamily: "pop",
        genrePrimary: "pop",
        energy: 0.7,
      }),
    ];
    const result = applySceneAnchorRetrievalQuota(retrieved, library, madchester, {
      prompt: "madchester pub walk",
    });
    assert.equal(result.diagnostics.injected.length, 0);
  });

  it("Test 6: bounded pool — scan stops at cap", () => {
    const retrieved = [track("0", "Oasis", "Wonderwall")];
    const library = Array.from({ length: SCENE_ANCHOR_RETRIEVAL_POOL_SCAN_CAP + 50 }, (_, i) =>
      track(String(i + 1), `Artist ${i}`, `Song ${i}`),
    );
    library.push(track("anchor", "Happy Mondays", "Step On"));
    const result = applySceneAnchorRetrievalQuota(retrieved, library, madchester, {
      prompt: "madchester pub walk",
      scanCap: SCENE_ANCHOR_RETRIEVAL_POOL_SCAN_CAP,
    });
    assert.equal(result.diagnostics.poolScanSize, SCENE_ANCHOR_RETRIEVAL_POOL_SCAN_CAP);
    assert.ok(result.diagnostics.injected.length <= SCENE_ANCHOR_RETRIEVAL_INJECT_MAX);
  });

  it("Test 7: non-target scene — country profile does not inject madchester anchors", () => {
    const retrieved = [track("1", "Johnny Cash", "Jackson")];
    const library = [
      ...retrieved,
      track("2", "Happy Mondays", "Step On"),
      track("3", "The Stone Roses", "Made of Stone"),
    ];
    const result = applySceneAnchorRetrievalQuota(retrieved, library, country, {
      prompt: "country cowboy road trip",
    });
    assert.equal(result.diagnostics.injected.length, 0);
    assert.equal(result.tracks.length, 1);
  });
});
