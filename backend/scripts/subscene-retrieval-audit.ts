/**
 * Phase 5 — Library supply + retrieval loss audit for sub-scene failures.
 *
 * Note: this Spotify library often has empty spotify_artist_genres; genre family
 * comes from detectLibraryGenres / classifyTrack (same path as generation).
 *
 * Usage:
 *   npx tsx backend/scripts/subscene-retrieval-audit.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { analyzeVibe } from "../lib/emotion";
import { resolveHumanScene } from "../lib/human-scene-knowledge";
import { buildLockedIntent } from "../core/v3/intent";
import {
  calibrateIntentVectorForRetrievalPool,
  collapseIntent,
  diagnoseIntentFilterRejectionReason,
  enrichIntentCollapseTrack,
  rankCandidatesByIntentVector,
  scoreEditorialIntentMatch,
  selectRankedCandidatesForSampler,
  type IntentCollapseTrack,
} from "../core/editorial/intent-collapse-layer";
import { retrieveCandidatesByEmbedding } from "../core/v3/embedding-retrieval";
import {
  applySubSceneRetrievalTexture,
  buildSubSceneRetrievalPlan,
  mergeSubSceneIntoSamplerSelection,
  selectSubSceneNeighbourhood,
} from "../core/v3/subscene-retrieval";
import { buildUserGenreProfile } from "../lib/user-genre-profile";
import { resolveSemanticScene } from "../lib/semantic-scene-engine";

type SoftBand =
  | "ambient_soft"
  | "downtempo"
  | "mild_electronic"
  | "peak_electronic"
  | "other";

type LikedRow = {
  track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  tempo: number | null;
  instrumentalness: number | null;
  spotify_artist_genres: unknown;
  album_genres: unknown;
};

const FAILING_PROMPTS = [
  { id: "rave-comedown", prompt: "rave comedown bus home", expected: "soft_electronic_aftermath" },
  { id: "after-holiday", prompt: "back home the day after a holiday ends", expected: "reflective_return" },
  { id: "doctors-waiting", prompt: "nervously waiting for test results at the doctors", expected: "tense_hold" },
  { id: "quiet-revision", prompt: "quiet morning revision", expected: "steady_focus" },
  { id: "gym-control", prompt: "heavy lifting gym pump aggressive", expected: "high_drive" },
];

function readEnv(key: string): string | null {
  try {
    const line = readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : null;
  } catch {
    return null;
  }
}

function genresOf(row: LikedRow): string[] {
  const out: string[] = [];
  for (const raw of [row.spotify_artist_genres, row.album_genres]) {
    if (Array.isArray(raw)) out.push(...raw.map(String));
    else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) out.push(...parsed.map(String));
      } catch {
        out.push(raw);
      }
    }
  }
  return out;
}

function softBand(energy: number | null, family: string): SoftBand {
  if (energy == null || family !== "electronic") return "other";
  if (energy > 0.66) return "peak_electronic";
  if (energy <= 0.35) return "ambient_soft";
  if (energy <= 0.45) return "downtempo";
  if (energy <= 0.52) return "mild_electronic";
  return "peak_electronic";
}

function isSoftElectronicAftermath(
  energy: number | null,
  family: string,
  acousticness: number | null,
  danceability: number | null,
  instrumentalness: number | null,
): boolean {
  if (energy == null || energy < 0.1 || energy > 0.52) return false;
  if (family === "electronic") return true;
  // Audio neighbourhood when family mislabels soft-synth / downtempo as indie/unknown
  const acoustic = acousticness ?? 0.5;
  const dance = danceability ?? 0.5;
  const inst = instrumentalness ?? 0;
  return acoustic < 0.4 && dance >= 0.35 && dance <= 0.78 && (inst >= 0.25 || energy <= 0.4);
}

async function main(): Promise<void> {
  const cs = process.env.DATABASE_URL || readEnv("DATABASE_URL");
  if (!cs) throw new Error("DATABASE_URL required");
  const userId = process.env.SMOKE_SPOTIFY_USER_ID || readEnv("SMOKE_SPOTIFY_USER_ID") || "koalablade";
  const pool = new Pool({ connectionString: cs });

  const { rows } = await pool.query<LikedRow>(
    `SELECT track_id, track_name, artist_name, album_name, energy, valence, danceability, acousticness,
            tempo, instrumentalness, spotify_artist_genres, album_genres
     FROM liked_songs
     WHERE spotify_user_id = $1`,
    [userId],
  );
  await pool.end();

  console.log(`Classifying ${rows.length} tracks (generation-path genre detection)...`);
  const genreProfile = buildUserGenreProfile(
    rows.map((r) => ({
      trackId: r.track_id,
      trackName: r.track_name,
      artistName: r.artist_name,
      albumName: r.album_name,
      spotifyArtistGenres: r.spotify_artist_genres,
      albumGenres: r.album_genres,
      energy: r.energy,
      valence: r.valence,
      acousticness: r.acousticness,
      danceability: r.danceability,
      instrumentalness: r.instrumentalness,
      tempo: r.tempo,
    })),
  );

  const bandCounts: Record<SoftBand, number> = {
    ambient_soft: 0,
    downtempo: 0,
    mild_electronic: 0,
    peak_electronic: 0,
    other: 0,
  };
  let electronicTotal = 0;
  let softAftermathSupply = 0;
  const softAftermathRows: LikedRow[] = [];
  const familyCounts: Record<string, number> = {};

  for (const row of rows) {
    const c = genreProfile.trackClassifications.get(row.track_id);
    const family = c?.genreFamily ?? "unknown";
    familyCounts[family] = (familyCounts[family] ?? 0) + 1;
    if (family === "electronic") electronicTotal += 1;
    const band = softBand(row.energy, family);
    bandCounts[band] += 1;
    if (
      isSoftElectronicAftermath(
        row.energy,
        family,
        row.acousticness,
        row.danceability,
        row.instrumentalness,
      )
    ) {
      softAftermathSupply += 1;
      softAftermathRows.push(row);
    }
  }

  const librarySupply = {
    userId,
    totalTracks: rows.length,
    spotifyGenreNonEmpty: rows.filter((r) => genresOf(r).length > 0).length,
    electronicTotal,
    softAftermathSupply,
    softAftermathShareOfElectronic: electronicTotal ? softAftermathSupply / electronicTotal : 0,
    softAftermathShareOfLibrary: rows.length ? softAftermathSupply / rows.length : 0,
    familyCounts,
    bandCounts,
    softAftermathSample: softAftermathRows
      .slice()
      .sort((a, b) => (a.energy ?? 1) - (b.energy ?? 1))
      .slice(0, 50)
      .map((r) => {
        const c = genreProfile.trackClassifications.get(r.track_id);
        return {
          id: r.track_id,
          artist: r.artist_name,
          title: r.track_name,
          energy: r.energy,
          acousticness: r.acousticness,
          danceability: r.danceability,
          instrumentalness: r.instrumentalness,
          family: c?.genreFamily ?? null,
          sub: c?.primarySubgenre ?? null,
          band: softBand(r.energy, c?.genreFamily ?? "unknown"),
        };
      }),
  };

  const collapseTracks = rows.map((row) => {
    const c = genreProfile.trackClassifications.get(row.track_id);
    return enrichIntentCollapseTrack({
      trackId: row.track_id,
      artistName: row.artist_name,
      energy: row.energy,
      valence: row.valence,
      danceability: row.danceability,
      acousticness: row.acousticness,
      tempo: row.tempo,
      instrumentalness: row.instrumentalness,
      genrePrimary: c?.genrePrimary ?? c?.genreFamily ?? null,
      genreFamily: c?.genreFamily ?? null,
    });
  });
  const byId = new Map(collapseTracks.map((t) => [t.trackId, t]));
  const softIds = new Set(softAftermathRows.map((r) => r.track_id));
  const nameById = new Map(rows.map((r) => [r.track_id, { artist: r.artist_name, title: r.track_name }]));

  const promptReports = [];

  for (const fixture of FAILING_PROMPTS) {
    const profile = analyzeVibe(fixture.prompt);
    const locked = buildLockedIntent(fixture.prompt);
    const human = resolveHumanScene(fixture.prompt);
    const semantic = resolveSemanticScene(fixture.prompt, profile);
    const collapsed = collapseIntent({
      vibe: fixture.prompt,
      lockedIntent: locked,
      profile,
      libraryTracks: collapseTracks,
      targetCount: 25,
    });
    const intent = collapsed.intent;

    const retrievalInput = collapseTracks.map((t) => ({
      trackId: t.trackId,
      energy: t.energy ?? null,
      valence: t.valence ?? null,
      danceability: t.danceability ?? null,
      acousticness: t.acousticness ?? null,
      tempo: t.tempo ?? null,
      instrumentalness: t.instrumentalness ?? null,
    }));
    const cloud = retrieveCandidatesByEmbedding(retrievalInput, locked);
    const TOP_AFFINITY = Math.min(collapseTracks.length, Math.max(400, Math.ceil(collapseTracks.length * 0.35)));
    const affinitySlice = cloud.tracks.slice(0, TOP_AFFINITY);
    const retrievedIds = new Set(affinitySlice.map((c) => c.track.trackId));
    const softInRetrieved = [...softIds].filter((id) => retrievedIds.has(id)).length;

    const softAffinityRanks = softAftermathRows
      .map((r) => {
        const idx = cloud.tracks.findIndex((c) => c.track.trackId === r.track_id);
        return {
          id: r.track_id,
          artist: r.artist_name,
          title: r.track_name,
          energy: r.energy,
          affinityRank: idx >= 0 ? idx + 1 : null,
          affinity: idx >= 0 ? cloud.tracks[idx]!.embeddingAffinity : null,
        };
      })
      .sort((a, b) => (a.affinityRank ?? 99999) - (b.affinityRank ?? 99999));

    const fullRetrieved = cloud.tracks.map((c) => byId.get(c.track.trackId)!).filter(Boolean);
    const calibrated = calibrateIntentVectorForRetrievalPool(fullRetrieved, intent, {
      targetCount: 25,
      strictMode: false,
    });

    const ranked = rankCandidatesByIntentVector(fullRetrieved, calibrated);
    const softRanked = ranked.filter((r) => softIds.has(r.track.trackId));

    const discardReasons: Record<string, number> = {};
    const discardedSoft: Array<{
      id: string;
      artist: string;
      title: string;
      energy: number | null;
      reason: string;
      score: number;
      affinityRank: number | null;
      humanKeepLikely: boolean;
    }> = [];

    for (const row of softAftermathRows) {
      const track = byId.get(row.track_id);
      if (!track) continue;
      const affinityRank = cloud.tracks.findIndex((c) => c.track.trackId === row.track_id);
      const inTopAffinity = affinityRank >= 0 && affinityRank < TOP_AFFINITY;
      if (!inTopAffinity) {
        discardReasons["low_embedding_affinity"] = (discardReasons["low_embedding_affinity"] ?? 0) + 1;
        discardedSoft.push({
          id: row.track_id,
          artist: row.artist_name,
          title: row.track_name,
          energy: row.energy,
          reason: "low_embedding_affinity",
          score: scoreEditorialIntentMatch(track, calibrated),
          affinityRank: affinityRank >= 0 ? affinityRank + 1 : null,
          humanKeepLikely: true,
        });
        continue;
      }
      const filterReason = diagnoseIntentFilterRejectionReason(track, calibrated);
      const score = scoreEditorialIntentMatch(track, calibrated);
      if (filterReason && filterReason !== "passed") {
        // diagnose returns passed for survivors — check
      }
      if (score <= 0 || (filterReason && filterReason !== "passed")) {
        const reason = score <= 0 ? (filterReason && filterReason !== "passed" ? filterReason : "score_hard_zero") : String(filterReason);
        discardReasons[reason] = (discardReasons[reason] ?? 0) + 1;
        discardedSoft.push({
          id: row.track_id,
          artist: row.artist_name,
          title: row.track_name,
          energy: row.energy,
          reason,
          score,
          affinityRank: affinityRank + 1,
          humanKeepLikely: true,
        });
      }
    }

    const subScenePlan = buildSubSceneRetrievalPlan({
      vibe: fixture.prompt,
      lockedIntent: locked,
      libraryTracks: collapseTracks,
      targetCount: 25,
    });
    const textured = applySubSceneRetrievalTexture(calibrated, subScenePlan);
    const baselineSelection = selectRankedCandidatesForSampler(fullRetrieved, textured, {
      targetCount: 25,
      strictMode: false,
    });
    const neighbourhood = selectSubSceneNeighbourhood(collapseTracks, textured, subScenePlan);
    const samplerSelection = mergeSubSceneIntoSamplerSelection(
      baselineSelection,
      neighbourhood,
      textured,
      subScenePlan,
    );
    const softInNeighbourhood = neighbourhood.filter((t) => softIds.has(t.trackId)).length;
    const softInBaseline = baselineSelection.selected.filter((t) => softIds.has(t.trackId)).length;
    const softInSampler = samplerSelection.selected.filter((t) => softIds.has(t.trackId)).length;
    const softMissedByTruncate = softRanked.filter(
      (r) =>
        r.score > 0 &&
        !samplerSelection.selected.some((t) => t.trackId === r.track.trackId),
    );
    for (const miss of softMissedByTruncate) {
      discardReasons["truncated_from_sampler_pool"] = (discardReasons["truncated_from_sampler_pool"] ?? 0) + 1;
      const named = nameById.get(miss.track.trackId);
      discardedSoft.push({
        id: miss.track.trackId,
        artist: named?.artist ?? miss.track.artistName ?? "",
        title: named?.title ?? "",
        energy: miss.track.energy ?? null,
        reason: "truncated_from_sampler_pool",
        score: miss.score,
        affinityRank: softAffinityRanks.find((s) => s.id === miss.track.trackId)?.affinityRank ?? null,
        humanKeepLikely: true,
      });
    }

    const topRetrievedSoft = softRanked
      .filter((r) => r.score > 0)
      .slice(0, 50)
      .map((r) => {
        const named = nameById.get(r.track.trackId);
        return {
          id: r.track.trackId,
          artist: named?.artist ?? r.track.artistName,
          title: named?.title ?? null,
          energy: r.track.energy,
          score: r.score,
          inSampler: samplerSelection.selected.some((t) => t.trackId === r.track.trackId),
        };
      });

    const topRejectedSoft = discardedSoft
      .slice()
      .sort((a, b) => (a.energy ?? 1) - (b.energy ?? 1))
      .slice(0, 50);

    const topIdealSoft = softAftermathRows
      .slice()
      .sort((a, b) => {
        const fa = genreProfile.trackClassifications.get(a.track_id)?.genreFamily === "electronic" ? 0 : 1;
        const fb = genreProfile.trackClassifications.get(b.track_id)?.genreFamily === "electronic" ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return (a.energy ?? 1) - (b.energy ?? 1);
      })
      .slice(0, 50)
      .map((r) => {
        const track = byId.get(r.track_id)!;
        const score = scoreEditorialIntentMatch(track, calibrated);
        const inSampler = samplerSelection.selected.some((t) => t.trackId === r.track_id);
        const filterReason = diagnoseIntentFilterRejectionReason(track, calibrated);
        const reason = !inSampler
          ? (score <= 0
            ? (filterReason && filterReason !== "passed" ? filterReason : "score_hard_zero")
            : "truncated_or_ranked_out")
          : null;
        return {
          id: r.track_id,
          artist: r.artist_name,
          title: r.track_name,
          energy: r.energy,
          family: genreProfile.trackClassifications.get(r.track_id)?.genreFamily ?? null,
          score,
          inSampler,
          missReason: reason,
        };
      });

    promptReports.push({
      id: fixture.id,
      prompt: fixture.prompt,
      expected: fixture.expected,
      interpretation: {
        profileEnergy: profile.energy,
        lockedEnergy: locked.energy,
        lockedActivity: locked.activity,
        genres: locked.genreFamilies,
        humanScene: human.primary?.id ?? null,
        musicalBehaviour: human.musicalBehaviour,
        semanticScene: semantic.matchedId,
        editorialWorld: intent.editorialWorldTag,
        energyRange: intent.energyRange,
        calibratedEnergyRange: calibrated.energyRange,
        rhythmDensityCap: calibrated.rhythmDensityCap,
        sonicAggressionCeiling: calibrated.sonicAggressionCeiling,
      },
      funnel: {
        librarySize: rows.length,
        softAftermathInLibrary: softAftermathSupply,
        topAffinitySlice: TOP_AFFINITY,
        softInTopAffinity: softInRetrieved,
        intentRankedSurvivors: ranked.filter((r) => r.score > 0).length,
        softInRankedSurvivors: softRanked.filter((r) => r.score > 0).length,
        subSceneKind: subScenePlan.kind,
        subSceneReason: subScenePlan.reason,
        subSceneEnergyHi: subScenePlan.energyHi,
        neighbourhoodSize: neighbourhood.length,
        softInNeighbourhood,
        softInBaselineSampler: softInBaseline,
        samplerPoolSize: samplerSelection.selected.length,
        softInSamplerPool: softInSampler,
        softRecallIntoSampler: softAftermathSupply ? softInSampler / softAftermathSupply : 0,
        softMissedByTruncate: softMissedByTruncate.length,
      },
      discardReasons,
      softAffinityRanks: softAffinityRanks.slice(0, 50),
      topRetrievedSoft,
      topRejectedSoft,
      topIdealSoft,
    });
  }

  const outDir = "reports/retrieval-depth";
  await mkdir(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    librarySupply,
    prompts: promptReports,
  };
  await writeFile(path.join(outDir, "subscene-retrieval-audit.json"), JSON.stringify(payload, null, 2));

  const md = [
    "# Sub-Scene Retrieval Audit",
    "",
    `User: ${userId}`,
    `Library: ${rows.length} tracks`,
    `Spotify genre metadata non-empty: ${librarySupply.spotifyGenreNonEmpty}`,
    `Electronic (classified family): ${electronicTotal}`,
    `Soft aftermath candidates (e 0.10–0.52 + electronic/neighbourhood): **${softAftermathSupply}**`,
    `Share of electronic: ${(librarySupply.softAftermathShareOfElectronic * 100).toFixed(1)}%`,
    `Share of library: ${(librarySupply.softAftermathShareOfLibrary * 100).toFixed(1)}%`,
    "",
    "## Family counts (classified)",
    ...Object.entries(familyCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Soft electronic band counts",
    ...Object.entries(bandCounts).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Soft aftermath sample (lowest energy)",
    ...librarySupply.softAftermathSample.slice(0, 20).map(
      (s) =>
        `- ${s.artist} — ${s.title} (e=${s.energy?.toFixed(2)}, dance=${s.danceability?.toFixed(2)}, ac=${s.acousticness?.toFixed(2)}, ${s.family}/${s.sub}, ${s.band})`,
    ),
    "",
    "## Prompt funnels",
    ...promptReports.map((p) => {
      const f = p.funnel;
      return [
        `### ${p.id} — "${p.prompt}"`,
        `- Scene: human=${p.interpretation.humanScene} behaviour=${p.interpretation.musicalBehaviour} semantic=${p.interpretation.semanticScene} world=${p.interpretation.editorialWorld}`,
        `- Caps: rhythm=${p.interpretation.rhythmDensityCap} aggression=${p.interpretation.sonicAggressionCeiling} calibratedE=${JSON.stringify(p.interpretation.calibratedEnergyRange)}`,
        `- Soft supply: ${f.softAftermathInLibrary} → affinity ${f.softInTopAffinity} → score>0 ${f.softInRankedSurvivors} → baseline soft ${f.softInBaselineSampler} → neighbourhood ${f.softInNeighbourhood}/${f.neighbourhoodSize} → sampler **${f.softInSamplerPool}**/${f.samplerPoolSize} (recall ${(f.softRecallIntoSampler * 100).toFixed(1)}%)`,
        `- Sub-scene: ${f.subSceneKind} (${f.subSceneReason}) energyHi=${f.subSceneEnergyHi}`,
        `- Truncated soft survivors: ${f.softMissedByTruncate}`,
        `- Discard reasons: ${JSON.stringify(p.discardReasons)}`,
        `- Ideal misses: ${
          p.topIdealSoft
            .filter((t) => !t.inSampler)
            .slice(0, 8)
            .map((t) => `${t.artist}/${t.title}[${t.missReason}|sc=${t.score.toFixed(2)}]`)
            .join("; ") || "(none)"
        }`,
        "",
      ].join("\n");
    }),
  ].join("\n");
  await writeFile(path.join(outDir, "SUBSCENE-RETRIEVAL-AUDIT.md"), md);

  console.log(md);
  console.log(`\nWrote ${path.join(outDir, "subscene-retrieval-audit.json")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
