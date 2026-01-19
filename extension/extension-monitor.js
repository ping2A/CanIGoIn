// ============================================================================
// Extension Monitor Module
// Tracks all installed Chrome extensions and logs add/remove events
// ============================================================================

class ExtensionMonitor {
  constructor() {
    this.extensions = [];
    this.lastScan = null;
    this.changeLog = [];
  }

  // Initialize monitoring
  async initialize() {
    console.log('🔍 Initializing Extension Monitor...');
    
    // Load previous state
    await this.loadChangeLog();
    
    // Get initial extension list
    await this.scanExtensions();
    
    // Set up event listeners
    this.setupListeners();
    
    // Periodic scan (every 5 minutes)
    setInterval(() => this.scanExtensions(), 5 * 60 * 1000);
    
    console.log('✅ Extension Monitor initialized');
  }

  // Scan all installed extensions
  async scanExtensions() {
    try {
      const extensions = await chrome.management.getAll();
      
      const newExtensions = extensions.map(ext => ({
        id: ext.id,
        name: ext.name,
        version: ext.version,
        enabled: ext.enabled,
        type: ext.type,
        installType: ext.installType,
        homepageUrl: ext.homepageUrl,
        updateUrl: ext.updateUrl,
        permissions: ext.permissions || [],
        hostPermissions: ext.hostPermissions || [],
        description: ext.description,
        icons: ext.icons,
        mayDisable: ext.mayDisable,
        isApp: ext.isApp,
        appLaunchUrl: ext.appLaunchUrl,
        optionsUrl: ext.optionsUrl,
        shortName: ext.shortName,
        disabledReason: ext.disabledReason,
        scannedAt: new Date().toISOString()
      }));
      
      // Detect changes if we have previous data
      if (this.extensions.length > 0) {
        this.detectChanges(this.extensions, newExtensions);
      }
      
      this.extensions = newExtensions;
      this.lastScan = new Date().toISOString();
      
      console.log(`📋 Scanned ${newExtensions.length} extensions`);
      
      // Save to storage
      await this.saveExtensionList();
      
      return newExtensions;
    } catch (error) {
      console.error('❌ Failed to scan extensions:', error);
      return [];
    }
  }

  // Detect changes between scans
  detectChanges(oldExtensions, newExtensions) {
    const oldIds = new Set(oldExtensions.map(e => e.id));
    const newIds = new Set(newExtensions.map(e => e.id));
    
    // Find removed extensions
    const removed = oldExtensions.filter(e => !newIds.has(e.id));
    removed.forEach(ext => {
      console.log(`🗑️ Extension removed: ${ext.name} (${ext.id})`);
      this.logChange('removed', ext);
    });
    
    // Find added extensions
    const added = newExtensions.filter(e => !oldIds.has(e.id));
    added.forEach(ext => {
      console.log(`➕ Extension added: ${ext.name} (${ext.id})`);
      this.logChange('added', ext);
    });
    
    // Find updated extensions
    newExtensions.forEach(newExt => {
      const oldExt = oldExtensions.find(e => e.id === newExt.id);
      if (oldExt && oldExt.version !== newExt.version) {
        console.log(`🔄 Extension updated: ${newExt.name} (${oldExt.version} → ${newExt.version})`);
        this.logChange('updated', newExt, { oldVersion: oldExt.version });
      }
      
      // Check if enabled status changed
      if (oldExt && oldExt.enabled !== newExt.enabled) {
        console.log(`⚡ Extension ${newExt.enabled ? 'enabled' : 'disabled'}: ${newExt.name}`);
        this.logChange(newExt.enabled ? 'enabled' : 'disabled', newExt);
      }
    });
  }

  // Log extension change
  logChange(action, extension, metadata = {}) {
    const change = {
      timestamp: new Date().toISOString(),
      action: action, // 'added', 'removed', 'updated', 'enabled', 'disabled', 'installed', 'uninstalled'
      extension: {
        id: extension.id,
        name: extension.name,
        version: extension.version,
        enabled: extension.enabled,
        type: extension.type,
        installType: extension.installType,
        permissions: extension.permissions,
        hostPermissions: extension.hostPermissions
      },
      metadata
    };
    
    this.changeLog.push(change);
    
    // Keep only last 100 changes in memory
    if (this.changeLog.length > 100) {
      this.changeLog = this.changeLog.slice(-100);
    }
    
    // Send to server if configured
    this.sendChangeToServer(change);
    
    // Save to local storage
    this.saveChangeLog();
  }

