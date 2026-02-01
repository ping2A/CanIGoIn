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

  
  // Clickfix detection patterns - PowerShell, CMD, VBScript, and Windows abuse (ClickGrab-informed)
  const CLICKFIX_PATTERNS = {
    // PowerShell suspicious commands (most common in clickfix)
    powershellCommands: [
      /powershell\s+-[Ee]xecutionPolicy\s+Bypass/i,
      /powershell\s+-[Ee]ncodedCommand/i,
      /powershell\s+-[Ee]nc\b/i,
      /powershell\s+-[Cc]ommand/i,
      /powershell\s+-[Ww][Ii]\s/i,  // -WindowStyle Hidden
      /powershell\s+-[Nn][Oo][Pp]\b/i,  // -NoProfile
      /Invoke-Expression/i,
      /\biex\b/i,
      /Invoke-WebRequest/i,
      /\biwr\b/i,
      /Invoke-RestMethod/i,
      /Start-Process\s+.*powershell/i,
      /New-Object\s+Net\.WebClient/i,
      /\.DownloadString\s*\(/i,
      /\.DownloadFile\s*\(/i,
      /[Cc]ontent\.compatible/i,
      /FromBase64String/i,
      /[Cc]onvert\.FromBase64String/i,
      /ExpandString/i,
      /\.Replace\s*\([^)]+,\s*[^)]+\)/i,
    ],
    // Windows executables commonly abused in ClickFix (cmd, mshta, certutil, etc.)
    windowsExecutables: [
      /\bcmd\.exe\s+\/c\b/i,
      /\bcmd\s+\/c\b/i,
      /\bmshta\.exe\b/i,
      /\bmshta\s+(vbscript|http|https):/i,
      /\bwscript\.exe\b/i,
      /\bcscript\.exe\b/i,
      /\bcertutil\s+(-urlcache|-decode)/i,
      /\bregasm\.exe\b/i,
      /\bmsbuild\.exe\b/i,
      /\biexpress\.exe\b/i,
      /\brundll32\.exe\b/i,
      /\bforfiles\.exe\b/i,
      /\b%temp%|%TEMP%|%tmp%/i,
    ],
    // VBScript / COM patterns (CreateObject WinHttp, Execute, etc.)
    vbscriptPatterns: [
      /CreateObject\s*\(\s*["']WinHttp\.WinHttpRequest/i,
      /CreateObject\s*\(\s*["']MSXML2\.XMLHTTP/i,
      /\.Open\s*\(\s*["']GET["']\s*,/i,
      /\.Send\s*\(\s*\)/i,
      /\bExecute\s+\w+\.ResponseText/i,
      /Execute\s*\(/i,
      /\.ResponseText\s*>/i,  // redirect to file
    ],
    // Base64 encoded commands (very common in clickfix)
    base64Patterns: [
      /[A-Za-z0-9+\/]{100,}={0,2}/,
      /-EncodedCommand\s+[A-Za-z0-9+\/]{50,}={0,2}/i,
      /FromBase64String\s*\(\s*['"]([A-Za-z0-9+\/]{50,}={0,2})['"]/i,
    ],
    // Suspicious URLs and downloads
    suspiciousDownloads: [
      /http[s]?:\/\/[^\s"'`]+\.(ps1|exe|bat|cmd|vbs|js|jar|sh)/i,
      /DownloadString\s*\(\s*['"]http/i,
      /DownloadFile\s*\(\s*['"]http/i,
      /bit\.ly|tinyurl|t\.co|goo\.gl/i,
      /:\d{4}\/[^\s"'`]+\.(vbs|ps1|exe|bat)/i,  // IP:port/payload.vbs
    ],
    // JavaScript suspicious patterns (web-based clickfix)
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
      /\\x[0-9a-f]{2}/i,
      /\\u[0-9a-f]{4}/i,
      /['"]\s*\+\s*['"]/i,
      /\$env:|%[A-Za-z]+%/i,
      /\$\{[^}]+\}/i,
    ],
    // Common clickfix patterns
    clickfixPatterns: [
      /powershell.*base64/i,
      /iex.*DownloadString/i,
      /-EncodedCommand/i,
      /-Enc\b/i,
      /ExecutionPolicy.*Bypass/i,
      /cmd\s*\/c\s+.*powershell/i,
      /WinHttp\.WinHttpRequest.*Execute/i,
      /Press\s+(Win|Ctrl)\+[RV]/i,  // "Press Win+R" / "Press Ctrl+V" instructions
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
  
  // Detect clickfix patterns in code (PowerShell, CMD, VBScript, Windows abuse, JavaScript)
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
      riskScore += 30;
      issues.push('powershell_command');
    }
    
    // Check for Windows executable abuse (cmd, mshta, certutil, wscript, etc.)
    let isWindowsExec = false;
    CLICKFIX_PATTERNS.windowsExecutables.forEach((pattern, index) => {
      if (pattern.test(code)) {
        isWindowsExec = true;
        issues.push(`windows_exec_${index}`);
        riskScore += 28; // Same tier as PowerShell - these are classic ClickFix vectors
      }
    });
    if (isWindowsExec && detectedType === 'unknown') {
      detectedType = 'windows_exec';
    }
    
    // Check for VBScript / COM download patterns (CreateObject WinHttp, Execute)
    let isVbScript = false;
    CLICKFIX_PATTERNS.vbscriptPatterns.forEach((pattern, index) => {
      if (pattern.test(code)) {
        isVbScript = true;
        issues.push(`vbscript_pattern_${index}`);
        riskScore += 35; // VBScript download+execute is very common in ClickFix
      }
    });
    if (isVbScript && detectedType === 'unknown') {
      detectedType = 'vbscript';
    }
    
    // Check for PowerShell suspicious commands
    CLICKFIX_PATTERNS.powershellCommands.forEach((pattern, index) => {
      if (pattern.test(code)) {
        issues.push(`powershell_command_${index}`);
        riskScore += 25;
        if (index <= 2) {  // -ExecutionPolicy Bypass, -EncodedCommand, -Enc
          riskScore += 20;
        }
      }
    });
    
    // Check for base64 encoded commands
    let base64Matches = 0;
    CLICKFIX_PATTERNS.base64Patterns.forEach((pattern) => {
      const matches = code.match(pattern);
      if (matches) {
        base64Matches += matches.length;
        issues.push('base64_encoded_command');
        riskScore += 30;
      }
    });
    
    // Check for suspicious downloads
    CLICKFIX_PATTERNS.suspiciousDownloads.forEach((pattern, index) => {
      if (pattern.test(code)) {
        issues.push(`suspicious_download_${index}`);
        riskScore += 25;
      }
    });
    
    // Check for common clickfix patterns
    CLICKFIX_PATTERNS.clickfixPatterns.forEach((pattern) => {
      if (pattern.test(code)) {
        issues.push('clickfix_pattern');
        riskScore += 35;
      }
    });
    
    // Check for JavaScript patterns (web-based clickfix)
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
    
    const isTerminalCode = isPowerShell || isWindowsExec || isVbScript;
    
    // Check code length (long commands are suspicious)
    if (codeTrimmed.length > 200 && isTerminalCode) {
      issues.push('long_terminal_command');
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
    
    // Check for multiple suspicious patterns together
    if (issues.length >= 3) {
      riskScore += 25;
    }
    
    // High-risk combinations
    if (isPowerShell && base64Matches > 0) {
      issues.push('powershell_base64_combo');
      riskScore += 40;
    }
    
    if (codeTrimmed.includes('iex') && codeTrimmed.includes('DownloadString')) {
      issues.push('iex_download_combo');
      riskScore += 45;
    }
    
    if (codeTrimmed.includes('-EncodedCommand') || /-Enc\b/.test(codeTrimmed)) {
      issues.push('encoded_command_flag');
      riskScore += 40;
    }
    
    // cmd/certutil + VBScript download chain (common ClickFix)
    if (isWindowsExec && isVbScript) {
      issues.push('cmd_vbscript_chain');
      riskScore += 40;
    }
    
    // Lower threshold for PowerShell, CMD, VBScript (they're inherently suspicious)
    const threshold = isTerminalCode ? 40 : 50;
    
    // If risk score is high enough, flag as clickfix
    if (riskScore >= threshold || (isTerminalCode && issues.length >= 2)) {
      return {
        detected: true,
        riskScore: Math.min(riskScore, 100),
        issues: issues,
        codePreview: codeTrimmed.substring(0, 500),
        codeLength: codeTrimmed.length,
        entropy: entropy.toFixed(2),
        type: detectedType,
        isPowerShell: isPowerShell,
        isTerminalCode: isTerminalCode
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
      // No console.warn: detection is sent to server; warning in console could alert attackers
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
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (node.tagName === 'SCRIPT') {
            handleScriptElement(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('script[src]').forEach(handleScriptElement);
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
    const src = String(scriptElement.src || '');
    // Skip obviously invalid/broken URLs (e.g. page bug: baseUrl + undefined)
    if (!src || /\/undefined\/?$|\/null\/?$|^\s*undefined\s*$|^\s*null\s*$/i.test(src)) {
      return;
    }
    
    const scriptInfo = {
      url: window.location.href,
      scriptUrl: src,
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
    const key = src;
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
      // Monitor when src is set (must call handleScriptElement AFTER src is set)
      const originalSrcSet = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src').set;
      Object.defineProperty(element, 'src', {
        set: function(value) {
          const result = originalSrcSet.call(this, value);
          handleScriptElement(this);
          return result;
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
      
      // Check if it's PowerShell, CMD, VBScript, or Windows exec abuse (even if short, these are suspicious)
      const isPowerShell = /powershell|iex|Invoke-Expression|Invoke-WebRequest|Invoke-RestMethod/i.test(selectedText);
      const isWindowsExec = /\b(cmd\.exe|cmd\s+\/c|mshta|wscript|cscript|certutil|regasm|msbuild|rundll32|forfiles)\b/i.test(selectedText);
      const isVbScript = /CreateObject\s*\(\s*["']WinHttp|\.ResponseText\s*>|Execute\s*\(/i.test(selectedText);
      const isTerminalCode = isPowerShell || isWindowsExec || isVbScript || /\.ps1|\.bat|\.cmd|\.vbs|\.sh|curl|wget|bash/i.test(selectedText);
      const hasEncodedCommand = /-EncodedCommand|-Enc\b|FromBase64String/i.test(selectedText);
      const hasExecutionPolicyBypass = /-ExecutionPolicy.*Bypass/i.test(selectedText);
      
      // Lower threshold for terminal/script code (common in clickfix)
      const minLength = isTerminalCode ? 20 : 50;
      const minRiskScore = (isPowerShell || isWindowsExec || isVbScript) ? 40 : 60;
      
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
            note: `Suspicious ${detection.isTerminalCode ? detection.type || 'terminal code' : 'code'} copied to clipboard - potential clickfix attack (user may paste this into external terminal)`
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
