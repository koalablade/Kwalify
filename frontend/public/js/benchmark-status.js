    const fallbackPaths = [
      '/reports/benchmark-live.json',
      '../../reports/benchmark-live.json',
      '../reports/benchmark-live.json',
    ];
    let pollBusy = false;
    let pollMs = 10000;

    function schedulePoll(ms) {
      pollMs = ms;
      clearInterval(pollTimer);
      pollTimer = setInterval(poll, pollMs);
    }
    let pollTimer = null;

    async function poll() {
      if (pollBusy) return;
      pollBusy = true;
      try {
        const r = await fetch('/api/benchmark/data/live', { cache: 'no-store' });
        if (r.ok) {
          const data = await r.json();
          render(data);
          if (data.status && data.status !== 'completed') schedulePoll(5000);
          else schedulePoll(10000);
          return;
        }
        for (const p of fallbackPaths) {
          try {
            const fr = await fetch(p + '?t=' + Date.now(), { cache: 'no-store' });
            if (fr.ok) {
              render(await fr.json());
              return;
            }
          } catch (_) {}
        }
      } finally {
        pollBusy = false;
      }
    }

    poll();
    schedulePoll(10000);

    function pct(n) { return n != null ? Math.round(n * 1000) / 10 + '%' : '—'; }
    function fmtTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleTimeString();
    }

    function render(data) {
      const prog = data.progress || {};
      const counts = data.counts || {};
      const pctDone = prog.percent ?? (prog.total ? (100 * prog.completed / prog.total) : 0);

      const pill = document.getElementById('status-pill');
      pill.textContent = data.status || 'unknown';
      pill.className = 'pill ' + (data.status === 'completed' ? 'done' : 'running');

      document.getElementById('run-id').textContent = data.runId || '—';
      document.getElementById('updated').textContent = 'Updated ' + fmtTime(data.updatedAt);
      document.getElementById('progress-bar').style.width = pctDone + '%';
      document.getElementById('progress-text').textContent =
        (prog.completed ?? 0) + ' / ' + (prog.total ?? '?') + ' prompts (' + pctDone + '%)';

      const cur = prog.currentId
        ? (prog.currentId + ' — ' + (prog.currentPrompt || '').slice(0, 80))
        : (data.status === 'completed' ? 'Run complete' : '—');
      document.getElementById('current-prompt').textContent = cur;

      const eta = data.etaMinutes;
      document.getElementById('eta').textContent = eta
        ? '~' + eta + ' min remaining (avg ' + (data.avgMs || '?') + ' ms/prompt)'
        : '';

      document.getElementById('m-save').textContent = counts.SAVE ?? 0;
      document.getElementById('m-skip').textContent = counts.SKIP ?? 0;
      document.getElementById('m-partial').textContent = counts.PARTIAL_OK ?? 0;
      document.getElementById('m-rate').textContent = pct(data.wouldSaveRateSoFar);
      document.getElementById('m-under').textContent = data.underfilledCount ?? 0;
      document.getElementById('m-ms').textContent = data.avgMs ?? '—';

      const recent = data.recentPrompts || [];
      const tbody = document.getElementById('recent-body');
      if (!recent.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="sub">No results yet</td></tr>';
      } else {
        tbody.innerHTML = recent.slice().reverse().map((r) =>
          '<tr><td>' + r.id + '</td><td>' + (r.prompt || '') + '</td>' +
          '<td class="verdict-' + r.verdict + '">' + r.verdict + '</td>' +
          '<td>' + r.tracks + '/' + r.asked + (r.underfilled ? ' ⚠' : '') + '</td>' +
          '<td>' + (r.ms ? (r.ms / 1000).toFixed(1) + 's' : '—') + '</td></tr>'
        ).join('');
      }

      if (data.updatedAt) {
        const ageMin = (Date.now() - new Date(data.updatedAt).getTime()) / 60000;
        document.getElementById('stale-warn').style.display =
          data.status !== 'completed' && ageMin > 2 ? 'block' : 'none';
      }
    }
