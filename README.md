<div align="center">

<img src="icons/icon128.png" alt="TabPulse Logo" width="96" height="96"/>

# TabPulse

**Intelligent Tab-Level Bandwidth Analytics for Chrome**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Version](https://img.shields.io/badge/Version-1.5.0-00f5c4?style=flat-square)](https://github.com/YOUR_USERNAME/tabpulse/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-110+-green?style=flat-square&logo=googlechrome)](https://www.google.com/chrome/)
[![CSP Clean](https://img.shields.io/badge/CSP-Clean-success?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/mv3-overview/)

A Chrome Extension that monitors real-time bandwidth usage per tab — with live speed tracking, anomaly detection, predictive analytics, an efficiency scoring engine, and a full visual dashboard. Built to be Chrome Web Store ready: fully Manifest V3 compliant with zero CSP violations.

[Features](#-features) · [Architecture](#-architecture) · [Installation](#-installation) · [Project Structure](#-project-structure) · [Technical Highlights](#-technical-highlights) · [Screenshots](#-screenshots)

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 📊 **Real-time Monitoring** | Tracks network bytes per tab as requests complete via `chrome.webRequest` |
| ⚡ **Live Speed Indicator** | Floating draggable widget on every page showing current KB/s or MB/s |
| 🔥 **Bandwidth Hog Detection** | Flags any tab that exceeds 50 MB in a session |
| 📈 **5-Minute Usage Prediction** | Linear rate projection of future bandwidth consumption |
| 🧠 **Efficiency Score** | 0–100 score per tab based on payload size, request volume, and resource mix |
| 📉 **Anomaly Detection** | Detects speed spikes (4× moving average) and notifies via Chrome notifications |
| 🖥️ **Full Analytics Dashboard** | Timeline chart, resource type doughnut, tab comparison table, domain leaderboard, anomaly log |
| ↓↑ **Upload + Download Tracking** | Separately tracks ingress and egress bytes per tab |
| 📦 **CSV & JSON Export** | Full session data export from the dashboard |
| 🔔 **Desktop Notifications** | Instant alert when anomalies are detected |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CHROME BROWSER                          │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Background Service Worker                   │   │
│  │  chrome.webRequest.onCompleted ──► estimateSize()        │   │
│  │           │                                              │   │
│  │    ┌──────▼──────────────────────────────────┐          │   │
│  │    │            Per-Tab State                │          │   │
│  │    │  totalBytes / downloadBytes / upload    │          │   │
│  │    │  resourceTypes / domains / timeline     │          │   │
│  │    └──────┬───────────────────────────────── ┘          │   │
│  │           │                                              │   │
│  │    ┌──────▼────────────────────────────────────┐        │   │
│  │    │           Intelligence Modules             │        │   │
│  │    │  speedCalculator  → sliding 5-sec window   │        │   │
│  │    │  anomalyDetector  → spike + hog detection  │        │   │
│  │    │  efficiencyScore  → 0-100 bandwidth score  │        │   │
│  │    │  predictionEngine → linear rate forecast   │        │   │
│  │    └──────────────────────────────────────────  ┘        │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │ chrome.runtime.sendMessage          │
│         ┌─────────────────┼──────────────────┐                  │
│         ▼                 ▼                  ▼                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐       │
│  │  Popup UI   │  │  Dashboard   │  │  Content Script  │       │
│  │  popup.html │  │  dashboard   │  │  Floating speed  │       │
│  │  popup.js   │  │  .html / .js │  │  indicator       │       │
│  └─────────────┘  └──────────────┘  └──────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. `chrome.webRequest.onCompleted` fires for every network response across all tabs
2. `estimateSize()` extracts `Content-Length` header or uses resource-type fallback estimates
3. Per-tab stats accumulate in the service worker's in-memory state
4. Every request triggers `speedCalculator` → `anomalyDetector` → `efficiencyScore` → `predictionEngine`
5. Popup and Dashboard query the service worker via message passing (`GET_POPUP_DATA`, `GET_DASHBOARD_DATA`)
6. Content script polls the service worker every 2 seconds for the floating indicator speed

---

## 🧠 Intelligence Modules

### `speedCalculator.js`
Maintains a 5-second sliding window of raw byte samples per tab. Calculates true bytes/second rather than a simple delta, giving smooth, accurate real-time speed values that don't spike on large single requests.

### `anomalyDetector.js`
Tracks a rolling history of 50 speed samples. Flags a **speed spike** if the current reading exceeds 4× the moving average AND is above 200 KB/s. Flags a **bandwidth hog** when any tab crosses 50 MB total. Returns a structured anomaly object with type, timestamp, and human-readable message.

### `efficiencyScore.js`
Produces a 0–100 score for each tab using four weighted penalties:
- Average payload size per request (up to −40 pts)
- Excessive request count (up to −25 pts)
- High media/image ratio (up to −15 pts)
- Script-heavy pages (up to −10 pts)

### `predictionEngine.js`
Uses linear rate projection: `(totalBytes / elapsedMs) × 5min_in_ms`. Simple, interpretable, and accurate for steady-state browsing sessions. Also supports trend-based history projection.

---

## 📁 Project Structure

```
TABPULSE/
│
├── manifest.json              # MV3 manifest — permissions, icons, CSP
│
├── background/
│   └── background.js          # Service worker — network monitor + message API
│
├── content/
│   └── content.js             # Floating draggable speed indicator
│
├── dashboard/
│   ├── dashboard.html         # Full analytics page
│   ├── dashboard.js           # Charts, tables, export logic (CSP-clean)
│   └── minChart.js            # Bundled local chart library (line/doughnut/bar)
│
├── popup/
│   ├── popup.html             # Extension popup
│   └── popup.js               # Live speed, top tabs, sparkline (CSP-clean)
│
├── styles/
│   ├── dashboard.css          # Dashboard theme (dark, Space Mono)
│   └── popup.css              # Popup theme
│
├── utils/
│   ├── speedCalculator.js     # Sliding-window bytes/sec
│   ├── anomalyDetector.js     # Spike + hog detection
│   ├── efficiencyScore.js     # 0–100 bandwidth efficiency
│   └── predictionEngine.js   # 5/10-minute usage forecast
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── data/
    └── sample-session.json    # Mock data for UI testing
```

---

## ⚙️ Installation

### Load as unpacked extension (Development)

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/tabpulse.git

# 2. Open Chrome and navigate to
chrome://extensions

# 3. Enable Developer Mode (top-right toggle)

# 4. Click "Load Unpacked"

# 5. Select the TABPULSE folder
```

### Requirements
- Chrome 110 or later
- No build step required — pure vanilla JavaScript

---

## 🔐 Permissions Explained

| Permission | Why it's needed |
|---|---|
| `webRequest` | Intercept network responses to measure bytes transferred |
| `tabs` | Identify which tab triggered each request; read tab titles and URLs |
| `storage` | Persist floating indicator toggle preference across sessions |
| `activeTab` | Access metadata for the currently focused tab |
| `alarms` | Periodic 1-minute session snapshot to `chrome.storage.local` |
| `notifications` | Show desktop alert when an anomaly (spike/hog) is detected |
| `scripting` | Reserved for future content-script injection features |

---

## 🛡 Technical Highlights

### Manifest V3 + CSP Compliance
All code is fully compliant with Chrome's strict Manifest V3 Content Security Policy:

- **No CDN scripts** — Chart.js replaced with a bundled local canvas renderer (`minChart.js`)
- **No inline styles** — Dynamic visual values stored as `data-*` attributes and applied via `element.style.X = Y` (JS DOM access is never blocked by CSP)
- **No inline event handlers** — `onerror="..."` replaced with `addEventListener('error', ...)` attached after render
- **PNG icons only** — Chrome rejects SVG in manifest `icons` and notification `iconUrl`
- **`chrome.runtime.getURL()`** — All internal asset paths use the absolute extension URL

### Memory Safety
- `recentBytes` ring-buffer pruned to last 30 seconds on every push — prevents unbounded memory growth
- Timeline capped at 2,000 events with `Array.shift()`
- `CLEAR_SESSION` resets all module-level state: `speedCalculator`, `predictionEngine`, `anomalyDetector`

### Startup Correctness
`chrome.tabs.query({})` on service worker startup pre-populates `tabMeta` for all already-open tabs, ensuring site names display immediately without waiting for tab navigation events.

---

## 📊 Screenshots

> Add screenshots here after loading the extension

| Popup | Dashboard |
|---|---|
| ![Popup](docs/popup.png) | ![Dashboard](docs/dashboard.png) |

---

## 🚀 Roadmap

- [ ] Export PDF analytics report
- [ ] Per-domain throttling suggestions  
- [ ] AI-based anomaly classification
- [ ] Historical session comparison (IndexedDB)
- [ ] Weekly bandwidth summary notification
- [ ] Dark/light theme toggle

---

## 🛠 Built With

- **Vanilla JavaScript (ES Modules)** — No framework, no bundler, no dependencies
- **Chrome Extension Manifest V3** — Service worker architecture
- **Custom Canvas Chart Engine** — `minChart.js` (line, doughnut, bar) — zero external dependencies
- **CSS Grid & Flexbox** — Responsive dark-theme UI
- **Space Mono + DM Sans** — Typography via Google Fonts CSS `@import`

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 👨‍💻 Author

Built as a portfolio project demonstrating:
- Chrome Extension architecture (MV3)
- Real-time data processing in a service worker
- CSP-compliant dynamic UI rendering
- Signal processing (sliding window, moving average)
- Predictive analytics with linear projection

---

<div align="center">

**Monitor smart. Browse smarter. ⚡**

⭐ Star this repo if you found it useful!

</div>
