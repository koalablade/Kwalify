/**
 * Focused live probe for world-contamination failures from human listening.
 *
 *   $env:PLAYLIST_BENCHMARK_AUTH_COOKIE = (Get-Content .tmp-live-auth-cookie.txt -Raw).Trim()
 *   node scripts/live-world-purity-probe.mjs --base-url http://127.0.0.1:5000
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import signature from "cookie-signature";

const CONTAMINANTS = [
  { id: "blondie", re: /\bblondie\b/i },
  { id: "fleetwood_mac", re: /\bfleetwood\s+mac\b/i },
  { id: "queen", re: /(?<!\bstorm\s)\bqueen\b(?!\s+of\s+the\s+stone)/i },
  { id: "led_zeppelin", re: /\bled\s+zeppelin\b/i },
  { id: "men_at_work", re: /\bmen\s+at\s+work\b/i },
  { id: "storm_queen", re: /\bstorm\s+queen\b/i },
  { id: "mexican_institute", re: /\bmexican\s+institute\b/i },
  { id: "journey", re: /\bjourney\b/i },
  { id: "bee_gees", re: /\bbee\s+gees\b/i },
];

const PROBES = [
  {
    id: "grunge_90s",
    prompt: "90s grunge dark cloudy night",
    length: 25,
    ban: ["blondie", "fleetwood_mac", "queen", "led_zeppelin", "men_at_work", "journey"],
    keepHint: ["offspring", "green day", "nirvana", "pearl jam", "soundgarden", "alice in chains", "foo fighters"],
  },
  {
    id: "goth_danceable",
    prompt: "goth but danceable",
    length: 25,
    ban: ["blondie", "fleetwood_mac", "queen", "led_zeppelin", "men_at_work"],
    keepHint: ["cure", "siouxsie", "depeche", "joy division", "new order", "bauhaus"],
  },
  {
    id: "gym_rock",
    prompt: "gym rock",
    length: 25,
    ban: ["blondie", "fleetwood_mac", "queen", "led_zeppelin", "storm_queen", "mexican_institute", "bee_gees"],
    keepHint: ["ac/dc", "metallica", "foo fighters", "offspring", "green day", "disturbed"],
  },
  {
    id: "angry_rock_workout",
    prompt: "angry rock workout",
    length: 25,
    ban: ["blondie", "fleetwood_mac", "queen", "led_zeppelin", "storm_queen", "bee_gees", "men_at_work"],
    keepHint: ["rage against", "metallica", "slipknot", "foo fighters", "system of a down", "offspring", "ac/dc"],
  },
];

function loadEnv() {
  const out = {};
  if (!existsSync(".env")) return out;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function mintCookieFromDb() {
  const env = loadEnv();
  const secret = env.SESSION_SECRET;
  if (!secret || !env.DATABASE_URL) throw new Error("SESSION_SECRET / DATABASE_URL required to mint cookie");
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  const rows = await c.query(
    `select sid, sess from session
     where sess::text like '%spotifyTokens%'
     order by expire desc nulls last
     limit 1`,
  );
  await c.end();
  if (!rows.rows.length) throw new Error("No session with Spotify tokens in DB");
  const sid = rows.rows[0].sid;
  const cookie = `connect.sid=${encodeURIComponent("s:" + signature.sign(sid, secret))}`;
  writeFileSync(".tmp-live-auth-cookie.txt", cookie, "utf8");
  return cookie;
}

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
      data = text.startsWith("{") ? JSON.parse(text) : { message: text.slice(0, 200) };
    } catch {
      data = { message: text.slice(0, 200) };
    }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

function artistHits(artists, ids) {
  const hits = [];
  for (const artist of artists) {
    for (const c of CONTAMINANTS) {
      if (!ids.includes(c.id)) continue;
      if (c.re.test(artist)) hits.push({ artist, contaminant: c.id });
    }
  }
  return hits;
}

async function main() {
  const args = process.argv.slice(2);
  const baseUrl = (argValue(args, "--base-url") ?? "http://127.0.0.1:5000").replace(/\/+$/, "");
  const outDir =
    argValue(args, "--out") ??
    path.join("reports", "live-spotify-verify", "world-purity-probe");
  const delayMs = Number(argValue(args, "--delay-ms") ?? 4000);

  let authCookie = process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim() || "";
  if (!authCookie && existsSync(".tmp-live-auth-cookie.txt")) {
    authCookie = readFileSync(".tmp-live-auth-cookie.txt", "utf8").trim();
  }
  if (!authCookie) authCookie = await mintCookieFromDb();

  await mkdir(outDir, { recursive: true });
  const me = await fetchJson(`${baseUrl}/api/auth/me`, { headers: { Cookie: authCookie } }, 30_000);
  if (!me.response.ok) throw new Error(`Auth failed ${me.response.status}`);
  const ready = await fetchJson(`${baseUrl}/api/readyz`, {}, 15_000);
  console.log(`[purity] user=${me.data.id ?? me.data.spotifyUserId} commit=${ready.data?.commit ?? "?"}`);

  const results = [];
  for (const probe of PROBES) {
    console.log(`\n[purity] ${probe.id}: ${probe.prompt}`);
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
    const artists = tracks.map((t) => String(t.artistName ?? t.artist ?? "").trim());
    const trackIds = tracks.map((t) => t.trackId ?? t.id).filter(Boolean);
    const bannedHits = artistHits(artists, probe.ban ?? []);
    const keepHits = (probe.keepHint ?? []).filter((hint) =>
      artists.some((a) => a.toLowerCase().includes(hint.toLowerCase())),
    );
    const honestRefuse = response.status === 422 && /insufficient_intent_pool/i.test(String(data.error ?? data.message ?? ""));
    const row = {
      id: probe.id,
      prompt: probe.prompt,
      okHttp: (response.ok && data.success !== false) || honestRefuse,
      status: response.status,
      trackCount: tracks.length,
      trackIds,
      ms: Date.now() - started,
      playlistName: data.playlistName ?? null,
      spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? data.playlistUrl ?? null,
      supplyMessage: data.supplyMessage ?? null,
      honestPartial: data.honestPartialPublished ?? false,
      honestRefuse,
      humanQualityGate: data.humanQualityGate ?? null,
      bannedHits,
      keepHits,
      purityPass: bannedHits.length === 0,
      artists,
      tracklist: tracks.map((t) => `${t.artistName ?? t.artist ?? "?"} — ${t.trackName ?? t.name ?? "?"}`),
      error: data.error ?? data.message ?? null,
    };
    results.push(row);
    console.log(
      `[purity] ${probe.id}: status=${row.status} n=${row.trackCount} purity=${row.purityPass ? "PASS" : "FAIL"} ` +
        `bans=${bannedHits.map((h) => h.contaminant).join(",") || "none"} keep=${keepHits.join(",") || "—"}`,
    );
    if (bannedHits.length) {
      for (const h of bannedHits) console.log(`  CONTAMINANT: ${h.artist} (${h.contaminant})`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const summary = {
    completedAt: new Date().toISOString(),
    baseUrl,
    commit: ready.data?.commit ?? null,
    pass: results.filter((r) => r.purityPass && r.okHttp).length,
    fail: results.filter((r) => !r.purityPass || !r.okHttp).length,
    results,
  };
  await writeFile(path.join(outDir, "purity-probe.json"), JSON.stringify(summary, null, 2));
  const md = [
    `# World purity probe`,
    ``,
    `Commit: \`${summary.commit ?? "?"}\``,
    `Pass: ${summary.pass}/${results.length}`,
    ``,
    ...results.map((r) => {
      const status = r.purityPass && r.okHttp ? "PASS" : "FAIL";
      return [
        `## ${r.id} — ${status}`,
        ``,
        `- Prompt: ${r.prompt}`,
        `- Tracks: ${r.trackCount}`,
        `- Contaminants: ${r.bannedHits.map((h) => h.artist).join(", ") || "none"}`,
        `- World anchors seen: ${r.keepHits.join(", ") || "—"}`,
        `- Playlist: ${r.spotifyPlaylistUrl ?? r.playlistName ?? "—"}`,
        ``,
        ...r.tracklist.map((line) => `- ${line}`),
        ``,
      ].join("\n");
    }),
  ].join("\n");
  await writeFile(path.join(outDir, "PURITY-PROBE.md"), md);
  console.log(`\n[purity] wrote ${outDir} pass=${summary.pass}/${results.length}`);
  if (summary.fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
