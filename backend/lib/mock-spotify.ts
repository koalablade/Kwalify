import type { LikedSong } from "../db/schema/kwalah";
import { toGenreProfile, type RootGenre, type TrackGenreClassification } from "./genre-taxonomy";
import type { ArtistGenreHistory } from "./genre-detection-pipeline";
import type { UserGenreProfile, UserGenreVector } from "./user-genre-profile";

export const MOCK_SPOTIFY_USER_ID = "dev-mock-user";

type MockGenre = Extract<RootGenre, "country" | "indie" | "pop" | "rock">;
export type MockSpotifyTrack = LikedSong & { genrePrimary: MockGenre };

const KEYWORD_RULES: Array<{ genre: MockGenre; subgenre: string; keywords: string[] }> = [
  {
    genre: "country",
    subgenre: "country_pop",
    keywords: ["nashville", "cowboy", "road", "truck", "whiskey", "heart", "highway"],
  },
  {
    genre: "indie",
    subgenre: "indie_general",
    keywords: ["dream", "night", "home", "soft", "echo"],
  },
  {
    genre: "pop",
    subgenre: "dance_pop",
    keywords: ["love", "dance", "baby", "feel", "party"],
  },
  {
    genre: "rock",
    subgenre: "classic_rock",
    keywords: ["fire", "devil", "storm", "blood", "thunder"],
  },
];

const FALLBACK_GENRES: MockGenre[] = ["country", "indie", "pop", "rock"];

const TITLE_PARTS: Record<MockGenre, { keywords: string[]; nouns: string[]; artists: string[]; albums: string[] }> = {
  country: {
    keywords: ["Nashville", "Cowboy", "Road", "Truck", "Whiskey", "Heart", "Highway"],
    nouns: ["Lights", "Summer", "Prayer", "Dust", "Radio", "Moon", "Letters"],
    artists: ["Mason Wilder", "June Hollow", "The County Lines", "Clara West", "Riley Stone"],
    albums: ["Back Porch Stories", "County Line Radio", "Long Roads Home", "Dust on the Dashboard"],
  },
  indie: {
    keywords: ["Dream", "Night", "Home", "Soft", "Echo"],
    nouns: ["Windows", "Garden", "Static", "Apartment", "Weather", "Polaroids", "Rooms"],
    artists: ["Velvet June", "Small Harbor", "The Paper Satellites", "Mila North", "Glass Meadow"],
    albums: ["Bedroom Weather", "Afterimage", "Soft Focus", "Letters from Home"],
  },
  pop: {
    keywords: ["Love", "Dance", "Baby", "Feel", "Party"],
    nouns: ["Tonight", "Signals", "City", "Heartbeat", "Mirror", "Weekend", "Glow"],
    artists: ["Luna Vale", "Neon Coast", "Ari Bloom", "The Bright Hours", "Cassia Rae"],
    albums: ["Midnight Radio", "Glow Season", "Feel It Again", "City Heat"],
  },
  rock: {
    keywords: ["Fire", "Devil", "Storm", "Blood", "Thunder"],
    nouns: ["Engine", "Saints", "Riot", "River", "Static", "Crown", "Wolves"],
    artists: ["Black Harbor", "The Voltage Saints", "Ruby Engine", "Northstar Riot", "Gravel Crown"],
    albums: ["Thunder in the Wires", "Redline Saints", "Storm Shelter", "Electric Bones"],
  },
};

function clampTrackCount(count: number): number {
  return Math.max(100, Math.min(200, Math.floor(count)));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(items: T[], index: number): T {
  return items[index % items.length]!;
}

export function getMockGenreForTrackName(trackName: string): MockGenre {
  const normalized = trackName.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.genre;
    }
  }
  return pick(FALLBACK_GENRES, hashString(normalized));
}

export function classifyMockTrackGenre(trackName: string): TrackGenreClassification {
  const genre = getMockGenreForTrackName(trackName);
  const rule = KEYWORD_RULES.find((r) => r.genre === genre)!;
  const matchedKeyword =
    rule.keywords.find((keyword) => trackName.toLowerCase().includes(keyword)) ?? rule.keywords[0]!;

  return {
    genrePrimary: genre,
    genreFamily: genre,
    genreSecondary: null,
    primarySubgenre: rule.subgenre,
    secondarySubgenre: null,
    subGenres: [rule.subgenre, matchedKeyword],
    microStyle: matchedKeyword,
    confidenceScore: 0.96,
    holidayBound: false,
    diagnostics: {
      taxonomyHit: true,
      artistHintMatched: null,
      patternMatched: matchedKeyword,
      audioFallbackUsed: false,
    },
  };
}

