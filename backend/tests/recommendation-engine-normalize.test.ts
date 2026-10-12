import assert from "node:assert/strict";
import test from "node:test";
import { domainNormalizer, normalizeSceneScore } from "../core/engine/recommendation-engine";

// normalizeSignals now precomputes min/max per domain (it was O(n²)); results must be identical.
test("domainNormalizer matches the per-call normalizeDomain on every value", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cases: number[][] = [
    [],
    [0.42],
    [0.5, 0.5, 0.50001],
    [-0.2, 1.4, 0.3],
    Array.from({ length: 500 }, () => rand() * 2 - 0.5),
  ];
  for (const values of cases) {
    const norm = domainNormalizer(values);
    for (const value of values.length ? values : [0.3, 1.7, -1]) {
      assert.equal(norm(value), normalizeSceneScore(value, values));
    }
  }
});
