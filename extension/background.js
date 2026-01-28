// ============================================================================
// ENHANCED Network Logger & Blocker - Background Script
// ============================================================================

// Configuration
const CONFIG = {
  serverUrl: 'http://localhost:8080/api/logs',
  batchSize: 50,
  batchInterval: 5000,
  enableBlocking: false,
  blockList: [],
  youtubeChannelBlocking: false,
  blockedYouTubeChannels: [],
  
  // Advanced settings
  maxBufferSize: 1000,           // Prevent memory overflow
  enableCompression: false,       // Compress logs (requires server support)
  enableLocalBackup: true,        // Save logs to IndexedDB as backup
  maxRetries: 3,                  // Retry failed uploads
  retryDelay: 5000,              // Delay between retries (ms)
  enableDomainWhitelist: true,   // Don't log whitelisted domains (enabled by default)
  domainWhitelist: [],           // User-defined domains to ignore (merged with predefined)
  captureResourceTiming: true,   // Capture performance data
  sanitizeSensitiveData: true,   // Remove passwords, tokens
  enableStatistics: true,        // Track statistics
  maxLocalStorageSize: 10 * 1024 * 1024, // 10MB max local storage
  // Feature toggles (no slow delay when server unavailable)
  fetchTimeoutMs: 5000,          // Abort fetch after 5s so extension never hangs
  // Reporting features (can be toggled via "Enable all features" in popup)
  enableReportUrls: false,       // Report network requests / URLs to server (OFF by default)
  enableJsExecution: true,       // Report JS execution (eval, Function, script load)
  enableClickfix: true         // Report clickfix / security (clipboard, copy) detections
};

// Predefined whitelist of major domains to reduce server load
// These are common services that generate a lot of requests
const PREDEFINED_WHITELIST = [
  // Google services
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'googleusercontent.com',
  'gmail.com',
  'youtube.com',
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  
  // Microsoft services
  'microsoft.com',
  'microsoftonline.com',
  'office.com',
  'office365.com',
  'live.com',
  'outlook.com',
  'hotmail.com',
  'msn.com',
  'bing.com',
  'azure.com',
  'azureedge.net',
  'msecnd.net',
  
  // Apple services
  'apple.com',
  'icloud.com',
  'apple-cloudkit.com',
  'appleid.apple.com',
  
  // Facebook/Meta
  'facebook.com',
  'fbcdn.net',
  'facebook.net',
  'instagram.com',
  'whatsapp.com',
  
  // Amazon
  'amazon.com',
  'amazonaws.com',
  'amazon-adsystem.com',
  'amazon-adsystem.com',
  
  // CDNs and common services
  'cloudflare.com',
  'cloudflare.net',
  'fastly.com',
  'akamai.net',
  'akamaiedge.net',
  'jsdelivr.net',
  'cdnjs.com',
  'unpkg.com',
  
  // Common analytics and tracking (reduce noise)
  'analytics.google.com',
  'googletagmanager.com',
  'facebook.net',
  'scorecardresearch.com',
  'quantserve.com',
  
  // Common ad networks (reduce noise)
  'adsafeprotected.com',
  'advertising.com',
  'adnxs.com',
  'rubiconproject.com',
  
  // Local/internal
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1'
];

// In-memory buffers
let logBuffer = [];
let failedBatches = [];
let sessionId = generateSessionId();
let clientId = null;
let scheduledFlushTimeout = null;

// Statistics
let statistics = {
  totalRequests: 0,
  blockedRequests: 0,
  loggedRequests: 0,
  failedUploads: 0,
  successfulUploads: 0,
  bytesLogged: 0,
  bytesSent: 0,
  sessionStart: Date.now(),
  lastUploadTime: null,
  bufferSize: 0,
  extensionInstalls: 0,
  extensionUninstalls: 0,
  extensionEvents: 0
};

// Extension monitoring state
let extensionCache = new Map();
let extensionMonitoringEnabled = true;

// ============================================================================
// Initialization
// ============================================================================

