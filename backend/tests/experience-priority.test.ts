import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { interpretWorld } from "../lib/world-understanding";
import { buildExperiencePriority } from "../lib/world-understanding/experience-priority";
import { resolveAmbiguousPrompt } from "../lib/world-understanding/ambiguous-prompt-resolver";
import { interpretMoment } from "../lib/world-understanding/moment-interpreter";
import { resolveIntentContract } from "../lib/world-understanding/intent-contract";
import { extractTaxonomy } from "../lib/world-understanding/concept-extractor";
import { interpretPhrases } from "../lib/world-understanding/phrase-interpreter";
import { matchFuzzyConcepts } from "../lib/world-understanding/fuzzy-matcher";

function priorityFor(prompt: string) {
  const text = prompt.trim();
  const intent = resolveIntentContract(text);
  const phraseMatches = interpretPhrases(text);
  const fuzzy = matchFuzzyConcepts(text);
  const { taxonomy, matchedConceptIds } = extractTaxonomy(text, phraseMatches, fuzzy.expansions);
  const ambiguousResolution = resolveAmbiguousPrompt(text);
  const momentInterpretation = interpretMoment(text, taxonomy, matchedConceptIds, intent);
  return buildExperiencePriority(text, taxonomy, momentInterpretation, ambiguousResolution);
}

describe("experience priority", () => {
  test("rain on windscreen → reflective journey not rain+car objects", () => {
    const prompt = "Empty motorway at midnight, rain on the windscreen";
    const priority = priorityFor(prompt);
    assert.ok(
      /reflective|private|transitional|journey|thought/i.test(priority.dominantExperience),
      `dominant: ${priority.dominantExperience}`,
    );
    assert.ok(
      !/rain.*car|car.*rain/i.test(priority.dominantExperience),
      "should not read as object list",
    );
    assert.ok(priority.confidence >= 0.8);
    assert.ok(
      priority.conceptRoles.some((c) => c.layer === "human_situation"),
      "expected human_situation layer",
    );
    assert.ok(
      priority.conceptRoles.some((c) => c.role === "sensory_atmosphere"),
      "weather as atmosphere not primary story",
    );
  });

  test("interpretWorld wires experience priority into narrative", () => {
    const r = interpretWorld("Empty motorway at midnight, rain on the windscreen");
    assert.ok(r.debug.experiencePriority, "expected experiencePriority in debug");
    assert.ok(
      /reflective|glass|nowhere|private|journey/i.test(r.humanNarrative),
      `humanNarrative: ${r.humanNarrative}`,
    );
    assert.ok(r.humanMeanings.length > 0);
  });

  test("parked after work → decompression pause", () => {
    const priority = priorityFor("Just parked up, knackered, don't want to go inside yet");
    assert.ok(
      /decompression|parked|door|private|pause|inside/i.test(priority.dominantExperience),
      `dominant: ${priority.dominantExperience}`,
    );
    assert.ok(priority.conceptRoles.some((c) => c.layer === "human_situation"));
  });

  test("ambiguous fragments have primary and secondary interpretations", () => {
    const alone = resolveAmbiguousPrompt("alone");
    assert.ok(alone.primaryInterpretation);
    assert.ok(alone.secondaryInterpretations.length >= 2);
    assert.ok(alone.confidence > 0);

    const sunday = resolveAmbiguousPrompt("Sunday");
    assert.ok(sunday.primaryInterpretation);
    assert.equal(sunday.primaryInterpretation?.label, "rest");
  });
});
