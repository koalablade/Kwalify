import { readFileSync } from "node:fs";

const STRESS_PROMPTS = [
  "Party",
  "Driving",
  "Gym",
  "Focus",
  "Garage Day",
  "Sad Upbeat",
  "Rainy Highway",
  "Beach Sunset",
  "Late Night",
  "Discover New Music",
  "90s Grunge Dark Cloudy Night",
  "2000s Pop Punk Gym Workout",
  "90s Neon Nite Driv Tekk Vibey But Hard",
  "Garage With Mates Fixing Cars",
  "Late Night Motorway In The Rain",
  "Lofi But Not Boring",
  "Old School Ravey Stuff",
] as const;

type StressResult = {
  prompt: string;
  generationDiagnostics?: Record<string, unknown>;
  artistDiversity?: Record<string, unknown>;
  playlistConfidence?: Record<string, unknown>;
  v3Diagnostics?: {
    playlistCoherence?: Record<string, unknown>;
  };
  fastFallback?: boolean;
  fallbackReason?: unknown;
  tracks?: unknown[];
  trackCount?: number;
  totalTracks?: number;
};

function usage(): never {
  console.error("Usage: node backend/dist/scripts/playlist-stress-report.js --results path/to/results.json");
  console.error("Result shape: [{ \"prompt\": \"Party\", \"generationDiagnostics\": {...}, \"tracks\": [...] }]");
  process.exit(2);
}

function resultsPathFromArgs(args: string[]): string {
  const idx = args.indexOf("--results");
  const value = idx >= 0 ? args[idx + 1] : process.env.PLAYLIST_STRESS_RESULTS;
  if (!value) usage();
  return value;
}

function asResults(raw: unknown): StressResult[] {
  if (!Array.isArray(raw)) throw new Error("Stress results must be an array");
  return raw.map((item, index) => {
    const row = item as Partial<StressResult>;
    if (typeof row.prompt !== "string") throw new Error(`Invalid stress result at index ${index}`);
    return row as StressResult;
  });
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function classifyStressFailures(row: {
  candidateCounts: Record<string, number | null>;
  fallbackUsed: boolean;
  coherenceScore: number | null;
  confidenceScore: number | null;
  trackCount: number | null;
}): string[] {
  return [
    row.candidateCounts.intent !== null && row.candidateCounts.intent <= 0 ? "intent_loss" : null,
    row.candidateCounts.era !== null && row.candidateCounts.intent !== null && row.candidateCounts.era < row.candidateCounts.intent * 0.35 ? "era_drift_risk" : null,
    row.candidateCounts.mood !== null && row.candidateCounts.era !== null && row.candidateCounts.mood < row.candidateCounts.era * 0.35 ? "emotional_mismatch_risk" : null,
    row.coherenceScore !== null && row.coherenceScore < 0.56 ? "sequencing_issues" : null,
    row.confidenceScore !== null && row.confidenceScore < 0.58 ? "low_realism" : null,
    row.trackCount !== null && row.trackCount < 20 ? "underfilling" : null,
    row.fallbackUsed ? "fallback_used" : null,
  ].filter((value): value is string => !!value);
}

function main(): void {
  const results = asResults(JSON.parse(readFileSync(resultsPathFromArgs(process.argv.slice(2)), "utf8")));
  const byPrompt = new Map(results.map((result) => [result.prompt.toLowerCase(), result]));
  const rows = STRESS_PROMPTS.map((prompt) => {
    const result = byPrompt.get(prompt.toLowerCase());
    const gen = result?.generationDiagnostics ?? {};
    const div = result?.artistDiversity ?? {};
    const confidence = result?.playlistConfidence ?? {};
    const coherence = result?.v3Diagnostics?.playlistCoherence ?? {};
    const row = {
      prompt,
      present: !!result,
      candidateCounts: {
        library: num(gen["initialLibrarySize"]),
        sampled: num(gen["candidatesSampled"]),
        classified: num(gen["candidatesClassified"]),
        intent: num(gen["candidatesAfterIntent"]),
        era: num(gen["candidatesAfterEra"]),
        mood: num(gen["candidatesAfterMood"]),
        ranking: num(gen["candidatesAfterRanking"]),
        repair: num(gen["candidatesAfterRepair"]),
        coherence: num(gen["candidatesAfterCoherence"]),
        final: num(gen["candidatesFinal"]),
      },
      artistDiversity: {
        uniqueArtists: num(div["uniqueArtists"]),
        repeatedArtists: num(div["repeatedArtists"]),
        cappedTracks: num(div["cappedTracks"]),
        topRepeatedArtist: div["topRepeatedArtist"] ?? null,
        topRepeatedArtistCount: num(div["topRepeatedArtistCount"]),
      },
      fallbackUsed: !!(result?.fastFallback || result?.fallbackReason || gen["fallbackTriggered"]),
      coherenceScore: num(coherence["avg_transition_score"]),
      confidenceScore: num(confidence["score"]),
      trackCount: result ? num(result.totalTracks) ?? num(result.trackCount) ?? (Array.isArray(result.tracks) ? result.tracks.length : null) : null,
    };
    return {
      ...row,
      launchFailureCategories: classifyStressFailures(row),
    };
  });
  const missing = rows.filter((row) => !row.present).map((row) => row.prompt);
  const failureDataset = rows.flatMap((row) =>
    row.launchFailureCategories.map((category) => ({
      category,
      prompt: row.prompt,
      evidence: {
        candidateCounts: row.candidateCounts,
        coherenceScore: row.coherenceScore,
        confidenceScore: row.confidenceScore,
        trackCount: row.trackCount,
        fallbackUsed: row.fallbackUsed,
      },
    }))
  );
  process.stdout.write(`${JSON.stringify({ pass: missing.length === 0, missing, failureDataset, rows }, null, 2)}\n`);
  if (missing.length > 0) process.exit(1);
}

main();
