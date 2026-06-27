/**
 * One-off validation runner — NOT part of build. Evidence only.
 * Usage: node scripts/15-prompt-post-deploy-validation.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveVerifiedProductionCredentials } = require("../backend/dist/lib/benchmark-env");
const { normalizeEvalToken } = require("../backend/dist/lib/eval-token-normalize");
const { readLocalDotEnvValue } = require("../backend/dist/lib/benchmark-env-dotenv");

function authCookie() {
  const raw =
    process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim()
    || process.env.COOKIE_VALUE?.trim()
    || readLocalDotEnvValue("PLAYLIST_BENCHMARK_AUTH_COOKIE")
    || readLocalDotEnvValue("COOKIE_VALUE");
  if (!raw) return null;
  if (raw.includes("=")) return raw;
  return `connect.sid=${raw}`;
}

const SEEDS = [1, 2, 3];
const PROMPTS = [
  { id: "summer_morning", prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work." },
  { id: "rainy_walk", prompt: "rainy city morning walk with reflective mood" },
  { id: "cozy_sunday", prompt: "soft happy Sunday afternoon with light emotional warmth" },
  { id: "late_night", prompt: "late night feeling" },
  { id: "sunset_drive", prompt: "driving at sunset with open windows and golden light" },
  { id: "optimistic_commute", prompt: "optimistic commute to work with forward energy" },
  { id: "study_session", prompt: "music for thinking and study session focus" },
  { id: "gym_boost", prompt: "gym confidence boost high energy workout" },
  { id: "coffee_shop", prompt: "lazy Saturday coffee shop reading with indie folk vibes" },
  { id: "road_trip", prompt: "windows-down road trip singalong energy" },
  { id: "after_work", prompt: "after work decompression walk home calm but not sad" },
  { id: "party_pregame", prompt: "pregame playlist before going out with friends tonight" },
  { id: "melancholy_rain", prompt: "melancholy rainy afternoon staring out the window" },
  { id: "focus_coding", prompt: "deep focus coding session late evening electronic ambient" },
  { id: "morning_yoga", prompt: "gentle morning yoga stretch calm uplifting" },
];

function extractRun(data, httpStatus) {
  const trace = data.playlistExecutionTrace ?? {};
  const gate = data.humanSaveabilityGate ?? {};
  const intent = data.intentCollapseLayer ?? trace.intentCollapseLayer ?? null;
  const counts = trace.trackCounts ?? {};
  const stage = trace.stageAttribution ?? {};
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const samplerRan = stage.sampler?.status === "completed" || (counts.after_sampler ?? 0) > 0;
  const gateExecuted = trace.debugFlags?.gateExecuted === true || gate.humanSaveable != null;
  return {
    httpStatus,
    executionPath: trace.executionPath ?? null,
    editorialWorldTag: intent?.editorialWorldTag ?? null,
    intentCollapseLayer: intent,
    retrievalCount: counts.retrieved ?? intent?.preFilterCount ?? null,
    postFilterCount: intent?.postFilterCount ?? null,
    samplerCount: counts.after_sampler ?? null,
    samplerExecuted: samplerRan,
    gateResult: {
      executed: gateExecuted,
      humanSaveable: trace.humanSaveable === true || gate.humanSaveable === true,
      bypassed: trace.debugFlags?.gateBypassed === true,
      bypassReason: trace.rejectionReasons?.find((r) => r.includes("timeout_fallback")) ?? null,
    },
    curatorScore: trace.curatorScore ?? gate.curatorScore ?? null,
    firstTen: tracks.slice(0, 10).map((t) =>
      `${t.artistName ?? t.artist ?? "?"} — ${t.trackName ?? t.name ?? "?"}`,
    ),
    rejectionReasons: trace.rejectionReasons ?? [],
    error: data.error ?? data.message ?? null,
    trackCount: tracks.length,
    spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? data.playlistUrl ?? null,
    funnelCollapseStage: trace.funnelCollapseStage ?? null,
    stageAttribution: stage,
  };
}

async function main() {
  const creds = await resolveVerifiedProductionCredentials({ strict: true });
  const token = normalizeEvalToken(creds.token);
  const cookie = authCookie();
  const useLiveAuth = !!cookie;
  if (useLiveAuth) {
    const meRes = await fetch(`${creds.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    const me = await meRes.json();
    if (!meRes.ok) throw new Error(`Auth preflight failed (${meRes.status}): ${me.error ?? me.message ?? meRes.statusText}`);
    process.stderr.write(`[15-prompt] live auth as ${me.id ?? me.spotifyUserId ?? "unknown"}\n`);
  } else {
    process.stderr.write("[15-prompt] audit mode (no COOKIE_VALUE)\n");
  }
  const ping = await fetch(`${creds.baseUrl}/api/eval/ping`, {
    method: "POST",
    headers: { "x-kwalify-evaluation-token": token },
  });
  const pingData = await ping.json();
  const runs = [];
  for (const p of PROMPTS) {
    for (const seed of SEEDS) {
      const started = Date.now();
      let httpStatus = 0;
      let data = {};
      try {
        const url = useLiveAuth ? `${creds.baseUrl}/api/generate` : `${creds.baseUrl}/api/generate?audit=1`;
        const headers = useLiveAuth
          ? { "Content-Type": "application/json", Cookie: cookie }
          : { "Content-Type": "application/json", "x-kwalify-evaluation-token": token };
        const body = useLiveAuth
          ? { vibe: p.prompt, mode: "balanced", length: 25, varietyBoost: true, seed, requestId: `post-deploy-15x3-${p.id}-seed-${seed}` }
          : {
            vibe: p.prompt,
            mode: "balanced",
            length: 25,
            spotifyUserId: creds.spotifyUserId,
            seed,
            auditMode: true,
            requestId: `post-deploy-15x3-${p.id}-seed-${seed}`,
          };
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        httpStatus = res.status;
        data = await res.json();
      } catch (err) {
        data = { error: String(err) };
      }
      runs.push({
        promptId: p.id,
        prompt: p.prompt,
        seed,
        durationMs: Date.now() - started,
        ...extractRun(data, httpStatus),
      });
      const spotify = runs.at(-1).spotifyPlaylistUrl ? " spotify=1" : "";
      process.stderr.write(`${p.id} seed ${seed} → ${httpStatus} tracks=${runs.at(-1).trackCount}${spotify}\n`);
    }
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    productionCommit: pingData.commit ?? null,
    baseUrl: creds.baseUrl,
    mode: useLiveAuth ? "live-auth" : "audit",
    promptCount: PROMPTS.length,
    seedsPerPrompt: SEEDS.length,
    totalRuns: runs.length,
    runs,
    summary: {
      http200: runs.filter((r) => r.httpStatus === 200).length,
      http422: runs.filter((r) => r.httpStatus === 422).length,
      withTracks: runs.filter((r) => r.trackCount >= 20).length,
      samplerExecuted: runs.filter((r) => r.samplerExecuted).length,
      gateExecuted: runs.filter((r) => r.gateResult.executed).length,
      humanSaveable: runs.filter((r) => r.gateResult.humanSaveable).length,
      insufficientIntentPool: runs.filter((r) =>
        r.error?.includes("insufficient_intent_pool") ||
        r.rejectionReasons.some((x) => x.includes("insufficient_intent_pool")),
      ).length,
      alignmentFailures: runs.filter((r) => r.error?.includes("incompatible_with")).length,
      timeoutFallback: runs.filter((r) => r.executionPath === "timeout_fallback").length,
      withSpotifyPlaylist: runs.filter((r) => r.spotifyPlaylistUrl).length,
      avgCuratorScore: (() => {
        const scores = runs.map((r) => r.curatorScore).filter((s) => typeof s === "number" && Number.isFinite(s));
        return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      })(),
    },
  };
  const out = path.resolve("reports/15-prompt-post-deploy-validation.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ out, summary: payload.summary, commit: payload.productionCommit }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
