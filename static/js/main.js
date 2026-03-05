const timeEl = document.getElementById('timeDisplay');

function updateClock() {
  if (!timeEl) return;
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  timeEl.textContent = `${h}:${m}:${s}`;
}

updateClock();
setInterval(updateClock, 1000);

const menuToggle = document.getElementById('menuToggle');
const sidebar    = document.getElementById('sidebar');
if (menuToggle && sidebar) {
  menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target))
      sidebar.classList.remove('open');
  });
}

const toastContainer = document.getElementById('toastContainer');

function showToast(message, type = 'info', duration = 3500) {
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconSpan = document.createElement('span');
  iconSpan.textContent =
    type === 'success' ? '✓' :
    type === 'error'   ? '⚠' :
    type === 'warning' ? '!' : 'i';

  const messageSpan = document.createElement('span');
  messageSpan.textContent = message; // SAFE

  toast.append(iconSpan, messageSpan);
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

async function apiCall(url, method = 'GET', body = null) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`API Error ${res.status}: ${errorText}`);
    }
    return await res.json();
  } catch (err) {
    console.error('API Call Failed:', err);
    showToast('Network error occurred', 'error');
    throw err;
  }
}

function updateStreamCountBadge(count) {
  const badge = document.getElementById('stream-count');
  if (badge) badge.textContent = count;
}

window._dashboardSummaryPromise = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    window._dashboardSummaryPromise = apiCall('/api/dashboard-summary');
    const data = await window._dashboardSummaryPromise;
    if (data.success) updateStreamCountBadge(data.stream_count);
  } catch (_) {}
});

const MAX_ALERTS  = 100;
const _alertStore = [];
let   _dropOpen   = false;
let   _unreadCount = 0; 

