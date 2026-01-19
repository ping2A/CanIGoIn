// ============================================================================
// Enhanced Popup Script
// ============================================================================

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    
    // Update active tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Update active content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // Load statistics when switching to stats tab
    if (tabName === 'stats') {
      loadStatistics();
    }
  });
});

// ============================================================================
// Load Settings
// ============================================================================

function loadSettings() {
  chrome.storage.local.get([
    'blockList',
    'enableBlocking',
    'blockedYouTubeChannels',
    'youtubeChannelBlocking',
    'serverUrl',
    'enableLocalBackup',
    'maxBufferSize',
    'domainWhitelist',
    'enableDomainWhitelist'
  ], (result) => {
    // Blocking tab
    if (result.blockList) {
      document.getElementById('blockList').value = result.blockList.join('\n');
    }
    if (result.enableBlocking !== undefined) {
      document.getElementById('enableBlocking').checked = result.enableBlocking;
    }
    
    // YouTube tab
    if (result.blockedYouTubeChannels) {
      document.getElementById('blockedYouTubeChannels').value = result.blockedYouTubeChannels.join('\n');
    }
    if (result.youtubeChannelBlocking !== undefined) {
      document.getElementById('youtubeChannelBlocking').checked = result.youtubeChannelBlocking;
    }
    
    // Settings tab
    if (result.serverUrl) {
      document.getElementById('serverUrl').value = result.serverUrl;
    }
    if (result.enableLocalBackup !== undefined) {
      document.getElementById('enableLocalBackup').checked = result.enableLocalBackup;
    }
    if (result.maxBufferSize) {
      document.getElementById('maxBufferSize').value = result.maxBufferSize;
    }
    if (result.domainWhitelist) {
      document.getElementById('domainWhitelist').value = result.domainWhitelist.join('\n');
    }
    if (result.enableDomainWhitelist !== undefined) {
      document.getElementById('enableDomainWhitelist').checked = result.enableDomainWhitelist;
    }
  });
}

// Load settings on popup open
loadSettings();

// ============================================================================
// Blocking Tab
// ============================================================================

document.getElementById('enableBlocking').addEventListener('change', (e) => {
  chrome.storage.local.set({ enableBlocking: e.target.checked });
});

document.getElementById('saveBlockList').addEventListener('click', () => {
  const blockList = document.getElementById('blockList').value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  chrome.storage.local.set({ blockList }, () => {
    showNotification('Block list saved!', 'success');
  });
});

document.getElementById('clearBlockList').addEventListener('click', () => {
  if (confirm('Clear all block patterns?')) {
    document.getElementById('blockList').value = '';
    chrome.storage.local.set({ blockList: [] }, () => {
      showNotification('Block list cleared!', 'success');
    });
  }
});

// ============================================================================
// YouTube Tab
// ============================================================================

document.getElementById('youtubeChannelBlocking').addEventListener('change', (e) => {
  chrome.storage.local.set({ youtubeChannelBlocking: e.target.checked });
});

document.getElementById('saveYouTubeChannels').addEventListener('click', () => {
  const blockedYouTubeChannels = document.getElementById('blockedYouTubeChannels').value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  chrome.storage.local.set({ blockedYouTubeChannels }, () => {
    showNotification('YouTube channels saved!', 'success');
  });
});

document.getElementById('clearYouTubeChannels').addEventListener('click', () => {
  if (confirm('Clear all blocked channels?')) {
    document.getElementById('blockedYouTubeChannels').value = '';
    chrome.storage.local.set({ blockedYouTubeChannels: [] }, () => {
      showNotification('Blocked channels cleared!', 'success');
    });
  }
});

// ============================================================================
// Extensions Tab
// ============================================================================

