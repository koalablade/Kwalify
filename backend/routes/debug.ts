import { Router, type IRouter } from "express";
import { isLaunchMode } from "../lib/launch-mode";
import { db, likedSongsTable } from "../db";
import { eq } from "drizzle-orm";
import { analyzeMomentPipeline } from "../lib/moment-pipeline";
import { buildPlaylistWhySummary } from "../lib/playlist-why-summary";
import { sequencePlaylistEmotionally } from "../lib/emotional-sequencing";
import { pickPreviewMiniTracks } from "../lib/preview-mini";
import {
  computeEmotionalConsistencyBreakdown,
} from "../lib/emotional-consistency-score";
import { buildMomentAnalysisDebug } from "../lib/moment-analysis-debug";
import { sanitizeLikedSongs } from "../lib/library-sanitize";
import { decodeIntent } from "../lib/intent-decoder";
import { buildMomentUnderstanding } from "../lib/moment-understanding";
import { buildGenerationExplanation } from "../lib/vibe-explanation";
import { detectMixedEmotions } from "../lib/multi-emotion";
import { parseEmotionalDestination } from "../lib/emotion-destination";
import { scorePromptConfidence } from "../lib/prompt-confidence";
import { detectRediscoveryMode } from "../lib/forgotten-favourites";
import { computeSurpriseMix } from "../lib/human-surprise";
import { detectJourneyArc } from "../lib/emotion";

const router: IRouter = Router();

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

router.post("/debug/moment-analysis", async (req, res): Promise<void> => {
  if (isLaunchMode() || isProduction()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const vibeRaw = req.body?.vibe ?? "";
  const vibe = (typeof vibeRaw === "string" ? vibeRaw.trim() : String(vibeRaw).trim());
  if (!vibe) {
    res.status(400).json({ error: "vibe is required" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const momentPipeline = analyzeMomentPipeline(vibe, { moodSceneId: null });
  const mixedEmotions = detectMixedEmotions(vibe);
  const destParse = parseEmotionalDestination(vibe);
  const promptConfidence = scorePromptConfidence(vibe, momentPipeline.profile, {
    experienceSceneMatched: !!momentPipeline.experienceScene,
    hasJourneyDestination: !!destParse.desired,
    mixedEmotions,
  });

  const likedRowsRaw = await db
    .select()
    .from(likedSongsTable)
    .where(eq(likedSongsTable.spotifyUserId, userId))
    .limit(400);

  const { valid: likedSongs } = sanitizeLikedSongs(likedRowsRaw);
  const { tracks: miniTracks } = pickPreviewMiniTracks({
    userId,
    tracks: likedSongs,
    profile: momentPipeline.profile,
  });

  const sampleTracks = likedSongs
    .filter((t) => miniTracks.some((m) => m.trackId === t.trackId))
    .map((t) => ({
      ...t,
      score: 0.75,
    }));

  const sequenced = sequencePlaylistEmotionally(
    sampleTracks.length ? sampleTracks : likedSongs.slice(0, 12).map((t) => ({ ...t, score: 0.7 })),
    momentPipeline.profile.energy
  );

  const explanation = buildGenerationExplanation({
    profile: momentPipeline.profile,
    vibe,
    journeyArc: detectJourneyArc(vibe, momentPipeline.profile),
    experienceScene: momentPipeline.experienceScene,
    mixedEmotions,
    promptConfidence,
  });

  const momentUnderstanding = buildMomentUnderstanding({
    vibe,
    profile: momentPipeline.profile,
    journeyArc: detectJourneyArc(vibe, momentPipeline.profile),
    destParse,
    mixedEmotions,
    explanation,
    experienceScene: momentPipeline.experienceScene,
    librarySize: likedSongs.length,
    tracksSelected: sequenced.tracks.length,
    rediscoveryMode: detectRediscoveryMode(vibe),
    chapterLabel: null,
    surpriseMix: computeSurpriseMix({
      profile: momentPipeline.profile,
      vibe,
      rediscoveryMode: detectRediscoveryMode(vibe),
      archaeology: null,
      journeyArc: detectJourneyArc(vibe, momentPipeline.profile),
      mode: "balanced",
    }),
    archaeologyActive: false,
  });

  const playlistWhy = buildPlaylistWhySummary({
    momentUnderstanding,
    canonicalScene: momentPipeline.canonicalScene,
    emotionProfile: momentPipeline.profile,
    intent: momentPipeline.intent ?? decodeIntent(vibe),
    promptConfidenceTier: promptConfidence.tier,
    sequencePhases: sequenced.phases,
  });

  const consistency = computeEmotionalConsistencyBreakdown({
    tracks: sequenced.tracks.map((t) => ({
      energy: t.energy,
      score: t.score,
    })),
    sceneConfidence: playlistWhy.sceneConfidence,
    hasCanonicalScene: !!momentPipeline.canonicalScene?.sceneId,
  });

  const analysis = buildMomentAnalysisDebug({
    playlistWhy,
    phases: sequenced.phases,
    tracks: sequenced.tracks,
    consistency,
  });

  res.json({ vibe, analysis });
});

export default router;
