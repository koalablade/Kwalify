/**
 * Quality Lock Layer — post-interleave correctness gate.
 *
 * Sits between interleaveLanes() and the final T→output mapping.
 * Operates on a minimal QualityLockRecord slice to avoid generic type overhead.
 * Returns ordered trackIds; the caller maps back to original track objects.
 *
 * Six gates applied in sequence:
 *   1. Track deduplication       — defensive; removes exact duplicate trackIds
 *   2. Genre exclusion           — vibe-keyed; removes genre-incompatible tracks
 *   3. Artist uniqueness         — max 1 per artist for ≤30-track playlists;
 *                                  ceil(n × 0.12) for larger playlists
 *   4. Refill loop               — replaces every removed slot from the scored
 *                                  candidate pool (sorted by laneScore desc)
 *   5. Genre entropy floor       — if normalised entropy < 0.75, swap the
 *                                  weakest track from each over-represented genre
 *                                  with the best candidate from an under-represented one
 *   6. Vibe consistency check    — swaps ≤ 2 extreme energy/valence outliers if
 *                                  a meaningfully better-fit candidate exists in the pool
 *
 * "Bad tracks cannot exit the system."
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface QualityLockRecord {
  trackId: string;
  artistName: string;
  energy: number | null;
  valence: number | null;
  sourceLane: string;
  /** Composite lane score — used to rank candidates for refill. */
  laneScore: number;
  genrePrimary: string;
  laneEra: string;
  clusterIds: string[];
}

export interface QualityLockOpts {
  targetCount: number;
  vibe: string;
  sceneInfluenceMap: Record<string, number>;
  /** Target energy from emotion profile. */
  targetEnergy: number;
  /** Target valence from emotion profile. */
  targetValence: number;
}

export interface QualityLockDiagnostics {
  trackDuplicatesRemoved: number;
  genreExclusionsApplied: number;
  artistDuplicatesRemoved: number;
  refillCount: number;
  entropyRefillApplied: boolean;
  vibeOutliersSwapped: number;
  finalGenreEntropy: number;
  excludedGenres: string[];
  maxArtistRule: number;
  intentLockApplied: boolean;
}

// ── Entropy helper ──────────────────────────────────────────────────────────

function normEntropy(dist: Record<string, number>): number {
  const total = Object.values(dist).reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  const n = Object.keys(dist).length;
  if (n <= 1) return 0;
  const raw = -Object.values(dist).reduce((s, v) => {
    const p = v / total;
    return s + (p > 0 ? p * Math.log2(p) : 0);
  }, 0);
  return Math.min(1, raw / Math.log2(n));
}

function buildDist(tracks: QualityLockRecord[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const t of tracks) d[t.genrePrimary] = (d[t.genrePrimary] ?? 0) + 1;
  return d;
}

// ── Context-aware genre exclusion ───────────────────────────────────────────

/**
 * Derives the set of genres that are incompatible with the current vibe context.
 *
 * Rule: exclusions are CONTEXT-AWARE — not a global ban.
 *   "Indie Summertime Drive" → exclude hip_hop/trap (no rhythm/urban balance)
 *   "hip hop workout"        → hip_hop is fine, metal excluded if calm signals present
 *
 * Why: scoring can still surface a high-scoring hip-hop track for an indie prompt
 *   because the tri-score weights don't hard-block genres. This gate enforces
 *   the output contract that the user's vibe descriptor implies.
 */
export function resolveExcludedGenres(
  vibe: string,
  sceneMap: Record<string, number>,
): Set<string> {
  const excluded = new Set<string>();
  const vl = vibe.toLowerCase();

  const rhythm  = sceneMap["rhythm"]   ?? 0;
  const urban   = sceneMap["urban"]    ?? 0;
  const party   = sceneMap["party"]    ?? 0;
  const energyF = sceneMap["energy"]   ?? 0;
  const warmth  = sceneMap["warmth"]   ?? 0;
  const acoustic = sceneMap["acoustic"] ?? 0;

  // Indie / folk / acoustic / summer → exclude hip-hop family unless balanced by
  // significant urban or rhythm forces (e.g. "hip hop summer playlist" should not exclude).
  const hasIndieAcousticContext =
    /\b(indie|folk|acoustic|summer(?:time)?|alt(?:ernative)?)\b/.test(vl);
  const hasUrbanRhythmBalance = rhythm > 0.22 || urban > 0.18 || party > 0.20;

  if (hasIndieAcousticContext && !hasUrbanRhythmBalance) {
    excluded.add("hip_hop");
    excluded.add("trap");
    excluded.add("rap");
  }

  // Very acoustic + warm context (campfire, folk session) → exclude metal
  if (warmth + acoustic > 0.38 && energyF < 0.25) {
    excluded.add("metal");
  }

  return excluded;
}

