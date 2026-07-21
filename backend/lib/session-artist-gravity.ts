/**
 * Session-scoped artist gravity budget (SAGB) — post-assembly perceptual layer.
 *
 * Reorder-only: fatigued artists may swap with fresher alternatives from the
 * existing playlist pool. No retrieval, scoring, or recovery changes.
 */

export type SessionArtistHistory = {
  artistWeightedCount: Map<string, number>;
  artistPlaylistCount: Map<string, number>;
  sessionArtistHistorySize: number;
};

export type ArtistGravityDiagnostics = {
  sessionArtistHistorySize: number;
  artistsPenalized: string[];
  tracksConsidered: number;
  replacementsMade: number;
  swapsBlockedByConstraints: number;
  relaxedDueToSupply: boolean;
  topRepeatedArtistsBefore: Array<{ artist: string; count: number }>;
  topRepeatedArtistsAfter: Array<{ artist: string; count: number }>;
};

export type SessionArtistGravityOpts<T extends { artistName?: string | null; score?: number }> = {
  thinLibraryRelaxed?: boolean;
  auditDeterministic?: boolean;
  promptCentralArtists?: ReadonlySet<string>;
  scoreFn?: (track: T) => number;
  canReplaceWith?: (current: T, candidate: T, position: number) => boolean;
  minAlternativesForSwap?: number;
};

const GENERIC_NON_ARTIST =
  /\b(?:music|songs?|tracks?|playlist|mix|vibes?|hits|rock|pop|rap|jazz|country|electronic|metal|party|gym|focus|chill|study|workout|driving|sleep|rainy|morning|night|upbeat|calm|slow|fast|classic|nostalgic|energy|work|gaming|disco|soul|funk|punk|indie|alternative|ambient|house|techno|garage|dance|hip hop|hip-hop|r&b|blues|folk|reggae|latin|kpop|jpop|greatest|only|pure|just|goth|gothic|grunge|lofi|lo-fi|darkwave|synthwave|retrowave|cyberpunk|tek|boss|rage|quiet|neon|christmas|xmas|festive)\b/i;

function defaultScore(track: { score?: number }): number {
  return typeof track.score === "number" ? track.score : 0.5;
}

export function normalizeSessionArtist(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function positionWeight(index: number): number {
  if (index < 5) return 1.0;
  if (index < 10) return 0.75;
  if (index < 20) return 0.45;
  return 0.25;
}

function positionSwapUrgency(index: number): number {
  if (index < 5) return 1.0;
  if (index < 10) return 0.85;
  if (index < 20) return 0.6;
  return 0.4;
}

function artistFatigueTier(playlistCount: number, weightedCount: number): number {
  if (playlistCount <= 0) return 0;
  if (playlistCount === 1) return 0.1;
  if (playlistCount === 2) return 0.18;
  return Math.min(0.35, 0.22 + (playlistCount - 2) * 0.06 + weightedCount * 0.015);
}

function maxQualityGap(playlistCount: number, hardSwap: boolean): number {
  if (hardSwap) return playlistCount >= 3 ? 0.2 : 0.12;
  if (playlistCount === 1) return 0.05;
  return 0.08;
}

function isGenericNonArtistTerm(value: string): boolean {
  return !value || value.length < 3 || GENERIC_NON_ARTIST.test(value);
}

export function detectPromptCentralArtists(vibe: string): Set<string> {
  const central = new Set<string>();
  const patterns = [
    /\b([a-z0-9&'.-]+(?:\s+[a-z0-9&'.-]+){0,4})\s+greatest\s+hits\b/gi,
    /\b(?:songs?|tracks?|music)\s+by\s+([a-z0-9&'.-]+(?:\s+[a-z0-9&'.-]+){0,4})\b/gi,
    /\b(?:only|pure|just)\s+([a-z0-9&'.-]+(?:\s+[a-z0-9&'.-]+){0,4})\b/gi,
    /\b([a-z0-9&'.-]+(?:\s+[a-z0-9&'.-]+){0,3})\s+(?:playlist|mix|vibes?)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of vibe.matchAll(pattern)) {
      const artist = normalizeSessionArtist(match[1] ?? "");
      if (!isGenericNonArtistTerm(artist)) central.add(artist);
    }
  }
  return central;
}

export function buildSessionArtistHistory(priorPlaylistArtists: string[][]): SessionArtistHistory {
  const artistWeightedCount = new Map<string, number>();
  const artistPlaylistCount = new Map<string, number>();
  let sessionArtistHistorySize = 0;

  for (const artists of priorPlaylistArtists) {
    const playlistArtists = artists
      .map((name) => normalizeSessionArtist(name))
      .filter((name) => name.length > 0);
    if (playlistArtists.length === 0) continue;
    sessionArtistHistorySize += 1;
    const seenInPlaylist = new Set<string>();
    for (let i = 0; i < playlistArtists.length; i += 1) {
      const artist = playlistArtists[i]!;
      artistWeightedCount.set(
        artist,
        (artistWeightedCount.get(artist) ?? 0) + positionWeight(i),
      );
      if (!seenInPlaylist.has(artist)) {
        seenInPlaylist.add(artist);
        artistPlaylistCount.set(artist, (artistPlaylistCount.get(artist) ?? 0) + 1);
      }
    }
  }

  return { artistWeightedCount, artistPlaylistCount, sessionArtistHistorySize };
}

function countArtistsInPlaylist<T extends { artistName?: string | null }>(
  tracks: T[],
): Array<{ artist: string; count: number }> {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const artist = normalizeSessionArtist(track.artistName ?? "");
    if (!artist) continue;
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist))
    .slice(0, 8);
}

