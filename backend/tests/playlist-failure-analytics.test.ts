import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCategoryReport,
  classifyPromptCategory,
  formatFailureAnalyticsReportMarkdown,
  hashPromptForAnalytics,
  hashUserIdForAnalytics,
} from "../lib/playlist-failure-analytics";

test("classifyPromptCategory maps functional prompts", () => {
  assert.equal(classifyPromptCategory("gym workout lifting", null), "gym");
  assert.equal(classifyPromptCategory("deep focus coding session", null), "focus");
  assert.equal(classifyPromptCategory("pregame before going out", null), "party");
  assert.equal(classifyPromptCategory("cozy sunday morning", null), "chill");
});

test("hash helpers are stable and anonymized", () => {
  const a = hashPromptForAnalytics("Gym workout");
  const b = hashPromptForAnalytics("gym workout");
  assert.equal(a, b);
  assert.notEqual(hashUserIdForAnalytics("user-a"), hashUserIdForAnalytics("user-b"));
});

test("buildCategoryReport computes liked-only success rate", () => {
  const report = buildCategoryReport("gym", [
    {
      id: 1,
      sessionId: "s1",
      userIdHash: null,
      eventType: "liked_only_success",
      promptCategory: "gym",
      activity: "gym",
      sceneId: null,
      promptHash: "p1",
      capabilityScore: 72,
      limitingFactors: [],
      retrievalStrategy: "A_liked_only",
      candidateQualityScore: 58,
      combinedConfidence: 65,
      userOutcome: null,
      linkedSessionId: null,
      createdAt: new Date(),
      outcomeRecordedAt: null,
    },
    {
      id: 2,
      sessionId: "s2",
      userIdHash: null,
      eventType: "library_insufficient",
      promptCategory: "gym",
      activity: "gym",
      sceneId: null,
      promptHash: "p2",
      capabilityScore: 28,
      limitingFactors: ["low_activity_match"],
      retrievalStrategy: "A_liked_only",
      candidateQualityScore: 22,
      combinedConfidence: 25,
      userOutcome: "discovery_accepted",
      linkedSessionId: "s3",
      createdAt: new Date(),
      outcomeRecordedAt: new Date(),
    },
    {
      id: 3,
      sessionId: "s3",
      userIdHash: null,
      eventType: "discovery_success",
      promptCategory: "gym",
      activity: "gym",
      sceneId: null,
      promptHash: "p2",
      capabilityScore: null,
      limitingFactors: [],
      retrievalStrategy: "D_spotify_catalogue",
      candidateQualityScore: null,
      combinedConfidence: null,
      userOutcome: null,
      linkedSessionId: "s2",
      createdAt: new Date(),
      outcomeRecordedAt: null,
    },
  ] as never);

  assert.equal(report.likedOnlyAttempts, 2);
  assert.equal(report.likedOnlySuccesses, 1);
  assert.equal(report.likedOnlySuccessRate, 0.5);
  assert.equal(report.discoveryAccepted, 1);
  assert.equal(report.discoveryAcceptedRate, 1);
  assert.equal(report.topLimitingFactors[0]?.factor, "low_activity_match");
});

test("formatFailureAnalyticsReportMarkdown includes category sections", () => {
  const md = formatFailureAnalyticsReportMarkdown({
    generatedAt: new Date().toISOString(),
    periodDays: 30,
    totalEvents: 2,
    byCategory: [{
      category: "gym",
      likedOnlyAttempts: 10,
      likedOnlySuccesses: 4,
      likedOnlySuccessRate: 0.4,
      libraryInsufficientFailures: 6,
      discoverySuccesses: 5,
      discoveryRequestedRate: 0.33,
      outcomesResolved: 5,
      discoveryAccepted: 4,
      discoveryRejected: 1,
      discoveryAcceptedRate: 0.8,
      discoveryRejectedRate: 0.2,
      regenerated: 1,
      abandoned: 0,
      pendingOutcome: 0,
      topLimitingFactors: [{ factor: "low_activity_match", count: 4, label: "Low activity match in liked songs" }],
    }],
    globalTopLimitingFactors: [],
  });
  assert.match(md, /Gym/);
  assert.match(md, /Liked-only success: 40%/);
});
