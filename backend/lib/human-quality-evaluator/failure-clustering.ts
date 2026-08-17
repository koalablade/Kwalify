/**
 * Cluster repeated failure classes across evaluated playlists.
 */

import type { EvaluatedPlaylist, FailureClass, FailureCluster, RootCauseConfidence } from "./types";

const CLASS_LABELS: Record<FailureClass, string> = {
  prompt_understanding: "Prompt understanding",
  compound_intent: "Compound intent",
  world_atmosphere: "World / atmosphere",
  genre: "Genre",
  mood: "Mood",
  taste: "Taste mismatch",
  retrieval: "Retrieval",
  candidate_admission: "Candidate admission",
  scoring: "Scoring",
  diversity: "Diversity",
  artist_repetition: "Artist repetition",
  sequencing: "Sequencing",
  tail: "Tail quality",
  underfill: "Underfill / partial delivery",
  spotify: "Spotify integration",
  ux: "UX / product",
  reliability: "Reliability",
  trust: "Trust / saveability",
  other: "Other",
};

function severityFor(count: number, humanCount: number): FailureCluster["severity"] {
  if (count >= 5 && humanCount >= 2) return "P1";
  if (count >= 3) return "P2";
  return "P3";
}

export function clusterFailures(playlists: EvaluatedPlaylist[]): FailureCluster[] {
  const buckets = new Map<
    FailureClass,
    { ids: string[]; human: number; auto: number; evidence: string[] }
  >();

  for (const p of playlists) {
    for (const fc of p.automated.failureClasses) {
      const b = buckets.get(fc.class) ?? { ids: [], human: 0, auto: 0, evidence: [] };
      b.ids.push(p.requestId);
      b.auto += 1;
      b.evidence.push(`${p.requestId}: ${fc.evidence}`);
      buckets.set(fc.class, b);
    }
    if (p.userFeedback?.verdict === "bad" || (p.humanReview?.overallHumanQuality ?? 5) <= 2) {
      const reasons = p.userFeedback?.reasons ?? [];
      for (const r of reasons) {
        const cls = mapReasonToClass(String(r));
        if (!cls) continue;
        const b = buckets.get(cls) ?? { ids: [], human: 0, auto: 0, evidence: [] };
        if (!b.ids.includes(p.requestId)) b.ids.push(p.requestId);
        b.human += 1;
        if (p.userFeedback?.opinion) b.evidence.push(`${p.requestId}: ${p.userFeedback.opinion}`);
        buckets.set(cls, b);
      }
    }
  }

  return [...buckets.entries()]
    .map(([failureClass, b]) => {
      const count = new Set(b.ids).size;
      const confidence: RootCauseConfidence =
        b.human >= 2 && count >= 3 ? "probable" : count >= 2 ? "possible" : "unknown";
      return {
        failureClass,
        count,
        severity: severityFor(count, b.human),
        exampleRequestIds: [...new Set(b.ids)].slice(0, 5),
        humanEvidenceCount: b.human,
        automatedEvidenceCount: b.auto,
        summary: CLASS_LABELS[failureClass],
        confidence,
      } satisfies FailureCluster;
    })
    .filter((c) => c.count >= 1)
    .sort((a, b) => b.count - a.count || b.humanEvidenceCount - a.humanEvidenceCount);
}

function mapReasonToClass(reason: string): FailureClass | null {
  const r = reason.toLowerCase();
  if (r.includes("tail") || r.includes("ending")) return "tail";
  if (r.includes("opening")) return "sequencing";
  if (r.includes("repeat") || r.includes("artist")) return "artist_repetition";
  if (r.includes("generic")) return "trust";
  if (r.includes("short")) return "underfill";
  if (r.includes("world") || r.includes("atmosphere")) return "world_atmosphere";
  if (r.includes("engine")) return "scoring";
  if (r.includes("ui") || r.includes("expectation")) return "ux";
  if (r.includes("taste")) return "taste";
  return "other";
}

export function repeatedFailureClasses(clusters: FailureCluster[]): FailureCluster[] {
  return clusters.filter((c) => c.count >= 2 || c.humanEvidenceCount >= 2);
}