// Load configuration from storage
chrome.storage.local.get([
  'blockList', 'enableBlocking', 'blockedYouTubeChannels', 'youtubeChannelBlocking',
  'serverUrl', 'maxBufferSize', 'enableLocalBackup', 'domainWhitelist', 'enableDomainWhitelist',
  'enableReportUrls', 'enableJsExecution', 'enableClickfix', 'extensionMonitoring',
  'clientId'
], (result) => {
  if (result.blockList) CONFIG.blockList = result.blockList;
  if (result.enableBlocking !== undefined) CONFIG.enableBlocking = result.enableBlocking;
  if (result.blockedYouTubeChannels) CONFIG.blockedYouTubeChannels = result.blockedYouTubeChannels;
  if (result.youtubeChannelBlocking !== undefined) CONFIG.youtubeChannelBlocking = result.youtubeChannelBlocking;
  if (result.serverUrl) {
    CONFIG.serverUrl = result.serverUrl;
    console.log('✅ Server URL loaded from storage:', CONFIG.serverUrl);
  } else {
    // Default to local dev server
    CONFIG.serverUrl = 'http://localhost:8080/api/logs';
    chrome.storage.local.set({ serverUrl: CONFIG.serverUrl });
    console.log('✅ Default Server URL set:', CONFIG.serverUrl);
  }
  if (result.maxBufferSize) CONFIG.maxBufferSize = result.maxBufferSize;
  if (result.enableLocalBackup !== undefined) CONFIG.enableLocalBackup = result.enableLocalBackup;
  if (result.domainWhitelist) CONFIG.domainWhitelist = result.domainWhitelist;
  if (result.enableDomainWhitelist !== undefined) {
    CONFIG.enableDomainWhitelist = result.enableDomainWhitelist;
  } else {
    CONFIG.enableDomainWhitelist = true;
    chrome.storage.local.set({ enableDomainWhitelist: true });
  }
  if (result.enableReportUrls !== undefined) CONFIG.enableReportUrls = result.enableReportUrls;
  if (result.enableJsExecution !== undefined) CONFIG.enableJsExecution = result.enableJsExecution;
  if (result.enableClickfix !== undefined) CONFIG.enableClickfix = result.enableClickfix;
  if (result.extensionMonitoring !== undefined) extensionMonitoringEnabled = result.extensionMonitoring;

  // Client ID (persistent identifier for this browser/installation)
  if (result.clientId) {
    clientId = result.clientId;
  } else {
    clientId = generateClientId();
    chrome.storage.local.set({ clientId });
  }
  
  console.log('✅ Configuration loaded:', CONFIG);
  console.log(`📋 Whitelist: ${CONFIG.enableDomainWhitelist ? 'ENABLED' : 'DISABLED'} (${PREDEFINED_WHITELIST.length} predefined domains + ${CONFIG.domainWhitelist.length} user-defined)`);
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  Object.keys(changes).forEach(key => {
    if (CONFIG.hasOwnProperty(key)) {
      CONFIG[key] = changes[key].newValue;
      console.log(`⚙️ Config updated: ${key} =`, changes[key].newValue);
      
      if (key === 'serverUrl' && changes[key].newValue) {
        const newUrl = changes[key].newValue;
        if (newUrl && newUrl !== 'https://your-server.com/api/logs') {
          console.log(`✅ Server URL updated to: ${newUrl}`);
          testServerConnection(newUrl);
        }
      }
    }
    if (key === 'extensionMonitoring') {
      extensionMonitoringEnabled = changes[key].newValue;
      console.log(`⚙️ Extension monitoring: ${extensionMonitoringEnabled ? 'ON' : 'OFF'}`);
    }
    if (key === 'clientId') {
      clientId = changes[key].newValue;
      console.log(`🆔 Client ID updated: ${clientId}`);
    }
  });
});

// Fetch with timeout so extension never hangs when server is unavailable
function fetchWithTimeout(url, options = {}, timeoutMs = null) {
  const ms = timeoutMs != null ? timeoutMs : CONFIG.fetchTimeoutMs;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  const signal = options.signal || controller.signal;
  return fetch(url, { ...options, signal })
    .then(response => {
      clearTimeout(timeoutId);
      return response;
    })
    .catch(err => {
      clearTimeout(timeoutId);
      throw err;
    });
}

