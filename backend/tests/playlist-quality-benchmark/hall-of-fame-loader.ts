/**
 * Hall of Fame dataset loader — permanent regression quality bar.
 */

import fs from "node:fs";
import path from "node:path";
import type { HallOfFameEntry, NegativeExample } from "./types";
import { loadPromptSuiteEntries } from "./prompt-suite-loader";

const HOF_DIR = resolveDatasetDir("playlist-hall-of-fame");
const CORPUS_PATH = resolveRepoPath("data", "corpus", "pairwise-benchmark-prompts.json");

function resolveRepoPath(...segments: string[]): string {
  const candidates = [
    path.join(__dirname, "..", "..", "..", "..", ...segments),
    path.join(__dirname, "..", "..", "..", ...segments),
    path.join(process.cwd(), ...segments),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function resolveDatasetDir(name: string): string {
  const candidates = [
    path.join(__dirname, "..", name),
    path.join(__dirname, "..", "..", "..", "tests", name),
    path.join(process.cwd(), "backend", "tests", name),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "entries.json")) || fs.existsSync(path.join(dir, "negative-examples.json"))) {
      return dir;
    }
  }
  return candidates[1]!;
}

export type ReferencePlaylistRow = {
  id: string;
  prompt: string;
  referenceTracks: Array<{
    trackName: string;
    artistName: string;
    genreFamily?: string | null;
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    acousticness?: number | null;
  }>;
};

export function loadHallOfFameEntries(): HallOfFameEntry[] {
  return loadPromptSuiteEntries("training");
}

export function loadNegativeExamples(): NegativeExample[] {
  const raw = fs.readFileSync(path.join(HOF_DIR, "negative-examples.json"), "utf8");
  const parsed = JSON.parse(raw) as Array<Omit<NegativeExample, "tracks"> & {
    tracks: Array<ReferencePlaylistRow["referenceTracks"][number]>;
  }>;
  return parsed.map((row) => ({
    ...row,
    tracks: row.tracks.map(toPatternTrack),
  }));
}

export function loadReferenceCorpus(): ReferencePlaylistRow[] {
  if (!fs.existsSync(CORPUS_PATH)) return [];
  return JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8")) as ReferencePlaylistRow[];
}

export function resolveReferenceTracks(entry: HallOfFameEntry): ReferencePlaylistRow["referenceTracks"] {
  if (!entry.referenceId) return [];
  const corpus = loadReferenceCorpus();
  const row = corpus.find((r) => r.id === entry.referenceId);
  return row?.referenceTracks ?? [];
}

export function toPatternTrack(
  row: ReferencePlaylistRow["referenceTracks"][number],
): import("../../core/editorial/human-playlist-patterns").PatternScoringTrack {
  return {
    trackId: `${row.artistName}-${row.trackName}`.toLowerCase().replace(/\s+/g, "-"),
    artistName: row.artistName,
    energy: row.energy ?? null,
    valence: row.valence ?? null,
    danceability: row.danceability ?? null,
    acousticness: row.acousticness ?? null,
    rediscoveryScore: 0.4,
  };
}
