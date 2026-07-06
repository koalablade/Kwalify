import {
  resolveUx,
  renderEmotionalLayer,
  renderSupportingDetails,
  renderConsistencyBadge,
} from "./ux-view.js";

const root = document.getElementById("appRoot");

const SYNC_POLL_INTERVALS_MS = [2000, 3000, 5000, 8000];

const PREVIEW_DEBOUNCE_MS = 450;



const state = {

  lastVibe: "",

  lastPlaylistUrl: "",

  lastOutput: "",

  lastResultMeta: null,

  lastPlaylistWhy: null,

  lastFallbackExplanation: "",

  lastGenerateResponse: null,

  sync: null,

  syncPollTimer: null,

  syncPollStep: 0,

  previewTimer: null,

  preview: null,

  selectedSceneId: null,

  isRegenerate: false,

};



function escapeHtml(value) {

  return String(value ?? "").replace(/[&<>"']/g, (char) => ({

    "&": "&amp;",

    "<": "&lt;",

    ">": "&gt;",

    "\"": "&quot;",

    "'": "&#39;",

  })[char]);

}



async function api(path, options = {}) {

  const response = await fetch(`/api${path}`, {

    credentials: "include",

    headers: { "Content-Type": "application/json", ...(options.headers || {}) },

    ...options,

  });

  return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };

}



function stopSyncPoll() {

  if (state.syncPollTimer) {

    clearTimeout(state.syncPollTimer);

    state.syncPollTimer = null;

  }

}



function scheduleSyncPoll() {

  const step = Math.min(state.syncPollStep, SYNC_POLL_INTERVALS_MS.length - 1);

  const delay = SYNC_POLL_INTERVALS_MS[step];

  state.syncPollTimer = setTimeout(async () => {

    const sync = await refreshSyncStatus();

    if (sync?.isSynced || (!sync?.isSyncing && !sync?.isSynced)) {

      stopSyncPoll();

      renderApp(state.lastMessage || "");

      return;

    }

    if (sync?.isSyncing) {

      state.syncPollStep = Math.min(state.syncPollStep + 1, SYNC_POLL_INTERVALS_MS.length - 1);

    }

    scheduleSyncPoll();

  }, delay);

}



function startSyncPoll() {

  stopSyncPoll();

  state.syncPollStep = 0;

  scheduleSyncPoll();

}



async function fetchSyncStatus() {

  const response = await api("/spotify/cache-status");

  if (response.status === 401) return { needsLogin: true };

  if (!response.ok) return { error: response.data.error || "Could not load library sync status." };

  return { sync: response.data };

}



async function refreshSyncStatus() {

  const result = await fetchSyncStatus();

  if (result.needsLogin) {

    window.location.href = "/api/auth/login";

    return null;

  }

  if (result.error) {

    state.sync = null;

    return null;

  }

  state.sync = result.sync;

  return state.sync;

}



function confidenceLabel(tier) {

  if (tier === "high") return "High confidence match";

  if (tier === "medium") return "Medium confidence — adding interpretation";

  return "Low confidence — need more context";

}



function syncQualityText(sync) {

  const label = sync?.syncQualityLabel || "Partial";

  const score = Number(sync?.syncQualityScore ?? 0);

  return `Library quality: ${label}${Number.isFinite(score) ? ` (${Math.round(score)}%)` : ""}`;

}



function energyProfileLabel(band) {

  if (band === "low") return "Low energy";

  if (band === "high") return "High energy";

  return "Medium energy";

}



const SUGGESTION_CATEGORY_LABELS = {

  calm: "Calm",

  energetic: "Energetic",

  emotional: "Emotional",

  focus: "Focus",

};



function renderSuggestionChip(suggestion) {

  const text = typeof suggestion === "string" ? suggestion : suggestion?.text;

  const sceneId = typeof suggestion === "object" ? suggestion?.previewSceneId : "";

  if (!text) return "";

  const sceneAttr = sceneId ? ` data-scene-id="${escapeHtml(sceneId)}"` : "";

  return `<li><button type="button" class="suggestion-chip" data-suggestion="${escapeHtml(text)}"${sceneAttr}>${escapeHtml(text)}</button></li>`;

}



function isPromptReadyForGenerate(preview, vibe, playlistUrl, selectedSceneId) {

  if (String(playlistUrl || "").trim()) return true;

  if (selectedSceneId) return true;

  if (!preview?.requiresClarification) return true;

  const words = String(vibe || "").trim().split(/\s+/).filter(Boolean);

  return words.length >= 4;

}



