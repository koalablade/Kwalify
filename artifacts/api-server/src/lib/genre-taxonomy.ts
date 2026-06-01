/**
 * Hard genre taxonomy — backbone for scoring (not scene labels).
 */

export type RootGenre =
  | "country"
  | "hip_hop"
  | "rock"
  | "electronic"
  | "jazz"
  | "pop"
  | "folk"
  | "soul"
  | "metal"
  | "classical"
  | "christmas"
  | "indie"
  | "unknown";

export interface GenreTaxon {
  root: RootGenre;
  subgenre: string;
  microStyles: string[];
  patterns: RegExp[];
  artistHints?: RegExp;
}

export interface TrackGenreClassification {
  genrePrimary: RootGenre;
  genreSecondary: RootGenre | null;
  subGenres: string[];
  microStyle: string | null;
  confidenceScore: number;
  /** Holiday-bound tags cannot drift via emotion/scene */
  holidayBound: boolean;
}

const TAXONOMY: GenreTaxon[] = [
  {
    root: "christmas",
    subgenre: "holiday",
    microStyles: ["christmas pop", "christmas classic"],
    patterns: [
      /\b(christmas|xmas|noel|santa|jingle bells|winter wonderland|silent night|holiday song|festive|yuletide|all i want for christmas|last christmas|wonderful christmastime|fairytale of new york)\b/i,
    ],
  },
  {
    root: "country",
    subgenre: "country",
    microStyles: ["modern country", "nashville pop", "outlaw country", "red dirt", "honky tonk"],
    patterns: [
      /\b(country|honky tonk|red dirt|nashville|americana|bluegrass|outlaw country|country pop|southern rock|western swing)\b/i,
    ],
    artistHints:
      /\b(johnny cash|willie nelson|chris stapleton|luke combs|morgan wallen|zac brown|dolly parton|george strait|kacey musgraves|tyler childers|sturgill simpson|old crow medicine)\b/i,
  },
  {
    root: "folk",
    subgenre: "folk",
    microStyles: ["indie folk", "singer-songwriter", "acoustic folk"],
    patterns: [/\b(folk|singer-songwriter|acoustic session|americana folk)\b/i],
    artistHints: /\b(mumford sons|avett brothers|brandi carlile|joan baez)\b/i,
  },
  {
    root: "hip_hop",
    subgenre: "hip_hop",
    microStyles: ["boom bap", "trap", "drill", "conscious rap"],
    patterns: [/\b(hip hop|hip-hop|rap|trap|drill|boom bap|grime|uk rap)\b/i],
  },
  {
    root: "rock",
    subgenre: "rock",
    microStyles: ["classic rock", "alt rock", "indie rock", "punk"],
    patterns: [/\b(rock|classic rock|alt rock|indie rock|punk|grunge|shoegaze)\b/i],
  },
  {
    root: "electronic",
    subgenre: "electronic",
    microStyles: ["house", "techno", "ambient", "synthwave"],
    patterns: [/\b(electronic|edm|house|techno|trance|dubstep|synthwave|drum and bass|dnb)\b/i],
  },
  {
    root: "jazz",
    subgenre: "jazz",
    microStyles: ["bebop", "smooth jazz", "vocal jazz"],
    patterns: [/\b(jazz|bebop|swing|bossa nova|smooth jazz)\b/i],
  },
  {
    root: "soul",
    subgenre: "soul",
    microStyles: ["motown", "neo soul", "r&b"],
    patterns: [/\b(soul|motown|r&b|rnb|neo soul|funk soul)\b/i],
  },
  {
    root: "metal",
    subgenre: "metal",
    microStyles: ["heavy metal", "metalcore"],
    patterns: [/\b(metal|metalcore|death metal|black metal|thrash)\b/i],
  },
  {
    root: "pop",
    subgenre: "pop",
    microStyles: ["dance pop", "synth pop", "indie pop"],
    patterns: [/\b(pop|dance pop|synth pop|top 40|chart)\b/i],
  },
  {
    root: "indie",
    subgenre: "indie",
    microStyles: ["indie pop", "indie rock"],
    patterns: [/\b(indie|bedroom pop|lo-fi indie)\b/i],
  },
  {
    root: "classical",
    subgenre: "classical",
    microStyles: ["orchestral", "piano classical"],
    patterns: [/\b(classical|orchestral|symphony|concerto|opus)\b/i],
  },
];