// ── Candidate pool helpers ──────────────────────────────────────────────────

function findNextCandidate(
  pool: QualityLockRecord[],
  usedIds: Set<string>,
  artistCounts: Map<string, number>,
  excluded: Set<string>,
  maxPerArtist: number,
): QualityLockRecord | null {
  for (const c of pool) {
    if (usedIds.has(c.trackId)) continue;
    if (excluded.has(c.genrePrimary)) continue;
    if ((artistCounts.get(c.artistName) ?? 0) >= maxPerArtist) continue;
    return c;
  }
  return null;
}

function buildArtistCounts(tracks: QualityLockRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tracks) m.set(t.artistName, (m.get(t.artistName) ?? 0) + 1);
  return m;
}

function intentLockStrength(vibe: string, sceneMap: Record<string, number>): number {
  const vl = vibe.toLowerCase();
  const countryText =
    /\b(country|americana|alt.?country|western|cowboy|honky.?tonk|bluegrass|appalachian|roots?)\b/.test(vl);
  const ruralAcoustic =
    (sceneMap["rural"] ?? 0) +
    (sceneMap["acoustic"] ?? 0) +
    (sceneMap["warmth"] ?? 0);
  if (countryText && ruralAcoustic > 0.35) return 1;
  if (countryText || ruralAcoustic > 0.48) return 0.75;
  return 0;
}

// ── Vibe distance ────────────────────────────────────────────────────────────

