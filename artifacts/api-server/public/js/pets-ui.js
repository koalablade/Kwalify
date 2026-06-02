/**
 * Kwalify Pets UI — grid, emotion scene, mood → playlist.
 * Requires globals: $, esc, showToast, api (from index.html).
 */
(function () {
  'use strict';

  const EMOTION_MOODS = [
    { sceneId: 'petrol_station_2am', title: 'Night Refuel', illust: 'pump', bg: '#1c2438', vibe: 'petrol station 2am empty forecourt', cardTint: 'rgba(28,36,56,.55)' },
    { sceneId: 'night_drive', title: 'Motorway Drive', illust: 'road', bg: '#182030', vibe: 'night drive motorway alone', cardTint: 'rgba(24,32,48,.55)' },
    { sceneId: 'urban_midnight_walk', title: 'Late London Walk', illust: 'lamp', bg: '#161c2a', vibe: 'midnight city walk london alone', cardTint: 'rgba(22,28,42,.55)' },
    { sceneId: 'memory_road', title: 'Old Car Project', illust: 'car', bg: '#1a2234', vibe: 'nostalgic country road memory', cardTint: 'rgba(26,34,52,.55)' },
    { sceneId: 'summer_afternoon_drift', title: 'End of Summer Drive', illust: 'horizon', bg: '#242838', vibe: 'summer afternoon drift warm haze', cardTint: 'rgba(36,40,56,.55)' },
  ];

  const PETS_ILLUST_DEFS = {
    pump: `<svg viewBox="0 0 80 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="pg" x1="40" y1="28" x2="40" y2="86" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F6F8FE"/><stop offset="1" stop-color="#B0BECC"/></linearGradient>
      <linearGradient id="ph" x1="40" y1="12" x2="40" y2="34" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F0F4FC"/><stop offset="1" stop-color="#C8D4E8"/></linearGradient>
      <linearGradient id="ps" x1="40" y1="38" x2="40" y2="56" gradientUnits="userSpaceOnUse">
        <stop stop-color="#C4E8FC"/><stop offset="1" stop-color="#90C0E8" stop-opacity=".55"/></linearGradient>
      <radialGradient id="pgl" cx="40" cy="47" r="15" gradientUnits="userSpaceOnUse">
        <stop stop-color="#B0E0FC" stop-opacity=".32"/><stop offset="1" stop-color="#B0E0FC" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="40" cy="90" rx="24" ry="6" fill="rgba(0,0,0,.1)"/>
      <rect x="16" y="28" width="48" height="60" rx="24" fill="url(#pg)"/>
      <rect x="19" y="8" width="42" height="26" rx="16" fill="url(#ph)"/>
      <rect x="24" y="38" width="32" height="20" rx="11" fill="url(#ps)"/>
      <path d="M58 74 Q74 66, 78 48" fill="none" stroke="#A8B8D0" stroke-width="10" stroke-linecap="round"/>
      <rect x="68" y="42" width="18" height="14" rx="9" fill="#98A8C4"/>
      <ellipse cx="40" cy="48" rx="15" ry="11" fill="url(#pgl)"/>
    </svg>`,
    road: `<svg viewBox="0 0 96 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="rg" x1="4" y1="32" x2="92" y2="32" gradientUnits="userSpaceOnUse">
        <stop stop-color="#98C8F0"/><stop offset=".45" stop-color="#DCEAF8"/><stop offset="1" stop-color="#88B8E8"/></linearGradient></defs>
      <path d="M6 46 C26 10 44 54 66 18 C76 6 90 26 90 26" stroke="url(#rg)" stroke-width="18" stroke-linecap="round" fill="none"/>
      <path d="M10 50 C30 30 50 58 70 34" stroke="rgba(255,255,255,.28)" stroke-width="8" stroke-linecap="round" fill="none"/>
    </svg>`,
    lamp: `<svg viewBox="0 0 72 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><radialGradient id="lg" cx="36" cy="20" r="28" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFF8E8"/><stop offset=".45" stop-color="#F4D890"/><stop offset="1" stop-color="#E8B060" stop-opacity="0"/></radialGradient>
      <linearGradient id="lp" x1="36" y1="34" x2="36" y2="94" gradientUnits="userSpaceOnUse">
        <stop stop-color="#DCE4F4"/><stop offset="1" stop-color="#A8B4C8"/></linearGradient></defs>
      <ellipse cx="36" cy="90" rx="14" ry="4" fill="rgba(0,0,0,.1)"/>
      <ellipse cx="36" cy="22" rx="30" ry="26" fill="url(#lg)"/>
      <circle cx="36" cy="20" r="17" fill="#FFFCF4"/>
      <rect x="27" y="34" width="18" height="56" rx="9" fill="url(#lp)"/>
    </svg>`,
    car: `<svg viewBox="0 0 96 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="cg" x1="48" y1="6" x2="48" y2="46" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F0F4FC"/><stop offset="1" stop-color="#B0BCD4"/></linearGradient></defs>
      <ellipse cx="48" cy="50" rx="36" ry="5" fill="rgba(0,0,0,.1)"/>
      <rect x="8" y="16" width="80" height="30" rx="20" fill="url(#cg)"/>
      <rect x="26" y="8" width="44" height="20" rx="14" fill="rgba(255,255,255,.45)"/>
      <circle cx="24" cy="46" r="12" fill="#98A8C0"/><circle cx="24" cy="46" r="6" fill="#E4ECF8"/>
      <circle cx="72" cy="46" r="12" fill="#98A8C0"/><circle cx="72" cy="46" r="6" fill="#E4ECF8"/>
    </svg>`,
    horizon: `<svg viewBox="0 0 96 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="hg" x1="4" y1="22" x2="92" y2="22" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FCE0B8" stop-opacity=".2"/><stop offset=".35" stop-color="#F0C080"/><stop offset=".65" stop-color="#E8A868"/><stop offset="1" stop-color="#F8D8B0" stop-opacity=".15"/></linearGradient>
      <linearGradient id="hg2" x1="48" y1="34" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stop-color="#C0D0F0" stop-opacity=".5"/><stop offset="1" stop-color="#8090B0" stop-opacity=".12"/></linearGradient></defs>
      <ellipse cx="48" cy="22" rx="44" ry="14" fill="url(#hg)"/>
      <ellipse cx="48" cy="40" rx="48" ry="10" fill="url(#hg2)"/>
    </svg>`,
  };

  let _emotionGridWired = false;
  let _moodGenAbort = null;
  let _moodGenerating = false;
  let _activeMood = null;
  let _parallaxBound = false;

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
    return `<span class="${cls}">${svg}</span>`;
  }

  function _emotionSceneBg(hex) {
    return `radial-gradient(ellipse 80% 70% at 50% 38%, ${hex}88 0%, ${hex}44 28%, #141824 58%, #0a0c12 100%)`;
  }

  function _emotionPreviewHtml(illust) { return _petsIllustHtml(illust, 'preview'); }
  function _emotionHeroHtml(illust) { return _petsIllustHtml(illust, 'hero'); }

  function _setGenUI(state, opts = {}) {
    const pulse = $('petsGenPulse');
    const btn = $('petsSpotifyBtn');
    const hint = $('petsSceneHint');
    if (pulse) {
      pulse.hidden = state !== 'loading';
      pulse.setAttribute('aria-hidden', state !== 'loading' ? 'true' : 'false');
    }
    if (btn) {
      const show = state === 'ready' && opts.spotifyUrl;
      btn.hidden = !show;
      if (show) {
        btn.href = opts.spotifyUrl;
        btn.textContent = opts.trackCount ? `Open in Spotify · ${opts.trackCount} tracks` : 'Open in Spotify';
      }
    }
    if (hint) {
      if (state === 'loading') hint.textContent = 'building your playlist…';
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
        showToast(`Saved — ${count} tracks (open from gallery)`, 'info', 4000);
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
        style="background:linear-gradient(168deg, ${m.cardTint} 0%, rgba(255,255,255,.05) 38%, rgba(10,14,22,.45) 100%)">
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
      openEmotionScene._genT = setTimeout(() => generateFromMood(mood), 680);
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

  function _bindParallax() {
    if (_parallaxBound || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const scene = $('emotionScene');
    const heroWrap = $('emotionSceneObject');
    if (!scene || !heroWrap) return;
    _parallaxBound = true;
    scene.addEventListener('mousemove', (e) => {
      if (!document.body.classList.contains('pets-scene-active')) return;
      const r = scene.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      heroWrap.style.transform = `translate(${nx * 10}px, ${ny * 8 - 4}%)`;
    });
    scene.addEventListener('mouseleave', () => {
      heroWrap.style.transform = 'translateY(-4%)';
    });
  }

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
    _bindParallax();
    _wireLogout();
  }

  function _mountGuestHero() {
    const el = $('guestHeroIllust');
    if (!el || el.dataset.mounted) return;
    el.innerHTML = _emotionPreviewHtml('horizon');
    el.dataset.mounted = '1';
  }

  window.initEmotionGridUI = initEmotionGridUI;
  window._mountGuestHero = _mountGuestHero;
  window.openEmotionScene = openEmotionScene;
  window.closeEmotionScene = closeEmotionScene;
  window.EMOTION_MOODS = EMOTION_MOODS;
})();
