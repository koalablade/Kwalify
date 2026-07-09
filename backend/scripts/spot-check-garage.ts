import { readFileSync } from "node:fs";
import path from "node:path";
import { PLAYLIST_BENCHMARK_PROMPTS } from "../lib/playlist-evaluation/benchmark-prompts";

async function main(): Promise<void> {
  const promptId = process.argv[2] ?? "drive-late-garage";
  const prompt = PLAYLIST_BENCHMARK_PROMPTS.find((p) => p.id === promptId);
  if (!prompt) throw new Error(`Unknown prompt ${promptId}`);

  const root = path.resolve(__dirname, "..", "..");
  const env = readFileSync(path.join(root, ".env"), "utf8");
  const token = env.match(/^PLAYLIST_EVAL_TOKEN=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";
  const user = env.match(/^SMOKE_SPOTIFY_USER_ID=(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";

  const res = await fetch("http://localhost:5000/api/generate?audit=1", {
    method: "POST",
    headers: { "content-type": "application/json", "x-kwalify-evaluation-token": token },
    body: JSON.stringify({
      vibe: prompt.prompt,
      mode: prompt.mode ?? "strict",
      length: prompt.length ?? 25,
      auditMode: true,
      debug: true,
      spotifyUserId: user,
    }),
  });
  const d = await res.json() as Record<string, unknown>;
  const g = (d.strictGenreEvidence ?? {}) as Record<string, unknown>;
  const fin = (d.finalization ?? {}) as Record<string, unknown>;
  console.log(JSON.stringify({
    promptId,
    count: d.count,
    verified: g.verifiedCount,
    required: g.requiredCount,
    baseRequired: g.baseRequiredCount,
    supplyCapped: g.supplyCapped,
    availableSupply: g.availableVerifiedSupply,
    partialPasses: g.partialVerificationPasses,
    partialScore: g.partialVerificationScore,
    reason: g.partialVerificationReason,
    publicationAction: fin.genreEvidencePublicationAction,
    publicationReason: fin.genreEvidencePublicationReason,
    publishedFromVerifiedV3: fin.publishedFromVerifiedV3Output,
    partialReason: fin.explicitConstraintPartialReason,
    v3Repair: fin.genreEvidenceV3RepairFillCount,
    postRepair: fin.genreEvidencePostRepairVerifiedCount,
    repairTarget: fin.genreAwareRepairTargetLength,
    adaptivePartialLimit: fin.adaptivePartialPublishLimit,
    adaptivePartialReason: fin.adaptivePartialPublishReason,
    honestPartialPublished: fin.honestPartialPublished === true,
    honestConstrainedPublished: fin.genreEvidenceHonestConstrainedPublished,
    honestConstrainedReason: fin.genreEvidenceHonestConstrainedReason,
    confidenceAwarePublished: fin.publishedFromConfidenceAwareOutput === true,
    confidenceAwareReason: fin.confidenceAwarePublicationReason,
    confidenceWeightedScore: fin.confidenceAwareWeightedScore,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