export const GENRE_LOCK_THRESHOLD = 0.72;

export function classifyTrack(
  track: {
    trackName: string;
    artistName: string;
    albumName: string;
    energy?: number | null;
    valence?: number | null;
    acousticness?: number | null;
    danceability?: number | null;
    instrumentalness?: number | null;
    speechiness?: number | null;
  },
  vibeGenreHints?: string[]
): TrackGenreClassification {
  const blob = `${track.trackName} ${track.artistName} ${track.albumName}`;
  const hits: { taxon: GenreTaxon; score: number; micro: string | null }[] = [];

  for (const taxon of TAXONOMY) {
    let score = 0;
    let micro: string | null = null;
    for (const p of taxon.patterns) {
      if (p.test(blob)) score += 0.45;
    }
    for (const m of taxon.microStyles) {
      if (blob.toLowerCase().includes(m)) {
        score += 0.35;
        micro = m;
      }
    }
    if (taxon.artistHints?.test(blob)) score += 0.5;
    if (score > 0) hits.push({ taxon, score, micro });
  }

  for (const hint of vibeGenreHints ?? []) {
    const t = TAXONOMY.find((x) => x.root === hint || x.subgenre === hint);
    if (t) hits.push({ taxon: t, score: 0.4, micro: null });
  }

  applyAudioGenreHeuristics(track, hits);

  hits.sort((a, b) => b.score - a.score);
  const top = hits[0];
  const second = hits[1];

  if (!top) {
    return {
      genrePrimary: "unknown",
      genreSecondary: null,
      subGenres: [],
      microStyle: null,
      confidenceScore: 0.25,
      holidayBound: false,
    };
  }

  const confidence = Math.min(1, top.score / 1.1);
  const subGenres = [top.taxon.subgenre, ...(top.micro ? [top.micro] : [])];
  if (second && second.score > 0.35) subGenres.push(second.taxon.subgenre);

  return {
    genrePrimary: top.taxon.root,
    genreSecondary: second && second.score > 0.35 ? second.taxon.root : null,
    subGenres: [...new Set(subGenres)],
    microStyle: top.micro,
    confidenceScore: confidence,
    holidayBound: top.taxon.root === "christmas",
  };
}

function applyAudioGenreHeuristics(
  track: {
    energy?: number | null;
    valence?: number | null;
    acousticness?: number | null;
    danceability?: number | null;
    speechiness?: number | null;
  },
  hits: { taxon: GenreTaxon; score: number; micro: string | null }[]
): void {
  const a = track.acousticness ?? 0.5;
  const e = track.energy ?? 0.5;
  const d = track.danceability ?? 0.5;
  const sp = track.speechiness ?? 0.2;

  if (a > 0.58 && e < 0.55 && d < 0.6) {
    pushHit(hits, "country", 0.32, "acoustic country lean");
    pushHit(hits, "folk", 0.28, "acoustic folk lean");
  }
  if (sp > 0.38 && e > 0.45) {
    pushHit(hits, "hip_hop", 0.35, "vocal rhythm lean");
  }
  if (d > 0.72 && e > 0.65) {
    pushHit(hits, "electronic", 0.3, "dance lean");
    pushHit(hits, "pop", 0.22, null);
  }
  if (e < 0.3 && a > 0.45) {
    pushHit(hits, "jazz", 0.2, null);
  }
}

function pushHit(
  hits: { taxon: GenreTaxon; score: number; micro: string | null }[],
  root: RootGenre,
  score: number,
  micro: string | null
): void {
  const taxon = TAXONOMY.find((t) => t.root === root);
  if (!taxon) return;
  const existing = hits.find((h) => h.taxon.root === root);
  if (existing) existing.score += score;
  else hits.push({ taxon, score, micro });
}

export function isGenreLocked(classification: TrackGenreClassification): boolean {
  return classification.confidenceScore >= GENRE_LOCK_THRESHOLD;
}

/** Scene may not override locked genre below this fraction of genre score */
export function genreLockWeight(classification: TrackGenreClassification): number {
  if (!isGenreLocked(classification)) return 0;
  return 0.6;
}
