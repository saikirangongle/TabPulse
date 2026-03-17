// dashboard/dashboard.js  v1.5.0  (CSP-clean)
'use strict';

let dashData     = null;
let charts       = {};
let refreshTimer = null;

/* ── formatters ── */
const fmtBytes = b => {
  if (!b || b <= 0)       return '0 B';
  if (b < 1024)           return b + ' B';
  if (b < 1048576)        return (b / 1024).toFixed(1)       + ' KB';
  if (b < 1073741824)     return (b / 1048576).toFixed(2)    + ' MB';
  return                         (b / 1073741824).toFixed(2) + ' GB';
};
const fmtSpeed = bps => {
  if (!bps || bps <= 0)  return '0 B/s';
  if (bps >= 1048576)    return (bps / 1048576).toFixed(2) + ' MB/s';
  if (bps >= 1024)       return (bps / 1024).toFixed(1)    + ' KB/s';
  return bps + ' B/s';
};
const fmtTime = ms =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDuration = ms => {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};
const getDomain = url => {
  if (!url) return '';
  if (url.startsWith('chrome://newtab'))     return 'New Tab';
  if (url.startsWith('chrome://'))           return 'Chrome Internal';
  if (url.startsWith('about:'))              return 'about:' + url.split(':')[1];
  if (url.startsWith('file://'))             return 'Local File';
  if (url.startsWith('chrome-extension://')) return 'Extension';
  try { return new URL(url).hostname.replace(/^www\./, '') || url.slice(0, 30); }
  catch { return url.length > 30 ? url.slice(0, 30) + '\u2026' : url; }
};
const getTabLabel = tab => {
  const m = tab.meta || {};
  const d = getDomain(m.url || '');
  if (d) return d;
  if (m.title && m.title.trim()) return m.title.trim().slice(0, 40);
  return 'Unknown Tab';
};

/* ── chart colors ── */
const TYPE_COLORS = {
  script: '#7c3aed', stylesheet: '#00cfff', image: '#00f5c4',
  media:  '#ff4444', font:       '#ffaa00', xmlhttprequest: '#22c55e',
  fetch:  '#3b82f6', document:   '#f472b6', other: '#94a3b8'
};
const DOMAIN_COLORS = ['#00f5c4','#00cfff','#7c3aed','#ffaa00','#ff4444','#22c55e','#3b82f6','#f472b6'];

Chart.defaults.color       = 'rgba(226,232,240,0.5)';
Chart.defaults.borderColor = 'rgba(0,245,196,0.08)';
Chart.defaults.font.family = "'Space Mono', monospace";

const yAxis = cb => ({
  display: true,
  grid:   { color: 'rgba(0,245,196,0.05)' },
  border: { display: false },
  ticks:  { color: 'rgba(230,237,243,0.3)', maxTicksLimit: 4, callback: cb }
});

/* ══════════════════════════════════════════════════════
   FIX CSP: applyDynamic — applies all dynamic styles
   and event handlers AFTER innerHTML is written.
   JS DOM property access is never blocked by CSP.
══════════════════════════════════════════════════════ */
function applyDynamic(root) {
  /* Domain bar widths and colours */
  root.querySelectorAll('[data-fill-pct]').forEach(el => {
    el.style.width      = el.dataset.fillPct + '%';
    el.style.background = el.dataset.fillColor || '#00f5c4';
  });
  /* Type-dot colours */
  root.querySelectorAll('[data-dot-color]').forEach(el => {
    el.style.background = el.dataset.dotColor;
  });
  /* Broken favicon hider — replaces onerror="..." */
  root.querySelectorAll('img[data-favicon]').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });
}

/* ── KPIs ── */
function patchKPIs(data) {
  const { allTabStats, totalBytes, sessionDuration } = data;
  const totalReqs  = allTabStats.reduce((s, t) => s + (t.requestCount || 0), 0);
  const activeTabs = allTabStats.filter(t => !t.closed).length;
  const hogTabs    = allTabStats.filter(t => t.isHog).length;
  const avgEff = allTabStats.length
    ? Math.round(allTabStats.reduce((s, t) => s + (t.efficiencyScore || 0), 0) / allTabStats.length)
    : 100;
  const peakSpeed = allTabStats.reduce((m, t) => Math.max(m, t.peakSpeed || 0), 0);

  document.getElementById('kpi-bytes').textContent = fmtBytes(totalBytes);
  document.getElementById('kpi-reqs').textContent  = totalReqs.toLocaleString();
  document.getElementById('kpi-tabs').textContent  = activeTabs;
  document.getElementById('kpi-hogs').textContent  = hogTabs > 0 ? hogTabs + ' hog(s)' : 'No hogs';
  document.getElementById('kpi-eff').textContent   = avgEff + '%';
  document.getElementById('kpi-dur').textContent   = fmtDuration(sessionDuration);
  document.getElementById('kpi-peak').textContent  = 'Peak: ' + fmtSpeed(peakSpeed);
}

