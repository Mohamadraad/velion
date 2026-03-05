let selectedFile = null;
let selectedUrl  = null;
let activeTab    = 'local';

let currentJobId    = null;
let controlUrl      = null;
let statusPollTimer = null;
let totalFrames     = 0;
let isPaused        = false;
let isSeeking       = false;

document.addEventListener('DOMContentLoaded', async () => {
  const savedJobId = sessionStorage.getItem('activeJobId');
  if (!savedJobId) return;

  try {
    const data = await apiCall(`/api/analysis-status/${savedJobId}`);
    if (!data.success) {
      sessionStorage.removeItem('activeJobId');
      return;
    }

    currentJobId = savedJobId;
    controlUrl   = `/api/analysis-control/${savedJobId}`;

    const feedUrl   = `/analysis-feed/${savedJobId}`;
    const statusUrl = `/api/analysis-status/${savedJobId}`;

    if (data.state === 'done') {
      hideUploadSection();
      startMjpegFeed(feedUrl);
      onAnalysisDone({
        duration:      formatTime(Math.floor((data.total_frames || 0) / (data.fps || 25))),
        frames:        data.total_frames || 0,
        incidentCount: data.incident_count || 0,
        jobId:         savedJobId,
      });
      sessionStorage.removeItem('activeJobId');

    } else if (data.state === 'running' || data.state === 'paused') {
      hideUploadSection();
      startMjpegFeed(feedUrl);
      startStatusPolling(statusUrl);
      document.getElementById('resultsStatus').textContent = 'Analyzing';

      if (data.state === 'paused') {
        isPaused = true;
        setPlayPauseIcon(true);
        document.getElementById('vpLabel').textContent = 'Paused';
      }

      showToast('Analysis resumed from where you left off.', 'info');
    } else {
      sessionStorage.removeItem('activeJobId');
    }

  } catch (_) {
    sessionStorage.removeItem('activeJobId');
  }
});

function hideUploadSection() {
  const uploadSection = document.querySelector('.upload-section');
  if (!uploadSection) return;

  uploadSection.innerHTML = `
    <div style="
      display: flex; flex-direction: column; align-items: flex-start;
      gap: 16px; padding: 24px;
      border: 1px solid var(--border); border-radius: 14px;
      background: var(--surface, rgba(255,255,255,.03));
    ">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="
          width:10px; height:10px; border-radius:50%;
          background:#3b82f6; flex-shrink:0;
          animation: pulse 1.2s ease-in-out infinite;
        "></div>
        <span style="font-family:var(--font-mono); font-size:0.85rem; color:var(--text-primary);">
          Analysis in progress
        </span>
      </div>
      <p style="font-size:0.78rem; color:var(--text-muted); font-family:var(--font-mono); margin:0;">
        Your video is being analyzed on the server. You can navigate freely — it will keep running.
      </p>
      <button
        onclick="stopAndReset()"
        style="
          padding: 8px 18px; border-radius: 8px;
          border: 1px solid var(--border); background: transparent;
          color: var(--text-muted); font-size: 0.78rem;
          font-family: var(--font-mono); cursor: pointer;
          transition: all 0.15s ease;
        "
        onmouseover="this.style.color='var(--text-primary)'; this.style.borderColor='var(--text-muted)';"
        onmouseout="this.style.color='var(--text-muted)'; this.style.borderColor='var(--border)';"
      >
        ✕ Stop &amp; Start New Analysis
      </button>
    </div>
  `;
}

function showUploadSection() {
  window.location.reload();
}

function stopAndReset() {
  resetResultsPanel();
  showUploadSection();
}

function switchTab(tab) {
  activeTab = tab;
  document.getElementById('tabLocal').classList.toggle('active', tab === 'local');
  document.getElementById('tabUrl').classList.toggle('active',   tab === 'url');
  document.getElementById('panelLocal').classList.toggle('hidden', tab !== 'local');
  document.getElementById('panelUrl').classList.toggle('hidden',   tab !== 'url');
  updateAnalyzeBtn();
}

const fileInput = document.getElementById('fileInput');
const dropzone  = document.getElementById('dropzone');