(function () {
  const s = document.createElement('style');
  s.id = '_bellCSS';
  s.textContent = `
    .alert-bell {
      position: relative; cursor: pointer;
      color: var(--text-secondary); transition: color .2s; user-select: none;
    }
    .alert-bell:hover { color: var(--text-primary); }
    .alert-bell svg   { width: 20px; height: 20px; display: block; }

    /* ── badge ── */
    .bell-badge {
      position: absolute; top: -6px; right: -7px;
      background: #e84545; color: #fff;
      font-size: .58rem; font-family: var(--font-mono, monospace);
      min-width: 17px; height: 17px; border-radius: 99px;
      display: flex; align-items: center; justify-content: center;
      padding: 0 4px; border: 2px solid var(--bg-surface, #111318);
      pointer-events: none;
    }
    .bell-badge.hidden { display: none !important; }
    .bell-badge.bump { animation: _bBump .35s cubic-bezier(.36,.07,.19,.97); }
    @keyframes _bBump {
      0%  { transform: scale(1);   }
      40% { transform: scale(1.6); }
      70% { transform: scale(.85); }
      100%{ transform: scale(1);   }
    }

    /* ── bell shake ── */
    .alert-bell.ringing svg { animation: _bRing .7s ease; }
    @keyframes _bRing {
      0%,100%{ transform: rotate(0);    }
      15%    { transform: rotate(18deg);}
      30%    { transform: rotate(-15deg);}
      45%    { transform: rotate(11deg);}
      60%    { transform: rotate(-8deg);}
      78%    { transform: rotate(5deg); }
    }

    /* ── dropdown ── */
    .bell-dropdown {
      position: absolute; top: calc(100% + 14px); right: -8px;
      width: 340px;
      background: var(--bg-elevated, #181c24);
      border: 1px solid var(--border-light, #2a3347);
      border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0,0,0,.6);
      z-index: 9000; overflow: hidden;
      animation: _dIn .2s cubic-bezier(.16,1,.3,1);
    }
    @keyframes _dIn {
      from{ opacity:0; transform:translateY(-8px) scale(.97); }
      to  { opacity:1; transform:translateY(0)    scale(1);   }
    }

    .bell-drop-head {
      display:flex; align-items:center; justify-content:space-between;
      padding: 13px 16px 10px;
      border-bottom: 1px solid var(--border, #1f2535);
    }
    .bell-drop-head h4 {
      font-family: var(--font-display, sans-serif);
      font-size: .82rem; font-weight: 700;
      color: var(--text-primary, #e8ecf4); letter-spacing: .04em; margin:0;
    }
    .bell-drop-head button {
      font-family: var(--font-mono, monospace); font-size: .68rem;
      color: var(--text-muted, #404d68);
      background: none; border: none; cursor: pointer; transition: color .15s;
    }
    .bell-drop-head button:hover { color: var(--text-secondary, #7a8aaa); }

    .bell-drop-scroll { max-height: 340px; overflow-y: auto; }
    .bell-drop-scroll::-webkit-scrollbar { width: 4px; }
    .bell-drop-scroll::-webkit-scrollbar-thumb {
      background: var(--border-light, #2a3347); border-radius: 4px;
    }

    .bell-empty {
      display:flex; flex-direction:column; align-items:center;
      gap: 8px; padding: 36px 20px;
      color: var(--text-muted, #404d68);
      font-family: var(--font-mono, monospace); font-size: .75rem; opacity: .7;
    }
    .bell-empty svg { width: 28px; height: 28px; opacity: .4; }

    .bell-row {
      display:flex; align-items:flex-start; gap: 11px;
      padding: 11px 16px;
      border-bottom: 1px solid var(--border, #1f2535);
      transition: background .15s;
      animation: _rIn .25s ease;
    }
    @keyframes _rIn {
      from{ opacity:0; transform:translateX(6px); }
      to  { opacity:1; transform:translateX(0);   }
    }
    .bell-row:last-child { border-bottom: none; }
    .bell-row:hover      { background: rgba(255,255,255,.025); }
    .bell-row.unread     { background: rgba(232,69,69,.06); }

    .bell-row-icon {
      flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px;
      display:flex; align-items:center; justify-content:center; margin-top: 1px;
    }
    .bell-row-icon.accident {
      background: rgba(232,69,69,.12); border: 1px solid rgba(232,69,69,.35); color: #e84545;
    }
    .bell-row-icon.info {
      background: rgba(34,211,238,.08); border: 1px solid rgba(34,211,238,.25); color: #22d3ee;
    }
    .bell-row-icon svg { width: 15px; height: 15px; }

    .bell-row-body { flex:1; min-width:0; }
    .bell-row-tag {
      font-family: var(--font-mono, monospace); font-size: .66rem;
      letter-spacing: .08em; text-transform: uppercase;
      color: var(--text-muted, #404d68); margin-bottom: 2px;
    }
    .bell-row-tag .tcam  { color: var(--text-secondary, #7a8aaa); }
    .bell-row-tag .twarn { color: #e84545; font-weight: 600; }
    .bell-row-msg {
      font-size: .8rem; color: var(--text-primary, #e8ecf4);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .bell-row-time {
      font-family: var(--font-mono, monospace); font-size: .65rem;
      color: var(--text-muted, #404d68); margin-top: 2px;
    }
    .bell-unread-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #e84545; flex-shrink: 0; margin-top: 9px;
      box-shadow: 0 0 5px #e84545;
    }

    /* ── fullscreen flash ── */
    #_accFlash {
      position: fixed; inset: 0; pointer-events: none; z-index: 9997;
      opacity: 0;
      border: 3px solid rgba(232,69,69,.7);
      background: rgba(232,69,69,.06);
    }
    #_accFlash.go { animation: _flash 1.4s ease forwards; }
    @keyframes _flash {
      0%  { opacity: 1; }
      40% { opacity: .75; }
      100%{ opacity: 0; }
    }

    /* ── big accident toast ── */
    .acc-toast {
      position: fixed; top: 74px; left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex; align-items: center; gap: 16px;
      padding: 15px 22px 15px 16px;
      background: #0d0404;
      border: 1.5px solid rgba(232,69,69,.65);
      border-radius: 14px;
      box-shadow: 0 0 50px rgba(232,69,69,.2), 0 16px 48px rgba(0,0,0,.65);
      min-width: 300px; max-width: 460px;
      animation: _aToastIn .38s cubic-bezier(.16,1,.3,1) forwards;
      pointer-events: none;
    }
    @keyframes _aToastIn {
      from{ opacity:0; transform:translateX(-50%) translateY(-24px) scale(.94); }
      to  { opacity:1; transform:translateX(-50%) translateY(0)      scale(1);  }
    }
    .acc-toast-icon {
      flex-shrink: 0; width: 42px; height: 42px; border-radius: 10px;
      background: rgba(232,69,69,.13); border: 1.5px solid rgba(232,69,69,.4);
      display:flex; align-items:center; justify-content:center; color: #e84545;
      animation: _iPulse 1s ease infinite;
    }
    @keyframes _iPulse {
      0%,100%{ box-shadow: 0 0 0 0   rgba(232,69,69,.45); }
      50%    { box-shadow: 0 0 0 9px rgba(232,69,69,0);   }
    }
    .acc-toast-icon svg { width: 21px; height: 21px; }
    .acc-toast-body { flex:1; min-width:0; }
    .acc-toast-eyebrow {
      font-family: var(--font-mono, monospace); font-size: .66rem;
      letter-spacing: .15em; text-transform: uppercase; color: #e84545; margin-bottom: 3px;
    }
    .acc-toast-cam {
      font-family: var(--font-display, sans-serif); font-weight: 700; font-size: 1rem;
      color: #e8ecf4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .acc-toast-sub {
      font-family: var(--font-mono, monospace); font-size: .66rem;
      color: #555f7a; margin-top: 2px;
    }
  `;
  document.head.appendChild(s);

  function appendFlash() {
    if (document.body) {
      if (!document.getElementById('_accFlash')) {
        const d = document.createElement('div');
        d.id = '_accFlash';
        document.body.appendChild(d);
      }
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('_accFlash')) {
          const d = document.createElement('div');
          d.id = '_accFlash';
          document.body.appendChild(d);
        }
      });
    }
  }
  appendFlash();
})();