function renderSuggestionGroups(preview) {

  const groups = preview?.intentClarificationGroups;

  const flat = preview?.intentClarificationSuggestions;

  if (!Array.isArray(flat) || !flat.length) return "";



  if (groups && typeof groups === "object") {

    return Object.entries(groups)

      .filter(([, list]) => Array.isArray(list) && list.length)

      .map(([category, list]) => `<div class="suggestion-group">

        <p class="suggestion-category">${escapeHtml(SUGGESTION_CATEGORY_LABELS[category] || category)}</p>

        <ul class="confidence-hints suggestion-list">${list.map(renderSuggestionChip).join("")}</ul>

      </div>`)

      .join("");

  }



  return `<ul class="confidence-hints suggestion-list">${flat.map(renderSuggestionChip).join("")}</ul>`;

}



function renderConfidencePanel(preview) {

  if (!preview?.promptConfidence) {

    return `<section class="confidence-panel" id="confidencePanel" hidden></section>`;

  }

  const tier = preview.promptConfidence.tier;

  const hints = Array.isArray(preview.promptConfidence.hints)

    ? preview.promptConfidence.hints.slice(0, 2).map((h) => `<li>${escapeHtml(h)}</li>`).join("")

    : "";

  const scene = preview.canonicalScene?.sceneId

    ? `<p class="sync-meta">Scene: ${escapeHtml(preview.canonicalScene.sceneId.replace(/_/g, " "))}</p>`

    : "";

  const suggestions =

    tier === "low" ? renderSuggestionGroups(preview) : "";

  const suggestionsBlock = suggestions

    ? `<div class="intent-suggestions"><p class="sync-meta">Try being more specific:</p>${suggestions}</div>`

    : "";

  const miniMoment = preview.dominantMomentLabel

    ? `<p class="why-moment-label">${escapeHtml(preview.dominantMomentLabel)}</p>`

    : "";

  const momentLine = preview.momentUnderstandingLine

    ? `<p class="moment-understanding-line">${escapeHtml(preview.momentUnderstandingLine)}</p>`

    : "";

  const referenceNudge = preview.suggestReferencePlaylist

    ? `<p class="sync-meta reference-nudge">Tip: paste a Spotify playlist link below to anchor the mood.</p>`

    : "";

  const clarificationBlock = preview.requiresClarification

    ? `<p class="sync-meta clarification-required">Add more detail, pick a suggestion, or use a reference playlist before generating.</p>`

    : "";

  const miniTracks =

    Array.isArray(preview.suggestedTracks) && preview.suggestedTracks.length

      ? `<ul class="mini-track-hints">${preview.suggestedTracks.map((t) => `<li>${escapeHtml(t.name)} — ${escapeHtml(t.artist)}</li>`).join("")}</ul>`

      : "";

  return `<section class="confidence-panel confidence-panel--${tier}" id="confidencePanel" aria-live="polite">

    <p class="confidence-title">${escapeHtml(confidenceLabel(tier))}</p>

    ${miniMoment}

    ${momentLine}

    ${referenceNudge}

    ${clarificationBlock}

    ${miniTracks}

    ${scene}

    ${hints ? `<ul class="confidence-hints">${hints}</ul>` : ""}

    ${suggestionsBlock}

  </section>`;

}



function renderSyncPanel(sync) {

  if (!sync) {

    return `<section class="sync-panel" aria-live="polite">

      <h2>Library Sync Status</h2>

      <p>Checking your Spotify library…</p>

    </section>`;

  }



  if (sync.isSyncing) {

    const progress = Number(sync.syncProgress ?? 0);

    return `<section class="sync-panel" aria-live="polite">

      <h2>Library Sync Status</h2>

      <p>Syncing your liked songs from Spotify…</p>

      <div class="sync-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">

        <div class="sync-progress-bar" style="width: ${progress}%"></div>

      </div>

      <p class="sync-meta">${progress}%${sync.totalTracks ? ` · ${Number(sync.totalTracks).toLocaleString()} tracks so far` : ""}</p>

    </section>`;

  }



  if (!sync.isSynced) {

    const detail = sync.syncError

      ? escapeHtml(sync.syncError)

      : "Your liked songs have not been synced yet. Log in and wait for the first sync to finish.";

    return `<section class="sync-panel sync-panel--blocked" aria-live="polite">

      <h2>Library Sync Status</h2>

      <p>${detail}</p>

      <button type="button" id="retrySyncButton" class="btn-secondary">Sync library</button>

    </section>`;

  }



  const coverage = Number(sync.featureCoverage ?? 0);

  const syncedAt = sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString() : "recently";

  const qualityLine = sync.syncQualityScore != null

    ? `<p class="sync-quality">${escapeHtml(syncQualityText(sync))}</p>`

    : "";



  return `<section class="sync-panel sync-panel--ready" aria-live="polite">

    <h2>Library Sync Status</h2>

    <p>Ready — ${Number(sync.totalTracks).toLocaleString()} liked songs synced (${coverage}% with audio features).</p>

    ${qualityLine}

    <p class="sync-meta">Last synced ${escapeHtml(syncedAt)}</p>

  </section>`;

}



