import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEvaluationSessionMemoryPayload,
  DEFAULT_EXPRESS_JSON_BODY_LIMIT_BYTES,
  EVAL_SESSION_BODY_BUDGET_BYTES,
  jsonUtf8ByteLength,
} from "../lib/evaluation-session-memory-payload";

function spotifyTrackId(index: number): string {
  return `spotify:track:${String(index).padStart(22, "0")}`;
}

function makeRunMemory(playlistCount: number, tracksPerPlaylist: number) {
  const previousTrackLists: string[][] = [];
  const previousPlaylistContexts: Array<{
    trackIds: string[];
    context: {
      category: string;
      curatorType: string;
      primaryGenreFamily: string;
      activity: string;
      energyBand: string;
    };
  }> = [];

  for (let playlist = 0; playlist < playlistCount; playlist += 1) {
    const trackIds = Array.from({ length: tracksPerPlaylist }, (_, index) => spotifyTrackId(playlist * 100 + index));
    previousTrackLists.push(trackIds);
    previousPlaylistContexts.push({
      trackIds,
      context: {
        category: "party",
        curatorType: "party_social",
        primaryGenreFamily: "disco",
        activity: "party",
        energyBand: "high-energy",
      },
    });
  }

  return { previousTrackLists, previousPlaylistContexts };
}

function baseGenerateBody(prompt: string): Record<string, unknown> {
  return {
    vibe: prompt,
    mode: "balanced",
    length: 30,
    varietyBoost: true,
    auditMode: true,
    evaluationCategory: "party",
  };
}

test("buildEvaluationSessionMemoryPayload returns undefined when there is no prior session memory", () => {
  assert.equal(
    buildEvaluationSessionMemoryPayload(
      { previousTrackLists: [], previousPlaylistContexts: [] },
      { baseBody: baseGenerateBody("party") },
    ),
    undefined,
  );
});

test("buildEvaluationSessionMemoryPayload keeps worst-case 50-playlist body under Express 64kb", () => {
  const baseBody = baseGenerateBody("70s disco party dancefloor with extra calibration context for launch");
  const runMemory = makeRunMemory(50, 30);
  const legacyPayload = {
    previousTrackIds: [...runMemory.previousTrackLists].reverse().slice(0, 50),
    previousPlaylistContexts: [...runMemory.previousPlaylistContexts].reverse().slice(0, 50),
  };
  const legacyBody = { ...baseBody, evaluationSessionMemory: legacyPayload };
  assert.ok(jsonUtf8ByteLength(legacyBody) > DEFAULT_EXPRESS_JSON_BODY_LIMIT_BYTES);

  const memory = buildEvaluationSessionMemoryPayload(runMemory, { baseBody });
  assert.ok(memory);
  const requestBody = { ...baseBody, evaluationSessionMemory: memory };
  assert.ok(jsonUtf8ByteLength(requestBody) <= EVAL_SESSION_BODY_BUDGET_BYTES);
  assert.ok(jsonUtf8ByteLength(requestBody) < DEFAULT_EXPRESS_JSON_BODY_LIMIT_BYTES);
});

test("buildEvaluationSessionMemoryPayload caps playlist contexts to the server-side limit of 20", () => {
  const baseBody = baseGenerateBody("party");
  const runMemory = makeRunMemory(40, 25);
  const memory = buildEvaluationSessionMemoryPayload(runMemory, { baseBody });
  assert.ok((memory?.previousPlaylistContexts.length ?? 0) <= 20);
  assert.ok((memory?.previousTrackIds.length ?? 0) <= 20);
});