document.addEventListener('DOMContentLoaded', () => {
  const bell = document.getElementById('alertBell');
  if (!bell) return;

  bell.addEventListener('click', e => {
    e.stopPropagation();
    const existing = document.getElementById('_bellDrop');
    existing ? _closeDrop() : _openDrop(bell);
  });

  document.addEventListener('click', () => _closeDrop());
});


function _openDrop(bell) {
  _dropOpen = true;
  _markAllRead();

  const drop = document.createElement('div');
  drop.className = 'bell-dropdown';
  drop.id = '_bellDrop';
  drop.addEventListener('click', e => e.stopPropagation());

  const head = document.createElement('div');
  head.className = 'bell-drop-head';
  const h4  = document.createElement('h4');
  h4.textContent = 'Incident Alerts';
  const btn = document.createElement('button');
  btn.textContent = 'Clear all';
  btn.addEventListener('click', _clearBellAlerts);
  head.append(h4, btn);

  const scroll = document.createElement('div');
  scroll.className = 'bell-drop-scroll';
  scroll.id = '_bellList';
  _renderRowsInto(scroll);

  drop.append(head, scroll);
  bell.appendChild(drop);
}

function _closeDrop() {
  _dropOpen = false;
  const d = document.getElementById('_bellDrop');
  if (d) d.remove();
}

