# CanIGoIn

Chrome extension with unified Rust server for network monitoring, clickfix detection, YouTube channel whitelisting, and extension tracking.

---

## 📁 Project Structure

```
CanIGoIn/
├── extension/          # Chrome Extension
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── youtube-blocker.js
│   ├── extension-monitor.js
│   ├── popup.html / popup.js
│   └── ... (icons, etc.)
├── server/             # Unified Rust Server
│   ├── Cargo.toml
│   ├── src/main.rs
│   ├── schema.sql
│   └── README.md
├── examples/           # Test pages (clickfix, JS execution)
│   ├── index.html
│   ├── test-script.js
│   └── README.md
└── docs/                # Documentation
    ├── README.md
    ├── QUICKSTART.md
    └── ... (all guides)
```

---

## 🚀 Quick Start

### 1. Start Server (Simple Mode)

```bash
cd server
cargo run --release
```

Server runs on `http://127.0.0.1:8080` with no setup required.

### 2. Install Extension

- Open Chrome → `chrome://extensions/`
- Enable **Developer mode**
- Click **Load unpacked** → select the `extension` folder

### 3. Configure Extension

- Click the extension icon → **Settings**
- **Server URL**: `http://localhost:8080/api/logs` (default)
- **Features**: Enable only what you need (Report URLs, JS execution, Clickfix, Extension monitoring)
- **YouTube**: Optional channel whitelist (only listed channels allowed)
- Save

**Done!** The extension sends logs and events to the server. Use **Client ID** (in Settings) to identify this browser across sessions.

---

## ✨ Features

### Chrome Extension

**Feature toggles (no slow delay when server is unavailable)**  
- **Report URLs** – Send network request logs to the server (off by default)
- **JS execution** – Report external script loads (script tags with `src`) to `/api/extensions` (on by default)
- **Clickfix** – Detect clipboard/copy-based social engineering (e.g. PowerShell in console) and report to `/api/security` (on by default)
- **Extension monitoring** – Report extension install/uninstall/update to `/api/extensions` (off by default)

**Core**  
- **Client ID** – Persistent identifier sent in all requests (`/api/logs`, `/api/extensions`, `/api/security`); visible in Settings, copy/generate.
- **Compression** – Batches sent as gzip when enabled; server decompresses automatically.
- **Timeout** – Requests abort after 5s so the extension doesn’t hang when the server is down.
- **Blocklist** – URL patterns and (legacy) YouTube blocklist from server; optional domain whitelist to reduce logging.

**YouTube channel whitelist**  
- **Whitelist mode** – Only channels in the list are allowed; all others are hidden or blocked.
- **Where it applies**: Home/search results (video tiles), channel pages (e.g. `/@PirateSoftware/videos`), and **direct watch links** (`/watch?v=...`). Non-whitelisted watch pages show a full-screen “channel not in whitelist” overlay and no playback.
- **Matching** – Handles and display names are normalized (e.g. `@PirateSoftware` matches “Pirate Software”). Supports `/channel/ID`, `/@handle`, `/user/name`.
- **Empty whitelist** – If whitelist is enabled but empty, all YouTube content is hidden/blocked.

**Security**  
- **Clickfix detection** – Detects suspicious copy-paste (PowerShell, base64, etc.) and sends events to `POST /api/security`.
- **Extension security scan** – Optional; results sent to `/api/security`.

### Rust Server

**Modes**  
- **Simple** – In-memory, zero config, last 1000 logs; ideal for testing.
- **Production** – PostgreSQL (and optional Redis), unlimited storage, `client_id` stored with logs and extension events.

**Endpoints**  
- `GET /health` – Health check.
- `POST /api/logs` – Batch network logs (optional gzip, optional `client_id`).
- `GET /api/logs` – Get logs (simple mode only).
- `GET /api/blocklist` / `POST /api/blocklist` – URL and YouTube blocklist.
- `POST /api/extensions` – Extension lifecycle/monitoring events (optional gzip, `client_id`).
- `POST /api/security` – Security events (clickfix, extension security scan); same JSON shape as extensions, optional gzip and `client_id`.

**Behavior**  
- **Gzip** – All POST bodies that send JSON accept `Content-Encoding: gzip`; on decompress error the server falls back to plain UTF-8 (no 400).
- **client_id** – Stored in production for logs and extension_events; used for correlation and analytics.

See **`server/README.md`** for full API and schema.

---

## How it works (technical)

### Content script vs page context (isolated worlds)

Chrome extensions run **content scripts** in an **isolated world**: they share the **DOM** with the page but have a **separate JavaScript context**. So:

- **Content script** (`content.js`) can listen to DOM events (e.g. `copy`) and see the same `document` as the page.
- **Content script** cannot see when the **page’s** JavaScript calls `navigator.clipboard.writeText()` or `eval()` — the page uses its own `navigator` and `window`, so overrides in the content script world are never used by page code.

### Clickfix detection

1. **Copy (primary)**  
   The user selects text and copies (Ctrl+C). The **copy** event fires on the document. The content script listens with `document.addEventListener('copy', ...)`, reads the selection, runs clickfix pattern detection, and sends the result to the background → `POST /api/security`. No injection needed; the DOM event is shared.

