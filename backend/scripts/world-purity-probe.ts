/**
 * World-purity ROI probe — focused live generate for contamination prompts.
 * Compares output to human editorial prototypes + known safety-blanket contaminants.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { spawnLocalServer } from "../lib/benchmark-local-server";
import { analyzeVibe } from "../lib/emotion";
import { buildLockedIntent } from "../core/v3/intent";
import { resolveSceneLock } from "../core/scene-lock-mode";
import { resolveWorldBoundary } from "../core/world-boundary";
import {
  inferWorldIdentityIdsFromPrompt,
  isSafetyBlanketOutsideWorld,
} from "../core/editorial/world-identity-gate";
import { resolveSceneFallbackChain } from "../core/editorial/scene-fallback-chains";
import type { IntentState } from "../core/intent-state-engine";

type ProbePrompt = {
  id: string;
  prompt: string;
  length: number;
  mode: "strict" | "balanced";
  /** Artists / tokens that belong in a human editorial of this world. */
  humanKeep: RegExp;
  /** Artists that break immersion (from listening failures). */
  humanSkip: RegExp;
  /** Real-world editorial reference (Spotify / Pitchfork style). */
  humanReference: string;
};

const PROMPTS: ProbePrompt[] = [
  {
    id: "genre-grunge",
    prompt: "90s grunge dark cloudy night",
    length: 25,
    mode: "strict",
    humanKeep:
      /\b(?:nirvana|pearl\s+jam|soundgarden|alice\s+in\s+chains|stone\s+temple|hole\b|mudhoney|foo\s+fighters|smashing\s+pumpkins|bush\b|temple\s+of\s+the\s+dog|silverchair|offspring|green\s+day|screaming\s+trees)\b/i,
    humanSkip:
      /\b(?:blondie|men\s+at\s+work|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|journey|bon\s+jovi|abba)\b/i,
    humanReference:
      "Spotify 90s Grunge Alternative Mix / Pitchfork grunge — Nirvana, Pearl Jam, Soundgarden, AIC, STP, Bush, Hole",
  },
  {
    id: "goth-danceable",
    prompt: "goth but danceable",
    length: 25,
    mode: "strict",
    humanKeep:
      /\b(?:the\s+cure|siouxsie|bauhaus|sisters\s+of\s+mercy|depeche\s+mode|joy\s+division|new\s+order|cocteau|clan\s+of\s+xymox|type\s+o|she\s+wants\s+revenge|soft\s+kill|boy\s+harsher|lebanon\s+hanover|fields\s+of\s+the\s+nephilim|christian\s+death|industrial|darkwave)\b/i,
    humanSkip:
      /\b(?:queen\b(?!\s+of\s+the\s+stone)|fleetwood\s+mac|led\s+zeppelin|blondie|ac\/?dc|guns\s+n'?\s*roses|men\s+at\s+work|journey|bon\s+jovi)\b/i,
    humanReference:
      "Human goth/darkwave dancefloors — The Cure, Siouxsie, Bauhaus, Sisters of Mercy, Depeche Mode, Joy Division, industrial/darkwave",
  },
  {
    id: "gym-angry-rock",
    prompt: "angry rock workout no slow songs",
    length: 25,
    mode: "strict",
    humanKeep:
      /\b(?:metallica|rage\s+against|system\s+of\s+a\s+down|slipknot|foo\s+fighters|ac\/?dc|disturbed|linkin\s+park|tool\b|nine\s+inch|queens?\s+of\s+the\s+stone|godsmack|korn|pantera|offspring)\b/i,
    humanSkip:
      /\b(?:fleetwood\s+mac|blondie|storm\s+queen|bee\s+gees|abba|men\s+at\s+work|journey|queen\b(?!\s+of\s+the\s+stone))\b/i,
    humanReference:
      "Human angry-rock gym lists — Metallica, RATM, SOAD, Slipknot, Foo Fighters, AC/DC, Linkin Park (not soft classic / dance)",
  },
  {
    id: "gym-2000s-pop-punk",
    prompt: "2000s pop punk gym workout",
    length: 30,
    mode: "balanced",
    humanKeep:
      /\b(?:blink[-\s]?182|green\s+day|sum\s+41|paramore|jimmy\s+eat\s+world|all[-\s]?american\s+rejects|fall\s+out\s+boy|my\s+chemical|new\s+found\s+glory|good\s+charlotte|simple\s+plan|yellowcard|taking\s+back\s+sunday)\b/i,
    humanSkip:
      /\b(?:fleetwood\s+mac|blondie|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|ac\/?dc|men\s+at\s+work|storm\s+queen)\b/i,
    humanReference:
      "Human 2000s pop-punk gym — Blink-182, Green Day, Sum 41, Paramore, Jimmy Eat World, AAR, FOB",
  },
  {
    id: "era-70s-rock",
    prompt: "70s rock evening",
    length: 25,
    mode: "strict",
    humanKeep:
      /\b(?:led\s+zeppelin|queen\b(?!\s+of\s+the\s+stone)|fleetwood\s+mac|pink\s+floyd|the\s+who|deep\s+purple|black\s+sabbath|david\s+bowie|eagles\b|aerosmith|ac\/?dc|blondie|thin\s+lizzy|bad\s+company)\b/i,
    humanSkip:
      /\b(?:blink[-\s]?182|paramore|drake\b|travis\s+scott|taylor\s+swift|billie\s+eilish|storm\s+queen)\b/i,
    humanReference:
      "Human 70s classic rock evenings — Zeppelin, Queen, Fleetwood Mac, Floyd, Who, Sabbath, Bowie (honest underfill OK)",
  },
  {
    id: "contradictory-sleepy-gym",
    prompt: "sleepy gym workout",
    length: 25,
    mode: "balanced",
    humanKeep:
      /\b(?:chill|downtempo|ambient|lo-?fi|deep\s+house|indie|trip\s+hop|soft|electronic)\b/i,
    humanSkip:
      /\b(?:blondie|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|ac\/?dc|paramore|blink[-\s]?182|drum\s+and\s+bass|dnb)\b/i,
    humanReference:
      "Human sleepy/low-intensity workout — one chill/electronic or soft-indie world, not pop-punk + DnB + classic rock mash",
  },
  {
    id: "genre-metal-gym",
    prompt: "metal gym workout",
    length: 25,
    mode: "strict",
    humanKeep:
      /\b(?:metallica|slipknot|disturbed|pantera|korn|system\s+of\s+a\s+down|lamb\s+of\s+god|avenged|iron\s+maiden|black\s+sabbath|slayer|megadeth)\b/i,
    humanSkip:
      /\b(?:blondie|fleetwood\s+mac|storm\s+queen|bee\s+gees|men\s+at\s+work|journey)\b/i,
    humanReference: "Human metal gym — metal/hardcore core, no soft classic or dance fillers",
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
    } else if (fixture.humanSkip.test(t.artist)) {
      // already in skipHits
    }
  }
  const energies = tracks.map((t) => t.energy).filter((e): e is number => e != null);
  const avgE = energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : null;
  const uniqueArtists = new Set(tracks.map((t) => t.artist.toLowerCase())).size;
  const keepRate = tracks.length ? keepHits.length / tracks.length : 0;
  const skipRate = tracks.length ? skipHits.length / tracks.length : 0;
  const underfill = tracks.length < fixture.length * 0.55;

  let immersion: "pass" | "mixed" | "fail";
  if (skipHits.length === 0 && (keepHits.length >= 2 || keepRate >= 0.15 || underfill)) {
    immersion = keepHits.length > 0 || underfill ? "pass" : "mixed";
  } else if (skipHits.length <= 1 && skipRate <= 0.08) immersion = "mixed";
  else immersion = "fail";

  // Honest underfill with zero contaminants is a pass for era/world purity.
  if (underfill && skipHits.length === 0 && blanketHits.length === 0) immersion = "pass";

  let humanVerdict: string;
  if (immersion === "pass" && skipHits.length === 0) {
    humanVerdict = underfill
      ? "Would keep (honest partial) — stays in one world; length short is fine"
      : "Would keep — matches human editorial world";
  } else if (immersion === "mixed") {
    humanVerdict = "Would listen with skips — mostly right world, some drift";
  } else {
    humanVerdict = "Would abandon — world contamination / wrong universe";
  }

  return {
    immersion,
    humanVerdict,
    keepHits,
    skipHits,
    blanketHits,
    keepCount: keepHits.length,
    skipCount: skipHits.length,
    blanketCount: blanketHits.length,
    keepRate: +keepRate.toFixed(3),
    skipRate: +skipRate.toFixed(3),
    avgEnergy: avgE == null ? null : +avgE.toFixed(3),
    uniqueArtists,
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
      // Prefer local server so purity changes under test are exercised.
      baseUrl: process.env.WORLD_PURITY_BASE_URL || "http://127.0.0.1:5000",
    },
  });
  const { shutdown, baseUrl } = await spawnLocalServer(creds.baseUrl, creds.token, "world-purity");
  const userId = creds.spotifyUserId;
  const emptyIntent = {} as IntentState;

  const results = [];
  try {
    for (const fixture of PROMPTS) {
      const worldIds = inferWorldIdentityIdsFromPrompt(fixture.prompt);
      const lock = resolveSceneLock(emptyIntent, fixture.prompt);
      const world = resolveWorldBoundary({ sceneLock: lock, prompt: fixture.prompt });
      const chain = resolveSceneFallbackChain(fixture.prompt);
      const locked = buildLockedIntent(fixture.prompt);
      const profile = analyzeVibe(fixture.prompt);
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
          spotifyUserId: userId,
          auditMode: true,
          allowDbWrites: false,
          allowSpotifyCreate: false,
          evaluationPromptId: fixture.id,
          evaluationCategory: "world_purity",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const tracks = asTracks(data.tracks);
      const judgment = judge(tracks, fixture, worldIds.length ? worldIds : world.lockAnchors);
      const row = {
        id: fixture.id,
        prompt: fixture.prompt,
        mode: fixture.mode,
        httpStatus: response.status,
        ok: response.ok && tracks.length > 0,
        ms: Date.now() - started,
        gate: {
          inferredWorlds: worldIds,
          sceneLockAnchors: lock.anchors,
          worldHardLock: world.hardLock,
          worldReason: world.reason,
          fallbackChain: chain?.id ?? null,
          lockedGenres: locked.genreFamilies,
          lockedEra: locked.eraRange ?? null,
          vibeEnergy: profile.energy,
        },
        humanReference: fixture.humanReference,
        judgment,
        tracks,
        diagnostics: {
          playlistConfidence: data.playlistConfidence ?? null,
          degradedDelivery: data.degradedDelivery ?? null,
          humanQualityGate: data.humanQualityGate ?? null,
          message: data.message ?? data.userMessage ?? null,
        },
      };
      results.push(row);
      console.log(
        `\n=== ${fixture.id} — "${fixture.prompt}" ===\n` +
          `n=${tracks.length}/${fixture.length} immersion=${judgment.immersion} keep=${judgment.keepCount} skip=${judgment.skipCount} blankets=${judgment.blanketCount}\n` +
          `worlds=${worldIds.join(",") || "none"} lock=${lock.anchors.join(",") || "none"} chain=${chain?.id ?? "none"}\n` +
          `verdict: ${judgment.humanVerdict}`,
      );
      for (const [i, t] of tracks.entries()) {
        const flag = fixture.humanSkip.test(`${t.artist} ${t.title}`)
          ? " SKIP"
          : fixture.humanKeep.test(`${t.artist} ${t.title}`)
            ? " KEEP"
            : "";
        console.log(
          `  ${String(i + 1).padStart(2)}. ${t.artist} — ${t.title}` +
            (t.energy != null ? `  [e=${t.energy.toFixed(2)}]` : "") +
            flag,
        );
      }
      if (judgment.skipHits.length) console.log(`  contaminants: ${judgment.skipHits.join(" | ")}`);
    }
  } finally {
    shutdown();
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    userId,
    promptCount: results.length,
    immersionPass: results.filter((r) => r.judgment.immersion === "pass").length,
    immersionMixed: results.filter((r) => r.judgment.immersion === "mixed").length,
    immersionFail: results.filter((r) => r.judgment.immersion === "fail").length,
    totalSkipHits: results.reduce((a, r) => a + r.judgment.skipCount, 0),
    totalBlanketHits: results.reduce((a, r) => a + r.judgment.blanketCount, 0),
    results,
  };

  const outDir = path.join("reports", "playlist-evaluation", "world-purity-probe");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "results.json"), JSON.stringify(summary, null, 2));

  const md: string[] = [
    "# World Purity Probe — Live Results",
    "",
    `Generated: ${summary.generatedAt}`,
    `Immersion: **${summary.immersionPass} pass** / ${summary.immersionMixed} mixed / ${summary.immersionFail} fail`,
    `Contaminant hits: ${summary.totalSkipHits} | Safety-blanket hits: ${summary.totalBlanketHits}`,
    "",
  ];
  for (const r of results) {
    md.push(`## ${r.id} — \`${r.prompt}\``);
    md.push("");
    md.push(`- **Human reference:** ${r.humanReference}`);
    md.push(`- **Length:** ${r.judgment.got}/${r.judgment.asked}${r.judgment.underfill ? " (honest underfill)" : ""}`);
    md.push(`- **Immersion:** ${r.judgment.immersion} — ${r.judgment.humanVerdict}`);
    md.push(`- **World gate:** ${r.gate.inferredWorlds.join(", ") || "none"} | hardLock=${r.gate.worldHardLock} | chain=${r.gate.fallbackChain}`);
    md.push(`- **Keep prototypes:** ${r.judgment.keepCount} | **Skip contaminants:** ${r.judgment.skipCount}`);
    if (r.judgment.skipHits.length) md.push(`- Contaminants: ${r.judgment.skipHits.join("; ")}`);
    md.push("");
    md.push("| # | Artist | Title | Energy | Tag |");
    md.push("|---|--------|-------|--------|-----|");
    r.tracks.forEach((t, i) => {
      const tag = r.judgment.skipHits.some((h) => h.startsWith(t.artist))
        ? "SKIP"
        : r.judgment.keepHits.some((h) => h.startsWith(`${t.artist} —`))
          ? "KEEP"
          : "";
      md.push(
        `| ${i + 1} | ${t.artist} | ${t.title} | ${t.energy?.toFixed(2) ?? "—"} | ${tag} |`,
      );
    });
    md.push("");
  }
  await writeFile(path.join(outDir, "RESULTS.md"), md.join("\n"));
  console.log(`\nWrote ${path.join(outDir, "results.json")} and RESULTS.md`);
  console.log(
    `SUMMARY: pass=${summary.immersionPass} mixed=${summary.immersionMixed} fail=${summary.immersionFail} skips=${summary.totalSkipHits} blankets=${summary.totalBlanketHits}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
