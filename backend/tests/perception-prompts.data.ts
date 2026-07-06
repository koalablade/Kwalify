/** Fixed perception regression prompts — narrative layer only. */

export interface PerceptionSnapshotCase {
  prompt: string;
  identitySignature: string;
  clarityMin: number;
  clarityMax: number;
  momentLabel: string;
}

export const PERCEPTION_SNAPSHOT_CASES: PerceptionSnapshotCase[] = [
  {
    prompt: "late night drive alone on the motorway reflective",
    identitySignature: "74f76a7f50082290",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "quiet emotional reset",
  },
  {
    prompt: "2am petrol station fluorescent lonely",
    identitySignature: "b3cdffedd7802b75",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "lonely petrol 2am liminal",
  },
  {
    prompt: "rainy train home after work tired",
    identitySignature: "08b2507f1f2cb89b",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "tired rainy train home decompress",
  },
  {
    prompt: "hangover sunday morning gentle recovery",
    identitySignature: "8951cbbbdc3b14ae",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "positive hangover sunday",
  },
  {
    prompt: "getting ready to go out tonight hyped",
    identitySignature: "c7d4b3f1ab02110b",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "getting ready out energy",
  },
  {
    prompt: "study session focus no distractions",
    identitySignature: "5fad0d61d41cf54e",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "balanced study focus",
  },
  {
    prompt: "walk after breakup processing",
    identitySignature: "66cd0748c7d34ae5",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "quiet emotional reset",
  },
  {
    prompt: "morning coffee quiet before work",
    identitySignature: "3fc278aa95014fd2",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "morning coffee quiet positive energy",
  },
  {
    prompt: "gym workout training session",
    identitySignature: "0a33d33d6097e621",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "gym session energy",
  },
  {
    prompt: "cozy winter evening blanket tea",
    identitySignature: "3a83faa024a7a188",
    clarityMin: 86,
    clarityMax: 90,
    momentLabel: "positive winter evening cozy",
  },
];
