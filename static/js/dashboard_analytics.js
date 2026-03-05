(function () {
  'use strict';

let _modelsPromise = null;

async function _fetchModels() {
  if (!window._modelsPromise) {
    window._modelsPromise = fetch('/api/models').then(r => r.json());
    setTimeout(() => { window._modelsPromise = null; }, 5000);
  }
  return window._modelsPromise;
}
  const style = document.createElement('style');
  style.textContent = `
/* ══════════════════════════════════════════════════════════════
   ACTIVE MODELS BANNER
══════════════════════════════════════════════════════════════ */
.active-models-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  background: rgba(34,197,94,.06);
  border: 1px solid rgba(34,197,94,.2);
  border-radius: 9px;
  margin-bottom: 10px;
  flex-wrap: wrap;
  animation: barFadeIn .3s ease;
}
@keyframes barFadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
.amb-label {
  font-family: var(--font-mono);
  font-size: .62rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.amb-models {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}
.amb-model-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  background: rgba(34,197,94,.1);
  border: 1px solid rgba(34,197,94,.3);
  border-radius: 99px;
  font-family: var(--font-mono);
  font-size: .68rem;
  font-weight: 600;
  color: #22c55e;
  white-space: nowrap;
  transition: all .15s;
}
.amb-model-chip:hover {
  background: rgba(34,197,94,.18);
  border-color: #22c55e;
}
.amb-model-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34,197,94,.8);
  flex-shrink: 0;
  animation: greenPulse 1.8s ease-in-out infinite;
}
@keyframes greenPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.3;transform:scale(.6)} }
.amb-model-alert {
  font-family: var(--font-mono);
  font-size: .55rem;
  padding: 1px 6px;
  border-radius: 99px;
  background: rgba(232,69,69,.12);
  border: 1px solid rgba(232,69,69,.25);
  color: #ff7070;
  letter-spacing: .05em;
}
.amb-no-models {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: .72rem;
  color: var(--text-muted);
}
.amb-no-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255,255,255,.15);
  flex-shrink: 0;
}
.amb-refresh {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: .6rem;
  cursor: pointer;
  transition: all .15s;
  flex-shrink: 0;
}
.amb-refresh:hover {
  border-color: var(--text-muted);
  color: var(--text-secondary);
}

/* ══════════════════════════════════════════════════════════════
   CAMERA INFO BUTTON  (on each stream cell)
══════════════════════════════════════════════════════════════ */
.cell-info-btn {
  position: absolute;
  top: 30px;
  right: 8px;
  z-index: 10;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(0,0,0,.55);
  border: 1px solid rgba(255,255,255,.12);
  color: rgba(255,255,255,.55);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all .15s;
  backdrop-filter: blur(4px);
  opacity: 0;
}
.stream-cell:hover .cell-info-btn { opacity: 1; }
.cell-info-btn:hover {
  background: rgba(34,211,238,.2);
  border-color: rgba(34,211,238,.5);
  color: var(--cyan);
  opacity: 1;
}
.cell-info-btn.active {
  background: rgba(34,211,238,.18);
  border-color: rgba(34,211,238,.5);
  color: var(--cyan);
  opacity: 1;
}

/* ══════════════════════════════════════════════════════════════
   CAMERA ANALYTICS DRAWER  (slides up inside cell)
══════════════════════════════════════════════════════════════ */
.cam-analytics-drawer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
  background: rgba(8, 10, 20, .93);
  border-top: 1px solid rgba(34,211,238,.18);
  backdrop-filter: blur(12px);
  transform: translateY(100%);
  transition: transform .28s cubic-bezier(.16,1,.3,1);
  max-height: 72%;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 0 0 inherit inherit;
}
.cam-analytics-drawer.open {
  transform: translateY(0);
}
.cam-analytics-drawer::-webkit-scrollbar { width: 3px; }
.cam-analytics-drawer::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }

/* Drawer header */
.cad-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(255,255,255,.07);
  flex-shrink: 0;
}
.cad-cam-name {
  font-family: var(--font-mono);
  font-size: .72rem;
  font-weight: 700;
  color: var(--text-primary);
  flex: 1;
}
.cad-close {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: transparent;
  border: 1px solid rgba(255,255,255,.1);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all .12s;
  flex-shrink: 0;
}
.cad-close:hover { border-color: var(--text-muted); color: var(--text-primary); }

/* Section label inside drawer */
.cad-section {
  padding: 8px 12px 0;
}
.cad-section-label {
  font-family: var(--font-mono);
  font-size: .55rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.cad-section-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255,255,255,.06);
}

/* Active model chips inside drawer */
.cad-models-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-bottom: 10px;
}
.cad-model-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  background: rgba(34,197,94,.08);
  border: 1px solid rgba(34,197,94,.25);
  border-radius: 99px;
  font-family: var(--font-mono);
  font-size: .62rem;
  color: #22c55e;
  white-space: nowrap;
}
.cad-model-chip-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
  animation: greenPulse 1.8s ease-in-out infinite;
}
.cad-no-model {
  font-family: var(--font-mono);
  font-size: .65rem;
  color: var(--text-muted);
  padding-bottom: 8px;
}

/* Count cards inside drawer */
.cad-count-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 5px;
  padding-bottom: 10px;
}
.cad-count-card {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 6px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 2px solid var(--card-accent, var(--cyan));
  transition: border-color .15s;
}
.cad-count-class {
  font-family: var(--font-mono);
  font-size: .52rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cad-count-num {
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1;
  font-family: var(--font-mono);
}
.cad-count-num.bump { animation: cntBump .2s ease; }
@keyframes cntBump { 0%{transform:scale(1)} 50%{transform:scale(1.15)} 100%{transform:scale(1)} }
.cad-count-idle {
  font-family: var(--font-mono);
  font-size: .65rem;
  color: var(--text-muted);
  padding-bottom: 8px;
  font-style: italic;
}

/* Feature grid (analytics capabilities) */
.cad-features-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  padding-bottom: 12px;
}
.cad-feature-tile {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  background: rgba(255,255,255,.025);
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 7px;
  position: relative;
  overflow: hidden;
  transition: border-color .15s, background .15s;
}
.cad-feature-tile.is-active {
  background: rgba(34,211,238,.07);
  border-color: rgba(34,211,238,.25);
}
.cad-feature-tile.is-active:hover {
  background: rgba(34,211,238,.12);
  border-color: rgba(34,211,238,.4);
  cursor: pointer;
}
.cad-feature-icon {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.04);
}
.cad-feature-tile.is-active .cad-feature-icon {
  background: rgba(34,211,238,.12);
  border-color: rgba(34,211,238,.2);
  color: var(--cyan);
}
.cad-feature-tile.is-soon .cad-feature-icon {
  opacity: .4;
}
.cad-feature-info { flex: 1; min-width: 0; }
.cad-feature-name {
  font-family: var(--font-mono);
  font-size: .65rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cad-feature-tile.is-active .cad-feature-name { color: var(--cyan); }
.cad-feature-tile.is-soon .cad-feature-name { color: var(--text-muted); }
.cad-feature-sub {
  font-family: var(--font-mono);
  font-size: .55rem;
  color: var(--text-muted);
  margin-top: 1px;
}
.cad-feature-badge {
  font-family: var(--font-mono);
  font-size: .5rem;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}
.cad-feature-badge.live {
  background: rgba(34,197,94,.15);
  border: 1px solid rgba(34,197,94,.3);
  color: #22c55e;
}
.cad-feature-badge.soon {
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.1);
  color: var(--text-muted);
}

/* Incidents mini stat inside drawer */
.cad-incidents-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  background: rgba(232,69,69,.06);
  border: 1px solid rgba(232,69,69,.15);
  border-radius: 7px;
  margin-bottom: 10px;
}
.cad-inc-icon {
  color: #e84545;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.cad-inc-label {
  font-family: var(--font-mono);
  font-size: .6rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--text-muted);
  flex: 1;
}
.cad-inc-count {
  font-family: var(--font-mono);
  font-size: .85rem;
  font-weight: 800;
  color: var(--text-primary);
}
.cad-inc-count.nonzero { color: #e84545; }

/* stream cell must be relative for absolute children */
.stream-cell { position: relative; overflow: hidden; }
  `;
  document.head.appendChild(style);

  /* ── FEATURE DEFINITIONS ─────────────────────────────────────────── */
  const FEATURES = [
    {
      id: 'count',
      name: 'Object Count',
      sub: 'Live per-class totals',
      icon: `<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>`,
      active: true,
      link: '/analytics',
    },
    {
      id: 'track',
      name: 'Object Tracking',
      sub: 'Trajectories & IDs',
      icon: `<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.3"/><path d="M3 8C3 5.24 5.24 3 8 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M13 8C13 10.76 10.76 13 8 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
      active: false,
    },
    {
      id: 'line',
      name: 'Line Crossing',
      sub: 'Directional counts',
      icon: `<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M2 14L14 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="5" cy="5" r="1.8" stroke="currentColor" stroke-width="1.2"/><circle cx="11" cy="11" r="1.8" stroke="currentColor" stroke-width="1.2"/></svg>`,
      active: false,
    },
    {
      id: 'zone',
      name: 'Zone Analytics',
      sub: 'Dwell time & occupancy',
      icon: `<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M2 6l6-3 6 3v7l-6 3-6-3V6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
      active: false,
    },
    {
      id: 'heatmap',
      name: 'Heatmap',
      sub: 'Movement density',
      icon: `<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="4" stroke="currentColor" stroke-width="1" opacity=".6"/><circle cx="8" cy="8" r="1.5" fill="currentColor" opacity=".8"/></svg>`,
      active: false,
    },
    {
      id: 'alerts',
      name: 'Alert History',
      sub: 'Incident timeline',
      icon: `<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M8 1.5l5.5 9.5H2.5L8 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 6v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="10.5" r=".6" fill="currentColor"/></svg>`,
      active: true,
    },
  ];

  const CLASS_COLORS = ['#22d3ee','#e84545','#f59e0b','#a78bfa','#22c55e','#fb923c','#60a5fa','#f472b6'];

  const drawerOpen = {};   // slotIndex → bool

  /* ═══════════════════════════════════════════════════════════════
     ACTIVE MODELS BANNER
  ═══════════════════════════════════════════════════════════════ */
  let _bannerFetching = false; 
  async function renderModelsBanner() {
    if (_bannerFetching) return;
    _bannerFetching = true;
    const section = document.querySelector('.stream-viewer-section');
    if (!section) return;

    // Remove existing banner
    document.getElementById('velionModelsBanner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'velionModelsBanner';
    banner.className = 'active-models-bar';

    try {
      const data = await _fetchModels();
      const active = (data.models || []).filter(m => m.active);

      if (active.length === 0) {
          banner.style.display = 'none';
          return;
      } else {
        const chips = active.map(m => {
          const alertClasses = Object.values(m.class_count ? {} : {});
          const hasAlert = true; 
          return `
            <span class="amb-model-chip" title="${m.filename}">
              <span class="amb-model-dot"></span>
              ${m.display_name || m.filename}
              ${m.alert_label ? `<span class="amb-model-alert">${m.alert_label}</span>` : ''}
            </span>`;
        }).join('');

        banner.innerHTML = `
          <span class="amb-label">Active Models</span>
          <div class="amb-models">${chips}</div>
          <button class="amb-refresh" onclick="velionRefreshBanner()">
            <svg viewBox="0 0 12 12" fill="none" width="9" height="9"><path d="M2 6a4 4 0 1 0 .8-2.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M2 3v3H5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Refresh
          </button>`;
      }
    } catch (_) {
      banner.innerHTML = `<div class="amb-no-models"><span class="amb-no-dot"></span>Could not load models</div>`;
    }

    const grid = document.getElementById('streamGrid');
    if (grid) {
      section.insertBefore(banner, grid);
    } else {
      section.insertBefore(banner, section.firstChild);
    }
  }

  window.velionRefreshBanner = renderModelsBanner;

  /* ═══════════════════════════════════════════════════════════════
     INJECT INFO BUTTON + DRAWER INTO A CELL
  ═══════════════════════════════════════════════════════════════ */
  function injectCellOverlay(slotIndex) {
    const cell = document.getElementById(`cell-${slotIndex}`);
    if (!cell || cell.dataset.analyticsInjected) return;
    cell.dataset.analyticsInjected = '1';

    const infoBtn = document.createElement('button');
    infoBtn.className = 'cell-info-btn';
    infoBtn.id = `info-btn-${slotIndex}`;
    infoBtn.title = 'Camera analytics';
    infoBtn.innerHTML = `<svg viewBox="0 0 14 14" fill="none" width="11" height="11"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 5.5v4M7 4.5h.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDrawer(slotIndex);
    });
    cell.appendChild(infoBtn);

    const drawer = document.createElement('div');
    drawer.className = 'cam-analytics-drawer';
    drawer.id = `drawer-${slotIndex}`;
    drawer.innerHTML = _buildDrawerHTML(slotIndex);
    cell.appendChild(drawer);
  }

  function _buildDrawerHTML(slotIndex) {
    const camLabel = getCamLabel(slotIndex);
    return `
      <div class="cad-header">
        <svg viewBox="0 0 14 14" fill="none" width="11" height="11" style="color:var(--cyan);flex-shrink:0;">
          <rect x="1" y="3" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/>
          <path d="M11 6l3-1.5v5L11 8" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
        </svg>
        <span class="cad-cam-name">${camLabel}</span>
        <button class="cad-close" onclick="velionCloseDrawer(${slotIndex})">
          <svg viewBox="0 0 10 10" fill="none" width="9" height="9"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
      </div>

      <div class="cad-section">
        <div class="cad-section-label">Detection Model</div>
        <div class="cad-models-row" id="drawer-models-${slotIndex}">
          <span class="cad-no-model">Loading…</span>
        </div>
      </div>

      <div class="cad-section">
        <div class="cad-section-label">Live Counts</div>
        <div id="drawer-counts-${slotIndex}">
          <div class="cad-count-idle">Waiting for stream…</div>
        </div>
      </div>

      <div class="cad-section">
        <div class="cad-section-label">Incidents</div>
        <div class="cad-incidents-row" id="drawer-incidents-${slotIndex}">
          <span class="cad-inc-icon">
            <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M7 1.5l5.5 9.5H1.5L7 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 5.5v2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="7" cy="10" r=".5" fill="currentColor"/></svg>
          </span>
          <span class="cad-inc-label">Confirmed Incidents</span>
          <span class="cad-inc-count" id="drawer-inc-num-${slotIndex}">0</span>
        </div>
      </div>

      <div class="cad-section">
        <div class="cad-section-label">Analytics Capabilities</div>
        <div class="cad-features-grid">
          ${FEATURES.map(f => `
            <div class="cad-feature-tile ${f.active ? 'is-active' : 'is-soon'}"
                 ${f.active && f.link ? `onclick="window.location.href='${f.link}'"` : ''}
                 title="${f.name}">
              <div class="cad-feature-icon">${f.icon}</div>
              <div class="cad-feature-info">
                <div class="cad-feature-name">${f.name}</div>
                <div class="cad-feature-sub">${f.sub}</div>
              </div>
              <span class="cad-feature-badge ${f.active ? 'live' : 'soon'}">${f.active ? 'Live' : 'Soon'}</span>
            </div>`).join('')}
        </div>
      </div>
    `;
  }

  function toggleDrawer(slotIndex) {
    const drawer = document.getElementById(`drawer-${slotIndex}`);
    const btn    = document.getElementById(`info-btn-${slotIndex}`);
    if (!drawer) return;

    const isOpen = drawerOpen[slotIndex];
    drawerOpen[slotIndex] = !isOpen;

    drawer.classList.toggle('open', !isOpen);
    btn?.classList.toggle('active', !isOpen);

    if (!isOpen) {
      refreshDrawerContent(slotIndex);
    }
  }

  window.velionCloseDrawer = function(slotIndex) {
    drawerOpen[slotIndex] = false;
    document.getElementById(`drawer-${slotIndex}`)?.classList.remove('open');
    document.getElementById(`info-btn-${slotIndex}`)?.classList.remove('active');
  };

  async function refreshDrawerContent(slotIndex) {
    updateDrawerModels(slotIndex);
    updateDrawerCounts(slotIndex);
    updateDrawerIncidents(slotIndex);
  }

  async function updateDrawerModels(slotIndex) {
    const el = document.getElementById(`drawer-models-${slotIndex}`);
    if (!el) return;
    try {
      const data = await _fetchModels();
      const active = (data.models || []).filter(m => m.active);
      if (!active.length) {
        el.innerHTML = `<span class="cad-no-model">No model active — <a href="/models" style="color:var(--cyan);">activate one</a></span>`;
        return;
      }
      el.innerHTML = active.map(m => `
        <span class="cad-model-chip">
          <span class="cad-model-chip-dot"></span>
          ${m.display_name || m.filename}
        </span>`).join('');
    } catch (_) {
      el.innerHTML = `<span class="cad-no-model">Could not load models</span>`;
    }
  }

  async function updateDrawerCounts(slotIndex) {
    const el = document.getElementById(`drawer-counts-${slotIndex}`);
    if (!el) return;

    if (!window.connectedStreams?.[slotIndex]) {
      el.innerHTML = `<div class="cad-count-idle">No stream connected</div>`;
      return;
    }

    const streamId = window.connectedStreams[slotIndex].id;

    try {
      const raw = localStorage.getItem('velion_count_live');
      if (raw) {
        const all = JSON.parse(raw);
        const streamCounts = all[streamId];
        if (streamCounts && Date.now() - (all[streamId]?.['_ts'] || 0) < 10000) {
          const merged = {};
          Object.entries(streamCounts).forEach(([key, val]) => {
            if (key === '_ts') return;
            if (typeof val === 'object') {
              Object.entries(val).forEach(([cls, cnt]) => {
                merged[cls] = (merged[cls] || 0) + cnt;
              });
            }
          });
          if (Object.keys(merged).length > 0) {
            renderCountCards(el, merged);
            return;
          }
        }
      }
    } catch (_) {}

    try {
      const res  = await fetch(`/api/stream-count/${streamId}`);
      const data = await res.json();
      if (data.success && Object.keys(data.counts || {}).length > 0) {
        renderCountCards(el, data.counts);
        return;
      }
    } catch (_) {}

    el.innerHTML = `<div class="cad-count-idle">Stream connected — <a href="/analytics" style="color:var(--cyan);">activate counting</a> to see live data</div>`;
  }

  function renderCountCards(el, counts) {
    const entries = Object.entries(counts);
    if (!entries.length) {
      el.innerHTML = `<div class="cad-count-idle">No detections yet</div>`;
      return;
    }
    el.innerHTML = `<div class="cad-count-grid">${
      entries.map(([name, val], idx) => {
        const color = CLASS_COLORS[idx % CLASS_COLORS.length];
        return `<div class="cad-count-card" style="--card-accent:${color}">
          <div class="cad-count-class">${name}</div>
          <div class="cad-count-num" style="color:${color}">${val}</div>
        </div>`;
      }).join('')
    }</div>`;
  }

  function updateDrawerIncidents(slotIndex) {
    const numEl = document.getElementById(`drawer-inc-num-${slotIndex}`);
    if (!numEl) return;

    const stream = window.connectedStreams?.[slotIndex];
    if (!stream) { numEl.textContent = '—'; return; }

    const count = window.lastIncidentCounts?.[stream.id] || 0;
    numEl.textContent = count;
    numEl.classList.toggle('nonzero', count > 0);
  }

  function getCamLabel(slotIndex) {
    const stream = window.connectedStreams?.[slotIndex];
    if (stream?.label) return stream.label;
    return `CAM ${String(slotIndex).padStart(2, '0')}`;
  }

  /* ═══════════════════════════════════════════════════════════════
     MUTATION OBSERVER  — inject overlays when cells are added
  ═══════════════════════════════════════════════════════════════ */
  function injectAllCells() {
    document.querySelectorAll('.stream-cell').forEach(cell => {
      const idx = parseInt(cell.id?.replace('cell-', ''));
      if (!isNaN(idx)) injectCellOverlay(idx);
    });
  }

  const observer = new MutationObserver(() => injectAllCells());
  const grid = document.getElementById('streamGrid');
  if (grid) observer.observe(grid, { childList: true, subtree: false });

  /* ═══════════════════════════════════════════════════════════════
     LIVE COUNT POLLER  — refreshes open drawers every 2s
  ═══════════════════════════════════════════════════════════════ */
  setInterval(() => {
    Object.entries(drawerOpen).forEach(([slotIndex, isOpen]) => {
      if (!isOpen) return;
      updateDrawerCounts(parseInt(slotIndex));
      updateDrawerIncidents(parseInt(slotIndex));
    });
  }, 2000);

  /* ═══════════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════════ */
  function init() {
    renderModelsBanner();
    injectAllCells();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

  window.addEventListener('focus', renderModelsBanner);

  window.velionInjectCell = function(slotIndex) {
    setTimeout(() => injectCellOverlay(slotIndex), 50);
  };

  window.velionOnStreamConnected = function(slotIndex) {
    const nameEl = document.querySelector(`#drawer-${slotIndex} .cad-cam-name`);
    if (nameEl) nameEl.textContent = getCamLabel(slotIndex);
    renderModelsBanner();
  };

})();