// Test server connection
async function testServerConnection(url) {
  try {
    const healthUrl = url.replace('/api/logs', '/health');
    const response = await fetchWithTimeout(healthUrl, { method: 'GET' }, 5000);
    
    if (response.ok) {
      console.log('✅ Server connection test successful:', healthUrl);
    } else {
      console.warn('⚠️ Server connection test failed:', response.status);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('⚠️ Server connection test timed out');
    } else {
      console.warn('⚠️ Server connection test error:', error.message);
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateClientId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (e) {}
  // Fallback: not a UUID, but stable-enough random ID
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

function isWhitelisted(url) {
  if (!CONFIG.enableDomainWhitelist) return false;
  
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    
    // Check predefined whitelist first (most common case)
    const isPredefinedWhitelisted = PREDEFINED_WHITELIST.some(whitelistedDomain => {
      // Exact match
      if (domain === whitelistedDomain) return true;
      // Subdomain match (e.g., www.google.com matches google.com)
      if (domain.endsWith('.' + whitelistedDomain)) return true;
      return false;
    });
    
    if (isPredefinedWhitelisted) return true;
    
    // Check user-defined whitelist
    return CONFIG.domainWhitelist.some(pattern => {
      const patternLower = pattern.toLowerCase();
      if (patternLower.startsWith('*.')) {
        // Wildcard subdomain pattern (e.g., *.example.com)
        const baseDomain = patternLower.slice(2); // Remove '*.'
        return domain === baseDomain || domain.endsWith('.' + baseDomain);
      }
      // Exact match or subdomain match
      return domain === patternLower || domain.endsWith('.' + patternLower);
    });
  } catch (e) {
    return false;
  }
}

function sanitizeData(data) {
  if (!CONFIG.sanitizeSensitiveData) return data;
  
  const sanitized = JSON.parse(JSON.stringify(data));
  
  // Sanitize URL parameters
  if (sanitized.url) {
    try {
      const url = new URL(sanitized.url);
      // Remove sensitive query params
      ['password', 'token', 'key', 'secret', 'api_key', 'apikey', 'auth'].forEach(param => {
        if (url.searchParams.has(param)) {
          url.searchParams.set(param, '[REDACTED]');
        }
      });
      sanitized.url = url.toString();
    } catch (e) {
      // Invalid URL, skip
    }
  }
  
  // Sanitize headers
  if (sanitized.requestHeaders) {
    sanitized.requestHeaders = sanitized.requestHeaders.map(header => {
      if (['authorization', 'cookie', 'x-api-key'].includes(header.name.toLowerCase())) {
        return { ...header, value: '[REDACTED]' };
      }
      return header;
    });
  }
  
  return sanitized;
}

function compressData(data) {
  // Simple compression using JSON string manipulation
  // For real compression, you'd use a library like pako
  const str = JSON.stringify(data);
  return str;
}

async function saveToLocalBackup(logs) {
  if (!CONFIG.enableLocalBackup) return;
  
  try {
    const backup = await chrome.storage.local.get(['logBackup']) || {};
    const existingLogs = backup.logBackup || [];
    const newLogs = [...existingLogs, ...logs];
    
    // Limit backup size
    const totalSize = JSON.stringify(newLogs).length;
    if (totalSize > CONFIG.maxLocalStorageSize) {
      // Remove oldest logs
      const removeCount = Math.floor(newLogs.length * 0.2); // Remove 20%
      newLogs.splice(0, removeCount);
      console.log(`📦 Backup size limit reached, removed ${removeCount} old logs`);
    }
    
    await chrome.storage.local.set({ logBackup: newLogs });
    console.log(`💾 Saved ${logs.length} logs to local backup (total: ${newLogs.length})`);
  } catch (error) {
    console.error('❌ Failed to save backup:', error);
  }
}

async function getLocalBackup() {
  if (!CONFIG.enableLocalBackup) return [];
  
  try {
    const backup = await chrome.storage.local.get(['logBackup']);
    return backup.logBackup || [];
  } catch (error) {
    console.error('❌ Failed to load backup:', error);
    return [];
  }
}

async function clearLocalBackup() {
  if (!CONFIG.enableLocalBackup) return;
  
  try {
    await chrome.storage.local.remove(['logBackup']);
    console.log('🗑️ Local backup cleared');
  } catch (error) {
    console.error('❌ Failed to clear backup:', error);
  }
}

// ============================================================================
// DeclarativeNetRequest Rules Management (Manifest V3 blocking)
// ============================================================================

let ruleIdCounter = 1;

async function updateDeclarativeNetRequestRules() {
  if (!chrome.declarativeNetRequest) {
    console.warn('⚠️ declarativeNetRequest API not available');
    return;
  }

  const rules = [];
  
  // Add URL blocking rules
  if (CONFIG.enableBlocking && CONFIG.blockList.length > 0) {
    CONFIG.blockList.forEach((pattern, index) => {
      try {
        // Convert regex pattern to declarativeNetRequest format
        // Note: declarativeNetRequest has limited regex support
        // For complex patterns, we'll use urlFilter
        rules.push({
          id: ruleIdCounter++,
          priority: 1,
          action: { type: 'block' },
          condition: {
            urlFilter: pattern,
            // Use regexFilter for regex patterns (if supported)
            // For now, we'll use urlFilter which supports wildcards
            resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']
          }
        });
      } catch (e) {
        console.error('❌ Invalid blocking pattern:', pattern, e);
      }
    });
  }
  
  // Update rules
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: await chrome.declarativeNetRequest.getDynamicRules().then(r => r.map(rule => rule.id)),
      addRules: rules
    });
    console.log(`✅ Updated ${rules.length} blocking rules`);
  } catch (error) {
    console.error('❌ Failed to update declarativeNetRequest rules:', error);
  }
}

// Initialize rules on startup
chrome.storage.local.get(['blockList', 'enableBlocking'], (result) => {
  if (result.blockList) CONFIG.blockList = result.blockList;
  if (result.enableBlocking !== undefined) CONFIG.enableBlocking = result.enableBlocking;
  updateDeclarativeNetRequestRules();
});

// Update rules when blocklist changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.blockList || changes.enableBlocking) {
    if (changes.blockList) CONFIG.blockList = changes.blockList.newValue;
    if (changes.enableBlocking !== undefined) CONFIG.enableBlocking = changes.enableBlocking.newValue;
    updateDeclarativeNetRequestRules();
  }
});

// ============================================================================
// Page Navigation and JavaScript File Tracking
// ============================================================================

// Track page navigations and their associated JavaScript files
const pageScripts = new Map(); // tabId -> { pageUrl, scripts: [] }

