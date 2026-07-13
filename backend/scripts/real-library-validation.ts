/**
 * Real-library validation runner — FOR LEARNING, NOT OPTIMISATION.
 *
 * Runs a fixed prompt matrix (moods, emotional, scenes, genres, eras, unusual)
 * against a live server using a REAL connected/synced Spotify account (audit
 * mode), and records the generated playlist + diagnostics + quality signals plus
 * empty user-feedback fields for manual annotation.
 *
 * This produces evidence about how the product behaves on a real library. Do NOT
 * tune scoring or change behaviour based on the output here — capture and learn.
 *
 * Usage:
 *   node backend/dist/scripts/real-library-validation.js \
 *     --base-url http://localhost:5000 \
 *     --spotify-user-id <synced-user-id> \
 *     --token <PLAYLIST_EVAL_TOKEN> \
 *     --out reports/real-library-validation \
 *     [--mode balanced] [--length 25] [--delay-ms 1500] [--timeout-ms 120000]
 *
 * The token also falls back to process.env.PLAYLIST_EVAL_TOKEN.
 */

import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

interface MatrixPrompt {
  category: string;
  prompt: string;
}

const PROMPT_MATRIX: MatrixPrompt[] = [
  // Normal moods
  { category: "mood", prompt: "late night drive alone" },
  { category: "mood", prompt: "slow sunday morning coffee" },
  { category: "mood", prompt: "deep focus work session" },
  { category: "mood", prompt: "rainy day indoors" },
  { category: "mood", prompt: "summer road trip with the windows down" },
  // Emotional prompts
  { category: "emotional", prompt: "heartbreak but somehow hopeful" },
  { category: "emotional", prompt: "missing someone who lives far away" },
  { category: "emotional", prompt: "quiet grief on a long night" },
  { category: "emotional", prompt: "euphoric and completely in love" },
  { category: "emotional", prompt: "anxious but pushing through anyway" },
  // Scenes
  { category: "scene", prompt: "dive bar at last call" },
  { category: "scene", prompt: "beach bonfire with close friends" },
  { category: "scene", prompt: "walking through the city at 3am" },
  { category: "scene", prompt: "cozy cabin during a snowstorm" },
  { category: "scene", prompt: "rooftop party at golden hour" },
  // Genres
  { category: "genre", prompt: "90s boom bap hip hop" },
  { category: "genre", prompt: "shoegaze wall of sound" },
  { category: "genre", prompt: "afrobeats party set" },
  { category: "genre", prompt: "classic soul and motown" },
  { category: "genre", prompt: "melodic techno warehouse" },
  // Eras
  { category: "era", prompt: "80s synthpop night" },
  { category: "era", prompt: "70s laurel canyon folk rock" },
  { category: "era", prompt: "2000s indie sleaze" },
  { category: "era", prompt: "early 2010s edm festival" },
  { category: "era", prompt: "60s british invasion" },
  // Unusual prompts
  { category: "unusual", prompt: "music for a villain's origin story" },
  { category: "unusual", prompt: "songs that sound like liquid gold" },
  { category: "unusual", prompt: "staring out a train window in the rain" },
  { category: "unusual", prompt: "getting ready to fight the final boss" },
  { category: "unusual", prompt: "songs in a language I don't speak but still feel" },
];

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pick(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = num(v);
    if (n !== null) return n;
  }
  return null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ExtractedRow {
  category: string;
  prompt: string;
  ok: boolean;
  status: number;
  error: string | null;
  latencyMs: number;
  trackCount: number | null;
  degraded: boolean;
  degradationReasons: string[];
  curatorScore: number | null;
  wouldSaveScore: number | null;
  playlistConfidence: number | null;
  humanCoherenceScore: number | null;
  clusterPurity: number | null;
  // For manual annotation after the run — the point of this exercise.
  userFeedback: { rating: null; wouldSave: null; notes: string };
}

function extract(
  category: string,
  prompt: string,
  status: number,
  ok: boolean,
  latencyMs: number,
  data: Record<string, any>,
  error: string | null,
): ExtractedRow {
  const g = (data.generationDiagnostics ?? {}) as Record<string, any>;
  const v3 = (g.v3Pipeline ?? data.v3Pipeline ?? {}) as Record<string, any>;
  const gate = (v3.humanSaveabilityGate ?? g.humanSaveabilityGate ?? {}) as Record<string, any>;
  const tracks = Array.isArray(data.tracks) ? data.tracks : Array.isArray(data.playlist) ? data.playlist : [];
  return {
    category,
    prompt,
    ok,
    status,
    error,
    latencyMs,
    trackCount: pick(data.count, data.totalTracks, tracks.length),
    degraded: data.degraded === true,
    degradationReasons: Array.isArray(data.degradationReasons) ? data.degradationReasons : [],
    curatorScore: pick(gate.curatorScore, g.curatorScore),
    wouldSaveScore: pick(gate.wouldSaveScore, g.wouldSaveScore),
    playlistConfidence: pick(data.playlistConfidence, g.playlistConfidence),
    humanCoherenceScore: pick(g.humanCoherenceScore),
    clusterPurity: pick(g.clusterPurity),
    userFeedback: { rating: null, wouldSave: null, notes: "" },
  };
}

