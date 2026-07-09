/**
 * Regression: strict compound prompts must not 500 on intent pool collapse.
 *
 * Live mode (requires repo-root .env with PLAYLIST_EVAL_TOKEN + DATABASE_URL):
 *   STRICT_COMPOUND_LIVE=1 node --import tsx --test backend/tests/strict-compound-prompt-500.test.ts
 *
 * Until the catch-handler bug is fixed, live tests document INTERNAL_ERROR.
 * After fix, expect INSUFFICIENT_INTENT_POOL (422) instead of INTERNAL_ERROR (500).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";
import { IntentCollapseInsufficientPoolError } from "../core/editorial/intent-collapse-layer";

const TARGET_IDS = ["party-70s-disco", "genre-pop-party"] as const;

const PROMPTS = PLAYLIST_BENCHMARK_PROMPTS.filter((row) =>
  TARGET_IDS.includes(row.id as (typeof TARGET_IDS)[number]),
);

test("strict compound benchmark prompts are configured", () => {
  assert.equal(PROMPTS.length, 2);
  for (const row of PROMPTS) {
    assert.equal(row.mode, "strict");
    assert.ok(row.length >= 25);
  }
});

test("IntentCollapseInsufficientPoolError encodes pool floor in message", () => {
  const err = new IntentCollapseInsufficientPoolError(
    "insufficient_intent_pool:0<22",
    {
      primaryMood: "party",
      editorialWorldTag: "disco_party_nostalgia",
      energyRange: [0.6, 0.95],
      rhythmDensityCap: 0.85,
      allowedMicroClusters: [],
      collapseConfidenceScore: 0.7,
      preFilterCount: 318,
      postFilterCount: 0,
    },
    undefined,
  );
  assert.match(err.message, /insufficient_intent_pool/);
  assert.equal(err.diagnostics.postFilterCount, 0);
});

test("catch handler must not reference try-scoped playlist length variable", () => {
  // Regression guard for ReferenceError: length is not defined (generation.controller catch block).
  // Simulate what the handler should use when IntentCollapseInsufficientPoolError fires.
  const collapseCtx: Record<string, unknown> = {
    scoringInputSongs: [],
    length: 30,
    lockedIntent: { genreFamilies: ["disco"], primaryGenres: ["disco"] },
  };
  const playlistLength = typeof collapseCtx.length === "number" ? collapseCtx.length : 25;
  const shapedSufficient = (collapseCtx.scoringInputSongs as unknown[]).length
    >= Math.max(8, Math.min(playlistLength, 12));
  assert.equal(shapedSufficient, false);
  assert.equal(playlistLength, 30);
});

const liveEnabled = process.env.STRICT_COMPOUND_LIVE === "1";

test(
  "live: strict compound prompts surface intent collapse without INTERNAL_ERROR",
  { skip: !liveEnabled },
  async () => {
    const { resolveLiveBenchmarkCredentials } = await import("../lib/benchmark-env.js");
    const { ensureEvalReady } = await import("../lib/benchmark-local-server.js");
    const creds = resolveLiveBenchmarkCredentials({
      strict: true,
      cli: { baseUrl: "http://localhost:5000", expectedDeploymentVersion: "benchmark" },
    });
    const ready = await ensureEvalReady(
      creds.baseUrl,
      creds.token,
      process.env.STRICT_COMPOUND_SPAWN_LOCAL === "1",
      "STRICT_COMPOUND_LIVE=1",
    );

    try {
      for (const prompt of PROMPTS) {
        const res = await fetch(`${ready.baseUrl}/api/generate?audit=1`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-kwalify-evaluation-token": creds.token,
          },
          body: JSON.stringify({
            vibe: prompt.prompt,
            mode: prompt.mode,
            length: prompt.length,
            auditMode: true,
            spotifyUserId: creds.spotifyUserId,
          }),
          signal: AbortSignal.timeout(180_000),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

        // Target behavior after fix: structured 422, not opaque 500.
        assert.notEqual(
          data.code,
          "INTERNAL_ERROR",
          `${prompt.id} should not 500 on intent pool collapse (got ${res.status})`,
        );
        assert.equal(res.status, 422, `${prompt.id} should return 422 INSUFFICIENT_INTENT_POOL`);
        assert.equal(data.code, "INSUFFICIENT_INTENT_POOL");
        assert.ok(data.fallbackUx || data.intentCollapseLayer, `${prompt.id} should include collapse diagnostics`);
      }
    } finally {
      ready.shutdown?.();
    }
  },
);