// Listen for page navigations (user-initiated only)
chrome.webNavigation.onCommitted.addListener((details) => {
  // Only track main frame navigations (user clicking/entering URLs)
  if (details.frameId !== 0) return;
  
  // Only track user-initiated navigations:
  // - "typed" = user typed URL in address bar
  // - "link" = user clicked a link
  // - "form_submit" = user submitted a form
  // Skip: "auto_subframe", "manual_subframe", "reload", "auto_toplevel", etc.
  const userInitiatedTypes = ['typed', 'link', 'form_submit', 'generated'];
  if (!userInitiatedTypes.includes(details.transitionType)) {
    return; // Skip non-user-initiated navigations
  }
  
  const tabId = details.tabId;
  const pageUrl = details.url;
  
  // Skip chrome://, chrome-extension://, and other internal URLs
  if (pageUrl.startsWith('chrome://') || 
      pageUrl.startsWith('chrome-extension://') ||
      pageUrl.startsWith('about:') ||
      pageUrl.startsWith('moz-extension://')) {
    return;
  }
  
  // Check if page URL is whitelisted (skip logging if it is)
  if (isWhitelisted(pageUrl)) {
    console.log(`⏭️ Skipping whitelisted page: ${pageUrl}`);
    return;
  }
  
  // Initialize script tracking for this page
  pageScripts.set(tabId, {
    pageUrl: pageUrl,
    timestamp: new Date().toISOString(),
    scripts: [],
    navigationType: details.transitionType
  });
  
  console.log(`📄 Page navigation: ${pageUrl} (tab: ${tabId}, type: ${details.transitionType})`);
  
  // Log the navigation event
  logEntry({
    sessionId,
    timestamp: new Date().toISOString(),
    requestId: `nav-${tabId}-${Date.now()}`,
    url: pageUrl,
    method: 'GET',
    type: 'main_frame',
    tabId: tabId,
    frameId: 0,
    initiator: details.url,
    blocked: false,
    isNavigation: true,
    navigationType: details.transitionType
  });
  
  statistics.totalRequests++;
  statistics.loggedRequests++;
});

// Track JavaScript files loaded for each page
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Only track script files
    if (details.type !== 'script') return;
    
    const tabId = details.tabId;
    const pageData = pageScripts.get(tabId);
    
    // Only track scripts for pages we're monitoring (user navigations)
    if (!pageData) return;
    
    // Check if domain is whitelisted
    if (isWhitelisted(details.url)) {
      return;
    }
    
    // Add script to the page's script list
    if (!pageData.scripts.find(s => s.url === details.url)) {
      pageData.scripts.push({
        url: details.url,
        requestId: details.requestId,
        timestamp: new Date().toISOString(),
        method: details.method,
        initiator: details.initiator
      });
      
      // Log the JavaScript file
      logEntry({
        sessionId,
        timestamp: new Date().toISOString(),
        requestId: details.requestId,
        url: details.url,
        method: details.method,
        type: 'script',
        tabId: tabId,
        frameId: details.frameId,
        initiator: details.initiator,
        blocked: false,
        pageUrl: pageData.pageUrl,
        isJavaScript: true
      });
      
      statistics.loggedRequests++;
    }
  },
  { urls: ['<all_urls>'] }
);

// When page finishes loading, log summary
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  
  const tabId = details.tabId;
  const pageData = pageScripts.get(tabId);
  
  if (pageData) {
    console.log(`✅ Page loaded: ${pageData.pageUrl} with ${pageData.scripts.length} JavaScript files`);
    
    // Optionally log a summary entry
    logEntry({
      sessionId,
      timestamp: new Date().toISOString(),
      requestId: `summary-${tabId}-${Date.now()}`,
      url: pageData.pageUrl,
      method: 'GET',
      type: 'page_summary',
      tabId: tabId,
      frameId: 0,
      blocked: false,
      isPageSummary: true,
      javascriptFilesCount: pageData.scripts.length,
      javascriptFiles: pageData.scripts.map(s => s.url)
    });
    
    // Clean up after a delay (keep for potential retries)
    setTimeout(() => {
      pageScripts.delete(tabId);
    }, 60000); // Keep for 60 seconds
  }
});

// ============================================================================
// Log Management
// ============================================================================

function logEntry(entry) {
  // Feature toggles: skip if feature is disabled
  const entryType = entry.type || '';
  if (entryType === 'clickfix_detection' && !CONFIG.enableClickfix) return;
  if (entryType === 'javascript_execution' && !CONFIG.enableJsExecution) return;
  const isNetworkLog = entry.requestId || (entry.url && entryType !== 'clickfix_detection' && entryType !== 'javascript_execution');
  if (isNetworkLog && !CONFIG.enableReportUrls) return;

  const sanitized = sanitizeData(entry);
  
  statistics.loggedRequests++;
  statistics.bytesLogged += JSON.stringify(sanitized).length;
  
  logBuffer.push(sanitized);
  statistics.bufferSize = logBuffer.length;
  
  // Prevent buffer overflow
  if (logBuffer.length > CONFIG.maxBufferSize) {
    console.warn(`⚠️ Buffer overflow! Dropping oldest ${logBuffer.length - CONFIG.maxBufferSize} logs`);
    logBuffer = logBuffer.slice(-CONFIG.maxBufferSize);
    statistics.bufferSize = logBuffer.length;
  }
  
  // Trigger batch send if buffer is full
  if (logBuffer.length >= CONFIG.batchSize) {
    sendLogBatch();
    return;
  }

  // Debounced flush: ensures low-volume browsing still gets uploaded before
  // the MV3 service worker is suspended.
  if (!scheduledFlushTimeout) {
    scheduledFlushTimeout = setTimeout(() => {
      scheduledFlushTimeout = null;
      if (logBuffer.length > 0) {
        console.log(`⏱️ Debounced flush (${logBuffer.length} logs in buffer)`);
        sendLogBatch();
      }
    }, Math.min(CONFIG.batchInterval, 5000));
  }
}

