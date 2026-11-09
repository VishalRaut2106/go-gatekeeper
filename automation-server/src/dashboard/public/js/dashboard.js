// Dashboard Application Logic
let downloadsChart = null;

// Local storage keys
const KEY_ADMIN_API = 'gatekeeper_admin_api_key';
const KEY_OVERRIDE_VER = 'gatekeeper_target_version';

function getStoredApiKey() {
  return localStorage.getItem(KEY_ADMIN_API) || 'gatekeeper-secret-key-change-me-in-production';
}

function getStoredVersionOverride() {
  return localStorage.getItem(KEY_OVERRIDE_VER) || '';
}

// Format duration
function formatDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Format timestamp
function formatDate(isoStr) {
  if (!isoStr) return 'Never';
  const d = new Date(isoStr);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Initialize Chart.js
function initChart(labels = [], dataPoints = []) {
  const ctx = document.getElementById('downloadsChart');
  if (!ctx) return;

  if (downloadsChart) {
    downloadsChart.destroy();
  }

  downloadsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Official npm Downloads',
          data: dataPoints,
          borderColor: '#77d49b',
          backgroundColor: 'rgba(119, 212, 155, 0.1)',
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointBackgroundColor: '#77d49b',
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#a1a1aa',
            font: { family: "'Inter', sans-serif", size: 12 },
          },
        },
        tooltip: {
          backgroundColor: '#1e1919',
          titleColor: '#fff',
          bodyColor: '#77d49b',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (context) => ` ${context.parsed.y} downloads`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: {
            color: '#71717a',
            font: { family: "'Inter', sans-serif", size: 11 },
            maxRotation: 45,
            minRotation: 45,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: {
            color: '#71717a',
            font: { family: "'Inter', sans-serif", size: 11 },
            precision: 0,
          },
        },
      },
    },
  });
}

// Fetch Analytics Report
async function loadAnalytics() {
  try {
    const res = await fetch('/api/analytics/downloads');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const report = await res.json();

    document.getElementById('stat-downloads-month').textContent = report.downloads.lastMonth.toLocaleString();
    document.getElementById('stat-downloads-week').textContent = report.downloads.lastWeek.toLocaleString();
    document.getElementById('stat-downloads-day').textContent = report.downloads.lastDay.toLocaleString();

    const growth = report.downloads.weeklyGrowthRatePercentage;
    const growthBadge = document.getElementById('growth-badge');
    growthBadge.textContent = `${growth >= 0 ? '+' : ''}${growth}% wk`;
    if (growth < 0) {
      growthBadge.className = 'badge badge-failure';
    } else {
      growthBadge.className = 'badge badge-emerald';
    }

    document.getElementById('stat-pkg-version').textContent = `v${report.latestVersion}`;
    document.getElementById('header-pkg-version').textContent = `v${report.latestVersion}`;
    document.getElementById('stat-pkg-name').textContent = report.packageName;

    // Chart update
    const history = report.history || [];
    const labels = history.map((h) => h.day.substring(5)); // 'MM-DD'
    const counts = history.map((h) => h.downloads);
    initChart(labels, counts);
  } catch (err) {
    console.error('Failed to load download analytics:', err);
  }
}

// Fetch Worker & Health Status
async function loadWorkerAndHealth() {
  try {
    const [healthRes, workerRes] = await Promise.all([
      fetch('/api/health'),
      fetch('/api/workers/status'),
    ]);

    if (healthRes.ok) {
      const health = await healthRes.json();
      document.getElementById('footer-db-status').textContent = `DB: ${health.database}`;
      if (health.scheduler?.testScheduleCron) {
        document.getElementById('cron-schedule-badge').textContent = health.scheduler.testScheduleCron;
      }
    }

    if (workerRes.ok) {
      const w = await workerRes.json();
      const state = w.worker.status;
      const workerPill = document.getElementById('worker-pill');
      const workerText = document.getElementById('worker-status-text');

      if (state === 'RUNNING') {
        workerPill.className = 'worker-pill running';
        workerText.textContent = 'Worker: TESTING...';
        setButtonLoading(true);
      } else {
        workerPill.className = 'worker-pill';
        workerText.textContent = 'Worker: IDLE';
        setButtonLoading(false);
      }
    }
  } catch (err) {
    console.error('Worker status fetch error:', err);
  }
}

