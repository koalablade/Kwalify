export type EraRange = { start: number; end: number };

export type EraEvidenceTrack = {
  releaseYear?: number | null;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
};

export type EraEvidenceStatus = "match" | "mismatch" | "unknown";

const MIN_REASONABLE_YEAR = 1950;
const MAX_REASONABLE_YEAR = 2029;

const CLASSIC_ERA_ARTIST_RANGES: Array<{ pattern: RegExp; range: EraRange }> = [
  { pattern: /\bmeat\s*loaf\b/i, range: { start: 1977, end: 1995 } },
  { pattern: /\bblondie\b/i, range: { start: 1976, end: 1982 } },
  { pattern: /\bpat\s+benatar\b/i, range: { start: 1979, end: 1988 } },
  { pattern: /\bbon\s+jovi\b/i, range: { start: 1984, end: 1995 } },
  { pattern: /\bbryan\s+adams\b/i, range: { start: 1983, end: 1996 } },
  { pattern: /\b(?:def\s+leppard|journey|foreigner)\b/i, range: { start: 1978, end: 1989 } },
  { pattern: /\b(?:duran\s+duran|tears\s+for\s+fears|eurythmics)\b/i, range: { start: 1981, end: 1989 } },
  { pattern: /\b(?:the\s+cure|depeche\s+mode|new\s+order)\b/i, range: { start: 1980, end: 1993 } },
];

function validYear(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < MIN_REASONABLE_YEAR || value > MAX_REASONABLE_YEAR) return null;
  return value;
}

function rangeContains(range: EraRange, year: number): boolean {
  return year >= range.start && year <= range.end;
}

function rangesOverlap(a: EraRange, b: EraRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

function localTextYear(track: EraEvidenceTrack): number | null {
  const text = `${track.trackName ?? ""} ${track.albumName ?? ""}`;
  const matches = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/g) ?? [];
  for (const match of matches) {
    const year = validYear(Number(match));
    if (year) return year;
  }
  return null;
}

export function eraEvidenceYearForRange(track: EraEvidenceTrack, range: EraRange): number | null {
  const releaseYear = validYear(track.releaseYear);
  if (releaseYear) return rangeContains(range, releaseYear) ? releaseYear : null;

  const textYear = localTextYear(track);
  if (textYear) return rangeContains(range, textYear) ? textYear : null;

  const artist = track.artistName ?? "";
  const anchor = CLASSIC_ERA_ARTIST_RANGES.find((entry) => entry.pattern.test(artist));
  if (!anchor || !rangesOverlap(anchor.range, range)) return null;

  return Math.max(range.start, anchor.range.start);
}

export function eraEvidenceStatusForRange(track: EraEvidenceTrack, range: EraRange): EraEvidenceStatus {
  const releaseYear = validYear(track.releaseYear);
  if (releaseYear) return rangeContains(range, releaseYear) ? "match" : "mismatch";

  const textYear = localTextYear(track);
  if (textYear) return rangeContains(range, textYear) ? "match" : "mismatch";

  const artist = track.artistName ?? "";
  const anchor = CLASSIC_ERA_ARTIST_RANGES.find((entry) => entry.pattern.test(artist));
  if (!anchor) return "unknown";
  return rangesOverlap(anchor.range, range) ? "match" : "mismatch";
}

export function trackHasEraEvidence(track: EraEvidenceTrack, range: EraRange): boolean {
  return eraEvidenceStatusForRange(track, range) === "match";
}

export function trackHasKnownEraMismatch(track: EraEvidenceTrack, range: EraRange): boolean {
  return eraEvidenceStatusForRange(track, range) === "mismatch";
}