// ============================================================================
// Batch Sending with Retry Logic
// ============================================================================

async function sendLogBatch() {
  if (logBuffer.length === 0) return;
  
  const batch = logBuffer.splice(0, CONFIG.batchSize);
  statistics.bufferSize = logBuffer.length;
  
  // Save to local backup
  await saveToLocalBackup(batch);
  
  // Format payload to match server's LogEntry structure
  // Server expects: LogEntry { session_id, timestamp, user_agent, logs: Vec<NetworkLog> }
  // NetworkLog: { requestId, url, method, type, blocked, block_reason }
  
  // Separate network logs from special events
  const networkLogs = batch.filter(log => log.requestId || (log.url && log.type !== 'clickfix_detection' && log.type !== 'javascript_execution'));
  const specialEvents = batch.filter(log => !networkLogs.includes(log));
  
  // Send network logs to /api/logs
  if (networkLogs.length > 0) {
    const payload = {
      client_id: clientId || null,
      session_id: sessionId,  // Server expects session_id (snake_case)
      timestamp: new Date().toISOString(),
      user_agent: navigator.userAgent,
      logs: networkLogs.map(log => ({
        requestId: log.requestId || '',
        url: log.url || '',
        method: log.method || 'GET',
        type: log.type || 'other',
        blocked: log.blocked || false,
        block_reason: log.blockReason || log.block_reason || null
      }))
    };
    
    const payloadStr = CONFIG.enableCompression ? compressData(payload) : JSON.stringify(payload);
    statistics.bytesSent += payloadStr.length;
    
    // Send network logs
    await sendWithRetry(payload, 0, CONFIG.serverUrl);
  }
  
  // Send special events to dedicated endpoints:
  // - Security events (clickfix, extension security scans) -> /api/security
  // - Other extension events (javascript_execution, extension install/uninstall/etc) -> /api/extensions
  if (specialEvents.length > 0) {
    for (const event of specialEvents) {
      try {
        const eventType = event.type || event.event_type || 'unknown_event';
        const isSecurityEvent =
          eventType === 'clickfix_detection' ||
          eventType === 'extension_security_scan';

        const endpoint = isSecurityEvent ? '/api/security' : '/api/extensions';
        const extensionUrl = CONFIG.serverUrl.replace('/api/logs', endpoint);
        const extensionPayload = {
          client_id: clientId || null,
          session_id: sessionId,
          timestamp: event.timestamp || new Date().toISOString(),
          user_agent: navigator.userAgent,
          event_type: eventType,
          data: event
        };
        
        await fetchWithTimeout(extensionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(extensionPayload)
        }, CONFIG.fetchTimeoutMs);
      } catch (error) {
        console.error('Failed to send special event:', error);
      }
    }
  }
}

async function sendWithRetry(payload, attempt, url = null) {
  const targetUrl = url || CONFIG.serverUrl;
  try {
    const response = await fetchWithTimeout(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CONFIG.enableCompression && { 'Content-Encoding': 'gzip' })
      },
      body: JSON.stringify(payload)
    }, CONFIG.fetchTimeoutMs);
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    
    statistics.successfulUploads++;
    statistics.lastUploadTime = Date.now();
    console.log(`✅ Uploaded batch of ${payload.logs.length} logs (attempt ${attempt + 1})`);
    
    // Try to send failed batches
    await retryFailedBatches();
    
  } catch (error) {
    console.error(`❌ Failed to upload logs (attempt ${attempt + 1}/${CONFIG.maxRetries}):`, error);
    statistics.failedUploads++;
    
    if (attempt < CONFIG.maxRetries - 1) {
      // Retry after delay
      setTimeout(() => {
        console.log(`🔄 Retrying upload (attempt ${attempt + 2}/${CONFIG.maxRetries})...`);
        sendWithRetry(payload, attempt + 1);
      }, CONFIG.retryDelay * (attempt + 1)); // Exponential backoff
    } else {
      // Max retries reached, save to failed batches
      failedBatches.push(payload);
      console.error(`💥 Max retries reached for batch. Saved to failed batches (${failedBatches.length} total)`);
    }
  }
}

