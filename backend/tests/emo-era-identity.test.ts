import assert from "node:assert/strict";
import test from "node:test";
import { buildLockedIntent } from "../core/v3/intent";
import { classifyTrack } from "../lib/genre-taxonomy";
import { passesWorldIdentity, worldIdentityProfilesForLock } from "../core/editorial/world-identity-gate";
import { getCulturalProfile } from "../core/editorial/cultural-identity-profile";
import { decomposeTrackWorldIdentity } from "../core/editorial/world-identity-score";
import { createPipelineAuthoritySession, createPipelineDeliveryBuffer } from "../lib/pipeline-authority/index.js";

// Regressions traced on a real 9.7k-song library for "2000s emo" (see the B11 investigation).

test("an era the user typed survives the interpretation budget", () => {
  // "2000s emo" (two words) used to keep the genre and budget the era away, so the pipeline built an
  // all-era playlist while the controller's era guard still enforced 2000–09.
  assert.deepEqual(buildLockedIntent("2000s emo").eraRange, { start: 2000, end: 2009 });
  assert.deepEqual(buildLockedIntent("2000s indie").eraRange, { start: 2000, end: 2009 });
  assert.deepEqual(buildLockedIntent("90s grunge").eraRange, { start: 1990, end: 1999 });
});

function classify(artistName: string, spotifyArtistGenres: string[]) {
  return classifyTrack({ trackName: "Song", artistName, albumName: "", spotifyArtistGenres, energy: 0.85 });
}

test("post-punk is classified as post-punk, not punk", () => {
  assert.equal(classify("Interpol", ["indie rock", "post-punk"]).primarySubgenre === "punk", false);
  assert.equal(classify("The Cure", ["new wave", "post-punk", "gothic rock", "darkwave"]).primarySubgenre, "post_punk");
  assert.equal(classify("The Hellacopters", ["garage rock", "punk"]).primarySubgenre, "punk");
});

function popPunkIdentity(artistName: string, trackName: string, spotifyArtistGenres: string[]): boolean {
  const c = classify(artistName, spotifyArtistGenres);
  return passesWorldIdentity(
    {
      trackName,
      artistName,
      albumName: "",
      spotifyArtistGenres,
      genrePrimary: c.genrePrimary,
      genreFamily: c.genreFamily,
      genres: c.subGenres,
      energy: 0.85,
      valence: 0.5,
    },
    worldIdentityProfilesForLock({ anchors: ["pop_punk_world"] } as Parameters<typeof worldIdentityProfilesForLock>[0]),
    { hardLock: true },
  );
}

test("pop punk world needs pop punk / emo evidence, not the generic punk label", () => {
  assert.equal(popPunkIdentity("Anarbor", "You And I", ["pop punk"]), true);
  assert.equal(popPunkIdentity("AFI", "Love Like Winter", ["punk", "horror punk", "emo", "skate punk"]), true);
  assert.equal(popPunkIdentity("The Hellacopters", "No Salvation", ["garage rock", "punk"]), false);
  assert.equal(popPunkIdentity("Interpol", "Evil", ["indie rock", "post-punk"]), false);
});

test("a genre word in a world artist's own name does not reject it", () => {
  // "disco" in "Panic! At The Disco" rejected every 2005 Panic! song from pop punk / emo.
  assert.equal(popPunkIdentity("Panic! At The Disco", "Camisado", ["emo"]), true);
  const profile = getCulturalProfile("pop_punk_world")!;
  const decomposition = decomposeTrackWorldIdentity(
    { trackName: "Camisado", artistName: "Panic! At The Disco", spotifyArtistGenres: ["emo"], energy: 0.9, releaseYear: 2005 },
    profile,
  );
  assert.notEqual(decomposition.evidenceTier, "forbidden");
  // A genre word in the title still counts.
  assert.equal(popPunkIdentity("Some Band", "Disco Inferno", ["emo"]), false);
});

test("delivery buffer remembers which stage removed a track", () => {
  const session = createPipelineAuthoritySession();
  const delivery = createPipelineDeliveryBuffer<{ trackId: string; artistName: string }>(session);
  delivery.init("v3_handoff", "init", [
    { trackId: "a", artistName: "A" },
    { trackId: "b", artistName: "B" },
    { trackId: "c", artistName: "C" },
  ]);
  delivery.replaceTracks("human_quality_gate", "test", [{ trackId: "a", artistName: "A" }]);
  delivery.replaceTracks("world_purity_gate", "test", [
    { trackId: "a", artistName: "A" },
    { trackId: "b", artistName: "B" },
  ]);
  assert.deepEqual([...delivery.trackIdsRemovedBy(["human_quality_gate"])].sort(), ["b", "c"]);
  assert.equal(delivery.trackIdsRemovedBy(["era_evidence_guard"]).size, 0);
});
