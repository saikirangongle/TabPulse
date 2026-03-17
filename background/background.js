/**
 * TabPulse — Background Service Worker v1.3.0
 *
 * All previous fixes retained. New fixes:
 * FIX Tab-names:  On startup, query all open tabs and populate tabMeta
 *                 so "Tab 780562875" never appears in the popup/dashboard.
 * FIX tabMeta:    onUpdated and onActivated both refresh title/favicon.
 * IMPROVE:        tabMeta also updated via chrome.tabs.onActivated so
 *                 tab switching always reflects the latest URL.
 */

import { computeSpeedWindow, resetSpeeds }   from "../utils/speedCalculator.js";
import { detectAnomaly, clearAnomalies }      from "../utils/anomalyDetector.js";
import { calculateEfficiencyScore }           from "../utils/efficiencyScore.js";
import { predictNext5Minutes, clearPredictionHistory } from "../utils/predictionEngine.js";

const SESSION_START = Date.now();
const PRUNE_AFTER   = 30_000;

/* ── State ── */
let tabData     = {};
let tabMeta     = {};
let domainStats = {};
let timeline    = [];
let anomalies   = [];
let recentBytes = {};

/* ── Tab Stats Factory ── */
function createTabStats(tabId) {
  return {
    tabId,
    totalBytes: 0, downloadBytes: 0, uploadBytes: 0,
    requestCount: 0, resourceTypes: {}, domains: {},
    peakSpeed: 0, startedAt: Date.now(), lastActivity: Date.now(),
    efficiencyScore: 100, predicted5m: 0,
    isHog: false, closed: false
  };
}

function getOrCreate(tabId) {
  if (!tabData[tabId])    tabData[tabId]     = createTabStats(tabId);
  if (!recentBytes[tabId]) recentBytes[tabId] = [];
  return tabData[tabId];
}

/* ── Helpers ── */
function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return "unknown"; }
}
function getContentLength(headers) {
  if (!headers) return 0;
  for (const h of headers)
    if (h.name?.toLowerCase() === "content-length") return parseInt(h.value, 10) || 0;
  return 0;
}
function estimateSize(type, headers) {
  const cl = getContentLength(headers);
  if (cl > 0) return cl;
  return ({ image:80_000, media:500_000, font:40_000, script:30_000,
            stylesheet:15_000, xmlhttprequest:5_000, fetch:5_000,
            document:25_000, other:2_000 }[type] || 2_000);
}

/* ════════════════════════════════════════════════════════════════
   FIX (Tab-names): Populate tabMeta for all tabs already open
   when the extension loads. Without this, tabs opened before the
   extension was installed or reloaded show as "Tab 780562875".
════════════════════════════════════════════════════════════════ */
chrome.tabs.query({}, (tabs) => {
  for (const tab of tabs) {
    if (tab.id > 0) {
      tabMeta[tab.id] = {
        url:        tab.url        || "",
        title:      tab.title      || "",
        favIconUrl: tab.favIconUrl || ""
      };
    }
  }
});

/* ── Network Monitor ── */
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const { tabId, url, type, method, responseHeaders } = details;
    if (tabId < 0) return;

    const bytes  = estimateSize(type, responseHeaders);
    const domain = extractDomain(url);
    const stats  = getOrCreate(tabId);

    stats.totalBytes += bytes;
    if (method === "POST" || method === "PUT") stats.uploadBytes   += bytes;
    else                                       stats.downloadBytes += bytes;
    stats.requestCount++;
    stats.lastActivity = Date.now();
    stats.resourceTypes[type]  = (stats.resourceTypes[type]  || 0) + bytes;
    stats.domains[domain]      = (stats.domains[domain]      || 0) + bytes;

    if (!domainStats[domain]) domainStats[domain] = { bytes: 0, requests: 0, types: {} };
    domainStats[domain].bytes += bytes;
    domainStats[domain].requests++;
    domainStats[domain].types[type] = (domainStats[domain].types[type] || 0) + bytes;

    recentBytes[tabId].push({ ts: Date.now(), bytes });
    if (recentBytes[tabId].length > 500) {
      const cutoff = Date.now() - PRUNE_AFTER;
      recentBytes[tabId] = recentBytes[tabId].filter(s => s.ts >= cutoff);
    }

    const speed = computeSpeedWindow(tabId, recentBytes);
    if (speed > stats.peakSpeed) stats.peakSpeed = speed;

    stats.efficiencyScore = calculateEfficiencyScore(stats);
    stats.predicted5m     = predictNext5Minutes(stats.totalBytes, stats.startedAt);

    timeline.push({ ts: Date.now(), tabId, bytes, type, domain });
    if (timeline.length > 2_000) timeline.shift();

    const anomaly = detectAnomaly(stats, speed);
    if (anomaly) {
      anomalies.push(anomaly);
      if (anomaly.type === 'BANDWIDTH_HOG') stats.isHog = true;
      chrome.notifications.create('tabpulse_anomaly', {
        type: "basic", iconUrl: chrome.runtime.getURL("icons/icon48.png"),
        title: "TabPulse Alert", message: anomaly.message
      });
    }

    updateBadge();
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