async function retryFailedBatches() {
  if (failedBatches.length === 0) return;
  
  console.log(`🔄 Retrying ${failedBatches.length} failed batches...`);
  
  const batch = failedBatches.shift();
  await sendWithRetry(batch, 0);
}

// ============================================================================
// Periodic Batch Sending (Manifest V3-friendly)
// ============================================================================

// MV3 service workers can be suspended; setInterval is not reliable.
// Use chrome.alarms to wake up periodically and flush logs.
try {
  if (chrome.alarms) {
    chrome.alarms.create('flushLogs', { periodInMinutes: 1 });
    chrome.alarms.create('refreshExtensions', { periodInMinutes: 5 });
    chrome.alarms.create('scanExtensions', { periodInMinutes: 30 });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'flushLogs') {
        if (logBuffer.length > 0) {
          console.log(`⏰ Alarm flush (${logBuffer.length} logs in buffer)`);
          sendLogBatch();
        }
        updateStatistics();
      }

      if (alarm.name === 'refreshExtensions') {
        refreshExtensionList();
      }

      if (alarm.name === 'scanExtensions') {
        scanAllExtensions();
      }
    });
  } else {
    // Fallback (should rarely happen)
    setInterval(() => {
      if (logBuffer.length > 0) {
        console.log(`⏰ Periodic batch send (${logBuffer.length} logs in buffer)`);
        sendLogBatch();
      }
      updateStatistics();
    }, CONFIG.batchInterval);
  }
} catch (e) {
  // Fallback if alarms throws for some reason
  setInterval(() => {
    if (logBuffer.length > 0) {
      console.log(`⏰ Periodic batch send (${logBuffer.length} logs in buffer)`);
      sendLogBatch();
    }
    updateStatistics();
  }, CONFIG.batchInterval);
}

// ============================================================================
// Statistics Management
// ============================================================================

function updateStatistics() {
  if (!CONFIG.enableStatistics) return;
  
  chrome.storage.local.set({ statistics }, () => {
    console.log('📊 Statistics updated:', statistics);
  });
}

// ============================================================================
// YouTube Channel Blocking
// ============================================================================

function shouldBlockYouTubeChannel(url) {
  if (!CONFIG.youtubeChannelBlocking) return { shouldBlock: false };
  
  const channelInfo = parseYouTubeUrl(url);
  if (!channelInfo) return { shouldBlock: false };
  
  const shouldBlock = CONFIG.blockedYouTubeChannels.some(blockedChannel => {
    if (channelInfo.channelId && blockedChannel === channelInfo.channelId) return true;
    if (channelInfo.handle && blockedChannel === channelInfo.handle) return true;
    if (channelInfo.customUrl && blockedChannel === channelInfo.customUrl) return true;
    if (channelInfo.username && blockedChannel === channelInfo.username) return true;
    return false;
  });
  
  return { shouldBlock, channelInfo };
}

function parseYouTubeUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    const channelMatch = pathname.match(/\/channel\/([^\/]+)/);
    if (channelMatch) return { channelId: channelMatch[1] };
    
    const handleMatch = pathname.match(/\/@([^\/]+)/);
    if (handleMatch) return { handle: '@' + handleMatch[1] };
    
    const customMatch = pathname.match(/\/c\/([^\/]+)/);
    if (customMatch) return { customUrl: customMatch[1] };
    
    const userMatch = pathname.match(/\/user\/([^\/]+)/);
    if (userMatch) return { username: userMatch[1] };
    
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================================
// Extension Monitoring
// ============================================================================

async function getAllExtensions() {
  return new Promise((resolve) => {
    chrome.management.getAll((extensions) => {
      resolve(extensions);
    });
  });
}

async function refreshExtensionList() {
  try {
    const extensions = await getAllExtensions();
    
    const newCache = new Map();
    extensions.forEach(ext => {
      newCache.set(ext.id, {
        id: ext.id,
        name: ext.name,
        version: ext.version,
        enabled: ext.enabled,
        type: ext.type,
        installType: ext.installType,
        description: ext.description,
        homepageUrl: ext.homepageUrl,
        updateUrl: ext.updateUrl,
        permissions: ext.permissions || [],
        hostPermissions: ext.hostPermissions || [],
        icons: ext.icons || []
      });
    });
    
    extensionCache = newCache;
    console.log(`📦 Extension cache updated: ${extensionCache.size} extensions`);
    return extensions;
  } catch (error) {
    console.error('❌ Failed to get extensions:', error);
    return [];
  }
}

