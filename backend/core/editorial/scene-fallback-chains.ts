/**
 * Scene-specific fallback chains — when the primary musical world is thin,
 * expand through musically adjacent neighbours (not generic "1970s" or "party").
 *
 * Latin/disco thin-niche expansion already proved this ROI; this registry
 * generalises the pattern for other ecosystems.
 */
export type SceneFallbackChain = {
  id: string;
  promptPattern: RegExp;
  /** Primary genre families / subgenres the chain serves. */
  primaryFamilies: string[];
  primarySubgenres: string[];
  /** Ordered fallback steps — earlier = closer to the human prototype. */
  steps: Array<{
    id: string;
    subgenres: string[];
    families: string[];
    /** Optional audio heuristic for warm neighbours when tags are empty. */
    energyMin?: number;
    danceMin?: number;
  }>;
};

export const SCENE_FALLBACK_CHAINS: SceneFallbackChain[] = [
  {
    id: "disco_dancefloor",
    promptPattern: /\b(?:disco|70s?\s+disco|funk\s+party|studio\s*54|dancefloor)\b/i,
    primaryFamilies: ["soul"],
    primarySubgenres: ["disco"],
    steps: [
      { id: "classic_disco", subgenres: ["disco"], families: ["soul"] },
      { id: "nu_disco", subgenres: ["nu_disco", "disco_pop"], families: ["soul", "electronic", "pop"] },
      { id: "dance_funk", subgenres: ["funk", "p_funk", "boogie"], families: ["soul"] },
      { id: "motown_philly", subgenres: ["motown", "philly_soul"], families: ["soul", "rnb"] },
      {
        id: "soul_dancefloor_pulse",
        subgenres: [],
        families: ["soul", "rnb"],
        energyMin: 0.48,
      },
      {
        id: "studio54_adjacent",
        subgenres: [],
        families: ["soul", "pop", "electronic"],
        energyMin: 0.52,
        danceMin: 0.5,
      },
    ],
  },
  {
    id: "film_ending_cinematic",
    promptPattern: /\b(?:film ending|feels like a film ending|expensive and cinematic|main character walking)\b/i,
    primaryFamilies: ["indie", "rock", "electronic"],
    primarySubgenres: ["post_rock", "dream_pop", "shoegaze", "ambient"],
    steps: [
      { id: "cinematic_core", subgenres: ["post_rock", "shoegaze", "dream_pop", "ambient"], families: ["indie", "rock", "electronic"] },
      { id: "orchestral_neighbours", subgenres: ["neoclassical", "soundtrack", "chamber"], families: ["classical", "soundtrack", "indie"] },
      { id: "slow_indie", subgenres: ["slowcore", "indie_general"], families: ["indie"], energyMin: 0.25 },
    ],
  },
  {
    id: "latin_summer_rooftop",
    promptPattern: /\blatin\s+summer\s+rooftop\b|\blatin.*rooftop\b|\brooftop.*(?:latin|drinks)\b/i,
    primaryFamilies: ["latin"],
    primarySubgenres: ["reggaeton", "latin_pop", "salsa", "bachata", "cumbia"],
    steps: [
      { id: "latin_rooftop_core", subgenres: ["reggaeton", "latin_pop", "salsa", "bachata", "cumbia", "urbano"], families: ["latin"] },
      { id: "caribbean_warm", subgenres: ["dancehall", "reggae", "afrobeats"], families: ["reggae", "world", "latin"] },
      {
        id: "warm_pop_neighbours",
        subgenres: [],
        families: ["pop", "rnb"],
        energyMin: 0.5,
        danceMin: 0.52,
      },
    ],
  },
  {
    id: "latin_summer_party",
    promptPattern: /\b(?:latin|reggaeton|salsa|bachata|cumbia|urbano|beach\s+party|summer\s+beach)\b/i,
    primaryFamilies: ["latin"],
    primarySubgenres: ["reggaeton", "salsa", "bachata", "cumbia", "latin_pop"],
    steps: [
      { id: "latin_core", subgenres: ["latin", "reggaeton", "salsa", "bachata", "cumbia", "urbano"], families: ["latin"] },
      { id: "caribbean", subgenres: ["dancehall", "reggae", "afrobeats"], families: ["reggae", "world", "latin"] },
      {
        id: "warm_dance_neighbours",
        subgenres: [],
        families: ["pop", "electronic", "rnb", "hip_hop"],
        energyMin: 0.55,
        danceMin: 0.55,
      },
    ],
  },
  {
    id: "uk_garage",
    promptPattern: /\b(?:uk\s*garage|ukg|2[\s-]?step|speed\s+garage)\b/i,
    primaryFamilies: ["electronic"],
    primarySubgenres: ["uk_garage"],
    steps: [
      { id: "ukg_core", subgenres: ["uk_garage"], families: ["electronic"] },
      { id: "speed_garage_house", subgenres: ["house", "speed_garage", "garage"], families: ["electronic"] },
      { id: "uk_bass_adjacent", subgenres: ["bassline", "broken_beat"], families: ["electronic", "hip_hop"] },
      {
        id: "dancefloor_pulse",
        subgenres: [],
        families: ["electronic", "pop"],
        energyMin: 0.6,
        danceMin: 0.65,
      },
    ],
  },
  {
    id: "shoegaze_dream",
    promptPattern: /\b(?:shoegaze|dream\s*pop|slowdive|mbv|my\s+bloody\s+valentine)\b/i,
    primaryFamilies: ["indie", "rock"],
    primarySubgenres: ["shoegaze", "dream_pop"],
    steps: [
      { id: "shoegaze_core", subgenres: ["shoegaze", "dream_pop"], families: ["indie", "rock"] },
      { id: "noise_pop", subgenres: ["noise_pop", "indie_rock"], families: ["indie", "rock"] },
      { id: "ethereal_indie", subgenres: ["indie_general", "dream_pop"], families: ["indie"] },
    ],
  },
  {
    id: "liquid_dnb",
    promptPattern: /\b(?:liquid\s*(?:dnb|drum\s*(?:and|&)\s*bass)|atmospheric\s*dnb)\b/i,
    primaryFamilies: ["electronic"],
    primarySubgenres: ["drum_and_bass", "liquid_dnb"],
    steps: [
      { id: "liquid_core", subgenres: ["liquid_dnb", "drum_and_bass"], families: ["electronic"] },
      { id: "atmospheric_jungle", subgenres: ["jungle", "breakbeat"], families: ["electronic"] },
      {
        id: "rolling_bass",
        subgenres: [],
        families: ["electronic"],
        energyMin: 0.55,
        danceMin: 0.5,
      },
    ],
  },
  {
    id: "french_house",
    promptPattern: /\b(?:french\s*house|filter\s*house|dadeez|daft\s*punk|cassius)\b/i,
    primaryFamilies: ["electronic"],
    primarySubgenres: ["french_house", "house"],
    steps: [
      { id: "french_house_core", subgenres: ["french_house", "filter_house"], families: ["electronic"] },
      { id: "nu_disco_house", subgenres: ["nu_disco", "house", "disco"], families: ["electronic", "soul"] },
      {
        id: "funky_house",
        subgenres: [],
        families: ["electronic", "soul"],
        energyMin: 0.55,
        danceMin: 0.62,
      },
    ],
  },
  {
    id: "synthwave",
    promptPattern: /\b(?:synthwave|retrowave|outrun|80s\s*synth)\b/i,
    primaryFamilies: ["electronic"],
    primarySubgenres: ["synthwave"],
    steps: [
      { id: "synthwave_core", subgenres: ["synthwave", "retrowave"], families: ["electronic"] },
      { id: "80s_synth_pop", subgenres: ["synth_pop", "new_wave"], families: ["electronic", "pop", "rock"] },
      { id: "cinematic_electro", subgenres: ["soundtrack"], families: ["electronic", "soundtrack"] },
    ],
  },
  {
    id: "city_pop",
    promptPattern: /\b(?:city\s*pop|citypop|j[\s-]?pop\s*city|yacht\s*rock)\b/i,
    primaryFamilies: ["pop", "rnb"],
    primarySubgenres: ["city_pop"],
    steps: [
      { id: "city_pop_core", subgenres: ["city_pop"], families: ["pop", "world"] },
      { id: "yacht_aor", subgenres: ["soft_rock", "yacht_rock", "aor"], families: ["pop", "rock", "rnb"] },
      { id: "smooth_80s", subgenres: ["synth_pop", "funk"], families: ["pop", "soul"] },
    ],
  },
  {
    id: "goth_darkwave",
    promptPattern: /\b(?:goth|gothic|darkwave|post[-\s]?punk|batcave|industrial\s+goth)\b/i,
    primaryFamilies: ["rock", "indie", "electronic"],
    primarySubgenres: ["goth", "darkwave", "post_punk", "industrial"],
    steps: [
      { id: "goth_core", subgenres: ["goth", "gothic", "darkwave", "deathrock"], families: ["rock", "indie"] },
      { id: "post_punk", subgenres: ["post_punk", "coldwave"], families: ["rock", "indie", "electronic"] },
      { id: "industrial_dark_electronic", subgenres: ["industrial", "ebm", "dark_electronic"], families: ["electronic", "rock", "metal"] },
      { id: "ethereal_shoegaze", subgenres: ["shoegaze", "dream_pop", "ethereal"], families: ["indie", "rock"] },
    ],
  },
  {
    id: "lofi_study",
    promptPattern: /\b(?:lo-?fi|lofi|chillhop|study\s+beats?)\b/i,
    primaryFamilies: ["indie", "electronic", "jazz", "hip_hop"],
    primarySubgenres: ["lofi", "chillhop"],
    steps: [
      { id: "lofi_core", subgenres: ["lofi", "chillhop", "lo_fi"], families: ["hip_hop", "electronic", "indie"] },
      { id: "jazzy_downtempo", subgenres: ["downtempo", "jazzhop"], families: ["jazz", "electronic", "hip_hop"] },
      { id: "soft_instrumental", subgenres: ["instrumental"], families: ["indie", "electronic", "jazz"], energyMin: 0.15 },
    ],
  },
  {
    id: "ambient_focus",
    promptPattern: /\b(?:ambient|soundscape|no\s+vocals?|instrumental\s+focus)\b/i,
    primaryFamilies: ["electronic", "classical", "soundtrack", "indie"],
    primarySubgenres: ["ambient"],
    steps: [
      { id: "ambient_core", subgenres: ["ambient", "drone", "soundscape"], families: ["electronic", "classical"] },
      { id: "neoclassical", subgenres: ["neoclassical", "modern_classical"], families: ["classical", "soundtrack"] },
      { id: "soft_electronic", subgenres: ["downtempo", "idm"], families: ["electronic"], energyMin: 0.1 },
    ],
  },
  {
    id: "rave_comedown",
    promptPattern: /\b(?:rave|club)\s+comedown\b|\bcomedown\b.*\b(?:rave|club)\b|\bpost[-\s]?rave\b/i,
    primaryFamilies: ["electronic", "indie"],
    primarySubgenres: ["ambient", "downtempo", "deep_house"],
    steps: [
      { id: "soft_afterglow", subgenres: ["ambient", "downtempo", "chillout"], families: ["electronic"], energyMin: 0.12 },
      { id: "deep_melodic", subgenres: ["deep_house", "melodic_house"], families: ["electronic"], energyMin: 0.25 },
      { id: "trip_hop_leftfield", subgenres: ["trip_hop", "leftfield"], families: ["electronic", "indie"], energyMin: 0.2 },
    ],
  },
  {
    id: "boss_fight",
    promptPattern: /\bboss\s+(?:fight|battle)\b|\bfinal\s+boss\b/i,
    primaryFamilies: ["metal", "electronic", "rock", "soundtrack"],
    primarySubgenres: ["metal", "industrial", "trailer"],
    steps: [
      { id: "combat_metal", subgenres: ["metal", "metalcore", "industrial"], families: ["metal", "rock"], energyMin: 0.65 },
      { id: "hybrid_trailer", subgenres: ["trailer", "epic", "orchestral"], families: ["soundtrack", "electronic"], energyMin: 0.6 },
      { id: "hard_electronic", subgenres: ["drum_and_bass", "hardstyle", "industrial"], families: ["electronic"], energyMin: 0.62 },
    ],
  },
  {
    id: "grunge_90s",
    promptPattern: /\bgrunge\b|\bseattle\s+(?:sound|grunge)\b|\b90s?\s+grunge\b/i,
    primaryFamilies: ["rock", "indie", "metal"],
    primarySubgenres: ["grunge", "alternative_rock", "post_grunge"],
    steps: [
      { id: "grunge_core", subgenres: ["grunge", "seattle"], families: ["rock"] },
      { id: "90s_alt_rock", subgenres: ["alternative_rock", "alt_rock", "post_grunge"], families: ["rock", "indie"] },
      { id: "adjacent_90s_punk", subgenres: ["punk", "pop_punk"], families: ["rock", "punk"] },
    ],
  },
  {
    id: "pop_punk",
    promptPattern: /\bpop[-\s]?punk\b|\b2000s?\s+(?:pop\s*)?punk\b/i,
    primaryFamilies: ["rock", "punk", "indie", "pop"],
    primarySubgenres: ["pop_punk", "emo", "skate_punk"],
    steps: [
      { id: "pop_punk_core", subgenres: ["pop_punk", "skate_punk"], families: ["rock", "punk"] },
      { id: "emo_adjacent", subgenres: ["emo", "easycore"], families: ["rock", "indie"] },
      { id: "2000s_alt", subgenres: ["alternative_rock", "indie_rock"], families: ["rock", "indie"] },
    ],
  },
  {
    id: "gym_rock",
    promptPattern: /\bgym\s+rock\b|\b(?:gym|workout)\b.*\brock\b|\brock\b.*\b(?:gym|workout)\b/i,
    primaryFamilies: ["rock", "metal", "punk"],
    primarySubgenres: ["hard_rock", "metal", "alternative_rock", "nu_metal"],
    steps: [
      { id: "hard_rock_core", subgenres: ["hard_rock", "metal", "nu_metal"], families: ["rock", "metal"], energyMin: 0.6 },
      { id: "alt_punk_drive", subgenres: ["alternative_rock", "punk", "pop_punk"], families: ["rock", "punk"], energyMin: 0.58 },
      { id: "post_grunge_power", subgenres: ["post_grunge", "grunge"], families: ["rock"], energyMin: 0.55 },
    ],
  },
  {
    id: "classic_70s_rock",
    promptPattern: /\b(?:70s?|seventies)\s+rock\b|\bclassic\s+rock\b/i,
    primaryFamilies: ["rock", "blues", "metal"],
    primarySubgenres: ["classic_rock", "hard_rock", "blues_rock", "prog"],
    steps: [
      { id: "70s_classic_core", subgenres: ["classic_rock", "hard_rock"], families: ["rock"] },
      { id: "blues_prog", subgenres: ["blues_rock", "prog", "progressive_rock", "glam"], families: ["rock", "blues"] },
      { id: "late_60s_early_80s_rock", subgenres: ["classic_rock", "arena_rock"], families: ["rock", "metal"] },
    ],
  },
];

