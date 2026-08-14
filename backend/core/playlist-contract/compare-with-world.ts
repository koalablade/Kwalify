/**
 * Compare PlaylistContract vs CommittedWorld — detect information-loss disagreements.
 */

import type { CommittedWorld } from "../committed-world";
import { genreAlignsWithWorld } from "./world-gate";
import type { ContractDisagreement, PlaylistContract } from "./types";

export function compareContractWithWorld(
  contract: PlaylistContract,
  world: CommittedWorld | null,
): ContractDisagreement[] {
  const disagreements: ContractDisagreement[] = [];

  const contractWorldId = contract.worldHypothesis.id;
  const worldId = world?.id ?? null;

  if (contractWorldId && worldId && contractWorldId !== worldId) {
    disagreements.push({
      kind: "world_id_mismatch",
      contractValue: contractWorldId,
      worldValue: worldId,
      severity: "high",
      detail: `Contract world hypothesis "${contractWorldId}" differs from committed world "${worldId}"`,
    });
  }

  if (!world && contract.must.genres.length > 0 && contract.confidence.dimensions.genre! > 0.6) {
    disagreements.push({
      kind: "world_id_mismatch",
      contractValue: contract.must.genres[0]?.value ?? null,
      worldValue: null,
      severity: "critical",
      detail: "Contract has explicit genre but resolveCommittedWorld returned null",
    });
  }

  for (const genre of contract.must.genres.filter(
    (g) => g.confidence >= 0.6 && g.source !== "decomposed_scene" && !g.value.endsWith("-scene"),
  )) {
    if (world && worldId && !genreAlignsWithWorld(genre, world)) {
      disagreements.push({
        kind: "genre_family_mismatch",
        contractValue: genre.value,
        worldValue: worldId,
        severity: "critical",
        detail: `MUST genre "${genre.value}" does not align with committed world "${worldId}"`,
      });
    }
  }

  if (world?.hardLock && !contract.worldHypothesis.hardLock && contract.must.genres.length > 0) {
    disagreements.push({
      kind: "hard_lock_softened",
      contractValue: String(contract.worldHypothesis.hardLock),
      worldValue: String(world.hardLock),
      severity: "medium",
      detail: "World hardLock true but contract hypothesis is soft",
    });
  }

  if (world?.activityContext && contract.context.activity) {
    const normalizedActivity = contract.context.activity.replace(/_/g, " ");
    const worldActivity = world.activityContext.replace(/_/g, " ");
    if (
      normalizedActivity !== worldActivity &&
      !normalizedActivity.includes(worldActivity) &&
      !worldActivity.includes(normalizedActivity)
    ) {
      disagreements.push({
        kind: "activity_mismatch",
        contractValue: contract.context.activity,
        worldValue: world.activityContext,
        severity: "medium",
        detail: "Contract activity differs from world activityContext",
      });
    }
  }

  if (world?.musicalWorldId && world.musicalWorldId !== world.id) {
    const contractMusical = contract.worldHypothesis.musicalWorldId;
    if (contractMusical && contractMusical !== world.musicalWorldId) {
      disagreements.push({
        kind: "world_id_mismatch",
        contractValue: contractMusical,
        worldValue: world.musicalWorldId,
        severity: "high",
        detail: "Contract musicalWorldId differs from committed musicalWorldId",
      });
    }
  }

  for (const neg of contract.mustNot.filter((n) => n.hard)) {
    if (neg.kind === "genre" && worldId) {
      const genreFamily = neg.value;
      if (worldId.includes(genreFamily.replace(/_/g, "")) || worldId.includes(genreFamily)) {
        disagreements.push({
          kind: "negation_missing_in_world",
          contractValue: neg.value,
          worldValue: worldId,
          severity: "critical",
          detail: `MUST_NOT genre "${neg.value}" but world id "${worldId}" may include that genre`,
        });
      }
    }
  }

  if (contract.tension.length > 0 && world?.hardLock) {
    disagreements.push({
      kind: "tension_collapsed",
      contractValue: contract.tension.map((t) => t.description).join("; "),
      worldValue: worldId,
      severity: "critical",
      detail: "Contract preserves contradictory tensions but world collapsed to single hard lock",
    });
  }

  if (contract.unknown.tokens.length > 3 && world?.hardLock) {
    disagreements.push({
      kind: "unknown_tokens_ignored",
      contractValue: contract.unknown.tokens.slice(0, 5).join(", "),
      worldValue: worldId,
      severity: "high",
      detail: "Multiple unknown tokens ignored by world regex lock",
    });
  }

  return disagreements;
}

export function assessCollapseRisk(
  contract: PlaylistContract,
  disagreements: ContractDisagreement[],
): string {
  const critical = disagreements.filter((d) => d.severity === "critical").length;
  const high = disagreements.filter((d) => d.severity === "high").length;

  if (critical > 0 && contract.tension.length > 0) return "tension_world_collapse";
  if (!contract.worldHypothesis.id && contract.unknown.tokens.length > 2) return "no_world_many_unknowns";
  if (contract.worldHypothesis.hardLock && contract.mustNot.length > 0) return "hard_lock_with_negation";
  if (
    contract.worldHypothesis.musicalWorldId &&
    contract.worldHypothesis.activityContext &&
    contract.worldHypothesis.musicalWorldId !== contract.worldHypothesis.activityContext
  ) {
    return "musical_activity_tension";
  }
  if (critical > 0) return "critical_disagreement";
  if (high > 0) return "partial_parse";
  if (contract.unknown.tokens.length > 0) return "partial_parse";
  return "ok";
}
