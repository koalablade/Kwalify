/*
 * Stable Kwalify emotion grid renderer.
 * No secondary views, experimental systems, or startup loops.
 */
(function () {
  'use strict';

  const EMOTION_MOODS = [
    { sceneId: 'petrol_station_2am', title: 'Night Refuel', prompt: 'petrol station 2am' },
    { sceneId: 'night_drive', title: 'Motorway Drive', prompt: 'late night driving' },
    { sceneId: 'urban_midnight_walk', title: 'Late London Walk', prompt: 'midnight city walk' },
    { sceneId: 'memory_road', title: 'Old Car Project', prompt: 'nostalgic country road memory' },
    { sceneId: 'summer_afternoon_drift', title: 'End of Summer Drive', prompt: 'summer afternoon drift' },
  ];

  function renderEmotionGrid() {
    const grid = document.getElementById('emotionMoodGrid');
    if (!grid) return;

    grid.innerHTML = EMOTION_MOODS.map((m) => (
      `<button type="button" class="kw-card" data-prompt="${m.prompt}">
        <span class="kw-card-title">${m.title}</span>
      </button>`
    )).join('');

    grid.querySelectorAll('.kw-card').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById('vibeInput');
        if (input) {
          input.value = button.dataset.prompt || '';
          input.focus();
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, { once: false });
    });
  }

  window.EMOTION_MOODS = EMOTION_MOODS;
  window.renderEmotionGrid = renderEmotionGrid;
})();
