/**
 * Pre-build genre ontology at boot so first /generate does not block on cold ontology.
 */

import { buildGenreOntology, ontologyStats } from "./genre-ontology";
import { logger } from "./logger";

export function warmGenreOntologyAtBoot(): void {
  const t0 = Date.now();
  buildGenreOntology();
  const stats = ontologyStats();
  logger.info(
    { ms: Date.now() - t0, nodes: stats.nodeCount, edges: stats.edgeCount },
    "Genre ontology warmed at boot"
  );
}
