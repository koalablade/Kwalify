/**
 * Artist ecosystem graph — scene-coherent artist adjacency beyond Spotify metadata.
 */

import { db, userTasteGraphTable } from "../db";
import { eq } from "drizzle-orm";

export type ArtistEcosystemNode = {
  id: string;
  label: string;
  ecosystemIds: string[];
  weight: number;
};

export type ArtistEcosystemEdge = {
  from: string;
  to: string;
  weight: number;
  source: "seed" | "co_occurrence" | "genre_family";
};

export type ArtistEcosystemGraph = {
  nodes: ArtistEcosystemNode[];
  edges: ArtistEcosystemEdge[];
  artistToEcosystems: Record<string, string[]>;
  version: string;
};

const ECOSYSTEM_SEEDS: Array<{ id: string; label: string; artists: string[] }> = [
  {
    id: "uk_post_dubstep",
    label: "UK Post-Dubstep / Electronic Soul",
    artists: ["burial", "four tet", "jamie xx", "mount kimbie", "floating points", "the xx", "james blake", "disclosure"],
  },
  {
    id: "uk_garage_grime",
    label: "UK Garage / Grime",
    artists: ["skepta", "wiley", "dizzee rascal", "kano", "stormzy", "jme", "ghetts", "d double e"],
  },
  {
    id: "warehouse_techno",
    label: "Warehouse / Industrial Techno",
    artists: ["surgeon", "regis", "blawan", "pangaea", "ben klock", "marcel dettmann", "len faki", "amelie lens"],
  },
  {
    id: "dnb_liquid",
    label: "Drum & Bass / Liquid",
    artists: ["calibre", "high contrast", "ltj bukem", "netsky", "chase & status", "sub focus", "fred v", "grafix"],
  },
  {
    id: "shoegaze_dream",
    label: "Shoegaze / Dream Pop",
    artists: ["my bloody valentine", "slowdive", "ride", "cocteau twins", "beach house", "cigarettes after sex"],
  },
];