function compareAlternatives<T extends { artistName?: string | null }>(
  a: { index: number; track: T; score: number; fatigue: number },
  b: { index: number; track: T; score: number; fatigue: number },
  deterministic: boolean,
): number {
  if (a.fatigue !== b.fatigue) return a.fatigue - b.fatigue;
  if (b.score !== a.score) return b.score - a.score;
  if (deterministic) {
    const aArtist = normalizeSessionArtist(a.track.artistName ?? "");
    const bArtist = normalizeSessionArtist(b.track.artistName ?? "");
    return aArtist.localeCompare(bArtist);
  }
  return a.index - b.index;
}

function artistIsCentral(
  artist: string,
  promptCentralArtists: ReadonlySet<string> | undefined,
): boolean {
  if (!promptCentralArtists || promptCentralArtists.size === 0) return false;
  if (promptCentralArtists.has(artist)) return true;
  for (const central of promptCentralArtists) {
    if (artist.includes(central) || central.includes(artist)) return true;
  }
  return false;
}

export function applySessionArtistGravity<T extends { artistName?: string | null; score?: number }>(
  tracks: T[],
  history: SessionArtistHistory,
  opts?: SessionArtistGravityOpts<T>,
): { tracks: T[]; diagnostics: ArtistGravityDiagnostics } {
  const scoreFn = opts?.scoreFn ?? defaultScore;
  const deterministic = opts?.auditDeterministic === true;
  const thinRelaxed = opts?.thinLibraryRelaxed === true;
  const minAlternatives = opts?.minAlternativesForSwap ?? 2;
  const canReplaceWith = opts?.canReplaceWith ?? (() => true);
  const promptCentralArtists = opts?.promptCentralArtists;

  const topRepeatedArtistsBefore = countArtistsInPlaylist(tracks);
  const emptyDiagnostics: ArtistGravityDiagnostics = {
    sessionArtistHistorySize: history.sessionArtistHistorySize,
    artistsPenalized: [],
    tracksConsidered: 0,
    replacementsMade: 0,
    swapsBlockedByConstraints: 0,
    relaxedDueToSupply: thinRelaxed,
    topRepeatedArtistsBefore,
    topRepeatedArtistsAfter: topRepeatedArtistsBefore,
  };

  if (tracks.length < 2 || history.sessionArtistHistorySize === 0) {
    return { tracks: [...tracks], diagnostics: emptyDiagnostics };
  }

  const result = [...tracks];
  const freshArtistCount = new Set(
    result
      .map((track) => normalizeSessionArtist(track.artistName ?? ""))
      .filter((artist) => artist.length > 0 && (history.artistPlaylistCount.get(artist) ?? 0) === 0),
  ).size;

  const relaxedDueToSupply =
    thinRelaxed || result.length < 12 || freshArtistCount < minAlternatives;

  const artistsPenalized = new Set<string>();
  let tracksConsidered = 0;
  let replacementsMade = 0;
  let swapsBlockedByConstraints = 0;

  for (let i = 0; i < result.length; i += 1) {
    const current = result[i]!;
    const artist = normalizeSessionArtist(current.artistName ?? "");
    if (!artist || artistIsCentral(artist, promptCentralArtists)) continue;

    const playlistCount = history.artistPlaylistCount.get(artist) ?? 0;
    if (playlistCount <= 0) continue;

    const weightedCount = history.artistWeightedCount.get(artist) ?? 0;
    const fatigue = artistFatigueTier(playlistCount, weightedCount) * positionSwapUrgency(i);
    if (fatigue < 0.08) continue;

    tracksConsidered += 1;
    artistsPenalized.add(artist);

    const currentScore = scoreFn(current);
    const hardSwap = !relaxedDueToSupply && playlistCount >= 2 && freshArtistCount >= minAlternatives;
    const gap = maxQualityGap(playlistCount, hardSwap);

    const alternatives: Array<{ index: number; track: T; score: number; fatigue: number }> = [];

    for (let j = i + 1; j < result.length; j += 1) {
      const candidate = result[j]!;
      const candidateArtist = normalizeSessionArtist(candidate.artistName ?? "");
      if (!candidateArtist || candidateArtist === artist) continue;
      if (artistIsCentral(candidateArtist, promptCentralArtists)) continue;

      const candidatePlaylistCount = history.artistPlaylistCount.get(candidateArtist) ?? 0;
      if (candidatePlaylistCount >= playlistCount) continue;

      if (!canReplaceWith(current, candidate, i)) {
        swapsBlockedByConstraints += 1;
        continue;
      }

      const score = scoreFn(candidate);
      if (score >= currentScore - gap) {
        alternatives.push({
          index: j,
          track: candidate,
          score,
          fatigue: candidatePlaylistCount + (history.artistWeightedCount.get(candidateArtist) ?? 0) * 0.01,
        });
      }
    }

    if (alternatives.length === 0) continue;

    alternatives.sort((a, b) => compareAlternatives(a, b, deterministic));
    const best = alternatives[0]!;

    if (!hardSwap && playlistCount === 1 && best.score < currentScore - 0.05) {
      continue;
    }

    const swapIndex = best.index;
    result[i] = best.track;
    result[swapIndex] = current;
    replacementsMade += 1;
  }

  return {
    tracks: result,
    diagnostics: {
      sessionArtistHistorySize: history.sessionArtistHistorySize,
      artistsPenalized: [...artistsPenalized].sort(),
      tracksConsidered,
      replacementsMade,
      swapsBlockedByConstraints,
      relaxedDueToSupply,
      topRepeatedArtistsBefore,
      topRepeatedArtistsAfter: countArtistsInPlaylist(result),
    },
  };
}