function canGenerate(sync) {

  return !!sync?.isSynced && !sync?.isSyncing;

}



async function waitForIdleGenerate(maxWaitMs = 120_000) {

  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {

    const status = await api("/generate/status");

    if (status.ok && !status.data?.active) return true;

    await new Promise((resolve) => setTimeout(resolve, 2_000));

  }

  await api("/generate/cancel", { method: "POST", body: JSON.stringify({}) });

  await new Promise((resolve) => setTimeout(resolve, 500));

  const finalStatus = await api("/generate/status");

  return finalStatus.ok && !finalStatus.data?.active;

}



function schedulePreview(vibe) {

  if (state.previewTimer) clearTimeout(state.previewTimer);

  const trimmed = vibe.trim();

  if (trimmed.length < 3) {

    state.preview = null;

    const panel = document.getElementById("confidencePanel");

    if (panel) panel.hidden = true;

    return;

  }

  state.previewTimer = setTimeout(async () => {

    const response = await api("/generate/preview", {

      method: "POST",

      body: JSON.stringify({
        vibe: trimmed,
        mini: true,
        ...(state.selectedSceneId ? { sceneId: state.selectedSceneId } : {}),
      }),

    });

    if (!response.ok) return;

    state.preview = response.data;

    const panel = document.getElementById("confidencePanel");

    if (panel) {

      panel.outerHTML = renderConfidencePanel(state.preview);

      wireSuggestionChips();

    }

    const generateButton = document.getElementById("generateButton");

    if (generateButton) {

      generateButton.disabled = !isPromptReadyForGenerate(
        state.preview,
        trimmed,
        state.lastPlaylistUrl,
        state.selectedSceneId
      );

    }

  }, PREVIEW_DEBOUNCE_MS);

}



function renderApp(message = "") {

  state.lastMessage = message;

  const sync = state.sync;

  const generateEnabled = canGenerate(sync);

  const promptReady = isPromptReadyForGenerate(
    state.preview,
    state.lastVibe,
    state.lastPlaylistUrl,
    state.selectedSceneId
  );

  const submitEnabled = generateEnabled && promptReady;



  root.innerHTML = `<section>

    <h1>Kwalify</h1>

    ${renderSyncPanel(sync)}

    <form id="generateForm">

      <label for="vibeInput">Describe the moment</label>

      <textarea id="vibeInput" name="vibe" rows="3" required ${generateEnabled ? "" : "disabled"}>${escapeHtml(state.lastVibe)}</textarea>

      ${renderConfidencePanel(state.preview)}

      <label for="playlistUrl">Spotify reference playlist (optional)</label>

      <input id="playlistUrl" name="playlistUrl" type="url" autocomplete="off" value="${escapeHtml(state.lastPlaylistUrl)}" ${generateEnabled ? "" : "disabled"}>

      <button type="submit" id="generateButton" ${submitEnabled ? "" : "disabled"}>Generate</button>

    </form>

    ${!generateEnabled ? `<p class="sync-hint">Generate unlocks after your library finishes syncing.</p>` : ""}

    ${message ? `<p role="alert">${escapeHtml(message)}</p>` : ""}

  </section>`;



  const form = document.getElementById("generateForm");

  if (form && generateEnabled) {

    form.addEventListener("submit", generate);

  }



  const playlistInput = document.getElementById("playlistUrl");

  if (playlistInput) {

    playlistInput.addEventListener("input", (event) => {

      state.lastPlaylistUrl = event.currentTarget.value;

      const btn = document.getElementById("generateButton");

      if (btn) {

        btn.disabled = !isPromptReadyForGenerate(
          state.preview,
          state.lastVibe,
          state.lastPlaylistUrl,
          state.selectedSceneId
        );

      }

    });

  }



  const vibeInput = document.getElementById("vibeInput");

  if (vibeInput) {

    vibeInput.addEventListener("input", (event) => {

      state.selectedSceneId = null;

      schedulePreview(event.currentTarget.value);

    });

    if (state.lastVibe.trim().length >= 3) schedulePreview(state.lastVibe);

  }



  const retryBtn = document.getElementById("retrySyncButton");

  if (retryBtn) retryBtn.addEventListener("click", startLibrarySync);



  wireSuggestionChips();

}



