/**
 * Upsert Spotify API credentials into .env (never prints secret values).
 * Usage: node scripts/ensure-spotify-env.mjs
 * Reads SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET from process.env.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
const KEYS = ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REDIRECT_URI"];

function upsert(key, value) {
  if (!value) return false;
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const filtered = lines.filter((l) => !l.trim().startsWith(`${key}=`));
  filtered.push(`${key}=${value}`);
  writeFileSync(ENV_PATH, filtered.join("\n").replace(/\n+$/, "") + "\n", "utf8");
  return true;
}

const redirect = process.env.SPOTIFY_REDIRECT_URI ?? "https://kwalify.net/api/auth/callback";
const updated = [
  upsert("SPOTIFY_CLIENT_ID", process.env.SPOTIFY_CLIENT_ID),
  upsert("SPOTIFY_CLIENT_SECRET", process.env.SPOTIFY_CLIENT_SECRET),
  upsert("SPOTIFY_REDIRECT_URI", redirect),
].filter(Boolean).length;

console.log(JSON.stringify({ envPath: ENV_PATH, keysUpdated: updated, hasClientId: !!process.env.SPOTIFY_CLIENT_ID, hasClientSecret: !!process.env.SPOTIFY_CLIENT_SECRET }));