/* ── Timeline ── */
function renderTimeline(timeline) {
  document.getElementById('badge-tl').textContent = timeline.length + ' events';
  const BUCKETS = 60;
  let buckets = Array(BUCKETS).fill(0);
  let labels  = Array(BUCKETS).fill('');
  if (timeline.length >= 2) {
    const tMin = timeline[0].ts, tMax = timeline[timeline.length - 1].ts;
    const range = Math.max(tMax - tMin, 1);
    timeline.forEach(({ ts, bytes }) => {
      buckets[Math.min(Math.floor((ts - tMin) / range * BUCKETS), BUCKETS - 1)] += bytes;
    });
    labels = buckets.map((_, i) => fmtTime(tMin + i * (range / BUCKETS)));
  }
  if (charts.timeline) charts.timeline.destroy();
  charts.timeline = new Chart(document.getElementById('timelineChart'), {
    type: 'line',
    data: { labels, datasets: [{ data: buckets, fill: true,
      backgroundColor: 'rgba(0,245,196,0.08)', borderColor: '#00f5c4',
      borderWidth: 2, pointRadius: 0, tension: 0.4 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: yAxis(v => fmtBytes(v)) } }
  });
}

/* ── Resource types ── */
function renderTypes(globalTypes) {
  const entries = Object.entries(globalTypes || {}).sort((a, b) => b[1] - a[1]);
  if (charts.type) charts.type.destroy();
  charts.type = new Chart(document.getElementById('typeChart'), {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([k]) => TYPE_COLORS[k] || '#94a3b8'),
        borderWidth: 2, borderColor: '#121821' }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } }, cutout: '65%' }
  });

  /* FIX CSP: NO inline style on type-dot.
     Store colour in data-dot-color, applyDynamic sets it via JS. */
  const pillsContainer = document.getElementById('typePills');
  pillsContainer.innerHTML = entries.slice(0, 8).map(([k, v]) => `
    <div class="type-pill">
      <div class="type-dot" data-dot-color="${TYPE_COLORS[k] || '#94a3b8'}"></div>
      <span>${k}</span><span>${fmtBytes(v)}</span>
    </div>`).join('');

  applyDynamic(pillsContainer);
}