if (fileInput) {
  fileInput.addEventListener('change', e => {
    if (e.target.files.length > 0) handleFileSelected(e.target.files[0]);
  });
}

if (dropzone) {
  dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]);
  });
}

function handleFileSelected(file) {
  const allowed = ['video/mp4','video/avi','video/quicktime','video/x-matroska','video/webm','video/x-msvideo'];
  if (!allowed.includes(file.type) && !/\.(mp4|avi|mov|mkv|webm)$/i.test(file.name)) {
    showToast('Unsupported format. Use MP4, AVI, MOV, MKV, or WEBM.', 'error'); return;
  }
  if (file.size > 500 * 1024 * 1024) { showToast('File exceeds 500MB.', 'error'); return; }

  selectedFile = file;
  document.getElementById('dropzoneInner').classList.add('hidden');
  document.getElementById('fileSelected').classList.remove('hidden');
  document.getElementById('selectedFileName').textContent = file.name;
  document.getElementById('selectedFileSize').textContent = formatBytes(file.size);
  updateAnalyzeBtn();
  showToast(`${file.name} ready.`, 'success');
}

function removeSelectedFile() {
  selectedFile = null;
  document.getElementById('fileSelected').classList.add('hidden');
  document.getElementById('dropzoneInner').classList.remove('hidden');
  if (fileInput) fileInput.value = '';
  updateAnalyzeBtn();
}

const VIDEO_EXT  = /\.(mp4|avi|mov|mkv|webm)(\?.*)?$/i;
const VIDEO_PATH = /\/(video|videos|media|stream|clip|footage)/i;

