// Content script to monitor JavaScript execution
// Enhanced with clickfix detection - detects social engineering attacks where users
// are tricked into copying and pasting malicious code into the browser console
(function() {
  'use strict';
  
  // Track loaded scripts
  const loadedScripts = new Set();
  
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
      
      // Also log to console for debugging (can be removed in production)
      console.warn('🚨 Clickfix detected!', {
        riskScore: detection.riskScore,
        issues: detection.issues,
        source: source
      });
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
  
  // Handle script element
  function handleScriptElement(scriptElement) {
    const scriptInfo = {
      url: window.location.href,
      scriptUrl: scriptElement.src || 'inline',
      details: {
        type: scriptElement.type || 'text/javascript',
        async: scriptElement.async,
        defer: scriptElement.defer,
        crossOrigin: scriptElement.crossOrigin,
        integrity: scriptElement.integrity,
        noModule: scriptElement.noModule
      }
    };
    
    // For inline scripts, capture content and check for clickfix
    if (!scriptElement.src && scriptElement.textContent) {
      const content = scriptElement.textContent.trim();
      scriptInfo.details.inlineContent = content.substring(0, 1000); // First 1000 chars
      scriptInfo.details.inlineLength = content.length;
      scriptInfo.details.inlineHash = simpleHash(content);
      
      // Check inline scripts for clickfix patterns
      logClickfixDetection(content, 'inline_script', {
        scriptUrl: 'inline',
        hash: scriptInfo.details.inlineHash
      });
    }
    
    // Avoid duplicates
    const key = scriptElement.src || scriptInfo.details.inlineHash;
    if (loadedScripts.has(key)) {
      return;
    }
    loadedScripts.add(key);
    
    // Send to background script
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
  
  // Monitor eval() calls - enhanced with clickfix detection
  const originalEval = window.eval;
  let evalCount = 0;
  window.eval = function(code) {
    evalCount++;
    
    // Always check for clickfix in eval calls (high risk)
    if (code && typeof code === 'string') {
      const consoleWasOpen = window.__clickfixConsoleRecentlyOpened || false;
      
      // If console was recently opened, this is even more suspicious
      const detection = detectClickfix(code);
      if (detection) {
        if (consoleWasOpen) {
          // Enhance detection if console was recently opened
          detection.riskScore = Math.min(detection.riskScore + 20, 100);
          detection.issues.push('console_recently_opened');
          detection.note = 'Code executed via eval() shortly after console was opened - likely pasted code';
        }
        
        // Log the detection
        chrome.runtime.sendMessage({
          action: 'logClickfixDetection',
          url: window.location.href,
          source: consoleWasOpen ? 'eval_with_console_open' : 'eval',
          detection: detection,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          details: {
            callCount: evalCount,
            consoleRecentlyOpened: consoleWasOpen
          }
        }).catch(err => console.error('Failed to send clickfix detection:', err));
      }
    }
    
    // Throttle logging of eval calls
    if (evalCount % 10 === 1) {
      chrome.runtime.sendMessage({
        action: 'logJavaScriptExecution',
        url: window.location.href,
        scriptUrl: 'eval',
        details: {
          type: 'eval',
          codePreview: code.substring(0, 200),
          codeLength: code.length,
          callCount: evalCount
        }
      }).catch(err => console.error('Failed to send eval info:', err));
    }
    
    return originalEval.call(window, code);
  };
  
  // Monitor Function constructor (also used for dynamic code execution) - enhanced with clickfix detection
  const OriginalFunction = window.Function;
  let functionCount = 0;
  window.Function = function(...args) {
    functionCount++;
    
    // Check for clickfix in Function constructor body (last argument is usually the body)
    if (args.length > 0) {
      const body = args[args.length - 1];
      if (body && typeof body === 'string') {
        logClickfixDetection(body, 'Function_constructor', {
          argsCount: args.length,
          callCount: functionCount
        });
      }
    }
    
    // Throttle logging
    if (functionCount % 10 === 1) {
      chrome.runtime.sendMessage({
        action: 'logJavaScriptExecution',
        url: window.location.href,
        scriptUrl: 'Function constructor',
        details: {
          type: 'function_constructor',
          argsCount: args.length,
          bodyPreview: args[args.length - 1]?.substring(0, 200),
          callCount: functionCount
        }
      }).catch(err => console.error('Failed to send Function info:', err));
    }
    
    return new OriginalFunction(...args);
  };
  
  // Monitor paste events on the page (clickfix detection)
  function monitorPasteEvents() {
    // Listen for paste events on all elements
    document.addEventListener('paste', (event) => {
      // Get clipboard data
      const clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) return;
      
      const pastedText = clipboardData.getData('text/plain');
      if (!pastedText || pastedText.trim().length === 0) return;
      
      // Check if the paste target is an input field or textarea
      const target = event.target;
      const isInputField = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.contentEditable === 'true'
      );
      
      // Check if pasted content looks like code (clickfix detection)
      const trimmedText = pastedText.trim();
      
      // Skip if it's just a URL (not code)
      if (trimmedText.match(/^https?:\/\/[^\s]+$/)) return;
      
      // Don't skip PowerShell commands even if they're short (clickfix often uses them)
      const isPowerShell = /powershell|iex|Invoke-Expression|Invoke-WebRequest/i.test(trimmedText);
      const isLikelyCode = /[;&|`]|\.ps1|\.bat|\.cmd|\.sh|curl|wget/i.test(trimmedText);
      
      // Skip very short text unless it looks like PowerShell or terminal code
      if (trimmedText.length < 30 && !isPowerShell && !isLikelyCode) return;
      
      // Analyze the pasted text for clickfix patterns
      logClickfixDetection(trimmedText, 'paste_event', {
        target: target.tagName || 'unknown',
        targetId: target.id || null,
        targetClass: target.className || null,
        isInputField: isInputField,
        pastedLength: trimmedText.length
      });
    }, true); // Use capture phase to catch all paste events
  }
  
  // Monitor copy events to detect when suspicious code is copied
  function monitorCopyEvents() {
    document.addEventListener('copy', (event) => {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      
      // Check if it's PowerShell or terminal code (even if short)
      const isPowerShell = /powershell|iex|Invoke-Expression|Invoke-WebRequest/i.test(selectedText);
      const isTerminalCode = /\.ps1|\.bat|\.cmd|\.sh|curl|wget|bash/i.test(selectedText);
      
      // Lower threshold for PowerShell/terminal commands (common in clickfix)
      const minLength = (isPowerShell || isTerminalCode) ? 20 : 50;
      const minRiskScore = isPowerShell ? 40 : 60; // PowerShell is more suspicious
      
      if (selectedText && selectedText.length > minLength) {
        // Check if selected text looks like code
        const detection = detectClickfix(selectedText);
        if (detection && detection.riskScore >= minRiskScore) {
          // Log that suspicious code was copied (potential clickfix preparation)
          chrome.runtime.sendMessage({
            action: 'logClickfixDetection',
            url: window.location.href,
            source: 'copy_event',
            detection: {
              ...detection,
              note: `Suspicious ${detection.isPowerShell ? 'PowerShell' : 'code'} copied to clipboard - potential clickfix preparation`
            },
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            details: {
              selectedTextLength: selectedText.length,
              isPowerShell: isPowerShell,
              isTerminalCode: isTerminalCode
            }
          }).catch(err => console.error('Failed to send copy detection:', err));
        }
      }
    }, true);
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
    
    // Intercept navigator.clipboard.writeText() - more common for clickfix
    const originalWriteText = navigator.clipboard.writeText;
    if (originalWriteText) {
      navigator.clipboard.writeText = function(text) {
        const timeSinceUserAction = Date.now() - lastUserAction;
        const isProgrammatic = timeSinceUserAction > userActionWindow;
        
        // Always check if programmatic, or check if suspicious regardless
        if (isProgrammatic || text) {
          checkClipboardWrite(text, isProgrammatic, timeSinceUserAction);
        }
        
        // Call original writeText
        return originalWriteText.call(this, text);
      };
    }
    
    // Check clipboard write for clickfix patterns
    function checkClipboardWrite(text, isProgrammatic, timeSinceUserAction) {
      if (!text || typeof text !== 'string') {
        return;
      }
      
      const trimmedText = text.trim();
      
      // Skip very short text (likely not malicious)
      if (trimmedText.length < 20) {
        return;
      }
      
      // Skip if it's just a URL
      if (trimmedText.match(/^https?:\/\/[^\s]+$/)) {
        return;
      }
      
      // Detect if it's PowerShell or suspicious
      const detection = detectClickfix(trimmedText);
      
      // If programmatic write of suspicious content, always log
      // If user-initiated but very suspicious (high risk score), also log
      if (isProgrammatic && detection) {
        // Programmatic write of suspicious content = high risk clickfix
        detection.riskScore = Math.min(detection.riskScore + 30, 100); // Boost for programmatic
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
        
        // Log warning to console
        console.warn('🚨 CLICKFIX DETECTED: Website wrote suspicious content to clipboard!', {
          content: trimmedText.substring(0, 200),
          riskScore: detection.riskScore,
          isPowerShell: detection.isPowerShell
        });
        
      } else if (detection && detection.riskScore >= 70) {
        // Even if user-initiated, very high-risk content should be logged
        chrome.runtime.sendMessage({
          action: 'logClickfixDetection',
          url: window.location.href,
          source: 'clipboard_writeText_api',
          detection: {
            ...detection,
            note: 'High-risk code written to clipboard (may have been user-initiated)'
          },
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          details: {
            wasProgrammatic: false,
            clipboardContentLength: trimmedText.length
          }
        }).catch(err => console.error('Failed to send clipboard detection:', err));
      }
    }
  }
  
  // Start monitoring when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      monitorScriptLoading();
      monitorPasteEvents();
      monitorCopyEvents();
      monitorConsoleIndicators();
      monitorClipboardWrites(); // Most important for clickfix detection
    });
  } else {
    monitorScriptLoading();
    monitorPasteEvents();
    monitorCopyEvents();
    monitorConsoleIndicators();
    monitorClipboardWrites(); // Most important for clickfix detection
  }
  
  console.log('Network Logger content script loaded with clickfix detection');
})();