2. **Programmatic clipboard write (secondary)**  
   When **page** code calls `navigator.clipboard.writeText(text)`, that runs in the page world, so the content script’s override of `writeText` is never called. To detect it we **inject a script into the page context**:
   - The content script adds a `<script src=".../page-context-clipboard.js">` to the document. That script is loaded from the extension (via `web_accessible_resources`) and runs in the **page** world.
   - The injected script overrides `navigator.clipboard.writeText` in the page world. When the page calls it, our override runs, calls the real `writeText`, then dispatches a **custom DOM event** (e.g. `__extensionClipboardWriteText`) with `detail: { text }`.
   - The content script listens for that event on `document`. Because the event is on the shared DOM, the content script receives it, runs clickfix detection on `e.detail.text`, and sends to the background → `POST /api/security`.

We use a **separate script file** (not inline script) so the page’s Content Security Policy does not block execution (inline script would require a nonce/hash).

### JS execution (external scripts only)

The content script observes the DOM for `<script src="...">` elements (via MutationObserver and `document.createElement` override). When an external script is loaded, it sends `javascript_execution` to the background → `POST /api/extensions`. This stays entirely in the content script world; no page-context injection is used for script loading.

### Event flow summary

| Source | Where it runs | How content script sees it | Then |
|--------|----------------|----------------------------|------|
| User copies text | DOM `copy` event | Content script listens on `document` | Detect clickfix → background → `/api/security` |
| Page calls `writeText()` | Page world | Injected script overrides, dispatches custom event; content script listens | Detect clickfix → background → `/api/security` |
| External script load | DOM (script tag) | Content script observes DOM / script elements | background → `/api/extensions` |

### YouTube whitelist

The extension injects `youtube-blocker.js` only on `*://*.youtube.com/*`. It reads the whitelist from `chrome.storage`, hides or shows video elements and the watch page based on channel (from links or page URL), and blocks the watch page with a full-screen overlay when the channel is not whitelisted.

---

## 📖 Documentation

- **`docs/README.md`** – Full installation and usage.
- **`docs/QUICKSTART.md`** – Short setup.
- **`server/README.md`** – Server API, modes, schema, troubleshooting.
- **`examples/README.md`** – How to run the test page (clickfix, JS execution) and what to expect on the server.

---

## 🎯 Use Cases

- **Personal** – Limit YouTube to whitelisted channels, reduce distraction, basic privacy.
- **Corporate** – Network and extension monitoring, security event collection (clickfix), audit by `client_id`.
- **Security research** – Traffic inspection, extension behavior, threat detection.

---

## 📊 API Summary

| Endpoint           | Method | Purpose                    |
|--------------------|--------|----------------------------|
| `/health`          | GET    | Health check               |
| `/api/logs`        | POST   | Batch network logs (gzip, client_id) |
| `/api/logs`        | GET    | Get logs (simple mode)     |
| `/api/blocklist`   | GET    | Get blocklist              |
| `/api/blocklist`   | POST   | Update blocklist           |
| `/api/extensions`  | POST   | Extension events (gzip, client_id) |
| `/api/security`    | POST   | Security events (gzip, client_id) |

---

## 📦 Installation (full)

```bash
# 1. Start server
cd server
cargo run --release

# 2. Load extension
# chrome://extensions/ → Load unpacked → extension/

# 3. Configure
# Icon → Settings: Server URL, Features, YouTube whitelist, Client ID
# Save

# 4. Test (optional)
# Open examples/index.html (e.g. http://localhost:9000/) to trigger clickfix/JS events
```

---

## 🐛 Troubleshooting

- **Extension slow when server is down** – Ensure “Report URLs” is off if you don’t need it; requests timeout after 5s.
- **YouTube whitelist not applied** – Reload extension and refresh YouTube; ensure “Enable YouTube Channel Whitelist” is on and channels are saved (e.g. `@PirateSoftware`).
- **Direct watch link still plays** – Reload the page; the overlay runs after the owner/channel is in the DOM (retries at 200ms, 600ms, 1200ms).
- **Server “invalid gzip”** – Server does not return 400; it falls back to plain JSON. Check client sends valid gzip when using `Content-Encoding: gzip`.

More: **`server/README.md`**, **`docs/README.md`**.

---

## ✅ Summary

| Component   | What you get |
|------------|----------------|
| **Extension** | Feature toggles, Client ID, gzip, YouTube whitelist (feeds + watch + channel pages), clickfix → `/api/security`, extension events → `/api/extensions` |
| **Server**    | Simple + Production modes, `/api/logs`, `/api/extensions`, `/api/security`, gzip decompression, `client_id` storage in production |
| **Docs**      | READMEs, API docs, examples, troubleshooting |

---

**For detailed instructions:**  
- **Extension & usage**: `docs/README.md`  
- **Server**: `server/README.md`  
- **Quick setup**: `docs/QUICKSTART.md`  
- **Test page**: `examples/README.md`
