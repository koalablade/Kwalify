/**
 * Editorial save/keep judge for human-language playlist benchmarks.
 */
import {
  inferWorldIdentityIdsFromPrompt,
  isSafetyBlanketOutsideWorld,
  countPsychIndieOpenerFillers,
} from "../core/editorial/world-identity-gate";
import { scoreFeelGoodLanePurity } from "../core/editorial/world-coherence-score";

export type TrackRow = {
  artist: string;
  title: string;
  energy: number | null;
  genreFamily: string | null;
  genrePrimary: string | null;
};

export type SaveVerdict = "SAVE" | "PARTIAL_OK" | "MAYBE" | "SKIP" | "REFUSE_OK" | "EMPTY_BAD";

const SAFETY =
  /\b(?:blondie|fleetwood\s+mac|queen\b(?!\s+of\s+the\s+stone)|led\s+zeppelin|men\s+at\s+work|journey|bon\s+jovi|meat\s+loaf|storm\s+queen|tame\s+impala|kasabian|q\s+lazzarus|glenn\s+frey|arctic\s+monkeys)\b/i;

const OPENER_FILLER =
  /\b(?:kasabian|q\s+lazzarus|tame\s+impala|glenn\s+frey|arctic\s+monkeys)\b/i;

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

export function asTracks(raw: unknown): TrackRow[] {
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

export function extractHumanQualityGate(data: Record<string, unknown>): { action?: string } | null {
  const top = data.humanQualityGate;
  if (top && typeof top === "object") return top as { action?: string };
  const fin = data.finalization;
  if (fin && typeof fin === "object") {
    const gate = (fin as Record<string, unknown>).humanQualityGate;
    if (gate && typeof gate === "object") return gate as { action?: string };
  }
  return null;
}

export function judgeHuman(opts: {
  family: string;
  prompt: string;
  tracks: TrackRow[];
  asked: number;
  httpStatus: number;
  message: string | null;
  humanQualityGate?: { action?: string } | null;
}): {
  verdict: SaveVerdict;
  why: string;
  contaminants: string[];
  blankets: string[];
  uniqueArtists: number;
  worldFeel: "one_world" | "mixed" | "broken" | "empty";
} {
  const { tracks, asked, httpStatus, message, family, prompt, humanQualityGate } = opts;
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
  const underfill = n > 0 && n < asked * 0.6;
  const severeUnderfill = n > 0 && n < asked * 0.45;
  const families = tracks.map((t) => (t.genreFamily || "").toLowerCase()).filter(Boolean);
  const famCounts = new Map<string, number>();
  for (const f of families) famCounts.set(f, (famCounts.get(f) ?? 0) + 1);
  const topFamShare = families.length
    ? Math.max(...[...famCounts.values()]) / families.length
    : 0;
  const uniqueFamilies = new Set(families).size;
  const isHonestPartial = humanQualityGate?.action === "honest_partial";

  const openerFillerCount = countPsychIndieOpenerFillers(
    tracks.map((t) => ({ artistName: t.artist })),
    3,
    worldIds.length ? worldIds : undefined,
  );
  if (openerFillerCount >= 2) {
    const openerFillers = tracks.slice(0, 3).filter((t) => {
      if (!OPENER_FILLER.test(t.artist)) return false;
      return isSafetyBlanketOutsideWorld(t.artist, worldIds.length ? worldIds : [family]);
    });
    return {
      verdict: "SKIP",
      why: `Opener filler chain (${openerFillers.map((t) => t.artist).join(" → ")}) — algorithm smell`,
      contaminants,
      blankets,
      uniqueArtists,
      worldFeel: "broken",
    };
  }

  if (worldIds.includes("feel_good_world") || /\b(?:happy vibes|feel good)\b/i.test(prompt)) {
    const lane = scoreFeelGoodLanePurity(
      tracks.map((t) => ({ artistName: t.artist, genreFamily: t.genreFamily, genrePrimary: t.genrePrimary })),
    );
    if (!lane.ok && n >= 6) {
      return {
        verdict: "MAYBE",
        why: `Feel-good lane mash — only ${Math.round(lane.purity * 100)}% funk/disco/soul/pop`,
        contaminants,
        blankets,
        uniqueArtists,
        worldFeel: "mixed",
      };
    }
  }

  if (n === 0) {
    const honest =
      httpStatus === 409 ||
      httpStatus === 422 ||
      /world_hard_lock|recovery|identity|would not|library does not|latin\s*\/\s*reggaeton|deliverable tracks/i.test(String(message ?? ""));
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
  if (uniqueFamilies >= 3 && topFamShare < 0.5 && n >= 8) {
    return {
      verdict: "MAYBE",
      why: `Genre mash — ${uniqueFamilies} families without a dominant world`,
      contaminants,
      blankets,
      uniqueArtists,
      worldFeel: "mixed",
    };
  }
  if (severeUnderfill && topFamShare >= 0.5 && isHonestPartial) {
    return {
      verdict: "PARTIAL_OK",
      why: "Honest partial in one world — would keep and maybe expand later",
      contaminants,
      blankets,
      uniqueArtists,
      worldFeel: "one_world",
    };
  }
  if (underfill && !isHonestPartial) {
    return {
      verdict: "PARTIAL_OK",
      why: "Thin list without honest_partial flag — demoted from SAVE",
      contaminants,
      blankets,
      uniqueArtists,
      worldFeel: topFamShare >= 0.5 ? "one_world" : "mixed",
    };
  }
  if (underfill && topFamShare >= 0.5) {
    return {
      verdict: "PARTIAL_OK",
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

export function slugifyPrompt(prompt: string, max = 48): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export function renderPlaylistMarkdown(row: {
  id: string;
  prompt: string;
  mode: string;
  length: number;
  difficulty: string;
  family: string;
  httpStatus: number;
  ms: number;
  tracks: TrackRow[];
  message: string | null;
  judgment: ReturnType<typeof judgeHuman>;
}): string {
  const lines: string[] = [
    `# ${row.id} — ${row.prompt}`,
    "",
    `**Would I keep?** ${row.judgment.verdict} — ${row.judgment.why}`,
    "",
    `- **Family / difficulty:** ${row.family} / ${row.difficulty}`,
    `- **Mode / length:** ${row.mode} / ${row.tracks.length}/${row.length} tracks`,
    `- **World feel:** ${row.judgment.worldFeel}`,
    `- **Unique artists:** ${row.judgment.uniqueArtists}`,
    `- **HTTP:** ${row.httpStatus} · **Time:** ${Math.round(row.ms / 1000)}s`,
  ];
  if (row.judgment.contaminants.length) {
    lines.push(`- **Contaminants:** ${row.judgment.contaminants.join("; ")}`);
  }
  if (row.judgment.blankets.length) {
    lines.push(`- **Safety blankets:** ${row.judgment.blankets.join("; ")}`);
  }
  if (row.message) lines.push(`- **API message:** ${String(row.message).slice(0, 240)}`);
  lines.push("", "## Tracks", "", "| # | Artist | Title | Family |", "|---|--------|-------|--------|");
  if (row.tracks.length === 0) {
    lines.push("| — | *(empty)* | | |");
  } else {
    row.tracks.forEach((t, i) => {
      lines.push(`| ${i + 1} | ${t.artist} | ${t.title} | ${t.genreFamily ?? "—"} |`);
    });
  }
  lines.push("");
  return lines.join("\n");
}
