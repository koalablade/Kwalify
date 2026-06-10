/**
 * Full genre taxonomy — family → subgenre → micro-styles (Spotify-scale depth).
 */

import type { RootGenre } from "./genre-taxonomy";

export interface SubgenreDef {
  id: string;
  microStyles: string[];
  /** Regex source strings (case-insensitive) */
  patterns: string[];
  artistHints?: string[];
}

export interface GenreFamilyDef {
  family: RootGenre;
  subgenres: SubgenreDef[];
}

export const GENRE_FAMILIES: GenreFamilyDef[] = [
  {
    family: "country",
    subgenres: [
      { id: "modern_country", microStyles: ["bro-country", "stadium country"], patterns: ["modern country", "country radio"], artistHints: ["luke combs", "morgan wallen", "chris stapleton", "zach bryan", "bailey zimmerman", "jordan davis", "parker mccollum", "riley green", "lainey wilson", "hardy", "jelly roll"] },
      { id: "alt_country", microStyles: ["americana", "outlaw country"], patterns: ["alt country", "alt-country", "outlaw", "americana"], artistHints: ["sturgill simpson", "tyler childers", "jason isbell", "brandi carlile", "avett brothers", "colter wall", "charley crockett", "turnpike troubadours", "whiskey myers", "flatland cavalry", "cody johnson", "cody jinks", "randall king", "kaitlin butts", "muscadine bloodline"] },
      { id: "country_pop", microStyles: ["nashville pop"], patterns: ["country pop", "nashville"], artistHints: ["shania twain", "carrie underwood", "kacey musgraves", "taylor swift", "thomas rhett", "dan \\+ shay", "kelsea ballerini", "maren morris"] },
      { id: "bluegrass", microStyles: ["newgrass"], patterns: ["bluegrass", "banjo pick"], artistHints: ["alison krauss", "billy strings", "molly tuttle", "trampled by turtles"] },
      { id: "folk_country", microStyles: ["folk country", "southern folk"], patterns: ["folk country", "country folk", "honky tonk", "red dirt", "western swing"], artistHints: ["sierra ferrell", "ian munsick", "49 winchester", "treaty oak revival", "red clay strays", "sam barber"] },
      { id: "classic_country", microStyles: ["traditional country"], patterns: ["classic country", "country legend"], artistHints: ["johnny cash", "willie nelson", "dolly parton", "george strait", "merle haggard", "waylon jennings", "hank williams", "patsy cline", "alan jackson", "garth brooks", "brooks & dunn", "reba mcentire", "toby keith", "tim mcgraw", "kenny chesney"] },
    ],
  },
  {
    family: "hip_hop",
    subgenres: [
      { id: "boom_bap", microStyles: ["east coast hip hop", "90s rap"], patterns: ["boom bap", "boom-bap", "golden age hip hop"] },
      { id: "trap", microStyles: ["atlanta trap", "melodic trap"], patterns: ["trap music", "trap beat", "\\btrap\\b"], artistHints: ["future", "young thug", "migos"] },
      { id: "drill", microStyles: ["uk drill", "chicago drill", "ny drill"], patterns: ["\\bdrill\\b", "uk drill", "chicago drill"] },
      { id: "conscious_rap", microStyles: ["political rap", "storytelling rap"], patterns: ["conscious rap", "conscious hip hop", "lyrical rap"] },
      { id: "melodic_rap", microStyles: ["emo rap", "sad rap"], patterns: ["melodic rap", "emo rap", "sing rap"], artistHints: ["xxxtentacion"] },
      { id: "old_school", microStyles: ["old school hip hop", "80s rap"], patterns: ["old school hip hop", "old school rap", "g-funk"], artistHints: ["tupac", "notorious b.i.g", "nas", "jay-z"] },
      { id: "west_coast", microStyles: ["g-funk", "hyphy"], patterns: ["west coast rap", "g-funk", "hyphy"], artistHints: ["dr dre", "snoop dogg", "kendrick lamar"] },
    ],
  },
  {
    family: "rock",
    subgenres: [
      { id: "indie_rock", microStyles: ["garage rock", "lo-fi rock"], patterns: ["indie rock", "indie-rock"] },
      { id: "alt_rock", microStyles: ["alternative rock", "90s alt"], patterns: ["alt rock", "alternative rock", "grunge", "shoegaze"] },
      { id: "classic_rock", microStyles: ["arena rock", "70s rock"], patterns: ["classic rock", "rock legend", "hard rock classic"], artistHints: ["led zeppelin", "queen", "ac/dc", "fleetwood mac", "the doors"] },
      { id: "punk", microStyles: ["pop punk", "post-punk"], patterns: ["punk rock", "\\bpunk\\b", "pop punk", "post-punk"], artistHints: ["blondie"] },
      { id: "post_rock", microStyles: ["instrumental rock"], patterns: ["post-rock", "post rock", "crescendo rock"] },
      { id: "emo", microStyles: ["emo pop", "screamo"], patterns: ["\\bemo\\b", "emo pop", "midwest emo"] },
    ],
  },
  {
    family: "metal",
    subgenres: [
      { id: "heavy_metal", microStyles: ["traditional metal"], patterns: ["heavy metal", "classic metal"] },
      { id: "metalcore", microStyles: ["melodic metalcore"], patterns: ["metalcore", "deathcore"] },
      { id: "death_metal", microStyles: ["technical death"], patterns: ["death metal", "brutal death"] },
      { id: "black_metal", microStyles: ["atmospheric black"], patterns: ["black metal", "symphonic black"] },
      { id: "thrash", microStyles: ["speed metal"], patterns: ["thrash metal", "thrash"] },
      { id: "nu_metal", microStyles: ["rap metal"], patterns: ["nu metal", "nu-metal"] },
    ],
  },
  {
    family: "electronic",
    subgenres: [
      { id: "house", microStyles: ["deep house", "future house", "progressive house", "tech house"], patterns: ["deep house", "future house", "progressive house", "\\bhouse music\\b", "tech house"] },
      { id: "techno", microStyles: ["minimal techno", "detroit techno"], patterns: ["\\btechno\\b", "minimal techno", "detroit techno"] },
      { id: "trance", microStyles: ["uplifting trance", "psytrance"], patterns: ["\\btrance\\b", "psytrance", "uplifting trance"] },
      { id: "dnb", microStyles: ["liquid dnb", "jungle"], patterns: ["drum and bass", "drum & bass", "\\bdnb\\b", "jungle"] },
      { id: "ambient", microStyles: ["dark ambient", "ambient electronic"], patterns: ["\\bambient\\b", "dark ambient", "soundscape"] },
      { id: "dubstep", microStyles: ["brostep", "riddim"], patterns: ["dubstep", "riddim", "brostep"] },
      { id: "synthwave", microStyles: ["retrowave", "outrun"], patterns: ["synthwave", "retrowave", "outrun"] },
    ],
  },
  {
    family: "jazz",
    subgenres: [
      { id: "bebop", microStyles: ["hard bop"], patterns: ["bebop", "hard bop", "bop jazz"] },
      { id: "smooth_jazz", microStyles: ["contemporary jazz"], patterns: ["smooth jazz", "jazz fusion light"] },
      { id: "vocal_jazz", microStyles: ["jazz standards"], patterns: ["vocal jazz", "jazz standard", "crooner"] },
      { id: "latin_jazz", microStyles: ["bossa nova", "samba jazz"], patterns: ["bossa nova", "latin jazz", "samba jazz"] },
    ],
  },
  {
    family: "blues",
    subgenres: [
      { id: "delta_blues", microStyles: ["acoustic blues"], patterns: ["delta blues", "acoustic blues"] },
      { id: "chicago_blues", microStyles: ["electric blues"], patterns: ["chicago blues", "electric blues", "\\bblues\\b"], artistHints: ["b.b. king", "muddy waters", "stevie ray vaughan"] },
      { id: "blues_rock", microStyles: ["blues rock"], patterns: ["blues rock", "blues-rock"] },
    ],
  },
  {
    family: "soul",
    subgenres: [
      { id: "motown", microStyles: ["detroit soul"], patterns: ["motown", "detroit soul"], artistHints: ["stevie wonder", "marvin gaye", "supremes", "temptations"] },
      { id: "neo_soul", microStyles: ["alternative rnb"], patterns: ["neo soul", "neo-soul"] },
      { id: "funk", microStyles: ["p funk", "funk soul"], patterns: ["\\bfunk\\b", "p-funk", "funk soul"] },
    ],
  },
  {
    family: "rnb",
    subgenres: [
      { id: "contemporary_rnb", microStyles: ["alt rnb", "pop rnb"], patterns: ["\\br&b\\b", "\\brnb\\b", "contemporary r&b", "alternative r&b"] },
      { id: "classic_rnb", microStyles: ["90s rnb"], patterns: ["90s r&b", "classic r&b", "new jack swing"] },
    ],
  },
  {
    family: "pop",
    subgenres: [
      { id: "dance_pop", microStyles: ["electropop"], patterns: ["dance pop", "dance-pop", "electropop"] },
      { id: "synth_pop", microStyles: ["80s pop"], patterns: ["synth pop", "synth-pop", "new wave pop"] },
      { id: "indie_pop", microStyles: ["bedroom pop"], patterns: ["indie pop", "bedroom pop"] },
      { id: "teen_pop", microStyles: ["boy band", "girl group"], patterns: ["boy band", "girl group", "teen pop"] },
    ],
  },
  {
    family: "folk",
    subgenres: [
      { id: "indie_folk", microStyles: ["chamber folk"], patterns: ["indie folk", "folk indie"], artistHints: ["fleet foxes", "sufjan stevens", "avett brothers"] },
      { id: "singer_songwriter", microStyles: ["acoustic folk"], patterns: ["singer-songwriter", "singer songwriter", "acoustic folk"], artistHints: ["gregory alan isakov", "iron.*wine"] },
      { id: "traditional_folk", microStyles: ["celtic folk"], patterns: ["traditional folk", "celtic folk", "irish folk"] },
    ],
  },
  {
    family: "indie",
    subgenres: [
      { id: "indie_general", microStyles: ["indie", "alternative indie"], patterns: ["\\bindie\\b", "indie music"], artistHints: ["arctic monkeys", "the 1975", "bon iver", "phoebe bridgers", "the national", "beach house", "tame impala", "\\bmgmt\\b", "\\blorde\\b", "foster the people", "wallows", "\\bm83\\b", "the killers", "florence.*machine"] },
      { id: "lofi_indie", microStyles: ["lo-fi beats", "chillhop"], patterns: ["lo-fi", "lofi", "chillhop", "study beats"] },
    ],
  },
  {
    family: "classical",
    subgenres: [
      { id: "orchestral", microStyles: ["film score classical", "symphony"], patterns: ["orchestral", "symphony", "concerto", "opus", "\\bclassical\\b"] },
      { id: "piano_classical", microStyles: ["solo piano"], patterns: ["piano classical", "nocturne", "sonata"] },
    ],
  },
  {
    family: "soundtrack",
    subgenres: [
      { id: "film_score", microStyles: ["cinematic", "trailer music"], patterns: ["film score", "soundtrack", "original motion picture", "cinematic orchestral", "game soundtrack"] },
      { id: "tv_score", microStyles: ["series ost"], patterns: ["tv soundtrack", "series ost", "theme from"] },
    ],
  },
  {
    family: "reggae",
    subgenres: [
      { id: "roots_reggae", microStyles: ["dub", "rocksteady"], patterns: ["\\breggae\\b", "roots reggae", "rocksteady", "\\bdub\\b"], artistHints: ["bob marley", "peter tosh", "lee scratch"] },
      { id: "dancehall", microStyles: ["ragga"], patterns: ["dancehall", "ragga"] },
    ],
  },
  {
    family: "latin",
    subgenres: [
      { id: "reggaeton", microStyles: ["latin trap", "dembow"], patterns: ["reggaeton", "dembow", "latin trap"], artistHints: ["bad bunny", "j balvin", "karol g"] },
      { id: "salsa", microStyles: ["bachata", "merengue"], patterns: ["salsa", "bachata", "merengue", "cumbia"] },
      { id: "latin_pop", microStyles: ["latin urban"], patterns: ["latin pop", "spanish pop", "latin urban"] },
    ],
  },
  {
    family: "world",
    subgenres: [
      { id: "afrobeats", microStyles: ["afropop"], patterns: ["afrobeats", "afrobeat", "afropop"], artistHints: ["burna boy", "wizkid", "davido"] },
      { id: "k_pop", microStyles: ["korean pop"], patterns: ["k-pop", "kpop", "korean pop"] },
      { id: "middle_eastern", microStyles: ["arabic pop"], patterns: ["arabic pop", "middle eastern", "turkish pop"] },
    ],
  },
  {
    family: "christmas",
    subgenres: [
      {
        id: "holiday",
        microStyles: ["christmas pop", "christmas classic", "xmas"],
        patterns: [
          "christmas",
          "xmas",
          "noel",
          "santa",
          "jingle bells",
          "winter wonderland",
          "silent night",
          "holiday song",
          "festive",
          "all i want for christmas",
          "last christmas",
        ],
      },
    ],
  },
];
