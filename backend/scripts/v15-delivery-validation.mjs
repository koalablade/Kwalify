/**
 * V15 delivery + retrieval recovery validation — 8 prompts, compare vs V14.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolveLiveBenchmarkCredentials } from "../dist/lib/benchmark-env.js";
import { parseHumanSaveabilityFromGenerateResponse } from "../dist/lib/human-saveability-benchmark-parse.js";
import { resolveCommittedWorld } from "../dist/core/committed-world.js";
import {
  scoreTrackWorldIdentity,
  resolveCulturalProfileForCommitted,
} from "../dist/core/editorial/world-identity-score.js";
import { applyWorldPurityGate } from "../dist/core/editorial/world-purity-gate.js";

const PROMPTS = [
  { id: "dad_rock_bbq", prompt: "dad rock BBQ with beers", v14Count: 10 },
  { id: "80s_night_drive", prompt: "80s night drive", v14Count: 5 },
  { id: "motorway_rain", prompt: "empty motorway at midnight rain on the windscreen", v14Count: 3 },
  { id: "madchester", prompt: "madchester pub walk", v14Count: 3 },
  { id: "disco", prompt: "disco rooftop party 1978", v14Count: 4 },
  { id: "gym", prompt: "heavy gym workout aggressive", v14Count: 3 },
  { id: "country_cowboy", prompt: "country cowboy road trip", v14Count: 7 },
  { id: "no_rap_gym", prompt: "no rap gym workout", v14Count: 4 },
];

const TAIL_FORBIDDEN = {
  "80s_night_drive": ["fred again", "french montana", "gray squat rave"],
  motorway_rain: ["oasis", "onyx deimos", "david guetta", "tiësto", "tiesto", "avicii"],
  country_cowboy: ["florence", "arctic monkeys", "bon iver", "phoebe bridgers"],
  madchester: ["bon iver", "phoebe bridgers", "sonic youth"],
  disco: ["dua lipa", "the weeknd", "panic"],
  gym: ["paramore", "fall out boy", "green day"],
  dad_rock_bbq: ["bon iver", "phoebe bridgers"],
};

function getHeadCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function tailForbiddenHits(id, tracks) {
  const needles = TAIL_FORBIDDEN[id] ?? [];
  const hits = [];
  for (const t of tracks) {
    const artist = String(t.artistName ?? t.artist ?? "").toLowerCase();
    for (const needle of needles) {
      if (artist.includes(needle)) hits.push(`${t.artistName ?? t.artist} — ${t.trackName ?? t.name}`);
    }
  }
  return hits;
}

function artistDiversity(tracks) {
  const artists = new Set(
    tracks.map((t) => String(t.artistName ?? t.artist ?? "").toLowerCase().trim()).filter(Boolean),
  );
  return artists.size;
}

function classify(id, prompt, tracks, httpStatus, coverageLevel) {
  const committed = resolveCommittedWorld({ prompt });
  const profile = resolveCulturalProfileForCommitted(committed);
  const forbiddenHits = tailForbiddenHits(id, tracks);

  const mapped = tracks.map((t) => ({
    trackName: t.trackName ?? t.name,
    artistName: t.artistName ?? t.artist,
    energy: t.energy ?? null,
  }));

  const purity = committed
    ? applyWorldPurityGate(mapped, committed, { prompt, requestedLength: 25, coverageLevel })
    : null;

  const opener1 = tracks[0];
  const opener1Score = profile && opener1
    ? scoreTrackWorldIdentity(
        { artistName: opener1.artistName ?? opener1.artist, trackName: opener1.trackName ?? opener1.name },
        profile,
      )
    : 0;
  const opener1Ok = opener1Score >= 0.85 || opener1Score >= 0.8;
  const count = tracks.length;
  const diversity = artistDiversity(tracks);

  if (count === 0 || httpStatus === 422) return { verdict: "DROP", why: "empty or refused" };
  if (forbiddenHits.length >= 2) return { verdict: "DROP", why: `forbidden: ${forbiddenHits.join("; ")}` };
  if (forbiddenHits.length === 1) return { verdict: "MAYBE", why: `forbidden: ${forbiddenHits[0]}` };
  if (opener1Ok && count >= 15 && (purity?.wouldStillBelieve ?? true)) {
    return { verdict: "KEEP", why: "V15 layered retrieval + purity maintained" };
  }
  if (opener1Ok && count >= 8) return { verdict: "KEEP", why: "strong opener, honest delivery" };
  if (count >= 3 && opener1Ok) return { verdict: "MAYBE", why: `honest partial ${count}, diversity=${diversity}` };
  return { verdict: "DROP", why: "stub or world drift" };
}

function formatFunnel(funnel) {
  if (!funnel?.stages) return "(no funnel)";
  const s = funnel.stages;
  return [
    `total=${s.totalLibrary}`,
    `genre=${s.afterGenreFilter}`,
    `identity=${s.afterArtistIdentityFilter}`,
    `world=${s.afterWorldFilter}`,
    `scoring=${s.afterScoring}`,
    `final=${s.afterFinalGate}`,
    funnel.recoveryTriggered ? `recovery=${funnel.recoveryLayer}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatDeliveryLossFunnel(funnel) {
  if (!funnel) return "(no deliveryLossFunnel)";
  const keys = [
    "orchestratorFinal",
    "v3PreFilterSurvivors",
    "v3Composed",
    "postPurity",
    "postWorldProof",
    "postTerminal",
    "finalDelivered",
  ];
  return keys.map((k) => `${k}=${funnel[k] ?? "—"}`).join(", ");
}

function formatDeliveryFunnelChain(funnel) {
  if (!funnel) return "—";
  const keys = [
    "orchestratorFinal",
    "v3PreFilterSurvivors",
    "v3Composed",
    "postPurity",
    "postWorldProof",
    "postTerminal",
    "finalDelivered",
  ];
  return keys.map((k) => funnel[k] ?? "—").join(" → ");
}

function parsePuritySubFunnel(data) {
  return (
    data.puritySubFunnel ??
    data.generationDiagnostics?.puritySubFunnel ??
    null
  );
}

function formatPurityChain(sub) {
  if (!sub) return "(no puritySubFunnel)";
  const pre = sub.prePurityCount ?? "—";
  const postFilter = sub.postFilterByWorldPurityCount ?? "—";
  const postCheckpoint = sub.postCheckpointStripCount ?? "—";
  return `${pre} → ${postFilter} → ${postCheckpoint}`;
}

function summarizeRemovalReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return "(none)";
  const counts = new Map();
  for (const reason of reasons) {
    const posMatch = /^pos_(\d+):/.exec(String(reason));
    const key = posMatch ? `pos_${posMatch[1]} score<threshold` : String(reason).split(":")[0] ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`)
    .join("; ");
}

function formatPuritySubFunnelDetail(id, sub) {
  if (!sub) {
    return [
      `${id}`,
      "  delivery: (no deliveryLossFunnel)",
      "  purity:   (no puritySubFunnel)",
      "  removals: (none)",
      "",
    ].join("\n");
  }
  const lines = [
    `${id}`,
    `  purity:   ${formatPurityChain(sub)}`,
    `  hardRejectOffWorld (since v3Composed): ${sub.hardRejectOffWorldCount ?? "—"}`,
    `  checkpointStripApplied: ${sub.checkpointStripApplied ?? "—"}`,
    `  removal summary: ${summarizeRemovalReasons(sub.removedReasons)}`,
  ];
  if (Array.isArray(sub.removedReasons) && sub.removedReasons.length > 0) {
    lines.push("  removals:");
    for (const reason of sub.removedReasons) {
      lines.push(`    ${reason}`);
    }
  } else {
    lines.push("  removals: (none)");
  }
  if (Array.isArray(sub.checkpointDecisions) && sub.checkpointDecisions.length > 0) {
    lines.push("  checkpoint decisions:");
    for (const d of sub.checkpointDecisions) {
      lines.push(
        `    idx_${d.checkpointSurvivorIndex + 1} pos_${d.compositionPosition + 1}:${d.artist} — ${d.track}:${d.score}<${d.threshold} ${d.passed ? "PASS" : "FAIL"}`,
      );
    }
  }
  if (Array.isArray(sub.checkpointRemovedReasons) && sub.checkpointRemovedReasons.length > 0) {
    lines.push("  checkpoint removals:");
    for (const reason of sub.checkpointRemovedReasons) {
      lines.push(`    ${reason}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function fetchGenerate(creds, prompt, requestId) {
  const url = `${creds.baseUrl}/api/generate?audit=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kwalify-evaluation-token": creds.token,
    },
    body: JSON.stringify({
      vibe: prompt,
      mode: "balanced",
      length: 25,
      varietyBoost: true,
      auditMode: true,
      spotifyUserId: creds.spotifyUserId,
      requestId,
      seed: 42,
    }),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const parsed = parseHumanSaveabilityFromGenerateResponse(res.status, data);
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const deliveryLossFunnel =
    data.deliveryLossFunnel ??
    data.generationDiagnostics?.deliveryLossFunnel ??
    null;
  const puritySubFunnel = parsePuritySubFunnel(data);
  return {
    httpStatus: res.status,
    tracks,
    parsed,
    coverageLevel: data.coverageLevel ?? null,
    coverageTier: data.coverageTier ?? null,
    retrievalFunnel: data.retrievalFunnel ?? data.generationDiagnostics?.retrievalFunnel ?? null,
    retrievalConfidence: data.retrievalConfidence ?? null,
    deliveryMessage: data.deliveryMessage ?? null,
    deliveryLossFunnel,
    puritySubFunnel,
  };
}

function formatTrackList(tracks) {
  return tracks.map((t, i) => {
    const artist = t.artistName ?? t.artist ?? "?";
    const name = t.trackName ?? t.name ?? "?";
    return `${String(i + 1).padStart(2)}. ${artist} — ${name}`;
  }).join("\n");
}

async function main() {
  const baseUrl = process.env.KWALIFY_BENCHMARK_BASE_URL ?? "http://127.0.0.1:5000";
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    defaultBaseUrl: baseUrl,
    cli: { baseUrl },
  });
  const head = getHeadCommit();

  const lines = [
    "# V15 Delivery + Retrieval Recovery — Human Validation",
    "",
    "Date: 2026-07-28",
    `Base URL: ${creds.baseUrl}`,
    `Commit: ${head} (V15 retrieval recovery: layered discovery and zero-track elimination)`,
    "",
    "## Method",
    "- V15 fixes retrieval — purity gates unchanged (95/90/85/80)",
    "- Target: 0 zero-track responses, improve KEEP from V14's 0",
    "- Coverage tiers: HIGH/MEDIUM/LOW/VERY_LOW with honest partial delivery",
    "",
    "## Results",
    "",
    "| Prompt | Verdict | V14 | V15 | Δ | Diversity | Tier | Funnel final |",
    "|--------|---------|-----|-----|---|-----------|------|--------------|",
  ];

  const verdicts = [];
  const detailSections = [];
  const purityTableRows = [];
  const purityDetailBlocks = [];
  let zeroTrackCount = 0;

  for (const { id, prompt, v14Count } of PROMPTS) {
    const result = await fetchGenerate(creds, prompt, `v15-${id}-${Date.now()}`);
    const tracks = result.tracks;
    if (tracks.length === 0) zeroTrackCount += 1;
    const forbidden = tailForbiddenHits(id, tracks);
    const diversity = artistDiversity(tracks);
    const { verdict, why } = classify(id, prompt, tracks, result.httpStatus, result.coverageLevel);
    const delta = tracks.length - v14Count;
    verdicts.push(verdict);
    const funnelFinal = result.retrievalFunnel?.stages?.afterFinalGate ?? "—";
    lines.push(
      `| ${id} | ${verdict} | ${v14Count} | ${tracks.length} | ${delta >= 0 ? "+" : ""}${delta} | ${diversity} | ${result.coverageTier ?? result.coverageLevel ?? "—"} | ${funnelFinal} |`,
    );
    const sub = result.puritySubFunnel;
    purityTableRows.push({
      id,
      pre: sub?.prePurityCount ?? "—",
      postFilter: sub?.postFilterByWorldPurityCount ?? "—",
      postCheckpoint: sub?.postCheckpointStripCount ?? "—",
      hardReject: sub?.hardRejectOffWorldCount ?? "—",
      final: result.deliveryLossFunnel?.finalDelivered ?? tracks.length,
      removalSummary: summarizeRemovalReasons(sub?.removedReasons),
    });
    purityDetailBlocks.push(
      `${id}`,
      `  delivery: ${formatDeliveryFunnelChain(result.deliveryLossFunnel)}`,
      `  purity:   ${formatPurityChain(sub)}`,
      `  hardRejectOffWorld (since v3Composed): ${sub?.hardRejectOffWorldCount ?? "—"}`,
      `  removal summary: ${summarizeRemovalReasons(sub?.removedReasons)}`,
      ...(Array.isArray(sub?.removedReasons) && sub.removedReasons.length > 0
        ? ["  removals:", ...sub.removedReasons.map((r) => `    ${r}`)]
        : ["  removals: (none)"]),
      "",
    );
    detailSections.push(
      `### ${id} — ${verdict}`,
      "",
      `Prompt: ${prompt}`,
      `Why: ${why}`,
      `V14 count: ${v14Count} → V15 count: ${tracks.length}`,
      `Retrieval funnel: ${formatFunnel(result.retrievalFunnel)}`,
      `Delivery loss funnel: ${formatDeliveryLossFunnel(result.deliveryLossFunnel)}`,
      `Purity sub-funnel: ${formatPurityChain(sub)}`,
      sub ? `Hard reject off-world (since v3Composed): ${sub.hardRejectOffWorldCount ?? "—"}` : "",
      sub ? `Removal summary: ${summarizeRemovalReasons(sub.removedReasons)}` : "",
      result.retrievalConfidence
        ? `Retrieval confidence: ${result.retrievalConfidence.score} (${result.retrievalConfidence.tier})`
        : "",
      result.deliveryMessage ? `Delivery message: ${result.deliveryMessage}` : "",
      forbidden.length ? `Forbidden hits: ${forbidden.join("; ")}` : "",
      "",
      "**Full track list:**",
      formatTrackList(tracks) || "(empty)",
      "",
      ...(Array.isArray(sub?.removedReasons) && sub.removedReasons.length > 0
        ? ["**Purity removedReasons:**", ...sub.removedReasons.map((r) => `- ${r}`), ""]
        : []),
    );
  }

  const keep = verdicts.filter((v) => v === "KEEP").length;
  const maybe = verdicts.filter((v) => v === "MAYBE").length;
  const drop = verdicts.filter((v) => v === "DROP").length;
  lines.push("");
  lines.push(`**Summary:** ${keep} KEEP / ${maybe} MAYBE / ${drop} DROP`);
  lines.push(`**Zero-track responses:** ${zeroTrackCount}`);
  lines.push("");
  lines.push("## Purity sub-funnel");
  lines.push("");
  lines.push("| Prompt | Pre-purity | Post-filter | Post-checkpoint | Hard off-world removed | Final delivered | Removal summary |");
  lines.push("|--------|----------:|------------:|----------------:|-----------------------:|----------------:|-----------------|");
  for (const row of purityTableRows) {
    lines.push(
      `| ${row.id} | ${row.pre} | ${row.postFilter} | ${row.postCheckpoint} | ${row.hardReject} | ${row.final} | ${row.removalSummary} |`,
    );
  }
  lines.push("");
  lines.push("```text");
  lines.push(...purityDetailBlocks);
  lines.push("```");
  lines.push("");
  lines.push("## Retrieval funnel examples");
  lines.push("");
  lines.push("See motorway_rain and dad_rock_bbq sections below for full funnel traces.");
  lines.push("");
  lines.push("## Full track lists");
  lines.push("");
  lines.push(...detailSections);

  const outDir = "reports/playlist-evaluation";
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/v15-delivery-recovery-2026-07-28.md`;
  writeFileSync(outPath, lines.join("\n"));
  console.log(`Wrote ${outPath}`);
  console.log(`SUMMARY: ${keep} KEEP / ${maybe} MAYBE / ${drop} DROP`);
  console.log(`ZERO-TRACK: ${zeroTrackCount}`);
  console.log("");
  console.log("PURITY SUB-FUNNEL:");
  for (const row of purityTableRows) {
    console.log(
      `${row.id}: pre=${row.pre} filter=${row.postFilter} checkpoint=${row.postCheckpoint} hardReject=${row.hardReject} final=${row.final}`,
    );
    console.log(`  ${row.removalSummary}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
