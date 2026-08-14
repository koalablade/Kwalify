#!/usr/bin/env node
/**
 * V21 Experiment G — read-only disagreement diagnostic.
 * Does NOT modify production code or benchmarks.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "reports/playlist-evaluation");

const { resolveCommittedWorld, getCulturalProfileForCommitted } = await import("../dist/core/committed-world.js");
const { evaluateHumanCurationScore } = await import("../dist/core/editorial/human-curation-score.js");
const {
  scoreTrackWorldIdentity,
  resolveCulturalProfileForCommitted,
} = await import("../dist/core/editorial/world-identity-score.js");
const { resolveArtistWorldIdentity } = await import("../dist/core/editorial/artist-identity-map.js");
const { deriveWouldShareVerdict, SHARE_CORE_COHESION_MIN } = await import("../dist/core/editorial/shareability-verdict.js");

const reviewSet = JSON.parse(readFileSync(resolve(OUT_DIR, "v21-experiment-g-human-review-set.json"), "utf8"));
const mapping = JSON.parse(readFileSync(resolve(OUT_DIR, "v21-experiment-g-human-review-mapping.json"), "utf8")).mapping;
const listenScores = JSON.parse(readFileSync(resolve(OUT_DIR, "v21-experiment-g-listen-scores.json"), "utf8"));
const scoreById = Object.fromEntries(listenScores.scores.map((s) => [s.reviewId, s]));
const mapById = Object.fromEntries(mapping.map((m) => [m.reviewId, m]));

function normalizeTracks(tracklist) {
  return tracklist.map((t) => ({
    artistName: t.artistName,
    trackName: t.trackName,
    energy: 0.85,
    valence: 0.5,
    popularity: 70,
    acousticness: 0.1,
  }));
}

function worldTrace(reviewId) {
  const pl = reviewSet.playlists.find((p) => p.reviewId === reviewId);
  const m = mapById[reviewId];
  const prompt = pl.prompt;
  const tracks = normalizeTracks(pl.tracklist);
  const committed = resolveCommittedWorld({ prompt });
  const profile = resolveCulturalProfileForCommitted(committed);
  const evalResult = evaluateHumanCurationScore(prompt, tracks);
  const trackWorldScores = profile
    ? tracks.map((t) => ({
        artist: t.artistName,
        track: t.trackName,
        worldIdentity: scoreTrackWorldIdentity(t, profile),
      }))
    : tracks.map((t) => ({
        artist: t.artistName,
        track: t.trackName,
        artistMap: resolveArtistWorldIdentity(t.artistName)?.naturalWorlds?.slice(0, 4) ?? null,
      }));

  return {
    reviewId,
    prompt,
    stratum: m.stratum,
    stored: pl._evaluator,
    human: scoreById[reviewId],
    resolveCommittedWorld: committed
      ? {
          id: committed.id,
          source: committed.source,
          confidence: committed.confidence,
          hardLock: committed.hardLock,
          reason: committed.reason,
          worldIds: committed.worldIds,
        }
      : null,
    culturalProfile: profile?.worldId ?? null,
    cohesionEvidence: evalResult.dimensions.cohesion.evidence,
    cohesionScore: evalResult.dimensions.cohesion.score,
    momentScore: evalResult.dimensions.momentUnderstanding.score,
    hcsRecomputed: evalResult.totalScore,
    shareRecomputed: evalResult.wouldShare,
    shareBlockers: {
      cohesionBelow18: evalResult.dimensions.cohesion.score < SHARE_CORE_COHESION_MIN,
      hcsBelow85: evalResult.totalScore < 85,
      momentBelow20: evalResult.dimensions.momentUnderstanding.score < 20,
      profileMissingButWorldCommitted: Boolean(committed && !profile),
    },
    trackWorldScores,
    trackDiagnostics: evalResult.trackDiagnostics,
  };
}

const critical = ["G-016", "G-030", "G-032", "G-036"].map(worldTrace);

const counterfactuals = [
  { base: "G-032", prompt: "2000s pop punk gym workout", label: "as_delivered" },
  { base: "G-032", prompt: "2000s pop punk", label: "pop_punk_only" },
  { base: "G-032", prompt: "2000s pop punk workout", label: "workout_no_gym_phrase" },
  { base: "G-030", prompt: "hard techno gym", label: "as_delivered" },
  { base: "G-030", prompt: "hard techno workout", label: "techno_no_gym_token" },
].map(({ base, prompt, label }) => {
  const pl = reviewSet.playlists.find((p) => p.reviewId === base);
  const tracks = normalizeTracks(pl.tracklist);
  const committed = resolveCommittedWorld({ prompt });
  const profile = resolveCulturalProfileForCommitted(committed);
  const evalResult = evaluateHumanCurationScore(prompt, tracks);
  return { label, prompt, world: committed?.id ?? null, profile: profile?.worldId ?? null, hcs: evalResult.totalScore, cohesion: evalResult.dimensions.cohesion.score, share: evalResult.wouldShare };
});

// Artist recurrence across G set
const artistCounts = {};
const nucleus = new Set(["The Jungle Giants", "The 1975", "Wallows"]);
let primaryWithNucleus = 0;
let primaryTotal = 0;
const matrix = [];

for (const pl of reviewSet.playlists) {
  const m = mapById[pl.reviewId];
  const s = scoreById[pl.reviewId];
  const committed = resolveCommittedWorld({ prompt: pl.prompt });
  const profile = resolveCulturalProfileForCommitted(committed);
  const hasNucleus = pl.tracklist.some((t) => nucleus.has(t.artistName));
  if (m.stratum === "primary_g") {
    primaryTotal += 1;
    if (hasNucleus) primaryWithNucleus += 1;
  }
  for (const t of pl.tracklist) {
    artistCounts[t.artistName] = (artistCounts[t.artistName] || 0) + 1;
  }

  const promptWorldAlign =
    pl.reviewId === "G-030"
      ? "NO — rock delivered, hard techno requested"
      : pl.reviewId === "G-016"
        ? "YES — UK garage tracklist matches prompt"
        : pl.reviewId === "G-032" || pl.reviewId === "G-036"
          ? "PARTIAL — pop-punk tracklist vs heavy_gym committed world"
          : hasNucleus && m.stratum === "primary_g"
            ? "WEAK — indie nucleus on non-indie prompt"
            : profile
              ? "LIKELY — committed world has cultural profile"
              : committed
                ? "UNKNOWN — world commits but no cohesion profile"
                : "N/A";

  matrix.push({
    reviewId: pl.reviewId,
    prompt: pl.prompt,
    stratum: m.stratum,
    hcs: m.hcs,
    cohesion: m.cohesion,
    share: m.share,
    humanShare: s.wouldSendToFriend,
    detectedWorld: committed?.id ?? "NULL",
    culturalProfile: profile?.worldId ?? "NULL",
    promptWorldAlignment: promptWorldAlign,
    obviousWrongTrack: s.obviousWrongTrack,
    hasNucleusArtist: hasNucleus,
  });
}

const informativeIds = new Set([
  "G-001", "G-010", "G-016", "G-021", "G-023", "G-027", "G-030", "G-031", "G-032", "G-034", "G-036",
]);
const informativeMatrix = matrix.filter((r) => informativeIds.has(r.reviewId));

const output = {
  generatedAt: new Date().toISOString(),
  experiment: "G-diagnostic",
  readOnly: true,
  doesNotModifyProduction: true,
  criticalTraces: critical,
  counterfactuals,
  templateArtistAnalysis: {
    topArtists: Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([artist, count]) => ({ artist, count })),
    nucleusArtists: [...nucleus],
    playlistsWithNucleus: reviewSet.playlists.filter((p) => p.tracklist.some((t) => nucleus.has(t.artistName))).length,
    primaryGWithNucleus: primaryWithNucleus,
    primaryGTotal: primaryTotal,
  },
  culturalProfilesDefined: [
    "classic_rock_world", "dad_rock_world", "rainy_motorway_world", "rainy_drive_world",
    "night_drive_world", "80s_night_drive_world", "madchester_world", "grunge_world",
    "gym_rock_world", "gym_world", "heavy_gym_world", "angry_rock_world",
    "disco_1970s_world", "country_world", "disco_world",
  ],
  worldsWithoutCulturalProfileExamples: [
    "uk_garage_world", "pop_punk_world", "sunday_chill_world", "summer_warm_world", "indie_dream_world",
  ],
  informativeDisagreementMatrix: informativeMatrix,
  fullMatrix: matrix,
};

writeFileSync(resolve(OUT_DIR, "v21-experiment-g-diagnostic.json"), JSON.stringify(output, null, 2) + "\n");
console.log("Wrote v21-experiment-g-diagnostic.json");
console.log("Critical traces:", critical.map((c) => `${c.reviewId} world=${c.resolveCommittedWorld?.id} profile=${c.culturalProfile} coh=${c.cohesionScore} share=${c.shareRecomputed}`).join("\n"));
