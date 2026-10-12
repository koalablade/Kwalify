export type PlaylistRepairTrack = {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
};

export type PlaylistRepairReport = {
  repaired: boolean;
  expectedCount: number;
  beforeCount: number;
  afterCount: number;
  addedCount: number;
  duplicateSkipped: number;
  moodRejected: number;
  candidatePoolSize: number;
  failureReasons: string[];
  completionDiagnostics: {
    missingBeforeRepair: number;
    missingAfterRepair: number;
    candidatePoolInsufficient: boolean;
    retrievalUnderfilled: boolean;
    scoringFilteredTooAggressively: boolean;
    whyTracksWereMissing: string[];
  };
};

export type PlaylistRepairOptions<T extends PlaylistRepairTrack> = {
  currentTracks: T[];
  candidatePools: T[][];
  expectedCount: number;
};

function average(values: number[], fallback: number): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function numeric(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function moodCompatible<T extends PlaylistRepairTrack>(candidate: T, anchors: T[]): boolean {
  if (anchors.length === 0) return true;
  const anchorEnergy = average(anchors.map((track) => numeric(track.energy, 0.5)), 0.5);
  const anchorValence = average(anchors.map((track) => numeric(track.valence, 0.5)), 0.5);
  const energy = numeric(candidate.energy, anchorEnergy);
  const valence = numeric(candidate.valence, anchorValence);
  return Math.abs(energy - anchorEnergy) <= 0.62 && Math.abs(valence - anchorValence) <= 0.62;
}

function orderedUniqueCandidates<T extends PlaylistRepairTrack>(candidatePools: T[][], used: Set<string>): T[] {
  const seen = new Set<string>(used);
  const out: T[] = [];
  for (const pool of candidatePools) {
    for (const candidate of pool) {
      if (!candidate.trackId || seen.has(candidate.trackId)) continue;
      seen.add(candidate.trackId);
      out.push(candidate);
    }
  }
  return out;
}

export function repairIncompletePlaylist<T extends PlaylistRepairTrack>(
  opts: PlaylistRepairOptions<T>
): { tracks: T[]; report: PlaylistRepairReport } {
  const beforeCount = opts.currentTracks.length;
  const expectedCount = Math.max(0, opts.expectedCount);
  const missingBeforeRepair = Math.max(0, expectedCount - beforeCount);
  if (missingBeforeRepair === 0) {
    return {
      tracks: opts.currentTracks,
      report: {
        repaired: false,
        expectedCount,
        beforeCount,
        afterCount: beforeCount,
        addedCount: 0,
        duplicateSkipped: 0,
        moodRejected: 0,
        candidatePoolSize: 0,
        failureReasons: [],
        completionDiagnostics: {
          missingBeforeRepair: 0,
          missingAfterRepair: 0,
          candidatePoolInsufficient: false,
          retrievalUnderfilled: false,
          scoringFilteredTooAggressively: false,
          whyTracksWereMissing: [],
        },
      },
    };
  }

  const repaired = [...opts.currentTracks];
  const used = new Set(repaired.map((track) => track.trackId).filter(Boolean));
  const candidatePoolSize = opts.candidatePools.reduce((sum, pool) => sum + pool.length, 0);
  const duplicateSkipped = Math.max(0, candidatePoolSize - orderedUniqueCandidates(opts.candidatePools, new Set()).length);
  const candidates = orderedUniqueCandidates(opts.candidatePools, used);
  let moodRejected = 0;

  for (const candidate of candidates) {
    if (repaired.length >= expectedCount) break;
    if (!moodCompatible(candidate, repaired)) {
      moodRejected++;
      continue;
    }
    used.add(candidate.trackId);
    repaired.push(candidate);
  }

  if (repaired.length < expectedCount) {
    for (const candidate of candidates) {
      if (repaired.length >= expectedCount) break;
      if (used.has(candidate.trackId)) continue;
      used.add(candidate.trackId);
      repaired.push(candidate);
    }
  }

  const afterCount = repaired.length;
  const missingAfterRepair = Math.max(0, expectedCount - afterCount);
  const candidatePoolInsufficient = candidates.length < missingBeforeRepair;
  const retrievalUnderfilled = candidatePoolSize === 0 || candidatePoolInsufficient;
  const scoringFilteredTooAggressively = candidatePoolSize > 0 && beforeCount < Math.ceil(expectedCount * 0.7);
  const whyTracksWereMissing = [
    beforeCount < expectedCount ? "final playlist had fewer tracks than requested" : null,
    candidatePoolInsufficient ? "existing candidate pools did not contain enough unused tracks" : null,
    moodRejected > 0 ? "light mood compatibility filter rejected some repair candidates" : null,
    scoringFilteredTooAggressively ? "final selection was much smaller than available candidate output" : null,
  ].filter((value): value is string => !!value);

  return {
    tracks: repaired,
    report: {
      repaired: afterCount > beforeCount,
      expectedCount,
      beforeCount,
      afterCount,
      addedCount: afterCount - beforeCount,
      duplicateSkipped,
      moodRejected,
      candidatePoolSize,
      failureReasons: missingAfterRepair > 0 ? ["INCOMPLETE_PLAYLIST_FAILURE"] : [],
      completionDiagnostics: {
        missingBeforeRepair,
        missingAfterRepair,
        candidatePoolInsufficient,
        retrievalUnderfilled,
        scoringFilteredTooAggressively,
        whyTracksWereMissing,
      },
    },
  };
}
