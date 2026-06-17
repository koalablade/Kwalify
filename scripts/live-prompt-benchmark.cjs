const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const PROMPT_GROUPS = [
  {
    name: "Constraint Stress Tests",
    prompts: [
      { id: "constraint-2000s-pop-punk-gym", prompt: "2000s pop punk gym workout", category: "gym", mode: "balanced", length: 25, expectedGenres: ["pop punk", "punk", "rock"], expectedEra: { start: 2000, end: 2009 }, expectedEnergy: "high" },
      { id: "constraint-late-90s-skate-punk", prompt: "late 90s skate punk workout", category: "gym", mode: "balanced", length: 25, expectedGenres: ["skate punk", "punk", "rock"], expectedEra: { start: 1995, end: 2001 }, expectedEnergy: "high" },
      { id: "constraint-angry-metal-no-screamo", prompt: "angry metal gym session with no screamo", category: "gym", mode: "strict", length: 25, expectedGenres: ["metal", "rock"], expectedEnergy: "high", forbiddenTerms: ["screamo"] },
      { id: "constraint-female-fronted-rock", prompt: "high energy female-fronted rock workout", category: "gym", mode: "balanced", length: 25, expectedGenres: ["rock"], expectedEnergy: "high" },
      { id: "constraint-2000s-emo-not-sad", prompt: "2000s emo workout but not sad", category: "gym", mode: "balanced", length: 25, expectedGenres: ["emo", "rock", "punk"], expectedEra: { start: 2000, end: 2009 }, expectedEnergy: "high", expectedValence: "medium" },
      { id: "constraint-pop-punk-no-blink", prompt: "pop punk cardio playlist with no Blink-182", category: "gym", mode: "strict", length: 25, expectedGenres: ["pop punk", "punk", "rock"], expectedEnergy: "high", excludedArtists: ["blink-182", "blink 182"] },
    ],
  },
  {
    name: "Contradiction Tests",
    prompts: [
      { id: "contradiction-relaxing-workout", prompt: "relaxing workout music", category: "contradictory", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "contradiction-aggressive-studying", prompt: "aggressive music for studying", category: "contradictory", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "contradiction-happy-breakup", prompt: "happy breakup songs", category: "contradictory", mode: "balanced", length: 25, expectedValence: "medium" },
      { id: "contradiction-sad-hopeful", prompt: "sad songs that feel hopeful", category: "contradictory", mode: "balanced", length: 25, expectedValence: "medium" },
      { id: "contradiction-high-energy-chill", prompt: "high energy chill playlist", category: "contradictory", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "contradiction-focus-not-ambient", prompt: "focus music that isn't ambient", category: "focus", mode: "strict", length: 25, expectedEnergy: "low", forbiddenTerms: ["ambient"] },
    ],
  },
  {
    name: "Natural Language Tests",
    prompts: [
      { id: "natural-2am-great-night", prompt: "I need music that feels like driving home at 2am after a great night out", category: "driving", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "natural-volvo-rainy-garage", prompt: "songs for fixing an old Volvo in the garage on a rainy day", category: "mixed", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "natural-summer-ending", prompt: "music that feels like summer is ending", category: "mood_specific", mode: "balanced", length: 25, expectedValence: "medium" },
      { id: "natural-build-something", prompt: "stuff that makes me want to build something", category: "work", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "natural-road-trip-scotland", prompt: "music for a road trip through Scotland", category: "driving", mode: "balanced", length: 25, expectedEnergy: "medium" },
    ],
  },
  {
    name: "Sparse Catalog Killers",
    prompts: [
      { id: "sparse-welsh-pop-punk", prompt: "2000s Welsh pop punk workout", category: "edge_case", mode: "strict", length: 25, expectedGenres: ["pop punk", "punk", "rock"], expectedEra: { start: 2000, end: 2009 }, expectedEnergy: "high" },
      { id: "sparse-female-melodic-hardcore", prompt: "female-fronted melodic hardcore from the 2000s", category: "edge_case", mode: "strict", length: 25, expectedGenres: ["hardcore", "punk", "rock"], expectedEra: { start: 2000, end: 2009 }, expectedEnergy: "high" },
      { id: "sparse-post-hardcore-gym", prompt: "early 2000s post-hardcore gym playlist", category: "edge_case", mode: "strict", length: 25, expectedGenres: ["post-hardcore", "hardcore", "rock"], expectedEra: { start: 2000, end: 2005 }, expectedEnergy: "high" },
      { id: "sparse-brit-alt-rock-1998-2005", prompt: "British alternative rock gym session from 1998-2005", category: "edge_case", mode: "strict", length: 25, expectedGenres: ["alternative", "rock"], expectedEra: { start: 1998, end: 2005 }, expectedEnergy: "high" },
      { id: "sparse-skate-punk-1997-2003", prompt: "skate punk from 1997-2003 only", category: "edge_case", mode: "strict", length: 25, expectedGenres: ["skate punk", "punk", "rock"], expectedEra: { start: 1997, end: 2003 }, expectedEnergy: "high" },
    ],
  },
  {
    name: "Artist Exclusion Tests",
    prompts: [
      { id: "exclude-pop-punk-no-green-day", prompt: "2000s pop punk without Green Day", category: "genre_specific", mode: "strict", length: 25, expectedGenres: ["pop punk", "punk", "rock"], expectedEra: { start: 2000, end: 2009 }, excludedArtists: ["green day"] },
      { id: "exclude-metal-no-metallica", prompt: "metal workout without Metallica", category: "genre_specific", mode: "strict", length: 25, expectedGenres: ["metal", "rock"], expectedEnergy: "high", excludedArtists: ["metallica"] },
      { id: "exclude-classic-rock-no-queen", prompt: "classic rock road trip without Queen", category: "driving", mode: "strict", length: 25, expectedGenres: ["classic rock", "rock"], expectedEnergy: "medium", excludedArtists: ["queen"] },
      { id: "exclude-grunge-no-nirvana", prompt: "90s grunge without Nirvana", category: "genre_specific", mode: "strict", length: 25, expectedGenres: ["grunge", "alternative", "rock"], expectedEra: { start: 1990, end: 1999 }, excludedArtists: ["nirvana"] },
      { id: "exclude-indie-no-arctic-monkeys", prompt: "indie playlist without Arctic Monkeys", category: "genre_specific", mode: "strict", length: 25, expectedGenres: ["indie", "alternative"], excludedArtists: ["arctic monkeys"] },
    ],
  },
  {
    name: "Vintage Car / Garage Tests",
    prompts: [
      { id: "garage-volvo-480-cold", prompt: "music for restoring a Volvo 480 in a cold garage", category: "mixed", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "garage-1990-volvo-drive", prompt: "songs for a long drive in a 1990 Volvo 480 Turbo", category: "driving", mode: "balanced", length: 25, expectedEra: { start: 1985, end: 2000 }, expectedEnergy: "medium" },
      { id: "garage-electrical-gremlins", prompt: "music for troubleshooting electrical gremlins in an old car", category: "mixed", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "garage-late-night-workshop", prompt: "late night workshop playlist", category: "work", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "garage-sunday-classic-car-meet", prompt: "Sunday morning classic car meet playlist", category: "chill", mode: "balanced", length: 25, expectedEnergy: "medium", expectedValence: "high" },
    ],
  },
  {
    name: "Fallback Destruction Tests",
    prompts: [
      { id: "fallback-pop-punk-no-pop", prompt: "2000s pop punk gym workout with no pop music", category: "edge_case", mode: "strict", length: 25, expectedGenres: ["punk", "rock"], expectedEra: { start: 2000, end: 2009 }, expectedEnergy: "high", forbiddenTerms: ["pop"] },
      { id: "fallback-heavy-lifting-1999-2004", prompt: "heavy lifting playlist from 1999-2004 only", category: "gym", mode: "strict", length: 25, expectedEra: { start: 1999, end: 2004 }, expectedEnergy: "high" },
      { id: "fallback-focus-no-vocals-no-ambient", prompt: "focus music with no vocals and no ambient", category: "focus", mode: "strict", length: 25, expectedEnergy: "low", forbiddenTerms: ["ambient"], metadataLimitations: ["vocal presence is not available in generation response metadata"] },
      { id: "fallback-angry-rock-no-metal", prompt: "angry rock workout with no metal", category: "gym", mode: "strict", length: 25, expectedGenres: ["rock"], expectedEnergy: "high", forbiddenTerms: ["metal"] },
      { id: "fallback-upbeat-gym-no-electronic", prompt: "upbeat gym playlist with no electronic music", category: "gym", mode: "strict", length: 25, expectedEnergy: "high", forbiddenTerms: ["electronic", "edm", "dance"] },
    ],
  },
  {
    name: "Launch Readiness Pack",
    prompts: [
      { id: "launch-2000s-pop-punk-gym", prompt: "2000s pop punk gym workout", category: "gym", mode: "balanced", length: 25, expectedGenres: ["pop punk", "punk", "rock"], expectedEra: { start: 2000, end: 2009 }, expectedEnergy: "high" },
      { id: "launch-gym-heavy-lifting", prompt: "gym heavy lifting intense", category: "gym", mode: "balanced", length: 25, expectedEnergy: "high" },
      { id: "launch-gym-cardio-upbeat", prompt: "gym cardio upbeat", category: "gym", mode: "balanced", length: 25, expectedEnergy: "high", expectedValence: "high" },
      { id: "launch-gym-angry-rock", prompt: "gym angry rock", category: "gym", mode: "strict", length: 25, expectedGenres: ["rock", "metal", "punk"], expectedEnergy: "high" },
      { id: "launch-old-volvo-garage", prompt: "music for fixing an old Volvo in the garage", category: "mixed", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "launch-late-night-workshop", prompt: "late night workshop playlist", category: "work", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "launch-2am-great-night-drive", prompt: "I need music that feels like driving home at 2am after a great night out", category: "driving", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "launch-happy-breakup", prompt: "happy breakup songs", category: "contradictory", mode: "balanced", length: 25, expectedValence: "medium" },
      { id: "launch-pop-punk-no-blink", prompt: "2000s pop punk workout with no Blink-182", category: "gym", mode: "strict", length: 25, expectedGenres: ["pop punk", "punk", "rock"], expectedEra: { start: 2000, end: 2009 }, expectedEnergy: "high", excludedArtists: ["blink-182", "blink 182"] },
      { id: "launch-focus-not-ambient", prompt: "focus music that isn't ambient", category: "focus", mode: "strict", length: 25, expectedEnergy: "low", forbiddenTerms: ["ambient"] },
    ],
  },
];

