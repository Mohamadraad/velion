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

    if (result && result.no_model) {
      _showNoModelNotice();
      return;
    }

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
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/>
        <path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Analyze Video`;
  }
}

function _showNoModelNotice() {
  const resultsSection = document.querySelector('.results-section');
  if (!resultsSection) { showToast('No model selected. Go to Settings to configure.', 'error'); return; }

  const existing = document.getElementById('noModelNotice');
  if (existing) return;

  const notice = document.createElement('div');
  notice.id = 'noModelNotice';
  notice.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center; gap:16px;
      padding:36px 24px; border:1.5px dashed rgba(245,158,11,.4);
      border-radius:14px; background:rgba(245,158,11,.04); text-align:center;
      animation:fadeInUp .3s ease;
    ">
      <svg viewBox="0 0 24 24" fill="none" style="width:40px;height:40px;color:#f59e0b">
        <path d="M10.29 3.86L1.82 18A2 2 0 003.54 21H20.46A2 2 0 0022.18 18L13.71 3.86A2 2 0 0010.29 3.86Z"
              stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <div>
        <div style="font-family:var(--font-display);font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:6px;">
          No Detection Model Selected
        </div>
        <div style="font-size:.82rem;color:var(--text-muted);max-width:300px;line-height:1.6;">
          Velion needs at least one model to analyse video.
          Head to Settings to upload or activate a model.
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
        <a href="/settings" style="
          display:inline-flex; align-items:center; gap:7px; padding:9px 20px;
          background:var(--accent); border-radius:8px; color:#fff;
          font-size:.82rem; font-family:var(--font-mono); font-weight:600; text-decoration:none;
          transition:opacity .15s;
        " onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
            <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41"
                  stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          Go to Settings
        </a>
        <button onclick="document.getElementById('noModelNotice').remove();document.getElementById('resultsEmpty').classList.remove('hidden');"
          style="
            padding:9px 20px; border-radius:8px; border:1px solid var(--border);
            background:transparent; color:var(--text-muted); font-size:.82rem;
            font-family:var(--font-mono); cursor:pointer;
          ">
          Dismiss
        </button>
      </div>
    </div>
  `;

  const empty = document.getElementById('resultsEmpty');
  if (empty) {
    empty.classList.add('hidden');
    empty.parentNode.insertBefore(notice, empty);
  }
}