function analyzeExtensionSecurity(extension) {
  const suspiciousIndicators = [];
  
  const dangerousPermissions = [
    'webRequest', 'webRequestBlocking', 'proxy', 'debugger',
    'cookies', 'history', 'tabs', '<all_urls>'
  ];
  
  const extPermissions = [
    ...(extension.permissions || []),
    ...(extension.hostPermissions || [])
  ];
  
  dangerousPermissions.forEach(perm => {
    if (extPermissions.some(p => p.includes(perm))) {
      suspiciousIndicators.push(`Has permission: ${perm}`);
    }
  });
  
  if (extension.installType === 'development') {
    suspiciousIndicators.push('Development mode (unpacked)');
  }
  
  if (extension.installType === 'sideload') {
    suspiciousIndicators.push('Sideloaded (not from Chrome Web Store)');
  }
  
  if (!extension.homepageUrl) {
    suspiciousIndicators.push('No homepage URL');
  }
  
  const suspiciousKeywords = [
    'crack', 'keygen', 'hack', 'bot', 'cheat',
    'free', 'download', 'premium', 'unlocker'
  ];
  
  const nameLower = extension.name.toLowerCase();
  suspiciousKeywords.forEach(keyword => {
    if (nameLower.includes(keyword)) {
      suspiciousIndicators.push(`Suspicious keyword in name: ${keyword}`);
    }
  });
  
  return {
    isSuspicious: suspiciousIndicators.length > 0,
    indicators: suspiciousIndicators,
    riskLevel: suspiciousIndicators.length === 0 ? 'low' :
               suspiciousIndicators.length <= 2 ? 'medium' : 'high'
  };
}

async function scanAllExtensions() {
  const extensions = await getAllExtensions();
  const report = {
    timestamp: new Date().toISOString(),
    total: extensions.length,
    enabled: 0,
    disabled: 0,
    suspicious: 0,
    extensions: []
  };
  
  extensions.forEach(ext => {
    if (ext.enabled) report.enabled++;
    else report.disabled++;
    
    const security = analyzeExtensionSecurity(ext);
    if (security.isSuspicious) report.suspicious++;
    
    report.extensions.push({
      id: ext.id,
      name: ext.name,
      version: ext.version,
      enabled: ext.enabled,
      type: ext.type,
      installType: ext.installType,
      permissions: ext.permissions || [],
      hostPermissions: ext.hostPermissions || [],
      security
    });
  });
  
  console.log('🔍 Extension Security Scan:', report);
  
  logBuffer.push({
    sessionId,
    timestamp: new Date().toISOString(),
    event_type: 'extension_security_scan',
    scan_results: report,
    severity: report.suspicious > 0 ? 'warning' : 'info'
  });
  
  return report;
}

// Extension monitoring listeners
chrome.management.onInstalled.addListener((extensionInfo) => {
  if (!extensionMonitoringEnabled) return;
  
  console.log('🆕 Extension INSTALLED:', extensionInfo.name);
  
  const logEntry = {
    sessionId,
    timestamp: new Date().toISOString(),
    event_type: 'extension_installed',
    extension: {
      id: extensionInfo.id,
      name: extensionInfo.name,
      version: extensionInfo.version,
      enabled: extensionInfo.enabled,
      type: extensionInfo.type,
      installType: extensionInfo.installType,
      description: extensionInfo.description,
      permissions: extensionInfo.permissions || [],
      hostPermissions: extensionInfo.hostPermissions || []
    },
    severity: 'info',
    user_agent: navigator.userAgent
  };
  
  extensionCache.set(extensionInfo.id, extensionInfo);
  logBuffer.push(logEntry);
  statistics.extensionInstalls++;
  
  // Immediate send for security
  setTimeout(() => sendLogBatch(), 1000);
});

chrome.management.onUninstalled.addListener((extensionId) => {
  if (!extensionMonitoringEnabled) return;
  
  const extensionInfo = extensionCache.get(extensionId);
  const extensionName = extensionInfo ? extensionInfo.name : 'Unknown Extension';
  
  console.log('🗑️ Extension REMOVED:', extensionName);
  
  const logEntry = {
    sessionId,
    timestamp: new Date().toISOString(),
    event_type: 'extension_uninstalled',
    extension: extensionInfo ? {
      id: extensionInfo.id,
      name: extensionInfo.name,
      version: extensionInfo.version,
      type: extensionInfo.type
    } : {
      id: extensionId,
      name: 'Unknown Extension'
    },
    severity: 'warning',
    user_agent: navigator.userAgent
  };
  
  extensionCache.delete(extensionId);
  logBuffer.push(logEntry);
  statistics.extensionUninstalls++;
  
  setTimeout(() => sendLogBatch(), 1000);
});

chrome.management.onEnabled.addListener((extensionInfo) => {
  if (!extensionMonitoringEnabled) return;
  
  console.log('✅ Extension ENABLED:', extensionInfo.name);
  
  logBuffer.push({
    sessionId,
    timestamp: new Date().toISOString(),
    event_type: 'extension_enabled',
    extension: {
      id: extensionInfo.id,
      name: extensionInfo.name,
      version: extensionInfo.version
    },
    severity: 'info'
  });
  
  if (extensionCache.has(extensionInfo.id)) {
    extensionCache.get(extensionInfo.id).enabled = true;
  }
  
  statistics.extensionEvents++;
});

