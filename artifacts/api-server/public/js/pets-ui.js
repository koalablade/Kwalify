/**
 * Kwalify object UI — emotional artifacts in quiet space.
 * Style DNA: docs/KWALIFY_STYLE_DNA.md
 * Requires globals: $, esc, showToast, api (from index.html).
 */
(function () {
  'use strict';

  const EMOTION_MOODS = [
    { sceneId: 'petrol_station_2am', title: 'Night Refuel', illust: 'pump', bg: '#1a2438', vibe: 'petrol station 2am empty forecourt', cardTint: 'rgba(26,34,52,.35)' },
    { sceneId: 'night_drive', title: 'Motorway Drive', illust: 'road', bg: '#161e2c', vibe: 'night drive motorway alone', cardTint: 'rgba(22,30,44,.32)' },
    { sceneId: 'urban_midnight_walk', title: 'Late London Walk', illust: 'lamp', bg: '#1c2430', vibe: 'midnight city walk london alone', cardTint: 'rgba(24,32,48,.32)' },
    { sceneId: 'memory_road', title: 'Old Car Project', illust: 'car', bg: '#182030', vibe: 'nostalgic country road memory', cardTint: 'rgba(20,28,42,.32)' },
    { sceneId: 'summer_afternoon_drift', title: 'End of Summer Drive', illust: 'horizon', bg: '#222838', vibe: 'summer afternoon drift warm haze', cardTint: 'rgba(28,32,48,.28)' },
  ];

  const PETS_ILLUST_DEFS = {
    /* Reference hero — docs/KWALIFY_PETROL_PUMP_SVG_LOCKED.md · night forecourt */
    pump: `<svg viewBox="0 0 80 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="pg" x1="38" y1="30" x2="42" y2="88" gradientUnits="userSpaceOnUse">
        <stop stop-color="#5a6478"/><stop offset="1" stop-color="#3a4254"/></linearGradient>
      <linearGradient id="ph" x1="38" y1="10" x2="42" y2="34" gradientUnits="userSpaceOnUse">
        <stop stop-color="#6a7488"/><stop offset="1" stop-color="#484f60"/></linearGradient>
      <linearGradient id="ps" x1="38" y1="40" x2="42" y2="58" gradientUnits="userSpaceOnUse">
        <stop stop-color="#8ec4e0" stop-opacity=".55"/><stop offset="1" stop-color="#5a8aa8" stop-opacity=".25"/></linearGradient>
      <radialGradient id="pgl" cx="38" cy="50" r="12" gradientUnits="userSpaceOnUse">
        <stop stop-color="#a8d8f0" stop-opacity=".35"/><stop offset="1" stop-color="#a8d8f0" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="38" cy="91" rx="24" ry="5" fill="rgba(0,0,0,.22)"/>
      <rect x="15" y="29" width="46" height="60" rx="23" fill="url(#pg)"/>
      <rect x="17" y="7" width="42" height="26" rx="15" fill="url(#ph)"/>
      <rect x="22" y="40" width="32" height="19" rx="9" fill="url(#ps)"/>
      <path d="M57 75 Q76 66, 81 44" fill="none" stroke="#4a5568" stroke-width="10" stroke-linecap="round"/>
      <rect x="71" y="38" width="18" height="14" rx="7" fill="#505868"/>
      <ellipse cx="37" cy="50" rx="13" ry="9" fill="url(#pgl)"/>
    </svg>`,
    road: `<svg viewBox="0 0 96 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="rg" x1="4" y1="32" x2="92" y2="32" gradientUnits="userSpaceOnUse">
        <stop stop-color="#2a3444"/><stop offset=".5" stop-color="#3a4658"/><stop offset="1" stop-color="#242c3a"/></linearGradient></defs>
      <path d="M6 46 C26 10 44 54 66 18 C76 6 90 26 90 26" stroke="url(#rg)" stroke-width="20" stroke-linecap="round" fill="none"/>
      <path d="M10 50 C30 30 50 58 70 34" stroke="rgba(200,210,230,.12)" stroke-width="8" stroke-linecap="round" fill="none"/>
    </svg>`,
    lamp: `<svg viewBox="0 0 72 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><radialGradient id="lg" cx="36" cy="20" r="28" gradientUnits="userSpaceOnUse">
        <stop stop-color="#e8c878" stop-opacity=".35"/><stop offset=".45" stop-color="#c8a050" stop-opacity=".18"/><stop offset="1" stop-color="#c8a050" stop-opacity="0"/></radialGradient>
      <linearGradient id="lp" x1="36" y1="34" x2="36" y2="94" gradientUnits="userSpaceOnUse">
        <stop stop-color="#5a6478"/><stop offset="1" stop-color="#3a4254"/></linearGradient></defs>
      <ellipse cx="36" cy="90" rx="16" ry="5" fill="rgba(0,0,0,.2)"/>
      <ellipse cx="36" cy="22" rx="28" ry="24" fill="url(#lg)"/>
      <circle cx="36" cy="20" r="14" fill="#d8c890" fill-opacity=".45"/>
      <rect x="28" y="34" width="16" height="58" rx="8" fill="url(#lp)"/>
    </svg>`,
    car: `<svg viewBox="0 0 96 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="cg" x1="48" y1="6" x2="48" y2="46" gradientUnits="userSpaceOnUse">
        <stop stop-color="#5a6478"/><stop offset="1" stop-color="#3a4254"/></linearGradient></defs>
      <ellipse cx="48" cy="50" rx="38" ry="6" fill="rgba(0,0,0,.18)"/>
      <rect x="6" y="16" width="84" height="32" rx="22" fill="url(#cg)"/>
      <rect x="24" y="6" width="48" height="22" rx="15" fill="rgba(255,255,255,.08)"/>
      <circle cx="22" cy="46" r="13" fill="#404858"/><circle cx="22" cy="46" r="7" fill="#505868"/>
      <circle cx="74" cy="46" r="13" fill="#404858"/><circle cx="74" cy="46" r="7" fill="#505868"/>
    </svg>`,
    horizon: `<svg viewBox="0 0 96 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="hg" x1="4" y1="22" x2="92" y2="22" gradientUnits="userSpaceOnUse">
        <stop stop-color="#c89868" stop-opacity=".22"/><stop offset=".45" stop-color="#a87858" stop-opacity=".35"/><stop offset=".75" stop-color="#886848" stop-opacity=".2"/><stop offset="1" stop-color="#685038" stop-opacity=".12"/></linearGradient>
      <linearGradient id="hg2" x1="48" y1="34" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stop-color="#3a4858" stop-opacity=".45"/><stop offset="1" stop-color="#1a2030" stop-opacity=".55"/></linearGradient></defs>
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
    return `radial-gradient(ellipse 75% 65% at 50% 40%, ${hex}66 0%, ${hex}22 28%, #0c0e12 72%, #08090c 100%)`;
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
    if (label && state === 'ready') label.textContent = 'ready';
    if (hint) {
      if (state === 'loading') hint.textContent = 'hold on…';
      else if (state === 'ready') hint.textContent = 'tap anywhere to return';
      else if (state === 'error') hint.textContent = opts.message || 'tap to return';
      else hint.textContent = 'tap to return';
    }
  }

  function _cancelMoodGenerate() {
    if (_moodGenAbort) {
      _moodGenAbort.abort();
      _moodGenAbort = null;
    }
    _moodGenerating = false;
    _activeMood = null;
    _stopDragBar(false);
    _setGenUI('idle');
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
          filmScene: mood.sceneId,
        }),
      });
      const d = await res.json().catch(() => ({}));

      if (res.status === 401) {
        showToast('Session expired — log in again.', 'error', 4000);
        setTimeout(() => { location.href = '/api/auth/login'; }, 1800);
        return;
      }
      if (res.status === 409 || d.code === 'GENERATION_IN_PROGRESS') {
        _setGenUI('error', { message: 'already generating — tap to return' });
        showToast('Already generating — wait a moment.', 'info', 3500);
        return;
      }
      if (!res.ok || d.error) {
        _setGenUI('error', { message: 'tap to return · try again' });
        showToast(d.error || 'Could not build playlist.', 'error', 5000);
        return;
      }
      if (!Array.isArray(d.tracks) || !d.tracks.length) {
        _setGenUI('error', { message: 'no tracks matched — tap to return' });
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
      _setGenUI('error', { message: 'connection failed — tap to return' });
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
        style="background:linear-gradient(168deg, ${m.cardTint} 0%, rgba(255,255,255,.04) 38%, rgba(6,8,12,.42) 100%)">
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
    if (_moodGenerating) return;
    setEmotionUIState('grid');
  }

  function initPetsChrome() { /* restraint — no custom cursor / card tilt */ }

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
      if (e.target.closest('#petsSpotifyBtn')) return;
      closeEmotionScene();
    });
    $('petsSpotifyBtn')?.addEventListener('click', (e) => e.stopPropagation());
    _wireLogout();
  }

  function _mountGuestHero() {
    const el = $('guestHeroIllust');
    if (!el || el.dataset.mounted) return;
    el.innerHTML = _emotionPreviewHtml('pump');
    el.dataset.mounted = '1';
  }

  window.initEmotionGridUI = initEmotionGridUI;
  window._mountGuestHero = _mountGuestHero;
  window.initPetsChrome = initPetsChrome;
  window.openEmotionScene = openEmotionScene;
  window.closeEmotionScene = closeEmotionScene;
  window.EMOTION_MOODS = EMOTION_MOODS;
})();
