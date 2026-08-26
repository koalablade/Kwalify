import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("loadLocalEnvFile fills unset keys from .env and leaves existing env alone", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kwalify-dotenv-"));
  writeFileSync(path.join(dir, "package.json"), "{\"name\":\"kwalify-dotenv-fixture\"}\n");
  writeFileSync(path.join(dir, ".env.example"), "DATABASE_URL=\n");
  writeFileSync(
    path.join(dir, ".env"),
    "DATABASE_URL=postgresql://from-file/db\nSESSION_SECRET=from-file-secret\nPORT=5000\nBIND_HOST=127.0.0.1\n",
  );

  const script = `
    process.chdir(${JSON.stringify(dir)});
    process.env.SESSION_SECRET = "already-set";
    process.env.DATABASE_URL = "";
    delete process.env.PORT;
    delete process.env.BIND_HOST;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    const { loadLocalEnvFile } = require(${JSON.stringify(path.resolve("backend/dist/lib/load-local-env.js"))});
    const result = loadLocalEnvFile();
    if (result.missing) process.exit(2);
    if (process.env.DATABASE_URL !== "") process.exit(3);
    if (process.env.SESSION_SECRET !== "already-set") process.exit(4);
    if (process.env.PORT !== "5000") process.exit(5);
    if (process.env.BIND_HOST !== "127.0.0.1") process.exit(6);
  `;

  const run = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
