/**
 * V41 tension prompt live probe — delivery count + energy profile.
 * Usage: npm run build && node backend/dist/scripts/v41-tension-probe.js --spawn-local
 */

import { ensureEvalReady } from "../lib/benchmark-local-server";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";

const PROMPTS = [
  { id: "sad-party-bangers", prompt: "sad party bangers", length: 25 },
  { id: "energetic-not-cheesy", prompt: "energetic but not cheesy", length: 25 },
  { id: "control-sunday", prompt: "cozy sunday morning coffee", length: 25 },
];

async function main(): Promise<void> {
  const spawnLocal = process.argv.includes("--spawn-local");
  process.env.PLAYLIST_CONTRACT_V41 = process.env.PLAYLIST_CONTRACT_V41 ?? "1";
  process.env.PLAYLIST_CONTRACT_V40 = process.env.PLAYLIST_CONTRACT_V40 ?? "1";

  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
  });
  const ready = await ensureEvalReady(
    creds.baseUrl,
    creds.token,
    spawnLocal,
    "node backend/dist/scripts/v41-tension-probe.js --spawn-local",
  );

  for (const fixture of PROMPTS) {
    const started = Date.now();
    const res = await fetch(`${ready.baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: fixture.prompt,
        mode: "balanced",
        length: fixture.length,
        spotifyUserId: creds.spotifyUserId,
        auditMode: true,
        allowDbWrites: false,
        allowSpotifyCreate: false,
      }),
      signal: AbortSignal.timeout(240_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const tracks = Array.isArray(data.tracks) ? (data.tracks as Array<Record<string, unknown>>) : [];
    const energies = tracks
      .map((t) => (typeof t.energy === "number" ? t.energy : null))
      .filter((e): e is number => e != null);
    const v41 = (data.playlistContractV41 ??
      (data.generationDiagnostics as Record<string, unknown> | undefined)?.playlistContractV41) as
      | Record<string, unknown>
      | undefined;
    const rebalance = v41?.rebalance as Record<string, unknown> | undefined;
    const funnel = (data.generationDiagnostics as Record<string, unknown> | undefined)?.deliveryLossFunnel as
      | Record<string, unknown>
      | undefined;

    console.log(JSON.stringify({
      id: fixture.id,
      prompt: fixture.prompt,
      ok: res.ok && tracks.length > 0,
      status: res.status,
      ms: Date.now() - started,
      trackCount: tracks.length,
      avgEnergy: energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : null,
      highEnergyShare: energies.length ? energies.filter((e) => e > 0.72).length / energies.length : null,
      lowEnergyShare: energies.length ? energies.filter((e) => e <= 0.55).length / energies.length : null,
      rebalance: rebalance ?? null,
      contractRebalanceApplied: v41?.contractRebalanceApplied ?? null,
      deliveryLossFunnel: funnel ?? null,
      sample: tracks.slice(0, 10).map((t) => ({
        artist: t.artistName ?? t.artist,
        title: t.trackName ?? t.name,
        energy: t.energy,
        valence: t.valence,
      })),
    }, null, 2));
  }

  ready.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
