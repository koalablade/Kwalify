/**
 * Artist identity overrides — stronger than Spotify genre tags for world routing.
 * Green Day is pop-punk, not grunge. Nirvana is grunge, not pop-punk.
 */

export type ArtistWorldIdentity = {
  id: string;
  pattern: RegExp;
  naturalWorlds: string[];
  forbiddenWorlds: string[];
  genreEvidence: string[];
};

export const ARTIST_WORLD_IDENTITIES: ArtistWorldIdentity[] = [
  {
    id: "green_day",
    pattern: /\bgreen\s+day\b/i,
    naturalWorlds: ["pop_punk_world", "gym_rock_world", "nostalgia_warm_world"],
    forbiddenWorlds: ["grunge_world", "heavy_gym_world", "angry_rock_world"],
    genreEvidence: ["pop punk", "punk rock", "skate punk"],
  },
  {
    id: "nirvana",
    pattern: /\bnirvana\b/i,
    naturalWorlds: ["grunge_world", "gym_rock_world", "angry_rock_world"],
    forbiddenWorlds: ["pop_punk_world", "yacht_rock_world", "indie_dream_world"],
    genreEvidence: ["grunge", "alternative rock", "seattle"],
  },
  {
    id: "oasis",
    pattern: /\boasis\b/i,
    naturalWorlds: ["britpop_world", "madchester_world", "nostalgia_warm_world"],
    forbiddenWorlds: ["grunge_world", "pop_punk_world", "indie_dream_world"],
    genreEvidence: ["britpop", "madchester", "indie rock"],
  },
  {
    id: "bon_iver",
    pattern: /\bbon\s+iver\b/i,
    naturalWorlds: [
      "chill_rainy_world",
      "sunday_chill_world",
      "soft_sad_world",
      "rainy_reading_world",
      "acoustic_sunday_world",
      "film_ending_world",
      "indie_dream_world",
      "indie_bedroom_world",
    ],
    forbiddenWorlds: [
      "grunge_world",
      "gym_rock_world",
      "angry_rock_world",
      "classic_rock_world",
      "arena_rock_world",
      "dad_secret_world",
      "dad_rock_world",
      "80s_night_drive_world",
      "rainy_motorway_world",
      "road_trip_singalong_world",
      "pub_singalong_world",
      "heavy_gym_world",
      "running_energy_world",
      "madchester_world",
      "britpop_world",
    ],
    genreEvidence: ["indie folk", "folk", "singer-songwriter"],
  },
  {
    id: "phoebe_bridgers",
    pattern: /\bphoebe\s+bridgers\b/i,
    naturalWorlds: ["indie_dream_world", "soft_sad_world", "chill_rainy_world", "indie_bedroom_world"],
    forbiddenWorlds: [
      "classic_rock_world",
      "dad_rock_world",
      "dad_secret_world",
      "yacht_rock_world",
      "arena_rock_world",
      "grunge_world",
      "gym_rock_world",
      "angry_rock_world",
      "heavy_gym_world",
      "madchester_world",
      "80s_night_drive_world",
      "rainy_motorway_world",
    ],
    genreEvidence: ["indie", "sad indie", "singer-songwriter"],
  },
  {
    id: "clairo",
    pattern: /\bclairo\b/i,
    naturalWorlds: ["indie_dream_world", "indie_bedroom_world", "soft_sad_world"],
    forbiddenWorlds: [
      "classic_rock_world",
      "dad_rock_world",
      "dad_secret_world",
      "yacht_rock_world",
      "grunge_world",
      "gym_rock_world",
      "angry_rock_world",
      "heavy_gym_world",
      "madchester_world",
    ],
    genreEvidence: ["bedroom pop", "indie pop"],
  },
  {
    id: "acdc",
    pattern: /\bac\/?dc\b/i,
    naturalWorlds: ["classic_rock_world", "arena_rock_world", "dad_secret_world", "gym_rock_world", "angry_rock_world"],
    forbiddenWorlds: ["indie_dream_world", "lofi_world", "indie_bedroom_world"],
    genreEvidence: ["hard rock", "classic rock", "arena rock"],
  },
  {
    id: "new_order",
    pattern: /\bnew\s+order\b/i,
    naturalWorlds: ["80s_night_drive_world", "neon_tek_drive", "goth_world", "madchester_world"],
    forbiddenWorlds: ["indie_dream_world", "acoustic_sunday_world", "indie_bedroom_world"],
    genreEvidence: ["synthpop", "post-punk", "new wave", "madchester"],
  },
  {
    id: "depeche_mode",
    pattern: /\bdepeche\s+mode\b/i,
    naturalWorlds: ["80s_night_drive_world", "goth_world", "neon_tek_drive"],
    forbiddenWorlds: ["indie_dream_world", "acoustic_sunday_world", "pub_singalong_world"],
    genreEvidence: ["synthpop", "new wave", "electronic"],
  },
  {
    id: "beach_house",
    pattern: /\bbeach\s+house\b/i,
    naturalWorlds: ["beach_sunset_world", "indie_dream_world", "late_night_calm_world"],
    forbiddenWorlds: [
      "80s_night_drive_world",
      "rainy_motorway_world",
      "grunge_world",
      "madchester_world",
      "heavy_gym_world",
      "running_energy_world",
      "road_trip_singalong_world",
      "pub_singalong_world",
    ],
    genreEvidence: ["dream pop", "indie", "shoegaze"],
  },
  {
    id: "stone_roses",
    pattern: /\bstone\s+roses\b/i,
    naturalWorlds: ["madchester_world", "britpop_world"],
    forbiddenWorlds: ["grunge_world", "indie_dream_world", "acoustic_sunday_world"],
    genreEvidence: ["madchester", "britpop", "baggy"],
  },
  {
    id: "happy_mondays",
    pattern: /\bhappy\s+mondays\b/i,
    naturalWorlds: ["madchester_world", "britpop_world"],
    forbiddenWorlds: ["grunge_world", "indie_dream_world", "acoustic_sunday_world"],
    genreEvidence: ["madchester", "baggy", "britpop"],
  },
  {
    id: "blink_182",
    pattern: /\bblink[-\s]?182\b/i,
    naturalWorlds: ["pop_punk_world", "gym_rock_world", "nostalgia_warm_world"],
    forbiddenWorlds: ["grunge_world", "yacht_rock_world"],
    genreEvidence: ["pop punk", "punk rock"],
  },
  {
    id: "pearl_jam",
    pattern: /\bpearl\s+jam\b/i,
    naturalWorlds: ["grunge_world", "gym_rock_world"],
    forbiddenWorlds: ["pop_punk_world", "yacht_rock_world"],
    genreEvidence: ["grunge", "alternative rock"],
  },
  {
    id: "soundgarden",
    pattern: /\bsoundgarden\b/i,
    naturalWorlds: ["grunge_world", "gym_rock_world", "angry_rock_world"],
    forbiddenWorlds: ["pop_punk_world", "indie_dream_world", "yacht_rock_world"],
    genreEvidence: ["grunge", "alternative rock", "seattle"],
  },
  {
    id: "blur",
    pattern: /\bblur\b/i,
    naturalWorlds: ["britpop_world", "madchester_world", "pub_singalong_world"],
    forbiddenWorlds: ["grunge_world", "indie_dream_world", "acoustic_sunday_world"],
    genreEvidence: ["britpop", "indie rock", "madchester"],
  },
  {
    id: "arctic_monkeys",
    pattern: /\barctic\s+monkeys\b/i,
    naturalWorlds: ["britpop_world", "madchester_world", "pub_singalong_world", "indie_dream_world"],
    forbiddenWorlds: ["grunge_world", "yacht_rock_world", "acoustic_sunday_world", "country_world"],
    genreEvidence: ["britpop", "indie rock"],
  },
  {
    id: "fleetwood_mac",
    pattern: /\bfleetwood\s+mac\b/i,
    naturalWorlds: ["yacht_rock_world", "classic_rock_world", "dad_secret_world", "dad_rock_world"],
    forbiddenWorlds: ["grunge_world", "madchester_world", "80s_night_drive_world", "indie_dream_world"],
    genreEvidence: ["classic rock", "yacht rock", "soft rock", "fleetwood mac"],
  },
  {
    id: "queen",
    pattern: /\bqueen\b/i,
    naturalWorlds: ["classic_rock_world", "arena_rock_world", "dad_secret_world", "dad_rock_world", "road_trip_singalong_world"],
    forbiddenWorlds: ["indie_dream_world", "grunge_world", "madchester_world", "acoustic_sunday_world"],
    genreEvidence: ["classic rock", "arena rock", "hard rock"],
  },
  {
    id: "eagles",
    pattern: /\beagles\b/i,
    naturalWorlds: ["classic_rock_world", "yacht_rock_world", "dad_secret_world", "dad_rock_world"],
    forbiddenWorlds: ["grunge_world", "madchester_world", "indie_dream_world"],
    genreEvidence: ["classic rock", "yacht rock", "country rock"],
  },
  {
    id: "tom_petty",
    pattern: /\btom\s+petty\b/i,
    naturalWorlds: ["classic_rock_world", "yacht_rock_world", "dad_secret_world", "dad_rock_world"],
    forbiddenWorlds: ["grunge_world", "madchester_world", "indie_dream_world"],
    genreEvidence: ["classic rock", "heartland rock", "yacht rock"],
  },
  {
    id: "m83",
    pattern: /\bm83\b/i,
    naturalWorlds: ["rainy_motorway_world", "rainy_drive_world", "night_drive_world", "80s_night_drive_world"],
    forbiddenWorlds: ["classic_rock_world", "grunge_world", "madchester_world", "gym_rock_world"],
    genreEvidence: ["synthpop", "electronic", "shoegaze", "ambient"],
  },
  {
    id: "chromatics",
    pattern: /\bchromatics\b/i,
    naturalWorlds: ["rainy_motorway_world", "rainy_drive_world", "night_drive_world", "80s_night_drive_world"],
    forbiddenWorlds: ["classic_rock_world", "grunge_world", "madchester_world", "pub_singalong_world"],
    genreEvidence: ["synthpop", "darkwave", "electronic"],
  },
  {
    id: "war_on_drugs",
    pattern: /\bwar\s+on\s+drugs\b/i,
    naturalWorlds: ["rainy_motorway_world", "rainy_drive_world", "night_drive_world"],
    forbiddenWorlds: ["grunge_world", "madchester_world", "gym_rock_world", "disco_1970s_world"],
    genreEvidence: ["indie rock", "americana", "heartland rock"],
  },
  {
    id: "the_1975",
    pattern: /\bthe\s+1975\b/i,
    naturalWorlds: ["indie_dream_world", "britpop_world", "indie_bedroom_world"],
    forbiddenWorlds: ["80s_night_drive_world", "classic_rock_world", "grunge_world", "disco_1970s_world", "madchester_world", "britpop_world"],
    genreEvidence: ["indie pop", "alternative rock", "modern indie"],
  },
  {
    id: "scooter",
    pattern: /\bscooter\b/i,
    naturalWorlds: ["gym_energy_world", "running_energy_world", "party_prep_world"],
    forbiddenWorlds: ["classic_rock_world", "grunge_world", "rainy_motorway_world", "indie_dream_world", "gym_rock_world", "heavy_gym_world", "angry_rock_world"],
    genreEvidence: ["eurodance", "techno", "dance"],
  },
  {
    id: "metallica",
    pattern: /\bmetallica\b/i,
    naturalWorlds: ["gym_rock_world", "angry_rock_world", "heavy_gym_world", "grunge_world"],
    forbiddenWorlds: ["indie_dream_world", "yacht_rock_world", "acoustic_sunday_world"],
    genreEvidence: ["metal", "thrash metal", "heavy metal"],
  },
  {
    id: "foo_fighters",
    pattern: /\bfoo\s+fighters\b/i,
    naturalWorlds: ["gym_rock_world", "grunge_world", "classic_rock_world", "angry_rock_world"],
    forbiddenWorlds: ["indie_dream_world", "yacht_rock_world", "disco_1970s_world"],
    genreEvidence: ["alternative rock", "post-grunge", "rock"],
  },
  {
    id: "sonic_youth",
    pattern: /\bsonic\s+youth\b/i,
    naturalWorlds: ["grunge_world", "indie_dream_world", "nostalgia_warm_world"],
    forbiddenWorlds: ["gym_rock_world", "heavy_gym_world", "angry_rock_world", "disco_1970s_world"],
    genreEvidence: ["alternative rock", "noise rock"],
  },
  {
    id: "johnny_cash",
    pattern: /\bjohnny\s+cash\b/i,
    naturalWorlds: ["country_world", "classic_rock_world", "dad_rock_world"],
    forbiddenWorlds: ["grunge_world", "madchester_world", "80s_night_drive_world", "indie_dream_world"],
    genreEvidence: ["country", "outlaw country", "americana"],
  },
  {
    id: "destructo_disk",
    pattern: /\bdestructo\s+disk\b/i,
    naturalWorlds: ["pop_punk_world", "indie_dream_world"],
    forbiddenWorlds: ["gym_rock_world", "angry_rock_world", "heavy_gym_world", "classic_rock_world", "grunge_world", "madchester_world", "britpop_world", "rainy_motorway_world", "rainy_drive_world"],
    genreEvidence: ["indie rock", "punk"],
  },
  {
    id: "jungle_giants",
    pattern: /\bjungle\s+giants\b/i,
    naturalWorlds: ["indie_dream_world", "britpop_world", "nostalgia_warm_world"],
    forbiddenWorlds: [
      "rainy_motorway_world",
      "rainy_drive_world",
      "night_drive_world",
      "80s_night_drive_world",
      "classic_rock_world",
      "dad_rock_world",
      "grunge_world",
      "madchester_world",
      "heavy_gym_world",
      "gym_rock_world",
      "country_world",
    ],
    genreEvidence: ["indie rock", "indie pop"],
  },
  {
    id: "fall_out_boy",
    pattern: /\bfall\s+out\s+boy\b/i,
    naturalWorlds: ["pop_punk_world", "gym_energy_world", "nostalgia_warm_world"],
    forbiddenWorlds: [
      "gym_rock_world",
      "heavy_gym_world",
      "angry_rock_world",
      "classic_rock_world",
      "dad_rock_world",
      "grunge_world",
      "madchester_world",
      "rainy_motorway_world",
      "80s_night_drive_world",
    ],
    genreEvidence: ["pop punk", "emo", "alternative rock"],
  },
  {
    id: "panic_at_the_disco",
    pattern: /\bpanic!\s+at\s+the\s+disco\b|\bpanic\s+at\s+the\s+disco\b/i,
    naturalWorlds: ["pop_punk_world", "nostalgia_warm_world", "indie_dream_world"],
    forbiddenWorlds: [
      "disco_1970s_world",
      "disco_party_world",
      "classic_rock_world",
      "dad_rock_world",
      "grunge_world",
      "madchester_world",
      "rainy_motorway_world",
      "heavy_gym_world",
      "angry_rock_world",
      "gym_rock_world",
    ],
    genreEvidence: ["pop punk", "emo", "alternative rock"],
  },
  {
    id: "wallows",
    pattern: /\bwallows\b/i,
    naturalWorlds: ["indie_dream_world", "indie_bedroom_world"],
    forbiddenWorlds: [
      "rainy_motorway_world",
      "rainy_drive_world",
      "night_drive_world",
      "80s_night_drive_world",
      "classic_rock_world",
      "dad_rock_world",
      "grunge_world",
      "madchester_world",
    ],
    genreEvidence: ["indie rock", "indie pop"],
  },
];

export function resolveArtistWorldIdentity(
  artistName: string | null | undefined,
): ArtistWorldIdentity | null {
  if (!artistName) return null;
  for (const row of ARTIST_WORLD_IDENTITIES) {
    if (row.pattern.test(artistName)) return row;
  }
  return null;
}

export function artistForbiddenInWorld(
  artistName: string | null | undefined,
  activeWorldIds: string[],
): boolean {
  if (!artistName || activeWorldIds.length === 0) return false;
  const identity = resolveArtistWorldIdentity(artistName);
  if (!identity) return false;
  return identity.forbiddenWorlds.some((w) => activeWorldIds.includes(w));
}

export function artistSupportsWorld(
  artistName: string | null | undefined,
  activeWorldIds: string[],
): boolean {
  if (!artistName || activeWorldIds.length === 0) return false;
  const identity = resolveArtistWorldIdentity(artistName);
  if (!identity) return false;
  return identity.naturalWorlds.some((w) => activeWorldIds.includes(w));
}

/** Inject artist-identity genre evidence into world membership checks. */
export function artistIdentityGenreEvidence(artistName: string | null | undefined): string {
  const identity = resolveArtistWorldIdentity(artistName);
  if (!identity) return "";
  return identity.genreEvidence.join(" ");
}
