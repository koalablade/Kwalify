// ── Kwalify · Single app entry point ─────────────────────────────────────────
import { esc, initTheme, fmtDateShort as fmtDate, spiBadge, toggleTheme, showToast, userFacingApiError, confirmDialog } from "../lib/shared.js";
import { loadUserPrefs, saveUserPref, markOnboardingDone } from "../lib/user-prefs.js";

initTheme();
const root = document.getElementById("appRoot");
const _savedPrefs = loadUserPrefs();

// ── Helpers ───────────────────────────────────────────────────────────────────
function trackGenreLabel(track) {
  return track?.genrePrimary ||
    track?.genreFamily ||
    (Array.isArray(track?.genres) && track.genres.length ? track.genres[0] : null) ||
    (track?.scoringDebug?.genrePrimary && track.scoringDebug.genrePrimary !== "unknown" ? track.scoringDebug.genrePrimary : null) ||
    (Array.isArray(track?.clusterIds)
      ? track.clusterIds.find((cluster) => typeof cluster === "string" && cluster.startsWith("genre:"))?.replace("genre:", "")
      : null) ||
    "(missing)";
}

function finalGenreDistributionEntries(result) {
  const diagnosticDistribution =
    result?.finalGenreDistribution ||
    result?.generationAuditSnapshot?.finalGenreDistribution;
  if (diagnosticDistribution && typeof diagnosticDistribution === "object") {
    const entries = Object.entries(diagnosticDistribution)
      .filter(([genre, count]) => genre && typeof count === "number" && count > 0)
      .sort((a, b) => b[1] - a[1]);
    const knownEntries = entries.filter(([genre]) => genre !== "(missing)" && genre !== "unknown");
    if (knownEntries.length) return knownEntries.slice(0, 10);
    if (entries.length) return entries.slice(0, 10);
  }

  const genreCount = {};
  (result?.tracks || []).forEach((track) => {
    const genre = trackGenreLabel(track);
    genreCount[genre] = (genreCount[genre] || 0) + 1;
  });
  return Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function backendDistributionEntries(result, field) {
  const diagnosticDistribution =
    result?.[field] ||
    result?.generationAuditSnapshot?.[field];
  if (!diagnosticDistribution || typeof diagnosticDistribution !== "object") return [];
  return Object.entries(diagnosticDistribution)
    .filter(([label, count]) => label && typeof count === "number" && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
}

function apiTimeoutForPath(path) {
  if (path.startsWith("/generate?") || path === "/generate") return 135_000;
  if (path.startsWith("/generate/status")) return 10_000;
  if (path.startsWith("/spotify/sync")) return 30_000;
  return 20_000;
}

async function api(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? apiTimeoutForPath(path));
  const externalSignal = opts.signal;
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }
  const { timeoutMs: _timeoutMs, signal: _signal, ...fetchOpts } = opts;
  try {
    const r = await fetch(`/api${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...fetchOpts,
      signal: controller.signal,
    });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternal);
  }
}

const feedbackSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const FEEDBACK_FORM_URL = "https://docs.google.com/forms/d/1rnIIbYPHB7qskyiHH1bvkFt8i2AGkWGeIZMrHFNi0P0/viewform";

function siteFooterHtml({ showBeta = true } = {}) {
  return `
  <footer class="app-footer site-footer">
    <div class="footer-left">
      <span class="footer-brand">© ${new Date().getFullYear()} Kwalify</span>
    </div>
    <div class="footer-right">
      ${showBeta ? '<span class="badge badge-muted">Beta</span>' : ""}
      <a href="/privacy" class="footer-link">Privacy</a>
      <a href="/terms" class="footer-link">Terms</a>
      <a href="${FEEDBACK_FORM_URL}" target="_blank" rel="noopener" class="footer-link">Feedback</a>
    </div>
  </footer>`;
}

function libraryGateState() {
  const cs = state.cacheStatus;
  const ls = state.librarySummary;
  return {
    syncing: !!cs?.isSyncing,
    total: ls?.trackCount || cs?.totalTracks || 0,
  };
}

function generateGate() {
  if (state.noLibraryMode) return { blocked: false, message: "" };
  const { syncing, total } = libraryGateState();
  if (syncing) return { blocked: true, message: "Your liked songs are syncing — generate unlocks when ready." };
  if (total === 0) return { blocked: true, message: "Sync your library first (nav → Sync new)." };
  return { blocked: false, message: "" };
}

function isPromptReadyForGenerate(preview, vibe, selectedSceneId) {
  if (selectedSceneId) return true;
  if (!preview?.requiresClarification) return true;
  const words = String(vibe || "").trim().split(/\s+/).filter(Boolean);
  return words.length >= 4;
}

function scrubLandingQueryParams() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("error") && params.get("gallery") !== "login") return;
  params.delete("error");
  params.delete("gallery");
  const qs = params.toString();
  history.replaceState({}, "", qs ? `?${qs}` : window.location.pathname);
}

function navLogoHtml() {
  return `<a href="/" class="nav-logo" style="text-decoration:none;color:inherit;"><div class="nav-logo-mark">K</div><span>Kwalify</span></a>`;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

function applyPendingPrompt() {
  try {
    const pending = localStorage.getItem("kwalify-pending-prompt");
    if (!pending) return;
    localStorage.removeItem("kwalify-pending-prompt");
    const input = document.getElementById("vibeInput");
    if (!input) return;
    input.value = pending;
    const count = document.getElementById("charCount");
    if (count) count.textContent = String(pending.length);
    updateMoodPanel(pending);
  } catch {
    // ignore storage errors
  }
}
let generationStatusTimer = null;
let generationUiTimer = null;
let generationStuckTimer = null;
let activeGenerationAbort = null;
let moodPreviewRequestId = 0;
let moodPreviewAbort = null;
let globalAppListenersWired = false;

function feedbackTrackPayload(track) {
  return {
    trackId: track?.trackId || track?.id,
    trackName: track?.trackName || track?.name || null,
    artistName: track?.artistName || track?.artist || null,
    albumName: track?.albumName || track?.album || null,
    genrePrimary: track?.genrePrimary || null,
    genreFamily: track?.genreFamily || null,
    genres: Array.isArray(track?.genres) ? track.genres : null,
    energy: typeof track?.energy === "number" ? track.energy : null,
  };
}

async function sendFeedbackEvent(track, action, playlistId = null, context = {}) {
  const payloadTrack = feedbackTrackPayload(track);
  if (!payloadTrack.trackId) return;
  await api("/feedback/track", {
    method: "POST",
    body: JSON.stringify({
      trackId: payloadTrack.trackId,
      action,
      playlistId: playlistId ? String(playlistId) : "",
      context,
      track: payloadTrack,
    }),
  });
}

async function sendImplicitFeedback(track, playDuration, skipped, eventType = null) {
  const payloadTrack = feedbackTrackPayload(track);
  if (!payloadTrack.trackId) return;
  await api("/feedback/implicit", {
    method: "POST",
    body: JSON.stringify({
      ...payloadTrack,
      playDuration,
      skipped,
      eventType,
      sessionId: feedbackSessionId,
    }),
  });
}

async function replacePlaylistTrack(playlistId, track, context = {}) {
  const payloadTrack = feedbackTrackPayload(track);
  if (!playlistId || !payloadTrack.trackId) return null;
  const result = await api(`/playlists/${playlistId}/replace-track`, {
    method: "POST",
    body: JSON.stringify({
      trackId: payloadTrack.trackId,
      vibe: context.vibe || "",
    }),
  });
  return result.ok ? result.data.replacement : null;
}

function timeAgo(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  } catch { return ""; }
}

function spi() {
  return spiBadge();
}

const RECENT_PROMPTS_KEY = "kwalify-recent-prompts";
const PROMPT_STEER_CHIPS = [
  { id: "more-energy", label: "More energy", promptSuffix: "more energy, keep the same world" },
  { id: "slower", label: "Slower", promptSuffix: "slower and calmer" },
  { id: "sadder", label: "Sadder", promptSuffix: "sadder, more isolated" },
  { id: "less-sad", label: "Less sad", promptSuffix: "less sad, still same scene" },
  { id: "new-mix", label: "New mix", action: "new-mix" },
];

function loadRecentPrompts() {
  try {
    const raw = localStorage.getItem(RECENT_PROMPTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string" && p.trim()).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function rememberRecentPrompt(prompt) {
  const trimmed = String(prompt || "").trim();
  if (!trimmed) return;
  const next = [trimmed, ...loadRecentPrompts().filter((p) => p.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
  state.recentPrompts = next;
  try { localStorage.setItem(RECENT_PROMPTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

function updateGenerationLivePreview() {
  const progress = state.generationProgress;
  if (!state.generating || !progress) {
    state.generationLivePreview = null;
    return;
  }
  const tracks = Array.isArray(progress.partialTracks) ? progress.partialTracks : [];
  if (!tracks.length) {
    state.generationLivePreview = null;
    return;
  }
  const target = state.length;
  const phase = progress.phase;
  const showEarly = tracks.length >= Math.min(target, Math.max(10, Math.floor(target * 0.4)))
    || phase === "spotify"
    || phase === "saving"
    || phase === "done"
    || progress.wrappingUp;
  if (!showEarly) {
    state.generationLivePreview = null;
    return;
  }
  const vibe = document.getElementById("vibeInput")?.value?.trim() || "";
  state.generationLivePreview = {
    playlistName: progress.playlistName || "Your playlist",
    tracks: tracks.map((t) => ({
      trackName: t.trackName,
      artistName: t.artistName,
      albumArt: t.albumArt,
      trackId: t.trackId,
    })),
    trackCount: tracks.length,
    spotifyPlaylistUrl: progress.spotifyPlaylistUrl || null,
    momentUnderstandingLine: progress.sceneLabel || null,
    vibe,
    _livePreview: true,
    _targetCount: target,
  };
}

function earlyResultHtml(preview) {
  if (!preview?.tracks?.length) return "";
  const count = preview.trackCount || preview.tracks.length;
  const target = preview._targetCount || state.length;
  return `
  <section class="early-result-card" aria-live="polite">
    <div class="early-result-head">
      <span class="badge badge-green">Tracks ready</span>
      <span class="early-result-meta">${count}${target > count ? ` of ~${target}` : ""} tracks · saving in background</span>
      ${preview.spotifyPlaylistUrl ? `<a href="${esc(preview.spotifyPlaylistUrl)}" target="_blank" rel="noopener" class="btn btn-green btn-sm">${spi()} Open in Spotify</a>` : ""}
    </div>
    ${preview.momentUnderstandingLine ? `<p class="moment-understanding-line">${esc(preview.momentUnderstandingLine)}</p>` : ""}
    <div class="tracks-list tracks-list--compact early-tracks-list">
      ${preview.tracks.slice(0, 12).map((t, i) => `
        <div class="track-row track-row--compact">
          <span class="track-num">${i + 1}</span>
          <div class="track-art">${t.albumArt ? `<img src="${esc(t.albumArt)}" alt="" loading="lazy">` : ""}</div>
          <div class="track-info">
            <div class="track-name">${esc(t.trackName || "Unknown track")}</div>
            <div class="track-artist">${esc(t.artistName || "Unknown artist")}</div>
          </div>
        </div>`).join("")}
    </div>
    ${count > 12 ? `<p class="early-result-more">+ ${count - 12} more on the way…</p>` : ""}
  </section>`;
}

function promptSteerChipsHtml(baseVibe) {
  const vibe = (baseVibe || "").trim();
  if (!vibe || state.generating) return "";
  return `
    <div class="prompt-steer-row" aria-label="Steer this playlist">
      <span class="prompt-steer-label">Steer it</span>
      ${PROMPT_STEER_CHIPS.map((chip) => `
        <button type="button" class="prompt-steer-chip" data-steer-id="${esc(chip.id)}" data-steer-action="${chip.action || ""}">
          ${esc(chip.label)}
        </button>`).join("")}
    </div>`;
}

function recentPromptsHtml() {
  const prompts = state.recentPrompts?.length ? state.recentPrompts : loadRecentPrompts();
  if (!prompts.length) return "";
  return `
    <div class="recent-prompts-row" id="recentPromptsRow">
      <span class="recent-prompts-label">Recent</span>
      ${prompts.slice(0, 5).map((p) => `
        <button type="button" class="recent-prompt-chip" data-recent-prompt="${esc(p)}">${esc(p.length > 42 ? `${p.slice(0, 39)}…` : p)}</button>
      `).join("")}
    </div>`;
}

// ── Reactive mood analyzer ────────────────────────────────────────────────────
function analyzeMoodFromText(text) {
  const t = text.toLowerCase();

  const energyPos = ['pump', 'intense', 'fast', 'driving fast', 'gym', 'party', 'hype', 'loud', 'metal', 'rave', 'dance', 'sprint', 'adrenaline', 'electric', 'fire', 'rage', 'rush', 'beat', 'bass', 'festival', 'crowd', 'power', 'speed', 'running', 'workout', 'club'];
  const energyNeg = ['sleep', 'calm', 'quiet', 'still', 'slow', 'haze', 'foggy', 'drift', 'twilight', 'soft', 'gentle', 'lull', 'rest', 'meditat', 'float', 'silence', 'serene', 'peaceful', 'lazy', 'ambient', 'hazy', 'muted'];

  const nostalgiaPos = ['old', 'classic', 'remember', 'childhood', 'past', 'back in', 'used to', 'miss', 'memories', 'nostalg', '80s', '90s', '2000s', '00s', 'retro', 'vintage', 'throwback', 'long ago', 'grew up', 'school days', 'young', 'simpler times', 'those days', 'back then', 'years ago'];

  const melancholyPos = ['sad', 'alone', 'lonely', 'miss', 'cry', 'empty', 'hollow', 'lost', 'grief', 'heartbreak', 'goodbye', 'ending', 'melanchol', 'grey', 'rain', 'somber', 'heavy', 'broken', 'hurt', 'pain', 'fog', 'dusk', 'ache', 'longing', 'distant', 'bittersweet', 'wistful', 'numb', 'dark'];

  const movementPos = ['drive', 'driving', 'walk', 'walking', 'road', 'highway', 'journey', 'wander', 'cruise', 'commute', 'train ride', 'bus', 'flight', 'moving', 'roam', 'miles', 'leaving', 'departure', 'going', 'pedal', 'cycling', 'run'];
  const movementNeg = ['still', 'sitting', 'stay', 'bedroom', 'room', 'bed', 'couch', 'window', 'waiting', 'seated', 'parked', 'static', 'stuck'];

  const warmthPos = ['warm', 'sunshine', 'summer', 'golden', 'cozy', 'comfort', 'love', 'together', 'friends', 'happy', 'joy', 'bright', 'glow', 'fireplace', 'home', 'family', 'afternoon', 'spring', 'laughter', 'beach', 'sunset', 'golden hour', 'sunlit'];
  const warmthNeg = ['cold', 'winter', 'ice', 'freeze', 'dark', 'shadow', 'grey', 'alone', 'empty', 'frost', 'bleak', 'harsh', 'midnight', 'desolate'];

  function scoreKeywords(pos, neg = []) {
    const posHits = pos.filter(w => t.includes(w)).length;
    const negHits = neg.filter(w => t.includes(w)).length;
    const base = 0.38 + (posHits * 0.14) - (negHits * 0.11);
    return Math.round(Math.max(5, Math.min(95, base * 100)));
  }

  const energy = scoreKeywords(energyPos, energyNeg);
  const nostalgia = scoreKeywords(nostalgiaPos);
  const melancholy = scoreKeywords(melancholyPos);
  const movement = scoreKeywords(movementPos, movementNeg);
  const warmth = scoreKeywords(warmthPos, warmthNeg);

  const tagMap = {
    "Late night": ["night", "midnight", "2am", "3am", "4am", "late", "after midnight", "insomnia", "1am", "dark hour"],
    "Urban": ["city", "street", "urban", "downtown", "metro", "subway", "building", "neon", "alley", "concrete", "skyscraper"],
    "Solitude": ["alone", "solo", "solitude", "lone", "myself", "quiet", "just me", "no one around", "by myself"],
    "Moving": ["drive", "driving", "walk", "highway", "road", "journey", "commute", "wander", "on the move"],
    "Nostalgic": ["remember", "memory", "past", "old", "miss", "used to", "childhood", "back when", "nostalg"],
    "Melancholic": ["sad", "melanchol", "cry", "heartbreak", "grief", "empty", "hollow", "broken", "numb"],
    "Euphoric": ["happy", "joy", "bliss", "ecstasy", "thrilled", "wonderful", "amazing", "elation"],
    "Rainy": ["rain", "storm", "grey", "cloudy", "wet", "drizzle", "downpour"],
    "Warm": ["warm", "golden", "sun", "summer", "bright", "sunshine", "cozy", "golden hour"],
    "Still": ["still", "quiet", "silent", "calm", "serene", "peaceful", "haze", "drift"],
  };

  const tags = Object.entries(tagMap)
    .filter(([, words]) => words.some(w => t.includes(w)))
    .map(([tag]) => tag)
    .slice(0, 5);

  let style = "Balanced, atmospheric";
  if (energy > 65 && movement > 55) style = "Fast-paced, driving, high momentum";
  else if (energy < 35 && melancholy > 50) style = "Slow, introspective, emotionally deep";
  else if (nostalgia > 55 && warmth > 50) style = "Warm, nostalgic, memory-soaked";
  else if (energy > 65) style = "High-energy, intense, forward-moving";
  else if (warmth > 62 && energy > 45) style = "Bright, feel-good, uplifting";
  else if (melancholy > 58) style = "Melancholic, cinematic, emotionally heavy";
  else if (energy < 30) style = "Soft, ambient, drifting";
  else if (movement > 60) style = "Road trip, rhythmic, open road";
  else if (nostalgia > 55) style = "Nostalgic, reminiscent, bittersweet";
  else style = "Layered, multi-dimensional, mood-focused";

  return {
    energy,
    nostalgia,
    melancholy,
    movement,
    warmth,
    tags: tags.length > 0 ? tags : ["Ambient"],
    style: `"${style}"`,
  };
}

// ── Single state store ────────────────────────────────────────────────────────
const state = {
  user: null,
  cacheStatus: null,
  librarySummary: null,
  playlists: [],
  history: [],
  libraryChapters: [],
  mode: _savedPrefs.mode,
  familiarity: _savedPrefs.familiarity,
  length: _savedPrefs.length,
  noLibraryMode: _savedPrefs.discoveryMode,
  generating: false,
  generationCancelRequested: false,
  generationRunId: 0,
  generationProgress: null,
  generationLivePreview: null,
  requestedNewMix: false,
  recentPrompts: [],
  partialPreviewStartedAt: null,
  lastResult: null,
  error: null,
  errorDetails: null,
  errorKind: null,
  pendingFailureSessionId: null,
  libraryInsufficient: null,
  failurePrompt: null,
  profileOpen: false,
  showDebug: false,
  showExplain: false,
  onboardingStep: 1,
  progressExpanded: false,
  preview: null,
  selectedSceneId: null,
  draftVibe: "",
};

function debugModeEnabled() {
  return new URLSearchParams(window.location.search).has("debug");
}

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function onToggleThemeClick() {
  toggleTheme({ iconElementId: "themeIcon" });
}

// ── Nav ───────────────────────────────────────────────────────────────────────
function navHtml(user) {
  const cs = state.cacheStatus;
  const ls = state.librarySummary;
  const syncing = cs?.isSyncing;
  const total = ls?.trackCount || cs?.totalTracks || 0;
  const lastSynced = cs?.lastSyncedAt ? timeAgo(cs.lastSyncedAt) : null;
  const syncPct = cs?.syncTotal && cs.syncProgress !== null && cs.syncProgress !== undefined
    ? Math.max(0, Math.min(100, Math.round((Number(cs.syncProgress) / Math.max(1, Number(cs.syncTotal))) * 100)))
    : null;
  const syncLabel = syncing
    ? `Syncing${syncPct !== null ? ` ${syncPct}%` : "…"}`
    : total > 0 ? `${total.toLocaleString()} tracks` : "Library";
  const initials = (user?.displayName || "U").charAt(0).toUpperCase();
  const avatar = user?.avatarUrl
    ? `<img src="${esc(user.avatarUrl)}" alt="">`
    : initials;
  const isDark = getTheme() === "dark";

  return `
  <nav class="nav" aria-label="Main navigation">
    ${navLogoHtml()}
    <button type="button" class="nav-menu-toggle" id="navMenuToggle" aria-expanded="false" aria-controls="navRight" aria-label="Open menu">☰</button>
    <div class="nav-right nav-right--collapsed" id="navRight">
      <a href="/gallery" class="nav-link">Gallery <span class="nav-link-arrow">→</span></a>
      <a href="/settings" class="nav-link">Settings</a>
      <div class="nav-library-panel">
        <button class="nav-sync-chip" id="syncChip" type="button" title="Delta sync (new likes only)">
          <span class="sync-dot ${syncing ? "sync-dot--live" : ""}"></span>
          <span>${syncLabel}</span>
          ${lastSynced ? `<small>updated ${esc(lastSynced)}</small>` : ""}
          ${syncing && syncPct !== null ? `<span class="nav-sync-progress"><span style="width:${syncPct}%"></span></span>` : ""}
        </button>
        <div class="nav-library-actions">
          <button id="deltaSyncBtn" class="section-action nav-sync-action" ${syncing ? "disabled" : ""}>${syncing ? "Syncing…" : "Sync new"}</button>
          <button id="fullSyncBtn" class="section-action nav-sync-action" ${syncing ? "disabled" : ""}>Full sync</button>
        </div>
      </div>
      <div class="nav-profile-wrap" id="profileWrap">
        <button class="nav-avatar-btn" id="profileBtn" type="button" title="Account"
          aria-haspopup="menu" aria-expanded="${state.profileOpen ? "true" : "false"}" aria-label="Account menu">
          <div class="nav-avatar">${avatar}</div>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--muted-2)"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="profile-dropdown ${state.profileOpen ? "open" : ""}" id="profileDropdown">
          <div class="profile-dropdown-header">
            <span class="profile-dropdown-name">${esc(user?.displayName || "")}</span>
          </div>
          <button class="profile-dropdown-item" id="settingsLinkBtn">
            <span>⚙️</span><span>Settings</span>
          </button>
          <button class="profile-dropdown-item" id="profileSyncBtn">
            <span>🔄</span><span>Sync library</span>
          </button>
          <button class="profile-dropdown-item" id="themeToggleBtn">
            <span id="themeIcon">${isDark ? "☀️" : "🌙"}</span>
            <span>${isDark ? "Light mode" : "Dark mode"}</span>
          </button>
          <div class="profile-dropdown-divider"></div>
          <button class="profile-dropdown-item profile-dropdown-logout" id="logoutBtn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>Log out</span>
          </button>
          <div class="profile-dropdown-divider"></div>
          <button class="profile-dropdown-item profile-dropdown-danger" id="deleteAccountBtn" type="button">
            <span>Delete my data</span>
          </button>
        </div>
      </div>
    </div>
  </nav>`;
}

// ── Landing page ──────────────────────────────────────────────────────────────
function authErrorMessage() {
  const error = new URLSearchParams(window.location.search).get("error");
  if (!error) return null;
  const messages = {
    access_denied: "Spotify login was cancelled, or your account isn't on the Kwalify allowlist yet. Ask the app owner to add your Spotify email in the Spotify Developer Dashboard → User Management.",
    no_code: "Spotify did not finish login. Please try connecting again.",
    session_failed: "Kwalify could not save your login session. Please try again.",
    auth_failed: "Spotify login failed. Please try again in a moment.",
  };
  return messages[error] || "Spotify login could not be completed. Please try again.";
}

function landingNoticeMessage() {
  const error = authErrorMessage();
  if (error) return { kind: "error", message: error };
  if (new URLSearchParams(window.location.search).get("gallery") === "login") {
    return { kind: "info", message: "Sign in with Spotify to view your saved playlists." };
  }
  return null;
}

function wireLandingEvents() {
  document.querySelectorAll("[data-hero-prompt]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-hero-prompt");
      if (!prompt) return;
      try { localStorage.setItem("kwalify-pending-prompt", prompt); } catch { /* ignore */ }
      window.location.href = "/api/auth/login";
    });
  });
  scrubLandingQueryParams();
}

function renderLanding(notice) {
  document.title = "Kwalify — Moment-to-Music from your liked songs";
  const landingNotice = notice
    ? { kind: "error", message: notice }
    : (state.errorKind === "auth" && state.error
      ? { kind: "error", message: state.error }
      : landingNoticeMessage());
  root.innerHTML = `
  <nav class="nav">
    ${navLogoHtml()}
    <div class="nav-right">
      <a href="/api/auth/login" class="btn btn-green btn-sm">${spi()} Connect Spotify</a>
    </div>
  </nav>

  <div class="landing-page">

    <section class="hero">
      <div class="hero-eyebrow">
        <span class="hero-eyebrow-dot"></span>
        Public beta · Playlists from your liked songs
      </div>
      <h1>What's the <em>moment</em>?</h1>
      <p class="hero-sub">Describe a feeling and get a playlist from songs you already love — or use optional discovery mode for genre prompts.</p>

      <div class="hero-demo">
        <div class="hero-demo-box">
          <div class="hero-demo-placeholder">empty petrol station at 2am<span class="hero-demo-cursor"></span></div>
        </div>
        <div class="hero-chips">
          <button type="button" class="hero-chip" data-hero-prompt="Driving somewhere you don't need to be">"Driving somewhere you don't need to be"</button>
          <button type="button" class="hero-chip" data-hero-prompt="Late night thinking about everything">"Late night thinking about everything"</button>
          <button type="button" class="hero-chip" data-hero-prompt="First warm day after winter">"First warm day after winter"</button>
          <button type="button" class="hero-chip" data-hero-prompt="Walking home after a good night">"Walking home after a good night"</button>
        </div>
      </div>

      ${landingNotice ? `<div class="alert ${landingNotice.kind === "error" ? "alert-error" : "alert-success"} landing-auth-alert">${esc(landingNotice.message)}</div>` : ""}
      <a href="/api/auth/login" class="btn btn-green btn-lg hero-cta">${spi()} Get started — free</a>
      <p class="landing-beta-note">Spotify may limit logins during beta until our app is fully approved. If Connect fails, try again later or contact us via Feedback.</p>
      <div class="hero-trust">
        <span>No credit card</span>
        <span class="hero-trust-sep">·</span>
        <span>Your library stays on our servers for sync</span>
        <span class="hero-trust-sep">·</span>
        <span>Shareable when you want</span>
      </div>
    </section>

    <section class="how-section">
      <div class="how-label">How it works</div>
      <h2 class="how-title">Three steps to your soundtrack</h2>
      <p class="how-sub">Default mode uses only your Liked Songs. Optional Discovery Mode can search Spotify broadly for clear genre prompts.</p>
      <div class="how-steps">
        <div class="how-step">
          <div class="how-step-num">Step 01</div>
          <div class="how-step-icon">🎵</div>
          <h3>Connect Spotify</h3>
          <p>We read your Liked Songs and sync metadata needed for playlist generation. We do not access your listening history or messages.</p>
        </div>
        <div class="how-step">
          <div class="how-step-num">Step 02</div>
          <div class="how-step-icon">💬</div>
          <h3>Describe the moment</h3>
          <p>One sentence. A time, a place, a feeling. As specific as you like.</p>
        </div>
        <div class="how-step">
          <div class="how-step-num">Step 03</div>
          <div class="how-step-icon">⚡</div>
          <h3>Get the playlist</h3>
          <p>A private playlist is built from your saved tracks with live progress while quality checks run.</p>
        </div>
      </div>
    </section>

    <section class="features-section">
      <div style="text-align:center;margin-bottom:32px;">
        <div class="how-label">Why Kwalify</div>
        <h2 class="how-title">Not Discover Weekly</h2>
      </div>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">🧠</div>
          <h3>Moment-aware scoring</h3>
          <p>Parses your scene into emotion, time, energy, and motion — then scores every liked track against all of it.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🎲</div>
          <h3>Strict · Balanced · Chaotic</h3>
          <p>Choose how closely the playlist matches your vibe. Balanced ensures artist variety and tempo diversity.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔒</div>
          <h3>Your library first</h3>
          <p>Default mode reads only your Liked Songs. Optional Discovery Mode searches Spotify for genre-specific prompts.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🎯</div>
          <h3>One prompt, done</h3>
          <p>Describe the moment, hit Generate, and get a shareable Spotify playlist without tuning settings.</p>
        </div>
      </div>
    </section>

    <section class="cta-section">
      <h2>Ready to hear it?</h2>
      <p>Connect Spotify, describe your first moment, and watch Kwalify build from your saved tracks.</p>
      <a href="/api/auth/login" class="btn btn-green btn-lg">${spi()} Connect with Spotify — free</a>
    </section>

  </div>
  ${siteFooterHtml()}`;
  wireLandingEvents();
}

const MOOD_BAR_DEFS = [
  { label: "Energy",    cls: "fill-blue",   id: "mb-energy",    key: "energy" },
  { label: "Nostalgia", cls: "fill-purple",  id: "mb-nostalgia", key: "nostalgia" },
  { label: "Melancholy",cls: "fill-indigo",  id: "mb-melancholy",key: "melancholy" },
  { label: "Movement",  cls: "fill-teal",    id: "mb-movement",  key: "movement" },
  { label: "Warmth",    cls: "fill-amber",   id: "mb-warmth",    key: "warmth" },
];

function moodLevelLabel(v) {
  return v > 70 ? "High" : v > 30 ? "Med" : "Low";
}

function intentClarificationChipsHtml() {
  const suggestions = state.preview?.intentClarificationSuggestions
    || state.errorDetails?.intentClarificationSuggestions;
  const groups = state.preview?.intentClarificationGroups
    || state.errorDetails?.intentClarificationGroups;
  let items = [];
  if (Array.isArray(suggestions) && suggestions.length) {
    items = suggestions;
  } else if (groups && typeof groups === "object") {
    items = Object.values(groups).flat();
  }
  if (!items.length) return "";
  const chips = items.map((s) => {
    const text = s?.text || "";
    if (!text) return "";
    const sceneId = s?.previewSceneId || "";
    return `<button type="button" class="recent-prompt-chip clarification-chip" data-clarification-prompt="${esc(text)}"${sceneId ? ` data-clarification-scene="${esc(sceneId)}"` : ""}>${esc(text.length > 42 ? `${text.slice(0, 39)}…` : text)}</button>`;
  }).filter(Boolean).join("");
  return chips
    ? `<div class="recent-prompts-row clarification-chips-row"><span class="recent-prompts-label">Try one of these:</span>${chips}</div>`
    : "";
}

function renderApp() {
  const existingVibe = document.getElementById("vibeInput");
  if (existingVibe) state.draftVibe = existingVibe.value;

  const cs = state.cacheStatus;
  const ls = state.librarySummary;
  const total = ls?.trackCount ?? cs?.totalTracks ?? 0;
  const lastSynced = cs?.lastSyncedAt ? timeAgo(cs.lastSyncedAt) : null;
  const modeHelperLabel = {
    strict: "Closest match",
    balanced: "Balanced variety",
    chaotic: "More surprise",
  }[state.mode] || "Balanced variety";
  const familiarityHelperLabel = {
    safe: "Mostly known tracks",
    balanced: "Mix of comfort and discovery",
    discovery: "More deep cuts",
  }[state.familiarity] || "Mix of comfort and discovery";
  const modeHelperText = `Vibe: ${modeHelperLabel} · Familiarity: ${familiarityHelperLabel}`;
  const gate = generateGate();

  const errorHtml = state.error ? (() => {
    // Server-busy / rate-limited: friendly, non-alarming, with a live countdown
    // and an immediate retry. The prompt is preserved in the input either way.
    if (state.errorKind === "busy") {
      const left = Math.max(0, Number(state.busySecondsLeft ?? 0));
      return `<div class="alert alert-warn">
        <strong>Server is busy right now</strong>
        <span>${esc(state.error)}</span>
        <div class="error-actions">
          <button type="button" class="btn btn-sm btn-green" id="busyRetryNowBtn">Retry now</button>
          <span class="error-hint">Auto-retrying in <span id="busyCountdown">${left}</span>s…</span>
        </div>
        <small class="error-hint">Your prompt is saved — nothing was lost.</small>
      </div>`;
    }
    const diagnostics = state.errorDetails?.generationDiagnostics || null;
    const suggestions = Array.isArray(state.errorDetails?.suggestions) ? state.errorDetails.suggestions : [];
    const isGenerationError = state.errorKind === "generation";
    const isLibraryInsufficient = state.libraryInsufficient?.code === "LIBRARY_INSUFFICIENT_FOR_PROMPT";
    const title = isLibraryInsufficient
      ? "Your liked songs aren’t enough for this prompt"
      : isGenerationError
        ? "Couldn’t finish that exact set."
        : "Something needs attention.";
    const fallbackSuggestion = state.errorKind === "status"
      ? "Your playlist may still be fine. Refresh if library counts look stale."
      : state.noLibraryMode
        ? "Try adding a clearer genre, or turn off Discovery Mode for mood-only prompts."
        : "Try again in a moment.";
    const limitingFactors = Array.isArray(state.libraryInsufficient?.limitingFactors)
      ? state.libraryInsufficient.limitingFactors
      : [];
    const diagHtml = diagnostics ? `
      <div class="error-diagnostics">
        <span>Library: ${Number(diagnostics.initialLibrarySize || 0).toLocaleString()}</span>
        <span>After filters: ${Number(diagnostics.candidatesAfterConstraints || 0).toLocaleString()}</span>
        <span>Final: ${Number(diagnostics.candidatesFinal || 0).toLocaleString()}</span>
      </div>` : "";
    const libraryInsufficientActions = isLibraryInsufficient ? `
        <div class="error-actions">
          <button type="button" class="btn btn-sm btn-green" id="tryDiscoveryModeBtn">Try Discovery Mode</button>
          <button type="button" class="btn btn-sm btn-ghost" id="refinePromptBtn">Refine your prompt</button>
          <button type="button" class="btn btn-sm btn-ghost" id="dismissLibraryInsufficientBtn">Dismiss</button>
        </div>
        <small class="error-hint">Discovery Mode searches all of Spotify — not just your liked songs.</small>
        ${limitingFactors.length ? `<small class="error-hint">Why: ${esc(limitingFactors.slice(0, 3).join(", ").replace(/_/g, " "))}</small>` : ""}
      ` : "";
    return `<div class="alert ${isLibraryInsufficient ? "alert-warn" : "alert-error"}">
        <strong>${esc(title)}</strong>
        <span>${esc(state.error)}</span>
        ${state.errorDetails?.requestId || state.pendingFailureSessionId ? `<small>Reference: ${esc(state.errorDetails?.requestId || state.pendingFailureSessionId)}</small>` : ""}
        ${libraryInsufficientActions}
        ${!isLibraryInsufficient && isGenerationError ? `<button type="button" class="btn btn-sm btn-green" id="retryGenerateBtn">Try again</button>` : ""}
        ${diagHtml}
        ${!isLibraryInsufficient && (suggestions.length ? `<small>${suggestions.map(esc).join(" · ")}</small>` : `<small>${esc(fallbackSuggestion)}</small>`)}
        ${intentClarificationChipsHtml()}
      </div>`;
  })() : "";

  const moodBarsHtml = MOOD_BAR_DEFS.map((b) => `
    <div class="mood-bar-row">
      <div class="mood-bar-labels">
        <span>${b.label}</span>
        <span class="mood-bar-level" id="${b.id}-label">—</span>
      </div>
      <div class="mood-track">
        <div class="mood-fill ${b.cls}" id="${b.id}" style="width:0%"></div>
      </div>
    </div>`).join("");
  const debugMoodPanelHtml = debugModeEnabled() ? `
      <!-- Debug-only live mood interpreter -->
      <div class="mood-col">
        <div class="mood-panel">
          <div class="mood-glow" id="moodGlow"></div>
          <div class="mood-head">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span id="moodStatus">Awaiting input…</span>
          </div>
          <div class="mood-bars">${moodBarsHtml}</div>
          <div class="mood-tags-wrap">
            <div class="mood-tags-label">Scene Tags</div>
            <div class="mood-tags-row" id="moodTags">
              ${["Late night","Urban","Solitude","Still"].map((t, i) =>
                `<span class="mood-tag" style="opacity:0.2;transition:opacity 0.5s ${i * 0.1}s">${t}</span>`
              ).join("")}
            </div>
          </div>
          <div class="mood-style">
            <div class="mood-style-label">Predicted Style</div>
            <div class="mood-style-text" id="moodStyleText" style="opacity:0">"Slow, atmospheric, late-night focused"</div>
          </div>
          <div class="mood-scene-panel" id="moodScenePanel" style="display:none">
            <div class="mood-scene-divider"></div>
            <div class="mood-scene-row">
              <div class="mood-scene-label">Detected Scene</div>
              <div class="mood-scene-name" id="moodSceneName"></div>
              <div class="mood-scene-badges" id="moodSceneBadges"></div>
            </div>
            <div class="mood-alts-row" id="moodAltsRow" style="display:none">
              <div class="mood-alts-label">Also matches</div>
              <div class="mood-alts" id="moodAlts"></div>
            </div>
          </div>
        </div>
      </div>` : "";

  root.innerHTML = `
  ${navHtml(state.user)}
  ${state.generating ? `<div class="generation-top-wrap">${generatingHtml()}</div>` : ""}

  <div class="app-wrap">

    ${errorHtml}

    ${state.libraryChapters?.length ? `<section class="library-chapters" aria-label="Life chapters from your library">
      <h2 class="section-title">Life chapters</h2>
      <div class="library-chapters-row">
        ${[...state.libraryChapters]
          .sort((a, b) => {
            const yearFrom = (entry) => {
              const match = String(entry.label || entry.id || "").match(/\d{4}/);
              return match ? Number(match[0]) : 0;
            };
            return yearFrom(b) - yearFrom(a);
          })
          .slice(0, 4)
          .map((ch) => `<button type="button" class="hero-chip library-chapter-chip" data-chapter-prompt="${esc(ch.label || ch.id)}">${esc(ch.label || ch.id)}</button>`).join("")}
      </div>
    </section>` : ""}

    <div class="input-grid ${debugModeEnabled() ? "" : "input-grid--single"}">

      <!-- Vibe input -->
      <div class="vibe-col">
        <div>
          <h1 class="vibe-heading">What's the moment?</h1>
          <p class="vibe-sub">Describe it and get a playlist from songs you already love.</p>
        </div>

        <div class="vibe-input-wrap">
          <div class="vibe-glow"></div>
          <div class="vibe-inner">
            <textarea
              id="vibeInput"
              class="vibe-textarea"
              placeholder="e.g. empty petrol station at 2am"
              maxlength="140"
              autocomplete="off"
              rows="2"
              aria-label="Describe your moment"
            ></textarea>
            <div class="vibe-footer">
              <span class="vibe-hint">Enter ↵ to generate · Ctrl+K focus</span>
              <span class="vibe-count"><span id="charCount">0</span>/140</span>
            </div>
          </div>
        </div>

        <div class="prompt-guide" aria-label="Prompt guidance">
          <span class="prompt-guide-label">Better prompts:</span>
          <span class="prompt-guide-chip">place</span>
          <span class="prompt-guide-chip">energy</span>
          <span class="prompt-guide-chip">era</span>
          <span class="prompt-guide-chip">who it's for</span>
          <span class="prompt-guide-example">e.g. garage with mates, upbeat 2000s, Saturday night</span>
        </div>
        <div id="intentPreviewStrip" class="intent-preview-strip" hidden aria-live="polite"></div>
        ${recentPromptsHtml()}

        <div class="controls-stack">
        <div class="controls-row controls-row--mode">
          <div class="mode-group">
            <button class="mode-btn ${state.mode === "strict"   ? "active" : ""}" data-mode="strict" title="Closest match, least drift" aria-pressed="${state.mode === "strict"}">Strict</button>
            <button class="mode-btn ${state.mode === "balanced" ? "active" : ""}" data-mode="balanced" title="Best quality and variety" aria-pressed="${state.mode === "balanced"}">Balanced</button>
            <button class="mode-btn ${state.mode === "chaotic"  ? "active" : ""}" data-mode="chaotic" title="More surprise, still safety-checked" aria-pressed="${state.mode === "chaotic"}">Chaotic</button>
          </div>
        </div>
        <div class="controls-row controls-row--length">
          <span class="length-label">Playlist size</span>
          <div class="length-row">
            <svg class="length-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <input type="range" class="length-slider" id="lengthSlider" min="20" max="60" step="5" value="${state.length}">
            <span class="length-val" id="lengthLabel">${state.length} tracks</span>
          </div>
        </div>
        </div>
        <div class="familiarity-row ${state.noLibraryMode ? "familiarity-row--disabled" : ""}" aria-label="Familiarity vs discovery within your library">
          <span class="familiarity-label">Familiarity</span>
          <div class="familiarity-group">
            <button class="familiarity-btn ${state.familiarity === "safe" ? "active" : ""}" data-familiarity="safe" title="Mostly known tracks" aria-pressed="${state.familiarity === "safe"}" ${state.noLibraryMode ? "disabled" : ""}>Safe</button>
            <button class="familiarity-btn ${state.familiarity === "balanced" ? "active" : ""}" data-familiarity="balanced" title="Comfort + discovery" aria-pressed="${state.familiarity === "balanced"}" ${state.noLibraryMode ? "disabled" : ""}>Balanced</button>
            <button class="familiarity-btn ${state.familiarity === "discovery" ? "active" : ""}" data-familiarity="discovery" title="More deep cuts" aria-pressed="${state.familiarity === "discovery"}" ${state.noLibraryMode ? "disabled" : ""}>Discovery</button>
          </div>
          ${state.noLibraryMode ? `<span class="familiarity-hint">Uses Spotify-wide search — familiarity applies to liked-songs mode only.</span>` : ""}
        </div>
        <div class="mode-helper">${esc(modeHelperText)}</div>

        <div class="no-library-row">
          <label class="no-library-toggle" title="Search all of Spotify for clear genre prompts">
            <div class="toggle-switch ${state.noLibraryMode ? "on" : ""}" id="noLibraryToggle" role="switch" tabindex="0" aria-checked="${state.noLibraryMode}" aria-label="Discovery Mode"></div>
            <div class="no-library-text">
              <span class="no-library-label">Discovery Mode</span>
              <span class="no-library-sub">Searches all of Spotify — include a genre (e.g. latin party, 90s garage). Less personalized than your liked songs.</span>
            </div>
          </label>
        </div>

        <p class="generation-time-hint" id="generationTimeHint">Large libraries may take 30–60 seconds. Stay on this page — you'll see tracks appear as they're picked.</p>

        ${gate.blocked ? `<p class="generate-gate-msg">${esc(gate.message)}</p>` : ""}
        <button id="generateBtn" class="gen-btn ${state.generating ? "loading" : ""}" ${gate.blocked || state.generating || !isPromptReadyForGenerate(state.preview, document.getElementById("vibeInput")?.value?.trim(), state.selectedSceneId) ? "disabled" : ""}>
          ${state.generating
            ? `<span class="spinner spinner--sm"></span> Generating…`
            : `Generate playlist <span class="btn-arrow">→</span>`}
        </button>
      </div>

      ${debugMoodPanelHtml}
    </div>

    <!-- Result -->
    ${state.generating && state.generationLivePreview ? earlyResultHtml(state.generationLivePreview) : ""}
    ${!state.generating && state.lastResult ? resultHtml(state.lastResult) : ""}

    ${state.user && (state.history?.length || state.playlists?.length) ? `
    <section class="activity-section" aria-label="Recent activity">
      <h2 class="section-title">Recent activity</h2>
      <div class="activity-feed">${buildActivityFeed()}</div>
    </section>` : ""}

  </div>

  ${onboardingOverlayHtml()}
  ${siteFooterHtml()}`;

  wireAppEvents();

  const vibeInput = document.getElementById("vibeInput");
  if (vibeInput) {
    vibeInput.value = state.draftVibe;
    const count = document.getElementById("charCount");
    if (count) count.textContent = String(state.draftVibe.length);
    if (state.draftVibe) updateMoodPanel(state.draftVibe);
  }
}

function buildActivityFeed() {
  // Merge recent history + recent playlists into a single chronological feed
  const items = [];

  // History items (moments)
  const histItems = state.history.slice(0, 5).map(h => ({
    type: "moment",
    label: h.vibe,
    date: h.createdAt || h.timestamp || "",
    extra: null,
  }));

  // Playlist items
  const plItems = state.playlists.slice(0, 6).map(p => ({
    type: "playlist",
    label: p.name,
    date: p.createdAt || "",
    count: Array.isArray(p.tracks) ? p.tracks.length : (p.trackCount || 0),
    spotifyUrl: p.spotifyUrl,
    id: p.id,
  }));

  // Interleave both, sorted by date descending
  const all = [...histItems, ...plItems]
    .filter(i => i.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (all.length === 0) {
    return `<p class="activity-empty">No activity yet — generate your first playlist.</p>`;
  }

  return all.slice(0, 10).map(item => {
    if (item.type === "moment") {
      return `
      <div class="activity-item activity-item--clickable" data-activity-moment="${esc(item.label)}" role="button" tabindex="0">
        <span class="activity-dot activity-dot--green"></span>
        <div class="activity-body">
          <div class="activity-label" style="font-style:italic">"${esc(item.label)}"</div>
          <div class="activity-meta">Moment · ${fmtDate(item.date)}</div>
        </div>
      </div>`;
    } else {
      return `
      <div class="activity-item">
        <span class="activity-dot activity-dot--purple"></span>
        <div class="activity-body">
          <div class="activity-label">${esc(item.label)}</div>
          <div class="activity-meta">${item.count} tracks · ${fmtDate(item.date)}</div>
        </div>
        <div class="activity-actions">
          ${item.spotifyUrl ? `<a href="${esc(item.spotifyUrl)}" target="_blank" rel="noopener" class="phase-open">${spi()}</a>` : ""}
          <button class="delete-btn" data-id="${item.id}" title="Delete">✕</button>
        </div>
      </div>`;
    }
  }).join("");
}

const GENERATION_STAGES = ["Initializing", "Retrieving candidates", "Ranking matches", "Diversity check", "Finalizing playlist"];
const GENERATION_PHASES = ["starting", "loading_library", "building_profile", "scoring", "composing", "spotify", "saving"];
const GENERATION_PHASE_COPY = {
  "Initializing": [
    "Starting the generator…",
    "Reading the prompt…",
    "Preparing the request…",
  ],
  "Retrieving candidates": [
    "Searching your library…",
    "Finding matching tracks…",
    "Checking genre and era evidence…",
  ],
  "Ranking matches": [
    "Ranking the strongest matches…",
    "Comparing energy, era, and genre fit…",
    "Filtering out obvious wrong turns…",
  ],
  "Diversity check": [
    "Checking artist spread…",
    "Smoothing the playlist flow…",
    "Applying quality checks…",
  ],
  "Finalizing playlist": [
    "Saving your playlist to Spotify…",
    "Locking in the final track order…",
    "Almost done…",
  ],
};
const GENERATION_LONG_RUNNING_COPY = [
  "Still curating — larger libraries take a moment.",
  "Quality checks are running on your matches.",
  "Building the strongest version of this playlist.",
  "Saving when everything looks right.",
];
const GENERATION_PARTIAL_READY_COPY = [
  "Tracks are locked in — saving to Spotify now.",
  "Playlist is taking shape in Spotify — finishing the last steps.",
  "Your matches are set — wrapping up the save.",
];

function generationElapsedMs(progressState = state.generationProgress || {}) {
  const startedAt = progressState.startedAt || Date.now();
  const clientStartedAt = progressState.clientStartedAt || startedAt;
  const serverElapsedMs = typeof progressState.elapsedMs === "number" ? progressState.elapsedMs : 0;
  return Math.max(
    serverElapsedMs,
    Date.now() - startedAt,
    Date.now() - clientStartedAt
  );
}

function generationTimingMessage(progressState, elapsedMs) {
  const phase = progressState?.phase;
  if (progressState?.wrappingUp || phase === "done") {
    return "Playlist saved — loading it here now.";
  }
  if (phase === "spotify") {
    return elapsedMs >= 45000
      ? "Spotify save is taking a moment — still working."
      : "Saving playlist to Spotify…";
  }
  if (phase === "saving") {
    return "Saving to your Kwalify library…";
  }
  if (progressState?.partialTracks?.length && elapsedMs >= 20000) {
    return "Tracks locked in — finishing the save.";
  }
  if (elapsedMs >= 75000) {
    return "Still finishing — you can cancel if this feels stuck.";
  }
  if (elapsedMs >= 45000) return "Still working. Large libraries can take a little longer.";
  if (elapsedMs >= 30000) return "Still working — quality checks are running.";
  if (progressState?.fallbackEligibleAt && Date.now() >= progressState.fallbackEligibleAt) {
    return "Quality checks are taking longer than usual.";
  }
  return "Working normally.";
}

function generationPreviewDetail(progressState, elapsedMs) {
  const partialCount = progressState?.partialTracks?.length || 0;
  const phase = progressState?.phase;
  if (partialCount > 0) {
    if (progressState?.wrappingUp || phase === "done") {
      return `${partialCount} tracks ready — opening your playlist`;
    }
    if (phase === "spotify" || phase === "saving") {
      return `${partialCount} tracks locked in — ${phase === "saving" ? "saving to Kwalify" : "saving to Spotify"}`;
    }
    if (elapsedMs >= 15000) {
      return `${partialCount} tracks matched — final checks running`;
    }
    return `${partialCount} tracks matched so far`;
  }
  const previewWaitingCopy = state.noLibraryMode
    ? ["Searching Spotify-wide matches", "Checking genre evidence", "Checking era evidence", "Scoring likely fits"]
    : ["Scanning your library", "Finding genre matches", "Scoring likely fits", "Building a shortlist"];
  return previewWaitingCopy[Math.floor(elapsedMs / 3500) % previewWaitingCopy.length];
}

function generationProgressInfo() {
  const phase = state.generationProgress?.phase || "starting";
  const stage = state.generationProgress?.stage || null;
  const stageLabel = stage || GENERATION_STAGES[Math.max(0, GENERATION_PHASES.indexOf(phase))] || "Initializing";
  const index = typeof state.generationProgress?.stageIndex === "number"
    ? state.generationProgress.stageIndex
    : Math.max(0, Math.min(GENERATION_STAGES.length - 1, GENERATION_PHASES.indexOf(phase)));
  const count = state.generationProgress?.stageCount || GENERATION_STAGES.length;
  const startedAt = state.generationProgress?.startedAt || Date.now();
  const elapsedMs = generationElapsedMs(state.generationProgress || {});
  const localStep = Math.min(
    count - 1,
    Math.floor(elapsedMs / 4500)
  );
  const previousDisplayIndex = typeof state.generationProgress?.displayIndex === "number"
    ? state.generationProgress.displayIndex
    : 0;
  const displayIndex = Math.max(index, previousDisplayIndex, state.generationProgress?.partialTracks?.length ? 3 : 0, localStep);
  if (state.generationProgress) state.generationProgress.displayIndex = displayIndex;
  const pct = state.generationProgress?.wrappingUp || state.generationProgress?.phase === "done"
    ? 98
    : Math.max(10, Math.min(96, Math.round(((displayIndex + 1) / count) * 100)));
  const displayTitle = state.noLibraryMode && displayIndex === 0 ? "Searching Spotify" : GENERATION_STAGES[displayIndex] || stageLabel;
  const partialCount = state.generationProgress?.partialTracks?.length || 0;
  const subtexts = state.noLibraryMode && displayIndex === 0
    ? ["Searching Spotify-wide matches…", "Checking genre and era evidence…", "Building a fresh candidate pool…"]
    : GENERATION_PHASE_COPY[displayTitle] || GENERATION_PHASE_COPY[stageLabel] || GENERATION_PHASE_COPY["Initializing"];
  const subIndex = Math.floor((Date.now() - startedAt) / 3200) % subtexts.length;
  const longRunDetail = elapsedMs >= 45000 && partialCount === 0
    ? GENERATION_LONG_RUNNING_COPY[Math.floor(elapsedMs / 8000) % GENERATION_LONG_RUNNING_COPY.length]
    : null;
  const partialReadyDetail = partialCount > 0 && displayIndex >= 3
    ? GENERATION_PARTIAL_READY_COPY[Math.floor(elapsedMs / 6000) % GENERATION_PARTIAL_READY_COPY.length]
    : null;
  const wrappingDetail = state.generationProgress?.wrappingUp || state.generationProgress?.phase === "done"
    ? "Loading your playlist here"
    : null;
  const detail = wrappingDetail
    || state.generationProgress?.stageDetail
    || partialReadyDetail
    || longRunDetail
    || subtexts[subIndex];
  return { title: displayTitle, serverTitle: stageLabel, sub: detail, pct, index: displayIndex, serverIndex: index, count };
}

function generatingHtml() {
  const progress = generationProgressInfo();
  const progressState = state.generationProgress || {};
  const elapsedMs = generationElapsedMs(progressState);
  const elapsedText = `${Math.max(0, Math.round(elapsedMs / 1000))}s elapsed`;
  const timingText = generationTimingMessage(progressState, elapsedMs);
  const previewText = generationPreviewDetail(progressState, elapsedMs);
  const showStuckHint = progressState?.stuckHint || elapsedMs >= 75000;
  const spotifyEarlyUrl = progressState?.spotifyPlaylistUrl || null;
  const spotifyEarlyHtml = spotifyEarlyUrl ? `
      <a href="${esc(spotifyEarlyUrl)}" target="_blank" rel="noopener" class="btn btn-green btn-sm generation-spotify-early">${spi()} Open in Spotify</a>` : "";
  const stuckHintHtml = showStuckHint ? `
      <div class="generation-stuck-hint" id="generationStuckHint">
        Taking longer than usual. <strong>Cancel</strong> stops this screen — your Spotify playlist may already exist.
      </div>` : "";
  const progressDetailsHtml = state.progressExpanded ? `
      <div class="generation-details-panel">
        <div><strong>Current work</strong><span id="generationDetailWork">${esc(progress.sub)}</span></div>
        <div><strong>Step</strong><span id="generationDetailPhase">${esc(progress.title)} · ${Math.min(progress.index + 1, progress.count)}/${progress.count}</span></div>
        <div><strong>Timing</strong><span id="generationDetailTiming">${esc(elapsedText)} · ${esc(timingText)}</span></div>
        <div><strong>Preview</strong><span id="generationDetailPreview">${esc(previewText)}</span></div>
      </div>` : "";
  const buildBarHtml = `
      <div class="dj-live-stage" aria-live="polite">
        <span class="dj-live-icon">▶</span>
        <span class="dj-live-label" id="generationStageLabel">${esc(progress.title)}</span>
        <span class="dj-live-count" id="generationStageCount">${Math.min(progress.index + 1, progress.count)} / ${progress.count}</span>
      </div>`;
  const partialTracks = Array.isArray(state.generationProgress?.partialTracks)
    ? state.generationProgress.partialTracks
    : [];
  const elapsedSincePreview = state.partialPreviewStartedAt ? Date.now() - state.partialPreviewStartedAt : 0;
  const visiblePartialCount = partialTracks.length <= 5
    ? partialTracks.length
    : Math.min(partialTracks.length, 5 + Math.floor(elapsedSincePreview / 800) * 6);
  const visiblePartialTracks = partialTracks.slice(0, visiblePartialCount);
  const addingTracks = partialTracks.length > visiblePartialTracks.length;
  const partialHtml = visiblePartialTracks.length ? `
      <div class="generating-partials">
        <div class="generating-partials-head">
          Previewing ${visiblePartialTracks.length} likely track${visiblePartialTracks.length === 1 ? "" : "s"}
          ${addingTracks ? `<span class="adding-tracks">adding tracks…</span>` : ""}
        </div>
        ${visiblePartialTracks.map((track, i) => `
          <div class="generating-track">
            <span class="generating-track-num">${i + 1}</span>
            <div class="generating-track-art">${track.albumArt ? `<img src="${esc(track.albumArt)}" alt="" loading="lazy">` : ""}</div>
            <div class="generating-track-meta">
              <div class="generating-track-name">${esc(track.trackName || "Unknown track")}</div>
              <div class="generating-track-artist">${esc(track.artistName || "Unknown artist")}</div>
            </div>
          </div>
        `).join("")}
      </div>` : "";
  return `
  <div class="generating-card">
    <span class="spinner spinner--purple"></span>
    <div class="generating-body">
      <div class="generating-head">
        <div class="generating-head-copy">
          <div class="generating-title" id="generationTitle">${esc(progress.sub)}</div>
          <div class="generating-sub" id="generationSub">${esc(timingText)}</div>
          ${progressState?.sceneLabel ? `<div class="generating-scene">${esc(progressState.sceneLabel)}</div>` : ""}
        </div>
        <div class="generating-head-actions">
          ${spotifyEarlyHtml}
          <button class="generation-cancel-btn" id="cancelGenerationBtn" type="button" data-action="cancel-generation" ${state.generationCancelRequested ? "disabled" : ""}>
            ${state.generationCancelRequested ? "Cancelling..." : "Cancel"}
          </button>
        </div>
      </div>
      ${state.progressExpanded ? buildBarHtml : ""}
      ${stuckHintHtml}
      <button class="generation-details-toggle" id="progressDetailsToggle" type="button">
        ${state.progressExpanded ? "Hide details" : "More detail"}
      </button>
      ${progressDetailsHtml}
      ${debugModeEnabled() ? `<div class="generation-safety-chip">Excluded: Christmas / holiday tracks unless requested</div>` : ""}
      <div class="generating-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.pct}" aria-label="Playlist generation progress">
        <div class="generating-progress-fill" id="generationProgressFill" style="width:${progress.pct}%"></div>
      </div>
      ${state.generationLivePreview ? "" : partialHtml}
    </div>
  </div>`;
}

function refreshGenerationProgressDom() {
  if (!state.generating || !state.generationProgress) return;
  const progress = generationProgressInfo();
  const progressState = state.generationProgress || {};
  const elapsedMs = generationElapsedMs(progressState);
  const elapsedText = `${Math.max(0, Math.round(elapsedMs / 1000))}s elapsed`;
  const timingText = generationTimingMessage(progressState, elapsedMs);
  const previewText = generationPreviewDetail(progressState, elapsedMs);
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("generationTitle", progress.sub);
  setText("generationSub", timingText);
  setText("generationStageLabel", progress.title);
  setText("generationStageCount", `${Math.min(progress.index + 1, progress.count)} / ${progress.count}`);
  setText("generationDetailWork", progress.sub);
  setText("generationDetailPhase", `${progress.title} · ${Math.min(progress.index + 1, progress.count)}/${progress.count}`);
  setText("generationDetailTiming", `${elapsedText} · ${timingText}`);
  setText("generationDetailPreview", previewText);
  const fill = document.getElementById("generationProgressFill");
  if (fill) fill.style.width = `${progress.pct}%`;
  const progressBar = fill?.closest('[role="progressbar"]');
  if (progressBar) progressBar.setAttribute("aria-valuenow", String(progress.pct));
}

function flattenIntentConcepts(intent) {
  const concepts = intent?.recognizedConcepts;
  if (!concepts) return [];
  return [
    ...(concepts.activity || []),
    ...(concepts.atmosphere || []),
    ...(concepts.emotion || []),
    ...(concepts.time || []),
    ...(concepts.place || []),
    ...(concepts.genre || []),
    ...(concepts.era || []),
  ].filter(Boolean).slice(0, 8);
}

function buildSegmentStripHtml(segmentDiagnostics) {
  if (!Array.isArray(segmentDiagnostics) || segmentDiagnostics.length === 0) return "";
  const chips = segmentDiagnostics.map((seg) =>
    `<span class="segment-chip" title="${esc((seg.trackIds || []).length ? (seg.trackIds.length + " tracks") : "journey phase")}">${esc(seg.label || seg.segmentId)}</span>`,
  ).join("");
  const energies = segmentDiagnostics.map((seg, i) => {
    const e = typeof seg.energy === "number" ? seg.energy : (typeof seg.avgEnergy === "number" ? seg.avgEnergy : (i + 1) / segmentDiagnostics.length);
    return Math.max(0.08, Math.min(1, e));
  });
  const arcBars = energies.map((h, i) =>
    `<div class="arc-bar" style="height:${Math.round(h * 100)}%" title="${esc(segmentDiagnostics[i]?.label || `Phase ${i + 1}`)}"></div>`,
  ).join("");
  return `<div class="segment-strip-wrap" aria-label="Playlist journey">
    <div class="playlist-arc" aria-hidden="true">${arcBars}</div>
    <div class="segment-strip">${chips}</div>
  </div>`;
}

function buildThinLibraryDetailHtml(result) {
  const policy = result?.thinLibraryPolicy || result?.generationTrust?.thinLibraryPolicy;
  if (!policy) return "";
  const factors = []
    .concat(policy.limitingFactors || [])
    .concat(policy.genreConstraints || [])
    .concat(policy.blockedGenres || [])
    .filter(Boolean)
    .map((f) => String(f).replace(/_/g, " "));
  const unique = [...new Set(factors)].slice(0, 4);
  if (!unique.length && !policy.maxAchievable) return "";
  const achievable = policy.maxAchievable != null ? ` · ~${policy.maxAchievable} tracks achievable` : "";
  return `<div class="thin-library-detail" role="note">
    <strong>Why not a full playlist?</strong>
    ${unique.length ? ` Limited by: ${unique.map(esc).join(", ")}.` : ""}
    ${achievable}
    ${policy.outcome ? ` (${esc(String(policy.outcome).replace(/_/g, " "))})` : ""}
  </div>`;
}

function onboardingOverlayHtml() {
  if (_savedPrefs.onboardingDone || !state.user) return "";
  const step = state.onboardingStep || 1;
  const steps = [
    { title: "Connect Spotify", body: "You're in — Kwalify uses your liked songs as the source of truth." },
    { title: "Sync your library", body: "Tap Sync new in the nav so Kwalify knows your tracks. First sync may take a minute." },
    { title: "Describe a moment", body: "Try something specific: place + energy + era. e.g. late-night motorway drive, upbeat 2000s gym." },
  ];
  const cur = steps[step - 1] || steps[0];
  return `
  <div class="onboarding-overlay" id="onboardingOverlay" role="dialog" aria-modal="true" aria-label="Getting started">
    <div class="onboarding-card">
      <div class="onboarding-step">Step ${step} of 3</div>
      <h2>${esc(cur.title)}</h2>
      <p>${esc(cur.body)}</p>
      <div class="onboarding-dots">${steps.map((_, i) => `<span class="onboarding-dot ${i + 1 === step ? "active" : ""}"></span>`).join("")}</div>
      <div class="onboarding-actions">
        ${step > 1 ? `<button type="button" class="btn btn-ghost btn-sm" id="onboardingBack">Back</button>` : ""}
        <button type="button" class="btn btn-green btn-sm" id="onboardingNext">${step < 3 ? "Next" : "Got it"}</button>
        <button type="button" class="btn btn-ghost btn-sm" id="onboardingSkip">Skip</button>
      </div>
    </div>
  </div>`;
}

function buildCoherenceBadgeHtml(coherence, sceneLockStatus, coherenceGate, swapRepairActions) {
  const overall = coherence?.overallScore ?? coherence?.overallCoherence;
  if (typeof overall !== "number") return "";
  const pct = Math.round(overall * 100);
  const tone = pct >= 72 ? "good" : pct >= 58 ? "ok" : "low";
  const repaired = Array.isArray(swapRepairActions) && swapRepairActions.length > 0;
  const worldLocked = !!(sceneLockStatus?.active);
  const gateNote = coherenceGate?.publish === false && coherenceGate?.reason
    ? ` · ${esc(coherenceGate.reason)}`
    : "";
  return `<div class="coherence-badge coherence-badge--${tone}" aria-label="Playlist coherence ${pct} percent">
    <span class="coherence-badge-score">${pct}%</span>
    <span class="coherence-badge-label">world coherence${repaired ? " · refined" : ""}${worldLocked ? " · scene locked" : ""}${gateNote}</span>
  </div>`;
}

function buildIntentUnderstandingHtml(intent, coherence, opts = {}) {
  const decomposed = opts.decomposed || null;
  if (!intent && !decomposed) return "";

  let understood = flattenIntentConcepts(intent);
  if (understood.length === 0 && decomposed) {
    understood = [
      decomposed.scene,
      decomposed.emotion,
      decomposed.energy,
      decomposed.inferredActivity,
      ...(decomposed.culturalRefs || []),
      ...(decomposed.exclusions || []).map((x) => `exclude: ${x}`),
    ].filter(Boolean).slice(0, 8);
  }

  const unknown = [
    ...(Array.isArray(intent?.unrecognizedTerms) ? intent.unrecognizedTerms : []),
    ...(Array.isArray(decomposed?.unknownTokens) ? decomposed.unknownTokens : []),
  ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 8);

  const rawConf = intent?.confidence ?? decomposed?.confidence;
  const conf = typeof rawConf === "number" ? Math.round(rawConf * 100) : null;
  const alwaysShow = !!opts.alwaysShow;
  if (!alwaysShow && unknown.length === 0 && (conf === null || conf >= 78)) return "";

  const overall = coherence?.overallScore ?? coherence?.overallCoherence;
  const repaired = coherence?.repairApplied || !!opts.repairApplied;
  const coherenceLine = typeof overall === "number"
    ? `<div class="intent-understanding-line intent-understanding-muted">Playlist coherence: <strong style="color:var(--text)">${Math.round(overall * 100)}%</strong>${repaired ? " · refined" : ""}</div>`
    : "";

  return `<div class="${opts.preview ? "intent-preview-strip" : "intent-understanding-card"}">
    <div class="intent-understanding-title">${opts.preview ? "Preview" : "What we understood"}</div>
    ${understood.length ? `<div class="intent-understanding-line"><strong>Recognized:</strong> ${understood.map(esc).join(" · ")}</div>` : ""}
    ${unknown.length ? `<div class="intent-understanding-line intent-understanding-line--warn"><strong>Not sure about:</strong> ${unknown.map(esc).join(", ")}</div>` : ""}
    ${Array.isArray(intent.assumptions) && intent.assumptions.length
      ? `<div class="intent-understanding-line intent-understanding-muted">Assuming: ${intent.assumptions.slice(0, 3).map(esc).join(" · ")}</div>`
      : ""}
    ${conf !== null ? `<div class="intent-understanding-line intent-understanding-muted">Intent confidence: ${conf}%</div>` : ""}
    ${coherenceLine}
  </div>`;
}

function updateIntentPreviewStrip(data) {
  const strip = document.getElementById("intentPreviewStrip");
  if (!strip) return;
  const tier = data?.intentUnderstanding?.confidenceTier ?? data?.promptConfidence?.tier;
  const wordCount = String(document.getElementById("vibeInput")?.value || "").trim().split(/\s+/).filter(Boolean).length;
  state.preview = {
    ...data,
    requiresClarification: tier === "low" && wordCount < 4 && !state.selectedSceneId,
    momentUnderstandingLine: data?.momentUnderstandingLine ?? null,
  };
  const momentLine = state.preview.momentUnderstandingLine
    ? `<p class="moment-understanding-line">${esc(state.preview.momentUnderstandingLine)}</p>`
    : "";
  const clarification = state.preview.requiresClarification
    ? `<p class="sync-meta clarification-required">Add more detail, pick a suggestion, or use at least four words before generating.</p>`
    : "";
  const clarificationChips = intentClarificationChipsHtml();
  const html = buildIntentUnderstandingHtml(
    data?.intentUnderstanding || null,
    null,
    { preview: true, alwaysShow: true, decomposed: data?.decomposedIntent || null },
  );
  if (!html && !momentLine && !clarification && !clarificationChips) {
    strip.hidden = true;
    strip.innerHTML = "";
    return;
  }
  strip.hidden = false;
  strip.innerHTML = momentLine + clarification + clarificationChips + html;
}

function resultHtml(result) {
  const count = result.trackCount || (Array.isArray(result.tracks) ? result.tracks.length : 0);
  const name = esc(result.playlistName || result.name || "Playlist created");

  // ── Dynamic vibe tags from scoring response ────────────────────────────────
  const DOT_COLORS = ["vd-purple", "vd-indigo", "vd-blue", "vd-green", "vd-orange"];
  const vibeTags = (() => {
    const tags = [];
    const diag = result.scoringDiagnostics;
    const sem = diag?.semanticResolution;
    if (sem?.sceneId) tags.push(sem.sceneId.replace(/_/g, " "));
    const dominant = diag?.dominantGenres || result.libraryIntelligence?.dominantGenres || [];
    dominant.slice(0, 2).forEach(g => tags.push(g));
    const traits = result.sonicTraits || [];
    traits.slice(0, 2).forEach(t => tags.push(t));
    if (!tags.length) tags.push("Curated", "Personal", "Atmospheric");
    return tags.slice(0, 4);
  })();
  const vibeDotsHtml = vibeTags.map((t, i) =>
    `<span class="vibe-dot ${DOT_COLORS[i % DOT_COLORS.length]}"></span><span>${esc(t)}</span>`
  ).join("\n");

  // ── Admin Debug Panel ──────────────────────────────────────────────────────
  const debugHtml = debugModeEnabled() ? buildDebugPanel(result) : "";
  const confidence = result.playlistConfidence || {};
  const confidencePercent = typeof confidence.percent === "number" ? confidence.percent : null;
  const degradedSpotifyNotice = result.spotifyUnavailable
    ? "Playlist built, but Spotify creation failed. You can still review and share it here."
    : result.spotifyPartial
      ? `Spotify playlist created with ${result.spotifyTracksAdded ?? "some"} of ${count} tracks.`
      : null;
  const fallbackNotice = degradedSpotifyNotice
    ? degradedSpotifyNotice
    : (typeof result.supplyMessage === "string" && result.supplyMessage.trim()
      ? result.supplyMessage.trim()
      : null)
    || (result.humanQualityGate?.action === "honest_partial" && count > 0
      ? (result.humanQualityGate.userMessage || `Honest partial — ${count} tracks that belong together without filler padding.`)
      : null)
    || (result.honestPartialPublished && count > 0 && count < Math.max(8, Math.floor(state.length * 0.45))
      ? `Short on purpose — only ${count} tracks in your library truly fit this musical world. Sync more likes in this lane, or try Discovery Mode.`
      : null)
    || (result.degraded || (Array.isArray(result.degradationReasons) && result.degradationReasons.length > 0)
      ? "Built in degraded mode — some quality checks were relaxed to finish in time."
    : count > 0 && count < Math.max(8, Math.floor(state.length * 0.4))
      ? `Only ${count} strong tracks survived the safety checks. Try a broader prompt or Balanced mode for a fuller playlist.`
    : result.fastFallback || result.code === "TIMEOUT_FALLBACK"
    ? "Quick backup playlist built because the full generator was taking too long."
    : confidence.recoveryUsed
      ? "Best available playlist built after relaxing non-critical checks."
      : null);
  const resultBadge = result.spotifyUnavailable
    ? "Review ready"
    : result.requestedNewMix
      ? "New mix"
      : result.cached
        ? "Instant replay"
        : result.spotifyPartial || result.fastFallback || result.code === "TIMEOUT_FALLBACK"
          ? "Best available"
          : "Ready";
  const resultBadgeClass = result.cached
    ? "badge badge-amber"
    : result.spotifyUnavailable || result.spotifyPartial || result.fastFallback || result.code === "TIMEOUT_FALLBACK"
    ? "badge badge-amber"
    : "badge badge-green";
  const cacheNotice = result.cached
    ? `<p class="result-insight result-insight--notice">Same prompt replayed from cache — tap <strong>New mix</strong> below for a different take.</p>`
    : result.requestedNewMix
      ? `<p class="result-insight result-insight--notice">Fresh mix requested — track order and picks were reshuffled.</p>`
      : "";
  const sceneLine = result.momentUnderstandingLine
    || result.sceneLabel
    || (result.scoringDiagnostics?.semanticResolution?.sceneId
      ? result.scoringDiagnostics.semanticResolution.sceneId.replace(/_/g, " ")
      : null);
  const confidenceHtml = confidencePercent !== null ? `
      <div class="result-confidence ${confidence.recoveryUsed || confidence.fallbackUsed ? "result-confidence--recovered" : ""}">
        <span>${esc(confidence.label || "Playlist confidence")}</span>
        <strong>${confidencePercent}%</strong>
      </div>` : "";
  const trustChips = [
    result.matchQualityLabel ||
      (result.generationTrust?.matchQualityLabel) ||
      (confidencePercent !== null
        ? (confidencePercent >= 78 ? "Strong Prompt Match" : confidencePercent >= 58 ? "Good Prompt Match" : "Best Available Match")
        : "Prompt Matched"),
    result.personalizationSource === "spotify_discovery" || result.noLibraryMode
      ? "Built from Spotify Discovery"
      : "Built from Your Library",
    result.generationTrust?.controlledRecoveryBlocked ? "Best Available — recovery blocked further widening" : null,
    result.degraded ? "Degraded Performance Mode" : null,
    result.recoveryAssisted || result.generationTrust?.recoveryAssisted || confidence.recoveryUsed || confidence.fallbackUsed || result.fastFallback || result.code === "TIMEOUT_FALLBACK" ? "Recovery Assisted" : null,
    result.generationTrust?.eraRelaxed || result.strictEraEvidence?.relaxed ? "Era widened to best available" : null,
    result.generationTrust?.genreRelaxed || result.strictGenreEvidence?.relaxed ? "Genre widened to best available" : null,
    result.humanQualityGate?.action === "honest_partial" ? "Honest partial — in-world tracks only" : null,
    result.spotifyUnavailable ? "Review Copy Available" : result.spotifyPartial ? "Spotify Partially Saved" : null,
  ].filter(Boolean);
  const intentUnderstanding = result.intentUnderstanding
    || result.v3Diagnostics?.intentUnderstanding
    || null;
  const decomposedIntent = result.decomposedIntent
    || result.generationDiagnostics?.decomposedIntent
    || result.v3Diagnostics?.decomposedIntent
    || null;
  const playlistCoherence = result.playlistCoherence
    || result.coherenceScore
    || result.v3Diagnostics?.playlistCoherence
    || null;
  const segmentDiagnostics = result.segmentDiagnostics
    || result.generationDiagnostics?.segmentDiagnostics
    || [];
  const segmentStripHtml = buildSegmentStripHtml(segmentDiagnostics);
  const coherenceGate = result.coherenceGate || result.generationDiagnostics?.coherenceGate || null;
  const sceneLockStatus = result.sceneLockStatus || result.generationDiagnostics?.sceneLockStatus || null;
  const coherenceBadgeHtml = buildCoherenceBadgeHtml(
    playlistCoherence,
    sceneLockStatus,
    coherenceGate,
    result.swapRepairActions,
  );
  const intentUnderstandingHtml = buildIntentUnderstandingHtml(intentUnderstanding, playlistCoherence, {
    repairApplied: Array.isArray(result.swapRepairActions) && result.swapRepairActions.length > 0,
    decomposed: decomposedIntent,
    alwaysShow: typeof (playlistCoherence?.overallScore ?? playlistCoherence?.overallCoherence) === "number",
  });

  const hasExplain = !!(result.v3Diagnostics?.playlistExplanation || result.playlistExplanation);
  const playlistExplanation = result.v3Diagnostics?.playlistExplanation || result.playlistExplanation;
  const tabsHtml = hasExplain ? `
  <div class="result-view-tabs">
    <button class="result-tab-btn ${!state.showExplain ? "active" : ""}" id="tabPlaylist">
      <i class="tab-icon">🎵</i>Playlist
    </button>
    <button class="result-tab-btn ${state.showExplain ? "active" : ""}" id="tabExplain">
      <i class="tab-icon">🧠</i>Explain This Playlist
    </button>
  </div>` : "";

  const explainContent = (hasExplain && state.showExplain)
    ? renderPlaylistExplanation(playlistExplanation)
    : "";
  const tracks = Array.isArray(result.tracks) ? result.tracks : [];
  const playlistId = result.savedPlaylistId || result.playlistId || "";
  const shareSlug = result.shareSlug || "";
  const tracksHtml = tracks.length ? `
  <div class="tracks-list" id="resultTracksList">
    ${tracks.map((t, i) => {
      const title = t.trackName || t.name || "Unknown track";
      const artist = t.artistName || t.artist || "Unknown artist";
      const art = t.albumArt || t.album_art;
      const whyReasons = Array.isArray(t.whyReasons) ? t.whyReasons.filter(Boolean) : [];
      const why = whyReasons.length
        ? ` title="Why this song: ${esc(whyReasons.slice(0, 3).join(", "))}"`
        : "";
      const whyHtml = whyReasons.length
        ? `<div class="track-why">${esc(whyReasons.slice(0, 2).join(" · "))}</div>`
        : "";
      return `
      <div class="track-row" data-track-index="${i}"${why}>
        <span class="track-num">${i + 1}</span>
        <div class="track-art">${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : ""}</div>
        <div class="track-info">
          <div class="track-name">${esc(title)}</div>
          <div class="track-artist">${esc(artist)}</div>
          ${whyHtml}
        </div>
        <div class="track-actions">
          <button class="section-action feedback-track-btn" data-action="skip" data-track-index="${i}" data-playlist-id="${playlistId}" title="Skip this track" aria-label="Skip this track">⏭</button>
          <button class="section-action feedback-track-btn" data-action="remove" data-track-index="${i}" data-playlist-id="${playlistId}" title="Remove from future playlists" aria-label="Remove from future playlists">−</button>
          <button class="section-action feedback-track-btn" data-action="replace" data-track-index="${i}" data-playlist-id="${playlistId}" title="Replace with a nearby track" aria-label="Replace with a nearby track">↻</button>
          <button class="section-action feedback-track-btn" data-action="like" data-track-index="${i}" data-playlist-id="${playlistId}" title="Like this track" aria-label="Like this track">♥</button>
          <button class="section-action feedback-track-btn" data-action="dislike" data-track-index="${i}" data-playlist-id="${playlistId}" title="Thumbs down - reduces similar future picks" aria-label="Thumbs down - reduces similar future picks">↓</button>
          <button class="section-action feedback-track-btn undo-feedback-btn" data-action="undo" data-track-index="${i}" data-playlist-id="${playlistId}" title="Undo last feedback" aria-label="Undo last feedback" style="display:none">Undo</button>
        </div>
      </div>`;
    }).join("")}
  </div>` : "";

  return `
  <div class="result-card">
    <div class="result-art">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    </div>
    <div class="result-body">
      <div class="result-top">
        <span class="${resultBadgeClass}">${esc(resultBadge)}</span>
        <span class="result-meta">${count} tracks · ${state.mode} mode</span>
      </div>
      <h2 class="result-title">${name}</h2>
      ${sceneLine ? `<p class="result-scene-line">Read as: <strong>${esc(sceneLine)}</strong></p>` : ""}
      ${result.momentUnderstandingLine && result.momentUnderstandingLine !== sceneLine ? `<p class="moment-understanding-line">${esc(result.momentUnderstandingLine)}</p>` : ""}
      ${cacheNotice}
      <p class="result-insight">${result.noLibraryMode ? "Curated from Spotify-wide search to fit the moment. Less personalized than your liked songs." : "Curated from your liked songs to fit the moment."}</p>
      ${fallbackNotice ? `<p class="result-insight result-insight--notice">${esc(fallbackNotice)}</p>` : ""}
      ${buildThinLibraryDetailHtml(result)}
      ${coherenceBadgeHtml}
      ${trustChipsHtml}
      ${result.intentSurvivalSummary || result.generationTrust?.intentSurvivalSummary ? `<p class="result-insight result-insight--trust">${esc(result.intentSurvivalSummary || result.generationTrust?.intentSurvivalSummary)}</p>` : ""}
      ${result.intentSurvivalSummary || result.generationTrust?.intentSurvivalSummary ? `<p class="result-insight result-insight--muted">${esc(result.intentSurvivalSummary || result.generationTrust?.intentSurvivalSummary)}</p>` : ""}
      ${result.playlistWhy || result.generationTrust?.playlistWhy ? `<p class="result-insight">${esc(result.playlistWhy || result.generationTrust?.playlistWhy)}</p>` : ""}
      ${segmentStripHtml}
      ${intentUnderstandingHtml}
      ${confidenceHtml}
      <div class="result-vibes">
        ${vibeDotsHtml}
      </div>
      ${debugModeEnabled() ? `<div class="result-safety-row">
        <span>Safety filter active</span>
        <strong>Christmas / holiday tracks excluded unless requested</strong>
      </div>` : ""}
      <div class="result-actions">
        ${result.spotifyPlaylistUrl ? `<a href="${esc(result.spotifyPlaylistUrl)}" target="_blank" rel="noopener" class="btn btn-green">${spi()} Open in Spotify</a>` : ""}
        ${shareSlug ? `
        <a href="/p/${esc(shareSlug)}" class="btn btn-ghost btn-sm">Open share page</a>
        <button type="button" class="btn btn-ghost btn-sm" id="copyShareLinkBtn" data-share-slug="${esc(shareSlug)}">Copy link</button>
        ` : ""}
      </div>
      ${promptSteerChipsHtml(result.vibe || result.prompt)}
      ${tabsHtml}
    </div>
  </div>
  ${explainContent}
  ${!state.showExplain ? tracksHtml : ""}
  ${!state.showExplain ? debugHtml : ""}`;
}

// ── Explain This Playlist ─────────────────────────────────────────────────────
function renderPlaylistExplanation(expl) {
  if (!expl) return `<div class="explain-card" style="text-align:center;color:var(--muted);padding:32px">No explanation data — regenerate with debug mode enabled.</div>`;

  const intent   = expl.intentSummary    || {};
  const laneList = expl.laneDetails      || [];
  const clusters = expl.clusterMap       || {};
  const div      = expl.diversityReport  || {};
  const sel      = expl.selectionSummary || {};

  const LANE_COLORS = { core:"#7c3aed", emotional:"#db2777", motion:"#0891b2", contrast:"#d97706", discovery:"#16a34a", fallback:"#6b7280", ambient:"#0e7490", high_energy:"#dc2626", low_energy:"#2563eb" };
  const laneColor = (id) => LANE_COLORS[id] || LANE_COLORS[id?.split("_")[0]] || "#6b7280";

  // ── 1. Intent ──────────────────────────────────────────────────────────────
  const evec     = intent.emotionVector || {};
  const evecKeys = ["energy","valence","calm","nostalgia","tension"];
  const evecColors = { energy:"#f59e0b", valence:"#1db954", calm:"#38bdf8", nostalgia:"#a78bfa", tension:"#f87171" };
  const eraVec   = intent.eraVector || {};
  const topEras  = Object.entries(eraVec).sort((a,b) => b[1]-a[1]).slice(0,4);
  const sceneMap = intent.sceneInfluenceMap || {};
  const topScenes = Object.entries(sceneMap).filter(([,v]) => v > 0.05).slice(0,3);

  const intentHtml = `
  <div class="explain-card">
    <div class="explain-card-title">🧠 Intent — What the system understood</div>
    <div class="explain-intent-primary">${esc(String(intent.primaryIntent || "(missing intent)")).replace(/_/g," ")}</div>
    ${(intent.secondaryIntents||[]).length ? `<div class="explain-secondary-tags">${(intent.secondaryIntents||[]).slice(0,6).map(s=>`<span class="explain-tag">${esc(String(s).replace(/_/g," "))}</span>`).join("")}</div>` : ""}
    <div class="explain-emotion-grid">
      ${evecKeys.map(k => {
        const v = evec[k] ?? 0;
        const pct = Math.round(v*100);
        const col = evecColors[k] || "#a78bfa";
        return `<div class="explain-emotion-item">
          <span class="explain-emotion-label">${k}</span>
          <div class="explain-emotion-bar-wrap"><div class="explain-emotion-bar" style="width:${pct}%;background:${col}"></div></div>
          <span class="explain-emotion-val">${pct}%</span>
        </div>`;
      }).join("")}
    </div>
    ${topEras.length ? `<div style="margin-top:10px;font-size:0.7rem;color:var(--muted)">Era focus: ${topEras.map(([e,c])=>`<span style="color:var(--text)">${esc(e)}</span> (${c})`).join(", ")}</div>` : ""}
    ${topScenes.length ? `<div style="margin-top:6px;font-size:0.7rem;color:var(--muted)">Scene signals: ${topScenes.map(([s,v])=>`<span style="color:#c4b5fd">${esc(s.replace(/_/g," "))}</span> ${Math.round(v*100)}%`).join(", ")}</div>` : ""}
    <div style="margin-top:8px;font-size:0.66rem;color:var(--muted-2)">Routing: <span style="color:${intent.activePath==="adaptive"?"#4ade80":"#f59e0b"}">${esc(String(intent.activePath||"adaptive").replace(/_/g," "))}</span></div>
  </div>`;

  // ── 2. Lane distribution ───────────────────────────────────────────────────
  const laneSorted = [...laneList].sort((a,b) => b.pctContribution - a.pctContribution);
  const laneHtml = `
  <div class="explain-card">
    <div class="explain-card-title">🎛️ Lane Distribution — How tracks were routed</div>
    <div class="explain-lane-list">
      ${laneSorted.map(l => {
        const col = laneColor(l.laneId);
        const pct = l.pctContribution || 0;
        return `<div class="explain-lane-row">
          <span class="explain-lane-label" title="${esc(l.laneId)}">${esc((l.label||l.laneId||"").replace(/_/g," "))}</span>
          <div class="explain-lane-bar-wrap"><div class="explain-lane-bar" style="width:${pct}%;background:${col}"></div></div>
          <span class="explain-lane-pct">${pct}%</span>
          <span class="explain-lane-count">${l.selectedCount||0} / ${l.scoredCount||0}</span>
        </div>`;
      }).join("")}
    </div>
    <div style="margin-top:8px;font-size:0.66rem;color:var(--muted-2)">Format: selected / scored candidates per lane</div>
  </div>`;

  // ── 3. Cluster map ─────────────────────────────────────────────────────────
  const clusterEntries = Object.entries(clusters)
    .filter(([,v]) => (v.trackCount || 0) > 0 || (v.weightContribution || 0) > 0)
    .sort((a,b) => (b[1].weightContribution||0) - (a[1].weightContribution||0))
    .slice(0,8);

  const clusterHtml = clusterEntries.length ? `
  <div class="explain-card">
    <div class="explain-card-title">🧬 Cluster Map — Why tracks grouped together</div>
    <div class="explain-cluster-grid">
      ${clusterEntries.map(([cid, cv]) => {
        const label = cid.replace(/^genre:|^era:|^energy:/,"").replace(/_/g," ");
        const wpct  = Math.round((cv.weightContribution||0)*100);
        return `<div class="explain-cluster-row">
          <span class="explain-cluster-id">${esc(label)}</span>
          <span class="explain-cluster-genres">${cv.genres && cv.genres.length ? cv.genres.slice(0,3).map(g=>esc(g.replace(/_/g," "))).join(", ") : cid.split(":")[0]}</span>
          <span class="explain-cluster-tracks">${cv.trackCount||0} tracks</span>
          <span class="explain-cluster-weight" title="cluster weight contribution">${wpct}%</span>
        </div>`;
      }).join("")}
    </div>
  </div>` : "";

  // ── 4. Diversity layer ─────────────────────────────────────────────────────
  const entropyRows = [
    { name:"Genre variety",  val: div.genreEntropy||0,  count: div.genreCount||0,  unit:"genres",  col:"#7c3aed" },
    { name:"Artist spread",  val: div.artistEntropy||0, count: div.artistCount||0, unit:"artists", col:"#0891b2" },
    { name:"Era spread",     val: div.eraEntropy||0,    count: div.eraCount||0,    unit:"eras",    col:"#d97706" },
    { name:"Diversity pressure", val: div.diversityPressure||0, count: null, unit:null, col:"#f87171" },
  ];
  const entropyNote = (v) => v >= 0.75 ? "high — broad selection" : v >= 0.45 ? "moderate" : "low — intentionally concentrated";

  const diversityHtml = `
  <div class="explain-card">
    <div class="explain-card-title">🌐 Diversity Layer — Spread enforcement</div>
    <div class="explain-entropy-list">
      ${entropyRows.map(r => {
        const pct = Math.round(r.val*100);
        return `<div class="explain-entropy-row">
          <div class="explain-entropy-header">
            <span class="explain-entropy-name">${esc(r.name)}${r.count !== null ? ` <span style="color:var(--muted-2)">(${r.count} ${r.unit})</span>` : ""}</span>
            <span class="explain-entropy-val">${pct}%</span>
          </div>
          <div class="explain-entropy-bar-wrap"><div class="explain-entropy-bar" style="width:${pct}%;background:${r.col}"></div></div>
          <span class="explain-entropy-note">${entropyNote(r.val)}</span>
        </div>`;
      }).join("")}
    </div>
    ${div.dominantGenre ? `<div style="margin-top:8px;font-size:0.7rem;color:var(--muted)">Dominant genre: <strong style="color:var(--text)">${esc(div.dominantGenre.replace(/_/g," "))}</strong>${div.dominantEra?` · Era: <strong style="color:var(--text)">${esc(div.dominantEra)}</strong>`:""}</div>` : ""}
  </div>`;

  const quality = v3.playlistQuality || result.generationAuditSnapshot?.playlistQuality || {};
  const repair = v3.explicitIntentRepair || result.generationAuditSnapshot?.explicitIntentRepair || {};
  const cache = result.cacheDiagnostics || result.generationAuditSnapshot?.cacheDiagnostics || {};
  const qPct = (value) => typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
  const qualityHtml = `
  <div class="explain-card">
    <div class="explain-card-title">✅ Playlist Quality Report</div>
    <div class="dp-pool-grid">
      <div class="dp-pool-stat"><div class="dp-pool-num">${qPct(quality.genrePurity)}</div><div class="dp-pool-lbl">Genre purity</div></div>
      <div class="dp-pool-stat"><div class="dp-pool-num">${qPct(quality.promptAlignment)}</div><div class="dp-pool-lbl">Prompt fit</div></div>
      <div class="dp-pool-stat"><div class="dp-pool-num">${repair.repairedCount ?? 0}</div><div class="dp-pool-lbl">Final repairs</div></div>
    </div>
    <div style="margin-top:8px;font-size:0.72rem;color:var(--muted)">
      Cache: <strong style="color:var(--text)">${esc(cache.status || "fresh")}</strong>
      ${repair.active ? ` · repair reasons: <strong style="color:var(--text)">${esc(Object.entries(repair.repairReasons || {}).map(([k,v]) => `${k}:${v}`).join(", ") || "intent")}</strong>` : ""}
    </div>
  </div>`;
  const survival = result.intentSurvival || result.v3Diagnostics?.intentSurvival || result.generationAuditSnapshot?.intentSurvival || {};
  const survivalScores = survival.scores || {};
  const survivalLeaks = Array.isArray(survival.leakDetections) ? survival.leakDetections : [];
  const survivalEmotion = survival.emotionSurvival || {};
  const survivalConvergence = survival.convergence || {};
  const survivalPct = (value) => typeof value === "number" ? `${Math.round(value)}%` : "—";
  const survivalRisk = survivalConvergence.convergenceRisk || "—";
  const survivalHtml = `
  <div class="explain-card">
    <div class="explain-card-title">🧭 Intent Survival</div>
    <div class="dp-pool-grid">
      <div class="dp-pool-stat"><div class="dp-pool-num">${survivalPct(survivalScores.overallIntentSurvival)}</div><div class="dp-pool-lbl">Overall</div></div>
      <div class="dp-pool-stat"><div class="dp-pool-num">${survivalPct(survivalScores.emotionSurvival ?? survivalEmotion.survivalPercent)}</div><div class="dp-pool-lbl">Emotion</div></div>
      <div class="dp-pool-stat"><div class="dp-pool-num">${survivalPct(survivalScores.subgenreSurvival)}</div><div class="dp-pool-lbl">Subgenre</div></div>
    </div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
      <span class="dp-badge">Leaks: ${survivalLeaks.length}</span>
      <span class="dp-badge">Convergence: ${esc(String(survivalRisk))}</span>
      ${survivalEmotion.dominantEmotion ? `<span class="dp-badge">Emotion: ${esc(String(survivalEmotion.dominantEmotion))}</span>` : ""}
    </div>
    ${survivalLeaks.length ? `<div style="margin-top:8px;font-size:0.68rem;color:var(--muted)">Top leak: <strong style="color:var(--text)">${esc(String(survivalLeaks[0].functionName || survivalLeaks[0].reason || "intent leak"))}</strong></div>` : ""}
    ${Array.isArray(survival.intentLossPipeline) && survival.intentLossPipeline.length ? `
    <div style="margin-top:10px;font-size:0.68rem;color:var(--muted)">
      ${survival.intentLossPipeline.map((stage) => `<div style="margin-top:4px"><strong style="color:var(--text)">${esc(stage.stage)}</strong>${stage.lostTerms?.length ? ` · lost: ${esc(stage.lostTerms.join(", "))}` : ""}</div>`).join("")}
    </div>` : ""}
  </div>`;

  // ── 5. Selection summary ───────────────────────────────────────────────────
  const selRate = sel.selectionRate ?? (sel.totalCandidates > 0 ? Math.round(sel.selected/sel.totalCandidates*100) : 0);
  const rejReasons = (sel.topRejectionReasons||[]).map(r => r.replace(/_/g," "));

  const selHtml = `
  <div class="explain-card">
    <div class="explain-card-title">🔥 Selection Summary — What got in, what didn't</div>
    <div class="explain-sel-stats">
      <div class="explain-sel-stat">
        <div class="explain-sel-num">${sel.totalCandidates||0}</div>
        <div class="explain-sel-lbl">Evaluated</div>
      </div>
      <div class="explain-sel-stat">
        <div class="explain-sel-num" style="color:#4ade80">${sel.selected||0}</div>
        <div class="explain-sel-lbl">Selected</div>
      </div>
      <div class="explain-sel-stat">
        <div class="explain-sel-num" style="color:#f87171">${sel.rejected||0}</div>
        <div class="explain-sel-lbl">Rejected</div>
      </div>
    </div>
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:4px">
        <span style="color:var(--muted)">Selection rate</span>
        <span style="color:${selRate>=50?"#4ade80":"#f59e0b"}">${selRate}%</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${selRate}%;background:${selRate>=50?"#1db954":"#f59e0b"};border-radius:3px;transition:width 0.6s"></div>
      </div>
    </div>
    ${rejReasons.length ? `
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:6px;font-weight:600">Top rejection reasons</div>
    <div class="explain-rejection-list">
      ${rejReasons.map(r=>`<div class="explain-rejection-item"><span class="explain-rejection-dot"></span>${esc(r)}</div>`).join("")}
    </div>` : ""}
  </div>`;

  return `<div class="explain-panel">${intentHtml}${laneHtml}${clusterHtml}${diversityHtml}${selHtml}</div>`;
}

// ── Admin Debug Panel ─────────────────────────────────────────────────────────
// ── Unified debug panel — V3.1 primary, V11 labeled as pre-processing ─────────
function buildUnifiedDebugPanel(result, dbg) {
  const v3  = dbg.v3  || {};
  const v11 = dbg.v11 || {};
  const sys = dbg.systemDiagnostics || {};
  const pool = dbg.poolInfo || {};
  const gen = result.generationDiagnostics || result.generationAuditSnapshot?.generationDiagnostics || {};
  const artistDiv = result.artistDiversity || result.generationAuditSnapshot?.artistDiversity || {};
  const confidence = result.playlistConfidence || result.generationAuditSnapshot?.playlistConfidence || {};
  const waterfall = Array.isArray(gen.waterfall) ? gen.waterfall : [];
  const coherence = v3.playlistCoherence || result.v3Diagnostics?.playlistCoherence || {};

  const genreColors = {
    country:"#d97706",folk:"#16a34a",indie:"#7c3aed",rock:"#dc2626",
    electronic:"#0891b2",pop:"#db2777",jazz:"#9333ea",soul:"#ea580c",
    rnb:"#0284c7",hip_hop:"#16a34a",blues:"#2563eb",metal:"#6b7280",
    classical:"#b45309",reggae:"#15803d",latin:"#c2410c",
  };
  const laneColors = { core:"#7c3aed", emotional:"#db2777", motion:"#0891b2", contrast:"#d97706", discovery:"#16a34a", fallback:"#6b7280" };
  const bar = (v) => {
    const pct = Math.round((v || 0) * 100);
    const col = pct >= 70 ? "#1db954" : pct >= 40 ? "#f59e0b" : "#ef4444";
    return `<div class="dp-score-bar-wrap" title="${pct}%"><div class="dp-score-bar" style="width:${pct}%;background:${col}"></div><span>${pct}</span></div>`;
  };

  const basicDebugHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">Basic Debug</div>
      <div class="dp-pool-grid" style="grid-template-columns:repeat(5,1fr);gap:8px">
        <div class="dp-pool-stat"><div class="dp-pool-num">${(gen.initialLibrarySize ?? pool.librarySize ?? 0).toLocaleString()}</div><div class="dp-pool-lbl">Library scanned</div></div>
        <div class="dp-pool-stat"><div class="dp-pool-num">${(gen.candidatesAfterConstraints ?? pool.hybridPoolSize ?? 0).toLocaleString()}</div><div class="dp-pool-lbl">Candidates found</div></div>
        <div class="dp-pool-stat"><div class="dp-pool-num">${(gen.candidatesFinal ?? result.totalTracks ?? result.count ?? 0).toLocaleString()}</div><div class="dp-pool-lbl">Playlist size</div></div>
        <div class="dp-pool-stat"><div class="dp-pool-num">${Math.round(result.generationMs || 0)}ms</div><div class="dp-pool-lbl">Generation time</div></div>
        <div class="dp-pool-stat"><div class="dp-pool-num">${gen.fallbackTriggered ? "Yes" : "No"}</div><div class="dp-pool-lbl">Fallback used</div></div>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        ${typeof confidence.percent === "number" ? `<span class="dp-badge dp-badge--green">Confidence: ${confidence.percent}%</span>` : ""}
        <span class="dp-badge">Artists: ${artistDiv.uniqueArtists ?? "—"}</span>
        <span class="dp-badge">Repeated: ${artistDiv.repeatedArtists ?? "—"}</span>
        <span class="dp-badge">Over cap: ${artistDiv.cappedTracks ?? "—"}</span>
        ${artistDiv.maxPerArtist ? `<span class="dp-badge">Max / artist: ${artistDiv.maxPerArtist}</span>` : ""}
        ${artistDiv.topRepeatedArtist ? `<span class="dp-badge">Top repeat: ${esc(artistDiv.topRepeatedArtist)} ×${artistDiv.topRepeatedArtistCount ?? "?"}</span>` : ""}
        ${gen.selectedCluster ? `<span class="dp-badge dp-badge--green">Cluster: ${esc(gen.selectedCluster)}</span>` : ""}
        ${gen.secondaryCluster ? `<span class="dp-badge">Secondary: ${esc(gen.secondaryCluster)}</span>` : ""}
        ${gen.identityType ? `<span class="dp-badge dp-badge--green">Identity: ${esc(gen.identityType).replace(/_/g," ")}</span>` : ""}
        ${typeof gen.clusterConfidence === "number" ? `<span class="dp-badge">Cluster confidence: ${Math.round(gen.clusterConfidence * 100)}%</span>` : ""}
        ${typeof gen.fallbackCandidatePercent === "number" ? `<span class="dp-badge ${gen.fallbackCandidatePercent > 20 ? "dp-badge--amber" : ""}">Fallback pool: ${gen.fallbackCandidatePercent}%</span>` : ""}
        ${typeof gen.humanCoherenceScore === "number" ? `<span class="dp-badge ${gen.humanCoherenceScore >= 0.62 ? "dp-badge--green" : "dp-badge--amber"}">Human coherence: ${Math.round(gen.humanCoherenceScore * 100)}%</span>` : ""}
        ${gen.humanCoherenceRepairUsed ? `<span class="dp-badge dp-badge--green">Coherence repaired</span>` : ""}
        ${typeof gen.cohesionScore === "number" ? `<span class="dp-badge">Final cohesion: ${Math.round(gen.cohesionScore * 100)}%</span>` : ""}
        ${typeof coherence.avg_transition_score === "number" ? `<span class="dp-badge">Coherence: ${Math.round(coherence.avg_transition_score * 100)}%</span>` : ""}
        ${typeof coherence.avg_position_shift === "number" ? `<span class="dp-badge">Avg move: ${coherence.avg_position_shift}</span>` : ""}
        ${typeof coherence.adjacent_artist_repeats === "number" ? `<span class="dp-badge">Adjacent repeats: ${coherence.adjacent_artist_repeats}</span>` : ""}
        ${gen.largestDrop?.stage ? `<span class="dp-badge dp-badge--amber">Biggest drop: ${esc(gen.largestDrop.stage)} −${(gen.largestDrop.removed || 0).toLocaleString()}</span>` : ""}
        ${Array.isArray(gen.majorExclusions) && gen.majorExclusions.length ? `<span class="dp-badge dp-badge--amber">Excluded: ${esc(gen.majorExclusions.join(", "))}</span>` : ""}
        ${Array.isArray(gen.recoveryRelaxations) && gen.recoveryRelaxations.length ? `<span class="dp-badge dp-badge--amber">Relaxed: ${esc(gen.recoveryRelaxations.join(", "))}</span>` : ""}
        ${gen.failureReason ? `<span class="dp-badge dp-badge--amber">Failure: ${esc(gen.failureReason)}</span>` : ""}
      </div>
      ${gen.identitySummary ? `
        <div style="margin-top:10px;font-size:0.78rem;color:var(--muted);line-height:1.45">
          <strong style="color:var(--text)">Identity summary:</strong> ${esc(gen.identitySummary)}
          ${gen.curatorIdentity?.forbiddenPatterns?.length ? `<div style="margin-top:4px">Forbidden patterns: ${esc(gen.curatorIdentity.forbiddenPatterns.join(", "))}</div>` : ""}
          ${gen.humanCoherenceComponents ? `<div style="margin-top:4px">Coherence: energy ${Math.round((gen.humanCoherenceComponents.energyConsistency || 0) * 100)}%, transitions ${Math.round((gen.humanCoherenceComponents.transitionSmoothness || 0) * 100)}%, emotion ${Math.round((gen.humanCoherenceComponents.emotionalStability || 0) * 100)}%</div>` : ""}
        </div>` : ""}
      ${waterfall.length ? `
        <div class="debug-waterfall">
          ${waterfall.map((stage) => `
            <div class="debug-waterfall-step">
              <span>${esc(stage.stage || "Stage")}</span>
              <strong>${Number(stage.count || 0).toLocaleString()}</strong>
            </div>
          `).join("")}
        </div>` : ""}
    </div>`;

  // ── System health ─────────────────────────────────────────────────────────
  const sysHtml = `
    <div class="dp-card" style="border-color:#334155">
      <div class="dp-card-title" style="color:#94a3b8">⚙️ Pipeline Architecture</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <span class="dp-badge" style="background:#7c3aed20;color:#a78bfa;border-color:#7c3aed40">Active: ${esc(dbg.activePipeline || "v3.1_unified_routing")}</span>
        <span class="dp-badge" style="background:#0284c720;color:#38bdf8;border-color:#0284c740">V11 → ${esc(sys.v11UsedFor || "candidateGeneration")}</span>
        <span class="dp-badge" style="background:#16a34a20;color:#4ade80;border-color:#16a34a40">V3.1 → ${esc(sys.v3UsedFor || "finalSelection")}</span>
        ${sys.debugPanelAligned ? '<span class="dp-badge" style="background:#16a34a20;color:#4ade80;border-color:#16a34a40">Panel Aligned ✓</span>' : ""}
      </div>
    </div>`;

  // ── V3.1 Intent decomposition ─────────────────────────────────────────────
  const intent = v3.intentDecomposition || {};
  const sceneMap = Object.entries(intent.sceneInfluenceMap || {}).slice(0, 6);
  const ctxAnchors = Object.entries(intent.contextAnchors || {}).slice(0, 4);
  const intentHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🧠 V3.1 Intent Decomposition</div>
      <div style="margin-bottom:8px;font-size:13px">
        <span style="opacity:0.6">Primary vibe: </span><strong>${esc(intent.primary || "—")}</strong>
      </div>
      ${sceneMap.length ? `
        <div class="dp-sub-title">Scene Influence Map</div>
        ${sceneMap.map(([scene, weight]) => {
          const pct = Math.round((weight || 0) * 100);
          return `<div class="dp-weight-row">
            <span class="dp-weight-label">${esc(scene).replace(/_/g," ")}</span>
            <div class="dp-weight-bar-wrap"><div class="dp-weight-bar" style="width:${Math.min(100,pct*1.5)}%;background:#7c3aed"></div></div>
            <span class="dp-weight-pct">${pct}%</span>
          </div>`;
        }).join("")}
      ` : ""}
      ${ctxAnchors.length ? `
        <div class="dp-sub-title" style="margin-top:8px">Context Anchors</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${ctxAnchors.map(([k,v]) => `<span class="dp-badge">${esc(k)}: ${esc(String(v))}</span>`).join("")}
        </div>
      ` : ""}
    </div>`;

  // ── V3.1 Global diversity ─────────────────────────────────────────────────
  const gd = (v3.globalDiversityMetrics || {}).postInterleave || {};
  const diversityHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🌈 V3.1 Global Diversity (Post-Interleave)</div>
      <div class="dp-pool-grid" style="grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="dp-pool-stat"><div class="dp-pool-num">${Math.round((gd.genreConcentration||0)*100)}%</div><div class="dp-pool-lbl">Genre conc.</div></div>
        <div class="dp-pool-stat"><div class="dp-pool-num">${Math.round((gd.eraConcentration||0)*100)}%</div><div class="dp-pool-lbl">Era conc.</div></div>
        <div class="dp-pool-stat"><div class="dp-pool-num">${Math.round((gd.artistRepeatIndex||0)*100)}%</div><div class="dp-pool-lbl">Artist repeat</div></div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${gd.driftState ? `<span class="dp-badge">Drift: ${esc(gd.driftState)}</span>` : ""}
        ${gd.explorationPressure != null ? `<span class="dp-badge">Exploration: ${Math.round((gd.explorationPressure||0)*100)}%</span>` : ""}
        ${gd.dominantGenre ? `<span class="dp-badge">Top genre: ${esc(gd.dominantGenre)}</span>` : ""}
        ${gd.dominantEra   ? `<span class="dp-badge">Top era: ${esc(gd.dominantEra)}</span>` : ""}
      </div>
    </div>`;

  // ── V3.1 Lane architecture ────────────────────────────────────────────────
  const lanes = v3.lanes || [];
  const lanesHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">🛣️ V3.1 Lane Architecture <span style="font-weight:400;font-size:11px;opacity:0.6">(these lanes make the final selection)</span></div>
      <div class="dp-table-wrap">
        <table class="dp-table">
          <thead><tr><th>Lane</th><th>Type</th><th>Weight</th><th>Scored</th><th>→ Selected</th><th>Genre clusters</th><th>Era clusters</th></tr></thead>
          <tbody>
            ${lanes.map(l => {
              const col = laneColors[l.type] || "#4b5563";
              const spread = l.clusterSpread || {};
              const ratio = l.scoredCount > 0 ? Math.round((l.selectedCount / l.scoredCount) * 100) : 0;
              return `<tr>
                <td><span class="dp-genre-pill" style="background:${col}20;color:${col}">${esc(l.laneId)}</span></td>
                <td style="opacity:0.7;font-size:11px">${esc(l.type)}</td>
                <td><strong>${Math.round((l.weight||0)*100)}%</strong></td>
                <td>${l.scoredCount}</td>
                <td>${l.selectedCount} <span style="opacity:0.5;font-size:11px">(${ratio}%)</span></td>
                <td>${spread.genreClusters ?? "—"}</td>
                <td>${spread.eraClusters ?? "—"}</td>
              </tr>`;
            }).join("") || '<tr><td colspan="7" style="text-align:center;opacity:0.5">No V3 lane diagnostics returned</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  // ── V3.1 Final decision trace ─────────────────────────────────────────────
  const trace = (v3.finalDecisionTrace || []).slice(0, 40);
  const traceHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">✅ V3.1 Final Decision Trace <span style="font-weight:400;font-size:11px;opacity:0.6">(why each track was selected or rejected per lane)</span></div>
      <div class="dp-table-wrap">
        <table class="dp-table">
          <thead><tr><th>#</th><th>Track</th><th>Lane</th><th>Raw Score</th><th>Div. Penalty</th><th>Cluster</th><th>Status</th></tr></thead>
          <tbody>
            ${trace.map((t, i) => {
              const penPct   = Math.round((t.diversityPenalty || 0) * 100);
              const rawPct   = Math.round((t.rawLaneScore || 0) * 100);
              const laneKey  = (t.enteredLane || "").split("_")[0];
              const laneCol  = laneColors[laneKey] || "#4b5563";
              const selColor = t.selected ? "#1db954" : "#9ca3af";
              const selLabel = t.selected ? "✓ Selected" : "✗ " + esc(t.rejectionReason || "rejected");
              const clusterLabel = (t.clusterId || "—").replace(/^(genre|era|energy|mood):/, "");
              return `<tr class="${i % 2 === 0 ? "dp-row-even" : ""}">
                <td class="dp-track-num">${i + 1}</td>
                <td class="dp-track-id">${esc(t.trackId || "").slice(-8)}</td>
                <td><span class="dp-genre-pill" style="background:${laneCol}20;color:${laneCol}">${esc(t.enteredLane || "—")}</span></td>
                <td>${bar(t.rawLaneScore)}</td>
                <td style="color:${penPct > 20 ? "#ef4444" : penPct > 5 ? "#f59e0b" : "#6b7280"}">${penPct > 0 ? "-" + penPct + "%" : "—"}</td>
                <td style="font-size:11px;opacity:0.7">${esc(clusterLabel)}</td>
                <td><span style="color:${selColor};font-size:11px;font-weight:600">${selLabel}</span></td>
              </tr>`;
            }).join("") || '<tr><td colspan="7" style="text-align:center;opacity:0.5">No V3 decision trace returned</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="dp-table-legend">Raw Score = pre-penalty lane affinity. Penalty from rolling diversity window. Rejection = cluster entropy constraint.</div>
    </div>`;

  // ── V11 section ───────────────────────────────────────────────────────────
  const v11SectionHeader = `
    <div style="margin:20px 0 10px;padding:8px 12px;background:rgba(0,0,0,0.2);border:1px solid #292524;border-radius:6px;font-size:11px;color:#78716c;letter-spacing:0.06em;text-transform:uppercase;display:flex;align-items:center;gap:8px">
      🔧 V11 Pre-Processing Layer — Candidate generation only · not the decision layer
    </div>`;

  const sem = v11.semanticResolution || {};
  const confPct   = Math.round((sem.confidence || 0) * 100);
  const confColor = confPct >= 80 ? "#1db954" : confPct >= 55 ? "#f59e0b" : "#ef4444";
  const v11SceneHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🔍 V11 Pre-Scene Signal <span style="font-weight:400;font-size:11px;opacity:0.5">(was "Detected Scene")</span></div>
      ${sem.sceneId ? `
        <div class="dp-scene-name">${esc(sem.sceneId).replace(/_/g," ")}</div>
        <div class="dp-scene-meta">
          <span class="dp-badge" style="background:${confColor}20;color:${confColor};border-color:${confColor}40">${confPct}% confidence</span>
          ${sem.fallback ? '<span class="dp-badge dp-badge--muted">Fallback</span>' : ""}
        </div>
      ` : `<div class="dp-none">${sem.fallback ? "No scene — V11 fallback active" : "No scene matched"}</div>`}
      <div style="margin-top:8px;font-size:11px;opacity:0.45">V11 uses this to weight candidates. V3.1 uses its own intent decomposition above.</div>
    </div>`;

  const libSize   = pool.librarySize   || 0;
  const hybSize   = pool.hybridPoolSize || 0;
  const removed   = libSize - hybSize;
  const removePct = libSize > 0 ? Math.round((removed / libSize) * 100) : 0;
  const topExcl   = Object.entries(v11.exclusionReasons || {}).sort((a,b) => b[1]-a[1]).slice(0, 5);
  const v11PoolHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🗂️ V11 Filtered Pool <span style="font-weight:400;font-size:11px;opacity:0.5">(was "Candidate Pool")</span></div>
      <div class="dp-pool-grid">
        <div class="dp-pool-stat"><div class="dp-pool-num">${libSize.toLocaleString()}</div><div class="dp-pool-lbl">Library tracks</div></div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat"><div class="dp-pool-num" style="color:#1db954">${hybSize.toLocaleString()}</div><div class="dp-pool-lbl">After V11 filter</div></div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat"><div class="dp-pool-num" style="color:#f59e0b">${removed.toLocaleString()}</div><div class="dp-pool-lbl">Removed (${removePct}%)</div></div>
      </div>
      ${topExcl.length ? `
        <div class="dp-sub-title">Exclusion reasons</div>
        <div class="dp-exclusions">
          ${topExcl.map(([r,n]) => `<div class="dp-excl-row"><span>${esc(r)}</span><span class="dp-excl-count">${n}</span></div>`).join("")}
        </div>
      ` : ""}
    </div>`;

  const topCands = (v11.topRankedCandidates || []).slice(0, 15);
  const v11CandidatesHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">📋 V11 Ranked Candidates <span style="font-weight:400;font-size:11px;opacity:0.5">(was "Top Scored Tracks") — V3.1 selects from this pool using lane architecture, not V11 rank</span></div>
      <div class="dp-table-wrap">
        <table class="dp-table">
          <thead><tr><th>#</th><th>Track</th><th>Genre</th><th>V11 Final</th><th>V11 Scene</th><th>V11 Emotion</th><th>V11 Library</th></tr></thead>
          <tbody>
            ${topCands.map((t, i) => `
              <tr class="${i % 2 === 0 ? "dp-row-even" : ""}">
                <td class="dp-track-num">${i + 1}</td>
                <td class="dp-track-id">${esc(t.trackId || "").slice(-8)}</td>
                <td><span class="dp-genre-pill" style="background:${(genreColors[t.genrePrimary]||"#4b5563")}20;color:${genreColors[t.genrePrimary]||"#9ca3af"}">${esc(t.genrePrimary||"?")}</span></td>
                <td>${bar(t.finalScore)}</td>
                <td>${bar(t.sceneScore)}</td>
                <td>${bar(t.emotionMatch)}</td>
                <td>${bar(t.libraryFitScore)}</td>
              </tr>`).join("") || '<tr><td colspan="7" style="text-align:center;opacity:0.5">No V11 candidate diagnostics returned</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="dp-table-legend">These V11 scores order the pool V3.1 receives — they do not determine final selection. See Decision Trace above.</div>
    </div>`;

  // ── Final playlist genre composition ──────────────────────────────────────
  const finalTracks = result.tracks || [];
  const total = finalTracks.length || 1;
  const genreDist = finalGenreDistributionEntries(result);
  const compositionHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎼 Final Playlist Genre Composition</div>
      ${genreDist.length ? `
        <div class="dp-composition">
          ${genreDist.map(([g,n]) => {
            const pct = Math.round((n / total) * 100);
            const col = genreColors[g] || "#4b5563";
            return `<div class="dp-comp-row">
              <span class="dp-comp-genre" style="color:${col}">${esc(g)}</span>
              <div class="dp-comp-bar-wrap"><div class="dp-comp-bar" style="width:${pct}%;background:${col}"></div></div>
              <span class="dp-comp-pct">${n} track${n !== 1 ? "s" : ""} · ${pct}%</span>
            </div>`;
          }).join("")}
        </div>
      ` : '<div class="dp-none">No genre data</div>'}
    </div>`;
  const distributionCard = (title, entries) => `
    <div class="dp-card">
      <div class="dp-card-title">${esc(title)}</div>
      ${entries.length ? `
        <div class="dp-composition">
          ${entries.map(([label, count]) => {
            const pct = Math.round((count / total) * 100);
            return `<div class="dp-comp-row">
              <span class="dp-comp-genre">${esc(label)}</span>
              <div class="dp-comp-bar-wrap"><div class="dp-comp-bar" style="width:${pct}%;background:#4b5563"></div></div>
              <span class="dp-comp-pct">${count} · ${pct}%</span>
            </div>`;
          }).join("")}
        </div>
      ` : '<div class="dp-none">No backend data</div>'}
    </div>`;
  const backendDistributionsHtml = `
    <div class="dp-grid">
      ${distributionCard("Final Era Distribution", backendDistributionEntries(result, "finalEraDistribution"))}
      ${distributionCard("Final Mood Distribution", backendDistributionEntries(result, "finalMoodDistribution"))}
      ${distributionCard("Final Energy Distribution", backendDistributionEntries(result, "finalEnergyDistribution"))}
    </div>`;

  return `
  <div class="dp-panel">
    <div class="dp-header">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
      <span>Scoring Diagnostics</span>
      <span class="dp-model-tag">V3.1 Unified Routing</span>
    </div>
    ${basicDebugHtml}
    <div class="dp-sub-title">Advanced Debug</div>
    <div class="dp-grid">
      ${sysHtml}
      ${intentHtml}
      ${diversityHtml}
      ${qualityHtml}
      ${survivalHtml}
    </div>
    ${lanesHtml}
    ${traceHtml}
    ${v11SectionHeader}
    <div class="dp-grid">
      ${v11SceneHtml}
      ${v11PoolHtml}
    </div>
    ${v11CandidatesHtml}
    ${compositionHtml}
    ${backendDistributionsHtml}
  </div>`;
}

// ── Legacy debug panel (V11-only response shape) ──────────────────────────────
function buildDebugPanel(result) {
  // Dispatch to unified panel if new debug object is present
  if (result.debug?.activePipeline) {
    const open = state.showDebug;
    return `
    <div class="dp-toggle-row">
      <button class="dp-toggle-btn" id="debugToggleBtn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
        ${open ? "Hide" : "Show"} Debug Info
        <svg class="dp-chevron ${open ? "open" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <span class="dp-admin-badge">Admin Only</span>
    </div>
    ${open ? buildUnifiedDebugPanel(result, result.debug) : ""}`;
  }

  // Synthesize unified panel from v3Diagnostics (always present, no ?debug=1 needed)
  if (result.v3Diagnostics?.intentDecomposition) {
    const vd = result.v3Diagnostics;
    const synthesized = {
      activePipeline: vd.pipelineVersion || "v3.1_unified_routing",
      v3: {
        ...vd,
        finalDecisionTrace: vd.selectionTrace || [],
        globalDiversityMetrics: {
          postInterleave: {
            genreConcentration: vd.genreConcentration,
            explorationPressure: vd.explorationPressure,
            dominantGenre: vd.dominantGenre,
            dominantEra: vd.dominantEra,
          },
        },
      },
      v11: {
        role: "candidateGeneration",
        semanticResolution: null,
        candidatePool: { librarySize: 0, hybridPoolSize: 0, poolCapped: false },
        topRankedCandidates: [],
        exclusionReasons: {},
        dominantGenres: (result.libraryIntelligence || {}).dominantGenres || [],
        candidateWeights: "semantic:0.40_emotion:0.20_scene:0.15_aesthetic:0.10_library:0.10_genre:0.05",
      },
      systemDiagnostics: {
        v11UsedFor: "candidateGeneration",
        v3UsedFor: "finalSelection",
        debugPanelAligned: true,
      },
      poolInfo: {},
    };
    const open = state.showDebug;
    return `
    <div class="dp-toggle-row">
      <button class="dp-toggle-btn" id="debugToggleBtn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
        ${open ? "Hide" : "Show"} Debug Info
        <svg class="dp-chevron ${open ? "open" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <span class="dp-admin-badge">Admin Only</span>
    </div>
    ${open ? buildUnifiedDebugPanel(result, synthesized) : ""}`;
  }

  const dbg = result.v3Diagnostics ?? result._debug;
  if (!dbg) return "";

  const diag = dbg.scoringDiagnostics || {};
  const sem = dbg.semanticScene || diag.semanticResolution || null;
  const pool = dbg.poolInfo || {};
  const topScored = (diag.topScored || []).slice(0, 20);
  const domGenres = diag.dominantGenres || [];
  const exclusionReasons = diag.exclusionReasons || {};
  const ecoDebug = dbg.ecosystemDebug || {};
  const open = state.showDebug;

  const confPct = sem ? Math.round((sem.confidence || 0) * 100) : 0;
  const confColor = confPct >= 80 ? "#1db954" : confPct >= 55 ? "#f59e0b" : "#ef4444";
  const lockActive = confPct >= 55;

  const sceneHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎯 Detected Scene</div>
      ${sem ? `
        <div class="dp-scene-name">${esc(sem.sceneId || "—").replace(/_/g," ")}</div>
        <div class="dp-scene-meta">
          <span class="dp-badge" style="background:${confColor}20;color:${confColor};border-color:${confColor}40">${confPct}% confidence</span>
          <span class="dp-badge ${lockActive ? "dp-badge--green" : "dp-badge--muted"}">Ecosystem lock ${lockActive ? "active ✓" : "inactive"}</span>
          ${dbg.noLibraryMode ? '<span class="dp-badge dp-badge--purple">Discovery Mode</span>' : ""}
        </div>
      ` : `<div class="dp-none">No scene matched — using generic mood scoring</div>`}
    </div>`;

  const weights = dbg.noLibraryMode
    ? { Semantic: 55, Emotion: 20, Scene: 15, Aesthetic: 10, Library: 0, Genre: 0 }
    : { Semantic: 40, Emotion: 20, Scene: 15, Aesthetic: 10, Library: 10, Genre: 5 };
  const weightBars = Object.entries(weights).map(([k, v]) => `
    <div class="dp-weight-row">
      <span class="dp-weight-label">${k}</span>
      <div class="dp-weight-bar-wrap"><div class="dp-weight-bar" style="width:${v * 1.8}%;background:${v >= 40 ? "#7c3aed" : v >= 20 ? "#1d4ed8" : v >= 10 ? "#0e7490" : "#374151"}"></div></div>
      <span class="dp-weight-pct">${v}%</span>
    </div>`).join("");
  const weightsHtml = `
    <div class="dp-card">
      <div class="dp-card-title">⚖️ Scoring Weights</div>
      <div class="dp-weights">${weightBars}</div>
    </div>`;

  const libSize = pool.librarySize || 0;
  const hybridSize = pool.hybridPoolSize || 0;
  const filteredOut = libSize - hybridSize;
  const filteredPct = libSize > 0 ? Math.round((filteredOut / libSize) * 100) : 0;
  const topExclusions = Object.entries(exclusionReasons).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const poolHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🗂️ Candidate Pool</div>
      <div class="dp-pool-grid">
        <div class="dp-pool-stat"><div class="dp-pool-num">${libSize.toLocaleString()}</div><div class="dp-pool-lbl">Library tracks</div></div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat"><div class="dp-pool-num" style="color:#1db954">${hybridSize.toLocaleString()}</div><div class="dp-pool-lbl">After pre-filter</div></div>
        <div class="dp-pool-arrow">→</div>
        <div class="dp-pool-stat"><div class="dp-pool-num" style="color:#f59e0b">${filteredOut.toLocaleString()}</div><div class="dp-pool-lbl">Removed (${filteredPct}%)</div></div>
      </div>
      ${pool.poolCapped ? '<div class="dp-note">⚡ Pool was capped</div>' : ""}
      ${topExclusions.length ? `
        <div class="dp-sub-title">Exclusion reasons</div>
        <div class="dp-exclusions">
          ${topExclusions.map(([reason, count]) => `<div class="dp-excl-row"><span>${esc(reason)}</span><span class="dp-excl-count">${count}</span></div>`).join("")}
        </div>
      ` : ""}
    </div>`;

  const genreColors = { country:"#d97706",folk:"#16a34a",indie:"#7c3aed",rock:"#dc2626",electronic:"#0891b2",pop:"#db2777",jazz:"#9333ea",soul:"#ea580c",rnb:"#0284c7",hip_hop:"#16a34a",blues:"#2563eb",metal:"#6b7280",classical:"#b45309",reggae:"#15803d",latin:"#c2410c" };
  const genreBubbles = domGenres.slice(0, 8).map(g =>
    `<span class="dp-genre-chip" style="background:${(genreColors[g]||"#4b5563")}20;color:${genreColors[g]||"#9ca3af"};border-color:${(genreColors[g]||"#4b5563")}40">${esc(g)}</span>`
  ).join("");
  const genresHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎵 Dominant Genres in Library</div>
      <div class="dp-genre-chips">${genreBubbles || '<span class="dp-none">No library genre diagnostics returned</span>'}</div>
    </div>`;

  const bar = (v) => { const pct = Math.round((v || 0) * 100); const col = pct >= 70 ? "#1db954" : pct >= 40 ? "#f59e0b" : "#ef4444"; return `<div class="dp-score-bar-wrap" title="${pct}%"><div class="dp-score-bar" style="width:${pct}%;background:${col}"></div><span>${pct}</span></div>`; };
  const trackRows = topScored.map((t, i) => `
    <tr class="dp-track-row ${i % 2 === 0 ? "dp-row-even" : ""}">
      <td class="dp-track-num">${i + 1}</td>
      <td class="dp-track-id">${esc(t.trackId || "").slice(-8)}</td>
      <td class="dp-track-genre"><span class="dp-genre-pill" style="background:${(genreColors[t.genrePrimary]||"#4b5563")}20;color:${genreColors[t.genrePrimary]||"#9ca3af"}">${esc(t.genrePrimary||"(missing)")}</span></td>
      <td>${bar(t.finalScore)}</td><td>${bar(t.sceneScore)}</td><td>${bar(t.emotionMatch)}</td><td>${bar(t.libraryFitScore)}</td>
    </tr>`).join("");
  const topTracksHtml = `
    <div class="dp-card dp-card--wide">
      <div class="dp-card-title">📊 Top Scored Tracks (pre-compose)</div>
      <div class="dp-table-wrap">
        <table class="dp-table">
          <thead><tr><th>#</th><th>Track ID</th><th>Genre</th><th>Final</th><th>Scene</th><th>Emotion</th><th>Library</th></tr></thead>
          <tbody>${trackRows || '<tr><td colspan="7" style="text-align:center;opacity:0.5">No pre-compose track diagnostics returned</td></tr>'}</tbody>
        </table>
      </div>
      <div class="dp-table-legend">Each bar = 0–100. Final score drives track selection.</div>
    </div>`;

  const finalTracks = result.tracks || [];
  const total = finalTracks.length || 1;
  const genreDist = finalGenreDistributionEntries(result);
  const compositionHtml = `
    <div class="dp-card">
      <div class="dp-card-title">🎼 Final Playlist Genre Composition</div>
      ${genreDist.length ? `
        <div class="dp-composition">
          ${genreDist.map(([g, n]) => {
            const pct = Math.round((n / total) * 100);
            const col = genreColors[g] || "#4b5563";
            return `<div class="dp-comp-row">
              <span class="dp-comp-genre" style="color:${col}">${esc(g)}</span>
              <div class="dp-comp-bar-wrap"><div class="dp-comp-bar" style="width:${pct}%;background:${col}"></div></div>
              <span class="dp-comp-pct">${n} track${n !== 1 ? "s" : ""} · ${pct}%</span>
            </div>`;
          }).join("")}
        </div>
        ${sem && lockActive ? `
          <div class="dp-note dp-note--${genreDist[0] && sem.sceneId && genreDist[0][0] !== "(missing)" ? "green" : "amber"}">
            Ecosystem target: ≥${Math.round((ecoDebug?.ecosystemFloor || 0.70) * 100)}% from scene genres
          </div>
        ` : ""}
      ` : '<div class="dp-none">Tracks without genre data</div>'}
    </div>`;
  const distributionCard = (title, entries) => `
    <div class="dp-card">
      <div class="dp-card-title">${esc(title)}</div>
      ${entries.length ? `
        <div class="dp-composition">
          ${entries.map(([label, count]) => {
            const pct = Math.round((count / total) * 100);
            return `<div class="dp-comp-row">
              <span class="dp-comp-genre">${esc(label)}</span>
              <div class="dp-comp-bar-wrap"><div class="dp-comp-bar" style="width:${pct}%;background:#4b5563"></div></div>
              <span class="dp-comp-pct">${count} · ${pct}%</span>
            </div>`;
          }).join("")}
        </div>
      ` : '<div class="dp-none">No backend data</div>'}
    </div>`;
  const backendDistributionsHtml = `
    <div class="dp-grid">
      ${distributionCard("Final Era Distribution", backendDistributionEntries(result, "finalEraDistribution"))}
      ${distributionCard("Final Mood Distribution", backendDistributionEntries(result, "finalMoodDistribution"))}
      ${distributionCard("Final Energy Distribution", backendDistributionEntries(result, "finalEnergyDistribution"))}
    </div>`;

  return `
  <div class="dp-toggle-row">
    <button class="dp-toggle-btn" id="debugToggleBtn">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
      ${open ? "Hide" : "Show"} Debug Info
      <svg class="dp-chevron ${open ? "open" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <span class="dp-admin-badge">Admin Only</span>
  </div>
  ${open ? `
  <div class="dp-panel">
    <div class="dp-header">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
      <span>Scoring Diagnostics</span>
      <span class="dp-model-tag">${esc(diag.scoringModel || dbg.scoringWeights || "—")}</span>
    </div>
    <div class="dp-grid">
      ${sceneHtml}
      ${weightsHtml}
      ${poolHtml}
      ${genresHtml}
    </div>
    ${topTracksHtml}
    ${compositionHtml}
    ${backendDistributionsHtml}
  </div>
  ` : ""}`;
}

// ── Mood panel updater (reactive) ─────────────────────────────────────────────
let _moodPreviewTimer = null;

function clearIntentPreviewStrip() {
  const strip = document.getElementById("intentPreviewStrip");
  if (strip) {
    strip.hidden = true;
    strip.innerHTML = "";
  }
  state.preview = null;
}

function updateMoodPanel(text) {
  const statusEl = document.getElementById("moodStatus");

  if (text.length <= 3) {
    if (statusEl) {
      document.getElementById("moodGlow")?.classList.remove("active");
      statusEl.textContent = "Awaiting input…";
      MOOD_BAR_DEFS.forEach((b) => {
        const el = document.getElementById(b.id);
        const lb = document.getElementById(`${b.id}-label`);
        if (el) el.style.width = "0%";
        if (lb) lb.textContent = "—";
      });
      document.querySelectorAll(".mood-tag").forEach((t) => { t.style.opacity = "0.2"; });
      const style = document.getElementById("moodStyleText");
      if (style) { style.style.opacity = "0"; }
      const scenePanel = document.getElementById("moodScenePanel");
      if (scenePanel) scenePanel.style.display = "none";
    }
    clearTimeout(_moodPreviewTimer);
    if (moodPreviewAbort) moodPreviewAbort.abort();
    clearIntentPreviewStrip();
    return;
  }

  if (statusEl) {
    document.getElementById("moodGlow")?.classList.add("active");
    statusEl.textContent = "Reading the moment…";

    const mood = analyzeMoodFromText(text);

    MOOD_BAR_DEFS.forEach((b) => {
      const val = mood[b.key];
      const el = document.getElementById(b.id);
      const lb = document.getElementById(`${b.id}-label`);
      if (el) el.style.width = val + "%";
      if (lb) lb.textContent = moodLevelLabel(val);
    });

    const tagsEl = document.getElementById("moodTags");
    if (tagsEl) {
      tagsEl.innerHTML = mood.tags.map((tag, i) =>
        `<span class="mood-tag" style="opacity:1;transition:opacity 0.4s ${i * 0.07}s">${esc(tag)}</span>`
      ).join("");
    }

    const styleEl = document.getElementById("moodStyleText");
    if (styleEl) {
      styleEl.textContent = mood.style;
      styleEl.style.opacity = "1";
    }
  }

  clearTimeout(_moodPreviewTimer);
  _moodPreviewTimer = setTimeout(() => fetchScenePreview(text), 400);
}

async function fetchScenePreview(text) {
  const requestId = ++moodPreviewRequestId;
  if (moodPreviewAbort) moodPreviewAbort.abort();
  moodPreviewAbort = new AbortController();
  try {
    const r = await api(`/generate/preview?vibe=${encodeURIComponent(text)}`, {
      signal: moodPreviewAbort.signal,
    });
    const currentText = document.getElementById("vibeInput")?.value.trim() || "";
    if (requestId !== moodPreviewRequestId || currentText !== text.trim()) return;
    if (r.ok && r.data) {
      updateMoodPanelFromServer(r.data);
      updateIntentPreviewStrip(r.data);
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    // Silently ignore preview errors — client-side mood bars remain
  }
}

function updateMoodPanelFromServer(data) {
  const scenePanel = document.getElementById("moodScenePanel");
  const sceneName = document.getElementById("moodSceneName");
  const sceneBadges = document.getElementById("moodSceneBadges");
  const altsRow = document.getElementById("moodAltsRow");
  const altsEl = document.getElementById("moodAlts");

  if (!scenePanel) return;

  if (!data.scene) {
    // No scene detected — show generic status
    const statusEl = document.getElementById("moodStatus");
    if (statusEl) statusEl.textContent = "Moment analyzed";
    document.getElementById("moodGlow")?.classList.remove("active");
    scenePanel.style.display = "none";
    return;
  }

  const confPct = Math.round((data.scene.confidence ?? 0) * 100);
  const confColor = confPct >= 80 ? "#1db954" : confPct >= 60 ? "#f59e0b" : "#a78bfa";

  // Update status line with scene name
  const statusEl = document.getElementById("moodStatus");
  if (statusEl) statusEl.textContent = data.scene.label || data.scene.id;

  // Scene name (formatted)
  if (sceneName) {
    sceneName.textContent = data.scene.label || data.scene.id.replace(/_/g, " ");
  }

  // Badges: confidence + era (if detected)
  if (sceneBadges) {
    let badgesHtml = `<span class="mood-scene-badge" style="background:${confColor}18;color:${confColor};border:1px solid ${confColor}30">${confPct}% match</span>`;
    if (data.era?.decade) {
      badgesHtml += `<span class="mood-scene-badge mood-scene-badge--era">${data.era.decade}</span>`;
    }
    if (data.scene.primaryGenres?.length) {
      badgesHtml += data.scene.primaryGenres.slice(0, 2).map((g) =>
        `<span class="mood-scene-badge mood-scene-badge--genre">${esc(g)}</span>`
      ).join("");
    }
    sceneBadges.innerHTML = badgesHtml;
  }

  // Alternative scenes
  if (altsRow && altsEl && data.alternatives?.length) {
    altsEl.innerHTML = data.alternatives.map((alt) => {
      const altConf = Math.round((alt.confidence ?? 0) * 100);
      return `<span class="mood-alt-chip" title="${altConf}% match">${esc(alt.label || alt.id.replace(/_/g," "))}</span>`;
    }).join("");
    altsRow.style.display = "block";
  } else if (altsRow) {
    altsRow.style.display = "none";
  }

  // Show the panel
  scenePanel.style.display = "block";
  document.getElementById("moodGlow")?.classList.remove("active");
}

// ── Event wiring ──────────────────────────────────────────────────────────────
function trapOnboardingFocus() {
  const overlay = document.getElementById("onboardingOverlay");
  if (!overlay) return;
  const focusables = () =>
    [...overlay.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((el) => !el.disabled);
  const onKey = (e) => {
    if (e.key === "Escape") {
      markOnboardingDone();
      _savedPrefs.onboardingDone = true;
      document.removeEventListener("keydown", onKey);
      renderApp();
      return;
    }
    if (e.key !== "Tab") return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey);
  focusables()[0]?.focus();
}

function wireAppEvents() {
  // Profile dropdown
  document.getElementById("profileBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.profileOpen = !state.profileOpen;
    document.getElementById("profileDropdown")?.classList.toggle("open", state.profileOpen);
    const btn = document.getElementById("profileBtn");
    if (btn) btn.setAttribute("aria-expanded", state.profileOpen ? "true" : "false");
  });
  document.getElementById("navMenuToggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const nav = document.getElementById("navRight");
    const collapsed = nav?.classList.toggle("nav-right--collapsed");
    const toggle = document.getElementById("navMenuToggle");
    if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
  if (!globalAppListenersWired) {
    document.addEventListener("click", (e) => {
      if (!document.getElementById("navRight")?.contains(e.target) && !document.getElementById("navMenuToggle")?.contains(e.target)) {
        document.getElementById("navRight")?.classList.add("nav-right--collapsed");
        document.getElementById("navMenuToggle")?.setAttribute("aria-expanded", "false");
      }
      if (!document.getElementById("profileWrap")?.contains(e.target)) {
        state.profileOpen = false;
        document.getElementById("profileDropdown")?.classList.remove("open");
        document.getElementById("profileBtn")?.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("vibeInput")?.focus();
        document.getElementById("vibeInput")?.select();
      }
      if (e.key === "Escape" && state.generating && !state.generationCancelRequested) {
        cancelGeneration();
      }
    });
    root.addEventListener("click", (e) => {
      if (e.target.closest("#cancelGenerationBtn, [data-action='cancel-generation']")) {
        e.preventDefault();
        cancelGeneration();
        return;
      }
      const recentBtn = e.target.closest("[data-recent-prompt]");
      if (recentBtn) {
        const prompt = recentBtn.getAttribute("data-recent-prompt");
        const input = document.getElementById("vibeInput");
        if (input && prompt) {
          input.value = prompt;
          state.draftVibe = prompt;
          input.dispatchEvent(new Event("input"));
          input.focus();
        }
        return;
      }
      const clarificationBtn = e.target.closest("[data-clarification-prompt]");
      if (clarificationBtn) {
        const prompt = clarificationBtn.getAttribute("data-clarification-prompt");
        const sceneId = clarificationBtn.getAttribute("data-clarification-scene");
        const input = document.getElementById("vibeInput");
        if (input && prompt) {
          input.value = prompt;
          state.draftVibe = prompt;
          if (sceneId) state.selectedSceneId = sceneId;
          state.error = null;
          state.errorKind = null;
          input.dispatchEvent(new Event("input"));
          input.focus();
        }
        return;
      }
      const momentBtn = e.target.closest("[data-activity-moment]");
      if (momentBtn) {
        const prompt = momentBtn.getAttribute("data-activity-moment");
        const input = document.getElementById("vibeInput");
        if (input && prompt) {
          input.value = prompt;
          state.draftVibe = prompt;
          input.dispatchEvent(new Event("input"));
          input.focus();
        }
        return;
      }
      const steerBtn = e.target.closest("[data-steer-id]");
      if (steerBtn) {
        const steerId = steerBtn.getAttribute("data-steer-id");
        const chip = PROMPT_STEER_CHIPS.find((row) => row.id === steerId);
        if (!chip) return;
        const input = document.getElementById("vibeInput");
        const base = state.lastResult?.vibe || input?.value?.trim() || "";
        if (!base) return;
        if (chip.action === "new-mix") {
          if (input) input.value = base;
          void generate({ forceNewMix: true });
          return;
        }
        if (input) {
          input.value = `${base} — ${chip.promptSuffix}`;
          input.dispatchEvent(new Event("input"));
          void generate({ keepFailureSession: true });
        }
      }
    });
    globalAppListenersWired = true;
  }

  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("deleteAccountBtn")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete all your Kwalify data (playlists, liked-song cache, feedback)? This cannot be undone.", { title: "Delete account data", confirmLabel: "Delete everything", danger: true }))) return;
    try {
      const r = await api("/auth/account", { method: "DELETE" });
      if (r.ok) {
        window.location.href = "/";
        return;
      }
      showToast(userFacingApiError(r, "Could not delete your data. Try again."), "error");
    } catch {
      showToast("Could not delete your data. Check your connection.", "error");
    }
  });
  document.getElementById("copyShareLinkBtn")?.addEventListener("click", async (e) => {
    const slug = e.currentTarget?.dataset?.shareSlug;
    if (!slug) return;
    const url = `${window.location.origin}/p/${slug}`;
    try {
      await copyTextToClipboard(url);
      showToast("Link copied to clipboard.", "success");
    } catch {
      showToast("Could not copy link.", "error");
    }
  });
  document.getElementById("settingsLinkBtn")?.addEventListener("click", () => {
    window.location.href = "/settings";
  });
  document.getElementById("profileSyncBtn")?.addEventListener("click", () => {
    state.profileOpen = false;
    renderApp();
    triggerSync(false);
  });
  document.getElementById("themeToggleBtn")?.addEventListener("click", onToggleThemeClick);

  // Sync buttons
  document.getElementById("syncChip")?.addEventListener("click", () => triggerSync(false));
  document.getElementById("deltaSyncBtn")?.addEventListener("click", () => triggerSync(false));
  document.getElementById("fullSyncBtn")?.addEventListener("click", () => triggerSync(true));

  document.getElementById("generateBtn")?.addEventListener("click", generate);
  document.getElementById("retryGenerateBtn")?.addEventListener("click", () => {
    state.error = null;
    state.errorDetails = null;
    state.errorKind = null;
    generate();
  });
  document.getElementById("busyRetryNowBtn")?.addEventListener("click", () => {
    clearBusyRetry();
    state.error = null;
    state.errorDetails = null;
    state.errorKind = null;
    generate();
  });
  document.getElementById("tryDiscoveryModeBtn")?.addEventListener("click", () => {
    state.error = null;
    state.errorKind = null;
    generate({ forceDiscoveryMode: true, keepFailureSession: true });
  });
  document.getElementById("refinePromptBtn")?.addEventListener("click", () => {
    state.error = null;
    state.errorKind = null;
    state.libraryInsufficient = null;
    const input = document.getElementById("vibeInput");
    input?.focus();
    input?.select();
  });
  document.getElementById("dismissLibraryInsufficientBtn")?.addEventListener("click", async () => {
    await reportFailureOutcome("abandoned");
    state.error = null;
    state.errorDetails = null;
    state.errorKind = null;
    renderApp();
  });
  document.getElementById("progressDetailsToggle")?.addEventListener("click", () => {
    state.progressExpanded = !state.progressExpanded;
    renderApp();
  });

  // No-library mode toggle
  document.getElementById("noLibraryToggle")?.addEventListener("click", () => {
    state.noLibraryMode = !state.noLibraryMode;
    saveUserPref("discoveryMode", state.noLibraryMode);
    renderApp();
  });
  document.getElementById("noLibraryToggle")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    state.noLibraryMode = !state.noLibraryMode;
    saveUserPref("discoveryMode", state.noLibraryMode);
    renderApp();
  });

  document.querySelectorAll(".library-chapter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-chapter-prompt");
      const input = document.getElementById("vibeInput");
      if (input && prompt) {
        input.value = prompt;
        input.dispatchEvent(new Event("input"));
        input.focus();
      }
    });
  });

  const vibeInput = document.getElementById("vibeInput");
  const charCount = document.getElementById("charCount");
  let interpretTimer = null;

  vibeInput?.addEventListener("input", () => {
    const text = vibeInput.value;
    charCount.textContent = text.length;
    clearTimeout(interpretTimer);
    updateMoodPanel(text);
  });

  vibeInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); }
  });

  document.getElementById("lengthSlider")?.addEventListener("input", (e) => {
    state.length = Number(e.target.value);
    saveUserPref("length", state.length);
    document.getElementById("lengthLabel").textContent = `${state.length} tracks`;
  });

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      saveUserPref("mode", state.mode);
      document.querySelectorAll(".mode-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.mode === state.mode)
      );
    });
  });

  document.querySelectorAll(".familiarity-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.familiarity = btn.dataset.familiarity;
      try { localStorage.setItem("kwalify-familiarity", state.familiarity); } catch { /* ignore */ }
      document.querySelectorAll(".familiarity-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.familiarity === state.familiarity)
      );
    });
  });

  document.querySelectorAll(".delete-btn[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => deletePlaylist(Number(btn.dataset.id)));
  });

  document.getElementById("onboardingNext")?.addEventListener("click", () => {
    if ((state.onboardingStep || 1) >= 3) {
      markOnboardingDone();
      _savedPrefs.onboardingDone = true;
      renderApp();
      return;
    }
    state.onboardingStep = (state.onboardingStep || 1) + 1;
    renderApp();
  });
  document.getElementById("onboardingBack")?.addEventListener("click", () => {
    state.onboardingStep = Math.max(1, (state.onboardingStep || 1) - 1);
    renderApp();
  });
  document.getElementById("onboardingSkip")?.addEventListener("click", () => {
    markOnboardingDone();
    _savedPrefs.onboardingDone = true;
    renderApp();
  });

  trapOnboardingFocus();

  document.querySelectorAll(".feedback-track-btn[data-track-index]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index = Number(btn.dataset.trackIndex);
      const action = btn.dataset.action;
      const track = state.lastResult?.tracks?.[index];
      if (!track || !action) return;
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = action === "like" ? "♥" : action === "replace" ? "…" : action === "undo" ? "Undo" : "✓";
      const context = { vibe: document.getElementById("vibeInput")?.value || state.lastResult?.vibe || "" };
      try {
        if (action === "undo") {
          await sendFeedbackEvent(track, "undo", btn.dataset.playlistId || null, context);
          btn.closest(".track-row")?.style.setProperty("opacity", "1");
          btn.style.display = "none";
          btn.disabled = false;
          return;
        }
        if (action === "replace") {
          const replacement = await replacePlaylistTrack(btn.dataset.playlistId || null, track, context);
          if (replacement && state.lastResult?.tracks) {
            state.lastResult.tracks[index] = replacement;
            renderApp();
          }
          return;
        }
        await sendFeedbackEvent(track, action, btn.dataset.playlistId || null, context);
        if (action === "skip") await sendImplicitFeedback(track, 0, true, "skip");
        if (action === "like") await sendImplicitFeedback(track, track.durationMs || 0, false, "manual_save");
        const row = btn.closest(".track-row");
        const message = action === "like"
          ? "Liked - more like this"
          : action === "skip"
            ? "Skipped - less like this"
            : action === "dislike"
              ? "Thumbs down - similar picks reduced"
              : action === "remove"
                ? "Removed from future playlists"
                : "Feedback saved";
        row?.setAttribute("data-feedback-note", message);
        btn.title = message;
        if (action === "remove" || action === "dislike") {
          row?.style.setProperty("opacity", "0.45");
          const undo = row?.querySelector(".undo-feedback-btn");
          if (undo) undo.style.display = "inline-flex";
        }
      } catch (_) {
        btn.disabled = false;
        btn.textContent = originalText;
        showToast("Feedback could not be saved. Try again.", "error");
      }
    });
  });

  document.getElementById("debugToggleBtn")?.addEventListener("click", () => {
    state.showDebug = !state.showDebug;
    const panel = document.querySelector(".dp-panel");
    const btn = document.getElementById("debugToggleBtn");
    const chevron = btn?.querySelector(".dp-chevron");
    const label = btn?.childNodes;
    if (state.showDebug) {
      if (btn) btn.innerHTML = btn.innerHTML.replace("Show", "Hide");
      chevron?.classList.add("open");
      if (!panel) {
        const wrap = btn?.closest(".dp-toggle-row")?.parentElement;
        if (wrap) {
          const existing = wrap.querySelector(".dp-panel");
          if (!existing && state.lastResult) {
            const tmp = document.createElement("div");
            tmp.innerHTML = buildDebugPanel(state.lastResult);
            const newPanel = tmp.querySelector(".dp-panel");
            if (newPanel) wrap.appendChild(newPanel);
          }
        }
      }
      document.querySelector(".dp-panel")?.style.setProperty("display", "block");
    } else {
      if (btn) btn.innerHTML = btn.innerHTML.replace("Hide", "Show");
      chevron?.classList.remove("open");
      document.querySelector(".dp-panel")?.style.setProperty("display", "none");
    }
  });

  // ── Explain This Playlist tab toggle ──────────────────────────────────────
  document.getElementById("tabPlaylist")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.showExplain) return;
    state.showExplain = false;
    renderApp();
  });
  document.getElementById("tabExplain")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (state.showExplain) return;
    state.showExplain = true;
    renderApp();
  });

}

// ── Actions ───────────────────────────────────────────────────────────────────
async function logout() {
  await api("/auth/logout", { method: "POST" }).catch(() => null);
  Object.assign(state, {
    user: null, cacheStatus: null, librarySummary: null,
    playlists: [], history: [], lastResult: null, error: null,
    errorKind: null,
  });
  renderLanding();
}

async function triggerSync(full = false) {
  const btn = full
    ? document.getElementById("fullSyncBtn")
    : document.getElementById("deltaSyncBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  const result = await api("/spotify/sync", { method: "POST", body: JSON.stringify({ full }) })
    .catch((err) => ({ ok: false, status: 0, data: { error: err.message } }));
  if (!result.ok) {
    state.error = userFacingApiError(result, "Could not start sync. Please try again.");
    state.errorKind = "sync";
    renderApp();
  } else {
    state.error = null;
    state.errorKind = null;
    await pollStatus();
  }
}

let syncEventSource = null;

function applyCacheStatus(data) {
  if (!data || typeof data !== "object") return;
  state.cacheStatus = { ...(state.cacheStatus ?? {}), ...data };
}

function stopSyncStream() {
  if (syncEventSource) {
    syncEventSource.close();
    syncEventSource = null;
  }
}

function startSyncStream() {
  if (syncEventSource || typeof EventSource === "undefined") return;
  syncEventSource = new EventSource("/api/spotify/sync/stream", { withCredentials: true });
  syncEventSource.addEventListener("sync", (event) => {
    try {
      applyCacheStatus(JSON.parse(event.data));
      renderApp();
      if (!state.cacheStatus?.isSyncing) stopSyncStream();
    } catch {
      stopSyncStream();
      void pollStatus();
    }
  });
  syncEventSource.onerror = () => {
    stopSyncStream();
    void pollStatus();
  };
}

async function pollStatus() {
  const [csRes, lsRes] = await Promise.all([
    api("/spotify/cache-status").catch((err) => ({ ok: false, status: 0, data: { error: err.message } })),
    api("/library/summary").catch((err) => ({ ok: false, status: 0, data: { error: err.message } })),
  ]);
  if (csRes.ok) applyCacheStatus(csRes.data);
  if (lsRes.ok) state.librarySummary = lsRes.data;
  if (!csRes.ok || !lsRes.ok) {
    state.error = "Could not refresh library status. Please refresh if this persists.";
    state.errorKind = "status";
  } else if (state.errorKind === "status") {
    state.error = null;
    state.errorDetails = null;
    state.errorKind = null;
  }
  renderApp();
  if (state.cacheStatus?.isSyncing) {
    startSyncStream();
    setTimeout(pollStatus, 5000);
  } else {
    stopSyncStream();
  }
}

async function loadPlaylists() {
  const [plRes, histRes] = await Promise.all([
    api("/playlists?limit=6").catch((err) => ({ ok: false, status: 0, data: { error: err.message } })),
    api("/history").catch((err) => ({ ok: false, status: 0, data: { error: err.message } })),
  ]);
  if (plRes.ok) state.playlists = plRes.data.playlists || [];
  if (histRes.ok) state.history = Array.isArray(histRes.data) ? histRes.data : [];
}

async function deletePlaylist(id) {
  if (!(await confirmDialog("Delete this playlist?", { title: "Delete playlist", confirmLabel: "Delete", danger: true }))) return;
  const r = await api(`/playlists/${id}`, { method: "DELETE" })
    .catch((err) => ({ ok: false, status: 0, data: { error: err.message } }));
  if (r.ok) {
    state.playlists = state.playlists.filter((p) => p.id !== id);
    renderApp();
  } else {
    state.error = userFacingApiError(r, "Could not delete that playlist. Please try again.");
    state.errorKind = "playlist";
    renderApp();
  }
}

function stopGenerationStatusPolling() {
  if (generationStatusTimer) {
    clearTimeout(generationStatusTimer);
    generationStatusTimer = null;
  }
  if (generationUiTimer) {
    clearInterval(generationUiTimer);
    generationUiTimer = null;
  }
  if (generationStuckTimer) {
    clearInterval(generationStuckTimer);
    generationStuckTimer = null;
  }
}

function startGenerationStuckWatchdog(runId) {
  if (generationStuckTimer) clearInterval(generationStuckTimer);
  generationStuckTimer = setInterval(() => {
    if (!state.generating || runId !== state.generationRunId) return;
    const elapsedMs = generationElapsedMs(state.generationProgress || {});
    if (elapsedMs < 70000) return;
    if (state.generationProgress && !state.generationProgress.stuckHint) {
      state.generationProgress.stuckHint = true;
      refreshGenerationProgressDom();
    }
  }, 5000);
}

function cancelGeneration() {
  if (!state.generating || state.generationCancelRequested) return;
  const requestId = state.generationProgress?.requestId || null;
  state.generationCancelRequested = true;
  state.generationRunId += 1;
  state.error = null;
  state.errorDetails = null;
  state.errorKind = null;
  stopGenerationStatusPolling();
  activeGenerationAbort?.abort();
  state.generating = false;
  state.generationProgress = null;
  state.generationLivePreview = null;
  state.partialPreviewStartedAt = null;
  showToast("Generation cancelled", "info");
  renderApp();
  api("/generate/cancel", {
    method: "POST",
    timeoutMs: 8000,
    body: JSON.stringify(requestId ? { requestId } : {}),
  }).catch(() => null);
}

function startGenerationStatusPolling() {
  stopGenerationStatusPolling();
  generationUiTimer = setInterval(() => {
    if (!state.generating) return;
    refreshGenerationProgressDom();
  }, 1000);
  const tick = async () => {
    if (!state.generating) return;
    try {
      const r = await api(`/generate/status?t=${Date.now()}`, { cache: "no-store" });
      if (r.ok && r.data?.active) {
        const nextPartialTracks = Array.isArray(r.data.partialTracks) ? r.data.partialTracks : [];
        if (nextPartialTracks.length > 0 && !state.partialPreviewStartedAt) {
          state.partialPreviewStartedAt = Date.now();
        }
        const previousStageIndex = typeof state.generationProgress?.stageIndex === "number"
          ? state.generationProgress.stageIndex
          : 0;
        const incomingStageIndex = typeof r.data.stageIndex === "number" ? r.data.stageIndex : 0;
        const nextStageIndex = Math.max(previousStageIndex, incomingStageIndex);
        const staleStagePayload = incomingStageIndex < previousStageIndex;
        state.generationProgress = {
          phase: staleStagePayload ? state.generationProgress?.phase || "starting" : r.data.phase || "starting",
          stage: staleStagePayload
            ? state.generationProgress?.stage || GENERATION_STAGES[nextStageIndex] || null
            : r.data.stage || GENERATION_STAGES[nextStageIndex] || null,
          stageIndex: nextStageIndex,
          stageCount: typeof r.data.stageCount === "number" ? r.data.stageCount : GENERATION_STAGES.length,
          stageDetail: staleStagePayload ? state.generationProgress?.stageDetail || null : r.data.stageDetail || null,
          requestId: r.data.requestId || null,
          startedAt: typeof r.data.startedAt === "number" ? r.data.startedAt : Date.now(),
          clientStartedAt: state.generationProgress?.clientStartedAt || Date.now(),
          elapsedMs: typeof r.data.elapsedMs === "number" ? r.data.elapsedMs : null,
          lastUpdatedAt: typeof r.data.lastUpdatedAt === "number" ? r.data.lastUpdatedAt : null,
          displayIndex: typeof state.generationProgress?.displayIndex === "number" ? state.generationProgress.displayIndex : 0,
          fallbackEligibleAt: typeof r.data.fallbackEligibleAt === "number" ? r.data.fallbackEligibleAt : null,
          partialTracks: nextPartialTracks.length ? nextPartialTracks : (state.generationProgress?.partialTracks || []),
          spotifyPlaylistUrl: r.data.spotifyPlaylistUrl || state.generationProgress?.spotifyPlaylistUrl || null,
          sceneLabel: r.data.sceneLabel || state.generationProgress?.sceneLabel || null,
          playlistName: r.data.playlistName || state.generationProgress?.playlistName || null,
          wrappingUp: r.data.phase === "done",
          stuckHint: state.generationProgress?.stuckHint || false,
        };
        const hadLivePreview = !!state.generationLivePreview;
        updateGenerationLivePreview();
        if (state.generationLivePreview && !hadLivePreview) {
          renderApp();
        } else if (r.data.phase === "done" || nextPartialTracks.length > 0 || r.data.spotifyPlaylistUrl) {
          refreshGenerationProgressDom();
        } else {
          renderApp();
        }
      } else if (r.ok && state.generating) {
        const partialTracks = state.generationProgress?.partialTracks?.length
          ? state.generationProgress.partialTracks
          : (Array.isArray(r.data?.partialTracks) ? r.data.partialTracks : []);
        if (!r.data?.active && partialTracks.length > 0) {
          state.generationProgress = {
            ...(state.generationProgress || {}),
            partialTracks,
            spotifyPlaylistUrl: r.data.spotifyPlaylistUrl || state.generationProgress?.spotifyPlaylistUrl || null,
            sceneLabel: r.data.sceneLabel || state.generationProgress?.sceneLabel || null,
            playlistName: r.data.playlistName || state.generationProgress?.playlistName || null,
            wrappingUp: true,
            phase: "done",
            stage: "Finalizing playlist",
            stageDetail: "Loading your playlist here",
            stuckHint: state.generationProgress?.stuckHint || false,
          };
          updateGenerationLivePreview();
          renderApp();
        }
      }
    } catch {
      // Progress is best-effort; the generate request still owns success/failure.
    } finally {
      if (state.generating) generationStatusTimer = setTimeout(tick, 350);
    }
  };
  generationStatusTimer = setTimeout(tick, 75);
}

async function reportFailureOutcome(outcome) {
  const failureSessionId = state.pendingFailureSessionId;
  if (!failureSessionId) return;
  try {
    await api("/generate/failure-outcome", {
      method: "POST",
      body: JSON.stringify({ failureSessionId, outcome }),
    });
  } catch {
    // Outcome telemetry is best-effort.
  }
  if (outcome === "abandoned" || outcome === "discovery_rejected") {
    state.pendingFailureSessionId = null;
    state.libraryInsufficient = null;
  }
}

function clearLibraryInsufficientState() {
  state.pendingFailureSessionId = null;
  state.libraryInsufficient = null;
  state.failurePrompt = null;
}

function handleLibraryInsufficientResponse(data, prompt) {
  state.error = data?.error || "Your liked songs can't confidently satisfy this request.";
  state.errorDetails = data || null;
  state.errorKind = "generation";
  state.pendingFailureSessionId = data?.failureSessionId || data?.requestId || null;
  state.failurePrompt = prompt || null;
  state.libraryInsufficient = {
    code: data?.code || data?.reason || "LIBRARY_INSUFFICIENT_FOR_PROMPT",
    limitingFactors: data?.limitingFactors || data?.libraryCapability?.limitingFactors || [],
    combinedConfidence: data?.combinedConfidence ?? null,
    canUseDiscoveryMode: data?.canUseDiscoveryMode === true || data?.suggestDiscoveryMode === true,
  };
}

let busyRetryTimer = null;

function clearBusyRetry() {
  if (busyRetryTimer) {
    clearInterval(busyRetryTimer);
    busyRetryTimer = null;
  }
  state.busySecondsLeft = null;
}

// Countdown then auto-retry a generation that was rejected because the server
// was busy / rate-limited. The prompt stays in the input the whole time.
function scheduleBusyRetry(seconds) {
  clearBusyRetry();
  state.busySecondsLeft = Math.max(1, Math.round(seconds));
  busyRetryTimer = setInterval(() => {
    state.busySecondsLeft = Math.max(0, (state.busySecondsLeft ?? 0) - 1);
    const countdownEl = document.getElementById("busyCountdown");
    if (countdownEl) countdownEl.textContent = String(state.busySecondsLeft);
    if (state.busySecondsLeft <= 0) {
      clearBusyRetry();
      if (state.errorKind === "busy" && !state.generating) {
        state.error = null;
        state.errorKind = null;
        state.errorDetails = null;
        void generate();
      }
    }
  }, 1000);
}

async function generate(opts = {}) {
  const vibeInput = document.getElementById("vibeInput");
  const vibe = vibeInput?.value.trim();
  if (!vibe) { vibeInput?.focus(); return; }
  if (state.generating) return;
  clearBusyRetry();
  const gate = generateGate();
  if (gate.blocked) {
    showToast(gate.message, "error");
    return;
  }
  if (!isPromptReadyForGenerate(state.preview, vibe, state.selectedSceneId)) {
    showToast(
      state.preview?.requiresClarification
        ? "Add more detail, pick a suggestion below, or use at least four words."
        : "This prompt needs more context before generating.",
      "error",
    );
    return;
  }
  const previousResult = state.lastResult;
  const samePromptRegenerate =
    !!previousResult &&
    String(previousResult.vibe || previousResult.prompt || "").trim().toLowerCase() === vibe.toLowerCase();
  const varietyBoost = opts.forceNewMix === true || samePromptRegenerate;

  state.generating = true;
  state.generationCancelRequested = false;
  state.generationLivePreview = null;
  const runId = state.generationRunId + 1;
  state.generationRunId = runId;
  state.requestedNewMix = varietyBoost && samePromptRegenerate;
  state.partialPreviewStartedAt = null;
  state.generationProgress = { phase: "starting", stage: "Initializing", stageIndex: 0, stageCount: GENERATION_STAGES.length, stageDetail: null, requestId: null, startedAt: Date.now(), clientStartedAt: Date.now(), elapsedMs: 0, lastUpdatedAt: null, displayIndex: 0, fallbackEligibleAt: null, partialTracks: [] };
  state.lastResult = null;
  state.error = null;
  state.errorDetails = null;
  state.errorKind = null;
  state.libraryInsufficient = null;
  if (
    state.pendingFailureSessionId &&
    state.failurePrompt &&
    state.failurePrompt.trim().toLowerCase() !== vibe.toLowerCase()
  ) {
    void reportFailureOutcome("abandoned");
  }
  state.showExplain = false;
  state.progressExpanded = false;
  renderApp();
  startGenerationStatusPolling();
  startGenerationStuckWatchdog(runId);

  const savedVibe = vibe;
  const generationAbort = new AbortController();
  activeGenerationAbort = generationAbort;

  try {
    const r = await api(debugModeEnabled() ? "/generate?debug=1" : "/generate", {
      method: "POST",
      signal: generationAbort.signal,
      body: JSON.stringify({
        vibe,
        mode: state.mode,
        familiarity: state.familiarity,
        length: state.length,
        noLibraryMode: opts.forceDiscoveryMode === true ? true : state.noLibraryMode,
        varietyBoost,
        ...(state.selectedSceneId ? { sceneId: state.selectedSceneId } : {}),
        ...(state.pendingFailureSessionId ? { failureSessionId: state.pendingFailureSessionId } : {}),
      }),
    });

    if (r.status === 401) { window.location.href = "/api/auth/login"; return; }

    const libraryInsufficient =
      r.data?.code === "LIBRARY_INSUFFICIENT_FOR_PROMPT" ||
      r.data?.reason === "LIBRARY_INSUFFICIENT_FOR_PROMPT";

    const isServerBusy = r.status === 503 && r.data?.code === "SERVER_BUSY";
    const isRateLimited = r.status === 429 && r.data?.code === "RATE_LIMITED";

    if (libraryInsufficient) {
      handleLibraryInsufficientResponse(r.data, savedVibe);
    } else if (isServerBusy || isRateLimited) {
      const retryAfter = Number(r.data?.retryAfterSeconds ?? r.data?.retry_after ?? 10) || 10;
      state.error = isRateLimited
        ? "You've generated a lot in a short time. Auto-retrying shortly."
        : "The server is finishing other playlists. Auto-retrying shortly.";
      state.errorDetails = r.data || null;
      state.errorKind = "busy";
      state.busyRetryPrompt = savedVibe;
      scheduleBusyRetry(retryAfter);
    } else if (!r.ok) {
      if (r.data?.code === "PROMPT_TOO_VAGUE") {
        state.preview = {
          ...state.preview,
          requiresClarification: true,
          promptConfidence: r.data.promptConfidence || state.preview?.promptConfidence,
          intentClarificationSuggestions: r.data.intentClarificationSuggestions,
          intentClarificationGroups: r.data.intentClarificationGroups,
        };
        state.error = r.data.message || userFacingApiError(r, "Add more detail before generating.");
      } else {
        state.error = userFacingApiError(r, "Generation failed. Please try a broader prompt or Balanced mode.");
      }
      state.errorDetails = r.data || null;
      state.errorKind = "generation";
    } else if (r.data?.success === false) {
      handleLibraryInsufficientResponse(r.data, savedVibe);
    } else if (runId === state.generationRunId && !state.generationCancelRequested) {
      clearLibraryInsufficientState();
      rememberRecentPrompt(savedVibe);
      state.lastResult = {
        ...r.data,
        savedPlaylistId: r.data.playlistId,
        shareSlug: r.data.shareSlug,
        vibe: savedVibe,
        requestedNewMix: state.requestedNewMix && !r.data.cached,
        cached: !!r.data.cached,
      };
      await loadPlaylists();
    }
  } catch (e) {
    if (state.generationCancelRequested && e?.name === "AbortError") {
      state.error = null;
      state.errorKind = null;
    } else if (state.generationCancelRequested) {
      state.error = null;
      state.errorKind = null;
    } else {
      state.error = e?.name === "AbortError"
        ? "Generation timed out. Please try again with a broader prompt."
        : "Generation failed. Please check your connection and try again.";
      state.errorKind = "generation";
    }
    state.errorDetails = null;
  } finally {
    if (activeGenerationAbort === generationAbort) activeGenerationAbort = null;
    stopGenerationStatusPolling();
    if (runId === state.generationRunId) {
      state.generating = false;
      state.generationProgress = null;
      state.generationLivePreview = null;
      state.partialPreviewStartedAt = null;
      state.generationCancelRequested = false;
      state.requestedNewMix = false;
    }
    renderApp();
    const input = document.getElementById("vibeInput");
    if (input) {
      input.value = savedVibe;
      document.getElementById("charCount").textContent = savedVibe.length;
      updateMoodPanel(savedVibe);
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  root.innerHTML = `<div class="loading-shell"><div class="spinner"></div><span>Loading…</span></div>`;

  let meRes;
  try {
    meRes = await api("/auth/me");
  } catch (err) {
    root.innerHTML = `<div class="loading-shell"><span>Could not reach Kwalify. Check your connection and refresh.</span><button id="retryBootBtn" class="btn btn-green" style="display:inline-flex;margin-top:20px;">Retry</button></div>`;
    document.getElementById("retryBootBtn")?.addEventListener("click", boot);
    return;
  }

  if (meRes.status === 401 || !meRes.ok) {
    renderLanding();
    return;
  }

  if (meRes.data?.reauthRequired) {
    renderLanding("Your Spotify session expired. Please reconnect to continue.");
    return;
  }

  state.user = meRes.data;
  try {
    const returnTo = sessionStorage.getItem("returnTo");
    if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      sessionStorage.removeItem("returnTo");
      window.location.href = returnTo;
      return;
    }
  } catch { /* private mode */ }
  state.recentPrompts = loadRecentPrompts();

  const [csRes, lsRes, plRes, histRes, chRes] = await Promise.all([
    api("/spotify/cache-status").catch((err) => ({ ok: false, status: 0, data: { error: err.message } })),
    api("/library/summary").catch((err) => ({ ok: false, status: 0, data: { error: err.message } })),
    api("/playlists?limit=6").catch((err) => ({ ok: false, status: 0, data: { error: err.message } })),
    api("/history").catch((err) => ({ ok: false, status: 0, data: { error: err.message } })),
    api("/library/chapters").catch(() => ({ ok: false, status: 0, data: { chapters: [] } })),
  ]);

  if (csRes.ok) applyCacheStatus(csRes.data);
  if (lsRes.ok) state.librarySummary = lsRes.data;
  if (plRes.ok) state.playlists = plRes.data.playlists || [];
  if (histRes.ok) state.history = Array.isArray(histRes.data) ? histRes.data : [];
  if (chRes.ok && Array.isArray(chRes.data?.chapters)) state.libraryChapters = chRes.data.chapters;
  if (!csRes.ok || !lsRes.ok || !plRes.ok || !histRes.ok) {
    state.error = "Some account data could not load. You can still try generating, or refresh if things look stale.";
    state.errorKind = "status";
  }

  renderApp();
  applyPendingPrompt();

  if (state.cacheStatus?.suggestFullSync && !state.cacheStatus?.isSyncing) {
    showToast("Refreshing your library…");
    api("/spotify/sync", { method: "POST", body: JSON.stringify({ full: true }) }).catch(() => {});
  }

  if (state.cacheStatus?.isSyncing) {
    showToast("Syncing your Spotify library in the background…", "info");
    startSyncStream();
    setTimeout(pollStatus, 5000);
  }
}

boot();
