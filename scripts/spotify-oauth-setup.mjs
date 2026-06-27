/**
 * One-time Spotify user OAuth for playlist genome collection.
 * Client-credentials cannot read playlist tracks in Development mode (401/403).
 *
 *   npm run spotify:oauth-setup
 *   # Open URL, approve, paste ?code=... from redirect URL
 *   npm run corpus:collect-genome
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function upsertEnv(key, value) {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const filtered = lines.filter((l) => !l.trim().startsWith(`${key}=`));
  filtered.push(`${key}=${value}`);
  writeFileSync(ENV_PATH, filtered.filter((l, i, a) => l.length > 0 || i === a.length - 1).join("\n") + "\n", "utf8");
}

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const env = loadEnv();
  const clientId = env.SPOTIFY_CLIENT_ID ?? process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET ?? process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = env.SPOTIFY_REDIRECT_URI ?? "https://kwalify.net/api/auth/callback";

  if (!clientId || !clientSecret) {
    console.error("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let code = args.find((a) => a.startsWith("--code="))?.slice(7);
  if (!code) {
    const scope = [
      "playlist-read-private",
      "playlist-read-collaborative",
      "user-library-read",
    ].join(" ");
    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scope);
    url.searchParams.set("show_dialog", "true");

    console.log("\n1. Open this URL in a browser and log in:\n");
    console.log(url.toString());
    console.log("\n2. After redirect, copy the full URL (or just the code= value).\n");
    const pasted = await prompt("Paste redirect URL or code: ");
    const match = pasted.match(/[?&]code=([^&]+)/);
    code = match ? decodeURIComponent(match[1]) : pasted;
  }

  if (!code) {
    console.error("No authorization code provided.");
    process.exit(1);
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Token exchange failed:", data);
    process.exit(1);
  }

  if (!data.refresh_token) {
    console.error("No refresh_token returned. Revoke app access at spotify.com/account/apps and retry.");
    process.exit(1);
  }

  upsertEnv("SPOTIFY_REFRESH_TOKEN", data.refresh_token);
  console.log("\nSaved SPOTIFY_REFRESH_TOKEN to .env");
  console.log("Run: npm run corpus:collect-genome");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
