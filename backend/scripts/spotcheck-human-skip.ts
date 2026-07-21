/**
 * End-to-end audit spot-check for the six human "would not keep" failures.
 * Spawns a local API with PLAYLIST_EVAL_TOKEN from .env.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { spawnLocalServer } from "../lib/benchmark-local-server";
import { resolveSceneLock } from "../core/scene-lock-mode";
import { resolveWorldBoundary } from "../core/world-boundary";
import {
  inferWorldIdentityIdsFromPrompt,
  isSafetyBlanketOutsideWorld,
} from "../core/editorial/world-identity-gate";
import type { IntentState } from "../core/intent-state-engine";

type ProbePrompt = {
  id: string;
  prompt: string;
  length: number;
  mode: "strict" | "balanced";
  humanKeep: RegExp;
  humanSkip: RegExp;
  humanReference: string;
};

const PROMPTS: ProbePrompt[] = [
  {
    id: "rainy-highway",
    prompt: "rainy highway night drive",
    length: 25,
    mode: "strict",
    humanKeep:
      /\b(?:the\s+national|war\s+on\s+drugs|beach\s+house|radiohead|bon\s+iver|phoebe\s+bridgers|sufjan|m83|sigur|explosions\s+in\s+the\s+sky|cinematic\s+orchestra|washes?|slowdive|real\s+estate)\b/i,
    humanSkip:
      /\b(?:queen\b(?!\s+of\s+the\s+stone)|blondie|fleetwood\s+mac|led\s+zeppelin|highwaymen|johnny\s+cash|dmx\b|storm\s+queen|tiesto|tiësto|meat\s+loaf|joyner\s+lucas|drake\b)\b/i,
    humanReference: "Indie / dream-drive rainy highway — not classic rock or outlaw country title bait",
  },
  {
    id: "cozy-rainy",
    prompt: "cozy rainy night chill",
    length: 25,
    mode: "balanced",
    humanKeep:
      /\b(?:iron\s+&\s+wine|iron\s+and\s+wine|bon\s+iver|sufjan|beach\s+house|phoebe|fleet\s+foxes|jose\s+gonzalez|elliott\s+smith|nick\s+drake|the\s+national|washes?)\b/i,
    humanSkip:
      /\b(?:dmx\b|50\s+cent|eminem|metallica|ac\/?dc|queen\b(?!\s+of\s+the\s+stone)|blondie|storm\s+queen)\b/i,
    humanReference: "Soft indie/folk rainy chill — not hardcore hip-hop",
  },
  {
    id: "heavy-lifting",
    prompt: "heavy lifting gym pump aggressive",
    length: 25,
    mode: "strict",
    humanKeep:
      /\b(?:metallica|rage\s+against|system\s+of\s+a\s+down|slipknot|foo\s+fighters|ac\/?dc|disturbed|linkin\s+park|tool\b|nine\s+inch|queens?\s+of\s+the\s+stone|godsmack|korn|pantera|offspring|green\s+day)\b/i,
    humanSkip:
      /\b(?:storm\s+queen|craig\s+david|hannah\s+laing|kurupt\s+fm|artful\s+dodger|conducta|blondie|fleetwood\s+mac|bee\s+gees|abba)\b|(?<!\bstorm\s)\bqueen\b(?!\s+of\s+the\s+stone)/i,
    humanReference: "Aggressive rock/metal gym — not UKG / club house",
  },
  {
    id: "70s-disco",
    prompt: "70s disco party",
    length: 25,
    mode: "strict",
    humanKeep:
      /\b(?:bee\s+gees|chic\b|donna\s+summer|abba|boney\s+m|earth[,\s]+wind|kc\s+and\s+the\s+sunshine|gloria\s+gaynor|sylvester|chaka\s+khan|kool\s+&\s+the\s+gang|jackson\s+5|stevie\s+wonder|disco|funk)\b/i,
    humanSkip:
      /\b(?:black\s+sabbath|metallica|slayer|iron\s+maiden|pantera|led\s+zeppelin|ac\/?dc|guns\s+n'?\s*roses)\b/i,
    humanReference: "70s disco / funk party — not metal",
  },
  {
    id: "deep-focus",
    prompt: "deep focus study session no distractions",
    length: 25,
    mode: "balanced",
    humanKeep:
      /\b(?:nujabes|bonobo|brian\s+eno|max\s+richter|nils\s+frahm|boards\s+of\s+canada|tomppabeats|emancipator|ludovico|yiruma|go[-\s]?go\s+penguin|lo-?fi|ambient|instrumental|classical)\b/i,
    humanSkip:
      /\b(?:olivia\s+rodrigo|taylor\s+swift|girl\s+in\s+red|billie\s+eilish|doja\s+cat|drake\b|paramore|sabrina\s+carpenter|ariana\s+grande|dua\s+lipa)\b/i,
    humanReference: "Instrumental / ambient / lofi focus — not lyrical pop ballads",
  },
  {
    id: "90s-neon",
    prompt: "90s neon night drive",
    length: 25,
    mode: "strict",
    humanKeep:
      /\b(?:kavinsky|carpenter\s+brut|perturbator|fm[-\s]?84|the\s+midnight|gunship|timecop|com\s+truise|miami\s+nights|daft\s+punk|justice|lcd\s+soundsystem|synthwave|retrowave|italo|eurodance|new\s+wave)\b/i,
    humanSkip:
      /\b(?:hard\s+techno|tekkno|tekno|french\s+montana|grima\s+x\s+azza|hannah\s+laing|fleetwood\s+mac|led\s+zeppelin|queen\b(?!\s+of\s+the\s+stone))\b/i,
    humanReference: "Synthwave / 90s electronic neon drive — not tekkno or trap",
  },
];

const SAFETY_BLANKETS =
  /\b(?:blondie|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|ac\/?dc|guns\s+n'?\s*roses|men\s+at\s+work|journey|bon\s+jovi|def\s+leppard|storm\s+queen)\b/i;

type TrackRow = {
  artist: string;
  title: string;
  energy: number | null;
  genreFamily: string | null;
  genrePrimary: string | null;
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

function judge(tracks: TrackRow[], fixture: ProbePrompt, worldIds: string[]) {
  const keepHits: string[] = [];
  const skipHits: string[] = [];
  const blanketHits: string[] = [];
  for (const t of tracks) {
    const blob = `${t.artist} ${t.title}`;
    if (fixture.humanKeep.test(blob)) keepHits.push(`${t.artist} — ${t.title}`);
    if (fixture.humanSkip.test(blob)) skipHits.push(`${t.artist} — ${t.title}`);
    if (SAFETY_BLANKETS.test(t.artist) && isSafetyBlanketOutsideWorld(t.artist, worldIds)) {
      blanketHits.push(`${t.artist} — ${t.title}`);
    }
  }
  const underfill = tracks.length < fixture.length * 0.55;
  const skipRate = tracks.length ? skipHits.length / tracks.length : 0;

  let immersion: "pass" | "mixed" | "fail";
  if (skipHits.length === 0 && blanketHits.length === 0) {
    immersion = tracks.length === 0 ? "fail" : underfill || keepHits.length > 0 ? "pass" : "mixed";
  } else if (skipHits.length <= 1 && skipRate <= 0.08 && blanketHits.length === 0) {
    immersion = "mixed";
  } else {
    immersion = "fail";
  }
  if (underfill && skipHits.length === 0 && blanketHits.length === 0 && tracks.length > 0) {
    immersion = "pass";
  }

  const humanVerdict =
    immersion === "pass"
      ? underfill
        ? "Would keep (honest partial) — stays in world"
        : "Would keep — no skip contaminants"
      : immersion === "mixed"
        ? "Would listen with skips — mostly right world"
        : tracks.length === 0
          ? "Empty / refused — check honest partial messaging"
          : "Would abandon — world contamination";

  return {
    immersion,
    humanVerdict,
    keepHits,
    skipHits,
    blanketHits,
    keepCount: keepHits.length,
    skipCount: skipHits.length,
    blanketCount: blanketHits.length,
    underfill,
    asked: fixture.length,
    got: tracks.length,
  };
}

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: "http://127.0.0.1:5000",
    cli: {
      baseUrl: process.env.SPOTCHECK_BASE_URL || "http://127.0.0.1:5000",
    },
  });
  console.log(`[spotcheck] spawning local API with eval token (len=${creds.token.length})…`);
  const { shutdown, baseUrl } = await spawnLocalServer(creds.baseUrl, creds.token, "spotcheck-human-skip");
  console.log(`[spotcheck] ready at ${baseUrl} user=${creds.spotifyUserId}`);
  const emptyIntent = {} as IntentState;
  const results = [];

  try {
    for (const fixture of PROMPTS) {
      const worldIds = inferWorldIdentityIdsFromPrompt(fixture.prompt);
      const lock = resolveSceneLock(emptyIntent, fixture.prompt);
      const world = resolveWorldBoundary({ sceneLock: lock, prompt: fixture.prompt });
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
          evaluationPromptId: fixture.id,
          evaluationCategory: "human_skip_spotcheck",
          evaluationTimeoutMs: 240_000,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const tracks = asTracks(data.tracks);
      const judgment = judge(tracks, fixture, worldIds.length ? worldIds : world.lockAnchors);
      const row = {
        id: fixture.id,
        prompt: fixture.prompt,
        httpStatus: response.status,
        ok: response.ok,
        ms: Date.now() - started,
        gate: {
          inferredWorlds: worldIds,
          sceneLockAnchors: lock.anchors,
          worldHardLock: world.hardLock,
        },
        humanReference: fixture.humanReference,
        judgment,
        tracks,
        message: data.message ?? data.userMessage ?? data.error ?? null,
        humanQualityGate: data.humanQualityGate ?? null,
      };
      results.push(row);

      console.log(
        `\n=== ${fixture.id} — "${fixture.prompt}" ===\n` +
          `http=${response.status} n=${tracks.length}/${fixture.length} immersion=${judgment.immersion} ` +
          `keep=${judgment.keepCount} skip=${judgment.skipCount} blankets=${judgment.blanketCount} (${row.ms}ms)\n` +
          `worlds=${worldIds.join(",") || "none"} lock=${lock.anchors.join(",") || "none"} hardLock=${world.hardLock}\n` +
          `verdict: ${judgment.humanVerdict}`,
      );
      for (const [i, t] of tracks.slice(0, 15).entries()) {
        const flag = fixture.humanSkip.test(`${t.artist} ${t.title}`)
          ? " SKIP"
          : fixture.humanKeep.test(`${t.artist} ${t.title}`)
            ? " KEEP"
            : "";
        console.log(
          `  ${String(i + 1).padStart(2)}. ${t.artist} — ${t.title}` +
            (t.genreFamily ? ` [${t.genreFamily}]` : "") +
            flag,
        );
      }
      if (tracks.length > 15) console.log(`  … +${tracks.length - 15} more`);
      if (judgment.skipHits.length) console.log(`  contaminants: ${judgment.skipHits.join(" | ")}`);
      if (row.message) console.log(`  message: ${String(row.message).slice(0, 200)}`);
    }
  } finally {
    shutdown();
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    userId: creds.spotifyUserId,
    immersionPass: results.filter((r) => r.judgment.immersion === "pass").length,
    immersionMixed: results.filter((r) => r.judgment.immersion === "mixed").length,
    immersionFail: results.filter((r) => r.judgment.immersion === "fail").length,
    totalSkipHits: results.reduce((a, r) => a + r.judgment.skipCount, 0),
    totalBlanketHits: results.reduce((a, r) => a + r.judgment.blanketCount, 0),
    results,
  };

  const outDir = path.join("reports", "playlist-evaluation", "spotcheck-human-skip");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "results.json"), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${path.join(outDir, "results.json")}`);
  console.log(
    `SUMMARY: pass=${summary.immersionPass} mixed=${summary.immersionMixed} fail=${summary.immersionFail} ` +
      `skips=${summary.totalSkipHits} blankets=${summary.totalBlanketHits}`,
  );

  if (summary.immersionFail > 0 || summary.totalSkipHits > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
