import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const JSON_PATH = resolve(ROOT, "reports/playlist-evaluation/v32-cross-world-pipeline-forensic-audit.json");
const MD_PATH = resolve(ROOT, "reports/playlist-evaluation/V32_CROSS_WORLD_PIPELINE_FORENSIC_AUDIT.md");

const payload = JSON.parse(readFileSync(JSON_PATH, "utf8"));

function median(arr) {
  const a = arr.filter((x) => typeof x === "number").sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const purityRetention = payload.rows
  .filter((r) => r.funnel.prePurity != null && r.funnel.postPurity != null && r.funnel.prePurity > 0)
  .map((r) => ({
    prompt: r.prompt,
    rate: r.funnel.postPurity / r.funnel.prePurity,
    pre: r.funnel.prePurity,
    post: r.funnel.postPurity,
  }));

payload.enhancedRetention = {
  prePurity_to_postPurity: {
    median: median(purityRetention.map((x) => x.rate)),
    min: Math.min(...purityRetention.map((x) => x.rate)),
    max: Math.max(...purityRetention.map((x) => x.rate)),
    n: purityRetention.length,
    worst: purityRetention.sort((a, b) => a.rate - b.rate).slice(0, 5),
  },
  composed_to_delivered: payload.rows
    .filter((r) => r.funnel.v3Composed != null && r.funnel.delivered != null && r.funnel.v3Composed > 0)
    .map((r) => ({ prompt: r.prompt, rate: r.funnel.delivered / r.funnel.v3Composed, composed: r.funnel.v3Composed, delivered: r.funnel.delivered })),
};

payload.rankedBottlenecks = [
  {
    rank: 1,
    bottleneck: "world_purity_gate position-tier filtering",
    evidence: `Median prePurity→postPurity retention ${payload.enhancedRetention.prePurity_to_postPurity.median?.toFixed(2)} across ${purityRetention.length} prompts. Worst: UK grime 25→2 (8%), rainy motorway 25→5 (20%), reggae 15→6 (40%). Score-62 cluster: ${payload.patternAnalysis.score62Rejections} rejections at identical score.`,
    affectedWorlds: purityRetention.filter((x) => x.rate < 0.5).map((x) => x.prompt),
    estimatedImpact: "Primary depth limiter on hard-lock and high-identity prompts after V3 composition",
    genericOrSpecific: "GENERIC — same applyWorldPurityGate tiers all worlds",
    confidence: "HIGH",
  },
  {
    rank: 2,
    bottleneck: "genre_evidence_guard (hard-lock worlds only)",
    evidence: "Reggae: 25→15 before purity (40% removal). Removes clearly wrong-world V3 picks (Arctic Monkeys, Black Keys). Only observable when pipelineAuthority records genre_evidence_guard stage.",
    affectedWorlds: ["sunset beach reggae"],
    estimatedImpact: "Secondary on hard-lock; mix of correct (I) and potential false-positive (G) rejections",
    genericOrSpecific: "GENERIC mechanism, magnitude varies by V3 composition quality",
    confidence: "MEDIUM-HIGH",
  },
  {
    rank: 3,
    bottleneck: "V3 composition vs survivor pool mismatch",
    evidence: `Median v3PreFilter→v3Composed retention ~0.25 when survivors>>25; V3 always composes ~25 but survivors vary 14–250.`,
    affectedWorlds: payload.rows.filter((r) => r.v3Composition?.notSelected > 10).map((r) => r.prompt).slice(0, 8),
    estimatedImpact: "Candidate loss before delivery gates; separate from purity",
    genericOrSpecific: "GENERIC",
    confidence: "MEDIUM",
  },
];

payload.hardLockVsSoft = {
  note: "committedWorld not exposed in audit JSON top-level; infer hard-lock behavior from genre_evidence_guard presence and purity loss magnitude",
  highPurityLoss: payload.rows.filter((r) => r.funnel.prePurity != null && r.funnel.postPurity != null && r.funnel.postPurity / r.funnel.prePurity < 0.35).map((r) => r.prompt),
  fullPurityPass: payload.rows.filter((r) => r.funnel.prePurity === r.funnel.postPurity).map((r) => r.prompt),
};

payload.finalVerdict =
  "Per-genre patching is the wrong architectural direction. Evidence shows GENERIC downstream compression: (1) world_purity_gate position-tier scores create a score-62 cliff rejecting world-adjacent but valid tracks; (2) genre_evidence_guard removes wrong-world V3 picks on hard-lock paths; (3) V3 composes ~25 regardless of survivor pool size. Next investigation: unified calibration between world_identity, genre_evidence, and purity tiers — not reggae-specific artist lists.";

writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2), "utf8");

let md = readFileSync(MD_PATH, "utf8");
const extra = `

## 4b. Pre-purity → post-purity retention (all prompts)

| Prompt | Pre-purity | Post-purity | Retention |
|---|---:|---:|---:|
${purityRetention.map((x) => `| ${x.prompt.slice(0, 35)} | ${x.pre} | ${x.post} | ${(x.rate * 100).toFixed(0)}% |`).join("\n")}

**Median retention:** ${(payload.enhancedRetention.prePurity_to_postPurity.median * 100).toFixed(0)}% | **Worst:** UK grime workout (8%)

## 4c. Hard-lock vs soft prompts (inferred)

High purity loss (<35% retention): ${payload.hardLockVsSoft.highPurityLoss.join("; ")}

Full purity pass (no position-filter loss): ${payload.hardLockVsSoft.fullPurityPass.join("; ")}
`;

if (!md.includes("## 4b.")) {
  md = md.replace("## 5. Candidate-level", extra + "\n## 5. Candidate-level");
  md = md.replace("## 17. Ranked causal bottlenecks", "## 17. Ranked causal bottlenecks (updated)\n");
  const rankSection = payload.rankedBottlenecks.map((b) =>
    `### RANK ${b.rank}\n- **Bottleneck:** ${b.bottleneck}\n- **Evidence:** ${b.evidence}\n- **Affected worlds:** ${b.affectedWorlds.slice(0, 6).join("; ")}\n- **Impact:** ${b.estimatedImpact}\n- **Generic/specific:** ${b.genericOrSpecific}\n- **Confidence:** ${b.confidence}\n`,
  ).join("\n");
  md = md.replace(/### RANK 1[\s\S]*?## 18\. What is NOT/, rankSection + "\n## 18. What is NOT");
  md = md.replace("## 21. Final verdict\n\nNext move is NOT", `## 21. Final verdict\n\n${payload.finalVerdict}\n\n_Original:_ Next move is NOT`);
}
writeFileSync(MD_PATH, md, "utf8");
console.log("V32 report enriched");
