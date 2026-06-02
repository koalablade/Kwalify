/**
 * Kwalify object UI — flat Spotify Pets picker illustration style.
 * Style DNA: docs/KWALIFY_STYLE_DNA.md · pump: docs/KWALIFY_PETROL_PUMP_SVG_LOCKED.md
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

  /* Flat Pets picker palette — no gradients, oval shadows, bold rounded forms */
  const PETS_ILLUST_DEFS = {
    pump: `<svg viewBox="0 0 80 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="40" cy="91" rx="30" ry="6" fill="#14805A"/>
      <rect x="15" y="30" width="50" height="58" rx="22" fill="#1ED760"/>
      <rect x="18" y="8" width="44" height="26" rx="15" fill="#1DB954"/>
      <rect x="23" y="40" width="34" height="20" rx="10" fill="#FFFFFF"/>
      <rect x="27" y="46" width="26" height="8" rx="4" fill="#F57357"/>
      <path d="M58 74 Q76 66, 80 48" stroke="#121212" stroke-width="10" stroke-linecap="round"/>
      <rect x="72" y="40" width="20" height="16" rx="8" fill="#F57357"/>
    </svg>`,
    road: `<svg viewBox="0 0 96 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="48" cy="58" rx="38" ry="5" fill="#14805A"/>
      <path d="M4 44 C24 8 42 52 64 16 C74 4 92 24 92 24" stroke="#1ED760" stroke-width="18" stroke-linecap="round"/>
      <path d="M10 46 C28 28 48 54 68 30" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" stroke-dasharray="10 12"/>
    </svg>`,
    lamp: `<svg viewBox="0 0 72 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="36" cy="91" rx="16" ry="5" fill="#14805A"/>
      <circle cx="36" cy="22" r="24" fill="#F57357"/>
      <circle cx="36" cy="22" r="15" fill="#FF8A70"/>
      <rect x="28" y="38" width="16" height="54" rx="8" fill="#1ED760"/>
    </svg>`,
    car: `<svg viewBox="0 0 96 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="48" cy="52" rx="38" ry="5" fill="#14805A"/>
      <rect x="6" y="18" width="84" height="30" rx="18" fill="#FFFFFF"/>
      <ellipse cx="66" cy="26" rx="20" ry="14" fill="#F57357"/>
      <rect x="22" y="6" width="50" height="20" rx="12" fill="#FFFFFF"/>
      <circle cx="22" cy="46" r="12" fill="#121212"/><circle cx="22" cy="46" r="6" fill="#FFFFFF"/>
      <circle cx="74" cy="46" r="12" fill="#121212"/><circle cx="74" cy="46" r="6" fill="#FFFFFF"/>
    </svg>`,
    horizon: `<svg viewBox="0 0 96 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="48" cy="44" rx="46" ry="10" fill="#1ED760"/>
      <ellipse cx="48" cy="20" rx="22" ry="18" fill="#F57357"/>
      <ellipse cx="48" cy="24" rx="18" ry="12" fill="#FF8A70"/>
    </svg>`,
  };

  let _emotionGridWired = false;
  let _moodGenAbort = null;
  let _moodGenerating = false;
  let _activeMood = null;
  let _dragAnim = null;
  let _dragProgress = 0;

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
    if (state !== 'world' && typeof window.closeEmotionWorld === 'function') {
      window.closeEmotionWorld();
    }
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
    if (typeof window.initWorldLayer === 'function') window.initWorldLayer();
  }

  function _mountGuestHero() {
    const accent = $('guestTitleAccent');
    const edge = $('guestEdgeDecor');
    if (accent && !accent.dataset.mounted) {
      accent.innerHTML = _uniquePetsSvg(PETS_ILLUST_DEFS.pump, 'guest-accent');
      accent.dataset.mounted = '1';
    }
    if (!edge || edge.dataset.mounted) return;
    const slots = [
      { illust: 'lamp', cls: 'tl' },
      { illust: 'car', cls: 'ml' },
      { illust: 'pump', cls: 'mr' },
      { illust: 'road', cls: 'br' },
    ];
    edge.innerHTML = slots.map((s, i) =>
      `<span class="pets-guest-edge-item pets-guest-edge-item--${s.cls}">${_uniquePetsSvg(PETS_ILLUST_DEFS[s.illust] || PETS_ILLUST_DEFS.pump, 'guest-' + s.cls + i)}</span>`
    ).join('');
    edge.dataset.mounted = '1';
  }

  window.initEmotionGridUI = initEmotionGridUI;
  window._mountGuestHero = _mountGuestHero;
  window.initPetsChrome = initPetsChrome;
  window.openEmotionScene = openEmotionScene;
  window.closeEmotionScene = closeEmotionScene;
  window.EMOTION_MOODS = EMOTION_MOODS;
  window.KW_illustPreview = _emotionPreviewHtml;
})();
