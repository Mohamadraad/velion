const connectedStreams   = {};
const lastIncidentCounts = {};
let currentLayout   = '2x2';
let activeSingleCam = 1;
let _pollerStarted  = false;

document.addEventListener('DOMContentLoaded', async () => {
  const restoreData = await _restorePreviousStreams();  

  if (restoreData?.restored?.length > 0) {
    restoreData.restored.forEach(r => {
      const slot = r.slot;
      if (!slot || connectedStreams[slot]) return;
      _ensureSlotExists(slot);
      _populateSlot(slot, r.stream_id, r.label, r.source, r.source_type);
    });
    updateStreamCountBadge(Object.keys(connectedStreams).length);
    _rebuildCamSwitcher();
    _updateGridClass();
  }

  _startPoller();
});

async function _restorePreviousStreams() {
  try {
    const data = await apiCall('/api/streams/restore', 'POST');
    if (!data.success) return null;

    const nOk   = data.restored?.length || 0;
    const nFail = data.failed?.length   || 0;

    if (nOk === 0 && nFail === 0) return data;

    if      (nOk > 0 && nFail === 0) showToast(`Reconnected ${nOk} stream${nOk > 1 ? 's' : ''} from last session.`, 'success');
    else if (nOk === 0 && nFail > 0) showToast(`Could not reconnect ${nFail} stream${nFail > 1 ? 's' : ''} — sources may be offline.`, 'warning');
    else                             showToast(`Restored ${nOk} stream${nOk > 1 ? 's' : ''}; ${nFail} could not reconnect.`, 'warning');

    if (nOk > 0) {
      data.restored.forEach(r => {
        if (!r.slot) return;
        _ensureSlotExists(r.slot);
        _populateSlot(r.slot, r.stream_id, r.label, r.source, r.source_type);
      });
      updateStreamCountBadge(Object.keys(connectedStreams).length);
      _rebuildCamSwitcher();
      _updateGridClass();
    }

    if (nFail > 0) _showFailedRestoreErrors(data.failed);

    return data;
  } catch (err) {
    console.warn('[Velion] Restore endpoint unavailable:', err.message);
    return null;
  }
}

function _ensureSlotExists(slot) {
  if (typeof _slotCounter !== 'undefined' && slot > _slotCounter) {
    _slotCounter = slot;
  }

  if (!document.getElementById(`row-${slot}`)) {
    if (slot <= 4) return; 
    const row = document.createElement('div');
    row.className = 'stream-input-row';
    row.dataset.index = slot;
    row.id = `row-${slot}`;
    if (typeof _buildSlotHTML === 'function') {
      row.innerHTML = _buildSlotHTML(slot);
    }
    const inputs = document.getElementById('streamInputs');
    if (inputs) inputs.appendChild(row);
    if (typeof camSourceType !== 'undefined') camSourceType[slot] = 'url';
  }

  if (!document.getElementById(`cell-${slot}`)) {
    if (typeof _addGridCell === 'function') {
      _addGridCell(slot);
    }
  }
}

function _populateSlot(slot, streamId, label, source, sourceType) {
  connectedStreams[slot] = { id: streamId, label, url: source || '' };
  lastIncidentCounts[streamId] = lastIncidentCounts[streamId] ?? 0;

  if (sourceType === 'camera') switchSourceType(slot, 'camera');
  const labelEl = document.getElementById(`stream-label-${slot}`);
  if (labelEl) { labelEl.value = label; labelEl.readOnly = true; }

  if (sourceType !== 'camera') {
    const urlEl = document.getElementById(`stream-url-${slot}`);
    if (urlEl) { urlEl.value = source || ''; urlEl.readOnly = true; }
  }

  document.querySelector(`.btn-connect[data-index="${slot}"]`)?.classList.add('hidden');
  document.querySelector(`.btn-disconnect[data-index="${slot}"]`)?.classList.remove('hidden');
  document.getElementById(`indicator-${slot}`)?.classList.add('active');

  const delBtn = document.querySelector(`.btn-delete-slot[data-index="${slot}"]`);
  if (delBtn) delBtn.disabled = true;

  const select  = document.getElementById(`stream-device-${slot}`);
  const scanBtn = document.getElementById(`scan-btn-${slot}`);
  if (select)  select.disabled  = true;
  if (scanBtn) scanBtn.disabled = true;

  injectFeed(slot, streamId, label);
}

