// ============================================================================
// ENHANCED Network Logger & Blocker - Background Script
// ============================================================================

// Configuration
const CONFIG = {
  serverUrl: 'https://your-server.com/api/logs',
  batchSize: 50,
  batchInterval: 5000,
  enableBlocking: true,
  blockList: [],
  youtubeChannelBlocking: true,
  blockedYouTubeChannels: [],
  
  // Advanced settings
  maxBufferSize: 1000,           // Prevent memory overflow
  enableCompression: false,       // Compress logs (requires server support)
  enableLocalBackup: true,        // Save logs to IndexedDB as backup
  maxRetries: 3,                  // Retry failed uploads
  retryDelay: 5000,              // Delay between retries (ms)
  enableDomainWhitelist: false,  // Don't log whitelisted domains
  domainWhitelist: [],           // Domains to ignore
  captureResourceTiming: true,   // Capture performance data
  sanitizeSensitiveData: true,   // Remove passwords, tokens
  enableStatistics: true,        // Track statistics
  maxLocalStorageSize: 10 * 1024 * 1024 // 10MB max local storage
};

// In-memory buffers
let logBuffer = [];
let failedBatches = [];
let sessionId = generateSessionId();

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
  'serverUrl', 'maxBufferSize', 'enableLocalBackup', 'domainWhitelist', 'enableDomainWhitelist'
], (result) => {
  if (result.blockList) CONFIG.blockList = result.blockList;
  if (result.enableBlocking !== undefined) CONFIG.enableBlocking = result.enableBlocking;
  if (result.blockedYouTubeChannels) CONFIG.blockedYouTubeChannels = result.blockedYouTubeChannels;
  if (result.youtubeChannelBlocking !== undefined) CONFIG.youtubeChannelBlocking = result.youtubeChannelBlocking;
  if (result.serverUrl) CONFIG.serverUrl = result.serverUrl;
  if (result.maxBufferSize) CONFIG.maxBufferSize = result.maxBufferSize;
  if (result.enableLocalBackup !== undefined) CONFIG.enableLocalBackup = result.enableLocalBackup;
  if (result.domainWhitelist) CONFIG.domainWhitelist = result.domainWhitelist;
  if (result.enableDomainWhitelist !== undefined) CONFIG.enableDomainWhitelist = result.enableDomainWhitelist;
  
  console.log('✅ Configuration loaded:', CONFIG);
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  Object.keys(changes).forEach(key => {
    if (CONFIG.hasOwnProperty(key)) {
      CONFIG[key] = changes[key].newValue;
      console.log(`⚙️ Config updated: ${key} =`, changes[key].newValue);
    }
  });
});

// ============================================================================
// Utility Functions
// ============================================================================

function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function isWhitelisted(url) {
  if (!CONFIG.enableDomainWhitelist) return false;
  
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    return CONFIG.domainWhitelist.some(pattern => {
      if (pattern.startsWith('*.')) {
        return domain.endsWith(pattern.slice(1));
      }
      return domain === pattern || domain.endsWith('.' + pattern);
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
// Network Request Logging
// ============================================================================

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    statistics.totalRequests++;
    
    // Check if domain is whitelisted
    if (isWhitelisted(details.url)) {
      return;
    }
    
    // YouTube channel blocking
    if (CONFIG.youtubeChannelBlocking && details.url.includes('youtube.com')) {
      const blockInfo = shouldBlockYouTubeChannel(details.url);
      if (blockInfo.shouldBlock) {
        statistics.blockedRequests++;
        
        logEntry({
          sessionId,
          timestamp: new Date().toISOString(),
          requestId: details.requestId,
          url: details.url,
          method: details.method,
          type: details.type,
          tabId: details.tabId,
          frameId: details.frameId,
          initiator: details.initiator,
          blocked: true,
          blockReason: 'youtube_channel',
          youtubeChannelInfo: blockInfo.channelInfo
        });
        
        return {
          redirectUrl: `data:text/html,<html><body><h1>Channel Blocked</h1><p>This YouTube channel has been blocked.</p></body></html>`
        };
      }
    }
    
    // URL blocking
    if (CONFIG.enableBlocking && CONFIG.blockList.length > 0) {
      for (const pattern of CONFIG.blockList) {
        try {
          const regex = new RegExp(pattern);
          if (regex.test(details.url)) {
            statistics.blockedRequests++;
            
            logEntry({
              sessionId,
              timestamp: new Date().toISOString(),
              requestId: details.requestId,
              url: details.url,
              method: details.method,
              type: details.type,
              tabId: details.tabId,
              frameId: details.frameId,
              initiator: details.initiator,
              blocked: true,
              blockReason: pattern
            });
            
            return { cancel: true };
          }
        } catch (e) {
          console.error('❌ Invalid regex pattern:', pattern, e);
        }
      }
    }
    
    // Log request
    const logData = {
      sessionId,
      timestamp: new Date().toISOString(),
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      tabId: details.tabId,
      frameId: details.frameId,
      initiator: details.initiator,
      blocked: false
    };
    
    // Add resource timing if available
    if (CONFIG.captureResourceTiming && details.timeStamp) {
      logData.timing = {
        requestTime: details.timeStamp
      };
    }
    
    logEntry(logData);
  },
  { urls: ['<all_urls>'] },
  ['blocking']
);

// Capture response details
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (isWhitelisted(details.url)) return;
    
    const existingLog = logBuffer.find(log => log.requestId === details.requestId);
    if (existingLog) {
      existingLog.statusCode = details.statusCode;
      if (CONFIG.captureResourceTiming && details.timeStamp) {
        existingLog.timing = existingLog.timing || {};
        existingLog.timing.responseTime = details.timeStamp;
        existingLog.timing.duration = details.timeStamp - existingLog.timing.requestTime;
      }
      if (details.responseHeaders) {
        existingLog.responseHeaders = details.responseHeaders.map(h => ({
          name: h.name,
          value: h.value
        }));
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// ============================================================================
// Log Management
// ============================================================================

function logEntry(entry) {
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
  
  // Send special events (clickfix, javascript_execution) to /api/extensions
  if (specialEvents.length > 0) {
    for (const event of specialEvents) {
      try {
        const extensionUrl = CONFIG.serverUrl.replace('/api/logs', '/api/extensions');
        const extensionPayload = {
          session_id: sessionId,
          timestamp: event.timestamp || new Date().toISOString(),
          user_agent: navigator.userAgent,
          event_type: event.type || 'unknown_event',
          data: event
        };
        
        await fetch(extensionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(extensionPayload)
        });
      } catch (error) {
        console.error('Failed to send special event:', error);
      }
    }
  }
}

async function sendWithRetry(payload, attempt, url = null) {
  const targetUrl = url || CONFIG.serverUrl;
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CONFIG.enableCompression && { 'Content-Encoding': 'gzip' })
      },
      body: JSON.stringify(payload)
    });
    
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
// Periodic Batch Sending
// ============================================================================

setInterval(() => {
  if (logBuffer.length > 0) {
    console.log(`⏰ Periodic batch send (${logBuffer.length} logs in buffer)`);
    sendLogBatch();
  }
  
  // Update statistics
  updateStatistics();
}, CONFIG.batchInterval);

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

// Periodic refresh
setInterval(() => refreshExtensionList(), 5 * 60 * 1000);
setInterval(() => scanAllExtensions(), 30 * 60 * 1000);

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
    
    // Log to console for immediate visibility
    console.warn('🚨 CLICKFIX DETECTED:', {
      url: message.url,
      riskScore: message.detection.riskScore,
      issues: message.detection.issues,
      source: message.source
    });
    
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