/* ── Tab table ── */
function renderTabTable(tabsSorted) {
  document.getElementById('badge-tabs').textContent = tabsSorted.length + ' tabs';
  /* FIX CSP: "hog" label uses CSS class, not inline color style */
  document.getElementById('tabTableBody').innerHTML = tabsSorted.map((tab, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${getTabLabel(tab)}</td>
      <td>${fmtBytes(tab.downloadBytes || tab.totalBytes)}</td>
      <td>${fmtBytes(tab.uploadBytes || 0)}</td>
      <td>${tab.requestCount}</td>
      <td>${tab.efficiencyScore}%</td>
      <td>${tab.isHog ? '<span class="hog-label">\uD83D\uDD25 Hog</span>' : 'Normal'}</td>
      <td class="col-right">${fmtBytes(tab.predicted5m)}</td>
    </tr>`).join('');
}

/* ── Domains ── */
function renderDomains(topDomains) {
  document.getElementById('badge-domains').textContent = topDomains.length + ' domains';
  const max = topDomains.length ? topDomains[0].bytes : 1;

  /* FIX CSP: domain-fill bar uses data-fill-pct and data-fill-color.
     applyDynamic() converts those to element.style.width / .background. */
  const container = document.getElementById('domainList');
  container.innerHTML = topDomains.slice(0, 15).map((d, i) => {
    const pct   = Math.round((d.bytes / max) * 100);
    const color = DOMAIN_COLORS[i % DOMAIN_COLORS.length];
    return `
      <div class="domain-item">
        <div class="domain-name">${d.domain}</div>
        <div class="domain-bar">
          <div class="domain-fill" data-fill-pct="${pct}" data-fill-color="${color}"></div>
        </div>
        <div class="domain-bytes">${fmtBytes(d.bytes)}</div>
      </div>`;
  }).join('');

  applyDynamic(container);
}

/* ── Tab bars ── */
function renderTabBars(tabsSorted) {
  const top8 = tabsSorted.slice(0, 8);
  if (charts.tabBar) charts.tabBar.destroy();
  charts.tabBar = new Chart(document.getElementById('tabBarChart'), {
    type: 'bar',
    data: {
      labels: top8.map(t => getTabLabel(t)),
      datasets: [
        { label: 'Download', data: top8.map(t => t.downloadBytes || t.totalBytes), backgroundColor: 'rgba(0,245,196,0.7)' },
        { label: 'Upload',   data: top8.map(t => t.uploadBytes || 0),              backgroundColor: 'rgba(0,207,255,0.5)' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: 'rgba(230,237,243,0.5)', font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: 'rgba(230,237,243,0.4)', maxRotation: 30 }, grid: { display: false } },
        y: yAxis(v => fmtBytes(v))
      }
    }
  });
}

/* ── Anomalies ── */
function renderAnomalies(anomalies) {
  document.getElementById('badge-anomalies').textContent = anomalies.length || '0';
  const list = document.getElementById('anomalyList');
  if (!anomalies.length) {
    list.innerHTML = '<div class="empty-state">\u2713 No anomalies detected</div>';
    return;
  }
  list.innerHTML = [...anomalies].reverse().slice(0, 20).map(a => `
    <div class="anomaly-item">
      <span class="anomaly-ts">${fmtTime(a.ts)}</span>
      <span>${a.message}</span>
    </div>`).join('');
}

/* ── Predictions ── */
function renderPredictions(tabsSorted) {
  document.getElementById('predictList').innerHTML = tabsSorted.slice(0, 5).map(t => `
    <div class="predict-item">
      <div class="predict-site">${getTabLabel(t)}</div>
      <div class="predict-val">${fmtBytes(t.predicted5m)}</div>
    </div>`).join('');
}

/* ── Settings ── */
function renderSettings(sessionStart, sessionDuration) {
  chrome.storage.local.get(['showFloatingIndicator'], prefs => {
    const showInd = prefs.showFloatingIndicator !== false;

    /* FIX CSP: "session duration" and "auto refresh badge" values
       used CSS classes (dur-val, auto-badge) instead of inline styles */
    document.getElementById('settingsPanel').innerHTML = `
      <div class="settings-row">
        <div>
          <div class="settings-label">Floating Speed Indicator</div>
          <div class="settings-sub">Show live speed widget on every webpage</div>
        </div>
        <button class="toggle ${showInd ? 'on' : ''}" id="toggleIndicator"></button>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Session Started</div>
          <div class="settings-sub">${new Date(sessionStart).toLocaleString()}</div>
        </div>
        <span class="dur-val">${fmtDuration(sessionDuration)}</span>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Auto-Refresh</div>
          <div class="settings-sub">Dashboard updates every 5 seconds</div>
        </div>
        <span class="auto-badge">ON</span>
      </div>`;

    document.getElementById('toggleIndicator').addEventListener('click', e => {
      const next = !e.target.classList.contains('on');
      e.target.classList.toggle('on', next);
      chrome.storage.local.set({ showFloatingIndicator: next });
    });
  });
}

/* ── Master render ── */
function renderDashboard(data) {
  const sorted = [...data.allTabStats].sort((a, b) => b.totalBytes - a.totalBytes);
  patchKPIs(data);
  renderTimeline(data.timeline);
  renderTypes(data.globalTypes);
  renderTabTable(sorted);
  renderDomains(data.topDomains);
  renderTabBars(sorted);
  renderAnomalies(data.anomalies);
  renderPredictions(sorted);
  renderSettings(data.sessionStart, data.sessionDuration);
}

/* ── Fetch ── */
function fetchAndRender() {
  chrome.runtime.sendMessage({ type: 'GET_DASHBOARD_DATA' }, res => {
    if (chrome.runtime.lastError || !res) return;
    dashData = res;
    renderDashboard(res);
  });
}

/* ── Export ── */
function downloadFile(content, filename, type) {
  const a  = document.createElement('a');
  a.href   = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
function exportCSV() {
  if (!dashData) return;
  const rows = [['Domain', 'Bytes', 'Requests']];
  dashData.topDomains.forEach(d => rows.push([d.domain, d.bytes, d.requests]));
  downloadFile(rows.map(r => r.join(',')).join('\n'), 'tabpulse-' + Date.now() + '.csv', 'text/csv');
}
function exportJSON() {
  chrome.runtime.sendMessage({ type: 'GET_EXPORT_DATA' }, res => {
    if (!res) return;
    downloadFile(JSON.stringify(res, null, 2), 'tabpulse-' + Date.now() + '.json', 'application/json');
  });
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  fetchAndRender();
  refreshTimer = setInterval(fetchAndRender, 5000);
  document.getElementById('btnRefresh').addEventListener('click', fetchAndRender);
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
  document.getElementById('btnClear').addEventListener('click', () => {
    if (confirm('Clear all session data?'))
      chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' }, fetchAndRender);
  });
});
