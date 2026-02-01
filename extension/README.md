# 🛡️ CanIGoIn – Chrome Extension

Network monitoring, clickfix detection, YouTube channel whitelisting, and extension tracking.

---

## 🚀 Quick Install

1. Open **Chrome** → `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension` folder
5. Done!

---

## ⚙️ Configuration

1. Click the extension icon → **Settings**
2. **Server URL**: `http://localhost:8080/api/logs` (default)
3. **Features** (toggle as needed):
   - **Report URLs** – Send network logs to server (off by default)
   - **JS execution** – Report external script loads (on by default)
   - **Clickfix** – Detect clipboard/copy-based social engineering (on by default)
   - **Extension monitoring** – Track extension installs (off by default)
   - **ChatGPT file upload** – Report file uploads to ChatGPT (off by default)
4. **Client ID** – Persistent identifier; copy or generate new
5. **Save**

---

## ✨ Features

### Core
- **Network logging** – Batch network requests to server (optional gzip)
- **Client ID** – Persistent browser identifier for correlation
- **Blocklist** – URL patterns and YouTube channel blocklist from server
- **Compression** – gzip for batch sends (reduces payload size)
- **Timeout** – 5s request timeout when server is unavailable

### Clickfix Detection
- Detects suspicious copy-paste and programmatic clipboard writes
- **PowerShell** – `-ExecutionPolicy Bypass`, `-EncodedCommand`, `iex`, `Invoke-WebRequest`, etc.
- **Windows executables** – `cmd /c`, `mshta`, `wscript`, `certutil`, `regasm`, `msbuild`, `rundll32`, etc.
- **VBScript** – `CreateObject("WinHttp.WinHttpRequest")`, `Execute`, download chains
- **Deduplication** – 15s TTL to avoid duplicate alerts
- Events sent to `POST /api/security`

### JavaScript Execution
- Reports external script loads (`<script src="...">`) including ES modules
- `webRequest` catches script-type loads; content script observes DOM
- Events sent to `POST /api/extensions` as `javascript_execution`

### YouTube Channel Whitelist
- Whitelist mode – only listed channels allowed
- Applies to feeds, search, channel pages, and direct watch links
- Handles `@handle`, `/channel/ID`, `/user/name`

### Extension Monitoring
- Track install/uninstall/update of Chrome extensions
- Optional security scan with risk scoring

---

## 📋 Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest |
| `background.js` | Service worker – batching, compression, routing |
| `content.js` | DOM observation, clickfix detection, script tracking |
| `popup.html` / `popup.js` | Settings UI |
| `youtube-blocker.js` | YouTube channel whitelist |
| `extension-monitor.js` | Extension tracking |
| `page-context-clipboard.js` | Injected script for programmatic clipboard detection |
| `chatgpt-fetch-intercept.js` | ChatGPT file upload detection |

---

## 🐛 Troubleshooting

- **No logs / events** – Verify server URL, enable features (Settings → Features)
- **Extension slow when server down** – Turn off "Report URLs" if not needed; requests timeout after 5s
- **Clickfix not firing** – Ensure "Clickfix" is enabled; tests require HTTP (not `file://`) for programmatic clipboard
- **Service worker suspended** – Critical events (script, page_summary) are sent immediately to avoid loss

---

## 📚 Documentation

- **Main**: `../README.md`
- **Server**: `../server/README.md`
- **Test page**: `../examples/README.md`
