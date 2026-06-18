/**
 * Contextual disambiguation for tokens that span genre, mood, activity, and place.
 * Guards only — no ontology expansion.
 */

const MUSIC_CONTEXT_RE =
  /\b(?:music|songs?|tracks?|playlist|mix|hits?|anthems?|classics?|artists?|bands?|albums?|genre|sound|era|decade|bangers|set|dj|producer|beats?|bpm|radio|record|vinyl|spotify)\b/i;

export function hasExplicitMusicContext(input: string): boolean {
  return MUSIC_CONTEXT_RE.test(input);
}

export function hasDomesticHouseContext(input: string): boolean {
  return /\b(?:moving|packing|empty|quiet|shared|student|cleaning|tidy|new|messy)\s+house\b/i.test(input) ||
    /\bhouse\s+(?:party|keys|mates|show|warming|hunting)\b/i.test(input) ||
    /\bmoving\s+house\b/i.test(input) ||
    /\btrap\s+house\b/i.test(input) ||
    /\b(?:in|at|around)\s+(?:my|the|our)\s+house\b/i.test(input);
}

export function hasHouseMusicContext(input: string): boolean {
  return /\bhouse\s+music\b/i.test(input) ||
    /\b(?:deep|tech|progressive|acid|melodic|future|afro|french|vocal|classic|minimal|tropical|ghetto|filter|fidget|italo|bassline)\s+house\b/i.test(input) ||
    /\b(?:afterhours|ibiza|berlin|chicago|detroit)\s+house\b/i.test(input);
}

export function hasRuralCountryContext(input: string): boolean {
  return /\bcountry\s+(?:road|roads|lane|lanes|pub|drive|drives)\b/i.test(input) ||
    /\b(?:on|down|along)\s+country\s+roads?\b/i.test(input) ||
    (/\bcountryside\b/i.test(input) && !hasExplicitMusicContext(input));
}

export function hasCountryMusicContext(input: string): boolean {
  return /\bcountry\s+(?:music|songs?|hits?|classics?|radio|pop|rock|western|artists?)\b/i.test(input) ||
    /\b(?:americana|bluegrass|honky\s+tonk|nashville|outlaw\s+country|red\s+dirt)\b/i.test(input);
}

export function hasMoodBluesContext(input: string): boolean {
  return /\bfeeling\s+(?:the\s+)?blue?s?\b/i.test(input) ||
    /\bbeen\s+blue\b/i.test(input) ||
    /\ba\s+bit\s+blue\b/i.test(input);
}

export function hasBluesMusicContext(input: string): boolean {
  return /\b(?:delta|chicago|electric|acoustic|texas|swamp|jump|soul)\s+blues\b/i.test(input) ||
    /\bblues\s+(?:rock|guitar|legends?|music|classics?|songs?|artists?)\b/i.test(input) ||
    /\bblues\s+&\s+soul\b/i.test(input);
}

export function hasNatureJungleContext(input: string): boolean {
  return /\b(?:walking|hiking|trekking)\s+(?:through|in)\s+(?:a\s+|the\s+)?jungle\b/i.test(input) ||
    /\b(?:walking|walk|hike|hiking|trek|trekking|through|in\s+the|rainforest|amazon|tropical)\b[\s\S]{0,40}\bjungle\b/i.test(input) ||
    /\bjungle\b[\s\S]{0,40}\b(?:walk|trail|trek|hike|rainforest|amazon|animals?|tropical|humid|canopy)\b/i.test(input);
}