export function resolveSceneFallbackChain(vibe: string, genreFamilies: string[] = []): SceneFallbackChain | null {
  const lower = vibe.toLowerCase();
  for (const chain of SCENE_FALLBACK_CHAINS) {
    if (chain.promptPattern.test(lower)) return chain;
  }
  for (const chain of SCENE_FALLBACK_CHAINS) {
    if (chain.primaryFamilies.some((f) => genreFamilies.includes(f))) {
      // Weak family-only match — only when prompt is thin.
      if (chain.primarySubgenres.some((s) => lower.includes(s.replace(/_/g, " ")))) return chain;
    }
  }
  return null;
}

export type FallbackMatchTrack = {
  trackId: string;
  artistName?: string | null;
  energy?: number | null;
  danceability?: number | null;
  genreFamily?: string | null;
  primarySubgenre?: string | null;
  secondarySubgenre?: string | null;
  subGenres?: string[];
};

function trackSubgenres(track: FallbackMatchTrack): string[] {
  const out = new Set<string>();
  if (track.primarySubgenre) out.add(track.primarySubgenre);
  if (track.secondarySubgenre) out.add(track.secondarySubgenre);
  for (const s of track.subGenres ?? []) out.add(s);
  return [...out];
}

export function trackMatchesFallbackChain(
  track: FallbackMatchTrack,
  chain: SceneFallbackChain,
): { matched: boolean; stepId: string | null; stepIndex: number } {
  const family = (track.genreFamily ?? "").toLowerCase();
  const subs = trackSubgenres(track).map((s) => s.toLowerCase());
  const energy = typeof track.energy === "number" ? track.energy : null;
  const dance = typeof track.danceability === "number" ? track.danceability : null;

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i]!;
    const subHit =
      step.subgenres.length === 0 ||
      step.subgenres.some((s) => subs.includes(s.toLowerCase()));
    const familyHit =
      step.families.length === 0 ||
      step.families.some((f) => f.toLowerCase() === family);
    if (!familyHit && step.subgenres.length > 0 && !subHit) continue;
    if (step.subgenres.length > 0 && !subHit && !familyHit) continue;
    if (step.subgenres.length > 0 && subHit) {
      return { matched: true, stepId: step.id, stepIndex: i };
    }
    if (step.subgenres.length === 0 && familyHit) {
      // Prefer audio when present; do not reject library rows with missing dance/energy —
      // that starved disco/latin sibling fill on sparse metadata.
      if (step.energyMin != null && energy != null && energy < step.energyMin) continue;
      if (step.danceMin != null && dance != null && dance < step.danceMin) continue;
      return { matched: true, stepId: step.id, stepIndex: i };
    }
    if (familyHit && subHit) {
      return { matched: true, stepId: step.id, stepIndex: i };
    }
  }
  return { matched: false, stepId: null, stepIndex: -1 };
}