function _showFailedRestoreErrors(failedList) {
  failedList.forEach(f => {
    let slot = f.slot ?? null;
    if (slot === null) {
      const allSlots = _getAllSlotIndices();
      for (const s of allSlots) {
        if (!connectedStreams[s]) { slot = s; break; }
      }
    }

    if (slot === null) {
      showToast(`⚠ ${f.label}: ${f.error}`, 'error');
      return;
    }

    _ensureSlotExists(slot);
    _setCellOffline(slot, f.label, f.error);
  });
}

function _setCellOffline(slot, label, reason) {
  const cell = document.getElementById(`cell-${slot}`);
  if (!cell) return;

  updateCellLabel(slot, 'OFFLINE', label);

  const body = cell.querySelector('.cell-body');
  if (body) {
    body.innerHTML = `
      <div style="
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:10px; width:100%; height:100%;
        background:rgba(232,69,69,.04);
      ">
        <svg viewBox="0 0 24 24" fill="none" style="width:32px;height:32px;color:#e84545;">
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <div style="
          font-family:var(--font-mono); font-size:.72rem; font-weight:700;
          color:#e84545; letter-spacing:.06em; text-transform:uppercase;
        ">Stream Offline</div>
        <div style="
          font-family:var(--font-mono); font-size:.62rem; color:var(--text-muted);
          text-align:center; padding:0 12px; line-height:1.5;
        ">${label}</div>
        <div style="
          font-family:var(--font-mono); font-size:.58rem; color:rgba(232,69,69,.7);
          text-align:center; padding:0 16px; line-height:1.5;
        ">${reason}</div>
        <button
          onclick="connectStream(${slot})"
          style="
            margin-top:4px; height:28px; padding:0 14px;
            background:rgba(232,69,69,.1); border:1px solid rgba(232,69,69,.35);
            border-radius:6px; color:#e84545;
            font-family:var(--font-mono); font-size:.65rem; font-weight:600;
            letter-spacing:.07em; text-transform:uppercase; cursor:pointer;
            transition:background .15s, border-color .15s;
          "
          onmouseover="this.style.background='rgba(232,69,69,.2)'"
          onmouseout="this.style.background='rgba(232,69,69,.1)'"
        >Retry Connect</button>
      </div>`;
  }

  const indicator = document.getElementById(`indicator-${slot}`);
  if (indicator) {
    indicator.classList.remove('active');
    indicator.style.background = '#e84545';
    indicator.style.boxShadow  = '0 0 6px rgba(232,69,69,.6)';
  }
}

const _cellHealthState = {};   

