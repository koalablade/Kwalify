/** Mirrors backend PRIMARY_NARRATIVE_SCHEMA_VERSION — bump together. */
export const PRIMARY_NARRATIVE_SCHEMA_VERSION = 1;

export const UX_EMOTIONAL_RENDER_ORDER = [
  "momentLabel",
  "summary",
  "arcSummary",
  "clarityBadge",
];

export function primaryNarrativeFieldNames() {
  return ["momentLabel", "summary", "arcSummary"];
}
