let _original = {};
let _pending  = {};
let _dirty    = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadModels();
  _wireUploadModal();
  _wireDropZone();
  _wireClassConfigModal();
});

async function loadSettings() {
  try {
    const res  = await fetch('/api/settings');
    const data = await res.json();
    if (!data.success) { showToast('Failed to load settings', 'error'); return; }
    _original = { ...data.settings };
    _pending  = {};
    _dirty    = false;
    applyToUI(data.settings);
    applySystemInfo(data.system);
    updateSaveBtn();
  } catch (e) {
    showToast('Could not reach server', 'error');
  }
}

function applyToUI(cfg) {
  setSlider('general_conf', cfg.general_conf, false);
  setNumber('infer_w_gpu', cfg.infer_w_gpu);
  setNumber('infer_h_gpu', cfg.infer_h_gpu);
  setNumber('infer_w_cpu', cfg.infer_w_cpu);
  setNumber('infer_h_cpu', cfg.infer_h_cpu);

  _applySmField('confirm_frames',        cfg.confirm_frames);
  _applySmField('miss_reset_frames',     cfg.miss_reset_frames);
  _applySmField('alert_hold_frames',     cfg.alert_hold_frames);
  _applySmField('incident_cooldown_sec', cfg.incident_cooldown_sec);

  ['confirm_frames','miss_reset_frames','alert_hold_frames','incident_cooldown_sec']
    .forEach(f => _smApplyConfig(f));
}

const SM_FPS = 30; 

const _smUnits = {
  confirm_frames:       'frames',
  miss_reset_frames:    'frames',
  alert_hold_frames:    'frames',
  incident_cooldown_sec:'minutes',
};

const _smConfig = {
  confirm_frames: {
    frames:  { min: 1,  max: 30,   step: 1,   ticks: ['1','8','15','22','30'] },
    seconds: { min: 0.1, max: 10,  step: 0.1, ticks: ['0.1s','2.5s','5s','7.5s','10s'] },
  },
  miss_reset_frames: {
    frames:  { min: 1,  max: 60,   step: 1,   ticks: ['1','15','30','45','60'] },
    seconds: { min: 0.1, max: 5,   step: 0.1, ticks: ['0.1s','1.25s','2.5s','3.75s','5s'] },
  },
  alert_hold_frames: {
    frames:  { min: 1,  max: 500,  step: 1,   ticks: ['1','125','250','375','500'] },
    seconds: { min: 0.1, max: 60,  step: 0.5, ticks: ['0.1s','15s','30s','45s','60s'] },
  },
  incident_cooldown_sec: {
    seconds: { min: 0,  max: 3600, step: 30,  ticks: ['0','900','1800','2700','3600'] },
    minutes: { min: 0,  max: 60,   step: 1,   ticks: ['0','15','30','45','60'] },
  },
};

function _smToBackend(field, displayVal) {
  const unit = _smUnits[field];
  const v    = parseFloat(displayVal);
  if (field === 'incident_cooldown_sec') {
    return unit === 'minutes' ? Math.round(v * 60) : Math.round(v);
  }
  if (unit === 'seconds') return Math.max(1, Math.round(v * SM_FPS));
  return Math.round(v);
}

function _smToDisplay(field, backendVal) {
  const unit = _smUnits[field];
  const v    = parseFloat(backendVal);
  if (field === 'incident_cooldown_sec') {
    return unit === 'minutes' ? +(v / 60).toFixed(2) : v;
  }
  if (unit === 'seconds') return +(v / SM_FPS).toFixed(2);
  return Math.round(v);
}

function _smBadgeText(field, displayVal) {
  const unit = _smUnits[field];
  const v    = parseFloat(displayVal);
  if (field === 'incident_cooldown_sec') {
    if (v === 0)           return '0 (off)';
    if (unit === 'minutes') return v === 1 ? '1 min' : `${v} min`;
    if (v < 60)            return `${v}s`;
    const m = Math.floor(v / 60), s = Math.round(v % 60);
    return s === 0 ? `${m} min` : `${m}m ${s}s`;
  }
  if (unit === 'frames')  return `${Math.round(v)} fr`;
  if (unit === 'seconds') return v === Math.round(v) ? `${v}s` : `${v}s`;
  return String(v);
}

function _smApplyConfig(field) {
  const unit = _smUnits[field];
  const cfg  = _smConfig[field][unit];
  const el   = document.getElementById(field);
  if (!el || !cfg) return;

  const currentBackend = _pending[field] ?? _original[field] ?? parseInt(el.dataset.backend || el.value);

  el.min  = cfg.min;
  el.max  = cfg.max;
  el.step = cfg.step;

  const newDisplay = _smToDisplay(field, currentBackend);
  const clamped = Math.min(cfg.max, Math.max(cfg.min, newDisplay));
  el.value = clamped;
  el.dataset.backend = currentBackend;
  _updateSliderFill(el);

  const ticksEl = document.getElementById(`ticks_${field}`);
  if (ticksEl && cfg.ticks) {
    ticksEl.innerHTML = cfg.ticks.map(t => `<span>${t}</span>`).join('');
  }

  _setBadge(field, _smBadgeText(field, clamped));

  const allBtns = document.querySelectorAll(`[id^="unit_${field}_"]`);
  allBtns.forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`unit_${field}_${unit}`);
  if (activeBtn) activeBtn.classList.add('active');
}