function handleUrlInput(value) {
  const v = value.trim();
  document.getElementById('btnUrlClear').classList.toggle('hidden', !v);

  if (!v) {
    selectedUrl = null;
    document.getElementById('urlPreview').classList.add('hidden');
    updateAnalyzeBtn(); return;
  }

  if (isValidVideoUrl(v)) {
    selectedUrl = v;
    const ext = (v.match(/\.(mp4|avi|mov|mkv|webm)(\?|#|$)/i) || [])[1];
    document.getElementById('urlPreview').classList.remove('hidden');
    document.getElementById('urlPreviewText').textContent  = v;
    document.getElementById('urlPreviewBadge').textContent = ext ? ext.toUpperCase() : 'VIDEO';
  } else {
    selectedUrl = null;
    document.getElementById('urlPreview').classList.add('hidden');
  }
  updateAnalyzeBtn();
}

function isValidVideoUrl(url) {
  try {
    const u = new URL(url);
    if (!['http:','https:'].includes(u.protocol)) return false;
    return VIDEO_EXT.test(u.pathname) || VIDEO_PATH.test(u.pathname);
  } catch { return false; }
}

function clearUrl() {
  const inp = document.getElementById('videoUrlInput');
  if (inp) inp.value = '';
  handleUrlInput('');
}

function updateAnalyzeBtn() {
  const btn = document.getElementById('btnAnalyze');
  if (btn) btn.disabled = activeTab === 'local' ? !selectedFile : !selectedUrl;
}

async function analyzeVideo() {
  const isUrl = activeTab === 'url';
  if (isUrl && !selectedUrl)  { showToast('No URL entered.',   'error'); return; }
  if (!isUrl && !selectedFile){ showToast('No file selected.', 'error'); return; }

  const progressDiv = document.getElementById('uploadProgress');
  const analyzeBtn  = document.getElementById('btnAnalyze');

  analyzeBtn.disabled    = true;
  analyzeBtn.textContent = isUrl ? 'Downloading...' : 'Uploading...';
  progressDiv.classList.remove('hidden');
  document.getElementById('resultsEmpty').classList.add('hidden');
  hideDownloadBanner();

  try {
    let result;

    if (isUrl) {
      document.getElementById('progressLabel').textContent   = 'Downloading video...';
      document.getElementById('progressFill').style.width    = '30%';
      document.getElementById('progressPercent').textContent = '—';

      const resp = await fetch('/api/upload-video-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: selectedUrl }),
      });
      animateProgressTo(95, 8000);
      result = await resp.json();

    } else {
      const formData = new FormData();
      formData.append('video', selectedFile);
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          document.getElementById('progressFill').style.width    = `${pct}%`;
          document.getElementById('progressPercent').textContent = `${pct}%`;
          document.getElementById('progressLabel').textContent   = 'Uploading...';
        }
      });
      result = await new Promise((res, rej) => {
        xhr.open('POST', '/api/upload-video');
        xhr.onload  = () => res(JSON.parse(xhr.responseText));
        xhr.onerror = () => rej(new Error('Upload failed'));
        xhr.send(formData);
      });
    }

    progressDiv.classList.add('hidden');

    if (!result.success) {
      showToast(result.message || 'Upload failed.', 'error');
      document.getElementById('resultsEmpty').classList.remove('hidden');
      return;
    }

    currentJobId = result.job_id;
    controlUrl   = result.control_url;

    sessionStorage.setItem('activeJobId', currentJobId);

    startMjpegFeed(result.feed_url);
    startStatusPolling(result.status_url);

    addToRecent(isUrl ? selectedUrl : selectedFile.name, isUrl ? 'url' : 'file');
    document.getElementById('resultsStatus').textContent = 'Analyzing';

  } catch (err) {
    console.error(err);
    showToast('An error occurred.', 'error');
    resetResultsPanel();
  } finally {
    analyzeBtn.disabled  = false;
    analyzeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Analyze Video`;
  }
}

function startMjpegFeed(feedUrl) {
  const img   = document.getElementById('mjpegFrame');
  const live  = document.getElementById('resultsLive');
  const dot   = document.getElementById('vpDot');
  const label = document.getElementById('vpLabel');

  isPaused = false;
  setPlayPauseIcon(false);
  document.getElementById('seekBar').value            = 0;
  document.getElementById('vpcTime').textContent      = '0 / 0';
  document.getElementById('vpFrameCounter').textContent = '';

  dot.classList.remove('done');
  label.textContent = 'Analyzing…';

  document.getElementById('summaryGrid').classList.add('hidden');
  document.getElementById('incidentsList').classList.add('hidden');
  live.classList.remove('hidden');

  img.src = feedUrl;
}

function startStatusPolling(statusUrl) {
  clearInterval(statusPollTimer);
  statusPollTimer = setInterval(async () => {
    try {
      const resp = await fetch(statusUrl);
      const data = await resp.json();
      if (!data.success) return;

      totalFrames = data.total_frames || 0;
      const cur   = data.current_frame || 0;
      const fps   = data.fps || 25;

      if (!isSeeking && totalFrames > 0) {
        document.getElementById('seekBar').value = Math.round((cur / totalFrames) * 100);
      }

      const curSec   = Math.floor(cur   / fps);
      const totalSec = Math.floor(totalFrames / fps);
      document.getElementById('vpcTime').textContent =
        `${formatTime(curSec)} / ${formatTime(totalSec)}`;
      document.getElementById('vpFrameCounter').textContent =
        totalFrames > 0 ? `${cur} / ${totalFrames}` : '';

      const label = document.getElementById('vpLabel');
      if (data.state === 'running') {
        const elapsed = data.elapsed_sec || 0;
        label.textContent = `Analyzing… ${formatEta(elapsed)} elapsed`;
      } else if (data.state === 'paused') {
        label.textContent = 'Paused';
      }

      if (data.state === 'done') {
        clearInterval(statusPollTimer);
        sessionStorage.removeItem('activeJobId');
        onAnalysisDone({
          duration:      formatTime(totalSec),
          frames:        totalFrames,
          incidentCount: data.incident_count || 0,
          jobId:         currentJobId,
          elapsedSec:    data.elapsed_sec || 0,
        });
      }
    } catch (_) {}
  }, 400);
}

function formatEta(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function onAnalysisDone(data) {
  const dot   = document.getElementById('vpDot');
  const label = document.getElementById('vpLabel');
  dot.classList.add('done');
  label.textContent = 'Analysis complete';

  document.getElementById('resultsStatus').textContent = 'Complete';
  showToast('Analysis complete — export ready!', 'success');

  document.getElementById('summaryAccidents').querySelector('.summary-num').textContent =
    data.incidentCount > 0 ? data.incidentCount : '0';
  document.getElementById('summaryDuration').querySelector('.summary-num').textContent  = data.duration;
  document.getElementById('summaryFrames').querySelector('.summary-num').textContent    = data.frames;
  document.getElementById('summaryGrid').classList.remove('hidden');
    document.getElementById('summaryTime').querySelector('.summary-num').textContent      = formatEta(data.elapsedSec);  // ← ADD


  const list = document.getElementById('incidentsList');
  list.classList.remove('hidden');
  list.innerHTML = data.incidentCount > 0
    ? `<div class="incidents-found">⚠ ${data.incidentCount} incident detected — review the exported video below.</div>`
    : `<div class="no-incidents">✓ No incidents detected in this video.</div>`;

  showDownloadBanner(data.jobId, data.incidentCount);
}

function showDownloadBanner(jobId, incidentCount) {
  const existing = document.getElementById('downloadBanner');
  if (existing) existing.remove();

  const downloadUrl = `/api/download-export/${jobId}`;
  const hasAlerts   = incidentCount > 0;

  const banner = document.createElement('div');
  banner.id = 'downloadBanner';
  banner.innerHTML = `
    <div class="dl-banner ${hasAlerts ? 'dl-banner--alert' : 'dl-banner--clean'}">
      <div class="dl-banner-icon">
        ${hasAlerts
          ? `<svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 4L12 14.01l-3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        }
      </div>
      <div class="dl-banner-text">
        <span class="dl-banner-title">
          ${hasAlerts ? `⚠ ${incidentCount} incident(s) detected` : '✓ Analysis complete — no incidents'}
        </span>
        <span class="dl-banner-sub">Full annotated video is ready to download</span>
      </div>
      <a href="${downloadUrl}" download="accident_analysis_${jobId}.mp4" class="dl-btn">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Download MP4
      </a>
    </div>
  `;

  if (!document.getElementById('dlBannerStyles')) {
    const style = document.createElement('style');
    style.id = 'dlBannerStyles';
    style.textContent = `
      #downloadBanner { animation: dlSlideIn 0.35s cubic-bezier(.16,1,.3,1) both; }
      @keyframes dlSlideIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      .dl-banner { display:flex; align-items:center; gap:14px; padding:14px 18px; border-radius:12px; border:1px solid; margin-top:4px; }
      .dl-banner--alert { background:rgba(220,38,38,.08); border-color:rgba(220,38,38,.35); }
      .dl-banner--clean { background:rgba(34,197,94,.08);  border-color:rgba(34,197,94,.35); }
      .dl-banner-icon { flex-shrink:0; display:flex; align-items:center; }
      .dl-banner--alert .dl-banner-icon { color:#ef4444; }
      .dl-banner--clean .dl-banner-icon { color:#22c55e; }
      .dl-banner-icon svg { width:22px; height:22px; }
      .dl-banner-text { flex:1; display:flex; flex-direction:column; gap:2px; min-width:0; }
      .dl-banner-title { font-size:.85rem; font-weight:600; color:var(--text-primary,#fff); font-family:var(--font-mono,monospace); }
      .dl-banner-sub   { font-size:.73rem; color:var(--text-muted,#888); font-family:var(--font-mono,monospace); }
      .dl-btn { display:inline-flex; align-items:center; gap:7px; padding:9px 18px; border-radius:8px; background:var(--accent,#3b82f6); color:#fff; font-size:.82rem; font-family:var(--font-mono,monospace); font-weight:600; text-decoration:none; white-space:nowrap; flex-shrink:0; transition:opacity .15s,transform .15s; border:none; cursor:pointer; }
      .dl-btn:hover { opacity:.88; transform:translateY(-1px); }
      .dl-btn svg { width:15px; height:15px; }
      .incidents-found { padding:10px 14px; background:rgba(220,38,38,.08); border:1px solid rgba(220,38,38,.25); border-radius:8px; font-size:.78rem; font-family:var(--font-mono,monospace); color:#f87171; }
      .no-incidents    { padding:10px 14px; background:rgba(34,197,94,.07);  border:1px solid rgba(34,197,94,.2);  border-radius:8px; font-size:.78rem; font-family:var(--font-mono,monospace); color:#4ade80; }
    `;
    document.head.appendChild(style);
  }

  const incidentsList = document.getElementById('incidentsList');
  if (incidentsList && incidentsList.parentNode) {
    incidentsList.parentNode.insertBefore(banner, incidentsList.nextSibling);
  }
}

function hideDownloadBanner() {
  const b = document.getElementById('downloadBanner');
  if (b) b.remove();
}

async function togglePlayPause() {
  if (!controlUrl) return;
  isPaused = !isPaused;
  setPlayPauseIcon(isPaused);
  await fetch(controlUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: isPaused ? 'pause' : 'resume' }),
  });
  const dot   = document.getElementById('vpDot');
  const label = document.getElementById('vpLabel');
  if (isPaused) {
    dot.style.animationPlayState = 'paused';
    label.textContent = 'Paused';
  } else {
    dot.style.animationPlayState = 'running';
    label.textContent = 'Analyzing…';
  }
}