function vibeDist(
  t: QualityLockRecord,
  targetE: number,
  targetV: number,
): number {
  return (
    Math.abs((t.energy ?? 0.5) - targetE) +
    Math.abs((t.valence ?? 0.5) - targetV)
  ) / 2;
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param interleavedTracks  Final interleaved output — may contain artist dupes,
 *                           genre bleed, vibe outliers.
 * @param candidatePool      All scored tracks NOT in interleavedTracks, sorted by
 *                           laneScore desc. Used as the refill source.
 */
export function applyQualityLock(
  interleavedTracks: QualityLockRecord[],
  candidatePool: QualityLockRecord[],
  opts: QualityLockOpts,
): { trackIds: string[]; diagnostics: QualityLockDiagnostics } {

  const { targetCount, vibe, sceneInfluenceMap, targetEnergy, targetValence } = opts;
  const lockStrength = intentLockStrength(vibe, sceneInfluenceMap);
  const intentLocked = lockStrength >= 0.75;

  // For ≤30 tracks: max 1 appearance per artist (strict uniqueness).
  // For larger playlists: allow up to ceil(n × 0.12) per artist.
  const maxPerArtist = intentLocked
    ? Math.max(2, Math.ceil(targetCount * 0.16))
    : targetCount <= 30
      ? 1
      : Math.ceil(targetCount * 0.12);

  const excluded = resolveExcludedGenres(vibe, sceneInfluenceMap);

  const diag: QualityLockDiagnostics = {
    trackDuplicatesRemoved: 0,
    genreExclusionsApplied: 0,
    artistDuplicatesRemoved: 0,
    refillCount: 0,
    entropyRefillApplied: false,
    vibeOutliersSwapped: 0,
    finalGenreEntropy: 0,
    excludedGenres: [...excluded],
    maxArtistRule: maxPerArtist,
    intentLockApplied: intentLocked,
  };

  let working = [...interleavedTracks];

  // ── Gate 1: Track deduplication ──────────────────────────────────────────
  {
    const seen = new Set<string>();
    const next: QualityLockRecord[] = [];
    for (const t of working) {
      if (seen.has(t.trackId)) {
        diag.trackDuplicatesRemoved++;
      } else {
        seen.add(t.trackId);
        next.push(t);
      }
    }
    working = next;
  }

  // ── Gate 2: Genre exclusion ───────────────────────────────────────────────
  if (excluded.size > 0) {
    const next: QualityLockRecord[] = [];
    for (const t of working) {
      if (excluded.has(t.genrePrimary)) {
        diag.genreExclusionsApplied++;
      } else {
        next.push(t);
      }
    }
    working = next;
  }

  // ── Gate 3: Artist uniqueness ─────────────────────────────────────────────
  // Linear scan: keeps the first (interleaver-positioned) occurrence.
  // The interleaver already places higher-scoring tracks earlier in most cases.
  {
    const artistCount = new Map<string, number>();
    const next: QualityLockRecord[] = [];
    for (const t of working) {
      const n = artistCount.get(t.artistName) ?? 0;
      if (n < maxPerArtist) {
        artistCount.set(t.artistName, n + 1);
        next.push(t);
      } else {
        diag.artistDuplicatesRemoved++;
      }
    }
    working = next;
  }

  // ── Gate 4: Refill removed slots ─────────────────────────────────────────
  // Pull the highest-score unused candidate that passes all constraints.
  if (working.length < targetCount) {
    const usedIds = new Set(working.map(t => t.trackId));
    const artistCounts = buildArtistCounts(working);

    while (working.length < targetCount) {
      const candidate = findNextCandidate(
        candidatePool, usedIds, artistCounts, excluded, maxPerArtist,
      );
      if (!candidate) break;
      working.push(candidate);
      usedIds.add(candidate.trackId);
      artistCounts.set(candidate.artistName, (artistCounts.get(candidate.artistName) ?? 0) + 1);
      diag.refillCount++;
    }
  }

  // ── Gate 5: Genre entropy floor ───────────────────────────────────────────
  // If the genre distribution is too concentrated (entropy < 0.75), swap the
  // lowest-score track from each over-represented genre with the best candidate
  // from an under-represented genre in the pool.
  {
    const genreDist = buildDist(working);
    const currentEntropy = normEntropy(genreDist);

    const entropyFloor = intentLocked ? 0.42 : 0.62;
    if (currentEntropy < entropyFloor && working.length >= 6) {
      diag.entropyRefillApplied = true;

      const total = working.length;
      const genreCount = Object.keys(genreDist).length;
      const idealShare = 1 / Math.max(genreCount, 2);

      // Over-represented: more than 2× their fair share
      const overRep = Object.entries(genreDist)
        .filter(([, n]) => n / total > idealShare * (intentLocked ? 3.2 : 2.4))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([g]) => g);

      // Under-represented: present in pool but fewer than 2 in current output
      const poolGenres = new Set(candidatePool.map(t => t.genrePrimary));
      const underRep = new Set(
        [...poolGenres].filter(g => (genreDist[g] ?? 0) < 2 && !excluded.has(g)),
      );

      for (const overGenre of overRep) {
        const overItems = working
          .map((t, idx) => ({ t, idx }))
          .filter(({ t }) => t.genrePrimary === overGenre)
          .sort((a, b) => a.t.laneScore - b.t.laneScore); // weakest first

        if (overItems.length <= 1) continue; // always keep at least one

        const victim = overItems[0]!;
        const usedIds = new Set(working.map(t => t.trackId));
        const artistCounts = buildArtistCounts(working);

        const replacement = candidatePool.find(
          c =>
            !usedIds.has(c.trackId) &&
            !excluded.has(c.genrePrimary) &&
            underRep.has(c.genrePrimary) &&
            (artistCounts.get(c.artistName) ?? 0) < maxPerArtist,
        );

        if (replacement) {
          working.splice(victim.idx, 1, replacement);
        }
      }
    }
  }

  // ── Gate 6: Vibe consistency check ───────────────────────────────────────
  // Find up to 2 tracks that deviate significantly from the target
  // energy/valence centroid and swap them for closer-fitting candidates.
  {
    const OUTLIER_THRESHOLD = intentLocked ? 0.46 : 0.38;
    const IMPROVEMENT_MIN   = intentLocked ? 0.10 : 0.07; // candidate must be meaningfully better

    const ranked = working
      .map((t, idx) => ({ t, idx, dist: vibeDist(t, targetEnergy, targetValence) }))
      .filter(({ dist }) => dist > OUTLIER_THRESHOLD)
      .sort((a, b) => b.dist - a.dist)
      .slice(0, 2);

    if (ranked.length > 0) {
      const usedIds = new Set(working.map(t => t.trackId));
      const artistCounts = buildArtistCounts(working);

      for (const { idx, t, dist } of ranked) {
        const betterFit = candidatePool.find(
          c =>
            !usedIds.has(c.trackId) &&
            !excluded.has(c.genrePrimary) &&
            (artistCounts.get(c.artistName) ?? 0) < maxPerArtist &&
            vibeDist(c, targetEnergy, targetValence) < dist - IMPROVEMENT_MIN,
        );

        if (betterFit) {
          // Release victim's artist slot
          artistCounts.set(t.artistName, Math.max(0, (artistCounts.get(t.artistName) ?? 1) - 1));
          working[idx] = betterFit;
          usedIds.delete(t.trackId);
          usedIds.add(betterFit.trackId);
          artistCounts.set(betterFit.artistName, (artistCounts.get(betterFit.artistName) ?? 0) + 1);
          diag.vibeOutliersSwapped++;
        }
      }
    }
  }

  // Defensive trim — should never exceed targetCount
  if (working.length > targetCount) working = working.slice(0, targetCount);

  diag.finalGenreEntropy = Math.round(normEntropy(buildDist(working)) * 1000) / 1000;

  return {
    trackIds: working.map(t => t.trackId),
    diagnostics: diag,
  };
}