function _renderRowsInto(container) {
  container.textContent = ''; 

  if (_alertStore.length === 0) {
    container.innerHTML = `
      <div class="bell-empty">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        No incidents recorded
      </div>`;
    return;
  }

  const accidentIconSVG = `<svg viewBox="0 0 24 24" fill="none">
    <path d="M10.29 3.86L1.82 18A2 2 0 003.54 21H20.46A2 2 0 0022.18 18L13.71 3.86A2 2 0 0010.29 3.86Z"
      stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
  const infoIconSVG = `<svg viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
    <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

  _alertStore.forEach(a => {
    const row = document.createElement('div');
    row.className = `bell-row${a.read ? '' : ' unread'}`;

    const icon = document.createElement('div');
    icon.className = `bell-row-icon ${a.type}`;
    icon.innerHTML = a.type === 'accident' ? accidentIconSVG : infoIconSVG;

    const body = document.createElement('div');
    body.className = 'bell-row-body';

    const tag = document.createElement('div');
    tag.className = 'bell-row-tag';
    if (a.type === 'accident') {
      const warn = document.createElement('span');
      warn.className = 'twarn';
      warn.textContent = '⚠ ACCIDENT';
      tag.appendChild(warn);
    } else {
      tag.appendChild(document.createTextNode('INFO'));
    }
    if (a.label) {
      tag.appendChild(document.createTextNode(' · '));
      const camSpan = document.createElement('span');
      camSpan.className = 'tcam';
      camSpan.textContent = a.label;      
      tag.appendChild(camSpan);
    }

    const msg = document.createElement('div');
    msg.className = 'bell-row-msg';
    msg.textContent = a.message;          

    const time = document.createElement('div');
    time.className = 'bell-row-time';
    time.textContent = a.time;

    body.append(tag, msg, time);
    row.append(icon, body);

    if (!a.read) {
      const dot = document.createElement('div');
      dot.className = 'bell-unread-dot';
      row.appendChild(dot);
    }

    container.appendChild(row);
  });
}

function _markAllRead() {
  _alertStore.forEach(a => a.read = true);
  _unreadCount = 0;
  const badge = document.getElementById('bellBadge');
  if (badge) badge.classList.add('hidden');
}

function _clearBellAlerts() {
  _alertStore.length = 0;
  _unreadCount = 0;
  const list = document.getElementById('_bellList');
  if (list) _renderRowsInto(list);
  const badge = document.getElementById('bellBadge');
  if (badge) badge.classList.add('hidden');
}

function pushBellAlert(message, type, label) {
  type = type || 'info';

  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  _alertStore.unshift({ time, label: label || null, type, message, read: false });

  if (_alertStore.length > MAX_ALERTS) _alertStore.pop();

  _unreadCount++;

  const badge = document.getElementById('bellBadge');
  if (badge) {
    badge.textContent = _unreadCount;
    badge.classList.remove('hidden');
    badge.classList.remove('bump');
    void badge.offsetWidth;
    badge.classList.add('bump');
  }

  const bell = document.getElementById('alertBell');
  if (bell) {
    bell.classList.remove('ringing');
    void bell.offsetWidth;
    bell.classList.add('ringing');
    setTimeout(() => bell.classList.remove('ringing'), 750);
  }

  if (_dropOpen) {
    const list = document.getElementById('_bellList');
    if (list) _renderRowsInto(list);
  }

  if (type === 'accident') {
    _doScreenFlash();
    _doAccToast(label, time);
  }
}


function _doScreenFlash() {
  const el = document.getElementById('_accFlash');
  if (!el) return;
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
  setTimeout(() => el.classList.remove('go'), 1500);
}

function _doAccToast(label, time) {
  document.querySelectorAll('.acc-toast').forEach(t => t.remove());

  const accidentIconSVG = `<svg viewBox="0 0 24 24" fill="none">
    <path d="M10.29 3.86L1.82 18A2 2 0 003.54 21H20.46A2 2 0 0022.18 18L13.71 3.86A2 2 0 0010.29 3.86Z"
      stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

  const t = document.createElement('div');
  t.className = 'acc-toast';

  const iconDiv = document.createElement('div');
  iconDiv.className = 'acc-toast-icon';
  iconDiv.innerHTML = accidentIconSVG; 

  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'acc-toast-body';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'acc-toast-eyebrow';
  eyebrow.textContent = 'Accident Confirmed';

  const cam = document.createElement('div');
  cam.className = 'acc-toast-cam';
  cam.textContent = label || 'Unknown Camera'; 

  const sub = document.createElement('div');
  sub.className = 'acc-toast-sub';
  sub.textContent = time;

  bodyDiv.append(eyebrow, cam, sub);
  t.append(iconDiv, bodyDiv);
  document.body.appendChild(t);

  setTimeout(() => {
    t.style.transition = 'opacity .45s ease, transform .45s ease';
    t.style.opacity    = '0';
    t.style.transform  = 'translateX(-50%) translateY(-12px)';
    setTimeout(() => t.remove(), 460);
  }, 5000);
}