function wireSuggestionChips() {

  document.querySelectorAll(".suggestion-chip").forEach((btn) => {

    btn.addEventListener("click", () => {

      const suggestion = btn.getAttribute("data-suggestion");

      const sceneId = btn.getAttribute("data-scene-id");

      const input = document.getElementById("vibeInput");

      if (input && suggestion) {

        input.value = suggestion;

        state.lastVibe = suggestion;

        state.selectedSceneId = sceneId || null;

        schedulePreview(suggestion);

      }

    });

  });

}



function renderLoading() {

  root.innerHTML = `<section>

    <h1>Kwalify</h1>

    ${renderSyncPanel(state.sync)}

    <p>Generating…</p>

  </section>`;

}



function qualityBadges(meta) {

  const badges = [];

  if (meta?.cached) badges.push({ text: "Cached result", className: "badge-neutral" });

  if (meta?.fastFallback) badges.push({ text: "Fallback mode (limited data)", className: "badge-warn" });

  if (meta?.spotifyPartial) badges.push({ text: "Partial Spotify data", className: "badge-warn" });

  if (meta?.spotifyUnavailable) badges.push({ text: "Spotify playlist unavailable", className: "badge-warn" });

  if (!meta?.fastFallback && !meta?.spotifyPartial && !meta?.spotifyUnavailable) {

    badges.unshift({ text: "Full quality", className: "badge-ok" });

  }

  return badges

    .map((b) => `<span class="quality-badge ${b.className}">${escapeHtml(b.text)}</span>`)

    .join("");

}



async function startLibrarySync() {

  const response = await api("/spotify/sync", { method: "POST", body: JSON.stringify({}) });

  if (response.status === 401) {

    window.location.href = "/api/auth/login";

    return;

  }

  await refreshSyncStatus();

  startSyncPoll();

  renderApp(response.data.message || "Sync started.");

}



async function generate(event) {

  event.preventDefault();



  const sync = await refreshSyncStatus();

  if (!canGenerate(sync)) {

    renderApp("Your library is still syncing. Please wait until sync completes.");

    if (sync?.isSyncing) startSyncPoll();

    return;

  }

  const slotReady = await waitForIdleGenerate();

  if (!slotReady) {

    renderApp("A playlist is still generating in another tab. Close other Kwalify tabs and try again.");

    return;

  }



  const form = event.currentTarget;

  const vibe = String(new FormData(form).get("vibe") || "").trim();

  const playlistUrl = String(new FormData(form).get("playlistUrl") || "").trim();

  if (!vibe) return;



  if (
    !isPromptReadyForGenerate(state.preview, vibe, playlistUrl, state.selectedSceneId)
  ) {

    renderApp(
      state.preview?.requiresClarification
        ? "Add more detail, pick a suggestion below, or paste a reference playlist."
        : "This prompt needs more context before generating."
    );

    return;

  }



  state.lastVibe = vibe;

  state.lastPlaylistUrl = playlistUrl;

  renderLoading();



  const body = {

    vibe,

    mode: "balanced",

    length: 25,

    ...(playlistUrl ? { referencePlaylist: playlistUrl } : {}),

    ...(state.selectedSceneId ? { sceneId: state.selectedSceneId } : {}),

    ...(state.isRegenerate ? { regenerate: true, varietyBoost: true } : {}),

  };

  state.isRegenerate = false;



  try {

    const response = await api("/generate", { method: "POST", body: JSON.stringify(body) });



    if (response.status === 401) {

      window.location.href = "/api/auth/login";

      return;

    }



    if (response.data.code === "LIBRARY_NOT_READY") {

      await refreshSyncStatus();

      if (state.sync?.isSyncing) startSyncPoll();

      renderApp(response.data.error || "Your library is not ready yet.");

      return;

    }

    if (response.data.code === "RATE_LIMITED" || response.data.code === "GENERATION_IN_PROGRESS") {
      const retrySec = Number(response.data.retry_after) || 5;
      renderApp(
        (response.data.error || "Please wait a moment.") +
          ` Retrying in ${retrySec}s…`
      );
      await new Promise((resolve) => setTimeout(resolve, retrySec * 1000));
      state.isRegenerate = body.regenerate === true;
      return generate(event);
    }



    if (response.data.code === "INSUFFICIENT_MATCHES") {
      renderApp(response.data.error || "Not enough tracks matched.");
      return;
    }

    if (response.data.code === "PROMPT_TOO_VAGUE") {
      state.preview = {
        ...state.preview,
        promptConfidence: response.data.promptConfidence || state.preview?.promptConfidence,
        requiresClarification: true,
        suggestReferencePlaylist: response.data.suggestReferencePlaylist ?? true,
        intentClarificationSuggestions: response.data.intentClarificationSuggestions,
        intentClarificationGroups: response.data.intentClarificationGroups,
      };
      renderApp(response.data.error || response.data.message || "Add more detail before generating.");
      return;
    }



    if (!response.ok || response.data.error) throw new Error(response.data.error || "Generation failed");



    const tracks = Array.isArray(response.data.tracks) ? response.data.tracks : [];

    const meta = {

      cached: !!response.data.cached,

      fastFallback: !!(response.data.fastFallback || response.data.code === "TIMEOUT_FALLBACK"),

      spotifyUnavailable: !!response.data.spotifyUnavailable,

      spotifyPartial: !!response.data.spotifyPartial,

    };

    state.lastResultMeta = meta;

    state.lastGenerateResponse = response.data;



    renderResult({

      name: response.data.playlistName || response.data.name || "Kwalify playlist",

      tracks,

      count: response.data.count || response.data.totalTracks || tracks.length,

      url: response.data.spotifyPlaylistUrl || response.data.playlistUrl || "",

      meta,

      response: response.data,

    });

  } catch (error) {

    renderApp(error.message || "Generation failed.");

  }

}



