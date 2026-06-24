/**
 * Scene Cohesion human-save gate — first 10 tracks must share a scene cluster.
 *
 * Usage: npm run ci:scene-cohesion-human-save
 * Runs in build; fails if any of the 4 core prompts drop below 80% cluster consistency.
 */

import { buildLockedIntent } from "../core/v3/intent";
import { buildSceneWorldContext, computeWorldMembershipScore } from "../core/scene-world-layer";
import {
  computeFirstTenClusterConsistency,
  computeSceneClusterMembershipScore,
  shouldRejectForSceneCluster,
  openingSceneClusterThreshold,
} from "../core/scene-cohesion-clusters";
import type { SceneCohesionTrack } from "../core/scene-cohesion-clusters";

const MIN_FIRST_TEN_CLUSTER = 0.80;

type PromptFixture = {
  id: string;
  prompt: string;
  pool: SceneCohesionTrack[];
};

function track(
  id: string,
  artist: string,
  genreFamily: string,
  energy: number,
  valence: number,
  dance = 0.5,
  acoustic = 0.35,
): SceneCohesionTrack {
  return {
    trackId: id,
    artistName: artist,
    genrePrimary: genreFamily,
    genreFamily,
    energy,
    valence,
    danceability: dance,
    acousticness: acoustic,
    tempo: 118,
    speechiness: 0.05,
  };
}

const INDIE_POP_SUNSHINE: SceneCohesionTrack[] = [
  track("w1", "Wallows", "indie", 0.62, 0.68, 0.64, 0.28),
  track("w2", "Wallows", "indie", 0.60, 0.66, 0.62, 0.30),
  track("am1", "Arctic Monkeys", "indie", 0.64, 0.62, 0.58, 0.26),
  track("am2", "Arctic Monkeys", "indie", 0.66, 0.60, 0.56, 0.24),
  track("jb1", "Jake Bugg", "indie", 0.58, 0.64, 0.60, 0.32),
  track("jb2", "Jake Bugg", "indie", 0.60, 0.62, 0.58, 0.34),
  track("bh1", "Beach House", "indie", 0.52, 0.58, 0.48, 0.42),
  track("ti1", "Tame Impala", "indie", 0.58, 0.62, 0.60, 0.30),
  track("p1", "Dayglow", "pop", 0.64, 0.70, 0.66, 0.24),
  track("p2", "Clairo", "pop", 0.62, 0.68, 0.64, 0.26),
];

const WRONG_SUBWORLDS_SUMMER: SceneCohesionTrack[] = [
  track("tc1", "Tchami", "electronic", 0.72, 0.58, 0.78, 0.12),
  track("lb1", "Little Big", "electronic", 0.78, 0.62, 0.82, 0.10),
  track("wk1", "Wankelmut", "electronic", 0.68, 0.64, 0.74, 0.14),
  track("dr1", "Drake", "hip_hop", 0.58, 0.52, 0.62, 0.18),
  track("qotsa1", "Queens of the Stone Age", "rock", 0.72, 0.38, 0.44, 0.16),
];

const INDIE_FOLK_RAIN: SceneCohesionTrack[] = [
  track("nf1", "The National", "indie", 0.44, 0.36, 0.40, 0.48),
  track("nf2", "The National", "indie", 0.42, 0.34, 0.38, 0.50),
  track("bf1", "Bon Iver", "folk", 0.40, 0.38, 0.36, 0.58),
  track("bf2", "Bon Iver", "folk", 0.38, 0.36, 0.34, 0.60),
  track("sr1", "Sufjan Stevens", "folk", 0.42, 0.40, 0.38, 0.56),
  track("ph1", "Phoebe Bridgers", "indie", 0.44, 0.38, 0.40, 0.52),
  track("fh1", "Fleet Foxes", "folk", 0.46, 0.42, 0.42, 0.54),
  track("rt1", "Big Red Machine", "indie", 0.40, 0.36, 0.38, 0.50),
];

