import type { PrimaryNarrative } from "./primary-narrative";

export interface ShareCard {
  title: string;
  subtitle: string;
  mood: string;
  previewTracks: string[];
}

/** Share identity derived only from primaryNarrative + track name list. */
export function buildShareCardFromNarrative(
  narrative: PrimaryNarrative,
  previewTrackNames: string[]
): ShareCard {
  return {
    title: narrative.momentLabel,
    subtitle: narrative.summary,
    mood: narrative.arcSummary,
    previewTracks: previewTrackNames
      .filter((n) => typeof n === "string" && n.trim().length > 0)
      .slice(0, 5),
  };
}