// Fetch Test History & Stats
async function loadTestHistory() {
  try {
    const statusFilter = document.getElementById('filter-status').value;
    const url = `/api/tests/history?limit=25${statusFilter ? `&status=${statusFilter}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const stats = data.stats;
    document.getElementById('stat-total-runs').textContent = stats.totalRuns;
    document.getElementById('stat-success-rate').textContent = `${stats.successRate}%`;
    document.getElementById('health-badge').textContent = `${stats.successRate}%`;
    document.getElementById('stat-avg-duration').textContent = formatDuration(stats.averageDurationMs);
    document.getElementById('stat-last-success').textContent = formatDate(stats.lastSuccessfulTest?.created_at);

    // Render table
    const tbody = document.getElementById('tests-table-body');
    if (!data.tests || data.tests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No test runs recorded yet. Click "Run Installation Test" to execute your first sandbox verification!</td></tr>`;
      return;
    }

    tbody.innerHTML = data.tests
      .map((t) => {
        let badgeClass = 'badge-neutral';
        if (t.status === 'SUCCESS') badgeClass = 'badge-success';
        if (t.status === 'FAILURE') badgeClass = 'badge-failure';
        if (t.status === 'TIMEOUT') badgeClass = 'badge-timeout';

        return `
          <tr>
            <td><span class="badge ${badgeClass}">${t.status}</span></td>
            <td class="font-mono">${t.target_version}</td>
            <td class="font-mono">${t.installed_version || '—'}</td>
            <td><span class="badge badge-neutral">${t.trigger_type}</span></td>
            <td class="font-mono">${formatDuration(t.duration_ms)}</td>
            <td>${formatDate(t.created_at)}</td>
            <td><button class="btn-sm btn-outline btn-view-log" data-id="${t.id}">Inspect</button></td>
          </tr>
        `;
      })
      .join('');

    // Attach inspect handlers
    document.querySelectorAll('.btn-view-log').forEach((btn) => {
      btn.addEventListener('click', () => openLogModal(btn.dataset.id));
    });
  } catch (err) {
    console.error('Error fetching test history:', err);
  }
}

function setButtonLoading(loading) {
  const btn = document.getElementById('btn-trigger-test');
  const spinner = document.getElementById('btn-spinner');
  const btnText = document.getElementById('btn-text');

  if (loading) {
    btn.disabled = true;
    spinner.style.display = 'inline-block';
    btnText.textContent = 'Running Sandbox Test...';
  } else {
    btn.disabled = false;
    spinner.style.display = 'none';
    btnText.textContent = '▶ Run Installation Test';
  }
}

// Trigger Manual Test
async function triggerTest() {
  const apiKey = getStoredApiKey();
  const versionOverride = getStoredVersionOverride();

  setButtonLoading(true);

  try {
    const payload = {};
    if (versionOverride) {
      payload.version = versionOverride;
    }

    const res = await fetch('/api/tests/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (res.status === 401) {
      alert('Authentication Failed: Invalid admin API key. Please click the ⚙️ settings icon to set your ADMIN_API_KEY.');
      document.getElementById('modal-settings').classList.add('active');
    } else if (res.status === 409) {
      alert('A test worker is already running. Please wait for it to finish.');
    } else if (!res.ok) {
      alert(`Worker failed: ${data.message || data.error}`);
    } else {
      console.log('Test completed successfully:', data);
    }
  } catch (err) {
    alert(`Failed to trigger test: ${err.message}`);
  } finally {
    setButtonLoading(false);
    await Promise.all([loadWorkerAndHealth(), loadTestHistory(), loadAnalytics()]);
  }
}

// Open Log Modal
async function openLogModal(testId) {
  try {
    const res = await fetch(`/api/tests/${testId}`);
    if (!res.ok) throw new Error('Failed to load test details');
    const test = await res.json();

    document.getElementById('modal-log-title').textContent = `Test Run: ${test.id}`;

    const metaGrid = document.getElementById('modal-meta');
    metaGrid.innerHTML = `
      <div class="meta-item">
        <span class="meta-item-label">Status</span>
        <span class="meta-item-value">${test.status}</span>
      </div>
      <div class="meta-item">
        <span class="meta-item-label">Target Version</span>
        <span class="meta-item-value font-mono">${test.target_version}</span>
      </div>
      <div class="meta-item">
        <span class="meta-item-label">Installed Version</span>
        <span class="meta-item-value font-mono">${test.installed_version || 'None'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-item-label">Duration</span>
        <span class="meta-item-value font-mono">${formatDuration(test.duration_ms)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-item-label">Exit Code</span>
        <span class="meta-item-value font-mono">${test.exit_code ?? '0'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-item-label">Executed At</span>
        <span class="meta-item-value">${formatDate(test.created_at)}</span>
      </div>
    `;

    document.getElementById('modal-stdout').textContent = test.stdout || '// No standard output recorded';
    document.getElementById('modal-stderr').textContent = test.stderr || (test.error_message ? `Error: ${test.error_message}` : '// No standard error or diagnostics recorded');

    document.getElementById('modal-logs').classList.add('active');
  } catch (err) {
    alert(`Could not load test logs: ${err.message}`);
  }
}

// Setup Event Listeners
function setupEvents() {
  document.getElementById('btn-trigger-test').addEventListener('click', triggerTest);
  document.getElementById('btn-refresh-table').addEventListener('click', loadTestHistory);
  document.getElementById('btn-refresh-chart').addEventListener('click', loadAnalytics);
  document.getElementById('filter-status').addEventListener('change', loadTestHistory);

  // Modal Logs
  const closeModal = () => document.getElementById('modal-logs').classList.remove('active');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);

  // Settings Modal
  const openSettings = () => {
    document.getElementById('input-api-key').value = getStoredApiKey();
    document.getElementById('input-target-version').value = getStoredVersionOverride();
    document.getElementById('modal-settings').classList.add('active');
  };
  const closeSettings = () => document.getElementById('modal-settings').classList.remove('active');

  document.getElementById('btn-open-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('settings-backdrop').addEventListener('click', closeSettings);

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const key = document.getElementById('input-api-key').value.trim();
    const ver = document.getElementById('input-target-version').value.trim();
    if (key) localStorage.setItem(KEY_ADMIN_API, key);
    localStorage.setItem(KEY_OVERRIDE_VER, ver);
    closeSettings();
    alert('Admin settings saved in browser storage.');
  });
}

// Initial Bootstrap
window.addEventListener('DOMContentLoaded', async () => {
  setupEvents();
  initChart();
  await Promise.all([
    loadAnalytics(),
    loadTestHistory(),
    loadWorkerAndHealth(),
  ]);

  // Periodic polling every 30 seconds
  setInterval(loadWorkerAndHealth, 30000);
});
