/**
 * Live deployment smoke — runs only when KWALIFY_LIVE_URL is set.
 *
 * Example (after Start Kwalify):
 *   set KWALIFY_LIVE_URL=https://kwalify.net
 *   npm run test:production-health
 *
 * Does not perform authenticated Spotify OAuth (requires human/browser).
 */

import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = (process.env.KWALIFY_LIVE_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");

test("production health smoke", { skip: !baseUrl }, async (t) => {
  await t.test("livez returns ok", async () => {
    const res = await fetch(`${baseUrl}/api/livez`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status?: string };
    assert.equal(body.status, "ok");
  });

  await t.test("readyz is ready", async () => {
    const res = await fetch(`${baseUrl}/api/readyz`, { signal: AbortSignal.timeout(15_000) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status?: string; readiness?: string; checks?: { databaseAvailable?: boolean } };
    const ready = body.status === "ready" || body.readiness === "ready";
    assert.ok(ready, `expected ready, got ${JSON.stringify(body)}`);
    assert.equal(body.checks?.databaseAvailable, true);
  });

  await t.test("ops summary returns aggregates", async () => {
    const res = await fetch(`${baseUrl}/api/ops/summary`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { generations?: { active?: number } };
    assert.ok(body.generations, "expected generations block");
  });

  await t.test("auth login redirects to Spotify", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(res.status, 302);
    const location = res.headers.get("location") ?? "";
    assert.match(location, /accounts\.spotify\.com/i, `unexpected redirect: ${location}`);
  });
});
