import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

// Resolved against the COMPILED module (tests run from backend/dist/tests).
const libPath = path.join(__dirname, "..", "lib", "process-safety.js");
const libRequire = JSON.stringify(libPath);
const serverPath = path.join(__dirname, "..", "server.js");

function runNode(script: string, timeoutMs = 12_000): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env },
  });
}

test("unhandledRejection is logged but does NOT kill the process", () => {
  const script = `
    const { installProcessSafetyHandlers } = require(${libRequire});
    installProcessSafetyHandlers();
    Promise.reject(new Error("intentional-unhandled-rejection"));
    setTimeout(() => { console.log("SURVIVED"); process.exit(0); }, 400);
  `;
  const res = runNode(script);
  assert.equal(
    res.status,
    0,
    `expected process to survive (exit 0), got status=${res.status} signal=${res.signal}; stderr=${res.stderr}`,
  );
  assert.match(`${res.stdout}${res.stderr}`, /SURVIVED/);
});

test("uncaughtException remains fatal (exit 1)", () => {
  const script = `
    const { installProcessSafetyHandlers } = require(${libRequire});
    installProcessSafetyHandlers();
    setTimeout(() => { throw new Error("intentional-uncaught"); }, 50);
    setTimeout(() => { console.log("SHOULD-NOT-REACH"); process.exit(0); }, 700);
  `;
  const res = runNode(script);
  assert.equal(res.status, 1, `expected fatal exit 1, got status=${res.status} signal=${res.signal}`);
  assert.doesNotMatch(res.stdout, /SHOULD-NOT-REACH/);
});

test("fatal startup error (missing DATABASE_URL) exits non-zero", () => {
  const res = spawnSync(process.execPath, [serverPath], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, DATABASE_URL: "", SESSION_SECRET: "", NODE_ENV: "production", PORT: "0" },
  });
  assert.notEqual(
    res.status,
    0,
    `expected non-zero exit for fatal boot error, got status=${res.status} signal=${res.signal}; stdout=${res.stdout} stderr=${res.stderr}`,
  );
});
