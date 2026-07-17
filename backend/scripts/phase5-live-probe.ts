/**
 * Focused live probe for Phase 5 retrieval-depth prompts.
 * Usage: node backend/dist/scripts/phase5-live-probe.js
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";

function readEnv(key: string): string | null {
  try {
    const line = readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : null;
  } catch {
    return null;
  }
}

const PROMPTS = [
  { id: "rave-comedown", prompt: "rave comedown bus home", length: 25 },
  { id: "after-holiday", prompt: "back home the day after a holiday ends", length: 25 },
  { id: "gym-control", prompt: "heavy lifting gym pump aggressive", length: 25 },
];

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials();
  const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:5000";
  const userId = process.env.SMOKE_SPOTIFY_USER_ID || readEnv("SMOKE_SPOTIFY_USER_ID") || "koalablade";
  const token = creds.token || readEnv("PLAYLIST_EVAL_TOKEN");
  if (!token) throw new Error("PLAYLIST_EVAL_TOKEN required");

  const results = [];
  for (const fixture of PROMPTS) {
    const started = Date.now();
    const response = await fetch(`${baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": token,
      },
      body: JSON.stringify({
        vibe: fixture.prompt,
        mode: "balanced",
        length: fixture.length,
        spotifyUserId: userId,
        auditMode: true,
        allowDbWrites: false,
        allowSpotifyCreate: false,
      }),
    });
    const raw = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      results.push({ id: fixture.id, ok: false, status: response.status, error: "non_json", ms: Date.now() - started });
      continue;
    }
    const tracks = Array.isArray(data.tracks) ? (data.tracks as Array<Record<string, unknown>>) : [];
    const energies = tracks
      .map((t) => (typeof t.energy === "number" ? t.energy : null))
      .filter((e): e is number => e != null);
    const avgE = energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : null;
    const highShare = energies.length ? energies.filter((e) => e > 0.72).length / energies.length : null;
    results.push({
      id: fixture.id,
      prompt: fixture.prompt,
      ok: response.ok && tracks.length > 0,
      status: response.status,
      trackCount: tracks.length,
      avgEnergy: avgE,
      highEnergyShare: highShare,
      softShare: energies.length ? energies.filter((e) => e <= 0.62).length / energies.length : null,
      sample: tracks.slice(0, 8).map((t) => ({
        artist: t.artistName ?? t.artist,
        title: t.trackName ?? t.name,
        energy: t.energy,
      })),
      ms: Date.now() - started,
    });
    console.log(
      `${fixture.id}: n=${tracks.length} avgE=${avgE?.toFixed(3)} soft<=0.62=${results[results.length - 1]!.softShare?.toFixed(2)} high>${0.72}=${highShare?.toFixed(2)} (${Date.now() - started}ms)`,
    );
  }

  const outDir = "reports/retrieval-depth";
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "phase5-live-probe.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`Wrote ${path.join(outDir, "phase5-live-probe.json")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
