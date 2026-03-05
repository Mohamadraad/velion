document.addEventListener('DOMContentLoaded', () => {
  loadStats();
});

async function loadStats() {
  try {
    const data = await (window._dashboardSummaryPromise || apiCall('/api/dashboard-summary'));
    if (!data.success) return;

    animateCounter('statStreams', data.stream_count);
    animateCounter('statVideos',  data.video_count);
    animateCounter('statAlerts',  data.total_incidents);

    data.streams.forEach((stream, i) => {
      const slot  = i + 1;
      const dot   = document.querySelector(`.cam-preview-card:nth-child(${slot}) .cam-dot`);
      const noSig = document.querySelector(`.cam-preview-card:nth-child(${slot}) .no-signal`);
      if (dot)   dot.classList.add('live');
      if (noSig) noSig.textContent = stream.label || `CAM 0${slot}`;
    });

    const active      = data.active_models;
    const modelName   = document.getElementById('statModelName');
    const modelStatus = document.getElementById('modelStatus');

    if (modelName) {
      modelName.textContent        = active.length > 0 ? active.length : '—';
      modelName.style.color        = active.length > 0 ? '#22c55e' : '';
      modelName.style.opacity      = '1';
      modelName.style.transition   = 'opacity 0.2s ease';
    }
    if (modelStatus) {
      modelStatus.textContent      = active.length > 0 ? 'Active' : 'Not Active';
      modelStatus.style.color      = active.length > 0 ? '#22c55e' : '#f59e0b';
      modelStatus.style.opacity    = '1';
      modelStatus.style.transition = 'opacity 0.2s ease';
    }

  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transition = 'opacity 0.2s ease';
  el.style.opacity    = '1';
  let current = 0;
  const step  = Math.ceil(target / 30) || 1;
  const interval = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current;
    if (current >= target) clearInterval(interval);
  }, 40);
}