import test from "node:test";
import assert from "node:assert/strict";
import { getDeliveryCap } from "../core/editorial/world-coverage";

test("V37 LOW coverage no longer truncates already-validated delivery depth", () => {
  assert.equal(getDeliveryCap("LOW", 25), 25);
  assert.equal(getDeliveryCap("LOW", 25, 17), 25);
});

test("V37 MEDIUM coverage no longer truncates already-validated delivery depth", () => {
  assert.equal(getDeliveryCap("MEDIUM", 25), 25);
  assert.equal(getDeliveryCap("MEDIUM", 25, 23), 25);
});

test("V37 preserves the conservative VERY_LOW ceiling", () => {
  assert.equal(getDeliveryCap("VERY_LOW", 25), 5);
  assert.equal(getDeliveryCap("VERY_LOW", 25, 10), 10);
});

test("HIGH coverage remains bounded by the requested length", () => {
  assert.equal(getDeliveryCap("HIGH", 25), 25);
  assert.equal(getDeliveryCap("HIGH", 20), 20);
});
