/**
 * Kwalify Pets UI — Spotify Pet Playlists-inspired interactions.
 * Requires globals: $, esc, showToast, api (from index.html).
 */
(function () {
  'use strict';

  const SPOTIFY_PETS_BLUE = '#2779a7';

  const EMOTION_MOODS = [
    { sceneId: 'petrol_station_2am', title: 'Night Refuel', illust: 'pump', bg: '#2779a7', vibe: 'petrol station 2am empty forecourt', cardTint: 'rgba(39,121,167,.45)' },
    { sceneId: 'night_drive', title: 'Motorway Drive', illust: 'road', bg: '#2e6f9a', vibe: 'night drive motorway alone', cardTint: 'rgba(46,111,154,.42)' },
    { sceneId: 'urban_midnight_walk', title: 'Late London Walk', illust: 'lamp', bg: '#245f88', vibe: 'midnight city walk london alone', cardTint: 'rgba(36,95,136,.42)' },
    { sceneId: 'memory_road', title: 'Old Car Project', illust: 'car', bg: '#2a759f', vibe: 'nostalgic country road memory', cardTint: 'rgba(42,117,159,.42)' },
    { sceneId: 'summer_afternoon_drift', title: 'End of Summer Drive', illust: 'horizon', bg: '#3a8fbf', vibe: 'summer afternoon drift warm haze', cardTint: 'rgba(58,143,191,.38)' },
  ];

  const PETS_ILLUST_DEFS = {
    pump: `<svg viewBox="0 0 80 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="pg" x1="40" y1="28" x2="40" y2="86" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F8FAFF"/><stop offset="1" stop-color="#A8BCD4"/></linearGradient>
      <linearGradient id="ph" x1="40" y1="12" x2="40" y2="34" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F2F6FE"/><stop offset="1" stop-color="#C0D0E8"/></linearGradient>
      <linearGradient id="ps" x1="40" y1="38" x2="40" y2="56" gradientUnits="userSpaceOnUse">
        <stop stop-color="#B8E4FC"/><stop offset="1" stop-color="#78B8E0" stop-opacity=".6"/></linearGradient>
      <radialGradient id="pgl" cx="40" cy="48" r="16" gradientUnits="userSpaceOnUse">
        <stop stop-color="#88D0F8" stop-opacity=".38"/><stop offset="1" stop-color="#88D0F8" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="40" cy="90" rx="26" ry="6" fill="rgba(15,40,60,.14)"/>
      <rect x="14" y="28" width="52" height="62" rx="26" fill="url(#pg)"/>
      <rect x="17" y="6" width="46" height="28" rx="18" fill="url(#ph)"/>
      <rect x="22" y="38" width="36" height="22" rx="12" fill="url(#ps)"/>
      <path d="M60 76 Q78 68, 82 46" fill="none" stroke="#98AAC4" stroke-width="11" stroke-linecap="round"/>
      <rect x="72" y="40" width="20" height="16" rx="10" fill="#88A0BC"/>
      <ellipse cx="40" cy="49" rx="16" ry="12" fill="url(#pgl)"/>
    </svg>`,
    road: `<svg viewBox="0 0 96 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="rg" x1="4" y1="32" x2="92" y2="32" gradientUnits="userSpaceOnUse">
        <stop stop-color="#7ec8f0"/><stop offset=".45" stop-color="#e8f4fc"/><stop offset="1" stop-color="#6ab0e0"/></linearGradient></defs>
      <path d="M6 46 C26 10 44 54 66 18 C76 6 90 26 90 26" stroke="url(#rg)" stroke-width="20" stroke-linecap="round" fill="none"/>
      <path d="M10 50 C30 30 50 58 70 34" stroke="rgba(255,255,255,.32)" stroke-width="9" stroke-linecap="round" fill="none"/>
    </svg>`,
    lamp: `<svg viewBox="0 0 72 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><radialGradient id="lg" cx="36" cy="20" r="30" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFFCE8"/><stop offset=".4" stop-color="#F8E090"/><stop offset="1" stop-color="#E8B050" stop-opacity="0"/></radialGradient>
      <linearGradient id="lp" x1="36" y1="34" x2="36" y2="94" gradientUnits="userSpaceOnUse">
        <stop stop-color="#E4ECFA"/><stop offset="1" stop-color="#98A8C0"/></linearGradient></defs>
      <ellipse cx="36" cy="90" rx="16" ry="5" fill="rgba(15,40,60,.12)"/>
      <ellipse cx="36" cy="22" rx="32" ry="28" fill="url(#lg)"/>
      <circle cx="36" cy="20" r="18" fill="#FFFCF0"/>
      <rect x="26" y="34" width="20" height="58" rx="10" fill="url(#lp)"/>
    </svg>`,
    car: `<svg viewBox="0 0 96 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="cg" x1="48" y1="6" x2="48" y2="46" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F4F8FF"/><stop offset="1" stop-color="#A0B4CC"/></linearGradient></defs>
      <ellipse cx="48" cy="50" rx="38" ry="6" fill="rgba(15,40,60,.12)"/>
      <rect x="6" y="16" width="84" height="32" rx="22" fill="url(#cg)"/>
      <rect x="24" y="6" width="48" height="22" rx="15" fill="rgba(255,255,255,.5)"/>
      <circle cx="22" cy="46" r="13" fill="#90A4BC"/><circle cx="22" cy="46" r="7" fill="#E8F0FA"/>
      <circle cx="74" cy="46" r="13" fill="#90A4BC"/><circle cx="74" cy="46" r="7" fill="#E8F0FA"/>
    </svg>`,
    horizon: `<svg viewBox="0 0 96 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="hg" x1="4" y1="22" x2="92" y2="22" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFE8C0" stop-opacity=".25"/><stop offset=".4" stop-color="#F0C880"/><stop offset=".65" stop-color="#E8A868"/><stop offset="1" stop-color="#F8D8B0" stop-opacity=".18"/></linearGradient>
      <linearGradient id="hg2" x1="48" y1="34" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stop-color="#A8C8E8" stop-opacity=".55"/><stop offset="1" stop-color="#5880A8" stop-opacity=".15"/></linearGradient></defs>
      <ellipse cx="48" cy="22" rx="46" ry="15" fill="url(#hg)"/>
      <ellipse cx="48" cy="40" rx="50" ry="11" fill="url(#hg2)"/>
    </svg>`,
  };

  let _emotionGridWired = false;
  let _moodGenAbort = null;
  let _moodGenerating = false;
  let _activeMood = null;
  let _cursorBound = false;
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
    return `radial-gradient(ellipse 85% 75% at 50% 36%, ${hex} 0%, ${hex}99 22%, #1a5080 55%, #0f2840 100%)`;
  }

  function _emotionPreviewHtml(illust) { return _petsIllustHtml(illust, 'preview'); }
  function _emotionHeroHtml(illust) { return _petsIllustHtml(illust, 'hero'); }

  function _startDragBar() {
    _stopDragBar();
    const bar = $('petsDragBar');
    const fill = $('petsDragFill');
    const knob = $('petsDragKnob');
    const label = $('petsDragLabel');
    if (!bar || !fill || !knob) return;
    bar.hidden = false;
    if (label) label.textContent = 'mixing your playlist';
    _dragProgress = 0.08;
    const tick = () => {
      if (!_moodGenerating) return;
      _dragProgress += (0.92 - _dragProgress) * 0.018 + 0.002;
      if (_dragProgress > 0.88) _dragProgress = 0.88 + Math.sin(Date.now() / 400) * 0.04;
      const pct = Math.max(8, Math.min(92, _dragProgress * 100));
      fill.style.width = `${pct}%`;
      knob.style.left = `${pct}%`;
      _dragAnim = requestAnimationFrame(tick);
    };
    _dragAnim = requestAnimationFrame(tick);
  }

  function _stopDragBar(finish) {
    if (_dragAnim) cancelAnimationFrame(_dragAnim);
    _dragAnim = null;
    const bar = $('petsDragBar');
    const fill = $('petsDragFill');
    const knob = $('petsDragKnob');
    if (finish && fill && knob) {
      fill.style.width = '100%';
      knob.style.left = '100%';
    }
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
        style="background:linear-gradient(168deg, ${m.cardTint} 0%, rgba(255,255,255,.08) 40%, rgba(8,24,40,.4) 100%)">
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
      if (bg) bg.style.background = _emotionSceneBg(mood.bg || SPOTIFY_PETS_BLUE);
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

  function _bindCursor() {
    if (_cursorBound || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const root = $('petsCursor');
    const ring = $('petsCursorRing');
    const dot = $('petsCursorDot');
    if (!root || !ring || !dot) return;
    _cursorBound = true;

    let mx = 0; let my = 0;
    let rx = 0; let ry = 0;
    let dx = 0; let dy = 0;

    const lerp = (a, b, t) => a + (b - a) * t;

    document.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      dx = mx;
      dy = my;
    });

    const hoverSel = '.pets-card, .pets-connect-btn, .pets-spotify-btn, .pets-logout, .pets-spotify-btn';
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest(hoverSel)) ring.classList.add('is-hover');
      else ring.classList.remove('is-hover');
    });

    const frame = () => {
      rx = lerp(rx, mx, 0.18);
      ry = lerp(ry, my, 0.18);
      root.style.transform = `translate(${rx}px, ${ry}px)`;
      dot.style.transform = `translate(${dx - rx}px, ${dy - ry}px)`;

      const hero = document.querySelector('.pets-illust--hero.pets-hero-in');
      if (hero && document.body.classList.contains('pets-scene-active')) {
        const r = hero.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const nx = (mx - cx) / (r.width * 0.55);
        const ny = (my - cy) / (r.height * 0.55);
        const clamp = (v) => Math.max(-1, Math.min(1, v));
        const lx = clamp(nx) * 14;
        const ly = clamp(ny) * 10;
        const rot = clamp(nx) * 5;
        hero.style.setProperty('--look-x', `${lx}px`);
        hero.style.setProperty('--look-y', `${ly}px`);
        hero.style.setProperty('--look-r', `${rot}deg`);
        const inner = hero.querySelector('.pets-illust-inner');
        if (inner) {
          inner.style.transform = `rotateY(${clamp(nx) * 8}deg) rotateX(${clamp(-ny) * 6}deg)`;
        }
      }

      document.querySelectorAll('.pets-card').forEach((card) => {
        if (!document.body.classList.contains('pets-home-active')) return;
        const r = card.getBoundingClientRect();
        const nx = (mx - (r.left + r.width / 2)) / (r.width / 2);
        const ny = (my - (r.top + r.height / 2)) / (r.height / 2);
        const clamp = (v) => Math.max(-0.35, Math.min(0.35, v));
        card.style.setProperty('--tilt-x', `${clamp(-ny) * 8}deg`);
        card.style.setProperty('--tilt-y', `${clamp(nx) * 10}deg`);
      });

      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
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

  function initPetsChrome() {
    _bindCursor();
  }

  function initEmotionGridUI() {
    initPetsChrome();
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
    initPetsChrome();
    const el = $('guestHeroIllust');
    if (!el || el.dataset.mounted) return;
    el.innerHTML = _emotionPreviewHtml('horizon');
    el.dataset.mounted = '1';
  }

  window.initEmotionGridUI = initEmotionGridUI;
  window._mountGuestHero = _mountGuestHero;
  window.initPetsChrome = initPetsChrome;
  window.openEmotionScene = openEmotionScene;
  window.closeEmotionScene = closeEmotionScene;
  window.EMOTION_MOODS = EMOTION_MOODS;
})();
