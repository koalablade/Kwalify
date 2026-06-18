/**
 * Backfill NULL audio features on liked_songs rows.
 *
 * Usage:
 *   SPOTIFY_ACCESS_TOKEN=... node backend/dist/scripts/audio-feature-backfill.js <spotify_user_id>
 */

import { backfillAudioFeaturesForUser } from "../lib/audio-feature-backfill-job";
import { logger } from "../lib/logger";

async function main(): Promise<void> {
  const userId = process.argv[2];
  const accessToken = process.env["SPOTIFY_ACCESS_TOKEN"];
  if (!userId || !accessToken) {
    console.error("Usage: SPOTIFY_ACCESS_TOKEN=... node audio-feature-backfill.js <spotify_user_id>");
    process.exit(2);
  }

  const result = await backfillAudioFeaturesForUser(userId, accessToken);
  console.log(JSON.stringify({ userId, ...result }));
}

main().catch((err) => {
  logger.error({ err }, "Audio feature backfill failed");
  process.exit(1);
});
