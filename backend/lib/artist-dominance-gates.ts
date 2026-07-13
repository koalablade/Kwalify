const WATCH_ARTISTS = [
  { key: "paramore", patterns: ["paramore"] },
  { key: "fred", patterns: ["fred again"] },
  { key: "gnr", patterns: ["guns n roses", "gnr"] },
] as const;

export type ArtistDominanceRow = {
  ok?: boolean;
  benchmark?: { id?: string; category?: string };
  response?: { tracks?: Array<{ artist?: string }> } | Record<string, unknown> | null;
};

export type ArtistDominanceGate = {
  value: number;
  max: number;
  pass: boolean;
  prompt?: string;
};

export type ArtistDominanceResult = {
  succeeded: number;
  totals: Record<string, number>;
  earlyHalf: Record<string, number>;
  lateHalf: Record<string, number>;
  gates: {
    paramoreTotal: ArtistDominanceGate;
    paramoreLateHalf: ArtistDominanceGate;
    paramoreMaxPerPlaylist: ArtistDominanceGate;
    fredTotal: ArtistDominanceGate;
    gnrTotal: ArtistDominanceGate;
  };
  pass: boolean;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function matchArtist(artist: unknown): string | null {
  const n = norm(String(artist ?? ""));
  for (const t of WATCH_ARTISTS) {
    if (t.patterns.some((p) => n.includes(norm(p)))) return t.key;
  }
  return null;
}

function rowTracks(row: ArtistDominanceRow): Array<{ artist?: string }> {
  const response = row.response;
  if (!response || typeof response !== "object") return [];
  const tracks = (response as { tracks?: Array<{ artist?: string }> }).tracks;
  return Array.isArray(tracks) ? tracks : [];
}

export function analyzeArtistDominance(rows: ArtistDominanceRow[]): ArtistDominanceResult {
  const ok = rows.filter((r) => r.ok && rowTracks(r).length > 0);
  const totals: Record<string, number> = {};
  let maxPerPlaylist = 0;
  let maxPerPlaylistPrompt = "";

  for (const row of ok) {
    const counts: Record<string, number> = {};
    for (const t of rowTracks(row)) {
      const k = matchArtist(t.artist);
      if (!k) continue;
      counts[k] = (counts[k] ?? 0) + 1;
      totals[k] = (totals[k] ?? 0) + 1;
    }
    const paramore = counts.paramore ?? 0;
    if (paramore > maxPerPlaylist) {
      maxPerPlaylist = paramore;
      maxPerPlaylistPrompt = row.benchmark?.id ?? "";
    }
  }

  const half = Math.ceil(ok.length / 2);
  const early = { paramore: 0, fred: 0, gnr: 0 };
  const late = { paramore: 0, fred: 0, gnr: 0 };
  for (let i = 0; i < ok.length; i++) {
    const bucket = i < half ? early : late;
    for (const t of ok[i] ? rowTracks(ok[i]!) : []) {
      const k = matchArtist(t.artist);
      if (k === "paramore" || k === "fred" || k === "gnr") {
        bucket[k] += 1;
      }
    }
  }

  const gates = {
    paramoreTotal: { value: totals.paramore ?? 0, max: 18, pass: (totals.paramore ?? 0) <= 18 },
    paramoreLateHalf: { value: late.paramore, max: 8, pass: late.paramore <= 8 },
    paramoreMaxPerPlaylist: { value: maxPerPlaylist, max: 6, pass: maxPerPlaylist <= 6, prompt: maxPerPlaylistPrompt },
    fredTotal: { value: totals.fred ?? 0, max: 10, pass: (totals.fred ?? 0) <= 10 },
    gnrTotal: { value: totals.gnr ?? 0, max: 10, pass: (totals.gnr ?? 0) <= 10 },
  };

  return {
    succeeded: ok.length,
    totals,
    earlyHalf: early,
    lateHalf: late,
    gates,
    pass: Object.values(gates).every((g) => g.pass),
  };
}

export const EMPTY_PLAYLIST_GATE_MAX = 0;

export function countEmptyPlaylistFailures(rows: ArtistDominanceRow[]): number {
  return rows.filter((row) => !row.ok || rowTracks(row).length === 0).length;
}
