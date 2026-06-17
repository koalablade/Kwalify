/**
 * V3.1+ Global Diversity Controller
 *
 * Tracks a rolling window of selected tracks for diagnostics only.
 *
 * Tracked dimensions:
 *   genreWindow    — genre of last 30 tracks
 *   eraWindow      — era bucket of last 30 tracks
 *   artistWindow   — artist name (for repeat detection in last 12)
 *   energyWindow   — energy value (for curve slope calculation)
 *   laneWindow     — source lane (for lane saturation detection)
 *
 */

// ── Genre family map ─────────────────────────────────────────────────────────
// Groups subgenres into coarse families so family-level concentration can be
// capped independently of per-cluster caps. Without this, "country",
// "americana", "outlaw_country" and "country_rock" each pass the 35% per-cluster
// cap but together can dominate 80%+ of the playlist.

export const GENRE_FAMILY_MAP: Record<string, string> = {
  country:          "country",
  americana:        "country",
  outlaw_country:   "country",
  country_rock:     "country",
  bluegrass:        "country",
  alt_country:      "country",
  folk_country:     "country",
  western:          "country",
  honky_tonk:       "country",
  rock:             "rock",
  classic_rock:     "rock",
  hard_rock:        "rock",
  indie_rock:       "rock",
  alternative:      "rock",
  punk:             "rock",
  pop_punk:         "rock",
  skate_punk:       "rock",
  emo:              "rock",
  emo_pop:          "rock",
  emo_rock:         "rock",
  post_hardcore:    "rock",
  melodic_hardcore: "rock",
  hardcore:         "rock",
  screamo:          "rock",
  shoegaze:         "rock",
  britpop:          "rock",
  new_wave:         "rock",
  garage_rock:      "rock",
  pop_rock:         "rock",
  grunge:           "rock",
  prog_rock:        "rock",
  hip_hop:          "hip_hop",
  rap:              "hip_hop",
  trap:             "hip_hop",
  drill:            "hip_hop",
  boom_bap:         "hip_hop",
  rnb:              "rnb",
  r_and_b:          "rnb",
  neo_soul:         "rnb",
  soul:             "rnb",
  electronic:       "electronic",
  edm:              "electronic",
  house:            "electronic",
  techno:           "electronic",
  trance:           "electronic",
  ambient:          "electronic",
  folk:             "folk",
  indie_folk:       "folk",
  singer_songwriter:"folk",
  acoustic:         "folk",
  jazz:             "jazz",
  bebop:            "jazz",
  swing:            "jazz",
  bossa_nova:       "jazz",
  blues:            "blues",
  delta_blues:      "blues",
  pop:              "pop",
  indie_pop:        "pop",
  synth_pop:        "pop",
  k_pop:            "pop",
  metal:            "metal",
  heavy_metal:      "metal",
  death_metal:      "metal",
  black_metal:      "metal",
  thrash_metal:     "metal",
  latin:            "latin",
  salsa:            "latin",
  reggaeton:        "latin",
  cumbia:           "latin",
};