chrome.management.onDisabled.addListener((extensionInfo) => {
  if (!extensionMonitoringEnabled) return;
  
  console.log('⏸️ Extension DISABLED:', extensionInfo.name);
  
  logBuffer.push({
    sessionId,
    timestamp: new Date().toISOString(),
    event_type: 'extension_disabled',
    extension: {
      id: extensionInfo.id,
      name: extensionInfo.name,
      version: extensionInfo.version
    },
    severity: 'info'
  });
  
  if (extensionCache.has(extensionInfo.id)) {
    extensionCache.get(extensionInfo.id).enabled = false;
  }
  
  statistics.extensionEvents++;
});

// Initialize extension monitoring
refreshExtensionList().then(extensions => {
  console.log(`📦 Initial extension count: ${extensions.length}`);
  
  logBuffer.push({
    sessionId,
    timestamp: new Date().toISOString(),
    event_type: 'extension_monitoring_started',
    extension_count: extensions.length,
    extensions: extensions.map(ext => ({
      id: ext.id,
      name: ext.name,
      version: ext.version,
      enabled: ext.enabled,
      type: ext.type,
      installType: ext.installType
    })),
    severity: 'info'
  });
  
  scanAllExtensions();
});

// Periodic refresh is handled by alarms above in MV3-friendly way.

// ============================================================================
// Message Handling (Extended)
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getStatistics') {
    sendResponse({
      ...statistics,
      bufferSize: logBuffer.length,
      failedBatches: failedBatches.length,
      uptime: Date.now() - statistics.sessionStart
    });
    return true;
  }
  
  if (message.type === 'clearStatistics') {
    statistics = {
      totalRequests: 0,
      blockedRequests: 0,
      loggedRequests: 0,
      failedUploads: 0,
      successfulUploads: 0,
      bytesLogged: 0,
      bytesSent: 0,
      sessionStart: Date.now(),
      lastUploadTime: null,
      bufferSize: 0,
      extensionInstalls: 0,
      extensionUninstalls: 0,
      extensionEvents: 0
    };
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'flushLogs') {
    sendLogBatch();
    sendResponse({ success: true, flushed: logBuffer.length });
    return true;
  }
  
  if (message.type === 'getBackup') {
    getLocalBackup().then(backup => {
      sendResponse({ backup });
    });
    return true;
  }
  
  if (message.type === 'clearBackup') {
    clearLocalBackup().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  // Clickfix detection messages
  if (message.action === 'logClickfixDetection') {
    // Handle clickfix detection - high priority logging
    const clickfixEntry = {
      sessionId,
      timestamp: message.timestamp || new Date().toISOString(),
      type: 'clickfix_detection',
      url: message.url,
      source: message.source,
      tabId: sender.tab?.id,
      detection: message.detection,
      userAgent: message.userAgent || navigator.userAgent,
      severity: message.detection.riskScore >= 70 ? 'high' : 
                message.detection.riskScore >= 50 ? 'medium' : 'low'
    };
    
    // Log to buffer with high priority
    logEntry(clickfixEntry);
    
    // Try to send immediately (don't wait for batch)
    sendLogBatch().catch(err => {
      console.error('Failed to send clickfix detection immediately:', err);
    });
    
    // Log to console for immediate visibility, but only when high confidence.
    // This avoids noisy false positives during development.
    try {
      const riskScore = message?.detection?.riskScore ?? 0;
      const forceWarn = message?.detection?.forceConsoleWarn === true || message?.forceConsoleWarn === true;
      if (forceWarn || riskScore >= 85) {
        console.warn('🚨 CLICKFIX DETECTED:', {
          url: message.url,
          riskScore,
          issues: message.detection.issues,
          source: message.source
        });
      }
    } catch (e) {
      // Ignore console logging failures
    }
    
    sendResponse({ success: true, logged: true });
    return true;
  }
  
  // JavaScript execution logs (from content.js)
  if (message.action === 'logJavaScriptExecution') {
    logEntry({
      sessionId,
      timestamp: new Date().toISOString(),
      type: 'javascript_execution',
      url: message.url,
      scriptUrl: message.scriptUrl,
      tabId: sender.tab?.id,
      details: message.details
    });
    sendResponse({ success: true });
    return true;
  }
  
  // NEW: Extension monitoring messages
  if (message.type === 'getExtensions') {
    getAllExtensions().then(extensions => {
      sendResponse({ extensions });
    });
    return true;
  }
  
  if (message.type === 'scanExtensions') {
    scanAllExtensions().then(report => {
      sendResponse({ report });
    });
    return true;
  }
  
  if (message.type === 'toggleExtensionMonitoring') {
    extensionMonitoringEnabled = message.enabled;
    chrome.storage.local.set({ extensionMonitoring: message.enabled });
    sendResponse({ success: true, enabled: extensionMonitoringEnabled });
    return true;
  }
});

// ============================================================================
// Cleanup on Extension Unload
// ============================================================================

chrome.runtime.onSuspend.addListener(() => {
  console.log('🔌 Extension suspending, flushing logs...');
  sendLogBatch();
  updateStatistics();
});

console.log('🚀 Enhanced Network Logger & Blocker initialized');
console.log('📊 Session ID:', sessionId);
console.log('⚙️ Configuration:', CONFIG);
