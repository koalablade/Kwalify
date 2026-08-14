/**
 * Information-loss classification (A–M) — Phase 4 traces.
 * Maps pipeline stages to irreversible loss categories from audit.
 */

export type InformationLossClass =
  | "A_tokenisation"
  | "B_parallel_parser_divergence"
  | "C_world_collapse"
  | "D_intent_collapse_numeric"
  | "E_retrieval_prefilter"
  | "F_hybrid_pool_cap"
  | "G_v3_constraint_filter"
  | "H_v3_sampler_entropy"
  | "I_world_purity_gate"
  | "J_artist_cap"
  | "K_hqg_honest_partial"
  | "L_intent_fidelity_strip"
  | "M_negation_delivery_strip";

export type InformationLossTrace = {
  promptId: string;
  prompt: string;
  earliestLoss: InformationLossClass;
  lossChain: InformationLossClass[];
  detail: string;
  irreversibleAt: string;
  counterfactual: string | null;
};

const LOSS_STAGE_LABELS: Record<InformationLossClass, string> = {
  A_tokenisation: "Prompt tokenisation — unknown tokens discarded for world lock",
  B_parallel_parser_divergence: "Parallel parsers disagree — no SSOT merge",
  C_world_collapse: "resolveCommittedWorld — single id collapse",
  D_intent_collapse_numeric: "Intent collapse — nuance → numeric bands",
  E_retrieval_prefilter: "Retrieval prefilter — world/negation hard reject",
  F_hybrid_pool_cap: "Hybrid pool cap — library tail invisible to V3",
  G_v3_constraint_filter: "V3 constraint filter — hard reject",
  H_v3_sampler_entropy: "V3 sampler — ordering entropy",
  I_world_purity_gate: "World purity gate — off-world removal",
  J_artist_cap: "Artist cap — diversity truncation",
  K_hqg_honest_partial: "HQG honest partial — 40% cap",
  L_intent_fidelity_strip: "Intent fidelity strip — unverified tail dropped",
  M_negation_delivery_strip: "Negation delivery strip — hard remove",
};

export function classifyFailureFromV37Row(row: {
  id: string;
  prompt: string;
  category?: string;
  delivered?: number;
  requested?: number;
  v3Composed?: number;
  postPurity?: number;
  retrieval?: number;
  hqgOutcome?: string;
  hqgReason?: string;
}): InformationLossTrace {
  const requested = row.requested ?? 25;
  const delivered = row.delivered ?? 0;
  const composed = row.v3Composed ?? 0;
  const postPurity = row.postPurity ?? 0;
  const retrieval = row.retrieval ?? null;
  const lossChain: InformationLossClass[] = [];
  let earliest: InformationLossClass = "K_hqg_honest_partial";
  let detail = "";
  let irreversibleAt = "terminal";
  let counterfactual: string | null = null;

  const prompt = row.prompt.toLowerCase();

  if (/\bsad\b.*\bparty\b|\bparty\b.*\bsad\b/.test(prompt) || prompt.includes("sad party")) {
    lossChain.push("B_parallel_parser_divergence", "C_world_collapse", "K_hqg_honest_partial");
    earliest = "B_parallel_parser_divergence";
    detail = "Contradictory emotion+activity parsed separately then collapsed";
    irreversibleAt = "resolveCommittedWorld";
    counterfactual = "Contract tension preserve_both → honest partial with explanation";
  } else if (/\bnot\s+cheesy\b/.test(prompt) || /\bnot\s+boring\b/.test(prompt)) {
    lossChain.push("A_tokenisation", "G_v3_constraint_filter", "K_hqg_honest_partial");
    earliest = "A_tokenisation";
    detail = "Soft negation 'not cheesy/boring' has no persistent retrieval dimension";
    irreversibleAt = "intent-collapse-layer";
    counterfactual = "must_not: cheesy as contract axis at retrieval";
  } else if (retrieval != null && retrieval < 20 && postPurity < 10) {
    lossChain.push("E_retrieval_prefilter", "I_world_purity_gate", "K_hqg_honest_partial");
    earliest = "E_retrieval_prefilter";
    detail = `Retrieval ${retrieval} → purity cliff ${postPurity}`;
    irreversibleAt = "candidate-retrieval-pipeline";
    counterfactual = "World evidence expansion or contract-aware niche retrieval";
  } else if (composed < requested * 0.5) {
    lossChain.push("E_retrieval_prefilter", "F_hybrid_pool_cap", "I_world_purity_gate");
    earliest = "E_retrieval_prefilter";
    detail = `Thin compose pool ${composed}/${requested}`;
    irreversibleAt = "candidate-retrieval-pipeline";
    counterfactual = "Library-limited — honest partial with genre diagnosis";
  } else if (postPurity >= requested * 0.8 && delivered <= requested * 0.4) {
    lossChain.push("C_world_collapse", "K_hqg_honest_partial");
    earliest = "C_world_collapse";
    detail = `Full compose ${composed}, purity ${postPurity}, HQG cap → ${delivered}`;
    irreversibleAt = "human-quality-gate";
    counterfactual = "Contract audit replaces proxy coherence cap";
  } else if (row.category === "ambiguous" || row.category === "mood") {
    lossChain.push("C_world_collapse", "K_hqg_honest_partial");
    earliest = "C_world_collapse";
    detail = "Vague/mood prompt — soft HQG 40% cap";
    irreversibleAt = "resolveCommittedWorld";
    counterfactual = "Multi-label world hypothesis when confidence low";
  } else if (delivered >= requested * 0.6) {
    lossChain.push("C_world_collapse");
    earliest = "C_world_collapse";
    detail = "Partial success — minor world drift possible";
    irreversibleAt = "resolveCommittedWorld";
    counterfactual = null;
  } else {
    lossChain.push("K_hqg_honest_partial");
    earliest = "K_hqg_honest_partial";
    detail = row.hqgReason ?? "HQG honest partial cap";
    irreversibleAt = "human-quality-gate";
  }

  return {
    promptId: row.id,
    prompt: row.prompt,
    earliestLoss: earliest,
    lossChain,
    detail,
    irreversibleAt,
    counterfactual,
  };
}

export function lossClassLabel(cls: InformationLossClass): string {
  return LOSS_STAGE_LABELS[cls] ?? cls;
}

export function buildInformationLossReport(
  rows: Array<Parameters<typeof classifyFailureFromV37Row>[0]>,
): {
  traces: InformationLossTrace[];
  earliestLossCounts: Record<string, number>;
} {
  const traces = rows.map(classifyFailureFromV37Row);
  const earliestLossCounts: Record<string, number> = {};
  for (const t of traces) {
    earliestLossCounts[t.earliestLoss] = (earliestLossCounts[t.earliestLoss] ?? 0) + 1;
  }
  return { traces, earliestLossCounts };
}
