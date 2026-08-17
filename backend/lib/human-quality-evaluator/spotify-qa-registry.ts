/**
 * File registry for Spotify QA playlists. Cleanup may only target these IDs.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SpotifyQaAddFailure } from "./spotify-qa-adapter";

export const QA_PLAYLIST_MARKER = "Kwalify Human QA";

export type QaPlaylistRecord = {
  benchmarkRunId: string;
  requestId: string;
  promptId: string;
  prompt: string;
  category: string;
  generationCommit: string | null;
  engine: "V55";
  automatedVerdict: string;
  whySelected: string;
  humanQuestion: string;
  spotifyPlaylistId: string | null;
  spotifyUrl: string | null;
  spotifyUri: string | null;
  createdAt: string;
  status: "created" | "partial" | "skipped_empty" | "skipped_existing" | "failed" | "deleted" | "dry_run";
  tracksRequested: number;
  tracksAdded: number;
  addFailures: SpotifyQaAddFailure[];
  humanReviewStatus: "pending" | "reviewed";
};

export type QaPlaylistRegistry = {
  version: 1;
  marker: typeof QA_PLAYLIST_MARKER;
  benchmarkRunId: string;
  updatedAt: string;
  playlists: QaPlaylistRecord[];
};

export function emptyRegistry(benchmarkRunId: string): QaPlaylistRegistry {
  return {
    version: 1,
    marker: QA_PLAYLIST_MARKER,
    benchmarkRunId,
    updatedAt: new Date().toISOString(),
    playlists: [],
  };
}

export async function loadQaRegistry(path: string, benchmarkRunId: string): Promise<QaPlaylistRegistry> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as QaPlaylistRegistry;
    if (raw.version !== 1 || raw.marker !== QA_PLAYLIST_MARKER) {
      throw new Error(`Invalid QA registry at ${path}`);
    }
    return raw;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") return emptyRegistry(benchmarkRunId);
    throw err;
  }
}

export async function saveQaRegistry(path: string, registry: QaPlaylistRegistry): Promise<void> {
  registry.updatedAt = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`);
}

export function findRegistryEntry(registry: QaPlaylistRegistry, requestId: string): QaPlaylistRecord | undefined {
  return registry.playlists.find((p) => p.requestId === requestId && p.status !== "deleted");
}

export function upsertRegistryEntry(registry: QaPlaylistRegistry, entry: QaPlaylistRecord): void {
  const i = registry.playlists.findIndex((p) => p.requestId === entry.requestId);
  if (i >= 0) registry.playlists[i] = entry;
  else registry.playlists.push(entry);
}