function _startPoller() {
  if (_pollerStarted) return;
  _pollerStarted = true;
  console.log('[Velion] Incident + health poller started');

  setInterval(async () => {
    const slots = Object.keys(connectedStreams);
    if (slots.length === 0) return;

    for (const slot of slots) {
      const stream = connectedStreams[slot];
      if (!stream) continue;

      try {
        const res = await apiCall(`/api/stream-status/${stream.id}`);
        if (!connectedStreams[slot]) continue;
        if (!res.success) continue;

        const health  = res.health || 'ok';
        const prevHealth = _cellHealthState[slot] || 'ok';

        if (health !== prevHealth) {
          _cellHealthState[slot] = health;

          if (health === 'reconnecting') {
            _showReconnectingOverlay(parseInt(slot), stream.label, res.reconnect_attempt || 1);
          } else if (health === 'dead') {
            _showDeadOverlay(parseInt(slot), stream.label);
          } else if (health === 'ok' && prevHealth !== 'ok') {
            _clearHealthOverlay(parseInt(slot));
            injectFeed(parseInt(slot), stream.id, stream.label);
          }
        }

        if (health === 'reconnecting' && res.reconnect_attempt) {
          const el = document.getElementById(`reconnect-attempt-${slot}`);
          if (el) el.textContent = `Attempt ${res.reconnect_attempt} of 3…`;
        }

        if (health === 'ok') {
          const prev = lastIncidentCounts[stream.id] ?? 0;
          const curr = res.incident_count || 0;

          if (curr > prev) {
            lastIncidentCounts[stream.id] = curr;
            const diff  = curr - prev;
            const label = stream.label || `CAM ${String(slot).padStart(2,'0')}`;

            pushBellAlert(
              `${diff} new incident${diff > 1 ? 's' : ''} — total: ${curr}`,
              'accident',
              label
            );
            addAlertEntry(`Accident confirmed on ${label}`, 'high', label);
            _flashCell(parseInt(slot));
            _showCellOverlay(parseInt(slot), label, curr);
          }
        }

      } catch (err) {
        if (err.message.includes('404')) continue;
        console.warn(`[Velion] Poller error for stream ${stream.id}:`, err);
      }
    }
  }, 2000);
}