const WRONG_SUBWORLDS_RAIN: SceneCohesionTrack[] = [
  track("dd1", "Destructo Disk", "rock", 0.62, 0.32, 0.48, 0.20),
  track("sy1", "Sonic Youth", "rock", 0.58, 0.34, 0.44, 0.22),
  track("ho1", "Headie One", "hip_hop", 0.56, 0.40, 0.58, 0.16),
];

const COZY_SUNDAY: SceneCohesionTrack[] = [
  track("fr1", "Feist", "indie", 0.46, 0.60, 0.44, 0.54),
  track("fr2", "Feist", "indie", 0.44, 0.58, 0.42, 0.56),
  track("ib1", "Iron & Wine", "folk", 0.42, 0.58, 0.40, 0.62),
  track("ib2", "Iron & Wine", "folk", 0.40, 0.56, 0.38, 0.64),
  track("mg1", "M. Ward", "folk", 0.44, 0.58, 0.42, 0.58),
  track("nl1", "Norah Jones", "soul", 0.46, 0.62, 0.44, 0.52),
  track("bk1", "Beach House", "indie", 0.48, 0.58, 0.44, 0.48),
  track("sh1", "Snoh Aalegra", "soul", 0.48, 0.60, 0.46, 0.46),
];

const WRONG_SUBWORLDS_COZY: SceneCohesionTrack[] = [
  track("lc1", "Luke Combs", "country", 0.58, 0.62, 0.52, 0.40),
  track("jc1", "Johnny Cash", "country", 0.52, 0.48, 0.44, 0.58),
  track("met1", "Metallica", "metal", 0.78, 0.32, 0.38, 0.12),
];

const SUNSET_DRIVE: SceneCohesionTrack[] = [
  track("kh1", "Khruangbin", "indie", 0.52, 0.54, 0.50, 0.42),
  track("kh2", "Khruangbin", "indie", 0.50, 0.52, 0.48, 0.44),
  track("tv1", "Tame Impala", "indie", 0.56, 0.54, 0.54, 0.32),
  track("cr1", "Cigarettes After Sex", "indie", 0.48, 0.50, 0.46, 0.46),
  track("dh1", "Dayglow", "indie", 0.54, 0.56, 0.52, 0.34),
  track("mb1", "Mac DeMarco", "indie", 0.52, 0.54, 0.50, 0.38),
  track("fo1", "Future Islands", "indie", 0.56, 0.52, 0.54, 0.30),
  track("wd1", "The War on Drugs", "indie", 0.54, 0.52, 0.50, 0.36),
  track("re1", "Real Estate", "indie", 0.50, 0.54, 0.48, 0.40),
  track("bf3", "Big Thief", "indie", 0.48, 0.52, 0.46, 0.44),
];

const WRONG_SUBWORLDS_SUNSET: SceneCohesionTrack[] = [
  track("tc2", "Tchami", "electronic", 0.74, 0.56, 0.80, 0.10),
  track("lb2", "Little Big", "electronic", 0.80, 0.60, 0.84, 0.08),
  track("q2", "Queens of the Stone Age", "rock", 0.70, 0.36, 0.42, 0.18),
];