export function generateMockSpotifyLibrary(count = 160, seedValue = "kwalify-dev-mode"): MockSpotifyTrack[] {
  const total = clampTrackCount(count);
  const seedOffsetDays = hashString(seedValue) % 365;
  const baseTime = Date.UTC(2025, 0, 1) - seedOffsetDays * 24 * 60 * 60 * 1000;

  return Array.from({ length: total }, (_, index) => {
    const genre = pick(FALLBACK_GENRES, index);
    const parts = TITLE_PARTS[genre];
    const rule = KEYWORD_RULES.find((candidate) => candidate.genre === genre)!;
    const keyword = pick(parts.keywords, index + Math.floor(index / FALLBACK_GENRES.length));
    const noun = pick(parts.nouns, index * 3 + 1);
    const artistName = pick(parts.artists, index * 5 + 2);
    const albumName = pick(parts.albums, index * 7 + 3);
    const seed = hashString(`${seedValue}:${genre}:${index}:${keyword}`);
    const energyBase = genre === "rock" ? 0.72 : genre === "pop" ? 0.68 : genre === "country" ? 0.56 : 0.48;
    const valenceBase = genre === "pop" ? 0.72 : genre === "country" ? 0.58 : genre === "indie" ? 0.46 : 0.42;
    const danceBase = genre === "pop" ? 0.76 : genre === "country" ? 0.55 : genre === "indie" ? 0.44 : 0.5;
    const variance = ((seed % 17) - 8) / 100;

    return {
      id: index + 1,
      spotifyUserId: MOCK_SPOTIFY_USER_ID,
      trackId: `mock-track-${String(index + 1).padStart(3, "0")}`,
      trackName: `${keyword} ${noun}`,
      artistName,
      albumName,
      genrePrimary: genre,
      albumArt: null,
      durationMs: 165000 + (seed % 95000),
      energy: Math.max(0.08, Math.min(0.98, energyBase + variance)),
      valence: Math.max(0.08, Math.min(0.98, valenceBase - variance / 2)),
      tempo: 82 + (seed % 78),
      danceability: Math.max(0.08, Math.min(0.98, danceBase + variance / 2)),
      acousticness: genre === "country" || genre === "indie" ? 0.52 + (seed % 18) / 100 : 0.18 + (seed % 25) / 100,
      instrumentalness: genre === "indie" ? (seed % 18) / 100 : (seed % 6) / 100,
      loudness: -13 + (seed % 9),
      speechiness: genre === "pop" ? 0.07 : 0.04 + (seed % 7) / 100,
      spotifyArtistGenres: [genre, rule.subgenre],
      albumGenres: [genre],
      popularity: 42 + (seed % 45),
      releaseYear: 1980 + (seed % 44),
      addedAt: new Date(baseTime - index * 36 * 60 * 60 * 1000),
      createdAt: new Date(baseTime - index * 36 * 60 * 60 * 1000),
    };
  });
}

export function buildMockUserGenreProfile(
  tracks: { trackId: string; trackName: string; artistName: string }[]
): UserGenreProfile {
  const trackClassifications = new Map<string, TrackGenreClassification>();
  const genreProfiles = new Map<string, ReturnType<typeof toGenreProfile>>();
  const artistBuckets = new Map<string, { family: MockGenre; subgenre: string; count: number }>();
  const vector: UserGenreVector = {};

  for (const track of tracks) {
    const classification = classifyMockTrackGenre(track.trackName);
    const family = getMockGenreForTrackName(track.trackName);
    trackClassifications.set(track.trackId, classification);
    genreProfiles.set(track.trackId, toGenreProfile(classification));
    vector[family] = (vector[family] ?? 0) + 1;

    const artistKey = track.artistName.toLowerCase().trim();
    const existing = artistBuckets.get(artistKey);
    artistBuckets.set(artistKey, {
      family: existing?.family ?? family,
      subgenre: existing?.subgenre ?? classification.primarySubgenre,
      count: (existing?.count ?? 0) + 1,
    });
  }

  const total = tracks.length || 1;
  for (const genre of Object.keys(vector) as MockGenre[]) {
    vector[genre] = (vector[genre] ?? 0) / total;
  }

  return {
    vector,
    dominant: FALLBACK_GENRES.filter((genre) => (vector[genre] ?? 0) > 0),
    totalClassified: trackClassifications.size,
    trackClassifications,
    genreProfiles,
    artistHistory: new Map<string, ArtistGenreHistory>(
      [...artistBuckets.entries()].map(([artist, bucket]) => [
        artist,
        {
          family: bucket.family,
          subgenre: bucket.subgenre,
          weight: bucket.count / total,
          trackCount: bucket.count,
        },
      ])
    ),
  };
}
