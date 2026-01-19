# 🛡️ Network Logger Chrome Extension

Enterprise-grade network monitoring and blocking extension.

---

## 🚀 Quick Install

```bash
# 1. Open Chrome
chrome://extensions/

# 2. Enable Developer Mode (top right)

# 3. Click "Load unpacked"

# 4. Select this folder

# 5. Done!
```

---

## ⚙️ Configuration

```
1. Click extension icon
2. Settings Tab
3. Enter server URLs:
   - Log Server: http://localhost:8080/api/logs
   - Blocklist Server: http://localhost:8080/api/blocklist
4. Save
```

---

## ✨ Editions

### Basic Edition (Default)
Files already configured. Just load and use!

### Enhanced Edition (Recommended)
```bash
cp manifest-enhanced.json manifest.json
cp background-enhanced.js background.js
cp popup-enhanced.html popup.html
cp popup-enhanced.js popup.js
```

**Reload extension** in chrome://extensions/

### Extension Monitoring
```bash
cp manifest-with-extensions.json manifest.json
cp background-with-extensions.js background.js
cp popup-with-extensions.html popup.html
cp popup-with-extensions.js popup.js
```

### Server-Side Blocklist (Most Secure)
```bash
cp background-server-blocklist.js background.js
cp popup-server-blocklist.html popup.html
cp popup-server-blocklist.js popup.js
```

---

## 📋 Features

### All Editions
- ✅ Network request logging
- ✅ URL pattern blocking
- ✅ YouTube channel blocking
- ✅ Statistics dashboard

### Enhanced Edition Adds
- ✅ Retry logic
- ✅ Local backup
- ✅ Buffer overflow protection
- ✅ Data sanitization
- ✅ Export/import
- ✅ Resource timing

### Extension Monitoring Adds
- ✅ Track all Chrome extensions
- ✅ Detect suspicious extensions
- ✅ Risk scoring (0-100)
- ✅ Change history

### Server-Side Blocklist
- ✅ 100% server-managed
- ✅ Cannot be bypassed
- ✅ Auto-updates every 5 min
- ✅ Read-only display

---

## 📊 Files

**Core Files** (all editions):
- `manifest.json` - Extension manifest
- `background.js` - Service worker
- `popup.html` - Popup interface
- `popup.js` - Popup logic
- `content.js` - Content script
- `youtube-blocker.js` - YouTube blocking

**Enhanced Edition**:
- `manifest-enhanced.json`
- `background-enhanced.js`
- `popup-enhanced.html`
- `popup-enhanced.js`

**Extension Monitoring**:
- `manifest-with-extensions.json`
- `background-with-extensions.js`
- `popup-with-extensions.html`
- `popup-with-extensions.js`
- `extension-monitor.js`

**Server-Side Blocklist**:
- `background-server-blocklist.js`
- `popup-server-blocklist.html`
- `popup-server-blocklist.js`

**Assets**:
- `icon16.png`, `icon48.png`, `icon128.png`

**Scripts**:
- `analyze_logs.py` - Log analysis
- `analyze_youtube_blocks.py` - YouTube analytics

---

## 🎯 Usage

### View Statistics
```
Click icon → Statistics Tab
Shows: requests, blocked, logged, uploads
```

### Block URLs
```
1. Blocking Tab (or Settings → Blocklist URL)
2. Enter patterns (one per line):
   .*tracker\..*
   .*analytics\..*
3. Save (or configure on server)
```

### Block YouTube Channels
```
1. YouTube Tab
2. Enter channels (one per line):
   @channelhandle
   UCxxxxxxxxxxxxxxxxxx
3. Save (or configure on server)
```

### Monitor Extensions
```
1. Extensions Tab (monitoring edition only)
2. View all installed extensions
3. Check suspicious count
4. Export report
```

---

## 🔧 Troubleshooting

### Extension not loading
- Check manifest.json is present
- Ensure Chrome is up to date
- Check console for errors

### No logs appearing
- Verify server is running
- Check server URL in settings
- Look at service worker console

### Blocking not working
- Enable blocking toggle
- Check pattern syntax (regex)
- Verify server-side blocklist loaded

---

## 📚 Documentation

Full documentation in `../docs/`:
- `README.md` - Complete guide
- `ENHANCEMENTS.md` - Feature details
- `EXTENSION_MONITORING.md` - Extension tracking
- `SERVER_BLOCKLIST_GUIDE.md` - Blocklist management

---

## ✅ Summary

| Edition | Files to Copy | Features |
|---------|--------------|----------|
| Basic | None (default) | Logging + blocking |
| Enhanced | 4 files | + Retry, backup, stats |
| Monitoring | 5 files | + Extension tracking |
| Server-Blocklist | 3 files | + Server-managed |

---

**Choose your edition, load in Chrome, and start monitoring!** 🚀

For detailed instructions, see `../docs/README.md`
