/**
 * Re-probe thin-world prompts after hard-lock intent-collapse bridge.
 *
 *   node scripts/empty-world-recheck.mjs --base-url http://127.0.0.1:5000
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PROBES = [
  { id: "grunge_90s", prompt: "90s grunge dark cloudy night", length: 30 },
  { id: "goth_danceable", prompt: "goth but danceable late night drive", length: 30 },
  { id: "post_punk", prompt: "post punk cold city night walk", length: 30 },
  { id: "lofi_study", prompt: "lofi but not boring study session", length: 30 },
  { id: "rave_comedown", prompt: "rave comedown bus home", length: 30 },
  { id: "sleepy_gym", prompt: "sleepy gym workout chill energy", length: 30 },
  { id: "boss_fight", prompt: "boss fight but emotional soundtrack", length: 30 },
];

const CONTAMINANTS = [
  /\bblondie\b/i,
  /\bfleetwood\s+mac\b/i,
  /(?<!\bstorm\s)\bqueen\b(?!\s+of\s+the\s+stone)/i,
  /\bled\s+zeppelin\b/i,
  /\bjourney\b/i,
  /\bbee\s+gees\b/i,
  /\bmen\s+at\s+work\b/i,
];

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
}

async function fetchJson(url, init, timeoutMs = 180_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text.startsWith("{") ? JSON.parse(text) : { message: text.slice(0, 300) };
    } catch {
      data = { message: text.slice(0, 300) };
    }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

function artistName(track) {
  return String(track.artistName ?? track.artist ?? "").trim();
}

function trackName(track) {
  return String(track.trackName ?? track.name ?? "").trim();
}

async function main() {
  const args = process.argv.slice(2);
  const baseUrl = (argValue(args, "--base-url") ?? "http://127.0.0.1:5000").replace(/\/+$/, "");
  const delayMs = Number(argValue(args, "--delay-ms") ?? 8000);
  const stamp = Date.now();
  const outDir =
    argValue(args, "--out") ??
    path.join("reports", "live-spotify-verify", `empty-world-recheck-${stamp}`);

  let authCookie = process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim() || "";
  if (!authCookie && existsSync(".tmp-live-auth-cookie.txt")) {
    authCookie = readFileSync(".tmp-live-auth-cookie.txt", "utf8").trim();
  }
  if (!authCookie) throw new Error("Missing auth cookie (.tmp-live-auth-cookie.txt)");

  await mkdir(outDir, { recursive: true });
  const me = await fetchJson(`${baseUrl}/api/auth/me`, { headers: { Cookie: authCookie } }, 30_000);
  if (!me.response.ok) throw new Error(`Auth failed ${me.response.status}`);
  const ready = await fetchJson(`${baseUrl}/api/readyz`, {}, 15_000);
  console.log(`[recheck] user=${me.data.id ?? me.data.spotifyUserId} commit=${ready.data?.commit ?? "?"}`);

  const results = [];
  for (const probe of PROBES) {
    console.log(`\n[recheck] ${probe.id}: ${probe.prompt}`);
    const started = Date.now();
    const { response, data } = await fetchJson(
      `${baseUrl}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: authCookie },
        body: JSON.stringify({
          vibe: probe.prompt,
          mode: "balanced",
          length: probe.length,
          varietyBoost: true,
        }),
      },
      180_000,
    );
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    const artists = tracks.map(artistName);
    const contaminants = artists.filter((a) => CONTAMINANTS.some((re) => re.test(a)));
    const hqg = data.humanQualityGate ?? null;
    const error = data.error ?? data.message ?? null;
    const honestPartial = data.honestPartialPublished === true || hqg?.action === "honest_partial";
    const honestRefuse = response.status === 422 && (
      /insufficient_intent_pool/i.test(String(error ?? "")) ||
      hqg?.action === "refuse"
    );
    const row = {
      id: probe.id,
      prompt: probe.prompt,
      status: response.status,
      trackCount: tracks.length,
      ms: Date.now() - started,
      honestPartial,
      honestRefuse,
      clean: contaminants.length === 0,
      contaminants,
      humanQualityGate: hqg,
      supplyMessage: data.supplyMessage ?? null,
      playlistName: data.playlistName ?? null,
      spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? data.playlistUrl ?? null,
      error,
      artists,
      tracklist: tracks.map((t) => `${artistName(t)} — ${trackName(t)}`),
    };
    results.push(row);
    const verdict =
      row.status === 200 && row.trackCount >= 6 && row.clean ? "PASS_PARTIAL_OR_FULL"
      : row.status === 200 && row.trackCount >= 3 && row.clean ? "PARTIAL_OK"
      : row.honestRefuse ? "HONEST_REFUSE"
      : "FAIL";
    row.verdict = verdict;
    console.log(
      `[recheck] ${probe.id}: status=${row.status} n=${row.trackCount} clean=${row.clean} verdict=${verdict}` +
        (row.error ? ` err=${String(row.error).slice(0, 80)}` : "") +
        (hqg?.userMessage ? ` hqg=${String(hqg.userMessage).slice(0, 60)}` : ""),
    );
    if (contaminants.length) console.log(`  CONTAMINANTS: ${contaminants.join(", ")}`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const summary = {
    completedAt: new Date().toISOString(),
    baseUrl,
    commit: ready.data?.commit ?? null,
    pass: results.filter((r) => r.verdict === "PASS_PARTIAL_OR_FULL" || r.verdict === "PARTIAL_OK").length,
    honestRefuse: results.filter((r) => r.verdict === "HONEST_REFUSE").length,
    fail: results.filter((r) => r.verdict === "FAIL").length,
    results,
  };
  await writeFile(path.join(outDir, "recheck.json"), JSON.stringify(summary, null, 2));
  const md = [
    "# Empty world recheck",
    "",
    `Commit: \`${summary.commit ?? "?"}\``,
    `Pass (clean 3+): ${summary.pass}/${results.length}`,
    `Honest refuse: ${summary.honestRefuse}`,
    `Fail: ${summary.fail}`,
    "",
    "| Prompt | Status | Tracks | Verdict | Clean |",
    "| --- | ---: | ---: | --- | --- |",
    ...results.map((r) =>
      `| ${r.prompt} | ${r.status} | ${r.trackCount} | ${r.verdict} | ${r.clean ? "yes" : "no"} |`,
    ),
    "",
  ].join("\n");
  await writeFile(path.join(outDir, "RECHECK.md"), md);
  console.log(`\n[recheck] wrote ${outDir} pass=${summary.pass} refuse=${summary.honestRefuse} fail=${summary.fail}`);
  if (summary.fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