function displayExtensions(extensions, scanResults = null) {
  const container = document.getElementById('extensionList');
  
  if (!extensions || extensions.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">No extensions found</div>';
    return;
  }
  
  // Get security analysis if available
  const securityMap = new Map();
  if (scanResults) {
    scanResults.extensions.forEach(ext => {
      securityMap.set(ext.id, ext.security);
    });
  }
  
  container.innerHTML = '';
  
  extensions.forEach(ext => {
    const security = securityMap.get(ext.id) || { isSuspicious: false, riskLevel: 'low', indicators: [] };
    
    const item = document.createElement('div');
    item.className = 'extension-item';
    if (security.isSuspicious) {
      item.classList.add('suspicious');
    }
    if (security.riskLevel === 'high') {
      item.classList.add('high-risk');
    }
    
    const badges = `
      <div class="extension-badges">
        <span class="badge ${ext.enabled ? 'enabled' : 'disabled'}">${ext.enabled ? 'Enabled' : 'Disabled'}</span>
        ${ext.installType === 'development' ? '<span class="badge development">Dev</span>' : ''}
        ${security.isSuspicious ? `<span class="badge risk-${security.riskLevel}">Risk: ${security.riskLevel}</span>` : ''}
      </div>
    `;
    
    const warnings = security.indicators.length > 0 ? `
      <div class="extension-warnings">
        <strong>⚠️ Security Indicators:</strong>
        <ul>
          ${security.indicators.map(ind => `<li>${ind}</li>`).join('')}
        </ul>
      </div>
    ` : '';
    
    item.innerHTML = `
      <div class="extension-header">
        <div>
          <span class="extension-name">${ext.name}</span>
          <span class="extension-version">v${ext.version}</span>
        </div>
        ${badges}
      </div>
      <div class="extension-details">
        <div><strong>ID:</strong> ${ext.id}</div>
        <div><strong>Type:</strong> ${ext.type}</div>
        <div><strong>Install:</strong> ${ext.installType}</div>
        ${ext.description ? `<div style="margin-top: 5px;">${ext.description}</div>` : ''}
      </div>
      ${warnings}
    `;
    
    container.appendChild(item);
  });
}

function updateExtensionStats(data) {
  if (data.report) {
    document.getElementById('totalExtensions').textContent = data.report.total || 0;
    document.getElementById('enabledExtensions').textContent = data.report.enabled || 0;
    document.getElementById('suspiciousExtensions').textContent = data.report.suspicious || 0;
  } else if (data.extensions) {
    document.getElementById('totalExtensions').textContent = data.extensions.length || 0;
    const enabled = data.extensions.filter(e => e.enabled).length;
    document.getElementById('enabledExtensions').textContent = enabled;
  }
  
  // Update changes from statistics
  chrome.runtime.sendMessage({ type: 'getStatistics' }, (stats) => {
    if (stats) {
      const changes = (stats.extensionInstalls || 0) + (stats.extensionUninstalls || 0);
      document.getElementById('extensionChanges').textContent = changes;
    }
  });
}

document.getElementById('refreshExtensions').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'getExtensions' }, (response) => {
    if (response && response.extensions) {
      displayExtensions(response.extensions);
      updateExtensionStats(response);
      showNotification('Extension list refreshed!', 'success');
    }
  });
});

document.getElementById('scanExtensions').addEventListener('click', () => {
  showNotification('Running security scan...', 'info');
  
  chrome.runtime.sendMessage({ type: 'scanExtensions' }, (response) => {
    if (response && response.report) {
      displayExtensions(response.report.extensions, response.report);
      updateExtensionStats(response);
      
      const suspicious = response.report.suspicious;
      if (suspicious > 0) {
        showNotification(`Security scan complete! Found ${suspicious} suspicious extension(s)`, 'warning');
      } else {
        showNotification('Security scan complete! No issues found', 'success');
      }
    }
  });
});

document.getElementById('extensionMonitoring').addEventListener('change', (e) => {
  chrome.runtime.sendMessage({ 
    type: 'toggleExtensionMonitoring',
    enabled: e.target.checked 
  }, (response) => {
    if (response.success) {
      showNotification(
        `Extension monitoring ${response.enabled ? 'enabled' : 'disabled'}`,
        'success'
      );
    }
  });
});

// Auto-load extensions when tab is opened
document.querySelector('[data-tab="extensions"]').addEventListener('click', () => {
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'getExtensions' }, (response) => {
      if (response && response.extensions) {
        displayExtensions(response.extensions);
        updateExtensionStats(response);
      }
    });
  }, 100);
});

// ============================================================================
// Statistics Tab
// ============================================================================

