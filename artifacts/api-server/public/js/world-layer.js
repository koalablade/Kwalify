/**
 * Kwalify World Layer — Page 2 cursor micro-world.
 * Spec: docs/KWALIFY_WORLD_LAYER_SPEC.md
 * Requires: $, EMOTION_MOODS, KW_illustPreview (from pets-ui.js)
 */
(function () {
  'use strict';

  const WORLD_LAYOUT = [
    { sceneId: 'petrol_station_2am', x: 26, y: 48, scale: 1.05 },
    { sceneId: 'night_drive', x: 58, y: 62, scale: 1.15 },
    { sceneId: 'urban_midnight_walk', x: 76, y: 30, scale: 0.95 },
    { sceneId: 'memory_road', x: 16, y: 68, scale: 1.08 },
    { sceneId: 'summer_afternoon_drift', x: 50, y: 22, scale: 1.2 },
  ];

  const NEAR_PX = 150;
  const FOCUS_PX = 72;

  let _wired = false;
  let _mounted = false;
  let _mx = 0;
  let _my = 0;
  let _raf = null;

  function _moods() {
    return window.EMOTION_MOODS || [];
  }

  function _illust(illust) {
    if (typeof window.KW_illustPreview === 'function') return window.KW_illustPreview(illust);
    return '';
  }

  function _mountField() {
    const field = $('emotionWorldField');
    if (!field || _mounted) return;
    const moods = _moods();
    field.innerHTML = WORLD_LAYOUT.map((slot) => {
      const mood = moods.find((m) => m.sceneId === slot.sceneId);
      if (!mood) return '';
      return `<div class="pets-world-object" data-illust="${mood.illust}" data-scene="${mood.sceneId}"
        style="left:${slot.x}%;top:${slot.y}%;--world-scale:${slot.scale}">
        <span class="pets-world-object-inner">${_illust(mood.illust)}</span>
        <span class="pets-world-object-glow" aria-hidden="true"></span>
      </div>`;
    }).join('');
    _mounted = true;
  }

  function _setWorldActive(on) {
    document.body.classList.toggle('pets-world-active', on);
    document.body.classList.toggle('pets-home-active', !on && !document.body.classList.contains('pets-scene-active'));
    const world = $('emotionWorld');
    if (world) world.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) {
      _mountField();
      _startLoop();
    } else {
      _stopLoop();
    }
  }

  function openEmotionWorld() {
    if (typeof window.closeEmotionScene === 'function') window.closeEmotionScene();
    document.body.classList.remove('pets-scene-active');
    _setWorldActive(true);
  }

  function closeEmotionWorld() {
    _setWorldActive(false);
    if (!document.body.classList.contains('pets-scene-active')) {
      document.body.classList.add('pets-home-active');
    }
  }

  function _stopLoop() {
    if (_raf) cancelAnimationFrame(_raf);
    _raf = null;
  }

  function _startLoop() {
    _stopLoop();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tick = () => {
      if (!document.body.classList.contains('pets-world-active')) return;
      const field = $('emotionWorldField');
      if (!field) return;
      field.querySelectorAll('.pets-world-object').forEach((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(_mx - cx, _my - cy);
        el.classList.remove('is-near', 'is-focus');
        let state = 'idle';
        if (d < FOCUS_PX) { el.classList.add('is-focus'); state = 'focus'; }
        else if (d < NEAR_PX) { el.classList.add('is-near'); state = 'near'; }

        if (state !== 'idle') {
          const nx = (_mx - cx) / (r.width * 0.55);
          const ny = (_my - cy) / (r.height * 0.55);
          const c = (v) => Math.max(-1, Math.min(1, v));
          const pull = state === 'focus' ? 1 : 0.55;
          el.style.setProperty('--wx', `${c(nx) * 10 * pull}px`);
          el.style.setProperty('--wy', `${c(ny) * 7 * pull}px`);
          el.style.setProperty('--wr', `${c(nx) * 5 * pull}deg`);
        } else {
          el.style.setProperty('--wx', '0px');
          el.style.setProperty('--wy', '0px');
          el.style.setProperty('--wr', '0deg');
        }
      });
      _raf = requestAnimationFrame(tick);
    };
    _raf = requestAnimationFrame(tick);
  }

  function initWorldLayer() {
    if (_wired) return;
    _wired = true;

    document.addEventListener('mousemove', (e) => {
      _mx = e.clientX;
      _my = e.clientY;
    }, { passive: true });

    $('petsWorldEnter')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEmotionWorld();
    });

    $('emotionWorld')?.addEventListener('click', () => closeEmotionWorld());
  }

  window.initWorldLayer = initWorldLayer;
  window.openEmotionWorld = openEmotionWorld;
  window.closeEmotionWorld = closeEmotionWorld;
})();
