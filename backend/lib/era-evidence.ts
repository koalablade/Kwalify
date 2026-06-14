export type EraRange = { start: number; end: number };

export type EraEvidenceTrack = {
  releaseYear?: number | null;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
};

export type EraEvidenceStatus = "match" | "mismatch" | "unknown";

const MIN_REASONABLE_YEAR = 1950;
const MAX_REASONABLE_YEAR = 2029;

const CLASSIC_ERA_ARTIST_RANGES: Array<{ pattern: RegExp; range: EraRange }> = [
  { pattern: /\b(?:led\s+zeppelin|fleetwood\s+mac|kate\s+bush|ac\/?dc)\b/i, range: { start: 1969, end: 1989 } },
  { pattern: /\b(?:queen|david\s+bowie|abba|the\s+police|billy\s+joel)\b/i, range: { start: 1970, end: 1989 } },
  { pattern: /\b(?:prince|madonna|michael\s+jackson|george\s+michael|a-?ha|inxs|simple\s+minds|billy\s+idol|cyndi\s+lauper)\b/i, range: { start: 1980, end: 1989 } },
  { pattern: /\bmeat\s*loaf\b/i, range: { start: 1977, end: 1995 } },
  { pattern: /\bblondie\b/i, range: { start: 1976, end: 1982 } },
  { pattern: /\bpat\s+benatar\b/i, range: { start: 1979, end: 1988 } },
  { pattern: /\bbon\s+jovi\b/i, range: { start: 1984, end: 1995 } },
  { pattern: /\bbryan\s+adams\b/i, range: { start: 1983, end: 1996 } },
  { pattern: /\b(?:def\s+leppard|journey|foreigner)\b/i, range: { start: 1978, end: 1989 } },
  { pattern: /\b(?:duran\s+duran|tears\s+for\s+fears|eurythmics)\b/i, range: { start: 1981, end: 1989 } },
  { pattern: /\b(?:the\s+cure|depeche\s+mode|new\s+order)\b/i, range: { start: 1980, end: 1993 } },
  { pattern: /\b(?:oasis|blur|pulp|suede|the\s+verve|the\s+stone\s+roses|supergrass|the\s+charlatans|manic\s+street\s+preachers)\b/i, range: { start: 1990, end: 1999 } },
  { pattern: /\b(?:nirvana|pearl\s+jam|soundgarden|alice\s+in\s+chains|smashing\s+pumpkins|hole|nine\s+inch\s+nails)\b/i, range: { start: 1990, end: 1999 } },
  { pattern: /\b(?:radiohead|r\.?e\.?m\.?|beck|pixies|foo\s+fighters|offspring|red\s+hot\s+chili\s+peppers)\b/i, range: { start: 1990, end: 1999 } },
  { pattern: /\b(?:green\s+day|weezer)\b/i, range: { start: 1990, end: 2009 } },
  { pattern: /\b(?:alanis\s+morissette|the\s+cranberries|garbage|no\s+doubt|sheryl\s+crow|tori\s+amos|fiona\s+apple)\b/i, range: { start: 1990, end: 1999 } },
  { pattern: /\b(?:2pac|tupac|notorious\s+b\.?i\.?g\.?|biggie|wu-?tang\s+clan|dr\.?\s*dre|snoop\s+dogg|lauryn\s+hill|fugees|outkast|nas|jay-?z|mobb\s+deep|a\s+tribe\s+called\s+quest|de\s+la\s+soul|gang\s+starr|big\s+l|krs-?one|mos\s+def|talib\s+kweli|common|rakim)\b/i, range: { start: 1990, end: 1999 } },
  { pattern: /\b(?:massive\s+attack|portishead|the\s+chemical\s+brothers|the\s+prodigy|fatboy\s+slim|underworld|daft\s+punk)\b/i, range: { start: 1990, end: 1999 } },
  { pattern: /\b(?:garth\s+brooks|brooks\s*&\s*dunn|alan\s+jackson|shania\s+twain|reba\s+mcentire|tim\s+mcgraw|faith\s+hill|trisha\s+yearwood|dwight\s+yoakam|vince\s+gill|clint\s+black|pam\s+tillis|patty\s+loveless|martina\s+mcbride|joe\s+diffie|toby\s+keith|kenny\s+chesney|george\s+strait|dixie\s+chicks|the\s+chicks)\b/i, range: { start: 1990, end: 1999 } },
  { pattern: /\b(?:blink-?182|sum\s+41|good\s+charlotte|simple\s+plan|new\s+found\s+glory|jimmy\s+eat\s+world|yellowcard|fall\s+out\s+boy|my\s+chemical\s+romance|paramore|panic!?\s+at\s+the\s+disco|avril\s+lavigne|bowling\s+for\s+soup|all\s+time\s+low|the\s+all-?american\s+rejects|taking\s+back\s+sunday|the\s+used|story\s+of\s+the\s+year|mayday\s+parade|boys\s+like\s+girls|we\s+the\s+kings|cartel|motion\s+city\s+soundtrack|the\s+starting\s+line|saves\s+the\s+day|sugarcult|cute\s+is\s+what\s+we\s+aim\s+for|dashboard\s+confessional|senses\s+fail|brand\s+new)\b/i, range: { start: 2000, end: 2009 } },
  { pattern: /\b(?:the\s+1975|lorde|lana\s+del\s+rey|halsey|troye\s+sivan|marina(?:\s+and\s+the\s+diamonds)?|melanie\s+martinez|the\s+neighbourhood|clairo|billie\s+eilish|phoebe\s+bridgers|girl\s+in\s+red|tame\s+impala|m83|beach\s+house|charli\s+xcx|sky\s+ferreira)\b/i, range: { start: 2010, end: 2019 } },
  { pattern: /\b(?:arctic\s+monkeys|the\s+killers|queens?\s+of\s+the\s+stone\s+age|calvin\s+harris|kendrick\s+lamar|xxxtentacion|future|beyonc[eé]|sampha|khalid|dave|burna\s+boy|zach\s+bryan|morgan\s+wallen|luke\s+combs|bailey\s+zimmerman|jordan\s+davis|parker\s+mccollum|riley\s+green|lainey\s+wilson|hardy|jelly\s+roll|tyler\s+childers|sturgill\s+simpson|chris\s+stapleton|the\s+jungle\s+giants|jake\s+bugg|destructo\s+disk)\b/i, range: { start: 2010, end: 2029 } },
];