function _showReconnectingOverlay(slot, label, attempt) {
  const cell = document.getElementById(`cell-${slot}`);
  if (!cell) return;
  updateCellLabel(slot, 'RECONNECTING', label);

  if (cell.querySelector('.health-overlay')) return;

  const body = cell.querySelector('.cell-body');
  if (!body) return;

  const existing = body.querySelector('img');
  if (existing) existing.style.filter = 'brightness(0.25) blur(2px)';

  const overlay = document.createElement('div');
  overlay.className = 'health-overlay';
  overlay.style.cssText = `
    position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:10px;
    background:rgba(0,0,0,.55); backdrop-filter:blur(2px);
  `;
  overlay.innerHTML = `
    <svg class="spin-icon" viewBox="0 0 24 24" fill="none"
         style="width:32px;height:32px;color:#f59e0b;animation:spinCW 1s linear infinite;">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" stroke-dasharray="30 10" stroke-linecap="round"/>
    </svg>
    <div style="font-family:var(--font-mono);font-size:.72rem;font-weight:700;
                color:#f59e0b;letter-spacing:.08em;text-transform:uppercase;">
      Reconnecting…
    </div>
    <div id="reconnect-attempt-${slot}"
         style="font-family:var(--font-mono);font-size:.6rem;color:rgba(245,158,11,.7);">
      Attempt ${attempt} of 3…
    </div>`;
  body.style.position = 'relative';
  body.appendChild(overlay);

  if (!document.getElementById('_velion_spin_kf')) {
    const s = document.createElement('style');
    s.id = '_velion_spin_kf';
    s.textContent = '@keyframes spinCW{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }
}

function _showDeadOverlay(slot, label) {
  const cell = document.getElementById(`cell-${slot}`);
  if (!cell) return;
  updateCellLabel(slot, 'DISCONNECTED', label);

  const body = cell.querySelector('.cell-body');
  if (!body) return;
  body.style.position = '';
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                gap:10px;width:100%;height:100%;background:rgba(232,69,69,.04);">
      <svg viewBox="0 0 24 24" fill="none" style="width:34px;height:34px;color:#e84545;">
        <path d="M3 3l18 18M10.5 10.677A3 3 0 0 0 9 13.5a3 3 0 0 0 3 3
                 c1.074 0 2.018-.564 2.554-1.414M6.527 6.536
                 A7 7 0 0 0 5 11a7 7 0 0 0 7 7 7 7 0 0 0 4.471-1.596
                 M8.279 3.296A10 10 0 0 1 12 3a10 10 0 0 1 10 10
                 10 10 0 0 1-1.996 6.004"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <div style="font-family:var(--font-mono);font-size:.72rem;font-weight:700;
                  color:#e84545;letter-spacing:.06em;text-transform:uppercase;">
        Camera Disconnected
      </div>
      <div style="font-family:var(--font-mono);font-size:.6rem;color:var(--text-muted);
                  text-align:center;padding:0 12px;line-height:1.5;">
        ${label}<br>
        <span style="color:rgba(232,69,69,.6);font-size:.55rem;">
          Failed to reconnect after 3 attempts
        </span>
      </div>
      <button onclick="retryDeadStream(${slot})"
              style="margin-top:4px;height:28px;padding:0 14px;
                     background:rgba(232,69,69,.1);border:1px solid rgba(232,69,69,.35);
                     border-radius:6px;color:#e84545;
                     font-family:var(--font-mono);font-size:.65rem;font-weight:600;
                     letter-spacing:.07em;text-transform:uppercase;cursor:pointer;
                     transition:background .15s,border-color .15s;"
              onmouseover="this.style.background='rgba(232,69,69,.2)'"
              onmouseout="this.style.background='rgba(232,69,69,.1)'">
        Retry Connect
      </button>
    </div>`;

  const indicator = document.getElementById(`indicator-${slot}`);
  if (indicator) {
    indicator.classList.remove('active');
    indicator.style.background = '#e84545';
    indicator.style.boxShadow  = '0 0 6px rgba(232,69,69,.6)';
  }
}

function _clearHealthOverlay(slot) {
  const cell = document.getElementById(`cell-${slot}`);
  if (!cell) return;

  const body = cell.querySelector('.cell-body');
  if (body) {
    body.querySelector('.health-overlay')?.remove();
    const img = body.querySelector('img');
    if (img) img.style.filter = '';
    body.style.position = '';
  }

  const indicator = document.getElementById(`indicator-${slot}`);
  if (indicator) {
    indicator.style.background = '';
    indicator.style.boxShadow  = '';
    indicator.classList.add('active');
  }

  delete _cellHealthState[slot];
}

async function retryDeadStream(slot) {
  const stream = connectedStreams[slot];
  if (stream) {
    try { await apiCall(`/api/remove-stream/${stream.id}`, 'DELETE'); } catch (_) {}
    delete connectedStreams[slot];
    delete _cellHealthState[slot];
    delete lastIncidentCounts[stream.id];
  }

  document.querySelector(`.btn-connect[data-index="${slot}"]`)?.classList.remove('hidden');
  document.querySelector(`.btn-disconnect[data-index="${slot}"]`)?.classList.add('hidden');

  const urlEl   = document.getElementById(`stream-url-${slot}`);
  const labelEl = document.getElementById(`stream-label-${slot}`);
  const select  = document.getElementById(`stream-device-${slot}`);
  const scanBtn = document.getElementById(`scan-btn-${slot}`);
  if (urlEl)   urlEl.readOnly   = false;
  if (labelEl) labelEl.readOnly = false;
  if (select)  select.disabled  = false;
  if (scanBtn) scanBtn.disabled = false;

  const delBtn = document.querySelector(`.btn-delete-slot[data-index="${slot}"]`);
  if (delBtn) delBtn.disabled = false;

  const indicator = document.getElementById(`indicator-${slot}`);
  if (indicator) {
    indicator.style.background = '';
    indicator.style.boxShadow  = '';
    indicator.classList.remove('active');
  }

  updateStreamCountBadge(Object.keys(connectedStreams).length);
  _rebuildCamSwitcher();

  connectStream(slot);
}

async function disconnectStream(index) {
  const stream = connectedStreams[index];
  if (!stream) return;

  const connectBtn = document.querySelector(`.btn-connect[data-index="${index}"]`);
  const discBtn    = document.querySelector(`.btn-disconnect[data-index="${index}"]`);
  const urlInput   = document.getElementById(`stream-url-${index}`);
  const labelInput = document.getElementById(`stream-label-${index}`);
  const indicator  = document.getElementById(`indicator-${index}`);

  try { await apiCall(`/api/remove-stream/${stream.id}`, 'DELETE'); } catch (_) {}

  delete lastIncidentCounts[stream.id];

  const cell = document.getElementById(`cell-${index}`);
  if (cell) {
    const img = cell.querySelector('.cell-body img');
    if (img) img.src = '';
    cell.style.boxShadow = '';
    document.getElementById(`overlay-${index}`)?.classList.add('hidden');
  }

  delete connectedStreams[index];
  delete _cellHealthState[index];   

  if (indicator) {
    indicator.style.background = '';
    indicator.style.boxShadow  = '';
    indicator.classList.remove('active', 'error');
  }

  connectBtn?.classList.remove('hidden');
  discBtn?.classList.add('hidden');
  if (connectBtn) { connectBtn.textContent = 'Connect'; connectBtn.disabled = false; }

  if (urlInput)   urlInput.readOnly   = false;
  if (labelInput) labelInput.readOnly = false;

  const select  = document.getElementById(`stream-device-${index}`);
  const scanBtn = document.getElementById(`scan-btn-${index}`);
  if (select)  select.disabled  = false;
  if (scanBtn) scanBtn.disabled = false;

  const delBtn = document.querySelector(`.btn-delete-slot[data-index="${index}"]`);
  if (delBtn) delBtn.disabled = false;

  setIdlePlaceholder(index);
  updateStreamCountBadge(Object.keys(connectedStreams).length);
  _rebuildCamSwitcher();
  showToast(`${stream.label} disconnected.`, 'info');
}

function _flashCell(slot) {
  const cell = document.getElementById(`cell-${slot}`);
  if (!cell) return;
  cell.style.transition = 'box-shadow .1s';
  cell.style.boxShadow  = '0 0 0 3px rgba(232,69,69,.9), inset 0 0 30px rgba(232,69,69,.15)';
  setTimeout(() => { cell.style.boxShadow = '0 0 0 2px rgba(232,69,69,.45)'; }, 400);
  setTimeout(() => { cell.style.boxShadow = ''; }, 12000);
}

function _showCellOverlay(slot, label, total) {
  const overlay = document.getElementById(`overlay-${slot}`);
  if (!overlay) return;
  overlay.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;">
      <span class="alert-badge">⚠ ACCIDENT — ${label}</span>
      <span style="font-family:var(--font-mono);font-size:.6rem;
                   color:rgba(255,255,255,.55);padding-left:2px;">
        Total incidents: ${total}
      </span>
    </div>`;
  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 15000);
}

