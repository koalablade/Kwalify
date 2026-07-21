/**
 * Live audit generate for HUMAN_100_PROMPTS + editorial save/keep review.
 */
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { evalPingOk, healthOk } from "../lib/benchmark-local-server";
import { HUMAN_100_PROMPTS } from "./human-100-prompts";
import {
  inferWorldIdentityIdsFromPrompt,
  isSafetyBlanketOutsideWorld,
} from "../core/editorial/world-identity-gate";

type TrackRow = {
  artist: string;
  title: string;
  energy: number | null;
  genreFamily: string | null;
  genrePrimary: string | null;
};

type SaveVerdict = "SAVE" | "MAYBE" | "SKIP" | "REFUSE_OK" | "EMPTY_BAD";

const SAFETY =
  /\b(?:blondie|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|men\s+at\s+work|journey|bon\s+jovi|meat\s+loaf|storm\s+queen)\b/i;

const FAMILY_SKIP: Record<string, RegExp> = {
  goth: /\b(?:queen\b(?!\s+of\s+the\s+stone)|fleetwood|blondie|led\s+zeppelin|ac\/?dc|bob\s+marley|drake\b)\b/i,
  grunge: /\b(?:blondie|fleetwood|men\s+at\s+work|queen\b(?!\s+of\s+the\s+stone)|abba|bee\s+gees)\b/i,
  disco: /\b(?:black\s+sabbath|metallica|slayer|iron\s+maiden|pantera|ac\/?dc)\b/i,
  gym: /\b(?:storm\s+queen|craig\s+david|blondie|fleetwood|bee\s+gees|abba|tiesto|scooter)\b/i,
  rain_drive: /\b(?:tiesto|meat\s+loaf|joyner|highwaymen|dmx\b|queen\b(?!\s+of\s+the\s+stone)|drake\b)\b/i,
  rain_chill: /\b(?:dmx\b|eminem|metallica|ac\/?dc|storm\s+queen)\b/i,
  focus: /\b(?:olivia\s+rodrigo|taylor\s+swift|billie\s+eilish|paramore|drake\b|dua\s+lipa)\b/i,
  neon: /\b(?:french\s+montana|tekkno|hard\s+techno|fleetwood|led\s+zeppelin)\b/i,
  metal: /\b(?:blondie|fleetwood|abba|bee\s+gees|storm\s+queen)\b/i,
  pop_punk: /\b(?:fleetwood|blondie|led\s+zeppelin|queen\b(?!\s+of\s+the\s+stone))\b/i,
};

function asTracks(raw: unknown): TrackRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => {
    const row = t as Record<string, unknown>;
    return {
      artist: String(row.artistName ?? row.artist ?? "?"),
      title: String(row.trackName ?? row.name ?? "?"),
      energy: typeof row.energy === "number" ? row.energy : null,
      genreFamily: typeof row.genreFamily === "string" ? row.genreFamily : null,
      genrePrimary: typeof row.genrePrimary === "string" ? row.genrePrimary : null,
    };
  });
}

function judgeHuman(opts: {
  family: string;
  prompt: string;
  tracks: TrackRow[];
  asked: number;
  httpStatus: number;
  message: string | null;
}): {
  verdict: SaveVerdict;
  why: string;
  contaminants: string[];
  blankets: string[];
  uniqueArtists: number;
  worldFeel: "one_world" | "mixed" | "broken" | "empty";
} {
  const { tracks, asked, httpStatus, message, family, prompt } = opts;
  const n = tracks.length;
  const worldIds = inferWorldIdentityIdsFromPrompt(prompt);
  const contaminants: string[] = [];
  const blankets: string[] = [];
  const skipRe = FAMILY_SKIP[family];
  for (const t of tracks) {
    const blob = `${t.artist} ${t.title}`;
    if (skipRe?.test(blob)) contaminants.push(`${t.artist} — ${t.title}`);
    if (SAFETY.test(t.artist) && isSafetyBlanketOutsideWorld(t.artist, worldIds.length ? worldIds : [family])) {
      blankets.push(`${t.artist} — ${t.title}`);
    }
  }
  const uniqueArtists = new Set(tracks.map((t) => t.artist.toLowerCase())).size;
  const underfill = n > 0 && n < asked * 0.45;
  const families = tracks.map((t) => (t.genreFamily || "").toLowerCase()).filter(Boolean);
  const famCounts = new Map<string, number>();
  for (const f of families) famCounts.set(f, (famCounts.get(f) ?? 0) + 1);
  const topFamShare = families.length
    ? Math.max(...[...famCounts.values()]) / families.length
    : 0;

  if (n === 0) {
    const honest =
      httpStatus === 409 ||
      /world_hard_lock|recovery|identity|would not|library does not/i.test(String(message ?? ""));
    return {
      verdict: honest ? "REFUSE_OK" : "EMPTY_BAD",
      why: honest
        ? "Empty/refuse with identity honesty — better than padded trash"
        : "Empty without a clear honest refuse — bad UX",
      contaminants,
      blankets,
      uniqueArtists: 0,
      worldFeel: "empty",
    };
  }

  if (contaminants.length >= 2 || blankets.length >= 2) {
    return {
      verdict: "SKIP",
      why: `Wrong-world bleed (${contaminants.length + blankets.length} hits) — immersion breaks`,
      contaminants,
      blankets,
      uniqueArtists,
      worldFeel: "broken",
    };
  }
  if (contaminants.length === 1 || blankets.length === 1) {
    return {
      verdict: "MAYBE",
      why: "Mostly right world but one contaminant would make a fan pause",
      contaminants,
      blankets,
      uniqueArtists,
      worldFeel: "mixed",
    };
  }
  if (uniqueArtists <= 2 && n >= 8) {
    return {
      verdict: "MAYBE",
      why: "Same 1–2 artists dominate — feels generated not curated",
      contaminants,
      blankets,
      uniqueArtists,
      worldFeel: topFamShare >= 0.55 ? "one_world" : "mixed",
    };
  }
  if (underfill && topFamShare >= 0.5) {
    return {
      verdict: "SAVE",
      why: "Honest partial in one world — would keep and maybe expand later",
      contaminants,
      blankets,
      uniqueArtists,
      worldFeel: "one_world",
    };
  }
  if (topFamShare >= 0.45 || worldIds.length > 0) {
    return {
      verdict: "SAVE",
      why: "Belongs in one musical world; would save / send to a friend",
      contaminants,
      blankets,
      uniqueArtists,
      worldFeel: topFamShare >= 0.45 ? "one_world" : "mixed",
    };
  }
  return {
    verdict: "MAYBE",
    why: "Songs fine individually but world identity is soft — skip-heavy listen",
    contaminants,
    blankets,
    uniqueArtists,
    worldFeel: "mixed",
  };
}

