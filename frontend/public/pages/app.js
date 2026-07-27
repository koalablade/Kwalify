// ── Kwalify · Single app entry point ─────────────────────────────────────────
import { esc, initTheme, fmtDateShort as fmtDate, spiBadge, toggleTheme, showToast, userFacingApiError, confirmDialog, siteFooterHtml, FEEDBACK_FORM_URL } from "../lib/shared.js";
import { loadUserPrefs, saveUserPref, markOnboardingDone } from "../lib/user-prefs.js";
import { applyArtAccentToPoster } from "../lib/art-color.js";
import { COPY, heroChipsHtml } from "../lib/copy.js";
import {
  renderMemoryCard,
  buildHomeFeaturedPosterHtml,
  buildLandingShowcaseHtml,
  renderResultMemoryCard,
} from "../lib/gallery-cards.js";

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

function libraryGateState() {
  const cs = state.cacheStatus;
  const ls = state.librarySummary;
  return {
    syncing: !!cs?.isSyncing,
    total: ls?.trackCount || cs?.totalTracks || 0,
  };
}

function generateGate() {
  if (state.noLibraryMode) return { blocked: false, message: "", showSync: false, discoveryMode: true };
  const { syncing, total } = libraryGateState();
  const syncError = state.cacheStatus?.syncError;
  if (syncError) {
    return {
      blocked: true,
      message: `Library sync failed: ${syncError}. Try syncing again or send feedback.`,
      showSync: true,
    };
  }
  if (syncing) return { blocked: true, message: "Your liked songs are syncing — generate unlocks when ready.", showSync: false };
  if (total === 0) {
    return {
      blocked: true,
      message: "Sync your liked songs first — open the ☰ menu → Sync new, or tap below.",
      showSync: true,
    };
  }
  if (total > 0 && total < 40) {
    return {
      blocked: false,
      message:
        `Small library (${total} likes) — library playlists need ~40+ saved tracks. Turn on Discovery Mode for Spotify-wide search.`,
      showSync: false,
      thinLibrary: true,
    };
  }
  return { blocked: false, message: "", showSync: false };
}

function isPromptReadyForGenerate(preview, vibe, selectedSceneId) {
  if (selectedSceneId) return true;
  if (state.noLibraryMode && !isDiscoveryGenreReady(vibe, preview)) return false;
  if (!preview?.requiresClarification) return true;
  const words = String(vibe || "").trim().split(/\s+/).filter(Boolean);
  return words.length >= 4;
}

const DISCOVERY_GENRE_FALLBACK_RE =
  /\b(?:rock|pop|country|blues|bluesy|jazz|house|techno|metal|hip[\s-]?hop|rap|indie|folk|soul|r&b|rnb|garage|punk|dnb|drum\s+(?:and|&)\s+bass|uk\s+garage|electronic|reggae|latin|classical|americana|bluegrass|funk|disco|trap|grime|metalcore|emo|shoegaze|afrobeats?|amapiano|outlaw|post[\s-]?punk|pop[\s-]?punk|madchester|liquid\s+(?:dnb|drum))\b/i;

function discoveryGateMessage(vibe, preview) {
  if (preview?.discovery?.ready && preview.discovery.detectedLabel) {
    return `Discovery Mode ready — detected ${preview.discovery.detectedLabel}.`;
  }
  return preview?.discovery?.hint
    || "Discovery Mode needs a genre in your prompt — e.g. blues rock, UK garage, country.";
}

function discoveryToastMessage(vibe, preview) {
  return preview?.discovery?.hint
    || "Discovery Mode needs a clear genre in your prompt (e.g. blues rock, UK garage, country).";
}

function isDiscoveryGenreReady(vibe, preview) {
  if (preview?.discovery?.ready === true) return true;
  if (preview?.discovery?.ready === false) return false;
  return DISCOVERY_GENRE_FALLBACK_RE.test(String(vibe || ""));
}

function isDiscoveryModeError(code) {
  return [
    "NO_LIBRARY_REQUIRES_GENRE",
    "NO_LIBRARY_SPOTIFY_POOL_EMPTY",
    "NO_LIBRARY_SPOTIFY_SEARCH_FAILED",
    "LIBRARY_EMPTY_NO_LIBRARY_MODE",
  ].includes(code);
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
    state.draftVibe = pending;
    const count = document.getElementById("charCount");
    if (count) count.textContent = String(pending.length);
    input.dispatchEvent(new Event("input"));
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
let onboardingKeyHandler = null;

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
  <section class="early-result-card early-result-card--quiet" aria-live="polite">
    <div class="early-result-head">
      <span class="early-result-eyebrow">Your soundtrack</span>
      <span class="early-result-meta">${count}${target > count ? ` of ~${target}` : ""} songs · taking shape</span>
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
    <div class="prompt-steer-row" aria-label="Shape this soundtrack">
      <span class="prompt-steer-label">Shape this soundtrack</span>
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
  refineOpen: false,
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
    ? (syncPct !== null ? `Rediscovering… ${syncPct}%` : COPY.sync.active)
    : total > 0 ? COPY.sync.ready(total) : "Your library";
  const initials = (user?.displayName || "U").charAt(0).toUpperCase();
  const avatar = user?.avatarUrl
    ? `<img src="${esc(user.avatarUrl)}" alt="">`
    : initials;
  const isDark = getTheme() === "dark";

  const profileBlock = user ? `
      <div class="nav-profile-wrap nav-profile-wrap--toolbar" id="profileWrap">
        <button class="nav-avatar-btn" id="profileBtn" type="button" title="Account"
          aria-haspopup="menu" aria-expanded="${state.profileOpen ? "true" : "false"}" aria-label="Account menu">
          <div class="nav-avatar">${avatar}</div>
          <svg class="nav-avatar-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
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
      </div>` : "";

  return `
  <nav class="nav" aria-label="Main navigation">
    ${navLogoHtml()}
    <div class="nav-toolbar">
      <button type="button" class="nav-menu-toggle" id="navMenuToggle" aria-expanded="false" aria-controls="navRight" aria-label="Open menu">☰</button>
      ${profileBlock}
      <div class="nav-right nav-right--collapsed" id="navRight">
        <a href="/gallery" class="nav-link">Diary <span class="nav-link-arrow">→</span></a>
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
      </div>
    </div>
  </nav>`;
}

// ── Landing page ──────────────────────────────────────────────────────────────
function authErrorMessage() {
  const error = new URLSearchParams(window.location.search).get("error");
  if (!error) return null;
  const messages = {
    access_denied: "Spotify login was cancelled, or your account isn't approved for this beta yet. Use the Feedback link (footer) with your Spotify email so we can add you.",
    rate_limited: "Too many login attempts. Wait a minute, then try Connect Spotify again.",
    no_code: "Spotify did not finish login. Please try connecting again.",
    session_failed: "Login session couldn't be verified. Disable private browsing, allow cookies for this site, and try Connect Spotify again.",
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
  const input = document.getElementById("landingVibeInput");
  const goLogin = (prompt) => {
    const text = (prompt || input?.value || "").trim();
    if (text) {
      try { localStorage.setItem("kwalify-pending-prompt", text); } catch { /* ignore */ }
    }
    window.location.href = "/api/auth/login";
  };
  document.getElementById("landingCreateBtn")?.addEventListener("click", () => goLogin());
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); goLogin(); }
  });
  document.querySelectorAll("[data-hero-prompt]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-hero-prompt");
      if (input && prompt) input.value = prompt;
      goLogin(prompt);
    });
  });
  scrubLandingQueryParams();
}

