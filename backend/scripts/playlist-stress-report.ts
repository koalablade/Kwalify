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

function main(): void {
  const results = asResults(JSON.parse(readFileSync(resultsPathFromArgs(process.argv.slice(2)), "utf8")));
  const byPrompt = new Map(results.map((result) => [result.prompt.toLowerCase(), result]));
  const rows = STRESS_PROMPTS.map((prompt) => {
    const result = byPrompt.get(prompt.toLowerCase());
    const gen = result?.generationDiagnostics ?? {};
    const div = result?.artistDiversity ?? {};
    const confidence = result?.playlistConfidence ?? {};
    const coherence = result?.v3Diagnostics?.playlistCoherence ?? {};
    return {
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
  });
  const missing = rows.filter((row) => !row.present).map((row) => row.prompt);
  process.stdout.write(`${JSON.stringify({ pass: missing.length === 0, missing, rows }, null, 2)}\n`);
  if (missing.length > 0) process.exit(1);
}

main();
