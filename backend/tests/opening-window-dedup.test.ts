import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOpeningWindowDedup,
  buildOpeningWindowHistory,
  OPENING_DEDUP_WINDOW_SIZE,
} from "../lib/opening-window-dedup";
import {
  clearOpeningWindowSession,
  getOpeningWindowSessionHistory,
  recordOpeningWindowSession,
} from "../lib/opening-window-session";

type T = { trackId: string; score?: number };

function track(id: string, score: number): T {
  return { trackId: id, score };
}

test("buildOpeningWindowHistory — counts only positions 1–10", () => {
  const history = buildOpeningWindowHistory([
    ["a", "b", "c"],
    [...Array.from({ length: 12 }, (_, i) => `pad-${i}`), "deep-only"],
  ]);
  assert.equal(history.openingWindowHistorySize, 2);
  assert.equal(history.trackAppearanceCount.get("a"), 1);
  assert.equal(history.trackAppearanceCount.get("deep-only"), undefined);
});

test("applyOpeningWindowDedup — swaps fatigued opener with fresh tail alternative", () => {
  const tracks: T[] = [
    track("gnr", 0.92),
    track("b", 0.8),
    ...Array.from({ length: 8 }, (_, i) => track(`mid-${i}`, 0.7 - i * 0.01)),
    track("fresh1", 0.75),
    track("fresh2", 0.74),
    track("fresh3", 0.73),
  ];
  const history = buildOpeningWindowHistory([tracks.slice(0, 10).map((t) => t.trackId)]);
  history.trackAppearanceCount.set("gnr", 2);

  const result = applyOpeningWindowDedup(tracks, history, {
    auditDeterministic: true,
    scoreFn: (t) => t.score ?? 0,
  });

  assert.notEqual(result.tracks[0]!.trackId, "gnr");
  assert.ok(result.tracks.some((t) => t.trackId === "gnr"));
  assert.ok(result.diagnostics.openerReplacementCount >= 1);
  assert.equal(result.diagnostics.openingWindowHistorySize, 1);
});

test("applyOpeningWindowDedup — does not remove track from playlist", () => {
  const tracks: T[] = [
    track("repeat", 0.9),
    ...Array.from({ length: 14 }, (_, i) => track(`other-${i}`, 0.6 + i * 0.01)),
  ];
  const history = buildOpeningWindowHistory([["repeat", "x", "y"]]);
  const result = applyOpeningWindowDedup(tracks, history, { scoreFn: (t) => t.score ?? 0 });
  const ids = result.tracks.map((t) => t.trackId);
  assert.ok(ids.includes("repeat"));
});

test("applyOpeningWindowDedup — relaxes when supply is thin", () => {
  const tracks: T[] = [
    track("repeat", 0.9),
    track("only", 0.5),
  ];
  const history = buildOpeningWindowHistory([["repeat"]]);
  const result = applyOpeningWindowDedup(tracks, history, {
    thinLibraryRelaxed: true,
    scoreFn: (t) => t.score ?? 0,
  });
  assert.equal(result.diagnostics.relaxedDueToSupply, true);
  assert.equal(result.diagnostics.openerReplacementCount, 0);
});

test("opening window session — ephemeral record and retrieve", () => {
  clearOpeningWindowSession("user-1");
  recordOpeningWindowSession("user-1", Array.from({ length: 15 }, (_, i) => `t-${i}`));
  const history = getOpeningWindowSessionHistory("user-1");
  assert.equal(history.length, 1);
  assert.equal(history[0]!.length, OPENING_DEDUP_WINDOW_SIZE);
  clearOpeningWindowSession("user-1");
});

test("applyOpeningWindowDedup — deterministic tie-break in audit mode", () => {
  const tracks: T[] = [
    track("fatigued", 0.8),
    ...Array.from({ length: 12 }, (_, i) => track(`alt-${String.fromCharCode(97 + i)}`, 0.79)),
  ];
  const history = buildOpeningWindowHistory([["fatigued"]]);
  const a = applyOpeningWindowDedup([...tracks], history, { auditDeterministic: true, scoreFn: (t) => t.score ?? 0 });
  const b = applyOpeningWindowDedup([...tracks], history, { auditDeterministic: true, scoreFn: (t) => t.score ?? 0 });
  assert.deepEqual(a.tracks.map((t) => t.trackId), b.tracks.map((t) => t.trackId));
});