function renderLanding(notice) {
  document.title = "Kwalify — Soundtracks from your favourite songs";
  const landingNotice = notice
    ? { kind: "error", message: notice }
    : (state.errorKind === "auth" && state.error
      ? { kind: "error", message: state.error }
      : landingNoticeMessage());
  root.innerHTML = `
  <nav class="nav nav--minimal">
    ${navLogoHtml()}
    <div class="nav-right">
      <a href="/api/auth/login" class="btn btn-cream btn-sm">${spi()} ${COPY.cta.connect}</a>
    </div>
  </nav>

  <div class="landing-page landing-page--cinematic">

    <section class="cinematic-hero">
      <p class="cinematic-eyebrow">${COPY.eyebrow}</p>
      <h1 class="cinematic-headline">${COPY.headline}</h1>
      <p class="cinematic-sub">${COPY.subhead}</p>
      <p class="cinematic-promise">${COPY.landingPromise}</p>

      <div class="vibe-input-wrap vibe-input-wrap--hero">
        <div class="vibe-glow"></div>
        <div class="vibe-inner">
          <textarea
            id="landingVibeInput"
            class="vibe-textarea vibe-textarea--hero"
            placeholder="${esc(COPY.placeholder)}"
            maxlength="140"
            rows="3"
            aria-label="Describe your moment"
          ></textarea>
        </div>
      </div>

      <button type="button" id="landingCreateBtn" class="btn btn-cream btn-lg cinematic-cta">${COPY.cta.create}</button>

      <div class="hero-chips hero-chips--landing">
        <span class="hero-chips-label">Try</span>
        ${heroChipsHtml({ escFn: esc })}
      </div>

      ${landingNotice ? `<div class="alert ${landingNotice.kind === "error" ? "alert-error" : landingNotice.kind === "info" ? "alert-warn" : "alert-success"} landing-auth-alert">${esc(landingNotice.message)}</div>` : ""}

      <div class="landing-connect-block">
        <a href="/api/auth/login" class="btn btn-ghost btn-sm landing-connect-link">${spi()} ${COPY.cta.connect}</a>
        <p class="landing-connect-trust">${COPY.connectTrust}</p>
        <p class="landing-connect-sub">${COPY.connectSub}</p>
      </div>

      <p class="landing-beta-note">Spotify may limit logins during beta. If Connect fails, <a href="${FEEDBACK_FORM_URL}" target="_blank" rel="noopener" class="footer-link">send feedback</a> with your Spotify email.</p>
    </section>

    ${buildLandingShowcaseHtml({ escFn: esc })}

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
    const isGenerationError = state.errorKind === "generation" || state.errorKind === "discovery";
    const isDiscoveryError = state.errorKind === "discovery";
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
        ${!isLibraryInsufficient && !isDiscoveryError && isGenerationError ? `<button type="button" class="btn btn-sm btn-green" id="retryGenerateBtn">Try again</button>` : ""}
        ${isDiscoveryError && !state.noLibraryMode ? `<div class="error-actions"><button type="button" class="btn btn-sm btn-green" id="tryDiscoveryModeBtn">Try Discovery Mode</button></div>` : ""}
        ${isDiscoveryError && state.noLibraryMode ? `<div class="error-actions"><button type="button" class="btn btn-sm btn-ghost" id="refinePromptBtn">Refine your prompt</button><button type="button" class="btn btn-sm btn-ghost" id="turnOffDiscoveryBtn">Use my library instead</button></div>` : ""}
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
  ${state.generating ? `<div class="generation-cinematic-wrap">${generatingHtml()}</div>` : ""}

  <div class="app-wrap ${state.generating ? "app-wrap--dimmed" : ""}">

    ${errorHtml}

    ${!state.generating && state.libraryChapters?.length ? `<section class="library-chapters" aria-label="Life chapters from your library">
      <h2 class="section-title section-title--subtle">Life chapters</h2>
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

      <div class="vibe-col cinematic-entry">
        <p class="cinematic-eyebrow cinematic-eyebrow--app">${COPY.eyebrow}</p>
        <h1 class="cinematic-headline cinematic-headline--app">${COPY.headline}</h1>
        <p class="cinematic-sub cinematic-sub--app">${COPY.subhead}</p>
        <p class="cinematic-promise cinematic-promise--app">${COPY.landingPromise}</p>

        <div class="vibe-input-wrap">
          <div class="vibe-glow"></div>
          <div class="vibe-inner">
            <textarea
              id="vibeInput"
              class="vibe-textarea"
              placeholder="${esc(COPY.placeholder)}"
              maxlength="140"
              autocomplete="off"
              rows="3"
              aria-label="Describe your moment"
            ></textarea>
            <div class="vibe-footer">
              <span class="vibe-hint">${typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches ? "Enter ↵ to create · Ctrl+K focus" : "Enter ↵ to create"}</span>
              <span class="vibe-count"><span id="charCount">0</span>/140</span>
            </div>
          </div>
        </div>

        <div class="hero-chips hero-chips--compact">
          ${heroChipsHtml({ attr: "data-inspire-prompt", escFn: esc })}
        </div>
        <div id="intentPreviewStrip" class="intent-preview-strip" hidden aria-live="polite"></div>
        ${recentPromptsHtml()}

        ${gate.blocked ? `<p class="generate-gate-msg">${esc(gate.message)}</p>` : ""}
        ${!gate.blocked && state.noLibraryMode && !isDiscoveryGenreReady(state.draftVibe || document.getElementById("vibeInput")?.value, state.preview)
          ? `<p class="generate-gate-msg">${esc(discoveryGateMessage(state.draftVibe || document.getElementById("vibeInput")?.value, state.preview))}</p>`
          : ""}
        ${!gate.blocked && state.noLibraryMode && isDiscoveryGenreReady(state.draftVibe || document.getElementById("vibeInput")?.value, state.preview) && state.preview?.discovery?.detectedLabel
          ? `<p class="generate-gate-msg generate-gate-msg--ok">${esc(discoveryGateMessage(state.draftVibe || document.getElementById("vibeInput")?.value, state.preview))}</p>`
          : ""}
        ${gate.blocked && gate.showSync && !state.cacheStatus?.isSyncing ? `<button type="button" class="btn btn-cream btn-sm" id="gateSyncBtn">Sync library now</button>` : ""}
        <button id="generateBtn" class="gen-btn gen-btn--cinematic ${state.generating ? "loading" : ""}" ${gate.blocked || state.generating || !isPromptReadyForGenerate(state.preview, document.getElementById("vibeInput")?.value?.trim(), state.selectedSceneId) ? "disabled" : ""}>
          ${state.generating
            ? `<span class="spinner spinner--sm"></span> Creating…`
            : `${COPY.cta.create} <span class="btn-arrow">→</span>`}
        </button>

        <details class="refine-panel" id="refinePanel"${state.refineOpen ? " open" : ""}>
          <summary>Refine</summary>
          <div class="refine-panel-body">
            <div class="controls-row controls-row--mode">
              <span class="refine-label">How closely it matches</span>
              <div class="mode-group">
                <button class="mode-btn ${state.mode === "strict"   ? "active" : ""}" data-mode="strict" title="Closest match, least drift" aria-pressed="${state.mode === "strict"}">Strict</button>
                <button class="mode-btn ${state.mode === "balanced" ? "active" : ""}" data-mode="balanced" title="Best quality and variety" aria-pressed="${state.mode === "balanced"}">Balanced</button>
                <button class="mode-btn ${state.mode === "chaotic"  ? "active" : ""}" data-mode="chaotic" title="More surprise, still safety-checked" aria-pressed="${state.mode === "chaotic"}">Chaotic</button>
              </div>
            </div>
            <div class="controls-row controls-row--length">
              <span class="length-label">Length</span>
              <div class="length-row">
                <input type="range" class="length-slider" id="lengthSlider" min="20" max="60" step="5" value="${state.length}">
                <span class="length-val" id="lengthLabel">${state.length} songs</span>
              </div>
            </div>
            <div class="familiarity-row ${state.noLibraryMode ? "familiarity-row--disabled" : ""}" aria-label="Familiarity">
              <span class="familiarity-label">Familiarity</span>
              <div class="familiarity-group">
                <button class="familiarity-btn ${state.familiarity === "safe" ? "active" : ""}" data-familiarity="safe" aria-pressed="${state.familiarity === "safe"}" ${state.noLibraryMode ? "disabled" : ""}>Safe</button>
                <button class="familiarity-btn ${state.familiarity === "balanced" ? "active" : ""}" data-familiarity="balanced" aria-pressed="${state.familiarity === "balanced"}" ${state.noLibraryMode ? "disabled" : ""}>Balanced</button>
                <button class="familiarity-btn ${state.familiarity === "discovery" ? "active" : ""}" data-familiarity="discovery" aria-pressed="${state.familiarity === "discovery"}" ${state.noLibraryMode ? "disabled" : ""}>Deep cuts</button>
              </div>
            </div>
            <div class="no-library-row">
              <label class="no-library-toggle" title="Search all of Spotify for clear genre prompts">
                <div class="toggle-switch ${state.noLibraryMode ? "on" : ""}" id="noLibraryToggle" role="switch" tabindex="0" aria-checked="${state.noLibraryMode}" aria-label="Discovery Mode"></div>
                <div class="no-library-text">
                  <span class="no-library-label">Discovery Mode</span>
                  <span class="no-library-sub">Search Spotify broadly — include a genre in your prompt.</span>
                </div>
              </label>
            </div>
            <p class="mode-helper">${esc(modeHelperText)}</p>
          </div>
        </details>
      </div>

      ${debugMoodPanelHtml}
    </div>

    ${state.generating && state.generationLivePreview ? earlyResultHtml(state.generationLivePreview) : ""}
    ${!state.generating && state.lastResult ? resultHtml(state.lastResult) : ""}
    ${!state.generating && !state.lastResult && state.playlists?.length ? buildHomeFeaturedPosterHtml(state.playlists[0], { escFn: esc, fmtDateFn: fmtDate, spiFn: spi }) : ""}

    ${state.user && !state.generating && !state.lastResult ? `
    <section class="activity-section" aria-label="Recent activity">
      <div class="activity-section-head">
        <h2 class="section-title section-title--subtle">${COPY.activity.title}</h2>
        ${state.playlists?.length ? `<a href="/gallery.html" class="section-action">${COPY.activity.viewDiary}</a>` : ""}
      </div>
      <div class="activity-feed activity-feed--grid">${buildActivityFeed()}</div>
    </section>` : ""}

  </div>

  ${onboardingOverlayHtml()}
  ${siteFooterHtml()}`;

  wireAppEvents();

  if (state.lastResult?.tracks) {
    wireResultReveal(state.lastResult);
  }

  const vibeInput = document.getElementById("vibeInput");
  if (vibeInput) {
    vibeInput.value = state.draftVibe;
    const count = document.getElementById("charCount");
    if (count) count.textContent = String(state.draftVibe.length);
    if (state.draftVibe) updateMoodPanel(state.draftVibe);
  }
}

function buildActivityFeed() {
  const plItems = state.playlists.slice(0, 6);
  if (!plItems.length) {
    return `<p class="activity-empty">${COPY.activity.empty}</p>`;
  }

  return `<div class="gallery-grid gallery-grid--home">${plItems.map((p) => renderMemoryCard(p, {
    escFn: esc,
    fmtDateFn: fmtDate,
    spiFn: spi,
    deleteMode: false,
    selected: false,
  })).join("")}</div>`;
}

const GENERATION_STAGES = COPY.generation.stages;
const GENERATION_PHASES = ["starting", "loading_library", "building_profile", "scoring", "composing", "spotify", "saving"];
const GENERATION_PHASE_COPY = {
  [COPY.generation.stages[0]]: ["Waking up your musical memories…", "Reading what this moment means…"],
  [COPY.generation.stages[1]]: ["Finding songs that belong here…", "Looking through your favourites…"],
  [COPY.generation.stages[2]]: ["Shaping the emotional arc…", "Balancing familiar and forgotten…"],
  [COPY.generation.stages[3]]: [COPY.generation.saving, "Locking in your soundtrack…"],
  [COPY.generation.stages[4]]: ["Almost there…", "Opening your soundtrack…"],
};
const GENERATION_LONG_RUNNING_COPY = [
  "Still searching your library — larger collections take a moment.",
  "Finding the strongest connections in your music.",
  "Building the truest version of this moment.",
];
const GENERATION_PARTIAL_READY_COPY = [
  COPY.generation.partial,
  "Your matches are set — finishing the save.",
  "First glimpses are ready — saving to Spotify.",
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
    return "Your soundtrack is ready.";
  }
  if (phase === "spotify") {
    return elapsedMs >= 45000
      ? "Saving to Spotify is taking a moment — still working."
      : COPY.generation.saving;
  }
  if (phase === "saving") {
    return "Keeping a copy in your diary…";
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
    ? ["Searching across Spotify…", "Finding genre matches…", "Listening for the right era…"]
    : [COPY.generation.stages[0], COPY.generation.stages[1], COPY.sync.finding, "Learning your musical history…"];
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
  const displayTitle = state.noLibraryMode && displayIndex === 0
    ? COPY.generation.stages[1]
    : GENERATION_STAGES[Math.min(displayIndex, GENERATION_STAGES.length - 1)] || stageLabel;
  const partialCount = state.generationProgress?.partialTracks?.length || 0;
  const subtexts = state.noLibraryMode && displayIndex === 0
    ? ["Searching across Spotify for this genre…", "Finding songs outside your library…"]
    : GENERATION_PHASE_COPY[displayTitle] || GENERATION_PHASE_COPY[stageLabel] || [displayTitle, COPY.generation.stages[1]];
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
          ${COPY.generation.partial}
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
  <div class="generation-cinematic">
    <div class="generation-cinematic-inner">
      <p class="generation-story-eyebrow">${COPY.generation.eyebrow}</p>
      <h2 class="generation-story-line" id="generationTitle">${esc(progress.title)}</h2>
      <p class="generation-story-detail" id="generationSub">${esc(progress.sub)}</p>
      ${progressState?.sceneLabel ? `<p class="generation-story-scene">${esc(progressState.sceneLabel)}</p>` : ""}
      <div class="generating-progress generating-progress--thin" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.pct}" aria-label="Creation progress">
        <div class="generating-progress-fill" id="generationProgressFill" style="width:${progress.pct}%"></div>
      </div>
      <div class="generation-cinematic-actions">
        ${spotifyEarlyHtml}
        <button class="generation-cancel-btn" id="cancelGenerationBtn" type="button" data-action="cancel-generation" ${state.generationCancelRequested ? "disabled" : ""}>
          ${state.generationCancelRequested ? "Cancelling…" : "Cancel"}
        </button>
        ${debugModeEnabled() ? `<button class="generation-details-toggle" id="progressDetailsToggle" type="button">${state.progressExpanded ? "Hide details" : "Details"}</button>` : ""}
      </div>
      ${stuckHintHtml}
      ${progressDetailsHtml}
      ${partialHtml}
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
  setText("generationTitle", progress.title);
  setText("generationSub", progress.sub);
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

const JOURNEY_ACT_ROMAN = ["I", "II", "III", "IV", "V"];
const JOURNEY_ACT_FALLBACK = [
  { label: "Leaving", desc: "The first miles begin quietly." },
  { label: "The open road", desc: "The world slows down around you." },
  { label: "Arrival", desc: "The feeling you carry home." },
];

const JOURNEY_STAGE_COPY = {
  curated_opening: { label: "Leaving", lines: ["The first miles.", "Quiet thoughts.", "The world getting smaller."] },
  intro: { label: "Leaving", lines: ["The first miles.", "Quiet thoughts.", "The world getting smaller."] },
  soft: { label: "Leaving", lines: ["The first miles.", "A quieter beginning."] },
  sad: { label: "Leaving", lines: ["The first miles.", "Quiet thoughts."] },
  nostalgic: { label: "Leaving", lines: ["Where it begins.", "Memory in the rear view."] },
  warmup: { label: "Leaving", lines: ["The first miles.", "Finding the rhythm."] },
  build: { label: "The open road", lines: ["Where the soundtrack opens up."] },
  neutral: { label: "The open road", lines: ["Where the feeling deepens."] },
  peak: { label: "The open road", lines: ["Where the soundtrack stretches out."] },
  reflective: { label: "Lost in thought", lines: ["The quieter centre of the journey."] },
  energetic: { label: "Lift", lines: ["When the energy opens up."] },
  aggressive: { label: "Lift", lines: ["When the intensity rises."] },
  release: { label: "Arrival", lines: ["The feeling when you finally get there."] },
  cooldown: { label: "Arrival", lines: ["Everything settles."] },
  hopeful: { label: "Arrival", lines: ["The feeling after everything settles."] },
  peaceful: { label: "Arrival", lines: ["When you finally get there."] },
  still: { label: "Arrival", lines: ["When everything settles."] },
};

const TECHNICAL_TRUST_RE = /prompt match|degraded|recovery assisted|review copy|spotify partially|best available|era widened|genre widened|honest partial|built for neutral|confidence/i;

function humanizeJourneyStage(rawLabel, segmentId, index) {
  const keys = [
    String(segmentId || "").trim().toLowerCase().replace(/\s+/g, "_"),
    String(rawLabel || "").trim().toLowerCase().replace(/\s+/g, "_"),
  ].filter(Boolean);
  for (const key of keys) {
    if (JOURNEY_STAGE_COPY[key]) return JOURNEY_STAGE_COPY[key];
  }
  const devRe = /^(curated_|build|release|cooldown|intro|peak|neutral|energetic|soft|warmup)/;
  if (keys.some((k) => devRe.test(k) || k.includes("opening"))) {
    const fallback = JOURNEY_ACT_FALLBACK[Math.min(index, JOURNEY_ACT_FALLBACK.length - 1)];
    return {
      label: fallback.label,
      lines: fallback.desc.split(/(?<=[.!?])\s+/).filter(Boolean),
    };
  }
  const human = String(rawLabel || "").replace(/_/g, " ").trim();
  if (human && !/^(build|release|neutral|peak|intro|cooldown)$/i.test(human)) {
    return { label: human.replace(/\b\w/g, (c) => c.toUpperCase()), lines: ["Part of your soundtrack journey."] };
  }
  const fallback = JOURNEY_ACT_FALLBACK[Math.min(index, JOURNEY_ACT_FALLBACK.length - 1)];
  return {
    label: fallback.label,
    lines: fallback.desc.split(/(?<=[.!?])\s+/).filter(Boolean),
  };
}

function resolvePosterSceneLine(result) {
  if (result.sceneId) {
    return String(result.sceneId).replace(/_/g, " ");
  }
  return result.momentUnderstandingLine
    || result.sceneLabel
    || (result.scoringDiagnostics?.semanticResolution?.sceneId
      ? result.scoringDiagnostics.semanticResolution.sceneId.replace(/_/g, " ")
      : null);
}

function formatPosterTitleLines(result) {
  const scene = resolvePosterSceneLine(result);
  if (scene) {
    const cleaned = String(scene).trim().replace(/_/g, " ");
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length >= 3) {
      const mid = Math.ceil(words.length / 2);
      return [
        words.slice(0, mid).join(" ").toUpperCase(),
        words.slice(mid).join(" ").toUpperCase(),
      ];
    }
    return [cleaned.toUpperCase()];
  }
  const name = result.playlistName || result.name || "Your soundtrack";
  const parts = String(name).split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 2).map((p) => p.toUpperCase());
  return [String(name).toUpperCase()];
}

function formatPosterTitle(result) {
  return formatPosterTitleLines(result).join(" ");
}

function buildResultNarrativeSubtitle(result, prompt) {
  const text = String(prompt || "").toLowerCase();
  if (/drive|motorway|road|highway|journey/.test(text) && /rain|wet|windscreen|windshield/.test(text)) {
    return "A soundtrack for the road between places.";
  }
  if (/night|midnight|late/.test(text) && /alone|solitary|quiet|reflect/.test(text)) {
    return "A quiet soundtrack for a moment alone.";
  }
  if (result.noLibraryMode) return "A soundtrack found across Spotify for this moment.";
  return "A soundtrack built from your own memories.";
}

function buildWhyItFitsHtml(result, trustLabels, playlistExplanation) {
  const bullets = [];
  const prompt = result.vibe || result.prompt || "";
  if (/drive|motorway|road|highway/i.test(prompt) && /rain|windscreen|windshield|wet/i.test(prompt)) {
    bullets.push("Slow textures match the feeling of the road");
    bullets.push("Familiar songs create a sense of memory");
    bullets.push("The energy builds naturally instead of rushing");
    bullets.push("Warm darkness that fits rain against the glass");
  }
  const humanized = trustLabels
    .map(humanizeTrustLabel)
    .filter(Boolean)
    .filter((line) => !TECHNICAL_TRUST_RE.test(line));
  humanized.forEach((line) => {
    if (!bullets.some((b) => b.toLowerCase() === line.toLowerCase())) bullets.push(line);
  });
  if (playlistExplanation) {
    builtAroundBullets(playlistExplanation.laneDetails || [], playlistExplanation.diversityReport || {}).forEach((raw) => {
      const line = raw.includes("familiar") ? "Familiar songs mixed with forgotten favourites"
        : raw.includes("forgotten") ? "Forgotten favourites woven back in"
        : raw.includes("gradual") ? "A gradual build rather than sudden energy changes"
        : raw.charAt(0).toUpperCase() + raw.slice(1);
      if (!bullets.some((b) => b.toLowerCase().includes(raw.toLowerCase()))) bullets.push(line);
    });
  }
  if (bullets.length < 2) {
    bullets.push("Drawn from songs you already love");
    bullets.push("Shaped around the feeling you described");
  }
  const narrative = result.playlistWhy || result.generationTrust?.playlistWhy || "";
  if (narrative && !TECHNICAL_TRUST_RE.test(narrative) && !/neutral|genre alignment|energy score/i.test(narrative)) {
    bullets.unshift(narrative);
  }
  const unique = [...new Set(bullets)].slice(0, 4);
  return `<section class="result-story-section result-why-fits" aria-label="${esc(COPY.result.whyFits)}">
    <h2 class="result-section-label">${COPY.result.whyFits}</h2>
    <ul class="result-why-list">${unique.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
  </section>`;
}

function resultArtUrls(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks
    .map((t) => t.albumArt || t.album_art)
    .filter(Boolean)
    .slice(0, 4);
}

function buildArtBackdropHtml(artUrls) {
  if (!artUrls.length) return "";
  const url = artUrls[0];
  return `<div class="art-backdrop" aria-hidden="true"><img src="${esc(url)}" alt="" class="art-backdrop-img" loading="eager"></div>`;
}

function buildMomentNarrative(result, prompt) {
  const p = String(prompt || "").toLowerCase();
  const understanding = String(result.momentUnderstandingLine || "").trim();
  if (understanding && understanding.length > 48 && !TECHNICAL_TRUST_RE.test(understanding)) {
    return understanding.charAt(0).toUpperCase() + understanding.slice(1) + (understanding.endsWith(".") ? "" : ".");
  }
  if (/drive|motorway|road|highway|journey/.test(p) && /rain|windscreen|windshield|wet|storm/.test(p)) {
    return "Rain against the glass. Empty roads. The quiet feeling of driving somewhere without needing to arrive.";
  }
  if (/night|midnight|late|2am|3am/.test(p) && /alone|solit|quiet|reflect|thought/.test(p)) {
    return "The hours when the world goes quiet, and the songs you carry start to mean more.";
  }
  if (/summer|sun|warm|windows down|nostalg/.test(p)) {
    return "Warm air, open roads, and the kind of memory that only music can hold onto.";
  }
  if (/goodbye|breakup|miss|heart|alone/.test(p)) {
    return "The space after something ends — where familiar songs become the only company you need.";
  }
  if (/party|dance|energy|upbeat|pregame/.test(p)) {
    return "The charge before the night begins, and the songs that know exactly how that feels.";
  }
  if (result.noLibraryMode) {
    return "A feeling described in words, answered in sound — found across Spotify for this moment.";
  }
  return "The feeling you described, held in songs from your own history — familiar, personal, and true to the moment.";
}

function buildMomentSection(result, prompt) {
  const text = buildMomentNarrative(result, prompt);
  return `<section class="result-story-section result-moment" aria-label="${esc(COPY.result.moment)}">
    <h2 class="result-section-label">${COPY.result.moment}</h2>
    <p class="result-moment-text">${esc(text)}</p>
  </section>`;
}

function humanizeTrustLabel(raw) {
  const label = String(raw || "").trim();
  if (!label) return "";
  const exact = {
    "Strong Prompt Match": "Built closely around your description",
    "Good Prompt Match": "Matched well to what you described",
    "Best Available Match": "The strongest matches we could find in your library",
    "Prompt Matched": "Shaped around your moment",
    "Built from Your Library": "Drawn from songs you already love",
    "Built from Spotify Discovery": "Found across Spotify for this genre",
    "Recovery Assisted": "We found extra connections in your library",
    "Degraded Performance Mode": "Finished with a lighter pass to save time",
    "Era widened to best available": "Pulled from the chapters of your music history",
    "Genre widened to best available": "Reached deeper into your taste to fill the mood",
    "Honest partial — in-world tracks only": "Kept honest — only songs that truly belong",
    "Review Copy Available": "Ready to review here while Spotify catches up",
    "Spotify Partially Saved": "Part of this mix is already on Spotify",
    "Best Available — recovery blocked further widening": "Stayed true to your taste without stretching too far",
  };
  if (exact[label]) return exact[label];
  if (/strong prompt/i.test(label)) return "Built closely around your description";
  if (/good prompt/i.test(label)) return "Matched well to what you described";
  if (/recovery/i.test(label)) return "We found extra connections in your library";
  if (/era/i.test(label) && /widen/i.test(label)) return "Pulled from the chapters of your music history";
  if (/genre/i.test(label) && /widen/i.test(label)) return "Reached deeper into your taste to fill the mood";
  if (/library/i.test(label)) return "Drawn from songs you already love";
  if (/discovery/i.test(label)) return "Found across Spotify for this genre";
  return label.replace(/\b\w/g, (c) => c.toLowerCase()).replace(/^./, (c) => c.toUpperCase());
}

function buildJourneyActs(segmentDiagnostics, tracks) {
  const trackCount = Array.isArray(tracks) ? tracks.length : 0;
  if (Array.isArray(segmentDiagnostics) && segmentDiagnostics.length > 0) {
    return segmentDiagnostics.slice(0, 5).map((seg, i) => {
      const stage = humanizeJourneyStage(seg.label, seg.segmentId, i);
      return {
        label: stage.label,
        lines: stage.lines,
        trackCount: Array.isArray(seg.trackIds) ? seg.trackIds.length : null,
      };
    });
  }
  if (trackCount < 3) {
    return [{
      label: "The moment",
      lines: ["Every track chosen for this feeling."],
      trackCount: trackCount || null,
    }];
  }
  return JOURNEY_ACT_FALLBACK.map((act) => ({
    label: act.label,
    lines: act.desc.split(/(?<=[.!?])\s+/).filter(Boolean),
    trackCount: null,
  }));
}

function buildJourneyActsHtml(segmentDiagnostics, tracks) {
  const acts = buildJourneyActs(segmentDiagnostics, tracks);
  if (!acts.length) return "";
  const items = acts.map((act, i) => {
    const roman = JOURNEY_ACT_ROMAN[i] || String(i + 1);
    const title = String(act.label).toUpperCase();
    const desc = act.lines[0] || "";
    return `
    <article class="journey-timeline-item" style="--journey-i:${i}">
      <div class="journey-timeline-act">ACT ${roman}</div>
      <div class="journey-timeline-content">
        <h3 class="journey-timeline-title">${esc(title)}</h3>
        <p class="journey-timeline-desc">${esc(desc)}</p>
      </div>
    </article>`;
  }).join("");
  return `<section class="result-story-section journey-story" aria-label="${esc(COPY.result.journey)}">
    <h2 class="result-section-label">${COPY.result.journey}</h2>
    <div class="journey-timeline">${items}</div>
  </section>`;
}

function buildOtherMomentsHtml(result) {
  const currentId = result.savedPlaylistId || result.playlistId || null;
  const currentSlug = result.shareSlug || "";
  const others = (state.playlists || [])
    .filter((p) => {
      if (currentId && String(p.id) === String(currentId)) return false;
      if (currentSlug && p.shareSlug === currentSlug) return false;
      return true;
    })
    .slice(0, 4);
  if (!others.length) return "";
  return `<section class="result-story-section result-other-moments" aria-label="${esc(COPY.result.otherMoments)}">
    <h2 class="result-section-label">${COPY.result.otherMoments}</h2>
    <div class="result-memory-row">${others.map((p) => renderResultMemoryCard(p, { escFn: esc })).join("")}</div>
  </section>`;
}

function renderTechnicalBuiltAccordion(expl) {
  if (!expl) return "";
  const technicalHtml = buildTechnicalExplanationHtml(expl);
  if (!technicalHtml.trim()) return "";
  return `<details class="result-built-details">
    <summary>${COPY.result.seeHowBuilt}</summary>
    <div class="explain-panel explain-panel--built">${technicalHtml}</div>
  </details>`;
}

function buildMemorySummaryHtml(result, trustLabels, extras = {}) {
  const humanized = trustLabels.map(humanizeTrustLabel).filter(Boolean);
  const unique = [...new Set(humanized)].slice(0, 6);
  const whyLine = result.playlistWhy || result.generationTrust?.playlistWhy || "";
  const survival = result.intentSurvivalSummary || result.generationTrust?.intentSurvivalSummary || "";
  const chipsHtml = unique.length
    ? `<ul class="memory-summary-list">${unique.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
    : "";
  const narrative = whyLine || survival;
  if (!chipsHtml && !narrative && !extras.notices) return "";
  return `<section class="memory-summary" aria-label="About this soundtrack">
    ${narrative ? `<p class="memory-summary-lead">${esc(narrative)}</p>` : ""}
    ${chipsHtml}
    ${extras.notices || ""}
  </section>`;
}

function wireResultPosterArt(tracks) {
  const poster = document.getElementById("resultPoster");
  if (!poster) return;
  void applyArtAccentToPoster(poster, resultArtUrls(tracks));
}

function wireResultStorySections() {
  const sections = document.querySelectorAll(".result-story-section");
  if (!sections.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    sections.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  sections.forEach((el) => observer.observe(el));
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
    { title: "Connect your soundtrack", body: "You're in. Kwalify uses your liked songs — your taste stays yours." },
    { title: "Rediscover your library", body: "Open ☰ → Sync new. First sync finds forgotten favourites in your history." },
    { title: "Give a moment a soundtrack", body: "Be specific: place + feeling + era. e.g. late-night motorway drive, mellow 2010s." },
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
        <button type="button" class="btn btn-cream btn-sm" id="onboardingNext">${step < 3 ? "Next" : "Got it"}</button>
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

function buildWorldUnderstandingHtml(world) {
  if (!world) return "";
  const list = (items) => (items && items.length ? items.map((x) => `✓ ${esc(x)}`).join("<br>") : "—");
  const musicGenres = (world.musicDirection?.preferredGenres || []).slice(0, 4).join(", ") || "—";
  const textures = (world.musicDirection?.textures || []).slice(0, 4).join(", ") || "—";
  const tempo = world.musicDirection?.tempoLabel || "—";
  const progression = world.musicDirection?.progression || "—";
  const situations = (world.situationMatches || []).slice(0, 6).map(esc).join(" · ") || "—";
  const concepts = (world.matchedConcepts || []).slice(0, 12).map(esc).join(" · ") || "—";
  const phrases = (world.matchedPhrases || []).slice(0, 4).map((p) => esc(p.phrase)).join(" · ") || "—";
  const fuzzy = (world.fuzzyExpansions || []).slice(0, 4).map((f) => esc(f.id)).join(" · ") || "—";
  const graph = (world.graphMatches || []).slice(0, 4).map((g) => esc(`${g.domain}:${g.id}`)).join(" · ") || "—";
  const candidates = (world.sceneCandidates || []).slice(0, 5).map((c) =>
    `${c.rank}. ${esc(c.label)} (${c.score})`
  ).join("<br>") || "—";
  const intentLine = world.intent ? `${esc(world.intent.kind)}${world.intent.trigger ? ` · "${esc(world.intent.trigger)}"` : ""}` : "—";

  const momentInterp = world.momentInterpretation;
  const dominantStory = momentInterp?.dominantStory
    ? `<div class="intent-understanding-line"><strong>Dominant story:</strong> ${esc(momentInterp.dominantStory)}</div>`
    : "";
  const conceptPriority = (momentInterp?.primaryConcepts || []).slice(0, 5).map((c) =>
    `${esc(c.label)} [phys ${c.physical.toFixed(1)}, emo ${c.emotional.toFixed(1)}, narr ${c.narrative.toFixed(1)}]`
  ).join("<br>") || "—";
  const lifeEvents = (momentInterp?.lifeEvents || []).map((e) => esc(`${e.category}: "${e.trigger}"`)).join(" · ") || "—";
  const temporal = (momentInterp?.temporal || []).map((t) => esc(`${t.phase}: "${t.trigger}"`)).join(" · ") || "—";

  const conf = world.sceneConfidence;
  const positiveSignals = (conf?.positiveSignals || []).slice(0, 6).map((s) => `✓ ${esc(s)}`).join("<br>") || "—";
  const rejected = (conf?.rejectedAlternatives || []).slice(0, 3).map((r) =>
    `✗ ${esc(r.label)} (${r.score}, gap ${r.gap}): ${esc(r.reasons.join("; "))}`
  ).join("<br>") || "—";
  const narrativeNote = conf?.narrativeOverPhysical
    ? '<div class="intent-understanding-line intent-understanding-muted"><strong>Ranking:</strong> narrative over physical cues</div>'
    : "";

  const hx = world.humanExperience;
  const hxQualities = (hx?.inferredQualities || []).map(esc).join(" · ") || "—";
  const hxMemories = (hx?.sharedMemories || []).slice(0, 4).map(esc).join(" · ") || "—";
  const hxBehaviours = (hx?.musicalBehaviours || []).map(esc).join(" · ") || "—";
  const hxIntent = hx?.playlistIntent ? esc(hx.playlistIntent) : "—";
  const hxNarrative = hx?.narrative ? esc(hx.narrative) : "—";
  const hxArc = world.emotionalArc?.summary
    ? esc(world.emotionalArc.summary)
    : (hx?.emotionalArcSummary ? esc(hx.emotionalArcSummary) : "—");
  const atlasLines = (hx?.atlasConsultations || []).slice(0, 4).map((a) =>
    `${esc(a.label)} (${a.matchScore.toFixed(2)}): ${esc(a.reason)}`
  ).join("<br>") || "—";
  const hxReasons = (hx?.interpretationReasons || []).slice(0, 4).map(esc).join(" · ") || "—";
  const reasoning = world.experienceReasoning;
  const reasoningChains = (reasoning?.hops || []).slice(0, 4).map(esc).join("<br>") || "—";
  const altInterp = (reasoning?.alternativeInterpretations || []).slice(0, 3).map(esc).join(" · ") || "—";
  const primaryConcepts = (reasoning?.prioritizedConcepts || []).filter((c) => c.role === "primary").slice(0, 5).map((c) =>
    `${esc(c.label)} (${esc(c.category)}, ${c.score.toFixed(2)})`
  ).join("<br>") || conceptPriority;
  const ignoredConcepts = (reasoning?.prioritizedConcepts || []).filter((c) => c.role === "ignored").slice(0, 3).map((c) =>
    esc(c.label)
  ).join(" · ") || "—";
  const fp = world.semanticFingerprint;
  const fpLine = fp
    ? `themes: ${esc((fp.themes || []).slice(0, 3).join(", "))} · narrative: ${esc(fp.narrativeFrame || "—")}`
    : "—";
  const sm = world.semanticMoment;
  const smLine = sm
    ? `scene compat: ${esc(sm.sceneOutput.label)} (${Math.round(sm.confidence * 100)}%)`
    : "—";

  const semDims = world.semanticDimensions;
  const dimLine = (label, items) =>
    items?.length
      ? `<div class="intent-understanding-line intent-understanding-muted"><strong>${label}:</strong> ${items.map(esc).join(" · ")}</div>`
      : "";
  const semanticBlock = semDims ? `
    <div class="intent-understanding-line"><strong>Semantic fingerprint</strong> (${Math.round((world.semanticMoment?.confidence ?? world.confidence ?? 0) * 100)}%)</div>
    ${dimLine("Activity", semDims.activity)}
    ${dimLine("Movement", semDims.movement)}
    ${dimLine("Environment", semDims.environment)}
    ${dimLine("Weather", semDims.weather)}
    ${dimLine("Time", semDims.time)}
    ${dimLine("Lighting", semDims.lighting)}
    ${dimLine("Social", semDims.social)}
    ${dimLine("Life event", semDims.lifeEvent)}
    ${dimLine("Emotion", semDims.emotion)}
    ${dimLine("Narrative", semDims.narrative)}
    ${dimLine("Sensory", semDims.sensory)}
    ${dimLine("Playlist direction", semDims.playlistDirection)}
    ${world.semanticMoment?.emotionalGoal ? `<div class="intent-understanding-line"><strong>Emotional goal:</strong> ${esc(world.semanticMoment.emotionalGoal)}</div>` : ""}
    ${world.semanticMoment?.relationshipChains?.length ? `<div class="intent-understanding-line intent-understanding-muted"><strong>World chains:</strong> ${world.semanticMoment.relationshipChains.slice(0, 3).map((c) => esc(c.chain.join(" → "))).join("<br>")}</div>` : ""}
    ${world.trackScoringHook ? `<div class="intent-understanding-line intent-understanding-muted"><strong>Track scoring:</strong> ${esc(world.trackScoringHook)}</div>` : ""}
  ` : "";

  return `<div class="intent-understanding-card intent-understanding-card--world">
    <div class="intent-understanding-title">World understanding</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Input:</strong> ${esc(world.originalPrompt || "")}</div>
    <div class="intent-understanding-line"><strong>Human experience:</strong> ${hxNarrative}</div>
    <div class="intent-understanding-line"><strong>Inferred qualities:</strong> ${hxQualities}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Shared memories:</strong> ${hxMemories}</div>
    <div class="intent-understanding-line"><strong>Playlist intent:</strong> ${hxIntent}</div>
    <div class="intent-understanding-line"><strong>Musical behaviour:</strong> ${hxBehaviours}</div>
    <div class="intent-understanding-line"><strong>Emotional arc:</strong> ${hxArc}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Experience fingerprint:</strong> ${fpLine}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Semantic moment:</strong> ${smLine}</div>
    <div class="intent-understanding-line"><strong>Atlas consulted:</strong><br>${atlasLines}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Why:</strong> ${hxReasons}</div>
    <div class="intent-understanding-line"><strong>Reasoning chain:</strong><br>${reasoningChains}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Alternatives:</strong> ${altInterp}</div>
    <div class="intent-understanding-line"><strong>Primary concepts:</strong><br>${primaryConcepts}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Ignored (ambient):</strong> ${ignoredConcepts}</div>
    <div class="intent-understanding-line"><strong>Scene:</strong> ${esc(world.scene?.label || "—")}</div>
    <div class="intent-understanding-line intent-understanding-muted">${esc(world.scene?.humanSummary || "")}</div>
    <div class="intent-understanding-line"><strong>Environment:</strong><br>${list(world.understoodAs?.environment)}</div>
    <div class="intent-understanding-line"><strong>Activity:</strong><br>${list(world.understoodAs?.activity)}</div>
    <div class="intent-understanding-line"><strong>Social:</strong><br>${list(world.understoodAs?.social)}</div>
    <div class="intent-understanding-line"><strong>Emotion:</strong><br>${list(world.understoodAs?.emotion)}</div>
    <div class="intent-understanding-line"><strong>Sensory:</strong><br>${list(world.understoodAs?.sensory)}</div>
    <div class="intent-understanding-line"><strong>Life context:</strong><br>${list(world.understoodAs?.lifeContext)}</div>
    <div class="intent-understanding-line"><strong>Human meaning:</strong> ${esc((world.humanMeanings || []).join(" · ") || world.humanNarrative || "—")}</div>
    <div class="intent-understanding-line"><strong>Music direction:</strong><br>
      energy: ${esc(world.musicDirection?.energyLabel || "—")} (${Math.round((world.musicDirection?.energy || 0) * 100)}%)<br>
      tempo: ${esc(tempo)}<br>
      texture: ${esc(textures)}<br>
      genres: ${esc(musicGenres)}<br>
      progression: ${esc(progression)}
    </div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Situations:</strong> ${situations}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Phrases:</strong> ${phrases}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Fuzzy:</strong> ${fuzzy}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Matched concepts:</strong> ${concepts}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Intent:</strong> ${intentLine}</div>
    ${dominantStory}
    <div class="intent-understanding-line"><strong>Primary concepts:</strong><br>${conceptPriority}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Life events:</strong> ${lifeEvents}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Temporal:</strong> ${temporal}</div>
    ${narrativeNote}
    ${semanticBlock}
    <div class="intent-understanding-line"><strong>Scene candidates:</strong><br>${candidates}</div>
    <div class="intent-understanding-line"><strong>Why this scene:</strong><br>${positiveSignals}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Rejected:</strong><br>${rejected}</div>
    <div class="intent-understanding-line intent-understanding-muted"><strong>Graph matches:</strong> ${graph}</div>
    <div class="intent-understanding-line intent-understanding-muted">${esc(world.humanNarrative || "")}</div>
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
    ${buildWorldUnderstandingHtml(intent?.worldUnderstanding)}
  </div>`;
}

function updateIntentPreviewStrip(data) {
  const strip = document.getElementById("intentPreviewStrip");
  if (!strip) return;
  const tier = data?.intentUnderstanding?.confidenceTier ?? data?.promptConfidence?.tier;
  const wordCount = String(document.getElementById("vibeInput")?.value || "").trim().split(/\s+/).filter(Boolean).length;
  state.preview = {
    ...data,
    discovery: data?.discovery ?? null,
    requiresClarification: tier === "low" && wordCount < 4 && !state.selectedSceneId,
    momentUnderstandingLine: data?.momentUnderstandingLine ?? null,
  };
  const momentLine = state.preview.momentUnderstandingLine
    ? `<p class="moment-understanding-line">${esc(state.preview.momentUnderstandingLine)}</p>`
    : "";
  const clarification = state.preview.requiresClarification
    ? `<p class="sync-meta clarification-required">Add more detail, pick a suggestion, or use at least four words before generating.</p>`
    : (state.noLibraryMode && state.preview.discovery && state.preview.discovery.ready === false
      ? `<p class="sync-meta clarification-required">${esc(state.preview.discovery.hint || "Add a genre for Discovery Mode.")}</p>`
      : (state.noLibraryMode && state.preview.discovery?.ready && state.preview.discovery.detectedLabel
        ? `<p class="sync-meta discovery-detected">Detected genre: ${esc(state.preview.discovery.detectedLabel)}</p>`
        : ""));
  const clarificationChips = intentClarificationChipsHtml();
  const html = debugModeEnabled()
    ? buildIntentUnderstandingHtml(
      data?.intentUnderstanding || null,
      null,
      { preview: true, alwaysShow: true, decomposed: data?.decomposedIntent || null },
    )
    : "";
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

  // ── Dynamic vibe tags (debug only) ─────────────────────────────────────────
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
      : null)
    || (count > 0 && count < Math.max(8, Math.floor(state.length * 0.4))
      ? `Only ${count} strong tracks survived the safety checks. Try a broader prompt or Balanced mode for a fuller playlist.`
      : null)
    || (result.fastFallback || result.code === "TIMEOUT_FALLBACK"
      ? (result.userMessage || "Quick backup playlist built because the full generator was taking too long.")
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
    ? `<p class="result-insight result-insight--notice">Same prompt replayed from cache — use <strong>New mix</strong> under Shape it for a different take.</p>`
    : result.requestedNewMix
      ? `<p class="result-insight result-insight--notice">Fresh mix requested — track order and picks were reshuffled.</p>`
      : "";
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
  const playlistCoherence = result.playlistCoherence
    || result.coherenceScore
    || result.v3Diagnostics?.playlistCoherence
    || null;
  const segmentDiagnostics = result.segmentDiagnostics
    || result.generationDiagnostics?.segmentDiagnostics
    || [];
  const journeyActsHtml = buildJourneyActsHtml(segmentDiagnostics, result.tracks);
  const coherenceGate = result.coherenceGate || result.generationDiagnostics?.coherenceGate || null;
  const sceneLockStatus = result.sceneLockStatus || result.generationDiagnostics?.sceneLockStatus || null;
  const coherenceBadgeHtml = buildCoherenceBadgeHtml(
    playlistCoherence,
    sceneLockStatus,
    coherenceGate,
    result.swapRepairActions,
  );

  const hasExplain = !!(result.v3Diagnostics?.playlistExplanation || result.playlistExplanation);
  const playlistExplanation = result.v3Diagnostics?.playlistExplanation || result.playlistExplanation;
  const seeHowBuiltHtml = hasExplain ? renderTechnicalBuiltAccordion(playlistExplanation) : "";
  const explainSectionHtml = debugModeEnabled() && hasExplain ? renderPlaylistExplanation(playlistExplanation) : "";

  const tracks = Array.isArray(result.tracks) ? result.tracks : [];
  const playlistId = result.savedPlaylistId || result.playlistId || "";
  const shareSlug = result.shareSlug || "";
  const posterTitleLines = formatPosterTitleLines(result);
  const posterTitleHtml = posterTitleLines.map((line) => `<span class="result-poster-title-line">${esc(line)}</span>`).join("");
  const originalPrompt = result.vibe || result.prompt || "";
  const posterSubtitle = buildResultNarrativeSubtitle(result, originalPrompt);
  const artUrls = resultArtUrls(tracks);
  const backdropHtml = buildArtBackdropHtml(artUrls);
  const promptEcho = originalPrompt
    ? `<blockquote class="result-poster-prompt">"${esc(originalPrompt)}"</blockquote>`
    : "";

  const momentHtml = buildMomentSection(result, originalPrompt);
  const whyItFitsHtml = buildWhyItFitsHtml(result, trustChips, playlistExplanation);
  const otherMomentsHtml = buildOtherMomentsHtml(result);

  const noticesHtml = [
    cacheNotice,
    fallbackNotice && !TECHNICAL_TRUST_RE.test(fallbackNotice) ? `<p class="result-quiet-notice">${esc(fallbackNotice)}</p>` : "",
    buildThinLibraryDetailHtml(result),
  ].filter(Boolean).join("");

  const tracksHtml = tracks.length ? `
  <section class="result-story-section track-reveal track-reveal--credits" aria-label="${esc(COPY.result.soundtrack)}">
    <div class="track-reveal-head">
      <h2 class="result-section-label">${COPY.result.soundtrack}</h2>
      <span class="track-reveal-meta">${COPY.result.songs(count)}</span>
    </div>
    <div class="tracks-list tracks-list--credits" id="resultTracksList">
    ${tracks.map((t, i) => {
      const title = t.trackName || t.name || "Unknown track";
      const artist = t.artistName || t.artist || "Unknown artist";
      const art = t.albumArt || t.album_art;
      return `
      <div class="track-row track-row--credits" data-track-index="${i}" style="--track-i:${i}">
        <div class="track-art track-art--credits">${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : ""}</div>
        <div class="track-info">
          <div class="track-name">${esc(title)}</div>
          <div class="track-artist">${esc(artist)}</div>
        </div>
        <div class="track-actions track-actions--credits">
          <button class="section-action feedback-track-btn" data-action="skip" data-track-index="${i}" data-playlist-id="${playlistId}" title="Skip this track" aria-label="Skip this track">⏭</button>
          <button class="section-action feedback-track-btn" data-action="remove" data-track-index="${i}" data-playlist-id="${playlistId}" title="Remove from future playlists" aria-label="Remove from future playlists">−</button>
          <button class="section-action feedback-track-btn" data-action="replace" data-track-index="${i}" data-playlist-id="${playlistId}" title="Replace with a nearby track" aria-label="Replace with a nearby track">↻</button>
          <button class="section-action feedback-track-btn" data-action="like" data-track-index="${i}" data-playlist-id="${playlistId}" title="Like this track" aria-label="Like this track">♥</button>
          <button class="section-action feedback-track-btn" data-action="dislike" data-track-index="${i}" data-playlist-id="${playlistId}" title="Thumbs down" aria-label="Thumbs down">↓</button>
          <button class="section-action feedback-track-btn undo-feedback-btn" data-action="undo" data-track-index="${i}" data-playlist-id="${playlistId}" title="Undo last feedback" aria-label="Undo last feedback" style="display:none">Undo</button>
        </div>
      </div>`;
    }).join("")}
    </div>
  </section>` : "";

  const technicalMetaHtml = debugModeEnabled() ? `
    <div class="result-technical-meta">
      <div class="result-controls-meta">
        <span class="${resultBadgeClass}">${esc(resultBadge)}</span>
        <span class="result-meta">${count} tracks · ${esc(state.mode)} mode</span>
      </div>
      <div class="result-vibes result-vibes--subtle">${vibeDotsHtml}</div>
      ${coherenceBadgeHtml}
      ${confidenceHtml}
    </div>` : "";

  const shapeHtml = promptSteerChipsHtml(originalPrompt);

  return `
  <div class="result-reveal result-album" id="resultReveal">
    <header class="result-poster result-poster--album" id="resultPoster">
      ${backdropHtml}
      <div class="result-poster-overlay"></div>
      <div class="result-poster-stage">
        <div class="result-poster-copy">
          <p class="result-poster-eyebrow">${COPY.result.eyebrow}</p>
          <h2 class="result-poster-title">${posterTitleHtml}</h2>
          ${promptEcho}
          <p class="result-poster-subtitle">${esc(posterSubtitle)}</p>
        </div>
        <div class="result-poster-actions">
          ${result.spotifyPlaylistUrl ? `<a href="${esc(result.spotifyPlaylistUrl)}" target="_blank" rel="noopener" class="btn btn-spotify-hero result-poster-play">${COPY.result.openSpotify}</a>` : ""}
          ${shareSlug ? `<a href="/p/${esc(shareSlug)}" class="btn btn-secondary-hero">${COPY.result.share}</a>` : ""}
          ${shareSlug ? `<button type="button" class="btn btn-secondary-hero" id="copyShareLinkBtn" data-share-slug="${esc(shareSlug)}">${COPY.result.copyLink}</button>` : ""}
        </div>
      </div>
    </header>

    ${noticesHtml ? `<div class="result-quiet-notices">${noticesHtml}</div>` : ""}

    ${momentHtml}

    ${journeyActsHtml}

    ${whyItFitsHtml}

    ${tracksHtml}

    ${shapeHtml || seeHowBuiltHtml ? `
    <footer class="result-shape-footer">
      ${shapeHtml ? `
      <details class="result-shape-panel">
        <summary>${COPY.result.shape}</summary>
        <div class="result-shape-body">${shapeHtml}</div>
      </details>` : ""}
      ${seeHowBuiltHtml}
      ${technicalMetaHtml}
    </footer>` : technicalMetaHtml}

    ${otherMomentsHtml}
  </div>
  ${debugHtml}${explainSectionHtml}`;
}

function wireResultReveal(result) {
  if (result?.tracks) wireResultPosterArt(result.tracks);
  wireResultStorySections();
}

// ── Why this playlist ─────────────────────────────────────────────────────────
function emotionArcFromVector(evec) {
  const labels = {
    energy: "Energetic",
    valence: "Uplifting",
    calm: "Calm",
    nostalgia: "Nostalgic",
    tension: "Restless",
  };
  const ranked = ["energy", "calm", "nostalgia", "tension", "valence"]
    .map((key) => [key, evec[key] ?? 0])
    .sort((a, b) => b[1] - a[1]);
  const top = ranked.filter(([, v]) => v >= 0.35).slice(0, 3).map(([k]) => labels[k] || k);
  if (top.length >= 2) return top.join(" → ");
  if (top.length === 1) return top[0];
  return "";
}

function builtAroundBullets(laneList, div) {
  const bullets = [];
  const laneSorted = [...(laneList || [])].sort((a, b) => (b.pctContribution || 0) - (a.pctContribution || 0));
  const core = laneSorted.find((l) => /core/i.test(l.laneId || l.label || ""));
  const discovery = laneSorted.find((l) => /discovery|rediscover/i.test(l.laneId || l.label || ""));
  const emotional = laneSorted.find((l) => /emotional/i.test(l.laneId || l.label || ""));
  if (core && (core.pctContribution || 0) >= 15) bullets.push("familiar favourites");
  if (discovery && (discovery.pctContribution || 0) >= 8) bullets.push("forgotten tracks");
  if (emotional && (emotional.pctContribution || 0) >= 10) bullets.push("songs tied to the feeling");
  if (div?.dominantEra) bullets.push(`music from the ${String(div.dominantEra).replace(/_/g, " ")} era`);
  else if (div?.dominantGenre) bullets.push(`${String(div.dominantGenre).replace(/_/g, " ")} you already love`);
  return bullets.slice(0, 4);
}

function buildExplainEmotionalLead(expl) {
  const intent = expl.intentSummary || {};
  const laneList = expl.laneDetails || [];
  const div = expl.diversityReport || {};
  const evec = intent.emotionVector || {};
  const arc = emotionArcFromVector(evec);
  const bullets = builtAroundBullets(laneList, div);
  const primary = intent.primaryIntent
    ? String(intent.primaryIntent).replace(/_/g, " ")
    : "";
  return `
    <div class="explain-emotional-lead">
      <h3 class="explain-emotional-title">Why this fits</h3>
      ${arc ? `<p class="explain-emotional-arc">This playlist moves from <strong>${esc(arc)}</strong></p>` : ""}
      ${primary && !arc ? `<p class="explain-emotional-arc">Shaped around <strong>${esc(primary)}</strong></p>` : ""}
      ${bullets.length ? `<div class="explain-built-around">
        <span class="explain-built-label">Built around</span>
        <ul class="explain-built-list">${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </div>` : ""}
    </div>`;
}

function buildTechnicalExplanationHtml(expl) {
  const intent = expl.intentSummary || {};
  const laneList = expl.laneDetails || [];
  const clusters = expl.clusterMap || {};
  const div = expl.diversityReport || {};
  const sel = expl.selectionSummary || {};

  const LANE_COLORS = { core:"#7c3aed", emotional:"#db2777", motion:"#0891b2", contrast:"#d97706", discovery:"#16a34a", fallback:"#6b7280", ambient:"#0e7490", high_energy:"#dc2626", low_energy:"#2563eb" };
  const laneColor = (id) => LANE_COLORS[id] || LANE_COLORS[id?.split("_")[0]] || "#6b7280";

  const evec = intent.emotionVector || {};
  const evecKeys = ["energy", "valence", "calm", "nostalgia", "tension"];
  const evecColors = { energy:"#f59e0b", valence:"#c4a574", calm:"#38bdf8", nostalgia:"#a78bfa", tension:"#f87171" };
  const eraVec = intent.eraVector || {};
  const topEras = Object.entries(eraVec).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sceneMap = intent.sceneInfluenceMap || {};
  const topScenes = Object.entries(sceneMap).filter(([, v]) => v > 0.05).slice(0, 3);

  const intentHtml = `
  <div class="explain-card">
    <div class="explain-card-title">What we understood</div>
    <div class="explain-intent-primary">${esc(String(intent.primaryIntent || "(missing intent)")).replace(/_/g, " ")}</div>
    ${(intent.secondaryIntents || []).length ? `<div class="explain-secondary-tags">${(intent.secondaryIntents || []).slice(0, 6).map((s) => `<span class="explain-tag">${esc(String(s).replace(/_/g, " "))}</span>`).join("")}</div>` : ""}
    <div class="explain-emotion-grid">
      ${evecKeys.map((k) => {
        const v = evec[k] ?? 0;
        const pct = Math.round(v * 100);
        const col = evecColors[k] || "#a78bfa";
        return `<div class="explain-emotion-item">
          <span class="explain-emotion-label">${k}</span>
          <div class="explain-emotion-bar-wrap"><div class="explain-emotion-bar" style="width:${pct}%;background:${col}"></div></div>
          <span class="explain-emotion-val">${pct}%</span>
        </div>`;
      }).join("")}
    </div>
    ${topEras.length ? `<div class="explain-card-note">Era focus: ${topEras.map(([e, c]) => `<span>${esc(e)}</span> (${c})`).join(", ")}</div>` : ""}
    ${topScenes.length ? `<div class="explain-card-note">Scene signals: ${topScenes.map(([s, v]) => `<span>${esc(s.replace(/_/g, " "))}</span> ${Math.round(v * 100)}%`).join(", ")}</div>` : ""}
  </div>`;

  const laneSorted = [...laneList].sort((a, b) => b.pctContribution - a.pctContribution);
  const laneHtml = laneSorted.length ? `
  <div class="explain-card">
    <div class="explain-card-title">How tracks were chosen</div>
    <div class="explain-lane-list">
      ${laneSorted.map((l) => {
        const col = laneColor(l.laneId);
        const pct = l.pctContribution || 0;
        return `<div class="explain-lane-row">
          <span class="explain-lane-label" title="${esc(l.laneId)}">${esc((l.label || l.laneId || "").replace(/_/g, " "))}</span>
          <div class="explain-lane-bar-wrap"><div class="explain-lane-bar" style="width:${pct}%;background:${col}"></div></div>
          <span class="explain-lane-pct">${pct}%</span>
          <span class="explain-lane-count">${l.selectedCount || 0} / ${l.scoredCount || 0}</span>
        </div>`;
      }).join("")}
    </div>
  </div>` : "";

  const clusterEntries = Object.entries(clusters)
    .filter(([, v]) => (v.trackCount || 0) > 0 || (v.weightContribution || 0) > 0)
    .sort((a, b) => (b[1].weightContribution || 0) - (a[1].weightContribution || 0))
    .slice(0, 8);

  const clusterHtml = clusterEntries.length ? `
  <div class="explain-card">
    <div class="explain-card-title">Why tracks grouped together</div>
    <div class="explain-cluster-grid">
      ${clusterEntries.map(([cid, cv]) => {
        const label = cid.replace(/^genre:|^era:|^energy:/, "").replace(/_/g, " ");
        const wpct = Math.round((cv.weightContribution || 0) * 100);
        return `<div class="explain-cluster-row">
          <span class="explain-cluster-id">${esc(label)}</span>
          <span class="explain-cluster-genres">${cv.genres && cv.genres.length ? cv.genres.slice(0, 3).map((g) => esc(g.replace(/_/g, " "))).join(", ") : cid.split(":")[0]}</span>
          <span class="explain-cluster-tracks">${cv.trackCount || 0} tracks</span>
          <span class="explain-cluster-weight" title="cluster weight contribution">${wpct}%</span>
        </div>`;
      }).join("")}
    </div>
  </div>` : "";

  const entropyRows = [
    { name: "Genre variety", val: div.genreEntropy || 0, count: div.genreCount || 0, unit: "genres", col: "#7c3aed" },
    { name: "Artist spread", val: div.artistEntropy || 0, count: div.artistCount || 0, unit: "artists", col: "#0891b2" },
    { name: "Era spread", val: div.eraEntropy || 0, count: div.eraCount || 0, unit: "eras", col: "#d97706" },
    { name: "Diversity balance", val: div.diversityPressure || 0, count: null, unit: null, col: "#f87171" },
  ];
  const entropyNote = (v) => (v >= 0.75 ? "broad selection" : v >= 0.45 ? "balanced spread" : "intentionally focused");

  const diversityHtml = `
  <div class="explain-card">
    <div class="explain-card-title">Variety across the mix</div>
    <div class="explain-entropy-list">
      ${entropyRows.map((r) => {
        const pct = Math.round(r.val * 100);
        return `<div class="explain-entropy-row">
          <div class="explain-entropy-header">
            <span class="explain-entropy-name">${esc(r.name)}${r.count !== null ? ` <span>(${r.count} ${r.unit})</span>` : ""}</span>
            <span class="explain-entropy-val">${pct}%</span>
          </div>
          <div class="explain-entropy-bar-wrap"><div class="explain-entropy-bar" style="width:${pct}%;background:${r.col}"></div></div>
          <span class="explain-entropy-note">${entropyNote(r.val)}</span>
        </div>`;
      }).join("")}
    </div>
    ${div.dominantGenre ? `<div class="explain-card-note">Dominant genre: <strong>${esc(div.dominantGenre.replace(/_/g, " "))}</strong>${div.dominantEra ? ` · Era: <strong>${esc(div.dominantEra)}</strong>` : ""}</div>` : ""}
  </div>`;

  const selRate = sel.selectionRate ?? (sel.totalCandidates > 0 ? Math.round(sel.selected / sel.totalCandidates * 100) : 0);
  const rejReasons = (sel.topRejectionReasons || []).map((r) => r.replace(/_/g, " "));

  const selHtml = `
  <div class="explain-card">
    <div class="explain-card-title">What made the cut</div>
    <div class="explain-sel-stats">
      <div class="explain-sel-stat">
        <div class="explain-sel-num">${sel.totalCandidates || 0}</div>
        <div class="explain-sel-lbl">Considered</div>
      </div>
      <div class="explain-sel-stat">
        <div class="explain-sel-num explain-sel-num--good">${sel.selected || 0}</div>
        <div class="explain-sel-lbl">Chosen</div>
      </div>
      <div class="explain-sel-stat">
        <div class="explain-sel-num explain-sel-num--muted">${sel.rejected || 0}</div>
        <div class="explain-sel-lbl">Passed over</div>
      </div>
    </div>
    <div class="explain-sel-rate">
      <span>Fit rate</span>
      <span>${selRate}%</span>
      <div class="explain-sel-rate-bar"><div style="width:${selRate}%"></div></div>
    </div>
    ${rejReasons.length ? `
    <div class="explain-rejection-list">
      ${rejReasons.map((r) => `<div class="explain-rejection-item"><span class="explain-rejection-dot"></span>${esc(r)}</div>`).join("")}
    </div>` : ""}
  </div>`;

  return `${intentHtml}${laneHtml}${clusterHtml}${diversityHtml}${selHtml}`;
}

function renderPlaylistExplanation(expl) {
  if (!expl) {
    return `<section class="result-why-section"><div class="explain-card explain-card--empty">No explanation data for this playlist yet.</div></section>`;
  }

  const emotionalLead = buildExplainEmotionalLead(expl);
  const technicalHtml = buildTechnicalExplanationHtml(expl);

  return `<section class="result-why-section">
    ${emotionalLead}
    <details class="explain-technical-details">
      <summary>See how we built this</summary>
      <div class="explain-panel">${technicalHtml}</div>
    </details>
  </section>`;
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
  if (onboardingKeyHandler) {
    document.removeEventListener("keydown", onboardingKeyHandler);
    onboardingKeyHandler = null;
  }
  if (!overlay) return;
  const focusables = () =>
    [...overlay.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((el) => !el.disabled);
  onboardingKeyHandler = (e) => {
    if (e.key === "Escape") {
      markOnboardingDone();
      _savedPrefs.onboardingDone = true;
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
  document.addEventListener("keydown", onboardingKeyHandler);
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
  document.getElementById("gateSyncBtn")?.addEventListener("click", () => {
    document.getElementById("navRight")?.classList.remove("nav-right--collapsed");
    document.getElementById("navMenuToggle")?.setAttribute("aria-expanded", "true");
    triggerSync(false);
  });

  document.getElementById("refinePanel")?.addEventListener("toggle", (e) => {
    state.refineOpen = Boolean(e.currentTarget?.open);
  });

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
    state.noLibraryMode = true;
    saveUserPref("discoveryMode", true);
    state.error = null;
    state.errorKind = null;
    generate({ forceDiscoveryMode: true, keepFailureSession: true });
  });
  document.getElementById("turnOffDiscoveryBtn")?.addEventListener("click", () => {
    state.noLibraryMode = false;
    saveUserPref("discoveryMode", false);
    state.error = null;
    state.errorKind = null;
    renderApp();
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

  document.querySelectorAll(".library-chapter-chip, [data-inspire-prompt]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-chapter-prompt") || chip.getAttribute("data-inspire-prompt");
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
    if (charCount) charCount.textContent = text.length;
    clearTimeout(interpretTimer);
    updateMoodPanel(text);
  });

  vibeInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); }
  });

  document.getElementById("lengthSlider")?.addEventListener("input", (e) => {
    state.length = Number(e.target.value);
    saveUserPref("length", state.length);
    const lengthLabel = document.getElementById("lengthLabel");
    if (lengthLabel) lengthLabel.textContent = `${state.length} songs`;
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

  document.querySelectorAll(".activity-item--clickable[data-activity-moment]").forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      el.click();
    });
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
  if (state.cacheStatus?.syncError) {
    state.error = `Library sync failed: ${state.cacheStatus.syncError}`;
    state.errorKind = "sync";
  } else if (!csRes.ok || !lsRes.ok) {
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
  if (gate.thinLibrary && !state.noLibraryMode) {
    showToast(gate.message, "info");
  }
  const discoveryActive = opts.forceDiscoveryMode === true || state.noLibraryMode;
  if (discoveryActive && !isDiscoveryGenreReady(vibe, state.preview)) {
    showToast(discoveryToastMessage(vibe, state.preview), "error");
    return;
  }
  if (opts.forceDiscoveryMode) {
    state.noLibraryMode = true;
    saveUserPref("discoveryMode", true);
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

    if (r.status === 401) {
      try { localStorage.setItem("kwalify-pending-prompt", savedVibe); } catch { /* ignore */ }
      window.location.href = "/api/auth/login";
      return;
    }

    const libraryInsufficient =
      r.data?.code === "LIBRARY_INSUFFICIENT_FOR_PROMPT" ||
      r.data?.reason === "LIBRARY_INSUFFICIENT_FOR_PROMPT";

    const isServerBusy = r.status === 503 && (r.data?.code === "SERVER_BUSY" || r.data?.code === "QUEUE_TIMEOUT");
    const isRateLimited = r.status === 429 && r.data?.code === "RATE_LIMITED";

    if (libraryInsufficient) {
      handleLibraryInsufficientResponse(r.data, savedVibe);
    } else if (isServerBusy || isRateLimited) {
      const retryAfter = Number(r.data?.retryAfterSeconds ?? r.data?.retry_after ?? 10) || 10;
      state.error = isRateLimited
        ? "You've generated a lot in a short time. Auto-retrying shortly."
        : r.data?.code === "QUEUE_TIMEOUT"
          ? "The server queue was busy. Auto-retrying shortly."
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
      } else if (isDiscoveryModeError(r.data?.code)) {
        state.error = r.data?.error || r.data?.message || userFacingApiError(r, "Discovery Mode could not complete this prompt.");
        state.errorDetails = r.data || null;
        state.errorKind = "discovery";
        if (r.data?.hint) state.errorDetails.hint = r.data.hint;
      } else {
        state.error = userFacingApiError(r, "Generation failed. Please try a broader prompt or Balanced mode.");
      }
      state.errorDetails = state.errorDetails || r.data || null;
      state.errorKind = state.errorKind || "generation";
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
    if (runId === state.generationRunId && state.lastResult) {
      requestAnimationFrame(() => {
        document.getElementById("resultReveal")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    const input = document.getElementById("vibeInput");
    if (input) {
      input.value = savedVibe;
      state.draftVibe = savedVibe;
      const count = document.getElementById("charCount");
      if (count) count.textContent = String(savedVibe.length);
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