function setPlayPauseIcon(paused) {
  document.getElementById('iconPause').classList.toggle('hidden',  paused);
  document.getElementById('iconPlay').classList.toggle('hidden',  !paused);
}

function onSeekInput(pct) {
  isSeeking = true;
  if (totalFrames > 0) {
    const frame = Math.round((pct / 100) * totalFrames);
    const fps   = 25;
    document.getElementById('vpcTime').textContent =
      `${formatTime(Math.floor(frame / fps))} / ${formatTime(Math.floor(totalFrames / fps))}`;
  }
}

async function onSeekCommit(pct) {
  isSeeking = false;
  if (!controlUrl || totalFrames === 0) return;
  const frame = Math.round((pct / 100) * totalFrames);
  await fetch(controlUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'seek', frame }),
  });
  if (isPaused) {
    isPaused = false;
    setPlayPauseIcon(false);
    document.getElementById('vpDot').style.animationPlayState = 'running';
    document.getElementById('vpLabel').textContent = 'Analyzing…';
  }
}

let progressAnimTimer = null;
function animateProgressTo(target, duration) {
  clearInterval(progressAnimTimer);
  const fill = document.getElementById('progressFill');
  const pct  = document.getElementById('progressPercent');
  let cur    = parseInt(fill.style.width) || 0;
  const step = (target - cur) / (duration / 100);
  progressAnimTimer = setInterval(() => {
    cur = Math.min(cur + step, target);
    fill.style.width = `${cur}%`;
    pct.textContent  = `${Math.round(cur)}%`;
    if (cur >= target) clearInterval(progressAnimTimer);
  }, 100);
}

