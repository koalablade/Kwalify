import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleCandidateLineage,
  copyTrackIds,
  copyV3PrefilterIds,
  intersectCount,
  lineageStage,
  worldFilterBranchFor,
} from "../lib/candidate-lineage-trace";
import { mergeGoldSet, loadGoldSetSync } from "../lib/human-quality-evaluator/gold-set";
import { strongRelevantTrackIds } from "../lib/human-quality-evaluator/library-opportunity";
import type { QaLibrarySnapshot } from "../lib/human-quality-evaluator/library-opportunity";

test("copyTrackIds copies IDs and does not mutate the source array", () => {
  const tracks = Object.freeze([
    { trackId: "aaa", score: 0.9 },
    { id: "bbb", score: 0.8 },
  ]);
  const ids = copyTrackIds(tracks);
  ids.push("mutated");
  assert.deepEqual(tracks.map((t) => t.trackId ?? t.id), ["aaa", "bbb"]);
  assert.equal((tracks[0] as { score: number }).score, 0.9);
});

test("lineageStage missing IDs stay unknown rather than 0-actual", () => {
  const unknown = lineageStage("v3Prefilter", null);
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.count, 0);
  const actual = lineageStage("final", ["a", "b"]);
  assert.equal(actual.status, "actual");
  assert.equal(actual.count, 2);
});

test("assembleCandidateLineage does not reorder or drop supplied IDs", () => {
  const scoring = ["s1", "s2", "s3"];
  const final = ["s2", "s1"];
  const lineage = assembleCandidateLineage({
    prompt: "indie rock",
    requestedLength: 25,
    deliveredLength: 2,
    scoringPoolIds: scoring,
    finalIds: final,
    composedIds: ["s1", "s2"],
  });
  scoring.push("s4");
  final.reverse();
  assert.deepEqual(lineage.stages.scoringPool.ids, ["s1", "s2", "s3"]);
  assert.deepEqual(lineage.stages.final.ids, ["s2", "s1"]);
  assert.equal(lineage.stages.v3Prefilter.status, "unknown");
  assert.equal(lineage.observational, true);
});

test("world filter branch is add-only when hardLock is set", () => {
  assert.equal(worldFilterBranchFor({ hardLock: false, worldIds: ["indie"] }), "skipped_no_hard_lock");
  assert.equal(worldFilterBranchFor({ hardLock: true, worldIds: [] }), "skipped_no_world_ids");
  assert.equal(worldFilterBranchFor({ hardLock: true, worldIds: ["indie_rock_world"] }), "hard_lock_add_only");
});

test("intersectCount is selection-neutral set math", () => {
  assert.equal(intersectCount(["a", "b", "c"], ["b", "c", "d"]), 2);
  assert.equal(intersectCount(["a", "a"], ["a"]), 1);
});

test("gold human labels still cannot be overwritten", () => {
  const gold = loadGoldSetSync();
  const { skipped, added } = mergeGoldSet(
    gold,
    gold.labels.map((l) => ({ ...l, verdict: "MAYBE" as const })),
  );
  assert.equal(added, 0);
  assert.equal(skipped, gold.labels.length);
  assert.equal(gold.labels.find((l) => l.prompt === "melancholic")?.verdict, "YES");
  assert.equal(gold.labels.find((l) => l.prompt === "indie rock")?.verdict, "YES");
  assert.equal(gold.labels.find((l) => l.prompt === "2000s indie")?.verdict, "NO");
  assert.equal(gold.labels.find((l) => l.prompt === "90s alternative rock")?.verdict, "NO");
  assert.equal(gold.labels.find((l) => l.prompt === "nostalgic")?.verdict, "NO");
});

test("copyV3PrefilterIds is null when missing rather than empty-actual", () => {
  assert.equal(copyV3PrefilterIds(null), null);
  assert.equal(copyV3PrefilterIds({}), null);
  const ids = copyV3PrefilterIds({
    preV3Recovery: { candidatePoolTrackIds: ["a", "b"] },
  });
  assert.deepEqual(ids, ["a", "b"]);
});

test("assembleCandidateLineage does not mutate scores, thresholds, or source ID arrays", () => {
  const tracks = Object.freeze([
    { trackId: "t1", score: 0.91, threshold: 0.4 },
    { trackId: "t2", score: 0.77, threshold: 0.4 },
  ]);
  const scoringPoolIds = ["t1", "t2"];
  const lineage = assembleCandidateLineage({
    prompt: "indie rock",
    requestedLength: 25,
    deliveredLength: 14,
    scoringPoolIds,
    v3PrefilterIds: null,
    composedIds: ["t1", "t2"],
    postTerminalIds: ["t1", "t2"],
    beforeHygieneIds: ["t1", "t2"],
    afterHygieneIds: ["t1"],
    finalIds: copyTrackIds(tracks.slice(0, 1)),
    humanSaveable: false,
    executionPath: "gate_failure",
    curatorScore: 0.31,
  });
  scoringPoolIds.reverse();
  assert.deepEqual(lineage.stages.scoringPool.ids, ["t1", "t2"]);
  assert.equal((tracks[0] as { score: number }).score, 0.91);
  assert.equal((tracks[0] as { threshold: number }).threshold, 0.4);
  assert.equal(lineage.stages.v3Prefilter.status, "unknown");
  assert.equal(lineage.stages.v3Prefilter.count, 0);
  assert.equal(lineage.gate.executionPath, "gate_failure");
  assert.equal(lineage.hqg.late, null);
});

test("missing measurements stay unknown rather than 0-actual", () => {
  const lineage = assembleCandidateLineage({
    prompt: "90s alternative rock",
    requestedLength: 25,
    deliveredLength: 8,
  });
  for (const stage of Object.values(lineage.stages)) {
    assert.equal(stage.status, "unknown");
    assert.equal(stage.count, 0);
  }
});

test("lineage module is observational: no engine imports and no refill/gate triggers", () => {
  const candidates = [
    join(process.cwd(), "backend", "lib", "candidate-lineage-trace.ts"),
    join(process.cwd(), "lib", "candidate-lineage-trace.ts"),
  ];
  const path = candidates.find((p) => existsSync(p));
  assert.ok(path, `candidate-lineage-trace.ts not found in ${candidates.join(" | ")}`);
  const src = readFileSync(path, "utf8");
  assert.equal(/^import /m.test(src), false);
  assert.match(src, /Does not filter, score, rank, refill, or gate/);
});

test("strongRelevantTrackIds copies IDs and does not mutate the library snapshot", () => {
  const snapshot: QaLibrarySnapshot = {
    userId: "test",
    loadedAt: "2026-08-17T00:00:00.000Z",
    librarySize: 2,
    tracks: [
      {
        trackId: "indie-1",
        trackName: "Float On",
        artistName: "Modest Mouse",
        albumName: "Good News",
        releaseYear: 2004,
        genreFamily: "indie",
        primarySubgenre: "indie_rock",
        subGenres: ["indie rock"],
      },
      {
        trackId: "pop-1",
        trackName: "Pop Hit",
        artistName: "Pop Artist",
        albumName: "Hits",
        releaseYear: 2018,
        genreFamily: "pop",
        primarySubgenre: "pop",
        subGenres: ["pop"],
      },
    ],
  };
  const frozen = Object.freeze(snapshot);
  Object.freeze(frozen.tracks);
  const ids = strongRelevantTrackIds(frozen, "2000s indie");
  ids.push("mutated");
  assert.equal(frozen.tracks.length, 2);
  assert.equal(frozen.tracks[0]?.trackId, "indie-1");
});