function renderTrackList(tracks) {

  if (!Array.isArray(tracks) || !tracks.length) return "";

  const items = tracks.map((track, index) => {

    const name = track.name || track.trackName || "Unknown track";

    const artist = track.artist || track.artistName || "Unknown artist";

    const reason = track.matchReasonLabel || track.matchReason || "";

    const strength = track.matchStrength != null ? Math.round(track.matchStrength * 100) : null;

    const tipParts = [reason, strength != null ? `${strength}% match` : ""].filter(Boolean);

    const tip = tipParts.join(" · ");

    return `<li class="track-line" title="${escapeHtml(tip)}">${index + 1}. ${escapeHtml(name)} — ${escapeHtml(artist)}</li>`;

  }).join("");

  return `<ul class="track-list" aria-label="Tracks with match hints">${items}</ul>`;

}



function renderResult(result) {

  const uxView = resolveUx(result.response || {});

  const momentLine = result.response?.momentUnderstandingLine
    ? `<p class="moment-understanding-line">${escapeHtml(result.response.momentUnderstandingLine)}</p>`
    : "";

  const output = buildOutput(result);

  state.lastOutput = output;

  root.innerHTML = `<section>

    <h1>${escapeHtml(result.name)}</h1>

    ${momentLine}

    ${renderEmotionalLayer(uxView, escapeHtml)}

    <div class="quality-badges" aria-label="Generation quality">${qualityBadges(result.meta)}${renderConsistencyBadge(uxView, escapeHtml)}</div>

    ${renderSupportingDetails(uxView, escapeHtml)}

    <h2>Generated Output</h2>

    ${renderTrackList(result.tracks)}

    <pre id="generatedOutput">${escapeHtml(output)}</pre>

    <button id="copyButton" type="button">Copy</button>

    <button id="againButton" type="button">Generate Again</button>

  </section>`;



  document.getElementById("copyButton").addEventListener("click", copyOutput);

  document.getElementById("againButton").addEventListener("click", () => {

    state.isRegenerate = true;

    boot();

  });

}



function buildOutput(result) {

  const lines = [result.name, `${Number(result.count || 0).toLocaleString()} tracks`];

  if (result.url) lines.push(result.url);

  result.tracks.forEach((track, index) => {

    const name = track.name || track.trackName || "Unknown track";

    const artist = track.artist || track.artistName || "Unknown artist";

    lines.push(`${index + 1}. ${name} - ${artist}`);

  });

  return lines.join("\n");

}



async function copyOutput() {

  await navigator.clipboard?.writeText(state.lastOutput);

}



async function boot() {

  renderApp();

  const result = await fetchSyncStatus();

  if (result.needsLogin) {

    window.location.href = "/api/auth/login";

    return;

  }

  if (result.error) {

    renderApp(result.error);

    return;

  }

  state.sync = result.sync;

  if (state.sync?.isSyncing) {

    startSyncPoll();

  } else if (!state.sync?.isSynced && !state.sync?.syncError) {

    await startLibrarySync();

  }

  renderApp();

}



boot();

