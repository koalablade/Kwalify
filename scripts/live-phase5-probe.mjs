import { readFileSync, writeFileSync, mkdirSync } from "fs";

function env(key: string): string | null {
  const fromProcess = process.env[key];
  if (fromProcess) return fromProcess;
  const line = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : null;
}

async function main() {
  const token = env("PLAYLIST_EVAL_TOKEN") || env("EVAL_TOKEN");
  const userId = env("SMOKE_SPOTIFY_USER_ID") || "koalablade";
  if (!token) throw new Error("PLAYLIST_EVAL_TOKEN missing");

  const prompts = [
    "rave comedown bus home",
    "heavy lifting gym pump aggressive",
    "back home the day after a holiday ends",
  ];

  const results = [];
  for (const vibe of prompts) {
    const res = await fetch("http://127.0.0.1:5000/api/generate?audit=1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eval-token": token,
        "x-spotify-user-id": userId,
      },
      body: JSON.stringify({ vibe, length: 20, mode: "liked", spotifyUserId: userId }),
    });
    const body = await res.json().catch(() => ({}));
    const tracks = Array.isArray(body.tracks) ? body.tracks : [];
    const energies = tracks.map((t: any) => t.energy).filter((e: any) => typeof e === "number");
    const avg = energies.length ? energies.reduce((a: number, b: number) => a + b, 0) / energies.length : null;
    const row = {
      prompt: vibe,
      status: res.status,
      count: tracks.length,
      avgEnergy: avg == null ? null : Number(avg.toFixed(3)),
      highEnergyCount: energies.filter((e: number) => e > 0.72).length,
      sample: tracks.slice(0, 10).map((t: any) => ({
        artist: t.artist ?? t.artistName,
        title: t.name ?? t.trackName,
        energy: t.energy,
      })),
      error: body.error ?? body.message ?? null,
    };
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  }
  mkdirSync("reports/retrieval-depth", { recursive: true });
  writeFileSync("reports/retrieval-depth/live-phase5-probes.json", JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
