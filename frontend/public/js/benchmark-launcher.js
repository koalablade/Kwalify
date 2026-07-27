if (location.protocol === 'file:') {
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('offline-banner');
    if (b) {
      b.style.display = 'block';
      b.innerHTML = '<strong>Wrong way to open this.</strong> Close this tab. Use <strong>https://kwalify.net/benchmark</strong> (with <strong>start.bat</strong> running).';
    }
  });
}

if (location.port === '5055') {
  location.replace('https://kwalify.net/benchmark');
}

const LAUNCHER_VERSION = '2';
const onMainServer = true;
const API = '/api/benchmark';
    let state = {};
    let serverOk = false;
    let busy = false;
    let pollTimer = null;
    let pollMs = 12000;
    let pollInFlight = false;
    let pingTimer = null;

    function showActivity(msg, isErr = false) {
      const el = document.getElementById('activity');
      if (!el) return;
      el.innerHTML = msg;
      el.className = 'activity' + (isErr ? ' err' : ' ok');
    }

    function schedulePoll(ms) {
      pollMs = ms;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(poll, pollMs);
    }

    function showOfflineBanner(reason) {
      const b = document.getElementById('offline-banner');
      b.style.display = 'block';
      const here = location.href;
      const wrongPage = location.protocol === 'file:' || location.port === '5055';
      b.innerHTML = reason || (
        '<strong>Benchmark API not reachable.</strong><br>' +
        'Run <strong>start.bat</strong>, then open <strong>https://kwalify.net/benchmark</strong>.' +
        (wrongPage ? `<br><span style="color:#fca5a5">You are on: ${here}</span>` : '')
      );
      const pill = document.getElementById('pill-bench-api');
      pill.textContent = 'API down';
      pill.className = 'pill bad';
    }

    function markConnected() {
      serverOk = true;
      document.getElementById('offline-banner').style.display = 'none';
      const pill = document.getElementById('pill-bench-api');
      pill.textContent = 'API up';
      pill.className = 'pill ok';
    }

    async function checkPing() {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch(API + '/ping', { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) throw new Error('ping failed');
        const data = await r.json();
        if (data.launcherVersion && data.launcherVersion !== LAUNCHER_VERSION) {
          showOfflineBanner('<strong>Benchmark API out of date.</strong> Hard-refresh this page (Ctrl+F5) or restart <strong>start.bat</strong>.');
          serverOk = false;
          return false;
        }
        markConnected();
        return true;
      } catch (_) {
        serverOk = false;
        showOfflineBanner();
        return false;
      }
    }

    function toast(msg, isErr) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.borderColor = isErr ? 'var(--bad)' : 'var(--ok)';
      t.style.color = isErr ? 'var(--bad)' : 'var(--ok)';
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, isErr ? 12000 : 6000);
    }

    function fmtRate(r) {
      if (r == null) return '—';
      return Math.round(r * 1000) / 10 + '%';
    }

    function addMsg(text, who = 'bot', isErr = false) {
      const log = document.getElementById('chat-log');
      const d = document.createElement('div');
      d.className = 'msg ' + who + (isErr ? ' err' : '');
      d.innerHTML = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 403) {
      throw new Error(data.error || 'Log in to Kwalify first, or open https://kwalify.net/benchmark from this PC.');
    }
    throw new Error(data.error || data.message || ('HTTP ' + r.status));
  }
  return data;
}

    async function runRequest(request, suite = '') {
      const label = suite || request || 'benchmark';
      if (busy) {
        toast('Already starting a run — wait a moment', true);
        return;
      }
      busy = true;
      showActivity('Sending <strong>' + label + '</strong> to the server…');
      toast('Starting: ' + label);
      document.querySelectorAll('.btn').forEach((b) => b.classList.add('busy'));
      document.getElementById('chat-send').disabled = true;
      try {
        const body = suite ? { suite } : { request };
        const res = await api('/run', { method: 'POST', body: JSON.stringify(body) });
        if (res.ok) {
          const msg = res.message || 'Benchmark started — look for the PowerShell window on your PC.';
          showActivity(msg);
          toast(msg);
          addMsg('Started: **' + (res.preview?.label || label) + '**', 'you');
          if (res.pid) addMsg('Process ID **' + res.pid + '** — window title: **Kwalify Benchmark RUN**', 'bot');
          schedulePoll(2000);
          setTimeout(poll, 800);
          setTimeout(poll, 2500);
        } else {
          const err = res.error || 'Could not start';
          showActivity('Failed: ' + err, true);
          addMsg(err, 'bot', true);
          toast(err, true);
        }
      } catch (e) {
        showActivity('Error: ' + e.message, true);
        addMsg('Error: ' + e.message, 'bot', true);
        toast(e.message, true);
      } finally {
        busy = false;
        document.querySelectorAll('.btn').forEach((b) => b.classList.remove('busy'));
        document.getElementById('chat-send').disabled = false;
      }
    }

    function defaultButtons() {
      return [
        { id: 'go', label: 'Go now', sub: '50 human - ~2h', suite: 'go', primary: true },
        { id: 'smoke', label: 'Quick check', sub: '1 prompt - ~2 min', suite: 'smoke' },
        { id: 'small', label: 'Small', sub: '25 prompts - ~1h', suite: 'small' },
        { id: 'medium', label: 'Medium', sub: '50 prompts - ~2h', suite: 'medium' },
        { id: 'long', label: 'Long', sub: '100 prompts - ~4h', suite: 'long' },
        { id: 'mix50', label: 'Full mix 50', sub: 'genre-lock included', suite: 'mix-medium' },
        { id: 'easy25', label: 'Easy 25', sub: 'sanity check', request: '25 easy yes' },
        { id: 'repeat', label: 'Repeat last', sub: 'same preset - fresh prompts', action: 'repeat' },
        { id: 'package', label: 'Package zip', sub: 'latest to Desktop', suite: 'package' },
        { id: 'status', label: 'Open live', sub: 'progress dashboard', action: 'open-status' },
      ];
    }

    function bindAdvancedButtons() {
      document.querySelectorAll('.advanced .btn[data-suite]').forEach((btn) => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => runRequest('', btn.dataset.suite));
      });
      document.querySelectorAll('.advanced .btn[data-req]').forEach((btn) => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => runRequest(btn.dataset.req));
      });
    }

    function renderButtons(buttons) {
      const list = (buttons && buttons.length) ? buttons : defaultButtons();
      const el = document.getElementById('main-buttons');
      el.innerHTML = list.map((b) => {
        const cls = 'btn' + (b.primary ? ' primary' : '');
        let data = '';
        if (b.action) data = `data-action="${b.action}"`;
        else if (b.suite) data = `data-suite="${b.suite}"`;
        else data = `data-req="${b.request || ''}"`;
        return `<button class="${cls}" ${data}><strong>${b.label}</strong><span>${b.sub || ''}</span></button>`;
      }).join('');
      el.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.dataset.action === 'open-status') {
            window.open('/benchmark-status.html', '_blank');
            return;
          }
          if (btn.dataset.action === 'repeat') {
            runRequest('', 'repeat');
            return;
          }
          if (btn.dataset.suite) {
            runRequest('', btn.dataset.suite);
            return;
          }
          if (btn.dataset.req) runRequest(btn.dataset.req);
        });
      });
      bindAdvancedButtons();
    }

    function renderState(s) {
      state = s;
      markConnected();

      const apiPill = document.getElementById('pill-api');
      apiPill.textContent = s.apiUp ? 'Kwalify up' : 'Kwalify down';
      apiPill.className = 'pill ' + (s.apiUp ? 'ok' : 'bad');

      const live = s.live;
      const runPill = document.getElementById('pill-run');
      const running = s.benchmarkRunning || (live && live.status && live.status !== 'completed');
      runPill.textContent = running ? 'Running…' : 'Idle';
      runPill.className = 'pill ' + (running ? 'run' : '');

      if (running) schedulePoll(2000);
      else if (pollMs < 12000) schedulePoll(12000);

      if (s.lastSpawn && s.lastSpawn.startedAt) {
        const ls = s.lastSpawn;
        const when = new Date(ls.startedAt).toLocaleTimeString();
        if (ls.ok === false && ls.error) {
          showActivity('Last start failed at ' + when + ': ' + ls.error, true);
        } else if (ls.pid) {
          showActivity('Last started at ' + when + ' (PID ' + ls.pid + '). Look for <strong>Kwalify Benchmark RUN</strong> on your PC.');
        }
      } else if (running) {
        showActivity('Benchmark is running. Live progress updates below.');
      } else if (!busy) {
        showActivity('Ready. Click a button or type below. A <strong>PowerShell window</strong> opens on this PC when a run starts.');
      }

      const idle = document.getElementById('live-idle');
      const active = document.getElementById('live-active');
      if (live && live.progress && live.progress.total > 0 && live.status !== 'completed') {
        idle.style.display = 'none';
        active.style.display = 'block';
        const p = live.progress;
        document.getElementById('live-label').textContent = 'Human keep live';
        document.getElementById('live-bar').style.width = (p.percent || 0) + '%';
        document.getElementById('live-progress').textContent = `${p.completed}/${p.total} prompts (${p.percent || 0}%)`;
        const c = live.counts || {};
        document.getElementById('m-save').textContent = c.SAVE ?? 0;
        document.getElementById('m-skip').textContent = c.SKIP ?? 0;
        document.getElementById('m-rate').textContent = fmtRate(live.wouldSaveRateSoFar);
        document.getElementById('live-current').textContent = p.currentId
          ? `Now: ${p.currentId} — ${(p.currentPrompt || '').slice(0, 60)}`
          : (live.etaMinutes ? `~${live.etaMinutes} min left` : '');
      } else if (s.benchmarkRunning) {
        idle.style.display = 'none';
        active.style.display = 'block';
        document.getElementById('live-label').textContent = 'Starting…';
      } else {
        idle.style.display = 'block';
        active.style.display = 'none';
      }

      if (s.stuckWarning) {
        addMsg('⚠ Stuck? ' + s.stuckWarning, 'bot', true);
      }

      const hist = document.getElementById('history-list');
      if (s.history && s.history.length) {
        hist.innerHTML = s.history.map((h) =>
          `<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--line)">
            <span class="save">${fmtRate(h.wouldSaveRate)}</span> SAVE ${h.SAVE ?? '—'} · ${h.label || h.runId}<br>
            <span style="font-size:11px">${new Date(h.finishedAt).toLocaleString()}</span>
          </div>`
        ).join('');
      }

      const saved = s.savedPresets;
      const card = document.getElementById('saved-card');
      const chips = document.getElementById('saved-chips');
      if (saved && Object.keys(saved).length) {
        card.style.display = 'block';
        chips.innerHTML = Object.keys(saved).map((k) =>
          `<button class="chip" data-req="run ${k} yes">${k}</button>`
        ).join('');
        chips.querySelectorAll('.chip').forEach((c) => {
          c.addEventListener('click', () => runRequest(c.dataset.req));
        });
      }

      const logText = (s.logTail && s.logTail.length) ? s.logTail.join('\n') : '—';
      const logEl = document.getElementById('log-tail');
      if (logEl.textContent !== logText) logEl.textContent = logText;
    }

    async function poll() {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(API + '/state', { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (!r.ok) throw new Error('state failed');
        renderState(await r.json());
      } catch (_) {
        await checkPing();
      } finally {
        pollInFlight = false;
      }
    }

    async function sendChat() {
      const input = document.getElementById('chat-input');
      const msg = input.value.trim();
      if (!msg) {
        toast('Type something first — e.g. smoke or 40 human go', true);
        return;
      }
      input.value = '';
      addMsg(msg, 'you');
      showActivity('Processing: <strong>' + msg + '</strong>…');
      document.getElementById('chat-send').disabled = true;
      try {
        const res = await api('/chat', {
          method: 'POST',
          body: JSON.stringify({ message: msg, forceRun: true }),
        });
        if (res.reply) addMsg(res.reply, 'bot', !res.ok);
        if (res.error) {
          showActivity(res.error, true);
          toast(res.error, true);
        }
        if (res.run && res.run.ok) {
          const m = res.run.message || 'Benchmark started';
          showActivity(m);
          toast(m);
          schedulePoll(2000);
          setTimeout(poll, 800);
        } else if (res.suggestRun && !res.run) {
          const go = document.createElement('button');
          go.className = 'chip';
          go.textContent = 'Run: ' + res.suggestRun;
          go.onclick = () => runRequest(res.suggestRun);
          document.getElementById('chat-log').appendChild(go);
        }
      } catch (e) {
        addMsg('Error: ' + e.message, 'bot', true);
        toast(e.message, true);
      } finally {
        document.getElementById('chat-send').disabled = false;
      }
    }

    document.getElementById('chat-send').addEventListener('click', sendChat);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
    });
    document.getElementById('open-reports').addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const res = await api('/open-reports');
        toast(res.message || ('Reports: ' + (res.path || 'reports folder')));
      } catch (err) {
        toast(err.message || 'Could not open reports folder', true);
      }
    });
    document.getElementById('clear-lock').addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const res = await api('/clear-lock', { method: 'POST', body: '{}' });
        toast(res.cleared ? 'Lock cleared' : 'No lock to clear');
        poll();
      } catch (err) { toast(err.message, true); }
    });

    (async () => {
      renderButtons(defaultButtons());
      bindAdvancedButtons();
      showActivity('Connecting…');
      await Promise.all([checkPing(), poll()]);
      showActivity('Ready. Click a button or type below.');
      pingTimer = setInterval(checkPing, 30000);
      schedulePoll(12000);
    })();
