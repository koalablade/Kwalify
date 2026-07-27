/**
 * Diagnosis-only: compound intent routing forensics for party-70s-disco
 * vs a healthier compound (party-latin-summer). No pipeline changes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLiveBenchmarkCredentials } from "../lib/benchmark-env";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";
import { decomposeIntent, isUnclearIntent } from "../core/v3/intent-decomposer";
import { buildLockedIntent } from "../core/v3/intent";
import {
  buildConstraintRelaxationPlan,
  relaxedIntentForProfile,
} from "../core/v3/constraint-relaxation";
import { selectEditorialWorld } from "../core/editorial/intent-collapse-layer";
import { buildLanes } from "../core/v3/lane-router";
import { analyzeVibe } from "../lib/emotion";

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "reports", "playlist-evaluation");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function generate(id: string, baseUrl: string, token: string, spotifyUserId: string) {
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((row) => row.id === id);
  if (!prompt) throw new Error(`Missing prompt ${id}`);
  const res = await fetch(`${baseUrl}/api/generate?audit=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kwalify-evaluation-token": token,
    },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode,
      length: prompt.length,
      auditMode: true,
      debug: true,
      debugPipeline: true,
      spotifyUserId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = asRecord(await res.json().catch(() => ({}))) ?? {};
  return { prompt, status: res.status, body };
}

function extractLive(id: string, status: number, body: Record<string, unknown>) {
  const v3 = asRecord(body.v3Diagnostics) ?? {};
  const gd = asRecord(body.generationDiagnostics) ?? {};
  const hs = asRecord(v3.humanSaveabilityGate) ?? {};
  const exec = asRecord(body.playlistExecutionTrace) ?? {};
  const retrieval = asRecord(gd.candidateRetrieval) ?? {};
  const orch = asRecord(retrieval.orchestrator) ?? {};
  const selected = asArray<Record<string, unknown>>(v3.selectionTrace).filter(
    (row) => row.selected === true,
  );
  const byLane: Record<string, number> = {};
  const byLaneGenre: Record<string, Record<string, number>> = {};
  const artistsOfInterest = new Set(["fleetwood mac", "led zeppelin", "queen", "ac/dc", "acdc"]);
  const rockArtists: Array<Record<string, unknown>> = [];
  for (const t of selected) {
    const lane = String(t.laneId ?? t.lane ?? t.sourceLane ?? "unknown");
    byLane[lane] = (byLane[lane] ?? 0) + 1;
    const genre = String(t.genre ?? t.genreFamily ?? t.genrePrimary ?? "unknown").toLowerCase();
    byLaneGenre[lane] ??= {};
    byLaneGenre[lane][genre] = (byLaneGenre[lane][genre] ?? 0) + 1;
    const artist = String(t.artistName ?? t.artist ?? "").toLowerCase();
    if ([...artistsOfInterest].some((a) => artist.includes(a)) || genre === "rock" || genre === "indie") {
      rockArtists.push({
        title: t.trackName ?? t.title,
        artist: t.artistName ?? t.artist,
        genre,
        lane,
        year: t.releaseYear ?? t.year ?? null,
        score: t.score ?? t.laneScore ?? null,
      });
    }
  }
  return {
    id,
    status,
    success: body.success === true,
    count: body.count ?? asArray(body.tracks).length,
    executionPath: exec.executionPath ?? null,
    activePath: v3.activePath ?? null,
    fallback: v3.fallback ?? null,
    sceneInfluenceMap: v3.sceneInfluenceMap ?? asRecord(v3.intentDecomposition)?.sceneInfluenceMap ?? null,
    intentUnderstanding: v3.intentUnderstanding ?? null,
    intentDecomposition: v3.intentDecomposition ?? v3.decomposedIntent ?? null,
    intentCollapse: exec.intentCollapseLayer ?? v3.intentCollapseLayer ?? null,
    editorialWorldTag:
      asRecord(exec.intentCollapseLayer)?.editorialWorldTag ??
      asRecord(hs)?.dominantCluster ??
      gd.dominantCluster ??
      null,
    lanes: v3.lanes ?? null,
    laneContributions: v3.laneContributions ?? null,
    adaptiveLaneGenerator: v3.adaptiveLaneGenerator ?? null,
    finalDistribution: v3.finalDistribution ?? null,
    controlledGeneration: {
      relaxationSteps: asRecord(v3.controlledGeneration)?.relaxationSteps ?? null,
      selectedRelaxation:
        asRecord(v3.controlledGeneration)?.selectedRelaxation ??
        asRecord(v3.controlledGeneration)?.finalRelaxedConstraints ??
        null,
      selectedCandidate: asRecord(v3.controlledGeneration)?.selectedCandidate ?? null,
      constraintFailures: asRecord(v3.controlledGeneration)?.constraintFailures ?? null,
    },
    retrieval: {
      strategy: orch.strategy ?? retrieval.strategy ?? null,
      sourceQuotaPct: orch.sourceQuotaPct ?? retrieval.sourceQuotaPct ?? null,
      blendedIntentPool: orch.blendedIntentPool ?? null,
      compoundPrompt: retrieval.compoundPrompt === true,
      inputCount: retrieval.inputCount ?? null,
      outputCount: retrieval.outputCount ?? null,
    },
    selectedByLane: byLane,
    selectedByLaneGenre: byLaneGenre,
    selectedCount: selected.length,
    rockIndieAndTargetArtists: rockArtists.slice(0, 40),
    gate: {
      curatorScore: hs.curatorScore ?? null,
      rejectionReasons: hs.rejectionReasons ?? null,
      degradedDelivery: hs.degradedDelivery === true,
      strictModeHumanSaveability: hs.strictModeHumanSaveability === true,
    },
  };
}

function offlineAnalysis(id: string, vibe: string, mode: "strict" | "balanced" | "chaotic") {
  const profile = analyzeVibe(vibe);
  const locked = buildLockedIntent(vibe);
  const decomposed = decomposeIntent(vibe, profile);
  const unclear = isUnclearIntent(decomposed);
  const lanes = buildLanes(decomposed);
  const plan = buildConstraintRelaxationPlan(locked, mode);
  const adjacentStep = plan.find((step) => step.id === "relax_genre_adjacent");
  const expanded = adjacentStep ? relaxedIntentForProfile(locked, adjacentStep.profile) : null;
  const eraStep = plan.find((step) => step.id === "relax_era");
  const eraExpanded = eraStep ? relaxedIntentForProfile(locked, eraStep.profile) : null;
  const world = selectEditorialWorld({
    vibe,
    lockedIntent: locked,
    profile,
    primaryMood: locked.mood[0] ?? "energised",
    sceneType: locked.activity === "party" ? "night" : "unknown",
  });
  return {
    id,
    vibe,
    mode,
    lockedIntent: {
      genreFamilies: locked.genreFamilies,
      primaryGenre: locked.primaryGenre,
      eraRange: locked.eraRange,
      activity: locked.activity,
      energy: locked.energy,
      mood: locked.mood,
    },
    sceneInfluenceMap: decomposed.sceneInfluenceMap,
    unclearIntent: unclear,
    secondaryIntents: decomposed.secondaryIntents,
    lanes: lanes.map((lane) => ({
      id: lane.id,
      type: lane.type,
      label: lane.label,
      weight: lane.weight,
      genreBonus: lane.scoringBias?.genreBonus ?? null,
      eraBonus: lane.scoringBias?.eraBonus ?? null,
    })),
    relaxationPlan: plan.map((step) => ({
      label: step.label,
      era: step.profile.era,
      genre: step.profile.genre,
      audio: step.profile.audio,
      mood: step.profile.mood,
    })),
    adjacentExpansion: expanded
      ? { genreFamilies: expanded.genreFamilies, eraRange: expanded.eraRange }
      : null,
    eraExpansion: eraExpanded?.eraRange ?? null,
    editorialWorld: {
      tag: world.tag,
      primaryFamilies: world.primaryFamilies,
      allowedMicroClusters: world.allowedMicroClusters,
      energyRange: world.energyRange,
      nostalgiaBias: world.nostalgiaBias,
    },
  };
}

function markdownFrom(report: {
  discoLive: ReturnType<typeof extractLive>;
  latinLive: ReturnType<typeof extractLive>;
  discoOff: ReturnType<typeof offlineAnalysis>;
  latinOff: ReturnType<typeof offlineAnalysis>;
}): string {
  const d = report.discoLive;
  const l = report.latinLive;
  const od = report.discoOff;
  const ol = report.latinOff;
  const hist = asRecord(d.finalDistribution)?.genres as Record<string, number> | undefined;
  const histRows = hist
    ? Object.entries(hist)
        .sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `| ${g} | ${n} |`)
        .join("\n")
    : "_n/a_";
  const latinHist = asRecord(l.finalDistribution)?.genres as Record<string, number> | undefined;
  const latinHistRows = latinHist
    ? Object.entries(latinHist)
        .sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `| ${g} | ${n} |`)
        .join("\n")
    : "_n/a_";
  const discoLaneRows = od.lanes
    .map((lane) => `| ${lane.id} | ${lane.type} | ${lane.weight} | ${JSON.stringify(lane.genreBonus)} |`)
    .join("\n");
  const latinLaneRows = ol.lanes
    .map((lane) => `| ${lane.id} | ${lane.type} | ${lane.weight} | ${JSON.stringify(lane.genreBonus)} |`)
    .join("\n");
  const selectedLaneRows = Object.entries(d.selectedByLane)
    .sort((a, b) => b[1] - a[1])
    .map(([lane, n]) => `| ${lane} | ${n} |`)
    .join("\n");
  const artistRows = d.rockIndieAndTargetArtists
    .slice(0, 20)
    .map((row) => `| ${row.artist} | ${row.title} | ${row.genre} | ${row.lane} | ${row.year ?? "?"} |`)
    .join("\n");

  return `# Disco compound routing forensics

**Diagnosis only** — no scoring / recovery / Opening Curator / Human Saveability Gate / editorial threshold changes.

Generated from live audit on \`party-70s-disco\` vs \`party-latin-summer\`, plus offline locked-intent / decomposer / lane / adjacent reproduction.

## Verdict (single recommendation)

**F. Something else — intent-decomposer genre-force injection (unclear-intent → fallback ensemble)**

More precisely: disco intent is understood correctly in **LockedIntent** and **editorial world**, and adjacent mapping does **not** introduce rock. Disco is lost when \`decomposeIntent\` yields a single \`party\` force (no disco/soul/70s injection), \`isUnclearIntent\` fires, and \`buildFallbackLanes\` applies **rock/indie** genre bonuses. That is the first irreversible loss of disco routing.

Not A (prompt understanding / LockedIntent is correct). Not B (editorial world is \`disco_party_nostalgia\`). Not C (adjacent table for soul excludes rock). Lane weighting (D) and retrieval quotas (E) are downstream of the fallback path.

---

## 1. Locked intent after prompt understanding

Offline \`buildLockedIntent("70s disco party dancefloor")\`:

| Field | party-70s-disco | party-latin-summer |
| --- | --- | --- |
| genreFamilies | \`${JSON.stringify(od.lockedIntent.genreFamilies)}\` | \`${JSON.stringify(ol.lockedIntent.genreFamilies)}\` |
| primaryGenre | \`${od.lockedIntent.primaryGenre}\` | \`${ol.lockedIntent.primaryGenre}\` |
| eraRange | \`${JSON.stringify(od.lockedIntent.eraRange)}\` | \`${JSON.stringify(ol.lockedIntent.eraRange)}\` |
| activity | \`${od.lockedIntent.activity}\` | \`${ol.lockedIntent.activity}\` |
| energy | \`${JSON.stringify(od.lockedIntent.energy)}\` | \`${JSON.stringify(ol.lockedIntent.energy)}\` |

Evidence: \`disco\` aliases into **soul** (expanded vocabulary). \`70s\` → 1970–1979. \`party\` / \`dancefloor\` → activity party. Locked intent is **not** the bug.

Live \`intentUnderstanding\` (disco): see companion JSON.

## 2. Editorial world selected

| Prompt | Editorial world | primaryFamilies |
| --- | --- | --- |
| party-70s-disco | \`${od.editorialWorld.tag}\` | \`${JSON.stringify(od.editorialWorld.primaryFamilies)}\` |
| party-latin-summer | \`${ol.editorialWorld.tag}\` | \`${JSON.stringify(ol.editorialWorld.primaryFamilies)}\` |

Disco hard-locks \`disco_party_nostalgia\` via compound gate on disco/funk + 70s + party. Live tag seen: \`${d.editorialWorldTag}\`. Editorial world is **aligned** with disco; not the failure point.

## 3. Retrieval lanes requested

### Offline decomposer → lane builder

Disco \`sceneInfluenceMap\`: \`${JSON.stringify(od.sceneInfluenceMap)}\`  
\`isUnclearIntent\`: **${od.unclearIntent}**

Latin \`sceneInfluenceMap\`: \`${JSON.stringify(ol.sceneInfluenceMap)}\`  
\`isUnclearIntent\`: **${ol.unclearIntent}**

Disco lanes (because unclear → fallback ensemble):

| Lane id | Type | Weight | genreBonus |
| --- | --- | ---: | --- |
${discoLaneRows}

Latin lanes:

| Lane id | Type | Weight | genreBonus |
| --- | --- | ---: | --- |
${latinLaneRows}

Live disco \`activePath\` / fallback: \`${JSON.stringify({ activePath: d.activePath, fallback: d.fallback })}\`  
Live latin \`activePath\` / fallback: \`${JSON.stringify({ activePath: l.activePath, fallback: l.fallback })}\`

## 4. Retrieval quotas per lane

Party activity uses high-confidence source quotas (\`candidate-retrieval-pipeline\` \`HIGH_CONFIDENCE_QUOTAS\` for \`party_pregame\`):

| Source | Quota |
| --- | ---: |
| activity_match | 0.32 |
| forgotten_favourites | 0.20 |
| genre_match | 0.14 |
| sonic_match | 0.12 |
| exploratory | 0.10 |
| emotional_match | 0.08 |
| favourite_artists | 0.04 |

Live disco retrieval snapshot: \`${JSON.stringify(d.retrieval)}\`  
Live latin retrieval snapshot: \`${JSON.stringify(l.retrieval)}\`

V3 fallback lane weights (selection quotas among fallback lanes): mainstream 0.40, nostalgia 0.25, discovery 0.20, ambient 0.15.

## 5. Adjacent genre expansion table

From \`GENRE_ADJACENT_FAMILIES\` (\`constraint-relaxation.ts\`):

| Seed | Adjacent siblings |
| --- | --- |
| disco | soul, funk, pop, electronic, rnb |
| soul | funk, rnb, disco, pop |
| funk | soul, disco, pop, rnb |
| pop | disco, soul, electronic, **indie** |
| latin | pop, reggae, electronic, soul |
| rock | indie, pop, metal |
| indie | rock, pop, folk |

Disco lock expands under \`genre_adjacent_siblings\` to: \`${JSON.stringify(od.adjacentExpansion?.genreFamilies)}\`

**Rock is not in the soul adjacent set.** Indie appears only if pop is a *seed* family and hop is re-applied; one-hop from soul alone yields funk/rnb/disco/pop — still no rock.

## 6. Era expansion table

\`widenEraRange\`: ±5 years, clamped [1950, currentYear].

| Prompt | Locked era | After \`era_relaxed\` |
| --- | --- | --- |
| party-70s-disco | \`${JSON.stringify(od.lockedIntent.eraRange)}\` | \`${JSON.stringify(od.eraExpansion)}\` |
| party-latin-summer | \`${JSON.stringify(ol.lockedIntent.eraRange)}\` | \`${JSON.stringify(ol.eraExpansion)}\` |

Disco selected live relaxation: \`${JSON.stringify(d.controlledGeneration.selectedRelaxation)}\`  
Steps: \`${JSON.stringify(d.controlledGeneration.relaxationSteps)}\`

## 7. Why rock becomes the dominant adjacent family

It does **not** become dominant via adjacent mapping. It becomes dominant via **fallback lane genre bonuses**:

- mainstream: \`{ pop: 0.10, rock: 0.08, indie: 0.06 }\`
- nostalgia: \`{ folk: 0.10, rock: 0.08, soul: 0.07, blues: 0.06 }\` + \`preferBefore: 2005\`

Combined with \`era_relaxed\` (1965–1984) and a 70s-rich rock library slice, scoring converges on classic rock/indie.

Live disco \`finalDistribution.genres\`:

| Family | Count |
| --- | ---: |
${histRows}

Latin comparison:

| Family | Count |
| --- | ---: |
${latinHistRows}

## 8. Which retrieval lane contributes each of the final 30

Live selected-by-lane counts for disco (from \`selectionTrace\` where \`selected=true\`):

| Lane | Selected |
| --- | ---: |
${selectedLaneRows || "| (empty — see finalDistribution / laneContributions in JSON) |"}

Live \`lanes\` scored/selected: \`${JSON.stringify(d.lanes)}\`  
\`laneContributions\`: \`${JSON.stringify(d.laneContributions)}\`

## 9. Which mapping introduces Fleetwood Mac / Led Zeppelin / Queen / AC/DC

These artists enter through **fallback nostalgia + mainstream rock bonuses** under a widened 70s era window — not through disco→soul adjacent siblings.

Sample rock/indie / target artists from live selection (lane + genre):

| Artist | Title | Genre | Lane | Year |
| --- | --- | --- | --- | --- |
${artistRows || "| _see JSON if selectionTrace empty of genre fields_ | | | | |"}

\`finalDistribution.artists\` (disco): \`${JSON.stringify(asRecord(d.finalDistribution)?.artists)}\`

## 10. First point where disco intent is lost

Ordered causal chain:

1. **LockedIntent** keeps disco (as soul) + 70s + party — OK.
2. **Editorial world** \`disco_party_nostalgia\` — OK.
3. **Intent decomposer** matches \`party\` / \`dancefloor\`, but \`GENRE_FORCE_INJECTIONS\` soul pattern is \`soul|motown|gospel|neo.?soul|funk.?soul\` — **\`disco\` and \`70s\` do not inject**. Latin injects via \`latin|salsa|reggaeton|...\`.
4. Result: disco influence map often \`{ party: 1.0 }\` → \`isUnclearIntent\` true (forces < 2).
5. **First irreversible loss:** \`buildLanes\` → \`buildFallbackLanes\` with rock/indie bonuses, replacing adaptive disco-capable lanes.
6. Era/genre adjacent relaxation then fills a **70s rock library** that those bonuses prefer.
7. Gate correctly rejects rock/indie-dominant “disco” playlist.

Compare latin: genre-force injection supplies rhythm/energy/warmth → unclear=false → non-fallback lanes → genre distribution stays on-identity.

---

## Side-by-side summary

| Stage | party-70s-disco | party-latin-summer |
| --- | --- | --- |
| Locked genre | soul (from disco) | latin (expected) |
| Editorial world | disco_party_nostalgia | ${ol.editorialWorld.tag} |
| Influence forces | ${JSON.stringify(od.sceneInfluenceMap)} | ${JSON.stringify(ol.sceneInfluenceMap)} |
| Unclear intent | ${od.unclearIntent} | ${ol.unclearIntent} |
| Lane mode | fallback ensemble | ${ol.unclearIntent ? "fallback" : "adaptive/standard"} |
| Live count / path | ${d.count} / ${d.executionPath} | ${l.count} / ${l.executionPath} |
| Dominant genres | rock/indie | see latin histogram |

## Recommendation (one)

**F. Something else — add disco/70s-disco genre-force injection in \`intent-decomposer\` (and/or treat locked genreFamilies as influence forces) so compound disco prompts never drop into the rock-biased fallback ensemble.**

Do not first change adjacent tables, gate thresholds, or lane weights in isolation: adjacent is already correct; the fallback path bypasses it.

Companion JSON: \`reports/playlist-evaluation/disco-compound-routing-forensics.json\`
`;
}

async function main(): Promise<void> {
  const creds = resolveLiveBenchmarkCredentials({
    strict: true,
    cli: { baseUrl: "http://localhost:5000" },
    defaultBaseUrl: "http://localhost:5000",
  });

  process.stderr.write("[routing-forensics] generating party-70s-disco...\n");
  const discoGen = await generate("party-70s-disco", creds.baseUrl, creds.token, creds.spotifyUserId);
  process.stderr.write("[routing-forensics] generating party-latin-summer...\n");
  const latinGen = await generate("party-latin-summer", creds.baseUrl, creds.token, creds.spotifyUserId);

  const discoLive = extractLive("party-70s-disco", discoGen.status, discoGen.body);
  const latinLive = extractLive("party-latin-summer", latinGen.status, latinGen.body);
  const discoOff = offlineAnalysis("party-70s-disco", "70s disco party dancefloor", "strict");
  const latinOff = offlineAnalysis("party-latin-summer", "latin summer beach party", "balanced");

  const report = { discoLive, latinLive, discoOff, latinOff, generatedAt: new Date().toISOString() };
  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "disco-compound-routing-forensics.json");
  const mdPath = path.join(OUT_DIR, "disco-compound-routing-forensics.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdPath, markdownFrom({ discoLive, latinLive, discoOff, latinOff }), "utf8");
  process.stderr.write(`[routing-forensics] wrote ${mdPath}\n`);
  console.log(
    JSON.stringify(
      {
        discoUnclear: discoOff.unclearIntent,
        latinUnclear: latinOff.unclearIntent,
        discoMap: discoOff.sceneInfluenceMap,
        latinMap: latinOff.sceneInfluenceMap,
        discoLanes: discoOff.lanes.map((l) => l.id),
        latinLanes: latinOff.lanes.map((l) => l.id),
        discoAdj: discoOff.adjacentExpansion,
        discoWorld: discoOff.editorialWorld.tag,
        latinWorld: latinOff.editorialWorld.tag,
        discoLiveDist: discoLive.finalDistribution,
        latinLiveDist: latinLive.finalDistribution,
        discoFallback: discoLive.fallback,
        latinFallback: latinLive.fallback,
        discoSelectedByLane: discoLive.selectedByLane,
        latinSelectedByLane: latinLive.selectedByLane,
        recommendation: "F",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