export function hasJungleMusicContext(input: string): boolean {
  return /\bjungle\s+(?:classics?|dnb|dn'b|drum|breaks|music|era|anthems?|sound|techno|bass)\b/i.test(input) ||
    /\b(?:ragga|atmospheric|old\s*school|uk|dark)\s+jungle\b/i.test(input) ||
    /\bjungle\s+&\s+bass\b/i.test(input) ||
    /\bdnb\s+classics?\b/i.test(input);
}

export function hasConstructionDrillContext(input: string): boolean {
  return /\b(?:fire\s+drill|power\s+drill|drill\s+bit|drill\s+press|construction\s+drill)\b/i.test(input);
}

export function hasDrillMusicContext(input: string): boolean {
  return /\b(?:uk|london|ny|brooklyn|chicago|sample|melodic)\s+drill\b/i.test(input) ||
    /\bdrill\s+(?:rap|music|beats?|playlist|classics?)\b/i.test(input) ||
    /\bdrill\s+&\s+bass\b/i.test(input);
}

export function hasTransitUndergroundContext(input: string): boolean {
  return /\b(?:tube|subway|metro|train|station|commute|national\s+rail)\b/i.test(input) &&
    /\bunderground\b/i.test(input) &&
    !hasExplicitMusicContext(input);
}

export function hasIndustrialWorkContext(input: string): boolean {
  return /\bindustrial\s+(?:work|site|zone|park|estate|unit|area|district)\b/i.test(input) ||
    /\b(?:factory|warehouse)\s+work\b/i.test(input) ||
    /\bworking\s+(?:in|at)\s+(?:a\s+)?(?:factory|warehouse)\b/i.test(input);
}

export function hasIndustrialMusicContext(input: string): boolean {
  return /\bindustrial\s+(?:techno|metal|rave|rock|goth|dance|noise|ebm)\b/i.test(input) ||
    /\b(?:ebm|aggrotech)\b/i.test(input);
}

export function hasTrapPlaceContext(input: string): boolean {
  return /\btrap\s+house\b/i.test(input);
}

export function hasAtmosphereAmbientContext(input: string): boolean {
  return !hasExplicitMusicContext(input) && (
    /\b(?:calm|peaceful|relax|meditative|study|quiet|soft)\b[\s\S]{0,24}\bambient\b/i.test(input) ||
    /\bambient\b[\s\S]{0,24}\b(?:calm|peaceful|relax|morning|evening|study|vibes?)\b/i.test(input)
  );
}

/** Returns true when a genre alias term should NOT activate retrieval/genre intent. */
export function shouldSuppressGenreTerm(input: string, family: string, term: string): boolean {
  const normalized = term.toLowerCase().trim();
  const music = hasExplicitMusicContext(input);

  if (family === "electronic" && normalized === "house") {
    if (hasHouseMusicContext(input)) return false;
    if (hasDomesticHouseContext(input)) return true;
    if (/\btrap\s+house\b/i.test(input)) return true;
    if (!music && /\bhouse\b/i.test(input)) return true;
  }

  if (family === "country" && normalized === "country") {
    if (hasCountryMusicContext(input)) return false;
    if (hasRuralCountryContext(input)) return true;
    if (/\bcountry\s+roads?\b/i.test(input) && !hasCountryMusicContext(input)) return true;
  }

  if (family === "blues" && normalized === "blues") {
    if (hasBluesMusicContext(input)) return false;
    if (hasMoodBluesContext(input)) return true;
    if (/\bfeeling\s+(?:the\s+)?blues\b/i.test(input) && !hasBluesMusicContext(input)) return true;
  }

  if (family === "electronic" && normalized === "jungle") {
    if (hasJungleMusicContext(input)) return false;
    if (hasNatureJungleContext(input)) return true;
  }

  if (family === "hip_hop" && normalized === "drill") {
    if (hasDrillMusicContext(input)) return false;
    if (hasConstructionDrillContext(input)) return true;
    if (/\bdrill\s+workout\b/i.test(input) && !/\b(?:uk|london|rap|drill\s+music)\b/i.test(input)) return true;
  }

  if (family === "hip_hop" && normalized === "trap") {
    if (hasTrapPlaceContext(input)) return true;
    if (/\btrap\s+house\b/i.test(input)) return true;
  }

  if (family === "hip_hop" && /\bunderground\b/i.test(normalized)) {
    if (hasTransitUndergroundContext(input)) return true;
  }

  if (family === "electronic" && normalized === "ambient") {
    if (/\bambient\s+(?:house|techno|pop|classical|music|playlist|soundscape|dnb)\b/i.test(input)) return false;
    if (hasAtmosphereAmbientContext(input)) return true;
  }

  if ((family === "electronic" || family === "metal") && normalized.includes("industrial")) {
    if (hasIndustrialMusicContext(input)) return false;
    if (hasIndustrialWorkContext(input)) return true;
  }

  if (family === "electronic" && normalized === "rave") {
    if (/\bwarehouse\s+rave\b/i.test(input) || /\brave\s+(?:techno|classics?|music|era)\b/i.test(input)) return false;
    if (!music && /\brave\b/i.test(input) && /\bwarehouse\b/i.test(input)) return false;
  }

  return false;
}

export function shouldSuppressSubgenre(input: string, family: string, subgenreId: string): boolean {
  if (subgenreId === "house" && hasDomesticHouseContext(input) && !hasHouseMusicContext(input)) return true;
  if (subgenreId === "house" && /\btrap\s+house\b/i.test(input)) return true;
  if (subgenreId === "jungle" && hasNatureJungleContext(input) && !hasJungleMusicContext(input)) return true;
  if (subgenreId === "trap" && (hasTrapPlaceContext(input) || /\btrap\s+house\b/i.test(input))) return true;
  if (subgenreId === "blues" && hasMoodBluesContext(input) && !hasBluesMusicContext(input)) return true;
  if (subgenreId === "ambient" && hasAtmosphereAmbientContext(input) && !/\bambient\s+(?:music|house|techno|playlist)\b/i.test(input)) return true;
  if (subgenreId === "drill" && hasConstructionDrillContext(input) && !hasDrillMusicContext(input)) return true;
  if (
    (subgenreId === "industrial_techno" || subgenreId === "industrial_metal") &&
    hasIndustrialWorkContext(input) &&
    !hasIndustrialMusicContext(input)
  ) {
    return true;
  }
  return false;
}

export function shouldSuppressGenreFamily(input: string, family: string): boolean {
  if (family === "country" && hasRuralCountryContext(input) && !hasCountryMusicContext(input)) return true;
  if (family === "electronic" && hasDomesticHouseContext(input) && !hasHouseMusicContext(input)) return true;
  if (family === "electronic" && /\btrap\s+house\b/i.test(input) && !hasHouseMusicContext(input)) return true;
  if (family === "electronic" && hasNatureJungleContext(input) && !hasJungleMusicContext(input)) return true;
  if (family === "blues" && (hasMoodBluesContext(input) || /\bfeeling\s+(?:the\s+)?blues\b/i.test(input)) && !hasBluesMusicContext(input)) return true;
  if (family === "hip_hop" && hasTrapPlaceContext(input) && !hasDrillMusicContext(input) && !/\b(?:trap\s+music|trap\s+beats?|trap\s+rap)\b/i.test(input)) return true;
  if ((family === "electronic" || family === "metal") && hasIndustrialWorkContext(input) && !hasIndustrialMusicContext(input)) return true;
  if (family === "electronic" && hasAtmosphereAmbientContext(input) && !/\bambient\s+(?:music|house|techno|playlist)\b/i.test(input)) return true;
  return false;
}