function loadStatistics() {
  chrome.runtime.sendMessage({ type: 'getStatistics' }, (stats) => {
    if (!stats) return;
    
    document.getElementById('totalRequests').textContent = formatNumber(stats.totalRequests || 0);
    document.getElementById('blockedRequests').textContent = formatNumber(stats.blockedRequests || 0);
    document.getElementById('loggedRequests').textContent = formatNumber(stats.loggedRequests || 0);
    document.getElementById('successfulUploads').textContent = formatNumber(stats.successfulUploads || 0);
    document.getElementById('bufferSize').textContent = formatNumber(stats.bufferSize || 0);
    document.getElementById('failedUploads').textContent = formatNumber(stats.failedUploads || 0);
    
    // Show additional info
    const info = document.getElementById('statsInfo');
    const uptime = formatDuration(stats.uptime || 0);
    const bytesLogged = formatBytes(stats.bytesLogged || 0);
    const bytesSent = formatBytes(stats.bytesSent || 0);
    const lastUpload = stats.lastUploadTime ? new Date(stats.lastUploadTime).toLocaleString() : 'Never';
    
    info.innerHTML = `
      <strong>Session Info:</strong><br>
      Uptime: ${uptime}<br>
      Data logged: ${bytesLogged}<br>
      Data sent: ${bytesSent}<br>
      Last upload: ${lastUpload}<br>
      Failed batches: ${stats.failedBatches || 0}
    `;
    info.style.display = 'block';
  });
}

document.getElementById('refreshStats').addEventListener('click', loadStatistics);

document.getElementById('clearStats').addEventListener('click', () => {
  if (confirm('Reset all statistics?')) {
    chrome.runtime.sendMessage({ type: 'clearStatistics' }, () => {
      loadStatistics();
      showNotification('Statistics reset!', 'success');
    });
  }
});

document.getElementById('flushLogs').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'flushLogs' }, (response) => {
    showNotification(`Flushed ${response.flushed} logs!`, 'success');
    setTimeout(loadStatistics, 500);
  });
});

// ============================================================================
// Settings Tab
// ============================================================================

document.getElementById('saveServerUrl').addEventListener('click', () => {
  const serverUrl = document.getElementById('serverUrl').value.trim();
  if (!serverUrl) {
    showNotification('Please enter a valid URL', 'error');
    return;
  }
  
  chrome.storage.local.set({ serverUrl }, () => {
    showNotification('Server URL saved!', 'success');
  });
});

document.getElementById('enableLocalBackup').addEventListener('change', (e) => {
  chrome.storage.local.set({ enableLocalBackup: e.target.checked });
});

document.getElementById('enableDomainWhitelist').addEventListener('change', (e) => {
  chrome.storage.local.set({ enableDomainWhitelist: e.target.checked });
});

document.getElementById('maxBufferSize').addEventListener('change', (e) => {
  const value = parseInt(e.target.value);
  if (value >= 100 && value <= 10000) {
    chrome.storage.local.set({ maxBufferSize: value });
  }
});

document.getElementById('saveDomainWhitelist').addEventListener('click', () => {
  const domainWhitelist = document.getElementById('domainWhitelist').value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  chrome.storage.local.set({ domainWhitelist }, () => {
    showNotification('Domain whitelist saved!', 'success');
  });
});

// ============================================================================
// Import / Export
// ============================================================================

document.getElementById('exportConfig').addEventListener('click', () => {
  chrome.storage.local.get(null, (config) => {
    // Remove runtime data
    delete config.statistics;
    delete config.logBackup;
    
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `network-logger-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showNotification('Configuration exported!', 'success');
  });
});

document.getElementById('importConfig').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const config = JSON.parse(event.target.result);
      
      if (confirm('This will overwrite your current configuration. Continue?')) {
        chrome.storage.local.set(config, () => {
          showNotification('Configuration imported!', 'success');
          loadSettings();
        });
      }
    } catch (error) {
      showNotification('Invalid configuration file!', 'error');
    }
  };
  reader.readAsText(file);
  
  // Reset file input
  e.target.value = '';
});

document.getElementById('exportBackup').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'getBackup' }, (response) => {
    if (!response || !response.backup || response.backup.length === 0) {
      showNotification('No backup data available!', 'error');
      return;
    }
    
    const blob = new Blob([JSON.stringify(response.backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `network-logger-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showNotification(`Exported ${response.backup.length} logs!`, 'success');
  });
});

document.getElementById('clearBackup').addEventListener('click', () => {
  if (confirm('This will permanently delete all local backup data. Continue?')) {
    chrome.runtime.sendMessage({ type: 'clearBackup' }, () => {
      showNotification('Backup cleared!', 'success');
    });
  }
});

// ============================================================================
// Utility Functions
// ============================================================================

function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = type === 'success' ? 'success-box' : 'info-box';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Load statistics on first open
setTimeout(loadStatistics, 100);
