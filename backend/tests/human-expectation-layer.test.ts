import assert from "node:assert/strict";
import test from "node:test";

import {
  humanExpectationMode,
  isHumanExpectationEnabled,
  setHumanExpectationMode,
} from "../core/expectation/feature-flag";
import { interpretMoment, LexicalSemanticEmbedder } from "../core/expectation/moment-space";
import { deriveExpectationContract } from "../core/expectation/expectation-contract";
import { runExpectationShadow, type ShadowLogger } from "../core/expectation/shadow";
import type { Band, ExpectationContract } from "../core/expectation/types";

function assertValidBand(b: Band, label: string): void {
  assert.ok(b[0] >= 0 && b[0] <= 1, `${label} lo in range`);
  assert.ok(b[1] >= 0 && b[1] <= 1, `${label} hi in range`);
  assert.ok(b[0] <= b[1], `${label} lo <= hi`);
}

function assertValidContract(c: ExpectationContract): void {
  assertValidBand(c.sonicBands.energy, "energy");
  assertValidBand(c.sonicBands.valence, "valence");
  assertValidBand(c.sonicBands.tempo, "tempo");
  assertValidBand(c.sonicBands.acoustic, "acoustic");
  assertValidBand(c.sonicBands.instrumental, "instrumental");
  assert.ok(c.genreFunction.fits.length > 0, "has at least one fit function");
  assert.ok(c.source === "derived");
}

function bandCenter(b: Band): number {
  return (b[0] + b[1]) / 2;
}

test("interpretation is deterministic across calls", () => {
  const a = interpretMoment("late night drive through empty city streets");
  const b = interpretMoment("late night drive through empty city streets");
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("embedder is deterministic and normalised", () => {
  const e = new LexicalSemanticEmbedder();
  const v1 = e.embed("rainy coffee shop");
  const v2 = e.embed("rainy coffee shop");
  assert.deepEqual(Array.from(v1), Array.from(v2));
  let mag = 0;
  for (const x of v1) mag += x * x;
  assert.ok(Math.abs(Math.sqrt(mag) - 1) < 1e-9, "unit length");
});

test("known moment activates expected dimensions and yields ranked candidates", () => {
  const r = interpretMoment("late night drive through empty city streets");
  assert.ok((r.dimensions.scores["night"] ?? 0) > 0.12, "night activated");
  assert.ok(
    (r.dimensions.scores["driving"] ?? 0) > 0.12 || (r.dimensions.scores["car"] ?? 0) > 0.12,
    "driving/car activated",
  );
  assert.ok(r.candidates.length >= 1, "has candidates");
  assert.ok(r.candidates[0]!.confidence > 0, "top candidate has confidence");
  const sum = r.candidates.reduce((s, c) => s + c.confidence, 0);
  assert.ok(Math.abs(sum - 1) < 0.05, "confidences ~sum to 1");
});

test("generalises to an unseen prompt without throwing (novel flagged)", () => {
  const r = interpretMoment("assembling flat-pack shelving in a quiet flat");
  const c = deriveExpectationContract(r);
  assertValidContract(c);
  // "assembling" / "flat-pack" are not exact anchor terms → leaned on generalisation.
  assert.ok(r.candidates.length >= 1, "still produces an interpretation");
});

test("completely unknown tokens flag novelPrompt but still produce a contract", () => {
  const r = interpretMoment("zblorptium vunderkexpfy moment");
  assert.equal(r.novelPrompt, true, "novel flagged when no lexical coverage");
  const c = deriveExpectationContract(r);
  assertValidContract(c);
});

test("morphological coverage: snowfall reaches the snow dimension", () => {
  const r = interpretMoment("watching the first snowfall");
  assert.ok((r.dimensions.scores["snow"] ?? 0) > 0.12, "snow activated via snowfall");
});

test("low-energy melancholy moment avoids aggressive/high-energy and reads acoustic-friendly", () => {
  const r = interpretMoment("quiet lonely rainy night alone with my thoughts");
  const c = deriveExpectationContract(r);
  assertValidContract(c);
  assert.ok(bandCenter(c.sonicBands.energy) < 0.5, "low energy target");
  assert.ok(
    c.avoid.some((a) => /aggressive|high-energy|hype/i.test(a)),
    "avoids aggressive/high-energy",
  );
});

test("high-energy gym moment targets elevated energy", () => {
  const r = interpretMoment("aggressive heavy lifting in the gym chasing a new pr");
  const c = deriveExpectationContract(r);
  assertValidContract(c);
  assert.ok(bandCenter(c.sonicBands.energy) > 0.5, "elevated energy target");
});

test("focus/study moment leans instrumental (not storytelling)", () => {
  const r = interpretMoment("deep focus coding session studying with no distractions");
  const c = deriveExpectationContract(r);
  assert.notEqual(c.lyrical, "storytelling");
});

test("seed profile anchors emotional dimensions (nostalgia)", () => {
  const withSeed = interpretMoment("driving home", { seed: { nostalgia: 0.9, calm: 0.2 } });
  assert.ok((withSeed.dimensions.scores["nostalgia"] ?? 0) > 0.3, "nostalgia anchored from seed");
});

test("feature flag: off by default, toggles cleanly", () => {
  setHumanExpectationMode(null);
  assert.equal(humanExpectationMode(), "off");
  assert.equal(isHumanExpectationEnabled(), false);
  setHumanExpectationMode("shadow");
  assert.equal(humanExpectationMode(), "shadow");
  assert.equal(isHumanExpectationEnabled(), true);
  setHumanExpectationMode(null);
});

test("shadow runner is a no-op when flag is off", () => {
  setHumanExpectationMode(null);
  let called = false;
  const log: ShadowLogger = {
    info: () => {
      called = true;
    },
    warn: () => {
      called = true;
    },
  };
  const result = runExpectationShadow("late night drive", {}, log);
  assert.equal(result, null, "returns null when off");
  assert.equal(called, false, "does not log when off");
});

test("shadow runner computes and logs in shadow mode, never throws", () => {
  setHumanExpectationMode("shadow");
  const logged: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const log: ShadowLogger = {
    info: (obj, msg) => logged.push({ obj, msg }),
    warn: (obj, msg) => logged.push({ obj, msg }),
  };
  const result = runExpectationShadow(
    "rainy afternoon in a cozy coffee shop",
    { energy: 0.3, valence: 0.55, tension: 0.2, nostalgia: 0.4, calm: 0.7, journeyArc: "flat" },
    log,
  );
  assert.ok(result, "returns a result in shadow mode");
  assertValidContract(result!.contract);
  assert.equal(logged.length, 1, "logs exactly once");
  assert.equal(logged[0]!.msg, "human_expectation_shadow");
  setHumanExpectationMode(null);
});