function setSmUnit(field, unit) {
  _smUnits[field] = unit;
  _smApplyConfig(field);
}

function onSmSlider(field, rawVal) {
  const displayVal  = parseFloat(rawVal);
  const backendVal  = _smToBackend(field, displayVal);
  const el          = document.getElementById(field);
  if (el) el.dataset.backend = backendVal;
  _setBadge(field, _smBadgeText(field, displayVal));
  _updateSliderFill(document.getElementById(field));
  markDirty(field, backendVal);
}

function _applySmField(field, backendVal) {
  const el = document.getElementById(field);
  if (!el) return;
  el.dataset.backend = backendVal;
  const displayVal = _smToDisplay(field, backendVal);
  const cfg  = _smConfig[field][_smUnits[field]];
  const clamped = cfg ? Math.min(cfg.max, Math.max(cfg.min, displayVal)) : displayVal;
  el.value = clamped;
  _updateSliderFill(el);
  _setBadge(field, _smBadgeText(field, clamped));
}

function setSlider(id, val, isInt = false, isCooldown = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  _updateSliderFill(el);
  _setBadge(id, isCooldown ? _fmtCooldown(val) : isInt ? String(Math.round(val)) : Number(val).toFixed(2));
}

function setNumber(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function applySystemInfo(sys) {
  if (!sys) return;
  const dev = document.getElementById('sysDevice');
  const hw  = document.getElementById('sysHardware');
  if (dev) dev.textContent = sys.device || '—';
  if (hw)  hw.textContent  = sys.gpu_name ? sys.gpu_name : sys.cpu_threads ? `${sys.cpu_threads} Threads` : '—';
}

function onSlider(key, rawVal, isInt = false) {
  const val = isInt ? parseInt(rawVal) : parseFloat(rawVal);
  _setBadge(key, isInt ? String(val) : val.toFixed(2));
  _updateSliderFill(document.getElementById(key));
  markDirty(key, val);
}

function onCooldown(rawVal) {
  const val = parseInt(rawVal);
  _setBadge('incident_cooldown_sec', _fmtCooldown(val));
  _updateSliderFill(document.getElementById('incident_cooldown_sec'));
  markDirty('incident_cooldown_sec', val);
}

function _updateSliderFill(el) {
  if (!el) return;
  const pct = ((parseFloat(el.value) - parseFloat(el.min)) / (parseFloat(el.max) - parseFloat(el.min)) * 100).toFixed(1);
  el.style.setProperty('--pct', pct + '%');
}

function onNumber(key, rawVal) {
  const val = parseInt(rawVal);
  if (!isNaN(val)) markDirty(key, val);
}

function setResGpu(w, h) { setNumber('infer_w_gpu', w); setNumber('infer_h_gpu', h); markDirty('infer_w_gpu', w); markDirty('infer_h_gpu', h); }
function setResCpu(w, h) { setNumber('infer_w_cpu', w); setNumber('infer_h_cpu', h); markDirty('infer_w_cpu', w); markDirty('infer_h_cpu', h); }

function markDirty(key, val) {
  _pending[key] = val; _dirty = true;
  updateSaveBtn(); showUnsavedBar(true);
}

function updateSaveBtn() {
  const btn = document.getElementById('btnSaveAll');
  if (btn) btn.disabled = !_dirty;
}

function showUnsavedBar(show) {
  const bar = document.getElementById('unsavedBar');
  if (bar) show ? bar.classList.remove('hidden') : bar.classList.add('hidden');
}

async function saveAll() {
  if (!_dirty || !Object.keys(_pending).length) return;
  const btn = document.getElementById('btnSaveAll');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  try {
    const res  = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_pending) });
    const data = await res.json();
    if (data.success) {
      _original = { ...data.settings }; _pending = {}; _dirty = false;
      applyToUI(data.settings); showUnsavedBar(false);
      showToast('Settings applied — detection updated immediately.', 'success');
    } else {
      showToast(data.message || 'Save failed', 'error');
    }
  } catch (e) { showToast('Network error saving settings', 'error'); }
  finally {
    updateSaveBtn();
    if (btn) btn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" width="14" height="14"><path d="M3 10l5 5 9-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Apply Changes`;
  }
}

async function resetAll() {
  if (!confirm('Reset all settings to factory defaults?')) return;
  try {
    const res  = await fetch('/api/settings/reset', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      _original = { ...data.settings }; _pending = {}; _dirty = false;
      applyToUI(data.settings); showUnsavedBar(false); updateSaveBtn();
      showToast('Settings reset to defaults.', 'info');
    } else { showToast('Reset failed', 'error'); }
  } catch (e) { showToast('Network error', 'error'); }
}

function discardChanges() {
  _pending = {}; _dirty = false;
  applyToUI(_original); showUnsavedBar(false); updateSaveBtn();
  showToast('Changes discarded.', 'info');
}

function _setBadge(key, text) {
  const el = document.getElementById(`badge_${key}`);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('changed'); void el.offsetWidth; el.classList.add('changed');
}

function _fmtCooldown(sec) {
  sec = parseInt(sec);
  if (sec === 0)  return '0s (off)';
  if (sec < 60)   return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.velion-slider').forEach(el => _updateSliderFill(el));
});

let _allModels = [];

async function loadModels() {
  try {
    const res  = await fetch('/api/models');
    const data = await res.json();
    if (!data.success) return;
    _allModels = data.models;
    renderModelGrid();
    updateModelStatusBanner();
    _loadAllClassTags();
  } catch (e) { console.warn('Could not load model list', e); }
}

function renderModelGrid() {
  const grid = document.getElementById('modelGrid');
  if (!grid) return;
  if (!_allModels.length) {
    grid.innerHTML = `<div class="model-empty">
      <svg viewBox="0 0 24 24" fill="none" style="width:36px;height:36px;opacity:.3">
        <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/>
        <path d="M9 12h6M12 9v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>No models yet — upload a <strong>.pt</strong> or <strong>.onnx</strong> file to get started.</span>
    </div>`;
    return;
  }
  grid.innerHTML = _allModels.map(m => _modelCard(m)).join('');
}

function _modelCard(m) {
  const isActive  = m.active || false;
  const available = m.available;
  const idx = _allModels.indexOf(m);

  const fmtBg     = m.format === 'ONNX' ? 'rgba(34,211,238,.08)' : 'rgba(245,158,11,.08)';
  const fmtColor  = m.format === 'ONNX' ? 'var(--cyan)' : 'var(--amber)';
  const fmtBorder = m.format === 'ONNX' ? 'rgba(34,211,238,.2)' : 'rgba(245,158,11,.2)';

  let classTags = '';
  if (m.configured && m.class_count > 0) {
    classTags = `<div class="model-class-tags" id="class-tags-${_esc(m.filename)}">
      <span style="font-family:var(--font-mono);font-size:.62rem;color:var(--text-muted);">Loading…</span>
    </div>`;
  } else if (!m.configured) {
    classTags = `<div class="model-class-tags">
      <span class="class-tag class-tag--none">Not configured — click Configure Classes</span>
    </div>`;
  }

  const alertLabelBadge = m.active && m.alert_label
    ? `<span style="font-family:var(--font-mono);font-size:.6rem;padding:2px 8px;border-radius:99px;background:rgba(232,69,69,.1);border:1px solid rgba(232,69,69,.25);color:#ff7070;">${m.alert_label}</span>`
    : '';

  const actions = available ? `
    <div class="model-actions">
      <button class="model-btn model-btn--activate ${isActive ? 'is-active' : ''}"
              onclick="toggleModelActive(${idx})"
              id="activate-btn-${_esc(m.filename)}">
        ${isActive
          ? `Active`
          : `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v3M8 10.5h.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Inactive`
        }
      </button>
      <button class="model-btn model-btn--config"
              onclick="openClassConfig(_allModels[${idx}].filename)">
        <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
          <path d="M8 1.5a.75.75 0 0 1 .75.75v.88a4.5 4.5 0 0 1 1.41.59l.62-.62a.75.75 0 1 1 1.06 1.06l-.62.62c.27.44.47.93.59 1.41h.88a.75.75 0 0 1 0 1.5h-.88a4.5 4.5 0 0 1-.59 1.41l.62.62a.75.75 0 1 1-1.06 1.06l-.62-.62a4.5 4.5 0 0 1-1.41.59v.88a.75.75 0 0 1-1.5 0v-.88a4.5 4.5 0 0 1-1.41-.59l-.62.62a.75.75 0 1 1-1.06-1.06l.62-.62A4.5 4.5 0 0 1 3.62 8.75H2.75a.75.75 0 0 1 0-1.5h.87a4.5 4.5 0 0 1 .59-1.41l-.62-.62a.75.75 0 1 1 1.06-1.06l.62.62a4.5 4.5 0 0 1 1.41-.59V2.25A.75.75 0 0 1 8 1.5zM8 6a2 2 0 1 0 0 4A2 2 0 0 0 8 6z"
                fill="currentColor"/>
        </svg>
        Configure Classes
      </button>
      <button class="model-delete-btn" onclick="deleteModel(${idx})" title="Delete">
        <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
          <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"
            stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>` : `
    <div class="model-unavailable-notice">
      <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M8 5v3M8 10.5h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      File not found in <code>models/</code> folder
    </div>`;

  return `
    <div class="model-card ${isActive ? 'model-card--active' : ''} ${!available ? 'model-card--unavailable' : ''}"
         id="mcard-${_esc(m.filename)}">
      ${isActive ? `<div class="model-active-ribbon">● RUNNING</div>` : ''}
      <div class="model-card-head ${isActive ? 'model-card-head--ribbon' : ''}">
        <div class="model-icon" style="color:var(--cyan);border-color:rgba(34,211,238,.2);background:rgba(34,211,238,.08);">
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="2" y="7" width="16" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/>
            <path d="M18 10l4-2v8l-4-2" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <circle cx="10" cy="12" r="2.5" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </div>
        <div class="model-card-title-area">
          <div class="model-display-name">${m.display_name || m.filename}</div>
          <div class="model-filename-row">
            <span class="model-filename">${m.filename}</span>
            <span class="model-user-badge">
              <svg viewBox="0 0 12 12" fill="none" width="9" height="9">
                <path d="M6 1v6M3 4l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M1 9h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
              Uploaded
            </span>
            ${alertLabelBadge}
          </div>
        </div>
      </div>
      <p class="model-desc">${m.description || '—'}</p>
      <div class="model-specs">
        <div class="model-spec">
          <span class="spec-label">Format</span>
          <span class="spec-val" style="background:${fmtBg};border:1px solid ${fmtBorder};color:${fmtColor};">${m.format || '—'}</span>
        </div>
        <div class="model-spec">
          <span class="spec-label">Architecture</span>
          <span class="spec-val">${m.architecture || '—'}</span>
        </div>
        <div class="model-spec">
          <span class="spec-label">Size</span>
          <span class="spec-val">${m.size_mb != null ? m.size_mb + ' MB' : '—'}</span>
        </div>
        <div class="model-spec">
          <span class="spec-label">Classes</span>
          <span class="spec-val">${m.class_count > 0 ? m.class_count + ' configured' : 'not set'}</span>
        </div>
      </div>
      ${classTags}
      ${actions}
    </div>`;
}

function _esc(s) { return (s || '').replace(/['"<>&\s]/g, '_'); }

async function _loadCardClassTags(filename) {
  const container = document.getElementById(`class-tags-${_esc(filename)}`);
  if (!container) return;
  try {
    const res  = await fetch(`/api/models/class-config/${encodeURIComponent(filename)}`);
    const data = await res.json();
    if (!data.success || !data.config || !data.config.classes) return;
    const entries = Object.entries(data.config.classes);
    if (!entries.length) { container.innerHTML = `<span class="class-tag class-tag--none">No classes configured</span>`; return; }

    const SHOW = 3;
    const visible = entries.slice(0, SHOW);
    const hidden  = entries.slice(SHOW);

    const tagHtml = visible.map(([cid, cc]) => {
      const name = cc.name || `cls_${cid}`;
      if (cc.alert && cc.draw)  return `<span class="class-tag class-tag--both" title="Draw + Alert"><span class="class-tag-dot" style="background:var(--cyan);"></span><span class="class-tag-dot" style="background:#e84545;margin-left:2px;"></span>${name}</span>`;
      if (cc.alert)             return `<span class="class-tag class-tag--alert" title="Triggers Alert"><span class="class-tag-dot" style="background:#e84545;"></span>${name}</span>`;
      if (cc.draw)              return `<span class="class-tag class-tag--draw" title="Draw only"><span class="class-tag-dot" style="background:var(--cyan);"></span>${name}</span>`;
      return `<span class="class-tag class-tag--none" title="Hidden"><span class="class-tag-dot" style="background:#888;"></span>${name}</span>`;
    }).join('');

    let overflowHtml = '';
    if (hidden.length > 0) {
      const tooltipItems = hidden.map(([cid, cc]) => {
        const name = cc.name || `cls_${cid}`;
        let dot = '#888';
        if (cc.alert && cc.draw) dot = 'var(--cyan)';
        else if (cc.alert)       dot = '#e84545';
        else if (cc.draw)        dot = 'var(--cyan)';
        return `<span class="ct-overflow-item"><span class="class-tag-dot" style="background:${dot};flex-shrink:0;"></span>${name}</span>`;
      }).join('');
      overflowHtml = `<span class="class-tag class-tag--none ct-overflow-pill"
        data-tooltip="${tooltipItems.replace(/"/g, '&quot;')}"
        onmouseenter="_ctShowTooltip(this)"
        onmouseleave="_ctScheduleHide()">+${hidden.length} more</span>`;
    }

    container.innerHTML = tagHtml + overflowHtml;
  } catch (_) {}
}

function _loadAllClassTags() {
  _allModels.filter(m => m.configured && m.class_count > 0).forEach(m => _loadCardClassTags(m.filename));
}

async function toggleModelActive(idx) {
  const model = _allModels[idx];
  if (!model) return;
  if (!model.configured) {
    showToast('Configure classes first before activating.', 'warning');
    openClassConfig(model.filename);
    return;
  }
  const newActive = !model.active;
  try {
    const cfgRes  = await fetch(`/api/models/class-config/${encodeURIComponent(model.filename)}`);
    const cfgData = await cfgRes.json();
    const current = cfgData.config || {};
    current.active = newActive;
    const res  = await fetch(`/api/models/class-config/${encodeURIComponent(model.filename)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current),
    });
    const data = await res.json();
    if (data.success) {
      model.active = newActive;
      const card = document.getElementById(`mcard-${_esc(model.filename)}`);
      if (card) {
        const d = document.createElement('div');
        d.innerHTML = _modelCard(model);
        card.replaceWith(d.firstElementChild);
        _loadCardClassTags(model.filename);
      }
      updateModelStatusBanner();
      showToast(newActive ? `${model.display_name} is now active.` : `${model.display_name} deactivated.`, newActive ? 'success' : 'info');
    }
  } catch (e) { showToast('Network error', 'error'); }
}

