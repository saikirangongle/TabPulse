// popup/popup.js  v1.5.0  (CSP-clean)
'use strict';
const $ = id => document.getElementById(id);

let refreshInterval = null;
let speedHistory    = [];
const MAX_SPARK     = 30;

/* ── formatters ── */
function fmtBytes(b) {
  if (!b || b === 0)     return '0 B';
  if (b < 1024)          return b + ' B';
  if (b < 1048576)       return (b / 1024).toFixed(1)       + ' KB';
  if (b < 1073741824)    return (b / 1048576).toFixed(2)    + ' MB';
  return                        (b / 1073741824).toFixed(2) + ' GB';
}
function fmtSpeed(bps) {
  if (!bps || bps === 0) return { val: '0',                          unit: 'B/s',  cls: '' };
  if (bps >= 1048576)    return { val: (bps / 1048576).toFixed(2),  unit: 'MB/s', cls: 'danger' };
  if (bps >= 102400)     return { val: (bps / 1024).toFixed(0),     unit: 'KB/s', cls: 'warn' };
  if (bps >= 1024)       return { val: (bps / 1024).toFixed(1),     unit: 'KB/s', cls: '' };
  return { val: bps.toString(), unit: 'B/s', cls: '' };
}
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
function getDomain(url) {
  if (!url) return '';
  if (url.startsWith('chrome://newtab'))     return 'New Tab';
  if (url.startsWith('chrome://'))           return 'Chrome Internal';
  if (url.startsWith('about:'))              return 'about:' + url.split(':')[1];
  if (url.startsWith('file://'))             return 'Local File';
  if (url.startsWith('chrome-extension://')) return 'Extension';
  try { return (new URL(url).hostname || '').replace(/^www\./, '') || url.slice(0, 25); }
  catch { return url.length > 25 ? url.slice(0, 25) + '\u2026' : url; }
}
function getTabLabel(meta, tabId) {
  const d = getDomain(meta && meta.url ? meta.url : '');
  if (d) return d;
  if (meta && meta.title && meta.title.trim()) return meta.title.trim().slice(0, 35);
  return 'Unknown Tab';
}

/* ── sparkline ── */
function drawSparkline(canvas, data) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  if (data.length < 2) return;
  const max = Math.max.apply(null, data.concat([1]));
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,245,196,0.3)');
  grad.addColorStop(1, 'rgba(0,245,196,0)');
  ctx.beginPath(); ctx.moveTo(0, h);
  data.forEach((v, i) => ctx.lineTo((i / (data.length - 1)) * w, h - (v / max) * (h - 4) - 2));
  ctx.lineTo(w, h); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w, y = h - (v / max) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#00f5c4'; ctx.lineWidth = 2; ctx.stroke();
}

/* ── toggle button visual ── */
function syncToggleBtn(isOn) {
  const btn = $('btnToggleIndicator');
  if (!btn) return;
  btn.textContent  = isOn ? '\u25c9' : '\u25ce';
  btn.title        = isOn ? 'Hide floating indicator' : 'Show floating indicator';
  /* FIX CSP: set style via JS property, not HTML attribute */
  btn.style.color       = isOn ? 'var(--accent)' : '';
  btn.style.borderColor = isOn ? 'rgba(0,245,196,0.3)' : '';
}

/* ══════════════════════════════════════════════════════
   FIX CSP: applyDynamic — called AFTER innerHTML is set.
   Sets all dynamic visual properties via JS DOM API
   (element.style.X = Y), which is never blocked by CSP.
   Also attaches img error listeners (replaces onerror="...").
══════════════════════════════════════════════════════ */
function applyDynamic(root) {
  /* bar-fill widths */
  root.querySelectorAll('[data-bar-pct]').forEach(el => {
    el.style.width = el.dataset.barPct + '%';
  });
  /* img onerror — hide broken favicons */
  root.querySelectorAll('img[data-favicon]').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });
}