function resetResultsPanel() {
  const urlToStop = controlUrl;
  clearInterval(statusPollTimer);
  statusPollTimer = null;

  const img = document.getElementById('mjpegFrame');
  img.src = '';

  currentJobId = null;
  controlUrl   = null;
  totalFrames  = 0;
  isPaused     = false;

  sessionStorage.removeItem('activeJobId');

  if (urlToStop) {
    fetch(urlToStop, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }), keepalive: true,
    }).catch(() => {});
  }

  document.getElementById('resultsLive').classList.add('hidden');
  document.getElementById('resultsEmpty').classList.remove('hidden');
  document.getElementById('summaryGrid').classList.add('hidden');
  document.getElementById('incidentsList').classList.add('hidden');
  document.getElementById('seekBar').value = 0;
  document.getElementById('vpcTime').textContent = '0 / 0';
  document.getElementById('vpFrameCounter').textContent = '';
  hideDownloadBanner();
}

function resetUpload() {
  removeSelectedFile();
  clearUrl();
  document.getElementById('uploadProgress').classList.add('hidden');
  document.getElementById('progressFill').style.width = '0%';
  resetResultsPanel();
  document.getElementById('resultsStatus').textContent = 'Awaiting video';
}

window.addEventListener('beforeunload', () => {
  if (!controlUrl) return;
});

