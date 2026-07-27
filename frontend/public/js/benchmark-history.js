    const paths = [
      '/api/benchmark/data/history',
      '/reports/benchmark-history.json',
      '../../reports/benchmark-history.json',
      '../reports/benchmark-history.json',
    ];

    function fmtWhen(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleString();
    }

    function fmtRate(r) {
      if (r == null) return '—';
      return Math.round(r * 1000) / 10 + '%';
    }

    function esc(s) {
      if (s == null) return '';
      const d = document.createElement('div');
      d.textContent = String(s);
      return d.innerHTML;
    }

    function render(rows) {
      const tbody = document.getElementById('history-body');
      const cards = document.getElementById('history-cards');
      if (!rows || !rows.length) {
        tbody.innerHTML = '<tr><td colspan="7">No runs yet. Complete a benchmark to populate history.</td></tr>';
        if (cards) cards.innerHTML = '<p class="sub">No runs yet.</p>';
        return;
      }
      tbody.innerHTML = rows.map((r, i) => {
        const statusCls = r.exitCode === 0 ? 'ok' : 'bad';
        const delta = i < rows.length - 1 && r.wouldSaveRate != null && rows[i + 1].wouldSaveRate != null
          ? Math.round((r.wouldSaveRate - rows[i + 1].wouldSaveRate) * 1000) / 10
          : null;
        const deltaTxt = delta != null ? ' (' + (delta >= 0 ? '+' : '') + delta + '% vs prev)' : '';
        return '<tr>' +
          '<td>' + esc(fmtWhen(r.finishedAt)) + '</td>' +
          '<td><code>' + esc(r.runId || '') + '</code><br><span style="color:var(--muted);font-size:12px">' + esc(r.label || '') + '</span></td>' +
          '<td class="' + statusCls + '">' + esc(r.status || '') + '</td>' +
          '<td class="ok">' + fmtRate(r.wouldSaveRate) + deltaTxt + '</td>' +
          '<td>' + (r.SAVE ?? '—') + '</td>' +
          '<td>' + (r.SKIP ?? '—') + '</td>' +
          '<td>' + (r.promptCount ?? '—') + '</td>' +
          '</tr>';
      }).join('');
      if (cards) {
        cards.innerHTML = rows.map((r, i) => {
          const statusCls = r.exitCode === 0 ? 'ok' : 'bad';
          const delta = i < rows.length - 1 && r.wouldSaveRate != null && rows[i + 1].wouldSaveRate != null
            ? Math.round((r.wouldSaveRate - rows[i + 1].wouldSaveRate) * 1000) / 10
            : null;
          const deltaTxt = delta != null ? ' (' + (delta >= 0 ? '+' : '') + delta + '% vs prev)' : '';
          return '<article class="history-card">' +
            '<h3>' + esc(r.label || r.runId || 'Run') + '</h3>' +
            '<div class="meta">' + esc(fmtWhen(r.finishedAt)) + ' · <span class="' + statusCls + '">' + esc(r.status || '') + '</span></div>' +
            '<div><strong class="ok">' + fmtRate(r.wouldSaveRate) + '</strong> SAVE rate' + esc(deltaTxt) + '</div>' +
            '<div>SAVE ' + esc(r.SAVE ?? '—') + ' · SKIP ' + esc(r.SKIP ?? '—') + ' · ' + esc(r.promptCount ?? '—') + ' prompts</div>' +
            '</article>';
        }).join('');
      }
    }

    async function load() {
      for (const p of paths) {
        try {
          const r = await fetch(p + '?t=' + Date.now());
          if (r.ok) {
            const data = await r.json();
            render(Array.isArray(data) ? data : [data]);
            return;
          }
        } catch (_) {}
      }
      document.getElementById('history-body').innerHTML =
        '<tr><td colspan="7">Could not load benchmark-history.json. Run a benchmark first.</td></tr>';
    }

    load();
    setInterval(load, 30000);