/* ── Badge ── */
function updateBadge() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (!tab) return;
    const speed = computeSpeedWindow(tab.id, recentBytes);
    let text = "";
    if      (speed > 1_048_576) text = (speed/1_048_576).toFixed(1) + "M";
    else if (speed > 1_024)     text = (speed/1_024).toFixed(0)     + "K";
    else if (speed > 0)         text = speed + "B";
    const color = speed > 1_048_576 ? "#ff4444" : speed > 102_400 ? "#ffaa00" : "#00f5c4";
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  });
}
setInterval(updateBadge, 2_000);

/* ── Tab Lifecycle ── */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    tabMeta[tabId] = {
      url:        tab.url        || "",
      title:      tab.title      || "",
      favIconUrl: tab.favIconUrl || ""
    };
  }
  if (changeInfo.status === "loading" && changeInfo.url) {
    tabData[tabId]     = createTabStats(tabId);
    recentBytes[tabId] = [];
  }
});

/* FIX: also update meta when user switches to an existing tab */
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    tabMeta[tabId] = {
      url:        tab.url        || "",
      title:      tab.title      || "",
      favIconUrl: tab.favIconUrl || ""
    };
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabData[tabId]) tabData[tabId].closed = true;
});

/* ── Message API ── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case "GET_TAB_SPEED": {
      const tabId = (msg.tabId != null && msg.tabId >= 0) ? msg.tabId : sender.tab?.id;
      sendResponse({ speed: computeSpeedWindow(tabId, recentBytes) });
      return true;
    }

    case "GET_POPUP_DATA": {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs?.[0];
        const tabId     = activeTab?.id;

        /* FIX: if we still don't have meta for active tab, fetch it now */
        if (tabId && !tabMeta[tabId]?.url) {
          tabMeta[tabId] = {
            url:        activeTab.url        || "",
            title:      activeTab.title      || "",
            favIconUrl: activeTab.favIconUrl || ""
          };
        }

        const topTabs = Object.values(tabData)
          .filter(t => !t.closed)
          .sort((a, b) => b.totalBytes - a.totalBytes)
          .slice(0, 8)
          .map(t => ({
            ...t,
            currentSpeed: computeSpeedWindow(t.tabId, recentBytes),
            meta: tabMeta[t.tabId] || {}
          }));

        sendResponse({
          activeTabId:       tabId,
          activeStats:       tabId && tabData[tabId] ? tabData[tabId] : null,
          activeSpeed:       tabId ? computeSpeedWindow(tabId, recentBytes) : 0,
          activeMeta:        tabMeta[tabId] || {},
          topTabs,
          totalSessionBytes: Object.values(tabData).reduce((s, t) => s + t.totalBytes, 0),
          sessionStart:      SESSION_START,
          anomalies:         anomalies.slice(-5)
        });
      });
      return true;
    }

    case "GET_DASHBOARD_DATA": {
      const allTabStats = Object.values(tabData).map(t => ({
        ...t,
        currentSpeed: computeSpeedWindow(t.tabId, recentBytes),
        meta: tabMeta[t.tabId] || {}
      }));
      const globalTypes = {};
      allTabStats.forEach(t =>
        Object.entries(t.resourceTypes).forEach(([k, v]) => {
          globalTypes[k] = (globalTypes[k] || 0) + v;
        })
      );
      sendResponse({
        allTabStats,
        timeline,
        topDomains: Object.entries(domainStats)
          .sort((a, b) => b[1].bytes - a[1].bytes)
          .slice(0, 20)
          .map(([domain, s]) => ({ domain, ...s })),
        globalTypes,
        anomalies,
        totalBytes:      allTabStats.reduce((s, t) => s + t.totalBytes, 0),
        sessionStart:    SESSION_START,
        sessionDuration: Date.now() - SESSION_START
      });
      return true;
    }

    case "GET_EXPORT_DATA": {
      sendResponse({
        version:           "1.3.0",
        exportedAt:        new Date().toISOString(),
        sessionStart:      SESSION_START,
        sessionDurationMs: Date.now() - SESSION_START,
        totalBytes:        Object.values(tabData).reduce((s, t) => s + t.totalBytes, 0),
        allTabStats:       Object.values(tabData).map(t => ({ ...t, meta: tabMeta[t.tabId] || {} })),
        topDomains:        Object.entries(domainStats)
          .sort((a, b) => b[1].bytes - a[1].bytes)
          .slice(0, 50)
          .map(([domain, s]) => ({ domain, ...s })),
        anomalies,
        recentTimeline: timeline.slice(-200)
      });
      return true;
    }

    case "CLEAR_SESSION": {
      tabData = {}; timeline = []; anomalies = []; domainStats = {}; recentBytes = {};
      resetSpeeds(); clearPredictionHistory(); clearAnomalies();
      sendResponse({ ok: true });
      return true;
    }
  }
});

/* ── Session Snapshot (every minute) ── */
chrome.alarms.create("persist", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "persist") return;
  chrome.storage.local.set({
    lastSession: {
      sessionStart: SESSION_START, savedAt: Date.now(),
      tabData: Object.fromEntries(Object.entries(tabData).map(([k, v]) => [k, {
        totalBytes: v.totalBytes, requestCount: v.requestCount,
        efficiencyScore: v.efficiencyScore, resourceTypes: v.resourceTypes
      }]))
    }
  });
});
