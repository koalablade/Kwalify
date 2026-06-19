/**
 * Live coherence regression against real /api/generate (Spotify audit mode).
 *
 * Requires benchmark env (see docs/benchmark-environment.md).
 * CI injects secrets via .github/actions/benchmark-env.
 */

import {
  isCiEnvironment,
  resolveLiveBenchmarkCredentials,
} from "../lib/benchmark-env";

type Fixture = {
  id: string;
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  minCoherence: number;
  minTracks: number;
};

const FIXTURES: Fixture[] = [
  {
    id: "volvo-garage-live",
    prompt: "music for working on my volvo in the garage late at night rainy sunday",
    mode: "balanced",
    minCoherence: 0.52,
    minTracks: 12,
  },
  {
    id: "kerrang-alt-live",
    prompt: "kerrang era alt rock and emo from my teenage years",
    mode: "strict",
    minCoherence: 0.55,
    minTracks: 12,
  },
];

async function main(): Promise<void> {
  let creds;
  try {
    creds = resolveLiveBenchmarkCredentials({ strict: isCiEnvironment() });
  } catch (err) {
    if (isCiEnvironment()) throw err;
    process.stdout.write(`${JSON.stringify({
      pass: true,
      skipped: true,
      reason: err instanceof Error ? err.message : String(err),
    }, null, 2)}\n`);
    return;
  }

  const origin = creds.baseUrl;
  const results = [];

  for (const fixture of FIXTURES) {
    const response = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: fixture.prompt,
        mode: fixture.mode,
        length: 20,
        spotifyUserId: creds.spotifyUserId,
        auditMode: true,
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    const tracks = Array.isArray(data["tracks"]) ? data["tracks"] : [];
    const diagnostics = (data["generationDiagnostics"] ?? data["pipelineDiagnostics"] ?? {}) as Record<string, unknown>;
    const coherence = (diagnostics["coherenceScore"] ?? data["coherenceScore"]) as Record<string, unknown> | null;
    const overall = typeof coherence?.["overallScore"] === "number" ? coherence["overallScore"] : null;

    const pass = response.ok &&
      tracks.length >= fixture.minTracks &&
      overall !== null &&
      overall >= fixture.minCoherence;

    results.push({
      id: fixture.id,
      pass,
      status: response.status,
      trackCount: tracks.length,
      overallCoherence: overall,
      minCoherence: fixture.minCoherence,
      code: data["code"] ?? null,
    });
  }

  const failed = results.filter((row) => !row.pass);
  process.stdout.write(`${JSON.stringify({ pass: failed.length === 0, origin, results }, null, 2)}\n`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});