function normalizeArtist(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

function artistId(name: string): string {
  return `artist:${normalizeArtist(name).replace(/[^a-z0-9]+/g, "_")}`;
}

export function buildArtistEcosystemGraph(opts: {
  likedTracks: Array<{ artistName: string; trackId: string }>;
  existing?: ArtistEcosystemGraph | null;
}): ArtistEcosystemGraph {
  const artistToEcosystems: Record<string, string[]> = {};
  const nodes = new Map<string, ArtistEcosystemNode>();
  const edges: ArtistEcosystemEdge[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (from: string, to: string, weight: number, source: ArtistEcosystemEdge["source"]) => {
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, weight, source });
  };

  for (const seed of ECOSYSTEM_SEEDS) {
    for (const artist of seed.artists) {
      const id = artistId(artist);
      const key = normalizeArtist(artist);
      artistToEcosystems[key] = unique(artistToEcosystems[key] ?? [], [seed.id]);
      nodes.set(id, {
        id,
        label: artist,
        ecosystemIds: artistToEcosystems[key],
        weight: 0.6,
      });
    }
    for (let i = 0; i < seed.artists.length; i++) {
      for (let j = i + 1; j < seed.artists.length; j++) {
        addEdge(artistId(seed.artists[i]!), artistId(seed.artists[j]!), 0.55, "seed");
      }
    }
  }

  const coCounts = new Map<string, number>();
  const tracksByArtist = new Map<string, string[]>();
  for (const track of opts.likedTracks) {
    const key = normalizeArtist(track.artistName);
    const list = tracksByArtist.get(key) ?? [];
    list.push(track.trackId);
    tracksByArtist.set(key, list);
    if (!nodes.has(artistId(track.artistName))) {
      nodes.set(artistId(track.artistName), {
        id: artistId(track.artistName),
        label: track.artistName,
        ecosystemIds: [],
        weight: 0.35,
      });
    }
  }

  const artistKeys = [...tracksByArtist.keys()];
  for (let i = 0; i < artistKeys.length; i++) {
    for (let j = i + 1; j < artistKeys.length; j++) {
      const a = artistKeys[i]!;
      const b = artistKeys[j]!;
      const sharedEcosystems = (artistToEcosystems[a] ?? []).filter((e) => (artistToEcosystems[b] ?? []).includes(e));
      if (sharedEcosystems.length > 0) {
        const w = 0.25 + sharedEcosystems.length * 0.1;
        addEdge(artistId(a), artistId(b), w, "seed");
      }
    }
  }

  for (const track of opts.likedTracks) {
    const key = normalizeArtist(track.artistName);
    const bucket = coCounts.get(key) ?? 0;
    coCounts.set(key, bucket + 1);
  }

  const topArtists = [...coCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([a]) => a);
  for (let i = 0; i < topArtists.length; i++) {
    for (let j = i + 1; j < topArtists.length; j++) {
      const shared = (artistToEcosystems[topArtists[i]!] ?? []).filter((e) =>
        (artistToEcosystems[topArtists[j]!] ?? []).includes(e)
      );
      if (shared.length === 0) continue;
      addEdge(artistId(topArtists[i]!), artistId(topArtists[j]!), 0.18 + shared.length * 0.05, "co_occurrence");
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    artistToEcosystems,
    version: "artist-ecosystem-v1",
  };
}

function unique<T>(base: T[], extra: T[]): T[] {
  return [...new Set([...base, ...extra])];
}

export function artistEcosystemBoost(
  artistName: string | null | undefined,
  graph: ArtistEcosystemGraph | null | undefined,
  promptArtistHints: string[] = [],
): number {
  if (!graph || !artistName) return 0;
  const key = normalizeArtist(artistName);
  const ecosystems = graph.artistToEcosystems[key] ?? [];
  if (ecosystems.length === 0) return 0;
  let boost = Math.min(0.12, ecosystems.length * 0.04);
  for (const hint of promptArtistHints) {
    const hintKey = normalizeArtist(hint);
    const hintEco = graph.artistToEcosystems[hintKey] ?? [];
    if (hintEco.some((e) => ecosystems.includes(e))) boost += 0.06;
  }
  return Math.min(0.22, boost);
}

export async function persistArtistEcosystemGraph(userId: string, graph: ArtistEcosystemGraph): Promise<void> {
  const payload = {
    artistEcosystem: graph,
    updatedAt: new Date().toISOString(),
  };
  const existing = await db
    .select({ id: userTasteGraphTable.id })
    .from(userTasteGraphTable)
    .where(eq(userTasteGraphTable.userId, userId))
    .limit(1);
  if (existing[0]) {
    await db
      .update(userTasteGraphTable)
      .set({
        edges: graph.edges as unknown as Record<string, unknown>[],
        nodes: graph.nodes as unknown as Record<string, unknown>[],
        genreWeights: { artistEcosystem: payload } as unknown as Record<string, number>,
        updatedAt: new Date(),
      })
      .where(eq(userTasteGraphTable.userId, userId));
  } else {
    await db.insert(userTasteGraphTable).values({
      userId,
      nodes: graph.nodes as unknown as Record<string, unknown>[],
      edges: graph.edges as unknown as Record<string, unknown>[],
      genreWeights: { artistEcosystem: payload } as unknown as Record<string, number>,
    });
  }
}

export async function loadArtistEcosystemGraph(userId: string): Promise<ArtistEcosystemGraph | null> {
  const rows = await db
    .select({ genreWeights: userTasteGraphTable.genreWeights })
    .from(userTasteGraphTable)
    .where(eq(userTasteGraphTable.userId, userId))
    .limit(1);
  return loadArtistEcosystemFromTasteGraph(rows[0]?.genreWeights as Record<string, unknown> | undefined);
}

export function loadArtistEcosystemFromTasteGraph(
  genreWeights: Record<string, unknown> | null | undefined,
): ArtistEcosystemGraph | null {
  const raw = genreWeights?.["artistEcosystem"] as { artistEcosystem?: ArtistEcosystemGraph } | undefined;
  return raw?.artistEcosystem ?? null;
}
