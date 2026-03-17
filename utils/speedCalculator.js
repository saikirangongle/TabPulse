// utils/speedCalculator.js
'use strict';

const MAX_SAMPLES = 20;
const WINDOW_MS   = 5000;

let tabSpeedState = new Map();
let globalState   = { lastBytes:0, lastTs:0, samples:[] };

export function computeSpeedWindow(tabId, recentBytesMap) {
  if (tabId == null || !recentBytesMap[tabId]) return 0;
  const now    = Date.now();
  const cutoff = now - WINDOW_MS;
  const samples = recentBytesMap[tabId].filter(s => s.ts >= cutoff);
  if (!samples.length) return 0;
  const total  = samples.reduce((s, e) => s + e.bytes, 0);
  const window = Math.max(now - samples[0].ts, 1000);
  return Math.round(total / (window / 1000));
}

export function calculateTabSpeed(tabId, totalBytes) {
  const now = Date.now();
  if (!tabSpeedState.has(tabId)) {
    tabSpeedState.set(tabId, { lastBytes:totalBytes, lastTs:now, samples:[] });
    return 0;
  }
  const st = tabSpeedState.get(tabId);
  const db = totalBytes - st.lastBytes, dt = now - st.lastTs;
  st.lastBytes = totalBytes; st.lastTs = now;
  if (dt <= 0 || db < 0) return 0;
  const spd = db / (dt/1000);
  st.samples.push(spd);
  if (st.samples.length > MAX_SAMPLES) st.samples.shift();
  return _avg(st.samples);
}

export function calculateGlobalSpeed(totalBytes) {
  const now = Date.now();
  if (!globalState.lastTs) { globalState.lastBytes=totalBytes; globalState.lastTs=now; return 0; }
  const db = totalBytes - globalState.lastBytes, dt = now - globalState.lastTs;
  globalState.lastBytes=totalBytes; globalState.lastTs=now;
  if (dt<=0||db<0) return 0;
  const spd = db/(dt/1000);
  globalState.samples.push(spd);
  if (globalState.samples.length > MAX_SAMPLES) globalState.samples.shift();
  return _avg(globalState.samples);
}

export function resetSpeeds() {
  tabSpeedState.clear();
  globalState = { lastBytes:0, lastTs:0, samples:[] };
}

function _avg(arr) {
  return arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;
}
