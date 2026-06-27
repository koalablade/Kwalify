/** Print Spotify OAuth authorize URL (opens browser on Windows). */
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
const env = {};
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const clientId = env.SPOTIFY_CLIENT_ID ?? process.env.SPOTIFY_CLIENT_ID;
const redirectUri = env.SPOTIFY_REDIRECT_URI ?? "https://kwalify.net/api/auth/callback";
if (!clientId) {
  console.error("SPOTIFY_CLIENT_ID missing in .env");
  process.exit(1);
}
const url = new URL("https://accounts.spotify.com/authorize");
url.searchParams.set("client_id", clientId);
url.searchParams.set("response_type", "code");
url.searchParams.set("redirect_uri", redirectUri);
url.searchParams.set("scope", ["playlist-read-private", "playlist-read-collaborative", "user-library-read"].join(" "));
url.searchParams.set("show_dialog", "true");
const link = url.toString();
console.log(link);
if (process.platform === "win32") {
  spawn("cmd", ["/c", "start", "", link], { detached: true, stdio: "ignore" }).unref();
}
