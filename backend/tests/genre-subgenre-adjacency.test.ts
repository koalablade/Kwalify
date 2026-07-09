import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSubgenreEvidenceGraph,
  trackMatchesAdjacentSubgenreEvidence,
  trackSubgenreIsExplicitlyExcluded,
} from "../lib/genre-subgenre-adjacency";

test("buildSubgenreEvidenceGraph for uk_garage includes 2_step and excludes country", () => {
  const graph = buildSubgenreEvidenceGraph({
    primarySubgenre: "uk_garage",
    secondarySubgenre: null,
    subgenreTerms: ["uk_garage"],
    genreFamilies: ["electronic"],
  });
  assert.equal(graph.canonical.includes("uk_garage"), true);
  assert.equal(graph.adjacent.includes("2_step"), true);
  assert.equal(graph.excluded.includes("country"), true);
  assert.equal(graph.acceptable.includes("country"), false);
});

test("trackSubgenreIsExplicitlyExcluded blocks country for pop_punk intent", () => {
  const intent = {
    primarySubgenre: "pop_punk",
    secondarySubgenre: null,
    subgenreTerms: ["pop_punk"],
    genreFamilies: ["rock"],
  };
  assert.equal(
    trackSubgenreIsExplicitlyExcluded(["rock", "country", "folk_country"], intent),
    true,
  );
});

test("pop_punk adjacent accepts emo track terms", () => {
  const intent = {
    primarySubgenre: "pop_punk",
    secondarySubgenre: null,
    subgenreTerms: ["pop_punk"],
    genreFamilies: ["rock"],
  };
  assert.equal(
    trackMatchesAdjacentSubgenreEvidence(["rock", "emo"], intent),
    true,
  );
});
