// Content script to monitor JavaScript execution
// Enhanced with clickfix detection - detects social engineering attacks where users
// are tricked into copying and pasting malicious code into the browser console
(function() {
  'use strict';

  // Track loaded scripts
  const loadedScripts = new Set();

  // ============================================================================
  // Clickfix logging controls (reduce false-positive/noisy console warnings)
  // ============================================================================

  function isDevLikeOrigin() {
    try {
      const host = window.location.hostname;
      return (
        window.location.protocol === 'file:' ||
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host.endsWith('.local')
      );
    } catch (e) {
      return false;
    }
  }

  // Only print console warnings for very high confidence detections by default.
  // (We still send the detection to the background script for logging/analysis.)
  const CLICKFIX_CONSOLE_WARN_THRESHOLD = 85;
  
  // Clickfix detection patterns - PowerShell and terminal command detection
  const CLICKFIX_PATTERNS = {
    // PowerShell suspicious commands (most common in clickfix)
    powershellCommands: [
      /powershell\s+-[Ee]xecutionPolicy\s+Bypass/i,
      /powershell\s+-[Ee]ncodedCommand/i,
      /powershell\s+-[Cc]ommand/i,
      /Invoke-Expression/i,  // iex - often used to execute downloaded code
      /\biex\b/i,  // Alias for Invoke-Expression
      /Invoke-WebRequest/i,  // iwr - download scripts
      /\biwr\b/i,  // Alias for Invoke-WebRequest
      /Invoke-RestMethod/i,
      /Start-Process\s+.*powershell/i,
      /New-Object\s+Net\.WebClient/i,
      /\.DownloadString\s*\(/i,
      /\.DownloadFile\s*\(/i,
      /[Cc]ontent\.compatible/i,  // -UseBasicParsing bypass
      /FromBase64String/i,  // Base64 decode in PowerShell
      /[Cc]onvert\.FromBase64String/i,
      /ExpandString/i,  // Variable expansion obfuscation
      /\.Replace\s*\([^)]+,\s*[^)]+\)/i,  // String replacement (common obfuscation)
    ],
    // Base64 encoded commands (very common in clickfix)
    base64Patterns: [
      /[A-Za-z0-9+\/]{100,}={0,2}/,  // Long base64 strings (likely encoded commands)
      /-EncodedCommand\s+[A-Za-z0-9+\/]{50,}={0,2}/i,
      /FromBase64String\s*\(\s*['"]([A-Za-z0-9+\/]{50,}={0,2})['"]/i,
    ],
    // Suspicious URLs and downloads
    suspiciousDownloads: [
      /http[s]?:\/\/[^\s"'`]+\.(ps1|exe|bat|cmd|vbs|js|jar|sh)/i,  // Downloading scripts
      /DownloadString\s*\(\s*['"]http/i,
      /DownloadFile\s*\(\s*['"]http/i,
      /bit\.ly|tinyurl|t\.co|goo\.gl/i,  // URL shorteners (often used in clickfix)
    ],
    // JavaScript suspicious patterns (still relevant for web-based clickfix)
    javascriptPatterns: [
      /document\.cookie\s*=/i,
      /localStorage\.setItem/i,
      /sessionStorage\.setItem/i,
      /fetch\s*\(/i,
      /XMLHttpRequest/i,
      /atob\s*\(/i,
      /btoa\s*\(/i,
      /eval\s*\(/i,
      /Function\s*\(/i,
    ],
    // Obfuscation indicators
    obfuscationPatterns: [
      /\\x[0-9a-f]{2}/i,  // Hex escape sequences
      /\\u[0-9a-f]{4}/i,  // Unicode escape sequences
      /['"]\s*\+\s*['"]/i,  // String concatenation obfuscation
      /\$env:|%[A-Za-z]+%/i,  // Environment variable patterns
      /\$\{[^}]+\}/i,  // Variable expansion
    ],
    // Common clickfix patterns
    clickfixPatterns: [
      /powershell.*base64/i,  // PowerShell with base64
      /iex.*DownloadString/i,  // Invoke-Expression with download
      /-EncodedCommand/i,  // Encoded command (hides the actual command)
      /ExecutionPolicy.*Bypass/i,  // Bypassing execution policy
    ],
  };
  
  // Calculate code entropy (high entropy = likely obfuscated)
  function calculateEntropy(str) {
    const len = str.length;
    const freq = {};
    for (let i = 0; i < len; i++) {
      const char = str[i];
      freq[char] = (freq[char] || 0) + 1;
    }
    let entropy = 0;
    for (const char in freq) {
      const p = freq[char] / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }
  
  // Detect clickfix patterns in code (PowerShell, terminal commands, JavaScript)
  function detectClickfix(code) {
    if (!code || typeof code !== 'string') {
      return null;
    }
    
    const codeLower = code.toLowerCase();
    const codeTrimmed = code.trim();
    const issues = [];
    let riskScore = 0;
    let detectedType = 'unknown';
    
    // Check if it's PowerShell (highest priority for clickfix)
    const isPowerShell = /powershell|iex|Invoke-Expression|Invoke-WebRequest|iwr/i.test(code);
    if (isPowerShell) {
      detectedType = 'powershell';
      riskScore += 30; // PowerShell commands are inherently more suspicious in clickfix context
      issues.push('powershell_command');
    }
    
    // Check for PowerShell suspicious commands
    CLICKFIX_PATTERNS.powershellCommands.forEach((pattern, index) => {
      if (pattern.test(code)) {
        issues.push(`powershell_command_${index}`);
        riskScore += 25;
        if (index === 0 || index === 1) {  // -ExecutionPolicy Bypass or -EncodedCommand
          riskScore += 20; // These are very common in clickfix
        }
      }
    });
    
    // Check for base64 encoded commands (very common in PowerShell clickfix)
    let base64Matches = 0;
    CLICKFIX_PATTERNS.base64Patterns.forEach((pattern) => {
      const matches = code.match(pattern);
      if (matches) {
        base64Matches += matches.length;
        issues.push('base64_encoded_command');
        riskScore += 30; // Base64 encoded commands are highly suspicious
      }
    });
    
    // Check for suspicious downloads
    CLICKFIX_PATTERNS.suspiciousDownloads.forEach((pattern, index) => {
      if (pattern.test(code)) {
        issues.push(`suspicious_download_${index}`);
        riskScore += 25;
      }
    });
    
    // Check for common clickfix patterns (PowerShell-specific)
    CLICKFIX_PATTERNS.clickfixPatterns.forEach((pattern) => {
      if (pattern.test(code)) {
        issues.push('clickfix_pattern');
        riskScore += 35; // These are classic clickfix patterns
      }
    });
    
    // Check for JavaScript patterns (for web-based clickfix)
    CLICKFIX_PATTERNS.javascriptPatterns.forEach((pattern, index) => {
      if (pattern.test(code)) {
        issues.push(`javascript_pattern_${index}`);
        riskScore += 15;
      }
    });
    
    // Check for obfuscation patterns
    let obfuscationCount = 0;
    CLICKFIX_PATTERNS.obfuscationPatterns.forEach((pattern) => {
      const matches = code.match(pattern);
      if (matches) {
        obfuscationCount += matches.length;
      }
    });
    
    if (obfuscationCount > 3) {
      issues.push('high_obfuscation');
      riskScore += 25;
    }
    
    // Check code length (long commands are suspicious, especially PowerShell)
    if (codeTrimmed.length > 200 && isPowerShell) {
      issues.push('long_powershell_command');
      riskScore += 15;
    } else if (codeTrimmed.length > 500) {
      issues.push('long_code_block');
      riskScore += 10;
    }
    
    // Calculate entropy (high entropy = likely obfuscated/encoded)
    const entropy = calculateEntropy(codeTrimmed);
    if (entropy > 4.5) {
      issues.push('high_entropy');
      riskScore += 20;
    }
    
    // Check for multiple suspicious patterns together (very suspicious)
    if (issues.length >= 3) {
      riskScore += 25;
    }
    
    // High-risk combinations
    if (isPowerShell && base64Matches > 0) {
      issues.push('powershell_base64_combo');
      riskScore += 40; // PowerShell + Base64 is classic clickfix
    }
    
    if (codeTrimmed.includes('iex') && codeTrimmed.includes('DownloadString')) {
      issues.push('iex_download_combo');
      riskScore += 45; // Very common clickfix pattern
    }
    
    if (codeTrimmed.includes('-EncodedCommand') || codeTrimmed.includes('-Enc')) {
      issues.push('encoded_command_flag');
      riskScore += 40; // Encoded commands hide what they do
    }
    
    // Lower threshold for PowerShell (it's more suspicious in clickfix context)
    const threshold = isPowerShell ? 40 : 50;
    
    // If risk score is high enough, flag as clickfix
    if (riskScore >= threshold || (isPowerShell && issues.length >= 2)) {
      return {
        detected: true,
        riskScore: Math.min(riskScore, 100),
        issues: issues,
        codePreview: codeTrimmed.substring(0, 500),
        codeLength: codeTrimmed.length,
        entropy: entropy.toFixed(2),
        type: detectedType,
        isPowerShell: isPowerShell
      };
    }
    
    return null;
  }
  
  // Log clickfix detection
  function logClickfixDetection(code, source, details = {}) {
    const detection = detectClickfix(code);
    if (detection) {
      chrome.runtime.sendMessage({
        action: 'logClickfixDetection',
        url: window.location.href,
        source: source, // 'eval', 'Function', 'inline_script', etc.
        detection: detection,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        ...details
      }).catch(err => console.error('Failed to send clickfix detection:', err));
      
      // Also log to console for debugging, but only when high confidence.
      // This avoids spamming dev consoles (and avoids "detecting yourself" in local dev).
      const forceWarn = details && details.forceConsoleWarn === true;
      const shouldWarn =
        forceWarn ||
        (!isDevLikeOrigin() && detection.riskScore >= CLICKFIX_CONSOLE_WARN_THRESHOLD);

      if (shouldWarn) {
        console.warn('🚨 Clickfix detected!', {
          riskScore: detection.riskScore,
          issues: detection.issues,
          source: source
        });
      }
    }
  }

  // Check clipboard write for clickfix patterns (shared by content-script override and page-context event)
  function checkClipboardWrite(text, isProgrammatic, timeSinceUserAction) {
    if (!text || typeof text !== 'string') {
      return;
    }
    const trimmedText = text.trim();
    if (trimmedText.length < 20) return;
    if (trimmedText.match(/^https?:\/\/[^\s]+$/)) return;
    const detection = detectClickfix(trimmedText);
    if (isProgrammatic && detection) {
      detection.riskScore = Math.min(detection.riskScore + 30, 100);
      detection.issues.push('programmatic_clipboard_write');
      detection.note = 'Website automatically wrote suspicious code to clipboard (CLICKFIX ATTACK)';
      chrome.runtime.sendMessage({
        action: 'logClickfixDetection',
        url: window.location.href,
        source: 'clipboard_writeText_api',
        detection: detection,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        details: {
          wasProgrammatic: true,
          timeSinceUserAction: timeSinceUserAction,
          clipboardContentLength: trimmedText.length
        }
      }).catch(err => console.error('Failed to send clipboard detection:', err));
      console.warn('🚨 CLICKFIX DETECTED: Website wrote suspicious content to clipboard!', {
        content: trimmedText.substring(0, 200),
        riskScore: detection.riskScore,
        isPowerShell: detection.isPowerShell
      });
    } else if (detection && detection.riskScore >= 70) {
      chrome.runtime.sendMessage({
        action: 'logClickfixDetection',
        url: window.location.href,
        source: 'clipboard_writeText_api',
        detection: { ...detection, note: 'High-risk code written to clipboard (may have been user-initiated)' },
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        details: { wasProgrammatic: false, clipboardContentLength: trimmedText.length }
      }).catch(err => console.error('Failed to send clipboard detection:', err));
    }
  }
  
  // Monitor inline scripts and dynamically loaded scripts
  function monitorScriptLoading() {
    // Observe DOM for script elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.tagName === 'SCRIPT') {
            handleScriptElement(node);
          }
        });
      });
    });
    
    // Start observing
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    
    // Monitor existing scripts
    document.querySelectorAll('script').forEach(handleScriptElement);
  }
  
  // Handle script element - track external JavaScript files only
  function handleScriptElement(scriptElement) {
    // Only track external JavaScript files (with src attribute)
    // Inline scripts are not logged separately (they're part of the page)
    if (!scriptElement.src) {
      return; // Skip inline scripts
    }
    
    const scriptInfo = {
      url: window.location.href,
      scriptUrl: scriptElement.src,
      details: {
        type: scriptElement.type || 'text/javascript',
        async: scriptElement.async,
        defer: scriptElement.defer,
        crossOrigin: scriptElement.crossOrigin,
        integrity: scriptElement.integrity,
        noModule: scriptElement.noModule
      }
    };
    
    // Avoid duplicates
    const key = scriptElement.src;
    if (loadedScripts.has(key)) {
      return;
    }
    loadedScripts.add(key);
    
    // Send to background script (background.js will handle logging via webRequest)
    // This is just for tracking purposes
    chrome.runtime.sendMessage({
      action: 'logJavaScriptExecution',
      ...scriptInfo
    }).catch(err => console.error('Failed to send script info:', err));
  }
  
  // Simple hash function for inline scripts
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }
  
  // Monitor dynamic script creation via createElement
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName) {
    const element = originalCreateElement.call(document, tagName);
    
    if (tagName.toLowerCase() === 'script') {
      // Monitor when src is set
      const originalSrcSet = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src').set;
      Object.defineProperty(element, 'src', {
        set: function(value) {
          handleScriptElement(this);
          return originalSrcSet.call(this, value);
        },
        get: function() {
          return originalSrcSet.call(this);
        }
      });
    }
    
    return element;
  };
  
  // Monitor paste events (minimal - paste usually happens outside browser)
  // This is kept for completeness but clickfix detection focuses on COPY events
  function monitorPasteEvents() {
    // Note: Paste events are less useful for clickfix detection since
    // users typically paste into external terminals/consoles outside the browser
    // Primary detection is via COPY events and clipboard API writes
  }
  
  // Monitor copy events - PRIMARY clickfix detection mechanism
  // Users copy suspicious code from websites, then paste into external terminals
  // We detect the COPY event (paste happens outside browser, so we can't detect it)
  function monitorCopyEvents() {
    document.addEventListener('copy', (event) => {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      
      if (!selectedText || selectedText.length === 0) return;
      
      // Skip if it's just a URL (not code)
      if (selectedText.match(/^https?:\/\/[^\s]+$/)) return;
      
      // Skip very short text (likely not malicious)
      if (selectedText.length < 30) return;
      
      // Check if it's PowerShell or terminal code (even if short, these are suspicious)
      const isPowerShell = /powershell|iex|Invoke-Expression|Invoke-WebRequest|Invoke-RestMethod/i.test(selectedText);
      const isTerminalCode = /\.ps1|\.bat|\.cmd|\.sh|curl|wget|bash/i.test(selectedText);
      const hasEncodedCommand = /-EncodedCommand|-Enc|FromBase64String/i.test(selectedText);
      const hasExecutionPolicyBypass = /-ExecutionPolicy.*Bypass/i.test(selectedText);
      
      // Lower threshold for PowerShell/terminal commands (common in clickfix)
      const minLength = (isPowerShell || isTerminalCode) ? 20 : 50;
      const minRiskScore = isPowerShell ? 40 : 60; // PowerShell is more suspicious
      
      if (selectedText.length > minLength) {
        // Detect clickfix patterns in copied text
        const detection = detectClickfix(selectedText);
        
        // Alert if suspicious code is copied (this is the clickfix attack vector)
        if (detection && detection.riskScore >= minRiskScore) {
          // Boost risk score if it has encoded commands or execution policy bypass
          if (hasEncodedCommand || hasExecutionPolicyBypass) {
            detection.riskScore = Math.min(detection.riskScore + 20, 100);
            detection.issues.push('encoded_command_or_bypass');
          }
          
          logClickfixDetection(selectedText, 'copy_event', {
            target: event.target?.tagName || 'unknown',
            targetId: event.target?.id || null,
            selectedTextLength: selectedText.length,
            isPowerShell: isPowerShell,
            isTerminalCode: isTerminalCode,
            hasEncodedCommand: hasEncodedCommand,
            hasExecutionPolicyBypass: hasExecutionPolicyBypass,
            note: `Suspicious ${detection.isPowerShell ? 'PowerShell' : 'code'} copied to clipboard - potential clickfix attack (user may paste this into external terminal)`,
            forceConsoleWarn: true // Always warn for copy events with suspicious content
          });
        }
      }
    }, true); // Use capture phase to catch all copy events
  }
  
  // Monitor keyboard events that might indicate console usage
  // (F12 opens console, Ctrl+Shift+I, etc.)
  let consoleOpenIndicators = [];
  function monitorConsoleIndicators() {
    document.addEventListener('keydown', (event) => {
      // Detect F12 or Ctrl+Shift+I (console shortcuts)
      if (event.key === 'F12' || 
          (event.ctrlKey && event.shiftKey && event.key === 'I') ||
          (event.ctrlKey && event.shiftKey && event.key === 'J') ||
          (event.ctrlKey && event.shiftKey && event.key === 'C')) {
        consoleOpenIndicators.push({
          timestamp: Date.now(),
          key: event.key,
          url: window.location.href
        });
        
        // Keep only last 10 indicators
        if (consoleOpenIndicators.length > 10) {
          consoleOpenIndicators.shift();
        }
        
        // Store this info for use in eval detection
        window.__clickfixConsoleRecentlyOpened = true;
        setTimeout(() => {
          window.__clickfixConsoleRecentlyOpened = false;
        }, 30000); // 30 seconds window
      }
    }, true);
  }
  
  // Monitor Clipboard API writes (primary clickfix detection mechanism)
  // This detects when websites programmatically write to the clipboard
  function monitorClipboardWrites() {
    if (!navigator.clipboard) {
      return; // Clipboard API not available
    }
    
    // Track user-initiated clipboard actions to distinguish from programmatic writes
    let lastUserAction = 0;
    const userActionWindow = 100; // 100ms window to consider clipboard write as user-initiated
    
    // Monitor user actions that might legitimately trigger clipboard writes
    ['click', 'keydown', 'touchstart'].forEach(eventType => {
      document.addEventListener(eventType, () => {
        lastUserAction = Date.now();
      }, true);
    });
    
    // Intercept navigator.clipboard.write()
    const originalWrite = navigator.clipboard.write;
    if (originalWrite) {
      navigator.clipboard.write = function(data) {
        const timeSinceUserAction = Date.now() - lastUserAction;
        const isProgrammatic = timeSinceUserAction > userActionWindow;
        
        // Extract text from ClipboardItem if provided
        let textToCheck = null;
        
        if (data instanceof ClipboardItem) {
          // If it's a ClipboardItem, we'll need to check after the write
          // For now, log that a ClipboardItem was written programmatically
          textToCheck = '[ClipboardItem]';
        } else if (Array.isArray(data) && data[0] instanceof ClipboardItem) {
          // Handle array of ClipboardItems
          textToCheck = '[ClipboardItem Array]';
        }
        
        // Call original write
        const result = originalWrite.call(this, data);
        
        // If programmatic and potentially suspicious, log it
        if (isProgrammatic && textToCheck) {
          // We'll check the actual text after the promise resolves
          result.then(() => {
            // Try to read back what was written (if possible)
            navigator.clipboard.readText().then(text => {
              if (text) {
                checkClipboardWrite(text, true);
              }
            }).catch(() => {
              // Can't read clipboard, but log that something was written programmatically
              chrome.runtime.sendMessage({
                action: 'logClickfixDetection',
                url: window.location.href,
                source: 'clipboard_write_api',
                detection: {
                  detected: true,
                  riskScore: 50,
                  issues: ['programmatic_clipboard_write'],
                  codePreview: '[ClipboardItem - could not read content]',
                  codeLength: 0,
                  type: 'clipboard_write',
                  note: 'Website wrote ClipboardItem to clipboard programmatically (potential clickfix)'
                },
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                details: {
                  wasProgrammatic: true,
                  timeSinceUserAction: timeSinceUserAction
                }
              }).catch(err => console.error('Failed to send clipboard detection:', err));
            });
          }).catch(() => {
            // Write failed or we can't verify - log anyway if programmatic
            if (isProgrammatic) {
              chrome.runtime.sendMessage({
                action: 'logClickfixDetection',
                url: window.location.href,
                source: 'clipboard_write_api',
                detection: {
                  detected: true,
                  riskScore: 40,
                  issues: ['programmatic_clipboard_write'],
                  codePreview: '[ClipboardItem write - verification failed]',
                  codeLength: 0,
                  type: 'clipboard_write',
                  note: 'Website attempted programmatic clipboard write'
                },
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent
              }).catch(err => console.error('Failed to send clipboard detection:', err));
            }
          });
        }
        
        return result;
      };
    }
    
    // Intercept navigator.clipboard.writeText() in content-script world (e.g. extension-injected code)
    const originalWriteText = navigator.clipboard.writeText;
    if (originalWriteText) {
      navigator.clipboard.writeText = function(text) {
        const timeSinceUserAction = Date.now() - lastUserAction;
        const isProgrammatic = timeSinceUserAction > userActionWindow;
        if (isProgrammatic || text) {
          checkClipboardWrite(text, isProgrammatic, timeSinceUserAction);
        }
        return originalWriteText.call(this, text);
      };
    }
  }

  // Inject script into page context so we see when PAGE JavaScript calls navigator.clipboard.writeText().
  // Content script runs in an isolated world; the page's writeText() never hits our override above.
  // We load the script from extension URL (not inline) to avoid CSP blocking inline script execution.
  // The injected script runs in the page world, overrides writeText there, and dispatches a DOM event
  // with the text; we listen for it and run checkClipboardWrite.
  function injectPageContextClipboardMonitor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-context-clipboard.js');
    script.onload = function() { script.remove(); };
    (document.head || document.documentElement).appendChild(script);
    document.addEventListener('__extensionClipboardWriteText', function(e) {
      if (e.detail && e.detail.text != null) {
        checkClipboardWrite(e.detail.text, true, 0);
      }
    }, true);
  }
  
  // Start monitoring when DOM is ready
  function startMonitoring() {
    monitorScriptLoading();
    monitorPasteEvents();
    monitorCopyEvents(); // PRIMARY clickfix detection - detects when user copies suspicious code
    monitorConsoleIndicators();
    monitorClipboardWrites(); // Content-script world: intercepts writeText in our world
    injectPageContextClipboardMonitor(); // Page world: intercepts writeText when PAGE code calls it
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMonitoring);
  } else {
    startMonitoring();
  }
  
  console.log('Network Logger content script loaded with clickfix detection');
})();