function injectFeed(slot, streamId, label) {
  const cell = document.getElementById(`cell-${slot}`);
  if (!cell) return;
  updateCellLabel(slot, 'LIVE', label);
  const body = cell.querySelector('.cell-body');
  if (!body) return;
  body.innerHTML = '';
  body.style.position = '';

  const img = document.createElement('img');
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  img.src = `/video-feed/${streamId}?t=${Date.now()}`;
  img.onerror = () => {
    console.warn(`[Velion] Feed for slot ${slot} (stream ${streamId}) closed`);
  };
  body.appendChild(img);
}

function setIdlePlaceholder(index) {
  const cell = document.getElementById(`cell-${index}`);
  if (!cell) return;
  updateCellLabel(index, 'IDLE', `CAM ${String(index).padStart(2,'0')}`);
  const body = cell.querySelector('.cell-body');
  if (body) body.innerHTML = `
    <div class="cell-placeholder">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1"/>
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1"/>
        <path d="M12 3V6M12 18V21M3 12H6M18 12H21" stroke="currentColor"
          stroke-width="1" stroke-linecap="round"/>
      </svg>
      <span>No stream connected</span>
    </div>`;
}

function updateCellLabel(index, status, label) {
  const tag = label || `CAM ${String(index).padStart(2,'0')}`;
  const el  = document.getElementById(`cell-${index}`)?.querySelector('.cell-label');
  if (el) el.innerHTML = `${tag} <span class="cell-status">— ${status}</span>`;
}

