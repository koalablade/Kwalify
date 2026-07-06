/** Canonical emotional layer render order — keep in sync with ux-view.js */
export const UX_EMOTIONAL_RENDER_ORDER = [
  "momentLabel",
  "summary",
  "arcSummary",
  "clarityBadge",
] as const;

export type UxEmotionalRenderSlot = (typeof UX_EMOTIONAL_RENDER_ORDER)[number];
