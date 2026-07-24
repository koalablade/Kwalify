/**
 * Probe highest-ROI failing prompts after real-playlist-aligned fixes.
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { analyzeVibe } from "../lib/emotion";
import { buildLockedIntent } from "../core/v3/intent";
import { resolveHumanScene } from "../lib/human-scene-knowledge";
import { detectSubSceneRetrievalKind } from "../core/v3/subscene-retrieval";

const PROMPTS = [
  { id: "focus-ambient-morning", prompt: "calm ambient morning focus coding", length: 25 },
  { id: "focus-soft-electronic", prompt: "soft electronic concentration", length: 25 },
  { id: "party-70s-disco", prompt: "70s disco party dancefloor", length: 30 },
  { id: "party-latin-summer", prompt: "latin summer beach party", length: 30 },
  { id: "gym-heavy-lifting", prompt: "heavy lifting gym pump aggressive", length: 30 },
  { id: "focus-coding", prompt: "calm coding focus", length: 30 },
];

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

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials();
  const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:5000";
  const userId = process.env.SMOKE_SPOTIFY_USER_ID || readEnv("SMOKE_SPOTIFY_USER_ID") || "koalablade";
  const token = creds.token || readEnv("PLAYLIST_EVAL_TOKEN");
  if (!token) throw new Error("PLAYLIST_EVAL_TOKEN required");

  const results = [];
  for (const fixture of PROMPTS) {
    const locked = buildLockedIntent(fixture.prompt);
    const human = resolveHumanScene(fixture.prompt);
    const profile = analyzeVibe(fixture.prompt);
    const sub = detectSubSceneRetrievalKind(fixture.prompt, locked);
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
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const tracks = Array.isArray(data.tracks) ? (data.tracks as Array<Record<string, unknown>>) : [];
    const energies = tracks
      .map((t) => (typeof t.energy === "number" ? t.energy : null))
      .filter((e): e is number => e != null);
    const avgE = energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : null;
    const overfill = tracks.length > fixture.length;
    results.push({
      id: fixture.id,
      prompt: fixture.prompt,
      asked: fixture.length,
      n: tracks.length,
      overfill,
      avgEnergy: avgE,
      highShare: energies.length ? energies.filter((e) => e > 0.72).length / energies.length : null,
      softShare: energies.length ? energies.filter((e) => e <= 0.52).length / energies.length : null,
      interpretation: {
        humanScene: human.primary?.id ?? null,
        behaviour: human.musicalBehaviour,
        lockedEnergy: locked.energy,
        genres: locked.genreFamilies,
        profileEnergy: profile.energy,
        subScene: sub,
      },
      sample: tracks.slice(0, 8).map((t) => ({
        artist: t.artistName ?? t.artist,
        title: t.trackName ?? t.name,
        energy: t.energy,
      })),
      ms: Date.now() - started,
    });
    console.log(
      `${fixture.id}: n=${tracks.length}/${fixture.length} overfill=${overfill} avgE=${avgE?.toFixed(3)} soft<=0.52=${results[results.length - 1]!.softShare?.toFixed(2)} sub=${sub}`,
    );
  }

  const outDir = "reports/retrieval-depth";
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "roi-fix-probe.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`Wrote ${path.join(outDir, "roi-fix-probe.json")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