const FIXTURES: PromptFixture[] = [
  {
    id: "summer_morning",
    prompt: "Feel-good summer morning music to hype yourself up for the day, getting ready, and commuting to work.",
    pool: [...INDIE_POP_SUNSHINE, ...WRONG_SUBWORLDS_SUMMER],
  },
  {
    id: "rainy_city_walk",
    prompt: "rainy city morning walk with reflective mood",
    pool: [...INDIE_FOLK_RAIN, ...WRONG_SUBWORLDS_RAIN],
  },
  {
    id: "cozy_sunday",
    prompt: "soft happy Sunday afternoon with light emotional warmth",
    pool: [...COZY_SUNDAY, ...WRONG_SUBWORLDS_COZY],
  },
  {
    id: "sunset_drive",
    prompt: "driving at sunset with open windows and golden light",
    pool: [...SUNSET_DRIVE, ...WRONG_SUBWORLDS_SUNSET],
  },
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function simulateOpeningTen(context: ReturnType<typeof buildSceneWorldContext>, pool: SceneCohesionTrack[]): SceneCohesionTrack[] {
  if (!context) return [];
  const ranked = pool
    .map((candidate) => {
      const world = computeWorldMembershipScore(candidate, context);
      const cluster = computeSceneClusterMembershipScore(candidate, context);
      const combined = clamp01(world * 0.52 + cluster * 0.48);
      return { candidate, combined, world, cluster };
    })
    .filter((row) => row.world >= 0.26 && !shouldRejectForSceneCluster(row.candidate, context))
    .sort((a, b) => b.combined - a.combined);

  const opening: SceneCohesionTrack[] = [];
  for (const row of ranked) {
    if (opening.length >= 10) break;
    if (row.cluster >= openingSceneClusterThreshold(opening.length)) {
      opening.push(row.candidate);
    }
  }
  return opening;
}

function runFixture(fixture: PromptFixture): {
  id: string;
  pass: boolean;
  firstTenClusterConsistency: number;
  dominantSceneCluster: string | null;
  opening: string[];
} {
  const lockedIntent = buildLockedIntent(fixture.prompt);
  const context = buildSceneWorldContext({
    vibe: fixture.prompt,
    lockedIntent,
    tracks: fixture.pool,
  });
  if (!context?.sceneClusters) {
    return {
      id: fixture.id,
      pass: false,
      firstTenClusterConsistency: 0,
      dominantSceneCluster: null,
      opening: [],
    };
  }
  const opening = simulateOpeningTen(context, fixture.pool);
  const consistency = computeFirstTenClusterConsistency(opening, context);
  return {
    id: fixture.id,
    pass: opening.length >= 8 && consistency >= MIN_FIRST_TEN_CLUSTER,
    firstTenClusterConsistency: Math.round(consistency * 1000) / 1000,
    dominantSceneCluster: context.sceneClusters.dominantCluster.label,
    opening: opening.map((row) => `${row.artistName} (${row.genreFamily})`),
  };
}

function assertClusterSeparation(): void {
  const lockedIntent = buildLockedIntent(FIXTURES[0]!.prompt);
  const context = buildSceneWorldContext({
    vibe: FIXTURES[0]!.prompt,
    lockedIntent,
    tracks: FIXTURES[0]!.pool,
  });
  if (!context?.sceneClusters) throw new Error("expected scene clusters for summer morning fixture");

  const wallows = context.sceneClusters.trackToClusterId.get("w1");
  const tchami = context.sceneClusters.trackToClusterId.get("tc1");
  const littleBig = context.sceneClusters.trackToClusterId.get("lb1");
  if (!wallows || !tchami || !littleBig) throw new Error("missing cluster assignments");
  if (wallows === tchami || wallows === littleBig) {
    throw new Error("indie-pop and rave clusters should not merge");
  }

  const wallowsScore = computeSceneClusterMembershipScore(
    FIXTURES[0]!.pool.find((row) => row.trackId === "w1")!,
    context,
  );
  const tchamiScore = computeSceneClusterMembershipScore(
    FIXTURES[0]!.pool.find((row) => row.trackId === "tc1")!,
    context,
  );
  if (wallowsScore < 0.9) throw new Error(`Wallows should be in dominant cluster (${wallowsScore})`);
  if (tchamiScore >= 0.58) throw new Error(`Tchami should fail dominant cluster (${tchamiScore})`);
  if (shouldRejectForSceneCluster(FIXTURES[0]!.pool.find((row) => row.trackId === "tc1")!, context) !== true) {
    throw new Error("Tchami should be hard-rejected as genre-family scene tourist");
  }
}

function main(): void {
  assertClusterSeparation();

  let failed = 0;
  const results = FIXTURES.map((fixture) => {
    const result = runFixture(fixture);
    if (!result.pass) failed += 1;
    console.log(JSON.stringify(result));
    return result;
  });

  if (failed > 0) {
    console.error(`scene cohesion human-save gate failed (${results.length - failed}/${results.length})`);
    process.exit(1);
  }
  console.log(`scene cohesion human-save gate passed (${results.length} prompts, min first-10 cluster=${MIN_FIRST_TEN_CLUSTER})`);
}

main();
