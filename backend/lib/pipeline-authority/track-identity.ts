import type { DeliveryTrack } from "./types";

function normalizeRepeatToken(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\bfeat(?:\.|uring)?\b.*$/i, "")
    .replace(/\bfrom\s+"[^"]+".*$/i, "")
    .replace(/\s*-\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|radio edit|single edit|mono|stereo|explicit|clean|bonus track|album version|original mix).*$/i, "")
    .replace(/\b(?:remaster(?:ed)?|deluxe|expanded|anniversary|radio edit|single edit|edit|live|mono|stereo|version|mix)\b/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function trackRepeatSignature(track: DeliveryTrack): string | null {
  const artist = normalizeRepeatToken(track.artistName ?? track.artist);
  const title = normalizeRepeatToken(track.trackName ?? track.name);
  if (!artist || !title) return null;
  return `${artist}::${title}`;
}

export function countDuplicateTrackIds(tracks: DeliveryTrack[]): number {
  const ids = tracks.map((track) => track.trackId);
  return ids.length - new Set(ids).size;
}

export function countDuplicateSongIdentities(tracks: DeliveryTrack[]): number {
  const signatures = tracks
    .map((track) => trackRepeatSignature(track))
    .filter((value): value is string => !!value);
  return signatures.length - new Set(signatures).size;
}

export function diffTrackMutation(
  before: ReadonlyArray<DeliveryTrack>,
  after: ReadonlyArray<DeliveryTrack>,
): { added: number; removed: number; replaced: number } {
  const beforeIds = new Set(before.map((track) => track.trackId));
  const afterIds = new Set(after.map((track) => track.trackId));
  let added = 0;
  let removed = 0;
  for (const id of afterIds) {
    if (!beforeIds.has(id)) added += 1;
  }
  for (const id of beforeIds) {
    if (!afterIds.has(id)) removed += 1;
  }
  const replaced = Math.min(added, removed);
  return {
    added: added - replaced,
    removed: removed - replaced,
    replaced,
  };
}
