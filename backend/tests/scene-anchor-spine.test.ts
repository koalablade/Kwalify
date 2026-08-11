import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCulturalProfile } from "../core/editorial/cultural-identity-profile";
import {
  matchPriorityAnchor,
  missingPriorityAnchors,
  promoteSceneAnchorsInPlaylist,
  sceneAnchorTier,
} from "../core/editorial/scene-anchor-spine";

describe("scene-anchor-spine", () => {
  const madchester = getCulturalProfile("madchester_world")!;

  it("ranks Stone Roses above Oasis in tier", () => {
    const roses = sceneAnchorTier(madchester, "The Stone Roses");
    const oasis = sceneAnchorTier(madchester, "Oasis");
    assert.ok(roses > oasis);
  });

  it("promotes buried Stone Roses toward early slot", () => {
    const tracks = [
      { artistName: "Oasis", trackName: "Wonderwall" },
      { artistName: "Oasis", trackName: "Champagne Supernova" },
      { artistName: "The Stone Roses", trackName: "Fools Gold" },
      { artistName: "Blur", trackName: "Song 2" },
    ];
    const result = promoteSceneAnchorsInPlaylist(tracks, madchester);
    assert.ok(result.promotions >= 1);
    assert.ok(
      result.tracks.slice(0, 2).some((t) => matchPriorityAnchor(String(t.artistName), "Stone Roses")),
    );
  });

  it("detects missing priority anchors in pool", () => {
    const selected = [
      { artistName: "Oasis", trackName: "Wonderwall" },
      { artistName: "Blur", trackName: "Song 2" },
    ];
    const pool = [
      ...selected,
      { artistName: "Happy Mondays", trackName: "Step On" },
    ];
    const missing = missingPriorityAnchors(selected, pool, madchester);
    assert.ok(missing.some((m) => /happy mondays/i.test(m)));
  });
});
