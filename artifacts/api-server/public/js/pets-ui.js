/**
 * Kwalify object UI — Spotify Pets-influenced illustration in night atmosphere.
 * Style DNA: docs/KWALIFY_STYLE_DNA.md
 * Requires globals: $, esc, showToast, api (from index.html).
 */
(function () {
  'use strict';

  const EMOTION_MOODS = [
    { sceneId: 'petrol_station_2am', title: 'Night Refuel', illust: 'pump', bg: '#2779a7', vibe: 'petrol station 2am empty forecourt', cardTint: 'rgba(39,121,167,.42)' },
    { sceneId: 'night_drive', title: 'Motorway Drive', illust: 'road', bg: '#2e6f9a', vibe: 'night drive motorway alone', cardTint: 'rgba(46,111,154,.4)' },
    { sceneId: 'urban_midnight_walk', title: 'Late London Walk', illust: 'lamp', bg: '#245f88', vibe: 'midnight city walk london alone', cardTint: 'rgba(36,95,136,.4)' },
    { sceneId: 'memory_road', title: 'Old Car Project', illust: 'car', bg: '#2a759f', vibe: 'nostalgic country road memory', cardTint: 'rgba(42,117,159,.38)' },
    { sceneId: 'summer_afternoon_drift', title: 'End of Summer Drive', illust: 'horizon', bg: '#3a8fbf', vibe: 'summer afternoon drift warm haze', cardTint: 'rgba(58,143,191,.36)' },
  ];

  const PETS_ILLUST_DEFS = {
    /* Reference hero — Pets chunkiness + Kwalify night object */
    pump: `<svg viewBox="0 0 80 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="pg" x1="39" y1="28" x2="41" y2="86" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F8FAFF"/><stop offset="1" stop-color="#A8BCD4"/></linearGradient>
      <linearGradient id="ph" x1="39" y1="12" x2="41" y2="34" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F2F6FE"/><stop offset="1" stop-color="#C0D0E8"/></linearGradient>
      <linearGradient id="ps" x1="39" y1="38" x2="41" y2="56" gradientUnits="userSpaceOnUse">
        <stop stop-color="#B8E4FC"/><stop offset="1" stop-color="#78B8E0" stop-opacity=".65"/></linearGradient>
      <radialGradient id="pgl" cx="39" cy="49" r="14" gradientUnits="userSpaceOnUse">
        <stop stop-color="#88D0F8" stop-opacity=".42"/><stop offset="1" stop-color="#88D0F8" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="39" cy="90" rx="26" ry="6" fill="rgba(15,40,60,.16)"/>
      <rect x="14" y="28" width="50" height="62" rx="26" fill="url(#pg)"/>
      <rect x="16" y="6" width="46" height="28" rx="18" fill="url(#ph)"/>
      <rect x="21" y="38" width="36" height="22" rx="12" fill="url(#ps)"/>
      <path d="M59 76 Q78 68, 82 46" fill="none" stroke="#98AAC4" stroke-width="11" stroke-linecap="round"/>
      <rect x="72" y="40" width="20" height="16" rx="10" fill="#88A0BC"/>
      <ellipse cx="39" cy="49" rx="15" ry="11" fill="url(#pgl)"/>
    </svg>`,
    road: `<svg viewBox="0 0 96 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="rg" x1="4" y1="32" x2="92" y2="32" gradientUnits="userSpaceOnUse">
        <stop stop-color="#7ec8f0"/><stop offset=".45" stop-color="#e8f4fc"/><stop offset="1" stop-color="#6ab0e0"/></linearGradient></defs>
      <path d="M6 46 C26 10 44 54 66 18 C76 6 90 26 90 26" stroke="url(#rg)" stroke-width="20" stroke-linecap="round" fill="none"/>
      <path d="M10 50 C30 30 50 58 70 34" stroke="rgba(255,255,255,.35)" stroke-width="9" stroke-linecap="round" fill="none"/>
    </svg>`,
    lamp: `<svg viewBox="0 0 72 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><radialGradient id="lg" cx="36" cy="20" r="30" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFFCE8"/><stop offset=".4" stop-color="#F8E090"/><stop offset="1" stop-color="#E8B050" stop-opacity="0"/></radialGradient>
      <linearGradient id="lp" x1="36" y1="34" x2="36" y2="94" gradientUnits="userSpaceOnUse">
        <stop stop-color="#E4ECFA"/><stop offset="1" stop-color="#98A8C0"/></linearGradient></defs>
      <ellipse cx="36" cy="90" rx="16" ry="5" fill="rgba(15,40,60,.14)"/>
      <ellipse cx="36" cy="22" rx="32" ry="28" fill="url(#lg)"/>
      <circle cx="36" cy="20" r="18" fill="#FFFCF0"/>
      <rect x="26" y="34" width="20" height="58" rx="10" fill="url(#lp)"/>
    </svg>`,
    car: `<svg viewBox="0 0 96 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="cg" x1="48" y1="6" x2="48" y2="46" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F4F8FF"/><stop offset="1" stop-color="#A0B4CC"/></linearGradient></defs>
      <ellipse cx="48" cy="50" rx="38" ry="6" fill="rgba(15,40,60,.14)"/>
      <rect x="6" y="16" width="84" height="32" rx="22" fill="url(#cg)"/>
      <rect x="24" y="6" width="48" height="22" rx="15" fill="rgba(255,255,255,.52)"/>
      <circle cx="22" cy="46" r="13" fill="#90A4BC"/><circle cx="22" cy="46" r="7" fill="#E8F0FA"/>
      <circle cx="74" cy="46" r="13" fill="#90A4BC"/><circle cx="74" cy="46" r="7" fill="#E8F0FA"/>
    </svg>`,
    horizon: `<svg viewBox="0 0 96 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="hg" x1="4" y1="22" x2="92" y2="22" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFE8C0" stop-opacity=".35"/><stop offset=".4" stop-color="#F0C880"/><stop offset=".65" stop-color="#E8A868"/><stop offset="1" stop-color="#F8D8B0" stop-opacity=".22"/></linearGradient>
      <linearGradient id="hg2" x1="48" y1="34" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stop-color="#A8C8E8" stop-opacity=".6"/><stop offset="1" stop-color="#5880A8" stop-opacity=".2"/></linearGradient></defs>
      <ellipse cx="48" cy="22" rx="46" ry="15" fill="url(#hg)"/>
      <ellipse cx="48" cy="40" rx="50" ry="11" fill="url(#hg2)"/>
    </svg>`,
  };

  let _emotionGridWired = false;
  let _moodGenAbort = null;
  let _moodGenerating = false;
  let _activeMood = null;
  let _dragAnim = null;
  let _dragProgress = 0;
  let _lastGenError = false;

  function _uniquePetsSvg(svg, key) {
    const u = String(key).replace(/[^a-z0-9]/gi, '') || 'x';
    return svg
      .replace(/\bid="([a-z0-9]+)"/gi, (_, id) => `id="${id}-${u}"`)
      .replace(/url\(#([a-z0-9]+)\)/gi, (_, id) => `url(#${id}-${u})`);
  }

  function _petsIllustHtml(illust, variant) {
    const raw = PETS_ILLUST_DEFS[illust] || PETS_ILLUST_DEFS.pump;
    const svg = _uniquePetsSvg(raw, illust + '-' + variant);
    const cls = variant === 'hero' ? 'pets-illust pets-illust--hero' : 'pets-illust pets-illust--preview';
    if (variant === 'hero') {
      return `<span class="${cls}"><span class="pets-illust-inner">${svg}</span></span>`;
    }
    return `<span class="${cls}">${svg}</span>`;
  }

  function _emotionSceneBg(hex) {
    return `radial-gradient(ellipse 82% 72% at 50% 38%, ${hex} 0%, ${hex}99 18%, #1a5080 48%, #0f2840 78%, #08090c 100%)`;
  }

  function _emotionPreviewHtml(illust) { return _petsIllustHtml(illust, 'preview'); }
  function _emotionHeroHtml(illust) { return _petsIllustHtml(illust, 'hero'); }

  function _startDragBar() {
    _stopDragBar();
    const bar = $('petsDragBar');
    const fill = $('petsDragFill');
    const label = $('petsDragLabel');
    if (!bar || !fill) return;
    bar.hidden = false;
    if (label) label.textContent = 'building playlist';
    _dragProgress = 0.06;
    const tick = () => {
      if (!_moodGenerating) return;
      _dragProgress += (0.9 - _dragProgress) * 0.015 + 0.001;
      const pct = Math.max(6, Math.min(88, _dragProgress * 100));
      fill.style.width = `${pct}%`;
      _dragAnim = requestAnimationFrame(tick);
    };
    _dragAnim = requestAnimationFrame(tick);
  }

  function _stopDragBar(finish) {
    if (_dragAnim) cancelAnimationFrame(_dragAnim);
    _dragAnim = null;
    const bar = $('petsDragBar');
    const fill = $('petsDragFill');
    if (finish && fill) fill.style.width = '100%';
    if (bar && !finish) bar.hidden = true;
  }

  function _setGenUI(state, opts = {}) {
    const bar = $('petsDragBar');
    const btn = $('petsSpotifyBtn');
    const retry = $('petsRetryBtn');
    const hint = $('petsSceneHint');
    const label = $('petsDragLabel');

    if (state === 'loading') {
      _startDragBar();
    } else {
      _stopDragBar(state === 'ready');
      if (bar) bar.hidden = true;
    }

    if (btn) {
      const show = state === 'ready' && opts.spotifyUrl;
      btn.hidden = !show;
      if (show) {
        btn.href = opts.spotifyUrl;
        btn.textContent = opts.trackCount ? `Open in Spotify · ${opts.trackCount} tracks` : 'Open in Spotify';
      }
    }
    if (retry) {
      retry.hidden = state !== 'error';
    }
    if (label && state === 'ready') label.textContent = 'ready';
    if (hint) {
      if (state === 'loading') hint.textContent = 'hold on…';
      else if (state === 'ready') hint.textContent = 'tap anywhere to return';
      else if (state === 'error') hint.textContent = 'tap to return · or try again';
      else hint.textContent = 'tap to return';
    }
    _lastGenError = state === 'error';
  }

  function _cancelMoodGenerate() {
    if (_moodGenAbort) {
      _moodGenAbort.abort();
      _moodGenAbort = null;
    }
    _moodGenerating = false;
    _stopDragBar(false);
  }

  async function generateFromMood(mood) {
    if (!mood) return;
    _cancelMoodGenerate();
    _activeMood = mood;
    _moodGenerating = true;
    _lastGenError = false;
    _setGenUI('loading');

    const ctrl = new AbortController();
    _moodGenAbort = ctrl;
    const timeout = setTimeout(() => ctrl.abort(), 120000);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        credentials: 'include',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vibe: mood.vibe,
          length: 25,
          mode: 'balanced',
          sceneId: mood.sceneId,
        }),
      });
      const d = await res.json().catch(() => ({}));

      if (ctrl.signal.aborted && _moodGenAbort !== ctrl) return;

      if (res.status === 401) {
        showToast('Session expired — log in again.', 'error', 4000);
        setTimeout(() => { location.href = '/api/auth/login'; }, 1800);
        return;
      }
      if (res.status === 409 || d.code === 'GENERATION_IN_PROGRESS') {
        _setGenUI('error', { message: 'already generating' });
        showToast('Already generating — wait a moment.', 'info', 3500);
        return;
      }
      if (!res.ok || d.error) {
        _setGenUI('error', { message: 'try again' });
        showToast(d.error || 'Could not build playlist.', 'error', 5000);
        return;
      }
      if (!Array.isArray(d.tracks) || !d.tracks.length) {
        _setGenUI('error', { message: 'no tracks matched' });
        showToast('No tracks matched. Try syncing your library.', 'error', 5500);
        return;
      }

      const count = d.count || d.totalTracks || d.tracks.length;
      _setGenUI('ready', { spotifyUrl: d.spotifyPlaylistUrl || null, trackCount: count });
      if (d.spotifyPlaylistUrl) {
        showToast(`Playlist ready — ${count} tracks`, 'success', 2800);
      } else {
        showToast(`Saved — ${count} tracks`, 'info', 4000);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      _setGenUI('error', { message: 'connection failed' });
      showToast('Connection failed — try again.', 'error', 4500);
    } finally {
      clearTimeout(timeout);
      _moodGenerating = false;
      if (_moodGenAbort === ctrl) _moodGenAbort = null;
    }
  }

  function renderEmotionGrid() {
    const grid = $('emotionMoodGrid');
    if (!grid) return;
    grid.innerHTML = EMOTION_MOODS.map((m) => `
      <button type="button" class="pets-card" role="listitem" data-scene="${m.sceneId}"
        style="background:linear-gradient(168deg, ${m.cardTint} 0%, rgba(255,255,255,.1) 42%, rgba(8,24,40,.35) 100%)">
        ${_emotionPreviewHtml(m.illust)}
        <span class="pets-card-title">${esc(m.title)}</span>
      </button>`).join('');
    grid.querySelectorAll('.pets-card').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEmotionScene(btn.dataset.scene);
      });
    });
  }

  function setEmotionUIState(state, sceneId) {
    document.body.classList.toggle('pets-home-active', state === 'grid');
    document.body.classList.toggle('pets-scene-active', state === 'scene');
    const scene = $('emotionScene');
    const obj = $('emotionSceneObject');
    if (state === 'grid') {
      scene?.setAttribute('aria-hidden', 'true');
      obj?.querySelector('.pets-illust--hero')?.classList.remove('pets-hero-in');
      _cancelMoodGenerate();
      _activeMood = null;
      _setGenUI('idle');
    } else if (state === 'scene') {
      const mood = EMOTION_MOODS.find((m) => m.sceneId === sceneId);
      if (!mood) return;
      scene?.setAttribute('aria-hidden', 'false');
      const bg = $('emotionSceneBg');
      if (bg) bg.style.background = _emotionSceneBg(mood.bg);
      if (obj) {
        obj.innerHTML = _emotionHeroHtml(mood.illust);
        const hero = obj.querySelector('.pets-illust--hero');
        hero?.classList.remove('pets-hero-in');
        requestAnimationFrame(() => hero?.classList.add('pets-hero-in'));
      }
      _activeMood = mood;
      _setGenUI('idle');
      clearTimeout(openEmotionScene._genT);
      openEmotionScene._genT = setTimeout(() => generateFromMood(mood), 720);
    }
  }

  function openEmotionScene(sceneId) {
    document.body.classList.add('pets-transitioning');
    setEmotionUIState('scene', sceneId);
    clearTimeout(openEmotionScene._t);
    openEmotionScene._t = setTimeout(() => document.body.classList.remove('pets-transitioning'), 560);
  }

  function closeEmotionScene() {
    _cancelMoodGenerate();
    setEmotionUIState('grid');
  }

  function initPetsChrome() { /* Pets art, restrained chrome — no custom cursor */ }

  function _wireLogout() {
    const btn = $('petsLogout');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api('/auth/logout', { method: 'POST' });
      location.reload();
    });
  }

  function initEmotionGridUI() {
    renderEmotionGrid();
    setEmotionUIState('grid');
    if (_emotionGridWired) return;
    _emotionGridWired = true;
    const scene = $('emotionScene');
    scene?.addEventListener('click', (e) => {
      if (e.target.closest('#petsSpotifyBtn, #petsRetryBtn')) return;
      closeEmotionScene();
    });
    $('petsSpotifyBtn')?.addEventListener('click', (e) => e.stopPropagation());
    $('petsRetryBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_activeMood) generateFromMood(_activeMood);
    });
    _wireLogout();
  }

  function _mountGuestHero() {
    const hero = $('guestHeroIllust');
    const edge = $('guestEdgeDecor');
    if (hero && !hero.dataset.mounted) {
      hero.innerHTML = _emotionPreviewHtml('pump');
      hero.dataset.mounted = '1';
    }
    if (!edge || edge.dataset.mounted) return;
    const ghosts = [
      { illust: 'lamp', cls: 'ghost-l' },
      { illust: 'horizon', cls: 'ghost-r' },
    ];
    edge.innerHTML = ghosts.map((s, i) =>
      `<span class="pets-guest-edge-item pets-guest-edge-item--${s.cls}">${_uniquePetsSvg(PETS_ILLUST_DEFS[s.illust], 'guest-ghost-' + i)}</span>`
    ).join('');
    edge.dataset.mounted = '1';
  }

  window.initEmotionGridUI = initEmotionGridUI;
  window._mountGuestHero = _mountGuestHero;
  window.initPetsChrome = initPetsChrome;
  window.openEmotionScene = openEmotionScene;
  window.closeEmotionScene = closeEmotionScene;
  window.EMOTION_MOODS = EMOTION_MOODS;
})();