/** Rank candidates by how close they sit on the fallback chain (step 0 first). */
export function rankByFallbackChainProximity<T extends FallbackMatchTrack>(
  tracks: T[],
  chain: SceneFallbackChain,
): T[] {
  return tracks
    .map((track) => {
      const match = trackMatchesFallbackChain(track, chain);
      const energy = typeof track.energy === "number" ? track.energy : 0;
      return { track, match, energy };
    })
    .filter((row) => row.match.matched)
    .sort((a, b) => {
      if (a.match.stepIndex !== b.match.stepIndex) return a.match.stepIndex - b.match.stepIndex;
      return b.energy - a.energy;
    })
    .map((row) => row.track);
}

function normalizeArtistKey(artistName: string | null | undefined): string {
  return (artistName ?? "").toLowerCase().trim();
}

/**
 * Grow an underfilled playlist along a scene fallback chain while respecting
 * per-artist caps. Used after delivery artist-cap prune (disco 35→10) so
 * adjacent siblings refill instead of leaving a thin dancefloor.
 */
export function fillPlaylistViaFallbackChain<T extends FallbackMatchTrack>(
  current: T[],
  candidates: T[],
  chain: SceneFallbackChain,
  opts: {
    targetLength: number;
    maxPerArtist: number;
  },
): { tracks: T[]; added: number; rankedPoolSize: number } {
  const target = Math.max(current.length, opts.targetLength);
  const maxPerArtist = Math.max(1, opts.maxPerArtist);
  const seen = new Set(current.map((t) => t.trackId));
  const artistCounts = new Map<string, number>();
  for (const track of current) {
    const artist = normalizeArtistKey(track.artistName);
    if (!artist) continue;
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
  }
  const ranked = rankByFallbackChainProximity(
    candidates.filter((t) => !seen.has(t.trackId)),
    chain,
  );
  const out = [...current];
  let added = 0;
  for (const candidate of ranked) {
    if (out.length >= target) break;
    if (seen.has(candidate.trackId)) continue;
    const artist = normalizeArtistKey(candidate.artistName);
    if (artist && (artistCounts.get(artist) ?? 0) >= maxPerArtist) continue;
    seen.add(candidate.trackId);
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    out.push(candidate);
    added += 1;
  }
  return { tracks: out, added, rankedPoolSize: ranked.length };
}
