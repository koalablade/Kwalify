/**
 * UK grime / UK rap scene — within-hip_hop world boundary and retrieval evidence.
 * Generic hip_hop family is too broad (US trap, pop-rap, etc.); this layer enforces UK scene fit.
 */

export type UkHipHopSceneId = "uk_grime" | "uk_rap" | "uk_drill" | "uk_garage_grime";

export type UkHipHopScene = {
  active: boolean;
  id: UkHipHopSceneId;
  allowsElectronic: boolean;
  anchor: string;
};

const UK_SCENE_PATTERNS: Array<{ pattern: RegExp; id: UkHipHopSceneId; allowsElectronic?: boolean }> = [
  { pattern: /\buk\s+grime\b/i, id: "uk_grime" },
  { pattern: /\bgrime\s+(?:classics|anthems|bangers|playlist|mix|set|workout|instrumental|walk|era)\b/i, id: "uk_grime" },
  { pattern: /\b(?:ukg|uk\s+garage)\b.*\b(?:grime|rap|drill)\b/i, id: "uk_garage_grime", allowsElectronic: true },
  { pattern: /\b(?:grime|rap|drill)\b.*\b(?:ukg|uk\s+garage)\b/i, id: "uk_garage_grime", allowsElectronic: true },
  { pattern: /\buk\s+rap\b/i, id: "uk_rap" },
  { pattern: /\b(?:british|london|manchester|birmingham|scouse)\s+rap\b/i, id: "uk_rap" },
  { pattern: /\broad\s+rap\b/i, id: "uk_rap" },
  { pattern: /\buk\s+drill\b/i, id: "uk_drill" },
  { pattern: /\blondon\s+drill\b/i, id: "uk_drill" },
];

const UK_EVIDENCE_TERMS = [
  "grime", "uk hip hop", "uk hip-hop", "british hip hop", "british rap", "uk rap", "uk drill",
  "london drill", "road rap", "uk garage", "2-step", "140 bpm", "eski", "ruff sqwad",
];

const US_DRIFT_TERMS = [
  "southern hip hop", "atlanta", "memphis rap", "chicago drill", "west coast", "east coast rap",
  "gangster rap", "gangsta rap", "crunk", "hyphy", "g-funk", "boom bap", "phonk", "drift phonk",
  "cloud rap", "emo rap", "melodic rap", "country rap", "pop rap", "frat rap",
];

const UK_ARTIST_HINTS = [
  "skepta", "wiley", "stormzy", "dizzee rascal", "jme", "kano", "ghetts", "lethal bizzle",
  "so solid crew", "chip", "aj tracey", "bugzy malone", "giggs", "novelist", "p money",
  "flowdan", "roll deep", "jammer", "footsie", "devilman", "lady leshurr", "dave", "slowthai",
  "little simz",   "headie one", "mo stack", "mist", "aitch", "fred again", "central cee",
  "digga d", "unknown t", "rv", "skeng", "tion wayne", "arrdee", "ms banks",
  "ms dynamite", "shy fx", "dj ez", "mj cole", "artful dodger", "conducta", "conducta",
  "kurupt fm", "korrupt fm", "wretch 32", "tinie tempah", "example", "plan b", "professor green",
  "the streets", "mike skinner", "ms dynamite", "bashy", "wretch 32", "frisco", "shorty",
  "meridian crew", "more fire crew", "ruff sqwad", "newham generals", "boy better know", "bbk",
];

const US_ARTIST_HINTS = [
  "drake", "kanye", "travis scott", "future", "lil wayne", "eminem", "jay-z", "kendrick lamar",
  "21 savage", "playboi carti", "lil uzi vert", "post malone", "migos", "young thug", "gunna",
  "lil baby", "cardi b", "nicki minaj", "ice spice", "doja cat", "asap rocky", "tyler the creator",
  "juice wrld", "xxxtentacion", "lil peep", "nf", "logic", "mac miller", "childish gambino",
  "snoop dogg", "dr dre", "tupac", "notorious b.i.g", "50 cent", "nas", "j cole", "metro boomin",
];