const ERA_TAG_RANGES: Array<{ pattern: RegExp; range: EraRange }> = [
  { pattern: /\b(?:80'?s|1980'?s|eighties|new\s+wave|synthpop|synth\s+pop|hair\s+metal|mtv|post[-\s]?punk)\b/i, range: { start: 1980, end: 1989 } },
  { pattern: /\b(?:90'?s|1990'?s|nineties|britpop|grunge|madchester|shoegaze|trip[-\s]?hop|new\s+jack\s+swing|g[-\s]?funk|boom\s+bap|alternative\s+rock|alt\s+rock)\b/i, range: { start: 1990, end: 1999 } },
  { pattern: /\b(?:00'?s|2000'?s|noughties|y2k|post[-\s]?punk\s+revival|garage\s+rock\s+revival|indie\s+sleaze)\b/i, range: { start: 2000, end: 2009 } },
  { pattern: /\b(?:2010'?s|10'?s|twenty\s+tens|tumblr|edm|trap|drill|bedroom\s+pop)\b/i, range: { start: 2010, end: 2019 } },
];

const LOCAL_ERA_TEXT_RANGES: Array<{ pattern: RegExp; range: EraRange }> = [
  { pattern: /\b(?:60'?s|1960'?s|sixties)\b/i, range: { start: 1960, end: 1969 } },
  { pattern: /\b(?:70'?s|1970'?s|seventies)\b/i, range: { start: 1970, end: 1979 } },
  { pattern: /\b(?:80'?s|1980'?s|eighties)\b/i, range: { start: 1980, end: 1989 } },
  { pattern: /\b(?:90'?s|1990'?s|nineties)\b/i, range: { start: 1990, end: 1999 } },
  { pattern: /\b(?:00'?s|2000'?s|noughties|aughts|y2k)\b/i, range: { start: 2000, end: 2009 } },
  { pattern: /\b(?:2010'?s|10'?s|twenty\s+tens)\b/i, range: { start: 2010, end: 2019 } },
  { pattern: /\b(?:2020'?s|20'?s|twenty\s+twenties)\b/i, range: { start: 2020, end: 2029 } },
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
  void track;
  // Numeric title/album text is often an album name, edition, or remaster label
  // rather than release-date evidence. Keep numeric era matching tied to Spotify releaseYear.
  return null;
}

