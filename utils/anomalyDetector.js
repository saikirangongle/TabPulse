// utils/anomalyDetector.js
'use strict';

const SPIKE_MULTIPLIER = 4;
const MIN_SPIKE_BYTES  = 200*1024;
const MAX_HISTORY      = 50;

let speedHistory = [];
let anomalyLog   = [];

export function detectAnomaly(tabStats, currentSpeed) {
  recordSpeedSample(currentSpeed);
  if (!tabStats.isHog) {
    const hog = detectBandwidthHog(tabStats);
    if (hog) return hog;
  }
  return detectSpike(tabStats.tabId, currentSpeed);
}

export function recordSpeedSample(speedBytes) {
  speedHistory.push(speedBytes);
  if (speedHistory.length > MAX_HISTORY) speedHistory.shift();
}

export function detectSpike(tabId, currentSpeed) {
  if (speedHistory.length < 5) return null;
  const avg = speedHistory.reduce((a,b)=>a+b,0) / speedHistory.length;
  if (currentSpeed > avg*SPIKE_MULTIPLIER && currentSpeed > MIN_SPIKE_BYTES)
    return _push({ id:crypto.randomUUID(), type:'SPEED_SPIKE', tabId, speed:currentSpeed,
                   avgSpeed:Math.round(avg), ts:Date.now(),
                   message:`Speed spike on tab ${tabId}: ${_fmt(currentSpeed)}` });
  return null;
}

export function detectBandwidthHog(tabStats) {
  if (tabStats.totalBytes >= 50*1024*1024)
    return _push({ id:crypto.randomUUID(), type:'BANDWIDTH_HOG', tabId:tabStats.tabId,
                   totalBytes:tabStats.totalBytes, ts:Date.now(),
                   message:`Tab ${tabStats.tabId} exceeded 50MB` });
  return null;
}

export function getAnomalies()   { return anomalyLog; }
export function clearAnomalies() { anomalyLog=[]; speedHistory=[]; }

function _push(obj) { anomalyLog.push(obj); if(anomalyLog.length>50) anomalyLog.shift(); return obj; }
function _fmt(bps) {
  if(bps>=1048576) return (bps/1048576).toFixed(2)+' MB/s';
  if(bps>=1024)    return (bps/1024).toFixed(1)+' KB/s';
  return bps+' B/s';
}
