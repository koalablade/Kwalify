/**
 * Run Scene World proof against a real synced library.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { initDb } from "../db";
import { runRequestLayerGeneration } from "./request-generation-orchestrator";
import { loadLikedSongsBatched } from "./load-liked-songs-batched";
import { initPool } from "./pg-pool";
import { runDbInit } from "./db-init";
import { markBootComplete } from "./boot-state";
import { sanitizeLikedSongs } from "./library-sanitize";
import { analyzeVibeWithContext, detectVibeKind } from "./emotion";
import { decodeIntent } from "./intent-decoder";
import { buildIntentPipelineContext } from "./intent-pipeline-orchestrator";
import { getUserGenreProfileForGenerate } from "./genre-profile-cache";
import { buildGenreIntelligenceStack } from "./genre-intelligence-stack";
import { buildLibrarySignals } from "./library-signals";
import { computeSurpriseMix } from "./human-surprise";
import { profileUserLibrary, resolveGenerationPolicy, estimatePromptUncertainty } from "./library-generation-policy";
import { buildLockedIntent } from "../core/v3/intent";
import type { SceneWorldProofReport } from "../core/scene-world-proof-capture";
import { logger } from "./logger";

const DEFAULT_PROMPTS = [
  "feel-good summer morning",
  "rainy city walk",
  "cozy Sunday morning",
  "late night thinking",
  "optimistic commute",
  "driving at sunset",
];

export type SceneWorldProofRunResult = {
  userId: string;
  librarySize: number;
  generatedAt: string;
  prompts: Array<SceneWorldProofReport & { passMaterialInfluence: boolean }>;
  summary: {
    promptsRun: number;
    materialInfluenceCount: number;
    avgReplacementPct: number;
    minReplacementPct: number;
    avgFirstTenClusterConsistency: number;
    minFirstTenClusterConsistency: number;
    sceneClusterViolationsRemoved: number;
  };
};

function loadEnvFile(): void {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const key = match[1]!;
      const value = match[2]!.replace(/^["']|["']$/g, "").trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional local .env
  }
}

async function loadLibrary(userId: string) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required to run Scene World proof against the real koalablade library. " +
      "Set DATABASE_URL to the production Postgres connection string.",
    );
  }
  const pool = initPool(connectionString);
  initDb(pool);
  await runDbInit(pool);
  markBootComplete();
  const rows = await loadLikedSongsBatched(userId);
  const { valid } = sanitizeLikedSongs(rows);
  return { pool, likedSongs: valid };
}

import type { likedSongsTable } from "../db/schema/kwalah";

export async function runSceneWorldProofForPrompt(
  likedSongs: Array<typeof likedSongsTable.$inferSelect>,
  prompt: string,
  opts?: { playlistLength?: number; userId?: string },
): Promise<SceneWorldProofReport & { passMaterialInfluence: boolean }> {
  const mode = "balanced" as const;
  const playlistLength = opts?.playlistLength ?? 25;
  const { profile: emotionProfile, journeyArc } = analyzeVibeWithContext(prompt);
  const vibeKind = detectVibeKind(prompt, emotionProfile);
  const humanIntent = decodeIntent(prompt);
  const intentPipeline = buildIntentPipelineContext(prompt, mode);
  const { profile: userGenreProfile } = getUserGenreProfileForGenerate(
    opts?.userId ?? "koalablade",
    likedSongs,
    prompt,
    { bypassCache: true },
  );
  const genreStack = buildGenreIntelligenceStack({
    librarySize: likedSongs.length,
    tracks: likedSongs,
    userProfile: userGenreProfile,
    vibe: prompt,
  });
  const librarySignals = buildLibrarySignals(
    likedSongs.map((song) => ({
      trackId: song.trackId,
      artistName: song.artistName,
      albumName: song.albumName,
      addedAt: song.addedAt,
      energy: song.energy,
      valence: song.valence,
      acousticness: song.acousticness,
      danceability: song.danceability,
    })),
    [],
  );
  const surpriseMix = computeSurpriseMix({
    profile: emotionProfile,
    vibe: prompt,
    rediscoveryMode: "balanced",
    archaeology: null,
    journeyArc,
    mode,
    familiarityMode: intentPipeline.familiarityMode,
  });
  const lockedIntent = buildLockedIntent(prompt);
  const generationPolicy = resolveGenerationPolicy(
    profileUserLibrary(likedSongs, userGenreProfile.trackClassifications),
    estimatePromptUncertainty({
      vibe: prompt,
      moodCount: lockedIntent.mood.length,
      explicitDimensions:
        (lockedIntent.genreFamilies.length > 0 ? 1 : 0) +
        (lockedIntent.eraRange ? 1 : 0) +
        (lockedIntent.activity ? 1 : 0) +
        (lockedIntent.energy ? 1 : 0) +
        (lockedIntent.primarySubgenre ? 1 : 0),
    }),
  );

  const startMs = Date.now();
  const pipeline = await runRequestLayerGeneration({
    likedSongs,
    vibe: prompt,
    mode,
    playlistLength,
    emotionProfile,
    vibeKind,
    intent: humanIntent,
    humanIntent,
    canonical: null,
    prototype: null,
    sonicProfile: null,
    userGenreProfile,
    genreStack,
    surpriseMix,
    journeyArc,
    memoryByTrack: () => 0.42,
    noveltyByTrack: () => 0.35,
    postScore: {
      referenceFingerprint: null,
      memoryWeight: 0,
      emotionProfile,
      librarySignals,
      rediscoveryMode: "balanced",
      archaeology: null,
      chapterMatch: null,
      feedbackMemory: null,
      startMs,
      promptConfidenceMultiplier: 1,
      journeyArcMultiplier: 1,
      freshness: {
        stats: {
          trackAppearances: new Map<string, number>(),
          artistAppearances: new Map<string, number>(),
          albumAppearances: new Map<string, number>(),
          recentSceneFingerprints: [],
          playlistsScanned: 0,
        },
        artistAppearances: new Map<string, number>(),
        albumAppearances: new Map<string, number>(),
        globalCloneMultiplier: 1,
      },
      vibe: prompt,
      sceneAliases: intentPipeline.sceneAliases,
      scenePrediction: intentPipeline.scenePrediction,
      sceneLock: intentPipeline.sceneLockStatus,
      trendPrompt: prompt,
    },
    genrePost: {
      allowHoliday: false,
      suppressGenres: ["christmas"],
    },
    maxPerArtist: 3,
    requestId: randomUUID(),
    diagnosticsMode: "full",
    sceneWorldProof: true,
    generationPolicy,
    pipelineLog: logger,
  });

  const v3Diagnostics = (pipeline.scoringDiagnostics.v3Pipeline ?? {}) as Record<string, unknown>;
  const proof = v3Diagnostics["sceneWorldProof"] as SceneWorldProofReport | null | undefined;
  if (!proof?.sceneWorldActive) {
    throw new Error(`Scene World Layer did not activate for prompt: ${prompt}`);
  }
  const passMaterialInfluence = proof.candidateReplacementPct >= 25;
  return { ...proof, passMaterialInfluence };
}

export async function runSceneWorldProofSuite(opts?: {
  userId?: string;
  prompts?: string[];
  outFile?: string;
}): Promise<SceneWorldProofRunResult> {
  loadEnvFile();
  const userId = opts?.userId ?? process.env.SMOKE_SPOTIFY_USER_ID ?? "koalablade";
  const prompts = opts?.prompts ?? DEFAULT_PROMPTS;
  const { pool, likedSongs } = await loadLibrary(userId);
  if (likedSongs.length < 100) {
    throw new Error(`Library too small for proof run (${likedSongs.length} tracks for ${userId})`);
  }

  const results: Array<SceneWorldProofReport & { passMaterialInfluence: boolean }> = [];
  for (const prompt of prompts) {
    logger.info({ prompt, userId, librarySize: likedSongs.length }, "scene_world_proof_prompt_start");
    results.push(await runSceneWorldProofForPrompt(likedSongs, prompt, { userId }));
  }
  await pool.end();

  const replacementValues = results.map((row) => row.candidateReplacementPct);
  const clusterConsistencyValues = results.map((row) => row.firstTenClusterConsistency ?? 0);
  const summary = {
    promptsRun: results.length,
    materialInfluenceCount: results.filter((row) => row.passMaterialInfluence).length,
    avgReplacementPct: Math.round((replacementValues.reduce((sum, value) => sum + value, 0) / results.length) * 10) / 10,
    minReplacementPct: Math.min(...replacementValues),
    avgFirstTenClusterConsistency: Math.round((clusterConsistencyValues.reduce((sum, value) => sum + value, 0) / results.length) * 1000) / 1000,
    minFirstTenClusterConsistency: Math.min(...clusterConsistencyValues),
    sceneClusterViolationsRemoved: results.reduce((sum, row) => sum + (row.sceneClusterViolationsRemoved ?? 0), 0),
  };
  const payload: SceneWorldProofRunResult = {
    userId,
    librarySize: likedSongs.length,
    generatedAt: new Date().toISOString(),
    prompts: results,
    summary,
  };

  const outFile = opts?.outFile ?? path.join("reports", "scene-world-proof.json");
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  return payload;
}
