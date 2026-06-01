/**
 * Emotion engine — profiles, vibe parsing, scoring helpers.
 */

export {
  analyzeVibe,
  analyzeVibeWithContext,
  detectVibeKind,
  detectJourneyArc,
  generatePlaylistName,
  scoreSong,
  type EmotionProfile,
  type VibeKind,
} from "../../lib/emotion";
export { parseEmotionalDestination, type JourneyArc } from "../../lib/emotion-destination";
export { detectMixedEmotions } from "../../lib/multi-emotion";