function metadataText(track: EraEvidenceTrack): string {
  const arrays = [track.genres];
  return [
    track.genrePrimary,
    track.genreFamily,
    ...arrays.flat().filter((value): value is string => typeof value === "string"),
  ].join(" ");
}

function metadataEraRange(track: EraEvidenceTrack): EraRange | null {
  const text = metadataText(track);
  if (!text.trim()) return null;
  return ERA_TAG_RANGES.find((entry) => entry.pattern.test(text))?.range ?? null;
}

function localEraTextRange(track: EraEvidenceTrack): EraRange | null {
  const text = track.albumName ?? "";
  if (!text.trim()) return null;
  return LOCAL_ERA_TEXT_RANGES.find((entry) => entry.pattern.test(text))?.range ?? null;
}

function artistEraRange(track: EraEvidenceTrack): EraRange | null {
  const artist = track.artistName ?? "";
  if (!artist.trim()) return null;
  return CLASSIC_ERA_ARTIST_RANGES.find((entry) => entry.pattern.test(artist))?.range ?? null;
}

export function eraEvidenceYearForRange(track: EraEvidenceTrack, range: EraRange): number | null {
  const releaseYear = validYear(track.releaseYear);
  if (releaseYear) return rangeContains(range, releaseYear) ? releaseYear : null;

  const anchor = artistEraRange(track);
  if (anchor) return rangesOverlap(anchor, range) ? Math.max(range.start, anchor.start) : null;

  const textYear = localTextYear(track);
  if (textYear) return rangeContains(range, textYear) ? textYear : null;

  const localTextRange = localEraTextRange(track);
  if (localTextRange) return rangesOverlap(localTextRange, range) ? Math.max(range.start, localTextRange.start) : null;

  return null;
}

export function eraEvidenceStatusForRange(track: EraEvidenceTrack, range: EraRange): EraEvidenceStatus {
  const releaseYear = validYear(track.releaseYear);
  if (releaseYear) return rangeContains(range, releaseYear) ? "match" : "mismatch";

  const anchor = artistEraRange(track);
  if (anchor) return rangesOverlap(anchor, range) ? "match" : "mismatch";

  const textYear = localTextYear(track);
  if (textYear) return rangeContains(range, textYear) ? "match" : "mismatch";

  const localTextRange = localEraTextRange(track);
  if (localTextRange) return rangesOverlap(localTextRange, range) ? "match" : "mismatch";

  const tagRange = metadataEraRange(track);
  if (tagRange) return rangesOverlap(tagRange, range) ? "unknown" : "mismatch";

  return "unknown";
}

export function trackHasEraEvidence(track: EraEvidenceTrack, range: EraRange): boolean {
  return eraEvidenceStatusForRange(track, range) === "match";
}

export function trackHasKnownEraMismatch(track: EraEvidenceTrack, range: EraRange): boolean {
  return eraEvidenceStatusForRange(track, range) === "mismatch";
}