function addToRecent(nameOrUrl, type = 'file') {
  const list = document.getElementById('recentList');
  if (!list) return;
  list.querySelector('.recent-empty')?.remove();
  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const lbl  = type === 'url'
    ? nameOrUrl.replace(/^https?:\/\//,'').slice(0,50) + (nameOrUrl.length > 55 ? '…' : '')
    : nameOrUrl;
  const urlIcon  = `<svg viewBox="0 0 24 24" fill="none" style="width:12px;height:12px;flex-shrink:0;opacity:.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const fileIcon = `<svg viewBox="0 0 24 24" fill="none" style="width:12px;height:12px;flex-shrink:0;opacity:.5"><path d="M15 10L19.55 7.72C19.83 7.58 20.17 7.58 20.45 7.72L21 8V16L20.45 16.28C20.17 16.42 19.83 16.42 19.55 16.28L15 14V10Z" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="7" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>`;
  const item = document.createElement('div');
  item.className = 'recent-item';
  item.style.cssText = 'display:flex;align-items:center;gap:6px;';
  item.innerHTML = `${type==='url'?urlIcon:fileIcon}<span class="recent-name" title="${nameOrUrl}">${lbl}</span><span class="recent-time">${time}</span>`;
  list.prepend(item);
}

function formatBytes(b) {
  if (b < 1024)       return `${b} B`;
  if (b < 1024*1024)  return `${(b/1024).toFixed(1)} KB`;
  return `${(b/(1024*1024)).toFixed(1)} MB`;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

let _historyData = [];

async function loadHistory() {
  const btn = document.querySelector('.history-refresh-btn');
  if (btn) btn.classList.add('spinning');
  try {
    const resp = await fetch('/api/analysis-history');
    const data = await resp.json();
    if (!data.success) return;
    // Most recent first
    _historyData = (data.history || []).slice().reverse();
    renderHistory(_historyData);
  } catch (e) {
    console.error('Failed to load history', e);
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function renderHistory(items) {
  const list    = document.getElementById('historyList');
  const empty   = document.getElementById('historyEmpty');
  const badge   = document.getElementById('historyCountBadge');
  if (!list) return;

  if (badge) badge.textContent = items.length;

  if (!items.length) {
    empty.classList.remove('hidden');
    list.innerHTML = '';
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = items.map((item, idx) => {
    const incidents    = item.incident_count || 0;
    const frames       = item.total_frames   || 0;
    const fps          = item.fps            || 25;
    const durationSec  = fps > 0 ? Math.floor(frames / fps) : 0;
    const durationStr  = fmtTime(durationSec);
    const completedAt  = item.completed_at
      ? new Date(item.completed_at * 1000).toLocaleString(undefined, {
          month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : '—';

    let elapsedStr = '—';
    if (item.process_start_time && item.process_end_time) {
      const secs = Math.round(item.process_end_time - item.process_start_time);
      elapsedStr = secs < 60 ? `${secs}s` : `${Math.floor(secs/60)}m ${secs%60}s`;
    }

    const activeModels  = item.active_models || [];
    const hasExport     = item.export_ready && item.export_filename;
    const filename      = item.filename || 'unknown';
    const shortId       = (item.job_id || '').slice(0, 8);

    const modelTags = activeModels.length
      ? activeModels.map(m =>
          `<span class="hc-model-tag" title="${escHtml(m.filename)}">${escHtml(m.display_name || m.filename)}</span>`
        ).join('')
      : `<span class="hc-no-models">No model data recorded</span>`;

    const incidentClass = incidents > 0 ? 'alert' : 'clean';
    const incidentText  = incidents > 0 ? `⚠ ${incidents} incident${incidents !== 1 ? 's' : ''}` : '✓ Clean';

    return `
      <div class="history-card ${incidents > 0 ? 'has-incidents' : ''}" style="animation-delay:${idx * 0.04}s">
        <div class="hc-top">
          <div class="hc-title-group">
            <div class="hc-filename" title="${escHtml(filename)}">${escHtml(filename)}</div>
            <div class="hc-date">${completedAt} · #${shortId}</div>
          </div>
          <span class="hc-incident-badge ${incidentClass}">${incidentText}</span>
        </div>

        <div class="hc-stats">
          <div class="hc-stat">
            <div class="hc-stat-val">${durationStr}</div>
            <div class="hc-stat-label">Duration</div>
          </div>
          <div class="hc-stat">
            <div class="hc-stat-val">${frames.toLocaleString()}</div>
            <div class="hc-stat-label">Frames</div>
          </div>
          <div class="hc-stat">
            <div class="hc-stat-val">${elapsedStr}</div>
            <div class="hc-stat-label">Proc. Time</div>
          </div>
        </div>

        <div class="hc-models">${modelTags}</div>

        <div class="hc-actions">
          <button class="hc-btn primary" onclick="openDetail(${idx})">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Details
          </button>
          ${hasExport
            ? `<a class="hc-btn" href="/api/download-export/${item.job_id}" download="velion_${shortId}.mp4">
                <svg viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Export
               </a>`
            : `<button class="hc-btn disabled" disabled>
                <svg viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                No Export
               </button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function openDetail(idx) {
  const item = _historyData[idx];
  if (!item) return;

  const drawer   = document.getElementById('detailDrawer');
  const backdrop = document.getElementById('detailBackdrop');
  const title    = document.getElementById('drawerTitle');
  const body     = document.getElementById('drawerBody');

  title.textContent = item.filename || 'Analysis Details';

  const incidents   = item.incident_count || 0;
  const frames      = item.total_frames   || 0;
  const fps         = item.fps            || 25;
  const durationSec = fps > 0 ? Math.floor(frames / fps) : 0;
  const completedAt = item.completed_at
    ? new Date(item.completed_at * 1000).toLocaleString()
    : '—';

  let elapsedStr = '—';
  if (item.process_start_time && item.process_end_time) {
    const secs = Math.round(item.process_end_time - item.process_start_time);
    elapsedStr = secs < 60 ? `${secs}s` : `${Math.floor(secs/60)}m ${secs%60}s`;
  }

  const hasExport    = item.export_ready && item.export_filename;
  const activeModels = item.active_models || [];
  const settings     = item.settings     || {};

  const modelsHtml = activeModels.length
    ? activeModels.map(m => {
        const roleClass = `role-${m.role || 'custom'}`;
        const alertClasses = (m.alert_classes || []);
        const drawClasses  = (m.draw_classes  || []);
        const allClasses   = Array.from(new Set([...alertClasses, ...drawClasses]));
        const classesHtml  = allClasses.length
          ? allClasses.map(c =>
              `<span class="dmc-class-tag ${alertClasses.includes(c) ? 'is-alert' : ''}"
                     title="${alertClasses.includes(c) ? 'Alert class' : 'Draw only'}"
              >${escHtml(c)}</span>`
            ).join('')
          : `<span style="font-size:.65rem;color:var(--text-muted);font-family:var(--font-mono)">No classes configured</span>`;

        return `
          <div class="drawer-model-card">
            <div class="dmc-header">
              <div class="dmc-icon">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="6" cy="12" r="2" stroke="currentColor" stroke-width="1.4"/>
                  <circle cx="12" cy="6" r="2" stroke="currentColor" stroke-width="1.4"/>
                  <circle cx="12" cy="18" r="2" stroke="currentColor" stroke-width="1.4"/>
                  <circle cx="18" cy="12" r="2" stroke="currentColor" stroke-width="1.4"/>
                  <line x1="8" y1="12" x2="10" y2="7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                  <line x1="8" y1="12" x2="10" y2="17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                  <line x1="14" y1="7" x2="16" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                  <line x1="14" y1="17" x2="16" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
              </div>
              <div>
                <div class="dmc-name">${escHtml(m.display_name || m.filename)}</div>
                <div class="dmc-file">${escHtml(m.filename)}</div>
              </div>
            </div>
            <div class="dmc-meta">
              <span class="dmc-tag ${roleClass}">${(m.role || 'custom').toUpperCase()}</span>
              ${m.architecture ? `<span class="dmc-tag arch">${escHtml(m.architecture)}</span>` : ''}
              ${m.alert_label  ? `<span class="dmc-tag arch">Alert: ${escHtml(m.alert_label)}</span>` : ''}
              <span class="dmc-tag arch">${m.class_count || 0} classes</span>
            </div>
            ${allClasses.length ? `
              <div class="dmc-classes-label">Classes ${alertClasses.length ? `· <span style="color:#fca5a5">■ = alert trigger</span>` : ''}</div>
              <div class="dmc-classes">${classesHtml}</div>` : ''}
          </div>`;
      }).join('')
    : `<div class="drawer-no-models">No model data recorded for this analysis.<br>Only analyses run after updating will show model details.</div>`;

  const settingsFields = [
    { key: 'general_conf',          label: 'General Conf.',   fmt: v => `${(+v * 100).toFixed(0)}%` },
    { key: 'accident_conf',         label: 'Accident Conf.',  fmt: v => `${(+v * 100).toFixed(0)}%` },
    { key: 'confirm_frames',        label: 'Confirm Frames',  fmt: v => v },
    { key: 'incident_cooldown_sec', label: 'Cooldown',        fmt: v => `${Math.round(v/60)}m` },
    { key: 'alert_hold_frames',     label: 'Alert Hold',      fmt: v => `${v} fr` },
    { key: 'miss_reset_frames',     label: 'Miss Reset',      fmt: v => `${v} fr` },
  ];
  const settingsHtml = Object.keys(settings).length
    ? `<div class="drawer-settings-grid">
        ${settingsFields.map(f => {
          const v = settings[f.key];
          if (v === undefined || v === null) return '';
          return `<div class="dsg-item"><div class="dsg-key">${f.label}</div><div class="dsg-val">${escHtml(String(f.fmt(v)))}</div></div>`;
        }).join('')}
       </div>`
    : `<div class="drawer-no-models" style="font-size:.7rem;">Settings not recorded for this analysis.</div>`;

  body.innerHTML = `
    <!-- Job ID -->
    <div class="drawer-section">
      <div class="drawer-section-title">Identification</div>
      <div class="drawer-job-id">Job ID: <span>${escHtml(item.job_id || '—')}</span></div>
    </div>

    <!-- Overview stats -->
    <div class="drawer-section">
      <div class="drawer-section-title">Overview</div>
      <div class="drawer-kv-grid">
        <div class="drawer-kv">
          <div class="drawer-kv-key">Completed</div>
          <div class="drawer-kv-val" style="font-size:.72rem">${completedAt}</div>
        </div>
        <div class="drawer-kv">
          <div class="drawer-kv-key">Incidents</div>
          <div class="drawer-kv-val" style="color:${incidents > 0 ? '#f87171' : '#4ade80'}">${incidents > 0 ? `⚠ ${incidents}` : '✓ 0'}</div>
        </div>
        <div class="drawer-kv">
          <div class="drawer-kv-key">Duration</div>
          <div class="drawer-kv-val">${fmtTime(durationSec)}</div>
        </div>
        <div class="drawer-kv">
          <div class="drawer-kv-key">Total Frames</div>
          <div class="drawer-kv-val">${frames.toLocaleString()}</div>
        </div>
        <div class="drawer-kv">
          <div class="drawer-kv-key">Source FPS</div>
          <div class="drawer-kv-val">${fps}</div>
        </div>
        <div class="drawer-kv">
          <div class="drawer-kv-key">Proc. Time</div>
          <div class="drawer-kv-val">${elapsedStr}</div>
        </div>
      </div>
    </div>

    <!-- Export -->
    <div class="drawer-section">
      <div class="drawer-section-title">Export</div>
      ${hasExport
        ? `<a href="/api/download-export/${item.job_id}" download="velion_${item.job_id}.mp4"
             class="hc-btn primary" style="text-decoration:none;justify-content:center;padding:10px 16px;font-size:.78rem;">
             <svg viewBox="0 0 24 24" fill="none" style="width:15px;height:15px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
             Download Annotated MP4 — ${escHtml(item.export_filename || '')}
           </a>`
        : `<div class="drawer-no-models">No export file available for this job.</div>`
      }
    </div>

    <!-- Models -->
    <div class="drawer-section">
      <div class="drawer-section-title">Active Models at Time of Analysis</div>
      ${modelsHtml}
    </div>

    <!-- Settings -->
    <div class="drawer-section">
      <div class="drawer-section-title">Detection Settings Snapshot</div>
      ${settingsHtml}
    </div>
  `;

  backdrop.classList.add('open');
  drawer.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  const drawer   = document.getElementById('detailDrawer');
  const backdrop = document.getElementById('detailBackdrop');
  if (drawer)   drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

function fmtTime(sec) {
  if (!sec || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function escHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', loadHistory);