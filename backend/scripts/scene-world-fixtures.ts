/**
 * Scene World Layer unit fixtures.
 *
 * Usage: npx tsx backend/scripts/scene-world-fixtures.ts
 */

import {
  buildSceneWorldContext,
  computeWorldMembershipScore,
  extractSceneDescriptor,
  generateArchetypeCandidates,
  selectPlaylistArchetype,
} from "../core/scene-world-layer";
import {
  computeSceneClusterMembershipScore,
  shouldRejectForSceneCluster,
} from "../core/scene-cohesion-clusters";
import { buildLockedIntent } from "../core/v3/intent";
import { scorePlaylistWorldMetrics } from "../core/scene-world-editorial-audit";

type Track = {
  trackId: string;
  genreFamily: string;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
};

const SUMMER_PROMPT =
  "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.";

const POP_SUNSHINE: Track[] = [
  { trackId: "p1", genreFamily: "pop", energy: 0.64, valence: 0.72, danceability: 0.68, acousticness: 0.22 },
  { trackId: "p2", genreFamily: "indie", energy: 0.62, valence: 0.68, danceability: 0.62, acousticness: 0.28 },
  { trackId: "p3", genreFamily: "pop", energy: 0.66, valence: 0.70, danceability: 0.66, acousticness: 0.24 },
];

const GENRE_TOURISTS: Track[] = [
  { trackId: "q1", genreFamily: "rock", energy: 0.72, valence: 0.32, danceability: 0.40, acousticness: 0.18 },
  { trackId: "h1", genreFamily: "hip_hop", energy: 0.58, valence: 0.42, danceability: 0.62, acousticness: 0.20 },
  { trackId: "m1", genreFamily: "metal", energy: 0.82, valence: 0.28, danceability: 0.34, acousticness: 0.10 },
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function main(): void {
  const lockedIntent = buildLockedIntent(SUMMER_PROMPT);
  const descriptor = extractSceneDescriptor(SUMMER_PROMPT, lockedIntent);
  assert(descriptor.setting === "morning commute", "expected morning commute setting");
  assert(descriptor.season === "summer", "expected summer season");

  const candidates = generateArchetypeCandidates(descriptor);
  assert(candidates.length >= 2, "expected multiple archetype candidates");
  const archetype = selectPlaylistArchetype(candidates, SUMMER_PROMPT);
  assert(
    archetype.genreFamilies.includes("pop") || archetype.genreFamilies.includes("indie"),
    "expected pop/indie archetype for summer morning",
  );

  const pool = [...POP_SUNSHINE, ...GENRE_TOURISTS];
  const context = buildSceneWorldContext({
    vibe: SUMMER_PROMPT,
    lockedIntent,
    tracks: pool.map((track) => ({ ...track, genrePrimary: track.genreFamily })),
  });
  assert(context?.active === true, "scene world should activate");

  for (const track of POP_SUNSHINE) {
    const membership = computeWorldMembershipScore(track, context!);
    assert(membership >= 0.55, `pop sunshine track should fit world: ${track.trackId}=${membership}`);
  }
  for (const track of GENRE_TOURISTS) {
    const membership = computeWorldMembershipScore(track, context!);
    assert(membership < 0.45, `tourist track should not fit world: ${track.trackId}=${membership}`);
    if (context!.sceneClusters) {
      const clusterScore = computeSceneClusterMembershipScore(track, context!);
      assert(
        shouldRejectForSceneCluster(track, context!) || clusterScore < 0.58,
        `tourist track should fail scene cluster: ${track.trackId}=${clusterScore}`,
      );
    }
  }

  assert(context!.sceneClusters != null, "scene clusters should be built for soft prompt pool");
  assert(
    context!.sceneClusters!.dominantCluster.label.length > 0,
    "dominant scene cluster should be labeled",
  );

  const metrics = scorePlaylistWorldMetrics(POP_SUNSHINE, context!);
  assert(metrics.outlierCount === 0, "coherent pop sunshine set should have zero outliers");
  assert(metrics.firstTenCohesion >= 0.55, "first-ten cohesion should be strong");

  console.log(JSON.stringify({
    ok: true,
    descriptor,
    archetype: archetype.label,
    metrics,
  }, null, 2));
}

main();