const ULTIMATE_AUDIT_GROUPS = [
  {
    name: "Core Suite",
    prompts: [
      { id: "ultimate-core-gym-2000s-pop-punk", prompt: "gym 2000s pop punk workout", category: "gym", mode: "balanced", length: 25, expectedGenres: ["pop punk", "punk", "rock"], expectedEra: { start: 2000, end: 2009 }, expectedEnergy: "high" },
      { id: "ultimate-core-heavy-lifting", prompt: "gym heavy lifting intense", category: "gym", mode: "balanced", length: 25, expectedEnergy: "high" },
      { id: "ultimate-core-cardio-upbeat", prompt: "gym cardio upbeat", category: "gym", mode: "balanced", length: 25, expectedEnergy: "high", expectedValence: "high" },
      { id: "ultimate-core-angry-rock", prompt: "gym angry rock", category: "gym", mode: "strict", length: 25, expectedGenres: ["rock"], expectedEnergy: "high" },
    ],
  },
  {
    name: "Real User Suite",
    prompts: [
      { id: "ultimate-real-car-garage-alone", prompt: "music for fixing a car alone in a garage", category: "mixed", mode: "balanced", length: 25, expectedEnergy: "medium" },
      { id: "ultimate-real-winning-struggle", prompt: "songs that feel like winning after a long struggle", category: "mood_specific", mode: "balanced", length: 25, expectedEnergy: "medium", expectedValence: "high" },
      { id: "ultimate-real-upbeat-not-annoying-gym", prompt: "something upbeat but not annoying for the gym", category: "gym", mode: "balanced", length: 25, expectedEnergy: "high", expectedValence: "high" },
      { id: "ultimate-real-kerrang-2000s", prompt: "stuff I'd have heard on Kerrang in the 2000s", category: "genre_specific", mode: "strict", length: 25, expectedGenres: ["rock", "punk", "metal"], expectedEra: { start: 2000, end: 2009 }, expectedEnergy: "high" },
      { id: "ultimate-real-rain-night-driving", prompt: "music for driving through rain at night", category: "driving", mode: "balanced", length: 25, expectedEnergy: "medium", expectedValence: "low" },
    ],
  },
  {
    name: "Constraint Suite",
    prompts: [
      { id: "ultimate-constraint-pop-punk-no-blink", prompt: "2000s pop punk without Blink-182", category: "genre_specific", mode: "strict", length: 25, expectedGenres: ["pop punk", "punk", "rock"], expectedEra: { start: 2000, end: 2009 }, excludedArtists: ["blink-182", "blink 182"] },
      { id: "ultimate-constraint-rock-2004-2008", prompt: "rock workout playlist from exactly 2004-2008", category: "gym", mode: "strict", length: 25, expectedGenres: ["rock"], expectedEra: { start: 2004, end: 2008 }, expectedEnergy: "high" },
      { id: "ultimate-constraint-angry-no-metal-rap-edm", prompt: "angry workout playlist with no metal, rap or EDM", category: "gym", mode: "strict", length: 25, expectedGenres: ["rock"], expectedEnergy: "high", forbiddenTerms: ["metal", "rap", "edm", "electronic"] },
      { id: "ultimate-constraint-focus-no-ambient-classical-electronic", prompt: "focus music with no ambient, classical or electronic", category: "focus", mode: "strict", length: 25, expectedEnergy: "low", forbiddenTerms: ["ambient", "classical", "electronic"] },
    ],
  },
];