async function main() {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: "http://127.0.0.1:5000",
    cli: { baseUrl: process.env.HUMAN100_BASE_URL || "http://127.0.0.1:5000" },
  });
  const baseUrl = creds.baseUrl;
  if (!(await healthOk(baseUrl))) throw new Error(`API not healthy at ${baseUrl}`);
  const ping = await evalPingOk(baseUrl, creds.token);
  if (!ping.ok) throw new Error(`Eval token rejected: ${ping.reason}`);

  const outDir = path.join("reports", "playlist-evaluation", "human-100-listen");
  await mkdir(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "generations.jsonl");
  await writeFile(jsonlPath, "");

  console.log(`[human-100] ${HUMAN_100_PROMPTS.length} prompts → ${baseUrl} user=${creds.spotifyUserId}`);
  type ResultRow = {
    id: string;
    prompt: string;
    mode: "strict" | "balanced" | "chaotic";
    length: number;
    difficulty: "easy" | "medium" | "hard" | "edge";
    family: string;
    httpStatus: number;
    ok: boolean;
    ms: number;
    tracks: TrackRow[];
    message: string | null;
    humanQualityGate: unknown;
    playlistConfidence: unknown;
    judgment: ReturnType<typeof judgeHuman>;
  };
  const results: ResultRow[] = [];

  for (let i = 0; i < HUMAN_100_PROMPTS.length; i++) {
    const fixture = HUMAN_100_PROMPTS[i]!;
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/generate?audit=1`, {
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
          evaluationPromptId: fixture.id,
          evaluationCategory: "human_100_listen",
          evaluationTimeoutMs: 240_000,
        }),
      });
    } catch (err) {
      const row: ResultRow = {
        ...fixture,
        httpStatus: 0,
        ok: false,
        ms: Date.now() - started,
        tracks: [],
        message: err instanceof Error ? err.message : String(err),
        humanQualityGate: null,
        playlistConfidence: null,
        judgment: judgeHuman({
          family: fixture.family,
          prompt: fixture.prompt,
          tracks: [],
          asked: fixture.length,
          httpStatus: 0,
          message: "fetch_failed",
        }),
      };
      results.push(row);
      await appendFile(jsonlPath, `${JSON.stringify(row)}\n`);
      console.log(`[${i + 1}/100] ${fixture.id} FETCH_FAIL`);
      continue;
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const tracks = asTracks(data.tracks);
    const message = (data.message ?? data.userMessage ?? data.error ?? null) as string | null;
    const judgment = judgeHuman({
      family: fixture.family,
      prompt: fixture.prompt,
      tracks,
      asked: fixture.length,
      httpStatus: response.status,
      message,
    });
    const row: ResultRow = {
      ...fixture,
      httpStatus: response.status,
      ok: response.ok && tracks.length > 0,
      ms: Date.now() - started,
      tracks,
      message,
      humanQualityGate: data.humanQualityGate ?? null,
      playlistConfidence: data.playlistConfidence ?? null,
      judgment,
    };
    results.push(row);
    await appendFile(jsonlPath, `${JSON.stringify(row)}\n`);
    console.log(
      `[${i + 1}/100] ${fixture.id} ${judgment.verdict.padEnd(9)} n=${String(tracks.length).padStart(2)}/${fixture.length} ` +
        `${fixture.difficulty} ${Math.round(row.ms / 1000)}s — ${fixture.prompt.slice(0, 48)}`,
    );
  }

  const counts = {
    SAVE: results.filter((r) => r.judgment.verdict === "SAVE").length,
    MAYBE: results.filter((r) => r.judgment.verdict === "MAYBE").length,
    SKIP: results.filter((r) => r.judgment.verdict === "SKIP").length,
    REFUSE_OK: results.filter((r) => r.judgment.verdict === "REFUSE_OK").length,
    EMPTY_BAD: results.filter((r) => r.judgment.verdict === "EMPTY_BAD").length,
  };
  const keepable = counts.SAVE + counts.MAYBE + counts.REFUSE_OK;
  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    userId: creds.spotifyUserId,
    counts,
    keepableRate: +(keepable / results.length).toFixed(3),
    wouldSaveRate: +(counts.SAVE / results.length).toFixed(3),
    wouldSkipRate: +((counts.SKIP + counts.EMPTY_BAD) / results.length).toFixed(3),
    avgMs: Math.round(results.reduce((a, r) => a + r.ms, 0) / Math.max(1, results.length)),
    byDifficulty: Object.fromEntries(
      (["easy", "medium", "hard", "edge"] as const).map((d) => {
        const rows = results.filter((r) => r.difficulty === d);
        return [
          d,
          {
            n: rows.length,
            SAVE: rows.filter((r) => r.judgment.verdict === "SAVE").length,
            MAYBE: rows.filter((r) => r.judgment.verdict === "MAYBE").length,
            SKIP: rows.filter((r) => r.judgment.verdict === "SKIP").length,
            REFUSE_OK: rows.filter((r) => r.judgment.verdict === "REFUSE_OK").length,
            EMPTY_BAD: rows.filter((r) => r.judgment.verdict === "EMPTY_BAD").length,
          },
        ];
      }),
    ),
    results,
  };

  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  const md: string[] = [
    "# Human 100 — Save / Keep Listen Review",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `**Would save:** ${counts.SAVE}/100`,
    `**Maybe (listen with skips):** ${counts.MAYBE}/100`,
    `**Would skip / abandon:** ${counts.SKIP}/100`,
    `**Honest refuse (OK):** ${counts.REFUSE_OK}/100`,
    `**Empty bad:** ${counts.EMPTY_BAD}/100`,
    "",
    `Keepable (SAVE+MAYBE+honest refuse): **${keepable}%**`,
    "",
    "## By difficulty",
    "",
  ];
  for (const [d, c] of Object.entries(summary.byDifficulty) as Array<[string, Record<string, number>]>) {
    md.push(`- **${d}** (n=${c.n}): SAVE ${c.SAVE} · MAYBE ${c.MAYBE} · SKIP ${c.SKIP} · REFUSE_OK ${c.REFUSE_OK} · EMPTY_BAD ${c.EMPTY_BAD}`);
  }
  md.push("", "## Playlist-by-playlist", "");
  for (const r of results) {
    md.push(`### ${r.id} — \`${r.prompt}\``);
    md.push("");
    md.push(`- **Verdict:** ${r.judgment.verdict} — ${r.judgment.why}`);
    md.push(`- **Difficulty / family:** ${r.difficulty} / ${r.family}`);
    md.push(`- **Length:** ${r.tracks.length}/${r.length} · ${r.ms}ms · HTTP ${r.httpStatus}`);
    if (r.judgment.contaminants.length) md.push(`- Contaminants: ${r.judgment.contaminants.join("; ")}`);
    if (r.judgment.blankets.length) md.push(`- Safety blankets: ${r.judgment.blankets.join("; ")}`);
    if (r.message) md.push(`- Message: ${String(r.message).slice(0, 180)}`);
    md.push("");
    if (r.tracks.length) {
      md.push("| # | Artist | Title | Family |");
      md.push("|---|--------|-------|--------|");
      r.tracks.slice(0, 12).forEach((t, i) => {
        md.push(`| ${i + 1} | ${t.artist} | ${t.title} | ${t.genreFamily ?? "—"} |`);
      });
      if (r.tracks.length > 12) md.push(`| … | +${r.tracks.length - 12} more | | |`);
      md.push("");
    }
  }
  await writeFile(path.join(outDir, "HUMAN_REVIEW.md"), md.join("\n"));

  console.log("\n=== HUMAN 100 SUMMARY ===");
  console.log(JSON.stringify(counts));
  console.log(`wouldSave=${summary.wouldSaveRate} keepable=${summary.keepableRate} skip=${summary.wouldSkipRate} avgMs=${summary.avgMs}`);
  console.log(`Wrote ${path.join(outDir, "summary.json")} and HUMAN_REVIEW.md`);

  if (counts.SKIP + counts.EMPTY_BAD > 40) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