/* ── render ── */
function renderPopup(data) {
  const { activeStats, activeSpeed, activeMeta, topTabs,
          totalSessionBytes, sessionStart, anomalies } = data;

  speedHistory.push(activeSpeed || 0);
  if (speedHistory.length > MAX_SPARK) speedHistory.shift();

  const speed         = fmtSpeed(activeSpeed);
  const elapsed       = Date.now() - sessionStart;
  const reqCount      = (activeStats && activeStats.requestCount)  || 0;
  const effScore      = (activeStats && activeStats.efficiencyScore != null) ? activeStats.efficiencyScore : 100;
  const favIcon       = (activeMeta && activeMeta.favIconUrl) ? activeMeta.favIconUrl : '';
  const isHog         = (activeStats && activeStats.isHog) || false;
  const maxBytes      = topTabs.length ? (topTabs[0].totalBytes || 1) : 1;
  const recentAnomaly = (anomalies && anomalies.length) ? anomalies[anomalies.length - 1] : null;
  const siteLabel     = getDomain((activeMeta && activeMeta.url) ? activeMeta.url : '') || getTabLabel(activeMeta, data.activeTabId);
  const siteUrl       = (activeMeta && activeMeta.url) ? activeMeta.url : '';

  /* FIX CSP:
     - NO style="..." attributes anywhere in this HTML string
     - NO onerror="..." attributes anywhere
     - Dynamic visual values stored in data-* attributes
     - applyDynamic() will convert those to element.style.* calls */
  const html = `
    ${recentAnomaly ? '<div class="anomaly-banner visible">\u26a0 ' + recentAnomaly.message + '</div>' : ''}

    <div class="hero">
      <div class="hero-label">Active Tab</div>
      <div class="hero-site">
        ${favIcon ? '<img class="favicon" src="' + favIcon + '" data-favicon="1" alt="">' : ''}
        <span class="site-name" title="${siteUrl}">${siteLabel}</span>
        ${isHog ? '<span class="site-hog">\uD83D\uDD25 HOG</span>' : ''}
      </div>
      <div class="speed-row">
        <span class="speed-val ${speed.cls}">${speed.val}</span>
        <span class="speed-unit">${speed.unit}</span>
      </div>
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">\u2193 Download</div>
          <div class="stat-val">${fmtBytes(activeStats && activeStats.downloadBytes != null ? activeStats.downloadBytes : (activeStats && activeStats.totalBytes))}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">\u2191 Upload</div>
          <div class="stat-val upload-val">${fmtBytes(activeStats && activeStats.uploadBytes)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Requests</div>
          <div class="stat-val">${reqCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Efficiency</div>
          <div class="stat-val">${effScore}%</div>
        </div>
      </div>
    </div>

    <div class="sparkline-wrap">
      <div class="sparkline-label">Live Speed</div>
      <canvas id="sparklineCanvas"></canvas>
    </div>

    <div class="tabs-section">
      <div class="section-header">
        <span class="section-title">Top Tabs by Usage</span>
        <span class="tab-count">${topTabs.length}</span>
      </div>
      <div class="tab-list">
        ${topTabs.map((tab, i) => {
          const meta     = tab.meta || {};
          const tabTitle = getTabLabel(meta, tab.tabId);
          const tabSpd   = fmtSpeed(tab.currentSpeed);
          const barPct   = Math.round((tab.totalBytes / maxBytes) * 100);
          const isActive = tab.tabId === data.activeTabId;
          const favicon  = meta.favIconUrl || '';
          return `
            <div class="tab-item ${isActive ? 'active-tab' : ''}">
              <span class="tab-rank">${i + 1}</span>
              ${favicon
                ? '<img class="tab-favicon" src="' + favicon + '" data-favicon="1" alt="">'
                : '<div class="tab-favicon"></div>'}
              <div class="tab-info">
                <div class="tab-title">${tabTitle}</div>
                <div class="bar-bg">
                  <div class="bar-fill" data-bar-pct="${barPct}"></div>
                </div>
              </div>
              <div class="tab-metrics">
                <div class="tab-bytes">${fmtBytes(tab.totalBytes)}</div>
                <div class="tab-speed-badge ${tab.currentSpeed > 1024 ? 'active' : 'idle'}">
                  ${tab.currentSpeed > 1024 ? tabSpd.val + tabSpd.unit : 'idle'}
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <div class="footer">
      <div class="session-info">
        Session: <span class="session-val">${fmtBytes(totalSessionBytes)}</span> &bull; ${fmtDuration(elapsed)}
      </div>
      <button class="btn-dashboard" id="btnDashboard">Full Dashboard \u2192</button>
    </div>
  `;

  const mc = $('mainContent');
  mc.innerHTML = html;

  /* Apply all dynamic styles + event listeners AFTER innerHTML is set */
  applyDynamic(mc);

  drawSparkline($('sparklineCanvas'), speedHistory);

  const btnD = $('btnDashboard');
  if (btnD) {
    btnD.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    });
  }
}

function fetchAndRender() {
  chrome.runtime.sendMessage({ type: 'GET_POPUP_DATA' }, res => {
    if (chrome.runtime.lastError || !res) return;
    renderPopup(res);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  fetchAndRender();
  refreshInterval = setInterval(fetchAndRender, 2000);

  chrome.storage.local.get(['showFloatingIndicator'], res => {
    syncToggleBtn(res.showFloatingIndicator !== false);
  });

  $('btnToggleIndicator').addEventListener('click', () => {
    chrome.storage.local.get(['showFloatingIndicator'], res => {
      const next = !(res.showFloatingIndicator !== false);
      chrome.storage.local.set({ showFloatingIndicator: next });
      syncToggleBtn(next);
    });
  });

  $('btnClearSession').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' }, () => {
      speedHistory = [];
      fetchAndRender();
    });
  });
});

window.addEventListener('beforeunload', () => {
  if (refreshInterval) clearInterval(refreshInterval);
});