function usage() {
  console.error([
    "Usage:",
    "  node scripts/live-prompt-benchmark.cjs --base-url https://kwalify.net --out reports/live-playlist-benchmark/latest",
    "",
    "Auth:",
    "  Set PLAYLIST_BENCHMARK_AUTH_COOKIE to the full Cookie header value, or set COOKIE_VALUE to the connect.sid value.",
    "",
    "Options:",
    "  --delay-ms N       Delay between playlists, default 13000",
    "  --timeout-ms N     Per-request timeout, default 120000",
    "  --limit N          Run only first N prompts",
    "  --suite NAME       Prompt suite: stress (default) or ultimate",
    "  --resume           Continue from existing raw-results.json",
  ].join("\n"));
  process.exit(2);
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeCookie() {
  const full = process.env.PLAYLIST_BENCHMARK_AUTH_COOKIE?.trim();
  if (full) return full;
  const value = process.env.COOKIE_VALUE?.trim();
  if (value) return `connect.sid=${value}`;
  return "";
}

function parseConfig() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const baseUrl = (argValue(args, "--base-url") ?? process.env.API_BASE_URL ?? "https://kwalify.net").replace(/\/+$/, "");
  const outDir = argValue(args, "--out") ?? path.join("reports", "live-playlist-benchmark", timestampSlug());
  const delayMs = Number(argValue(args, "--delay-ms") ?? 13000);
  const timeoutMs = Number(argValue(args, "--timeout-ms") ?? 120000);
  const limitRaw = argValue(args, "--limit");
  const suite = argValue(args, "--suite") ?? "stress";
  const authCookie = normalizeCookie();
  if (!authCookie) throw new Error("Set PLAYLIST_BENCHMARK_AUTH_COOKIE or COOKIE_VALUE before running.");
  if (!["stress", "ultimate"].includes(suite)) throw new Error("--suite must be stress or ultimate");
  return {
    baseUrl,
    outDir,
    delayMs,
    timeoutMs,
    limit: limitRaw ? Number(limitRaw) : null,
    resume: args.includes("--resume"),
    authCookie,
    suite,
  };
}

