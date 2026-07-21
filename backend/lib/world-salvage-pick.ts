/**
 * Pick identity-verified salvage tracks with artist diversity — not first-N library order.
 */

export function pickDiverseWorldSalvageTracks<T extends { trackId: string; artistName?: string | null }>(
  pool: readonly T[],
  opts: {
    cap: number;
    isEligible: (track: T) => boolean;
    seed?: string;
  },
): T[] {
  const eligible = pool.filter(opts.isEligible);
  if (eligible.length === 0) return [];

  let hash = 0;
  const seed = opts.seed ?? "";
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) | 0;
  }

  const shuffled = [...eligible].sort((a, b) => {
    const ah = (hash ^ a.trackId.split("").reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0)) % 997;
    const bh = (hash ^ b.trackId.split("").reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0)) % 997;
    return ah - bh;
  });

  const out: T[] = [];
  const seenArtist = new Set<string>();
  const seenTrack = new Set<string>();

  for (const track of shuffled) {
    if (out.length >= opts.cap) break;
    const artist = (track.artistName ?? "").toLowerCase().trim();
    if (!artist || seenTrack.has(track.trackId)) continue;
    if (seenArtist.has(artist)) continue;
    seenArtist.add(artist);
    seenTrack.add(track.trackId);
    out.push(track);
  }

  for (const track of shuffled) {
    if (out.length >= opts.cap) break;
    if (seenTrack.has(track.trackId)) continue;
    seenTrack.add(track.trackId);
    out.push(track);
  }

  return out;
}