let _deleteTargetIdx = null;

async function deleteModel(idx) {
  const model = _allModels[idx];
  if (!model) return;
  _deleteTargetIdx = idx;

  document.getElementById('deleteModalName').textContent = model.display_name || model.filename;
  document.getElementById('deleteModalFile').textContent = model.filename;

  const backdrop = document.getElementById('deleteModalBackdrop');
  backdrop.classList.remove('hidden');
  void backdrop.offsetWidth;
  backdrop.classList.add('visible');
}

function closeDeleteModal() {
  _deleteTargetIdx = null;
  const backdrop = document.getElementById('deleteModalBackdrop');
  backdrop.classList.remove('visible');
  setTimeout(() => backdrop.classList.add('hidden'), 280);
}

async function confirmDelete() {
  if (_deleteTargetIdx === null) return;
  const model = _allModels[_deleteTargetIdx];
  if (!model) return;

  const btn     = document.getElementById('deleteConfirmBtn');
  const spinner = document.getElementById('deleteSpinner');
  const icon    = document.getElementById('deleteIcon');
  if (btn)     btn.disabled = true;
  if (spinner) spinner.style.display = 'block';
  if (icon)    icon.style.display = 'none';

  try {
    const res  = await fetch(`/api/models/delete/${encodeURIComponent(model.filename)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      closeDeleteModal();
      showToast(data.message, 'info');
      await loadModels();
    } else {
      showToast(data.message || 'Delete failed', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  } finally {
    if (btn)     btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (icon)    icon.style.display = 'block';
  }
}
function ccToggleAll(type) {
  const list = document.getElementById('ccClassList');
  if (!list) return;

  const checkboxes = list.querySelectorAll(
    type === 'draw' ? '.draw-check' : '.alert-check'
  );

  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => {
    cb.checked = !allChecked;
    if (type === 'alert') ccOnAlertChange(cb);
  });
}
function updateModelStatusBanner() {
  const banner = document.getElementById('modelStatusBanner');
  if (!banner) return;

  const active = _allModels.filter(m => m.active);

  if (!active.length) {
    banner.innerHTML = `
      <div class="sys-no-models">
        <span class="sys-no-models-dot"></span>
        No models running
      </div>`;
    return;
  }

  const SHOW = 1; 
  const visible = active.slice(0, SHOW);
  const hidden  = active.slice(SHOW);

  let html = '';

  visible.forEach(m => {
    const name = m.display_name || m.filename;
    html += `
      <div class="sys-model-row">
        <span class="sys-model-dot"></span>
        ${name}
      </div>`;
  });

  if (hidden.length > 0) {
    const tooltipItems = hidden.map(m => {
      const name = m.display_name || m.filename;
      return `<div class="sys-tooltip-item"><span class="sys-tooltip-dot"></span>${name}</div>`;
    }).join('');

    html += `
      <div class="sys-more-wrap">
        <div class="sys-more-pill">
          <span class="sys-more-pill-dots">
            <span></span><span></span><span></span>
          </span>
          ${hidden.length} more
        </div>
        <div class="sys-more-tooltip">
          ${tooltipItems}
        </div>
      </div>`;
  }

  banner.innerHTML = html;
}

let _uploadPendingFile = null;

function openUploadModal() { document.getElementById('modelFileInput').click(); }

function _wireUploadModal() {
  const fi = document.getElementById('modelFileInput');
  if (fi) {
    fi.addEventListener('change', e => {
      if (!e.target.files.length) return;
      const file = e.target.files[0]; fi.value = ''; _openMetaModal(file);
    });
  }
  const archCheck = document.getElementById('archKnown');
  const archField = document.getElementById('archFieldWrap');
  if (archCheck && archField) {
    archCheck.addEventListener('change', () => {
      archField.classList.toggle('hidden', !archCheck.checked);
      if (!archCheck.checked) document.getElementById('fieldArchitecture').value = '';
    });
  }
  const descEl = document.getElementById('fieldDescription');
  const descCounter = document.getElementById('descCounter');
  if (descEl && descCounter) {
    descEl.addEventListener('input', () => {
      const len = descEl.value.length;
      descCounter.textContent = `${len}/200`;
      descCounter.style.color = len > 180 ? 'var(--accent)' : 'var(--text-muted)';
    });
  }
  const backdrop = document.getElementById('uploadModalBackdrop');
  if (backdrop) backdrop.addEventListener('click', e => { if (e.target === backdrop) closeUploadModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const up = document.getElementById('uploadModalBackdrop');
      const cc = document.getElementById('classConfigBackdrop');
      if (up && !up.classList.contains('hidden')) closeUploadModal();
      if (cc && !cc.classList.contains('hidden')) closeClassConfig();
    }
  });
}

function _wireDropZone() {
  const zone = document.getElementById('modelDropZone');
  if (!zone) return;
  zone.addEventListener('click', e => { if (e.target.closest('.mdz-link')) document.getElementById('modelFileInput').click(); });
  zone.addEventListener('dragover', ev => { ev.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', ev => { ev.preventDefault(); zone.classList.remove('drag-over'); if (ev.dataTransfer.files[0]) _openMetaModal(ev.dataTransfer.files[0]); });
}

function _openMetaModal(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pt', 'onnx'].includes(ext)) { showToast(`Only .pt and .onnx files are supported.`, 'error'); return; }
  _uploadPendingFile = file;
  document.getElementById('modalFilename').textContent = file.name;
  document.getElementById('modalFilesize').textContent = _fmtBytes(file.size);
  document.getElementById('modalFileext').textContent  = ext.toUpperCase();
  const nameEl = document.getElementById('fieldDisplayName');
  if (nameEl && !nameEl.value) nameEl.value = file.name.replace(/\.(pt|onnx)$/i, '').replace(/[_\-]/g, ' ').trim();
  _resetModalForm();
  const backdrop = document.getElementById('uploadModalBackdrop');
  backdrop.classList.remove('hidden'); void backdrop.offsetWidth; backdrop.classList.add('visible');
  setTimeout(() => nameEl && nameEl.focus(), 120);
}

function closeUploadModal() {
  _uploadPendingFile = null;
  const backdrop = document.getElementById('uploadModalBackdrop');
  backdrop.classList.remove('visible');
  setTimeout(() => backdrop.classList.add('hidden'), 280);
  _resetModalForm();
}

function _resetModalForm() {
  ['fieldDisplayName','fieldDescription','fieldArchitecture'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const archCheck = document.getElementById('archKnown'); if (archCheck) archCheck.checked = false;
  const archWrap  = document.getElementById('archFieldWrap'); if (archWrap) archWrap.classList.add('hidden');
  const counter   = document.getElementById('descCounter'); if (counter) { counter.textContent = '0/200'; counter.style.color = 'var(--text-muted)'; }
  _setModalError(''); _setModalUploading(false);
}

function _setModalError(msg) {
  const el = document.getElementById('modalError'); if (!el) return;
  el.textContent = msg; el.style.display = msg ? 'block' : 'none';
}

function _setModalUploading(on) {
  const btn     = document.getElementById('modalSubmitBtn');
  const spinner = document.getElementById('modalSpinner');
  const btnTxt  = document.getElementById('modalBtnText');
  if (btn)     btn.disabled = on;
  if (spinner) spinner.style.display = on ? 'block' : 'none';
  if (btnTxt)  btnTxt.textContent = on ? 'Uploading…' : 'Upload & Configure Classes →';
}

async function submitModelUpload() {
  if (!_uploadPendingFile) return;
  const displayName  = (document.getElementById('fieldDisplayName')?.value  || '').trim();
  const description  = (document.getElementById('fieldDescription')?.value  || '').trim();
  const archKnown    = document.getElementById('archKnown')?.checked;
  const architecture = archKnown ? (document.getElementById('fieldArchitecture')?.value || '').trim() : '';
  if (!displayName) { _setModalError('Model name is required.'); return; }
  if (!description) { _setModalError('Description is required.'); return; }
  _setModalError(''); _setModalUploading(true);
  const formData = new FormData();
  formData.append('model',        _uploadPendingFile);
  formData.append('display_name', displayName);
  formData.append('description',  description);
  formData.append('role',         'custom');
  formData.append('architecture', architecture || 'Unknown');
  try {
    const res  = await fetch('/api/models/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      const filename = data.filename;
      closeUploadModal();
      await loadModels();
      setTimeout(() => openClassConfig(filename, true), 350);
      showToast(data.message, 'success');
    } else {
      _setModalError(data.message || 'Upload failed.');
    }
  } catch (e) {
    _setModalError('Network error — please try again.');
  } finally {
    _setModalUploading(false);
  }
}

(function () {
  const s = document.createElement('style');
  s.textContent = `#toastContainer { z-index: 99999 !important; }`;
  document.head.appendChild(s);
})();

let _ccFilename = null;
let _ccIsNew    = false;
let _ccRowId    = 0;

function _resolveFilename(filenameOrEscaped) {
  let model = _allModels.find(m => m.filename === filenameOrEscaped);
  if (model) return model.filename;
  model = _allModels.find(m => _esc(m.filename) === filenameOrEscaped);
  if (model) return model.filename;
  return filenameOrEscaped;
}

function _wireClassConfigModal() {
  const backdrop = document.getElementById('classConfigBackdrop');
  if (backdrop) backdrop.addEventListener('click', e => { if (e.target === backdrop) closeClassConfig(); });

  const activeToggle = document.getElementById('ccActive');
  if (activeToggle) {
    activeToggle.addEventListener('change', () => {
      const lbl  = document.getElementById('ccActiveLabel');
      const desc = document.getElementById('ccActiveDesc');
      if (lbl)  lbl.textContent  = activeToggle.checked ? 'Active'   : 'Inactive';
      if (desc) desc.textContent = activeToggle.checked ? 'Model runs on every frame' : 'Model will not run on streams or video';
    });
  }
}

async function openClassConfig(filename, isNew = false) {
  _ccFilename = filename;
  _ccIsNew    = isNew;
  _ccRowId    = 0;

  const scanState = document.getElementById('ccScanState');
  const body      = document.getElementById('ccBody');
  const noClasses = document.getElementById('ccNoClasses');
  const list      = document.getElementById('ccClassList');

  if (list)      list.innerHTML = '';
  if (scanState) scanState.classList.remove('hidden');
  if (body)      body.classList.add('hidden');
  if (noClasses) noClasses.classList.add('hidden');

  const model = _allModels.find(m => m.filename === filename);
  const titleEl = document.getElementById('ccTitle');
  const subEl   = document.getElementById('ccSubtitle');
  if (titleEl) titleEl.textContent = model ? (model.display_name || filename) : filename;
  if (subEl)   subEl.textContent   = isNew
    ? 'Step 2 of 2 — define what to draw and what triggers alerts'
    : 'Edit class configuration';

  const backdrop = document.getElementById('classConfigBackdrop');
  backdrop.classList.remove('hidden');
  void backdrop.offsetWidth;
  backdrop.classList.add('visible');

  let existingConfig = { active: false, alert_label: 'Alert', classes: {} };
  try {
    const cfgRes  = await fetch(`/api/models/class-config/${encodeURIComponent(filename)}`);
    const cfgData = await cfgRes.json();
    if (cfgData.success && cfgData.config) existingConfig = cfgData.config;
    console.log('[CC] Loaded existing config:', existingConfig);
  } catch (err) {
    console.warn('[CC] Could not load existing config:', err);
  }

  const savedEntries   = Object.entries(existingConfig.classes || {});
  const hasRealClasses = savedEntries.length > 0 &&
                         savedEntries.some(([, c]) => c && typeof c === 'object' && (c.name || '').trim());

  console.log(`[CC] ${filename}: savedEntries=${savedEntries.length}, hasRealClasses=${hasRealClasses}`);

  let finalClasses = {};

  if (hasRealClasses) {
    finalClasses = existingConfig.classes;
    console.log('[CC] Using saved classes:', finalClasses);
  } else {
    const scanMsg = document.getElementById('ccScanMsg');
    if (scanMsg) scanMsg.textContent = 'Reading class names from model…';

    try {
      const url      = `/api/models/inspect/${encodeURIComponent(filename)}`;
      console.log('[CC] Fetching inspect:', url);
      const inspRes  = await fetch(url);
      const inspData = await inspRes.json();
      console.log('[CC] Inspect response:', inspData);

      if (inspData.success && inspData.classes) {
        for (const [id, name] of Object.entries(inspData.classes)) {
          const trimmed = (typeof name === 'string' ? name : String(name)).trim();
          if (trimmed) finalClasses[id] = { name: trimmed, draw: true, alert: false };
        }
      }

      if (Object.keys(finalClasses).length === 0) {
        console.warn('[CC] No classes from inspect. Warning:', inspData.warning);
        if (noClasses) noClasses.classList.remove('hidden');
      }
    } catch (err) {
      console.error('[CC] Inspect failed:', err);
      if (noClasses) noClasses.classList.remove('hidden');
    }
  }

  console.log('[CC] finalClasses to render:', finalClasses);

  const activeEl = document.getElementById('ccActive');
  const lblEl    = document.getElementById('ccAlertLabel');
  if (activeEl) {
    activeEl.checked = existingConfig.active || false;
    const lbl  = document.getElementById('ccActiveLabel');
    const desc = document.getElementById('ccActiveDesc');
    if (lbl)  lbl.textContent  = activeEl.checked ? 'Active'   : 'Inactive';
    if (desc) desc.textContent = activeEl.checked ? 'Model runs on every frame' : 'Model will not run on streams or video';
  }
  if (lblEl) lblEl.value = existingConfig.alert_label || 'Alert';

  const sorted = Object.entries(finalClasses).sort((a, b) => {
    const ai = parseInt(a[0]), bi = parseInt(b[0]);
    return (isNaN(ai) ? 9999 : ai) - (isNaN(bi) ? 9999 : bi);
  });

  console.log(`[CC] Building ${sorted.length} rows into #ccClassList`);

  sorted.forEach(([cid, ccfg]) => {
    const name  = typeof ccfg === 'string' ? ccfg  : (ccfg.name  || '');
    const draw  = typeof ccfg === 'string' ? true  : (ccfg.draw  !== false);
    const alert = typeof ccfg === 'string' ? false : (ccfg.alert === true);
    list.appendChild(_ccBuildRow(cid, name, draw, alert));
  });

  if (sorted.length === 0 && noClasses) noClasses.classList.remove('hidden');

  if (scanState) scanState.classList.add('hidden');
  if (body)      body.classList.remove('hidden');

  console.log(`[CC] Done. #ccClassList children: ${list.children.length}`);
}

function _ccBuildRow(cid, name, drawChecked, alertChecked) {
  _ccRowId++;
  const rid = _ccRowId;
  const row = document.createElement('div');
  row.className = `cc-row${alertChecked ? ' is-alert' : ''}`;
  row.dataset.cid = cid;
  row.dataset.rid = rid;
  row.innerHTML = `
    <span class="cc-id">${_escHtml(String(cid))}</span>
    <input class="cc-name-input" placeholder="class name" data-rid="${rid}" />
    <div class="cc-check">
      <input type="checkbox" class="draw-check" ${drawChecked ? 'checked' : ''}
             data-rid="${rid}" title="Draw bounding box"
             onchange="ccOnDrawChange(this)" />
    </div>
    <div class="cc-check">
      <input type="checkbox" class="alert-check" ${alertChecked ? 'checked' : ''}
             data-rid="${rid}" title="Trigger alert"
             onchange="ccOnAlertChange(this)" />
    </div>
    <button class="cc-del-btn" onclick="ccDeleteRow(this)" title="Remove">
      <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    </button>`;
  row.querySelector('.cc-name-input').value = name;
  return row;
}

function ccOnAlertChange(cb) {
  const row = cb.closest('.cc-row');
  if (row) row.classList.toggle('is-alert', cb.checked);
}
function ccOnDrawChange(_cb) {  }

function ccAddManualRow() {
  const list      = document.getElementById('ccClassList');
  const noClasses = document.getElementById('ccNoClasses');
  if (!list) return;
  if (noClasses) noClasses.classList.add('hidden');

  const existingIds = Array.from(list.querySelectorAll('.cc-row'))
    .map(r => parseInt(r.dataset.cid)).filter(n => !isNaN(n));
  const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 0;

  const row   = _ccBuildRow(String(nextId), '', true, false);
  list.appendChild(row);
  const input = row.querySelector('.cc-name-input');
  if (input) { input.focus(); input.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function ccDeleteRow(btn) {
  const row = btn.closest('.cc-row');
  if (!row) return;
  row.style.transition = 'opacity .15s, transform .15s';
  row.style.opacity    = '0';
  row.style.transform  = 'translateX(6px)';
  setTimeout(() => row.remove(), 150);
}

function closeClassConfig() {
  _ccFilename = null;
  const backdrop = document.getElementById('classConfigBackdrop');
  backdrop.classList.remove('visible');
  setTimeout(() => backdrop.classList.add('hidden'), 280);
}

async function saveClassConfig() {
  if (!_ccFilename) return;

  const activeEl = document.getElementById('ccActive');
  const lblEl    = document.getElementById('ccAlertLabel');
  const list     = document.getElementById('ccClassList');

  const active      = activeEl?.checked || false;
  const alert_label = (lblEl?.value || 'Alert').trim() || 'Alert';
  const classes     = {};
  const rows        = list?.querySelectorAll('.cc-row') || [];
  let   valid       = true;

  rows.forEach(row => {
    const cid       = row.dataset.cid;
    const nameInput = row.querySelector('.cc-name-input');
    const drawCb    = row.querySelector('.draw-check');
    const alertCb   = row.querySelector('.alert-check');
    const name      = (nameInput?.value || '').trim();
    if (!name) { nameInput?.classList.add('error'); valid = false; return; }
    nameInput?.classList.remove('error');
    classes[cid] = { name, draw: drawCb?.checked || false, alert: alertCb?.checked || false };
  });

  if (!valid) {
    showToast('Please fill in all class names.', 'error');
    list?.querySelector('.cc-name-input.error')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const btn     = document.getElementById('ccSaveBtn');
  const spinner = document.getElementById('ccSaveSpinner');
  if (btn)     btn.disabled = true;
  if (spinner) spinner.style.display = 'block';

  try {
    const res  = await fetch(`/api/models/class-config/${encodeURIComponent(_ccFilename)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, alert_label, classes }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Class configuration saved.', 'success');
      closeClassConfig();
      await loadModels();
      _loadAllClassTags();
    } else {
      showToast(data.message || 'Save failed', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  } finally {
    if (btn)     btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
  }
}

function _escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtBytes(b) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

let _ctTooltipEl  = null;
let _ctHideTimer  = null;
let _ctActivePill = null;

function _ctShowTooltip(pill) {
  clearTimeout(_ctHideTimer);
  if (_ctActivePill === pill && _ctTooltipEl) return;

  _ctActivePill = pill;
  if (_ctTooltipEl) { _ctTooltipEl.remove(); _ctTooltipEl = null; }

  const el = document.createElement('div');
  el.id        = 'ctFloatingTooltip';
  el.className = 'ct-floating-tooltip';
  el.innerHTML = pill.dataset.tooltip;
  document.body.appendChild(el);
  _ctTooltipEl = el;

  const rect = pill.getBoundingClientRect();
  const gap  = 6;
  el.style.visibility = 'hidden';
  el.style.display    = 'flex';

  requestAnimationFrame(() => {
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = rect.left;
    let top  = rect.top - th - gap;
    if (top < 8) top = rect.bottom + gap;
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
    if (left < 8) left = 8;

    el.style.left       = left + 'px';
    el.style.top        = top  + 'px';
    el.style.visibility = 'visible';
    el.style.opacity    = '1';

    el._pillRect    = pill.getBoundingClientRect();
    el._tooltipRect = el.getBoundingClientRect();
  });
}

function _ctHideTooltip() {
  clearTimeout(_ctHideTimer);
  if (_ctTooltipEl) { _ctTooltipEl.remove(); _ctTooltipEl = null; }
  _ctActivePill = null;
}

function _ctScheduleHide() {
  _ctHideTimer = setTimeout(_ctHideTooltip, 120);
}

document.addEventListener('mousemove', e => {
  if (!_ctTooltipEl || !_ctActivePill) return;

  const px = e.clientX, py = e.clientY;
  const SLACK = 14;

  const tr = _ctTooltipEl.getBoundingClientRect();
  const inTip = px >= tr.left - SLACK && px <= tr.right  + SLACK &&
                py >= tr.top  - SLACK && py <= tr.bottom + SLACK;

  if (inTip) {
    clearTimeout(_ctHideTimer);
    _ctHideTimer = null;
    return;
  }

  const pr = _ctActivePill.getBoundingClientRect();
  const inPill = px >= pr.left - SLACK && px <= pr.right  + SLACK &&
                 py >= pr.top  - SLACK && py <= pr.bottom + SLACK;

  if (inPill) {
    clearTimeout(_ctHideTimer);
    _ctHideTimer = null;
  } else {
    if (!_ctHideTimer) {
      _ctHideTimer = setTimeout(() => {
        _ctHideTooltip();
        _ctHideTimer = null;
      }, 120);
    }
  }
});