document.querySelectorAll('.layout-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const layout  = btn.dataset.layout;
    currentLayout = layout;
    const grid    = document.getElementById('streamGrid');
    const switcher= document.getElementById('camSwitcher');

    if (layout === '2x2') {
      grid.classList.remove('layout-1x1');
      grid.classList.add('layout-2x2');
      delete grid.dataset.activeCam;
      switcher?.classList.add('hidden');

      const allSlots = _getAllSlotIndices();
      allSlots.forEach((i, idx) => {
        const cell = document.getElementById(`cell-${i}`);
        if (!cell) return;
        cell.style.display = cell.style.gridColumn = cell.style.gridRow = '';
        const s = connectedStreams[i];
        s ? setTimeout(() => injectFeed(i, s.id, s.label), 60 * idx)
          : setIdlePlaceholder(i);
      });

    } else if (layout === '1x1') {
      grid.classList.remove('layout-2x2');
      grid.classList.add('layout-1x1');
      switcher?.classList.remove('hidden');

      const allSlots = _getAllSlotIndices();
      allSlots.forEach(i => {
        if (i !== activeSingleCam) {
          const img = document.getElementById(`cell-${i}`)?.querySelector('.cell-body img');
          if (img) img.src = '';
          const c = document.getElementById(`cell-${i}`);
          if (c) c.style.display = 'none';
        }
      });
      switchSingleCam(activeSingleCam, true);
    }
  });
});

function _getAllSlotIndices() {
  return Array.from(document.querySelectorAll('.stream-input-row'))
    .map(r => parseInt(r.dataset.index))
    .filter(Boolean);
}

function switchSingleCam(camIndex, force = false) {
  if (currentLayout !== '1x1' && !force) return;
  activeSingleCam = camIndex;
  const grid = document.getElementById('streamGrid');
  grid.dataset.activeCam = camIndex;

  const allSlots = _getAllSlotIndices();
  allSlots.forEach(i => {
    const cell = document.getElementById(`cell-${i}`);
    if (!cell) return;
    if (i === camIndex) {
      cell.style.display = '';
      cell.style.gridColumn = '1 / -1';
      cell.style.gridRow    = '1 / -1';
      const s = connectedStreams[i];
      s ? injectFeed(i, s.id, s.label) : setIdlePlaceholder(i);
    } else {
      const img = cell.querySelector('.cell-body img');
      if (img) img.src = '';
      cell.style.display = 'none';
      cell.style.gridColumn = cell.style.gridRow = '';
    }
  });

  document.querySelectorAll('.cam-switch-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.cam) === camIndex);
  });
}

function updateCamSwitcherLiveDots() {
  if (typeof _rebuildCamSwitcher === 'function') _rebuildCamSwitcher();
}

function addAlertEntry(message, severity = 'medium', source = null) {
  const log = document.getElementById('alertLog');
  if (!log) return;
  log.querySelector('.log-empty')?.remove();

  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-severity severity-${severity}">${severity.toUpperCase()}</span>
    <span class="log-time">${time}</span>
    <span class="log-source">${source ? `[${source}] ` : ''}${message}</span>
    <span class="log-status">NEW</span>
  `;
  log.prepend(entry);
}

function clearAlerts() {
  const log = document.getElementById('alertLog');
  if (!log) return;
  log.innerHTML = `
    <div class="log-empty">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <span>No alerts — System monitoring</span>
    </div>`;
}