function promptGroupsForSuite(suite) {
  return suite === "ultimate" ? ULTIMATE_AUDIT_GROUPS : PROMPT_GROUPS;
}

function flattenPrompts(suite) {
  return promptGroupsForSuite(suite).flatMap((group) =>
    group.prompts.map((prompt, index) => ({
      ...prompt,
      group: group.name,
      tags: [group.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), ...(prompt.tags ?? [])],
      order: index + 1,
    })),
  );
}

function tracksFromResponse(data) {
  return Array.isArray(data?.tracks) ? data.tracks : [];
}

function trackName(track) {
  return String(track.trackName ?? track.name ?? "").trim();
}

function artistName(track) {
  return String(track.artistName ?? track.artist ?? "").trim();
}

function trackTerms(track) {
  return [
    trackName(track),
    artistName(track),
    track.genrePrimary,
    track.genreFamily,
    ...(Array.isArray(track.genres) ? track.genres : []),
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();
}

function countBy(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function topArtists(tracks) {
  return countBy(tracks.map(artistName)).slice(0, 8).map(([artist, count]) => ({ artist, count }));
}

function topGenres(tracks) {
  return countBy(tracks.map((track) => String(track.genreFamily ?? track.genrePrimary ?? "").toLowerCase()).filter(Boolean)).slice(0, 8).map(([genre, count]) => ({ genre, count }));
}

function analyzeConstraints(benchmark, tracks) {
  const violations = [];
  const warnings = [];
  for (const artist of benchmark.excludedArtists ?? []) {
    const hits = tracks.filter((track) => artistName(track).toLowerCase() === artist.toLowerCase());
    if (hits.length) violations.push(`Excluded artist present: ${artist} (${hits.length})`);
  }
  for (const term of benchmark.forbiddenTerms ?? []) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const hits = tracks.filter((track) => regex.test(trackTerms(track)));
    if (hits.length) violations.push(`Forbidden term present in metadata: ${term} (${hits.length})`);
  }
  if (benchmark.expectedEra) {
    const years = tracks
      .map((track) => typeof track.releaseYear === "number" ? track.releaseYear : null);
    const known = years.filter((year) => year !== null);
    const outOfEra = known.filter((year) => year < benchmark.expectedEra.start || year > benchmark.expectedEra.end);
    if (known.length === 0) warnings.push("No release years returned for era verification.");
    if (outOfEra.length > Math.max(2, known.length * 0.25)) {
      violations.push(`Era drift: ${outOfEra.length}/${known.length} known tracks outside ${benchmark.expectedEra.start}-${benchmark.expectedEra.end}`);
    }
  }
  for (const limitation of benchmark.metadataLimitations ?? []) warnings.push(`Manual check needed: ${limitation}`);
  return { violations, warnings };
}

async function fetchJsonWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function preflight(config) {
  const { response, data } = await fetchJsonWithTimeout(`${config.baseUrl}/api/auth/me`, {
    headers: { Cookie: config.authCookie },
  }, 30000);
  if (!response.ok) {
    throw new Error(`Auth preflight failed with ${response.status}: ${String(data.error ?? data.message ?? response.statusText)}`);
  }
  return data;
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return Math.min(60000, 3000 * Math.pow(2, attempt));
}

async function postGenerate(config, benchmark) {
  const started = Date.now();
  let retries = 0;
  let lastError = "";
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      const { response, data } = await fetchJsonWithTimeout(`${config.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: config.authCookie,
        },
        body: JSON.stringify({
          vibe: benchmark.prompt,
          mode: benchmark.mode,
          length: benchmark.length,
          varietyBoost: true,
        }),
      }, config.timeoutMs);
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        retries += 1;
        await sleep(retryDelay(response, attempt));
        continue;
      }
      const tracks = tracksFromResponse(data);
      return {
        benchmark,
        ok: response.ok && data.success === true,
        status: response.status,
        error: response.ok ? undefined : String(data.message ?? data.error ?? response.statusText),
        response: { ...data, harnessHttp: { retries, attempts: attempt + 1 } },
        tracks,
        elapsedMs: Date.now() - started,
        generated: {
          playlistName: data.playlistName ?? data.name ?? null,
          spotifyPlaylistUrl: data.spotifyPlaylistUrl ?? data.spotifyUrl ?? null,
          playlistId: data.playlistId ?? null,
          trackCount: data.trackCount ?? tracks.length,
        },
        diagnostics: {
          constraints: analyzeConstraints(benchmark, tracks),
          topArtists: topArtists(tracks),
          topGenres: topGenres(tracks),
        },
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < 3) {
        retries += 1;
        await sleep(3000 * Math.pow(2, attempt));
      }
    }
  }
  return {
    benchmark,
    ok: false,
    error: lastError || "request_failed_after_retries",
    response: { harnessHttp: { retries, attempts: retries + 1 } },
    tracks: [],
    elapsedMs: Date.now() - started,
    generated: { playlistName: null, spotifyPlaylistUrl: null, playlistId: null, trackCount: 0 },
    diagnostics: { constraints: { violations: [], warnings: [] }, topArtists: [], topGenres: [] },
  };
}

async function readExistingResults(outDir) {
  try {
    const raw = await readFile(path.join(outDir, "raw-results.json"), "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.results) ? data.results : [];
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

async function checkpoint(config, payload) {
  await mkdir(config.outDir, { recursive: true });
  await writeFile(path.join(config.outDir, "raw-results.json"), JSON.stringify(payload, null, 2));
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function formatMs(ms) {
  return `${Math.round(ms / 1000)}s`;
}

function playlistLine(result) {
  const url = result.generated?.spotifyPlaylistUrl ?? result.response?.spotifyPlaylistUrl ?? "";
  const status = result.ok ? "PASS" : "FAIL";
  const violations = result.diagnostics?.constraints?.violations ?? [];
  const warnings = result.diagnostics?.constraints?.warnings ?? [];
  return [
    `### ${result.benchmark.id}`,
    `- Status: ${status} (${result.status ?? "no_status"}, ${formatMs(result.elapsedMs)})`,
    `- Prompt: ${result.benchmark.prompt}`,
    `- Playlist: ${url || "not created"}`,
    `- Tracks: ${result.tracks.length}/${result.benchmark.length}`,
    `- Constraint violations: ${violations.length ? violations.join("; ") : "none detected from response metadata"}`,
    ...(warnings.length ? [`- Warnings: ${warnings.join("; ")}`] : []),
    `- Top artists: ${(result.diagnostics?.topArtists ?? []).map((row) => `${row.artist} (${row.count})`).join(", ") || "n/a"}`,
    `- Top genres: ${(result.diagnostics?.topGenres ?? []).map((row) => `${row.genre} (${row.count})`).join(", ") || "n/a"}`,
    `- First tracks: ${result.tracks.slice(0, 5).map((track) => `${trackName(track)} - ${artistName(track)}`).join("; ") || "n/a"}`,
    "",
  ].join("\n");
}

async function writeCustomMarkdown(config, run) {
  const total = run.results.length;
  const ok = run.results.filter((result) => result.ok).length;
  const violations = run.results.filter((result) => (result.diagnostics?.constraints?.violations ?? []).length > 0);
  const links = run.results
    .filter((result) => result.generated?.spotifyPlaylistUrl ?? result.response?.spotifyPlaylistUrl)
    .map((result) => `- ${result.benchmark.id}: ${result.generated?.spotifyPlaylistUrl ?? result.response?.spotifyPlaylistUrl}`);
  const groupBlocks = promptGroupsForSuite(config.suite).map((group) => {
    const groupResults = run.results.filter((result) => result.benchmark.group === group.name);
    if (!groupResults.length) return "";
    const groupOk = groupResults.filter((result) => result.ok).length;
    const groupViolations = groupResults.filter((result) => (result.diagnostics?.constraints?.violations ?? []).length > 0).length;
    return [
      `## ${group.name}`,
      `Success: ${groupOk}/${groupResults.length}; metadata constraint violations: ${groupViolations}`,
      "",
      ...groupResults.map(playlistLine),
    ].join("\n");
  }).filter(Boolean);
  await writeFile(path.join(config.outDir, "live-benchmark-summary.md"), [
    "# Live Playlist Benchmark",
    "",
    `Generated: ${run.generatedAt}`,
    `Base URL: ${config.baseUrl}`,
    `Authenticated user: ${run.user?.id ?? "unknown"} (${run.user?.displayName ?? "unknown"})`,
    `Mode: live production generation with Spotify playlist creation`,
    `Suite: ${config.suite}`,
    `Prompts completed: ${total}/${run.promptCount}`,
    `Successful playlists: ${ok}/${total} (${pct(total ? ok / total : 0)})`,
    `Metadata constraint violations: ${violations.length}`,
    "",
    "## Playlist Links",
    ...(links.length ? links : ["- None"]),
    "",
    ...groupBlocks,
  ].join("\n"));
}

async function writeReports(config, run) {
  const { writeEvaluationReports } = require("../backend/dist/lib/playlist-evaluation/report.js");
  await writeEvaluationReports({
    outDir: config.outDir,
    generatedAt: run.generatedAt,
    run: {
      mode: "live-api",
      baseUrl: config.baseUrl,
      promptCount: run.promptCount,
      concurrency: 1,
      delayMs: config.delayMs,
      allowSpotifyCreate: true,
      allowDbWrites: true,
      durationMs: run.durationMs,
    },
    results: run.results,
  });
  await writeCustomMarkdown(config, run);
}

async function main() {
  const config = parseConfig();
  const started = Date.now();
  const allPrompts = flattenPrompts(config.suite);
  const prompts = config.limit ? allPrompts.slice(0, config.limit) : allPrompts;
  await mkdir(config.outDir, { recursive: true });
  const user = await preflight(config);
  const existing = config.resume ? await readExistingResults(config.outDir) : [];
  const completed = new Set(existing.map((result) => result.benchmark?.id).filter(Boolean));
  const results = [...existing];
  console.error(`[live-benchmark] authenticated as ${user.id ?? "unknown"}; running ${prompts.length - completed.size}/${prompts.length} prompts`);
  await checkpoint(config, {
    generatedAt: new Date().toISOString(),
    promptCount: prompts.length,
    user,
    results,
  });
  for (const benchmark of prompts) {
    if (completed.has(benchmark.id)) continue;
    console.error(`[live-benchmark] ${results.length + 1}/${prompts.length} ${benchmark.id}: ${benchmark.prompt}`);
    const result = await postGenerate(config, benchmark);
    results.push(result);
    await checkpoint(config, {
      generatedAt: new Date().toISOString(),
      promptCount: prompts.length,
      user,
      results,
    });
    console.error(`[live-benchmark] ${result.ok ? "ok" : "fail"} ${benchmark.id}: ${result.status ?? "no_status"} ${result.tracks.length} tracks ${result.generated?.spotifyPlaylistUrl ?? ""}`);
    if (results.length < prompts.length) await sleep(config.delayMs);
  }
  const run = {
    generatedAt: new Date().toISOString(),
    promptCount: prompts.length,
    user,
    results,
    durationMs: Date.now() - started,
  };
  await checkpoint(config, run);
  await writeReports(config, run);
  console.log(JSON.stringify({
    outDir: config.outDir,
    prompts: prompts.length,
    ok: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    durationMs: run.durationMs,
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
