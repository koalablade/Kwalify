/**
 * Product UI view model — narrative and quality badges only.
 * Never read response.debugSignals from this module.
 */

import { primaryNarrativeFieldNames, UX_EMOTIONAL_RENDER_ORDER } from "./ux-schema.js";

function narrativeFromLegacyWhy(why) {
  if (!why) return null;
  return {
    momentLabel: why.dominantMomentLabel ?? "",
    summary: why.summary ?? "",
    arcSummary: why.structureExplanation ?? "",
  };
}

export function resolveUx(response) {
  const ux = response?.uxSignals;
  if (ux?.primaryNarrative) {
    return {
      hasUxSignals: true,
      primaryNarrative: ux.primaryNarrative,
      dominantMomentLabel: ux.primaryNarrative.momentLabel ?? ux.dominantMomentLabel ?? null,
      syncQualityLabel: ux.syncQualityLabel ?? null,
      syncQualityScore: ux.syncQualityScore ?? null,
      emotionalConsistencyScore: ux.emotionalConsistencyScore ?? null,
      emotionalConsistencyLabel: ux.emotionalConsistencyLabel ?? null,
      emotionalClarityScore: ux.emotionalClarityScore ?? null,
      emotionalClarityLabel: ux.emotionalClarityLabel ?? null,
      narrativeDriftWarning: ux.narrativeDriftWarning ?? null,
      shareCard: ux.shareCard ?? response?.shareCard ?? null,
    };
  }

  const primaryNarrative =
    narrativeFromLegacyWhy(response?.playlistWhy) ??
    (response?.dominantMomentLabel
      ? {
          momentLabel: response.dominantMomentLabel,
          summary: "",
          arcSummary: "",
        }
      : null);

  return {
    hasUxSignals: false,
    primaryNarrative,
    dominantMomentLabel: primaryNarrative?.momentLabel ?? null,
    syncQualityLabel: null,
    syncQualityScore: null,
    emotionalConsistencyScore: response?.emotionalConsistencyScore ?? null,
    emotionalConsistencyLabel: response?.emotionalConsistencyLabel ?? null,
    emotionalClarityScore: response?.emotionalClarityScore ?? null,
    emotionalClarityLabel: response?.emotionalClarityLabel ?? null,
    narrativeDriftWarning: null,
    shareCard: response?.shareCard ?? null,
  };
}

const EMOTIONAL_RENDER_ORDER = UX_EMOTIONAL_RENDER_ORDER;

function clarityBadgeMarkup(uxView, escapeHtml) {
  const label = uxView?.emotionalClarityLabel;
  const score = uxView?.emotionalClarityScore;
  if (!label && (score == null || !Number.isFinite(score))) return "";

  const text =
    label && score != null && Number.isFinite(score)
      ? `${label} (${Math.round(score)})`
      : label || String(score);

  return `<span class="quality-badge badge-clarity emotional-layer-clarity" title="Display-only emotional clarity">${escapeHtml(text)}</span>`;
}

/**
 * Strict emotional render contract — fixed order, no reordering:
 * momentLabel → summary → arcSummary → clarity badge
 */
export function renderEmotionalLayer(uxView, escapeHtml) {
  const n = uxView?.primaryNarrative ?? {};
  const slots = {
    momentLabel: n.momentLabel
      ? `<p class="primary-narrative-headline">${escapeHtml(n.momentLabel)}</p>`
      : "",
    summary: n.summary
      ? `<p class="primary-narrative-summary">${escapeHtml(n.summary)}</p>`
      : "",
    arcSummary: n.arcSummary
      ? `<p class="primary-narrative-arc">${escapeHtml(n.arcSummary)}</p>`
      : "",
    clarityBadge: clarityBadgeMarkup(uxView, escapeHtml),
  };

  const html = EMOTIONAL_RENDER_ORDER.map((key) => slots[key]).join("");
  if (!html) return "";

  return `<section class="emotional-layer primary-narrative" aria-label="Moment">${html}</section>`;
}

