# TabPulse v1.5.0  (Chrome Web Store ready)

## All CSP violations eliminated (v1.5.0)

Chrome MV3 enforces a strict Content Security Policy that blocks three things
in HTML markup:

| Violation Type | Where it appeared | Fix |
|---|---|---|
| `inline event handler` | `onerror="this.style.display='none'"` on every `<img>` tag in popup.js / dashboard.js | Removed. After innerHTML is set, `querySelectorAll('img[data-favicon]')` attaches `addEventListener('error', ...)` via JS DOM (never CSP-blocked) |
| `inline style` | `style="width:${pct}%"`, `style="background:${color}"`, `style="color:#ff4d4f"` etc. in template literals | Removed. Dynamic values stored in `data-fill-pct`, `data-fill-color`, `data-dot-color` attributes. `applyDynamic()` converts them to `element.style.X = Y` via JS DOM (never CSP-blocked) |
| `inline style` (static) | `style="grid-column:span 2"`, `style="text-align:right"` in HTML | Replaced with CSS classes `.span-2`, `.col-right`, `.hog-label`, `.dur-val`, `.auto-badge` |
| Notification icon path | `iconUrl: "icons/icon48.png"` (relative path fails in service worker) | Changed to `chrome.runtime.getURL("icons/icon48.png")` |
| Custom CSP in manifest | Previous version added a custom CSP that conflicted with Chrome defaults | Removed entirely — MV3 default CSP is correct and sufficient |

## Key architectural rule applied throughout
> **CSP blocks HTML-level inline styles and handlers.**  
> **CSP never blocks JS DOM property access.**  
> So: render HTML without styles, then call `element.style.X = Y` after.

## Installation
1. Chrome → `chrome://extensions` → Developer Mode → Load Unpacked → `TABPULSE_V5`