async function main(): Promise<void> {
  const baseUrl = (arg("--base-url", "http://localhost:5000") as string).replace(/\/$/, "");
  const spotifyUserId = arg("--spotify-user-id");
  const token = arg("--token") ?? process.env["PLAYLIST_EVAL_TOKEN"];
  const outDir = arg("--out", "reports/real-library-validation") as string;
  const mode = arg("--mode", "balanced") as string;
  const length = Number.parseInt(arg("--length", "25") as string, 10);
  const delayMs = Number.parseInt(arg("--delay-ms", "1500") as string, 10);
  const timeoutMs = Number.parseInt(arg("--timeout-ms", "120000") as string, 10);

  if (!token) {
    console.error("[real-library] Missing eval token (--token or PLAYLIST_EVAL_TOKEN).");
    process.exit(2);
  }
  if (!spotifyUserId) {
    console.error("[real-library] Missing --spotify-user-id (a synced Spotify account).");
    console.error("  Find one via: GET /api/eval/admin/smoke-spotify-user-id (EVAL_ADMIN_ENABLED=true).");
    process.exit(2);
  }

  mkdirSync(outDir, { recursive: true });
  const jsonlPath = join(outDir, "results.jsonl");
  writeFileSync(jsonlPath, "");

  console.error(
    `[real-library] ${PROMPT_MATRIX.length} prompts → ${baseUrl} (user=${spotifyUserId.slice(0, 4)}…, mode=${mode}, length=${length})`,
  );

  const rows: ExtractedRow[] = [];
  for (let i = 0; i < PROMPT_MATRIX.length; i++) {
    const { category, prompt } = PROMPT_MATRIX[i]!;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let row: ExtractedRow;
    try {
      const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-kwalify-evaluation-token": token },
        body: JSON.stringify({ vibe: prompt, mode, length, auditMode: true, spotifyUserId, varietyBoost: true }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      const ok = res.ok && data["success"] === true;
      row = extract(
        category,
        prompt,
        res.status,
        ok,
        Date.now() - started,
        data,
        ok ? null : String(data["message"] ?? data["error"] ?? res.statusText),
      );
    } catch (err) {
      row = extract(category, prompt, 0, false, Date.now() - started, {}, err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
    rows.push(row);
    appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`);
    console.error(
      `[${i + 1}/${PROMPT_MATRIX.length}] ${category.padEnd(9)} "${prompt}" → ${row.ok ? "ok" : `FAIL(${row.status})`} ` +
        `tracks=${row.trackCount ?? "?"} degraded=${row.degraded} curator=${row.curatorScore ?? "?"} (${row.latencyMs}ms)`,
    );
    if (i < PROMPT_MATRIX.length - 1) await sleep(delayMs);
  }

  // Summary (markdown) — grouped by category, plus overall signals.
  const okRows = rows.filter((r) => r.ok);
  const avg = (vals: (number | null)[]): number | null => {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000 : null;
  };
  const categories = [...new Set(rows.map((r) => r.category))];
  const lines: string[] = [];
  lines.push("# Real-Library Validation (for learning)");
  lines.push("");
  lines.push(`- Server: ${baseUrl}`);
  lines.push(`- Prompts: ${rows.length} | Succeeded: ${okRows.length} | Failed: ${rows.length - okRows.length}`);
  lines.push(`- Degraded: ${okRows.filter((r) => r.degraded).length}/${okRows.length}`);
  lines.push("");
  lines.push("| Category | n | ok | avg tracks | avg curator | avg confidence | avg coherence | degraded |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const cat of categories) {
    const cr = rows.filter((r) => r.category === cat);
    const co = cr.filter((r) => r.ok);
    lines.push(
      `| ${cat} | ${cr.length} | ${co.length} | ${avg(co.map((r) => r.trackCount)) ?? "—"} | ` +
        `${avg(co.map((r) => r.curatorScore)) ?? "—"} | ${avg(co.map((r) => r.playlistConfidence)) ?? "—"} | ` +
        `${avg(co.map((r) => r.humanCoherenceScore)) ?? "—"} | ${co.filter((r) => r.degraded).length} |`,
    );
  }
  lines.push("");
  lines.push("## Per-prompt");
  lines.push("");
  lines.push("| Category | Prompt | ok | tracks | degraded | reasons | curator | confidence |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| ${r.category} | ${r.prompt.replace(/\|/g, "/")} | ${r.ok ? "✓" : `✗ ${r.status}`} | ${r.trackCount ?? "—"} | ` +
        `${r.degraded ? "yes" : "no"} | ${(r.degradationReasons.join(", ") || "—").replace(/\|/g, "/")} | ` +
        `${r.curatorScore ?? "—"} | ${r.playlistConfidence ?? "—"} |`,
    );
  }
  lines.push("");
  lines.push("> Fill in `userFeedback` (rating / wouldSave / notes) per row in results.jsonl after listening. Do not tune scoring based on this yet.");
  const mdPath = join(outDir, "summary.md");
  writeFileSync(mdPath, `${lines.join("\n")}\n`);

  console.error(`[real-library] wrote ${jsonlPath} and ${mdPath}`);
  if (okRows.length === 0) process.exit(1);
}

main().catch((err) => {
  console.error("[real-library] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