function normalizeText(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function metadataStrings(track: {
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  genres?: string[] | null;
}): string[] {
  const fromArrays = [
    ...(Array.isArray(track.spotifyArtistGenres) ? track.spotifyArtistGenres : []),
    ...(Array.isArray(track.albumGenres) ? track.albumGenres : []),
    ...(Array.isArray(track.genres) ? track.genres : []),
  ].filter((v): v is string => typeof v === "string");
  return fromArrays.map((v) => v.toLowerCase());
}

export function detectUkHipHopScene(prompt: string): UkHipHopScene | null {
  const lower = prompt.toLowerCase();
  if (/\bgrimes\b/i.test(lower)) {
    // Artist Grimes — not UK grime genre.
    const withoutGrimes = lower.replace(/\bgrimes\b/g, "");
    for (const entry of UK_SCENE_PATTERNS) {
      if (entry.pattern.test(withoutGrimes)) {
        return {
          active: true,
          id: entry.id,
          allowsElectronic: entry.allowsElectronic ?? false,
          anchor: entry.id,
        };
      }
    }
    return null;
  }
  for (const entry of UK_SCENE_PATTERNS) {
    if (entry.pattern.test(lower)) {
      return {
        active: true,
        id: entry.id,
        allowsElectronic: entry.allowsElectronic ?? false,
        anchor: entry.id,
      };
    }
  }
  return null;
}

export function isUkHipHopSceneLock(lock: { active: boolean; anchors: string[] } | null | undefined): boolean {
  if (!lock?.active) return false;
  return lock.anchors.some((anchor) =>
    anchor === "uk_grime" || anchor === "uk_rap" || anchor === "uk_drill" || anchor === "uk_garage_grime",
  );
}

export function ukHipHopEvidenceScore(track: {
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  genres?: string[] | null;
}): number {
  const blob = normalizeText([
    track.trackName,
    track.artistName,
    track.albumName,
    ...metadataStrings(track),
  ]);
  let score = 0;
  for (const term of UK_EVIDENCE_TERMS) {
    if (blob.includes(term)) score += 0.22;
  }
  for (const artist of UK_ARTIST_HINTS) {
    if (blob.includes(artist)) score += 0.38;
  }
  return Math.min(1, score);
}

export function usHipHopDriftScore(track: {
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  genres?: string[] | null;
}): number {
  const blob = normalizeText([
    track.trackName,
    track.artistName,
    track.albumName,
    ...metadataStrings(track),
  ]);
  let score = 0;
  for (const term of US_DRIFT_TERMS) {
    if (blob.includes(term)) score += 0.2;
  }
  for (const artist of US_ARTIST_HINTS) {
    if (blob.includes(artist)) score += 0.42;
  }
  return Math.min(1, score);
}

export function passesUkHipHopWorldGate(
  track: {
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
    genres?: string[] | null;
    genreFamily?: string | null;
    genrePrimary?: string | null;
  },
  scene: UkHipHopScene,
  opts?: { hardLock?: boolean },
): boolean {
  const family = (track.genreFamily ?? track.genrePrimary ?? "").toLowerCase();
  if (family && family !== "hip_hop" && family !== "rap" && family !== "unknown") {
    if (scene.allowsElectronic && (family === "electronic" || family === "dance" || family === "house")) {
      return true;
    }
    return false;
  }

  const uk = ukHipHopEvidenceScore(track);
  const us = usHipHopDriftScore(track);

  if (uk >= 0.28) return true;
  if (us >= 0.45 && uk < 0.12) return false;
  if (opts?.hardLock && uk < 0.12 && us >= 0.28) return false;
  if (opts?.hardLock && uk < 0.08 && us < 0.28) return false;
  return !opts?.hardLock;
}

export function ukHipHopRetrievalBoost(
  track: {
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
    genres?: string[] | null;
  },
  scene: UkHipHopScene | null,
): number {
  if (!scene?.active) return 0;
  const uk = ukHipHopEvidenceScore(track);
  const us = usHipHopDriftScore(track);
  return Math.max(-0.35, Math.min(0.42, uk * 0.45 - us * 0.38));
}

export function ukHipHopSceneLockProfile(scene: UkHipHopScene): {
  allowedGenreFamilies: string[];
  offSceneGenreFamilies: string[];
} {
  const allowed = scene.allowsElectronic
    ? ["hip_hop", "electronic"]
    : ["hip_hop"];
  return {
    allowedGenreFamilies: allowed,
    offSceneGenreFamilies: ["pop", "rock", "country", "folk", "metal", "jazz", "classical", "rnb", "soul", "reggae", "latin", ...(scene.allowsElectronic ? [] : ["electronic"])],
  };
}