export function getGenreFamily(genre: string): string {
  return GENRE_FAMILY_MAP[genre] ?? genre;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface DiversityWindow {
  genreWindow:  string[];
  eraWindow:    string[];
  artistWindow: string[];
  energyWindow: number[];
  laneWindow:   string[];
}

export interface DiversityMetrics {
  genreConcentration:   number;
  eraConcentration:     number;
  artistRepeatIndex:    number;
  energyCurveSlope:     number;
  laneSaturation:       number;
  dominantGenre:        string | null;
  dominantEra:          string | null;
  dominantLane:         string | null;
  clusterCollapseIndex: number;
  explorationPressure:  number;
  driftState:           "stable" | "genre_drift" | "era_drift" | "lane_drift" | "artist_collapse" | "multi_drift";
}

const WINDOW_SIZE        = 30;
const ARTIST_WINDOW_SIZE = 12;

// ── State creation ───────────────────────────────────────────────────────────

export function createDiversityWindow(): DiversityWindow {
  return {
    genreWindow:  [],
    eraWindow:    [],
    artistWindow: [],
    energyWindow: [],
    laneWindow:   [],
  };
}

// ── Window update ────────────────────────────────────────────────────────────

export function updateDiversityWindow(
  window: DiversityWindow,
  track: {
    genre:  string;
    era:    string;
    artist: string;
    energy: number;
    lane:   string;
  },
): DiversityWindow {
  const push = <T>(arr: T[], val: T, max: number): T[] =>
    [...arr, val].slice(-max);

  return {
    genreWindow:  push(window.genreWindow,  track.genre,  WINDOW_SIZE),
    eraWindow:    push(window.eraWindow,    track.era,    WINDOW_SIZE),
    artistWindow: push(window.artistWindow, track.artist, ARTIST_WINDOW_SIZE),
    energyWindow: push(window.energyWindow, track.energy, WINDOW_SIZE),
    laneWindow:   push(window.laneWindow,   track.lane,   WINDOW_SIZE),
  };
}

// ── Metrics computation ──────────────────────────────────────────────────────

function dominantEntry(arr: string[]): { value: string | null; ratio: number } {
  if (arr.length === 0) return { value: null, ratio: 0 };
  const counts: Record<string, number> = {};
  for (const v of arr) counts[v] = (counts[v] ?? 0) + 1;
  const [value, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  return { value, ratio: count / arr.length };
}

function energyCurveSlope(energyWindow: number[]): number {
  if (energyWindow.length < 3) return 0;
  const n = energyWindow.length;
  const last = energyWindow.slice(-Math.min(8, n));
  const first = last.slice(0, Math.floor(last.length / 2));
  const second = last.slice(Math.floor(last.length / 2));
  const avgFirst  = first.reduce((s, v) => s + v, 0)  / first.length;
  const avgSecond = second.reduce((s, v) => s + v, 0) / second.length;
  return avgSecond - avgFirst;
}

function artistRepeatIndex(artistWindow: string[]): number {
  if (artistWindow.length === 0) return 0;
  const counts: Record<string, number> = {};
  for (const a of artistWindow) counts[a] = (counts[a] ?? 0) + 1;
  const repeats = Object.values(counts).filter((c) => c >= 2).length;
  return repeats / Math.max(1, Object.keys(counts).length);
}

function clusterCollapseIndex(
  genreRatio: number,
  eraRatio: number,
  laneRatio: number,
): number {
  return Math.max(genreRatio * 0.40 + eraRatio * 0.35 + laneRatio * 0.25, 0);
}

function explorationPressure(metrics: {
  genreConcentration: number;
  eraConcentration: number;
  artistRepeatIndex: number;
  clusterCollapseIndex: number;
}): number {
  return Math.min(1,
    metrics.genreConcentration * 0.35 +
    metrics.eraConcentration   * 0.25 +
    metrics.artistRepeatIndex  * 0.20 +
    metrics.clusterCollapseIndex * 0.20,
  );
}

export function computeDiversityMetrics(window: DiversityWindow): DiversityMetrics {
  const genreInfo  = dominantEntry(window.genreWindow);
  const eraInfo    = dominantEntry(window.eraWindow);
  const laneInfo   = dominantEntry(window.laneWindow);
  const slope      = energyCurveSlope(window.energyWindow);
  const artistIdx  = artistRepeatIndex(window.artistWindow);

  const collapseIdx = clusterCollapseIndex(
    genreInfo.ratio,
    eraInfo.ratio,
    laneInfo.ratio,
  );

  const explorationP = explorationPressure({
    genreConcentration: genreInfo.ratio,
    eraConcentration: eraInfo.ratio,
    artistRepeatIndex: artistIdx,
    clusterCollapseIndex: collapseIdx,
  });

  const driftFlags = [
    genreInfo.ratio > 0.55 ? "genre_drift"       : null,
    eraInfo.ratio   > 0.55 ? "era_drift"          : null,
    laneInfo.ratio  > 0.80 ? "lane_drift"         : null,
    artistIdx       > 0.30 ? "artist_collapse"    : null,
  ].filter(Boolean) as string[];

  let driftState: DiversityMetrics["driftState"] = "stable";
  if (driftFlags.length >= 2)         driftState = "multi_drift";
  else if (driftFlags[0])             driftState = driftFlags[0] as DiversityMetrics["driftState"];

  return {
    genreConcentration:   Math.round(genreInfo.ratio  * 1000) / 1000,
    eraConcentration:     Math.round(eraInfo.ratio    * 1000) / 1000,
    artistRepeatIndex:    Math.round(artistIdx        * 1000) / 1000,
    energyCurveSlope:     Math.round(slope            * 1000) / 1000,
    laneSaturation:       Math.round(laneInfo.ratio   * 1000) / 1000,
    dominantGenre:        genreInfo.value,
    dominantEra:          eraInfo.value,
    dominantLane:         laneInfo.value,
    clusterCollapseIndex: Math.round(collapseIdx      * 1000) / 1000,
    explorationPressure:  Math.round(explorationP     * 1000) / 1000,
    driftState,
  };
}
