/**
 * Push SPOTIFY_CLIENT_ID/SECRET from local .env to GitHub repo secrets.
 * Never prints secret values.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function setSecret(name, value) {
  const r = spawnSync("gh", ["secret", "set", name, "-R", "koalablade/Kwalify", "-b", value], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return r.status === 0;
}

const env = loadEnv();
const id = env.SPOTIFY_CLIENT_ID ?? process.env.SPOTIFY_CLIENT_ID;
const secret = env.SPOTIFY_CLIENT_SECRET ?? process.env.SPOTIFY_CLIENT_SECRET;
const results = {
  clientId: id ? setSecret("SPOTIFY_CLIENT_ID", id) : false,
  clientSecret: secret ? setSecret("SPOTIFY_CLIENT_SECRET", secret) : false,
};
console.log(JSON.stringify({ updated: results, hint: !id || !secret ? "Set SPOTIFY_CLIENT_ID/SECRET in .env first" : undefined }));