/** @deprecated use renderEmotionalLayer */
export function renderPrimaryNarrative(uxView, escapeHtml) {
  const n = uxView?.primaryNarrative;
  if (!n?.momentLabel && !n?.summary && !n?.arcSummary) return "";

  const headline = n.momentLabel
    ? `<p class="primary-narrative-headline">${escapeHtml(n.momentLabel)}</p>`
    : "";
  const summary = n.summary
    ? `<p class="primary-narrative-summary">${escapeHtml(n.summary)}</p>`
    : "";
  const arc = n.arcSummary
    ? `<p class="primary-narrative-arc">${escapeHtml(n.arcSummary)}</p>`
    : "";

  return `<section class="primary-narrative" aria-label="Moment">${headline}${summary}${arc}</section>`;
}

/** Optional product details — sync quality only; diagnostics live in debugSignals. */
export function renderSupportingDetails(uxView, escapeHtml) {
  const items = [];

  if (uxView?.syncQualityLabel) {
    const score =
      uxView.syncQualityScore != null && Number.isFinite(uxView.syncQualityScore)
        ? ` (${Math.round(uxView.syncQualityScore)})`
        : "";
    items.push(
      `<p class="ux-detail-sync">${escapeHtml(uxView.syncQualityLabel)}${escapeHtml(score)}</p>`
    );
  }

  if (!items.length) return "";

  return `<details class="ux-more-details">
    <summary>Details</summary>
    ${items.join("")}
  </details>`;
}

/** @deprecated use renderEmotionalLayer + renderSupportingDetails */
export function renderExplanationLayers(uxView, escapeHtml) {
  return `${renderEmotionalLayer(uxView, escapeHtml)}${renderSupportingDetails(uxView, escapeHtml)}`;
}

export function renderConsistencyBadge(uxView, escapeHtml) {
  const label = uxView.emotionalConsistencyLabel;
  const score = uxView.emotionalConsistencyScore;
  if (!label && (score == null || !Number.isFinite(score))) return "";

  const text =
    label && score != null && Number.isFinite(score)
      ? `${label} (${Math.round(score)})`
      : label || String(score);

  return `<span class="quality-badge badge-neutral" title="How cohesive the emotional arc feels">${escapeHtml(text)}</span>`;
}

export function renderClarityBadge(uxView, escapeHtml) {
  return clarityBadgeMarkup(uxView, escapeHtml);
}

export function renderShareCardHint(shareCard, escapeHtml) {
  if (!shareCard?.title) return "";
  return `<p class="share-card-hint" title="${escapeHtml(shareCard.subtitle || "")}">${escapeHtml(shareCard.title)}</p>`;
}

export function getEmotionalRenderOrder() {
  return [...EMOTIONAL_RENDER_ORDER];
}

export function getPrimaryNarrativeFieldNames() {
  return primaryNarrativeFieldNames();
}

/**
 * QA helper — simulates the first ~5s render (narrative + badges, no expanded details).
 * Not used in production render paths.
 */
export function simulateFirstImpressionState(uxView) {
  const n = uxView?.primaryNarrative;
  return {
    primaryNarrative: n
      ? {
          momentLabel: n.momentLabel ?? "",
          summary: n.summary ?? "",
          arcSummary: n.arcSummary ?? "",
        }
      : null,
    consistencyBadge: {
      label: uxView?.emotionalConsistencyLabel ?? null,
      score: uxView?.emotionalConsistencyScore ?? null,
    },
    clarityBadge: {
      label: uxView?.emotionalClarityLabel ?? null,
      score: uxView?.emotionalClarityScore ?? null,
    },
    hasExpandedDetails: false,
  };
}

/**
 * Strict first-impression purity — momentLabel, summary, clarity badge only.
 * QA tool; not used in production render paths.
 */
export function simulateFirstImpressionStrict(uxView) {
  const n = uxView?.primaryNarrative ?? {};
  return {
    momentLabel: n.momentLabel ?? "",
    summary: n.summary ?? "",
    clarityBadge: {
      label: uxView?.emotionalClarityLabel ?? null,
      score: uxView?.emotionalClarityScore ?? null,
    },
  };
}
