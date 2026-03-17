// content/content.js  v1.3.0
(function () {
  'use strict';

  if (['chrome-extension:','chrome:','edge:','about:'].includes(location.protocol)) return;

  let indicator    = null;
  let updateTimer  = null;
  let isVisible    = false;
  let isDragging   = false;
  let dragOffset   = { x: 0, y: 0 };
  const STORAGE_KEY = 'tabpulse_indicator_pos';

  /* ── create floating widget ── */
  function createIndicator() {
    if (document.getElementById('tabpulse-indicator')) return;

    indicator = document.createElement('div');
    indicator.id = 'tabpulse-indicator';
    indicator.setAttribute('data-tabpulse', 'true');

    const style = document.createElement('style');
    style.textContent = `
      #tabpulse-indicator {
        position:fixed;right:16px;bottom:16px;z-index:2147483647;
        background:rgba(10,14,26,0.93);border:1px solid rgba(0,245,196,0.35);
        border-radius:10px;padding:7px 11px;display:flex;align-items:center;
        gap:8px;font-family:'JetBrains Mono','Fira Code',monospace;
        backdrop-filter:blur(12px);box-shadow:0 4px 20px rgba(0,245,196,0.14);
        cursor:grab;user-select:none;transition:opacity .22s,transform .22s;min-width:120px;
      }
      #tabpulse-indicator.tp-hidden { opacity:0;transform:scale(.82);pointer-events:none; }
      #tabpulse-indicator:active { cursor:grabbing; }
      .tp-dot { width:7px;height:7px;border-radius:50%;background:#00f5c4;box-shadow:0 0 8px #00f5c4;animation:tp-p 1.4s infinite ease-in-out; }
      .tp-dot.idle   { background:#444;box-shadow:none;animation:none; }
      .tp-dot.warn   { background:#ffaa00;box-shadow:0 0 8px #ffaa00; }
      .tp-dot.danger { background:#ff4444;box-shadow:0 0 8px #ff4444; }
      @keyframes tp-p { 0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.35)} }
      .tp-label { font-size:10px;color:rgba(0,245,196,0.55);letter-spacing:.06em;text-transform:uppercase; }
      .tp-speed { font-size:13px;font-weight:700;color:#00f5c4;min-width:62px;text-align:right; }
      .tp-speed.warn   { color:#ffaa00; }
      .tp-speed.danger { color:#ff4444; }
      .tp-close {
        width:14px;height:14px;border-radius:50%;border:none;cursor:pointer;
        font-size:9px;background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.28);
        display:flex;align-items:center;justify-content:center;padding:0;
      }
      .tp-close:hover { background:rgba(255,68,68,0.28);color:#ff4444; }
    `;
    document.head.appendChild(style);

    indicator.innerHTML = `
      <div class="tp-dot" id="tp-dot"></div>
      <span class="tp-label">TabPulse</span>
      <span class="tp-speed" id="tp-speed">\u2014 B/s</span>
      <button class="tp-close" id="tp-close">\u2715</button>
    `;
    document.body.appendChild(indicator);

    const pos = _loadPos();
    if (pos) {
      indicator.style.right  = 'auto';
      indicator.style.bottom = 'auto';
      indicator.style.left   = pos.x + 'px';
      indicator.style.top    = pos.y + 'px';
    }

    document.getElementById('tp-close').addEventListener('click', e => {
      e.stopPropagation();
      hideIndicator();
      /* FIX: when user closes via X, also persist the off state */
      chrome.storage.local.set({ showFloatingIndicator: false });
    });
    indicator.addEventListener('mousedown', _dragStart);
    isVisible = true;
  }

  function hideIndicator() {
    if (!indicator) return;
    indicator.classList.add('tp-hidden');
    setTimeout(() => { indicator?.remove(); indicator = null; }, 230);
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
    isVisible = false;
  }

  function startIndicator() {
    createIndicator();
    updateSpeed();
    updateTimer = setInterval(updateSpeed, 2_000);
  }

  /* ── drag ── */
  function _dragStart(e) {
    if (e.target.id === 'tp-close') return;
    isDragging = true;
    const rect = indicator.getBoundingClientRect();
    dragOffset = { x: e.clientX-rect.left, y: e.clientY-rect.top };
    indicator.style.right  = 'auto';
    indicator.style.bottom = 'auto';
    document.addEventListener('mousemove', _dragMove);
    document.addEventListener('mouseup',   _dragEnd);
    e.preventDefault();
  }
  function _dragMove(e) {
    if (!isDragging) return;
    indicator.style.left = (e.clientX - dragOffset.x) + 'px';
    indicator.style.top  = (e.clientY - dragOffset.y) + 'px';
  }
  function _dragEnd() {
    isDragging = false;
    document.removeEventListener('mousemove', _dragMove);
    document.removeEventListener('mouseup',   _dragEnd);
    _savePos({ x:parseInt(indicator.style.left), y:parseInt(indicator.style.top) });
  }
  function _savePos(p) { try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {} }
  function _loadPos()  { try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)); } catch { return null; } }

  /* ── speed update ── */
  function updateSpeed() {
    if (!indicator || !isVisible) return;
    /* FIX: tabId null → background.js uses sender.tab.id */
    chrome.runtime.sendMessage({ type:'GET_TAB_SPEED', tabId:null }, res => {
      if (chrome.runtime.lastError || !res) return;
      const speed   = res.speed || 0;
      const speedEl = document.getElementById('tp-speed');
      const dotEl   = document.getElementById('tp-dot');
      if (!speedEl || !dotEl) return;

      speedEl.textContent = _fmt(speed);
      dotEl.className     = 'tp-dot';
      speedEl.className   = 'tp-speed';

      if      (speed > 1_048_576) { dotEl.classList.add('danger'); speedEl.classList.add('danger'); }
      else if (speed > 102_400)   { dotEl.classList.add('warn');   speedEl.classList.add('warn');   }
      else if (speed === 0)         dotEl.classList.add('idle');
    });
  }

  function _fmt(bps) {
    if (bps >= 1_048_576) return (bps/1_048_576).toFixed(1) + ' MB/s';
    if (bps >= 1_024)     return (bps/1_024).toFixed(0)     + ' KB/s';
    return bps + ' B/s';
  }

  /* ── init ── */
  chrome.storage.local.get(['showFloatingIndicator'], result => {
    if (result.showFloatingIndicator === false) return;
    if (document.body) startIndicator();
    else document.addEventListener('DOMContentLoaded', startIndicator);
  });

  /* FIX: storage change listener — toggle on/off reliably */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.showFloatingIndicator) return;
    const next = changes.showFloatingIndicator.newValue;
    if (next && !isVisible) {
      if (document.body) startIndicator();
      else document.addEventListener('DOMContentLoaded', startIndicator);
    } else if (!next && isVisible) {
      hideIndicator();
    }
  });

})();
