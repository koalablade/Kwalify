/**
 * Discovery Mode (no-library / Spotify-wide) readiness helpers.
 */
import { buildLockedIntent } from "../core/v3/intent";

export type DiscoveryModeReadiness = {
  ready: boolean;
  genreFamilies: string[];
  primaryGenre: string | null;
  subgenreTerms: string[];
  detectedLabel: string | null;
  hint: string | null;
};

const DISCOVERY_HINT =
  "Discovery Mode needs a clear genre in your prompt — try indie rock, blues rock, UK garage, country, or house.";

const PHYSICAL_GARAGE_HINT =
  "Discovery Mode needs a music genre — your prompt sounds like a place (garage/workshop), not UK garage or garage rock. Add a genre like blues rock or indie rock.";

function humanizeGenreLabel(value: string): string {
  return value.replace(/_/g, " ").trim();
}

function buildDetectedLabel(
  primaryGenre: string | null,
  primarySubgenre: string | null,
  subgenreTerms: string[],
): string | null {
  const subgenre = primarySubgenre ?? subgenreTerms.find((term) => term.includes("_") || term.includes(" ")) ?? null;
  if (subgenre) return humanizeGenreLabel(subgenre);
  if (primaryGenre) return humanizeGenreLabel(primaryGenre);
  return null;
}

function discoveryHintForPrompt(vibe: string, genreFamilies: string[]): string | null {
  if (genreFamilies.length > 0) return null;
  const lower = vibe.toLowerCase();
  if (/\bgarage\b/i.test(lower) && /\b(?:car|cars|workshop|fixing|tools|welding|motor|motorbike)\b/i.test(lower)) {
    return PHYSICAL_GARAGE_HINT;
  }
  return DISCOVERY_HINT;
}

export function getDiscoveryModeReadiness(vibe: string): DiscoveryModeReadiness {
  const trimmed = vibe.trim();
  if (!trimmed) {
    return {
      ready: false,
      genreFamilies: [],
      primaryGenre: null,
      subgenreTerms: [],
      detectedLabel: null,
      hint: DISCOVERY_HINT,
    };
  }
  const locked = buildLockedIntent(trimmed);
  const genreFamilies = locked.genreFamilies ?? [];
  const subgenreTerms = locked.subgenreTerms ?? [];
  const ready = genreFamilies.length > 0;
  const primaryGenre = locked.primaryGenre ?? genreFamilies[0] ?? null;
  return {
    ready,
    genreFamilies,
    primaryGenre,
    subgenreTerms,
    detectedLabel: ready
      ? buildDetectedLabel(primaryGenre, locked.primarySubgenre ?? null, subgenreTerms)
      : null,
    hint: discoveryHintForPrompt(trimmed, genreFamilies),
  };
}

export function isDiscoveryModeRequest(noLibraryMode: boolean | undefined): boolean {
  return noLibraryMode === true;
}
