/**
 * Re-run only the four empty spotcheck prompts against a live local API.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { evalPingOk, healthOk } from "../lib/benchmark-local-server";
import { inferWorldIdentityIdsFromPrompt } from "../core/editorial/world-identity-gate";

const PROMPTS = [
  { id: "rainy-highway", prompt: "rainy highway night drive", length: 25, mode: "strict" as const },
  { id: "cozy-rainy", prompt: "cozy rainy night chill", length: 25, mode: "balanced" as const },
  { id: "deep-focus", prompt: "deep focus study session no distractions", length: 25, mode: "balanced" as const },
  { id: "90s-neon", prompt: "90s neon night drive", length: 25, mode: "strict" as const },
];

const SKIP =
  /\b(?:queen\b(?!\s+of\s+the\s+stone)|blondie|fleetwood\s+mac|led\s+zeppelin|highwaymen|johnny\s+cash|dmx\b|storm\s+queen|olivia\s+rodrigo|taylor\s+swift|billie\s+eilish|french\s+montana|tekkno|black\s+sabbath|craig\s+david)\b/i;

async function main() {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: "http://127.0.0.1:5000",
    cli: { baseUrl: "http://127.0.0.1:5000" },
  });
  const baseUrl = creds.baseUrl;
  if (!(await healthOk(baseUrl))) throw new Error(`API not healthy at ${baseUrl}`);
  const ping = await evalPingOk(baseUrl, creds.token);
  if (!ping.ok) throw new Error(`Eval token rejected: ${ping.reason}`);
  console.log(`[rerun] ready ${baseUrl} user=${creds.spotifyUserId}`);

  const results = [];
  for (const fixture of PROMPTS) {
    // Avoid session supersede collisions between sequential generates.
    await new Promise((r) => setTimeout(r, 2500));
    const started = Date.now();
    const response = await fetch(`${baseUrl}/api/generate?audit=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kwalify-evaluation-token": creds.token,
      },
      body: JSON.stringify({
        vibe: fixture.prompt,
        mode: fixture.mode,
        length: fixture.length,
        spotifyUserId: creds.spotifyUserId,
        auditMode: true,
        allowDbWrites: false,
        allowSpotifyCreate: false,
        evaluationPromptId: `rerun-${fixture.id}`,
        evaluationCategory: "human_skip_spotcheck_rerun",
        evaluationTimeoutMs: 240_000,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const tracks = Array.isArray(data.tracks)
      ? (data.tracks as Array<Record<string, unknown>>).map((t) => ({
          artist: String(t.artistName ?? t.artist ?? "?"),
          title: String(t.trackName ?? t.name ?? "?"),
          genreFamily: typeof t.genreFamily === "string" ? t.genreFamily : null,
        }))
      : [];
    const skipHits = tracks.filter((t) => SKIP.test(`${t.artist} ${t.title}`));
    const row = {
      id: fixture.id,
      prompt: fixture.prompt,
      httpStatus: response.status,
      ms: Date.now() - started,
      worlds: inferWorldIdentityIdsFromPrompt(fixture.prompt),
      n: tracks.length,
      skipHits: skipHits.map((t) => `${t.artist} — ${t.title}`),
      message: data.message ?? data.userMessage ?? data.error ?? null,
      humanQualityGate: data.humanQualityGate ?? null,
      tracks: tracks.slice(0, 20),
    };
    results.push(row);
    console.log(
      `\n=== ${fixture.id} http=${response.status} n=${tracks.length} skips=${skipHits.length} (${row.ms}ms) ===`,
    );
    if (row.message) console.log(`  message: ${String(row.message).slice(0, 240)}`);
    for (const [i, t] of tracks.slice(0, 12).entries()) {
      const flag = SKIP.test(`${t.artist} ${t.title}`) ? " SKIP" : "";
      console.log(`  ${i + 1}. ${t.artist} — ${t.title}${t.genreFamily ? ` [${t.genreFamily}]` : ""}${flag}`);
    }
  }

  const outDir = path.join("reports", "playlist-evaluation", "spotcheck-human-skip");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "rerun-empty.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`\nWrote ${path.join(outDir, "rerun-empty.json")}`);
  const anySkips = results.some((r) => r.skipHits.length > 0);
  const anyEmpty = results.some((r) => r.n === 0);
  console.log(`SUMMARY: empty=${results.filter((r) => r.n === 0).length}/4 skips=${results.reduce((a, r) => a + r.skipHits.length, 0)}`);
  if (anySkips) process.exitCode = 2;
  else if (anyEmpty) process.exitCode = 3;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
