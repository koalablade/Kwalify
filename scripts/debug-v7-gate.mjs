import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resolveCommittedWorld } = require("../backend/dist/core/committed-world");
const { evaluateWorldProof } = require("../backend/dist/core/editorial/world-proof-gate");
const { evaluateIntentFidelity } = require("../backend/dist/core/editorial/intent-fidelity-gate");

const c2 = resolveCommittedWorld({ prompt: "80s night drive" });
const tracks = [
  { trackId: "1", trackName: "Holocene", artistName: "Bon Iver", genreFamily: "indie", energy: 0.3 },
  { trackId: "2", trackName: "Blue Monday", artistName: "New Order", genreFamily: "electronic", energy: 0.62 },
];
const fidelity = evaluateIntentFidelity({ committed: c2, prompt: "80s night drive", requestedLength: 25, tracks });
console.log("fidelity", fidelity.openerPassed, fidelity.openerFailures);
const proof = evaluateWorldProof({ committed: c2, prompt: "80s night drive", requestedLength: 25, tracks });
console.log("proof", proof.trackOnePassed, proof.passed, proof.fidelity.openerFailures);