  // Send change to server
  async sendChangeToServer(change) {
    if (!CONFIG || !CONFIG.serverUrl) return;
    
    try {
      // Try extension-specific endpoint first
      let url = CONFIG.serverUrl.replace('/api/logs', '/api/extensions');
      
      // Format to match server's ExtensionEvent structure
      const payload = {
        session_id: sessionId || 'unknown',  // Server expects session_id (snake_case)
        timestamp: change.timestamp,
        user_agent: navigator.userAgent,
        event_type: 'extension_change',
        data: change
      };
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok && response.status === 404) {
        // Endpoint doesn't exist, use main logs endpoint
        url = CONFIG.serverUrl;
        await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            session_id: sessionId || 'unknown',  // Server expects session_id
            timestamp: change.timestamp,
            user_agent: navigator.userAgent,
            logs: [{
              requestId: `ext-${Date.now()}`,
              url: 'chrome://extensions',
              method: 'EXTENSION_EVENT',
              type: 'extension_event',
              blocked: false,
              block_reason: null
            }]
          })
        });
      }
      
      console.log(`📤 Sent extension change to server: ${change.action} - ${change.extension.name}`);
    } catch (error) {
      console.error('❌ Failed to send extension change:', error);
    }
  }

  // Save change log to local storage
  async saveChangeLog() {
    try {
      await chrome.storage.local.set({ 
        extensionChangeLog: this.changeLog,
        lastExtensionScan: this.lastScan
      });
    } catch (error) {
      console.error('❌ Failed to save change log:', error);
    }
  }

  // Save extension list to storage
  async saveExtensionList() {
    try {
      await chrome.storage.local.set({
        extensionList: this.extensions,
        lastExtensionScan: this.lastScan
      });
    } catch (error) {
      console.error('❌ Failed to save extension list:', error);
    }
  }

  // Load change log from storage
  async loadChangeLog() {
    try {
      const result = await chrome.storage.local.get(['extensionChangeLog', 'lastExtensionScan', 'extensionList']);
      this.changeLog = result.extensionChangeLog || [];
      this.lastScan = result.lastExtensionScan || null;
      this.extensions = result.extensionList || [];
      console.log(`📥 Loaded ${this.changeLog.length} extension changes from storage`);
    } catch (error) {
      console.error('❌ Failed to load change log:', error);
    }
  }

  // Set up event listeners for real-time monitoring
  setupListeners() {
    // Extension installed
    chrome.management.onInstalled.addListener((info) => {
      console.log(`➕ Extension installed: ${info.name} (${info.id})`);
      
      const extension = {
        id: info.id,
        name: info.name,
        version: info.version,
        enabled: info.enabled,
        type: info.type,
        installType: info.installType,
        permissions: info.permissions || [],
        hostPermissions: info.hostPermissions || []
      };
      
      this.logChange('installed', extension);
      
      // Rescan to update full list
      setTimeout(() => this.scanExtensions(), 1000);
    });
    
    // Extension uninstalled
    chrome.management.onUninstalled.addListener((id) => {
      console.log(`🗑️ Extension uninstalled: ${id}`);
      
      // Find extension in our list
      const extension = this.extensions.find(e => e.id === id);
      if (extension) {
        this.logChange('uninstalled', extension);
      } else {
        this.logChange('uninstalled', { id, name: 'Unknown', version: 'Unknown', enabled: false });
      }
      
      // Rescan to update full list
      setTimeout(() => this.scanExtensions(), 1000);
    });
    
    // Extension enabled/disabled
    chrome.management.onEnabled.addListener((info) => {
      console.log(`⚡ Extension enabled: ${info.name} (${info.id})`);
      
      const extension = {
        id: info.id,
        name: info.name,
        version: info.version,
        enabled: true,
        type: info.type,
        permissions: info.permissions || [],
        hostPermissions: info.hostPermissions || []
      };
      
      this.logChange('enabled', extension);
      setTimeout(() => this.scanExtensions(), 1000);
    });
    
    chrome.management.onDisabled.addListener((info) => {
      console.log(`⚡ Extension disabled: ${info.name} (${info.id})`);
      
      const extension = {
        id: info.id,
        name: info.name,
        version: info.version,
        enabled: false,
        type: info.type,
        permissions: info.permissions || [],
        hostPermissions: info.hostPermissions || []
      };
      
      this.logChange('disabled', extension);
      setTimeout(() => this.scanExtensions(), 1000);
    });
  }

  // Get suspicious extensions (for security analysis)
  getSuspiciousExtensions() {
    const suspicious = [];
    
    this.extensions.forEach(ext => {
      const flags = [];
      
      // Check for suspicious permissions
      const dangerousPermissions = [
        'webRequest',
        'webRequestBlocking',
        'declarativeNetRequest',
        'declarativeNetRequestWithHostAccess',
        'declarativeNetRequestFeedback',
        'proxy',
        'debugger',
        'cookies',
        'browsingData',
        'history',
        'downloads',
        'management',
        'nativeMessaging',
        'desktopCapture',
        'tabCapture'
      ];
      
      ext.permissions?.forEach(perm => {
        if (dangerousPermissions.includes(perm)) {
          flags.push(`dangerous_permission:${perm}`);
        }
      });
      
      // Check for broad host permissions
      const broadHosts = ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'];
      ext.hostPermissions?.forEach(host => {
        if (broadHosts.includes(host)) {
          flags.push('broad_host_permissions');
        }
      });
      
      // Check install type
      if (ext.installType === 'development') {
        flags.push('development_mode');
      }
      
      // Check if extension can't be disabled (potential malware)
      if (!ext.mayDisable) {
        flags.push('cannot_disable');
      }
      
      // No homepage or update URL (suspicious for non-dev extensions)
      if (!ext.homepageUrl && !ext.updateUrl && ext.installType !== 'development') {
        flags.push('no_homepage');
      }
      
      if (flags.length > 0) {
        suspicious.push({
          ...ext,
          suspicionFlags: flags,
          riskScore: this.calculateRiskScore(flags)
        });
      }
    });
    
    // Sort by risk score
    suspicious.sort((a, b) => b.riskScore - a.riskScore);
    
    return suspicious;
  }

  // Calculate risk score
  calculateRiskScore(flags) {
    let score = 0;
    
    flags.forEach(flag => {
      if (flag.startsWith('dangerous_permission:')) {
        const permission = flag.split(':')[1];
        if (['debugger', 'proxy', 'nativeMessaging'].includes(permission)) {
          score += 20; // Very dangerous
        } else if (['webRequest', 'webRequestBlocking', 'declarativeNetRequest'].includes(permission)) {
          score += 15; // Network interception
        } else {
          score += 10; // Other dangerous permissions
        }
      }
      if (flag === 'broad_host_permissions') {
        score += 20;
      }
      if (flag === 'cannot_disable') {
        score += 30; // Major red flag
      }
      if (flag === 'no_homepage') {
        score += 5;
      }
      if (flag === 'development_mode') {
        score += 15;
      }
    });
    
    return score;
  }

  // Export extension list
  async exportExtensions() {
    const data = {
      exportedAt: new Date().toISOString(),
      totalExtensions: this.extensions.length,
      extensions: this.extensions,
      changeLog: this.changeLog,
      suspicious: this.getSuspiciousExtensions()
    };
    
    return data;
  }

  // Get statistics
  getStatistics() {
    const enabled = this.extensions.filter(e => e.enabled).length;
    const disabled = this.extensions.filter(e => !e.enabled).length;
    const apps = this.extensions.filter(e => e.isApp).length;
    const extensions = this.extensions.filter(e => !e.isApp).length;
    
    const installTypes = {};
    this.extensions.forEach(e => {
      installTypes[e.installType] = (installTypes[e.installType] || 0) + 1;
    });
    
    const recentChanges = this.changeLog.slice(-10);
    
    const suspicious = this.getSuspiciousExtensions();
    
    return {
      total: this.extensions.length,
      enabled,
      disabled,
      apps,
      extensions,
      installTypes,
      lastScan: this.lastScan,
      totalChanges: this.changeLog.length,
      recentChanges,
      suspiciousCount: suspicious.length,
      suspiciousExtensions: suspicious.slice(0, 5) // Top 5 most suspicious
    };
  }
}

// Create global instance
const extensionMonitor = new ExtensionMonitor();

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExtensionMonitor;
}
