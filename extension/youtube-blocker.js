// YouTube-specific content script for channel whitelist
// Only channels in the whitelist are allowed; all others are hidden

(function() {
  'use strict';
  
  let whitelistedChannels = [];
  let youtubeChannelWhitelistEnabled = false;
  
  // Load whitelisted channels from storage
  function loadWhitelistedChannels() {
    chrome.storage.local.get(['whitelistedYouTubeChannels', 'youtubeChannelWhitelistEnabled'], (result) => {
      if (result.whitelistedYouTubeChannels) {
        whitelistedChannels = result.whitelistedYouTubeChannels.map(ch => ch.toLowerCase().trim()).filter(Boolean);
      }
      if (result.youtubeChannelWhitelistEnabled !== undefined) {
        youtubeChannelWhitelistEnabled = result.youtubeChannelWhitelistEnabled;
      }
      
      if (youtubeChannelWhitelistEnabled) {
        scheduleProcessing();
      }
    });
  }
  
  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.whitelistedYouTubeChannels) {
      whitelistedChannels = (changes.whitelistedYouTubeChannels.newValue || [])
        .map(ch => ch.toLowerCase().trim()).filter(Boolean);
      processVideos();
    }
    if (changes.youtubeChannelWhitelistEnabled !== undefined) {
      youtubeChannelWhitelistEnabled = changes.youtubeChannelWhitelistEnabled.newValue;
      if (!youtubeChannelWhitelistEnabled) {
        document.querySelectorAll('[data-blocked-by-extension]').forEach(el => {
          el.removeAttribute('data-blocked-by-extension');
          el.style.display = '';
        });
        removeWatchPageBlock();
      } else {
        scheduleProcessing();
      }
    }
  });
  
  // Returns true if the channel should be BLOCKED (hidden).
  // Whitelist logic: block if whitelist is enabled and channel is NOT in the whitelist.
  // If whitelist is enabled but empty, block everything (strict whitelist).
  function isChannelBlocked(channelUrl, channelName) {
    if (!youtubeChannelWhitelistEnabled) {
      return false; // Whitelist disabled = allow all
    }
    
    // Whitelist enabled: block if channel is NOT in the whitelist
    // If whitelist is empty, block everything (strict whitelist behavior)
    const isWhitelisted = whitelistedChannels.length > 0 && isChannelInWhitelist(channelUrl, channelName);
    return !isWhitelisted;
  }
  
  // Normalize for comparison: lowercase, strip @, collapse spaces (so "Pirate Software" matches "@PirateSoftware")
  function normalizeChannelKey(str) {
    if (!str || typeof str !== 'string') return '';
    return str.toLowerCase().replace(/^@/, '').replace(/\s+/g, '').trim();
  }
  
  function isChannelInWhitelist(channelUrl, channelName) {
    let channelId = null;
    if (channelUrl) {
      const channelMatch = channelUrl.match(/\/channel\/([^\/\?]+)/);
      const handleMatch = channelUrl.match(/\/@([^\/\?]+)/);
      const userMatch = channelUrl.match(/\/user\/([^\/\?]+)/);
      
      if (channelMatch) channelId = channelMatch[1];
      else if (handleMatch) channelId = '@' + handleMatch[1];
      else if (userMatch) channelId = userMatch[1];
    }
    
    const normalizedChannelId = channelId ? normalizeChannelKey(channelId) : '';
    const normalizedChannelName = normalizeChannelKey(channelName || '');
    
    return whitelistedChannels.some(allowed => {
      const normalizedAllowed = normalizeChannelKey(allowed);
      if (!normalizedAllowed) return false;
      if (normalizedChannelId && normalizedChannelId === normalizedAllowed) return true;
      if (normalizedChannelName && normalizedChannelName === normalizedAllowed) return true;
      return false;
    });
  }
  
  // Get channel info from current page URL (for channel pages like /@PirateSoftware/videos)
  function getChannelFromPageUrl() {
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    
    const handleMatch = pathname.match(/\/@([^\/]+)/);
    if (handleMatch) {
      const handle = '@' + handleMatch[1];
      return { channelUrl: origin + '/' + handle, channelHandle: handle };
    }
    
    const channelMatch = pathname.match(/\/channel\/([^\/]+)/);
    if (channelMatch) {
      const channelId = channelMatch[1];
      return { channelUrl: origin + '/channel/' + channelId, channelId: channelId };
    }
    
    const userMatch = pathname.match(/\/user\/([^\/]+)/);
    if (userMatch) {
      const username = userMatch[1];
      return { channelUrl: origin + '/user/' + username, channelUsername: username };
    }
    
    return null;
  }
  
  function isChannelPage() {
    const pathname = window.location.pathname;
    return /\/@[^\/]+\/(videos|shorts|streams|playlists|community|about)/.test(pathname) ||
           /\/channel\/[^\/]+\/(videos|shorts|streams|playlists|community|about)/.test(pathname) ||
           /\/user\/[^\/]+\/(videos|shorts|streams|playlists|community|about)/.test(pathname) ||
           /\/c\/[^\/]+\/(videos|shorts|streams|playlists|community|about)/.test(pathname);
  }
  
  // Process video elements: hide those not in the whitelist
  function processVideos() {
    if (!youtubeChannelWhitelistEnabled) return;
    
    if (!isWatchPage()) removeWatchPageBlock();
    
    // Get channel context from page URL if we're on a channel page
    const pageChannelInfo = isChannelPage() ? getChannelFromPageUrl() : null;
    
    const videoRenderers = document.querySelectorAll(
      'ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-rich-item-renderer'
    );
    
    videoRenderers.forEach(video => {
      // Re-check every time (clear so we re-evaluate when whitelist is enabled/changed)
      video.removeAttribute('data-checked-by-extension');
      video.removeAttribute('data-blocked-by-extension');
      video.style.display = '';
      
      // Find channel link – use broad selectors (YouTube DOM changes often)
      const channelLink = video.querySelector('a[href*="/channel/"], a[href*="/@"], a[href*="/user/"]');
      
      let channelUrl = '';
      let channelName = '';
      if (channelLink && channelLink.href) {
        channelUrl = channelLink.href;
        channelName = (channelLink.textContent || '').trim();
      } else if (pageChannelInfo) {
        // On a channel page: if video doesn't have explicit channel link, use page's channel
        channelUrl = pageChannelInfo.channelUrl || '';
        // Try to get channel name from page header, or use handle/ID as fallback
        const nameEl = document.querySelector('ytd-channel-name #text');
        channelName = (nameEl?.textContent?.trim() || pageChannelInfo.channelHandle || pageChannelInfo.channelId || pageChannelInfo.channelUsername || '');
      }
      
      // When whitelist is on: hide if channel is blocked, or if we can't determine channel (treat as not whitelisted)
      const shouldHide = isChannelBlocked(channelUrl, channelName);
      if (shouldHide) {
        video.style.display = 'none';
        video.setAttribute('data-blocked-by-extension', 'true');
        if (channelName) {
          console.log(`Hidden video (channel not in whitelist): ${channelName}`);
        }
      }
      video.setAttribute('data-checked-by-extension', 'true');
    });
    
      // Also check for channel pages themselves
    const channelHeader = document.querySelector('ytd-c4-tabbed-header-renderer, ytd-channel-tagline-renderer');
    if (channelHeader) {
      const channelUrl = window.location.href;
      const channelNameEl = document.querySelector('ytd-channel-name #text');
      const channelName = channelNameEl ? channelNameEl.textContent.trim() : '';
      
      if (isChannelBlocked(channelUrl, channelName)) {
        showChannelBlockedMessage(channelName);
      }
    }
    
    // On watch page: block the video if channel is not whitelisted (retry so we catch late-rendered owner)
    if (isWatchPage()) {
      processWatchPage();
      [200, 600, 1200].forEach(ms => setTimeout(() => { if (isWatchPage()) processWatchPage(); }, ms));
    }
  }
  
  function isWatchPage() {
    return /^\/watch(\?|$)/.test(window.location.pathname + (window.location.search || ''));
  }
  
  // On /watch page: get channel from owner area, hide player and show overlay if blocked
  function processWatchPage() {
    if (!youtubeChannelWhitelistEnabled) {
      removeWatchPageBlock();
      return;
    }
    
    const ownerRenderer = document.querySelector('ytd-video-owner-renderer');
    let channelUrl = '';
    let channelName = '';
    if (ownerRenderer) {
      const channelLink = ownerRenderer.querySelector('a[href*="/channel/"], a[href*="/@"], a[href*="/user/"]');
      if (channelLink && channelLink.href) {
        channelUrl = channelLink.href;
        channelName = (channelLink.textContent || '').trim();
      }
      if (!channelName) {
        const nameEl = ownerRenderer.querySelector('ytd-channel-name #text, yt-formatted-string#text');
        if (nameEl) channelName = nameEl.textContent.trim();
      }
    }
    
    if (isChannelBlocked(channelUrl, channelName)) {
      blockWatchPage(channelName || 'Unknown channel');
    } else {
      removeWatchPageBlock();
    }
  }
  
  function blockWatchPage(channelName) {
    if (document.getElementById('extension-watch-block-overlay')) return;
    
    // Pause video if present
    const video = document.querySelector('video.html5-main-video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    
    const overlay = document.createElement('div');
    overlay.id = 'extension-watch-block-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.92);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9998;
      font-family: Arial, sans-serif;
      color: #fff;
      text-align: center;
      padding: 20px;
      box-sizing: border-box;
    `;
    overlay.innerHTML = `
      <div style="max-width: 400px;">
        <div style="font-size: 64px; margin-bottom: 20px;">🚫</div>
        <div style="font-size: 22px; font-weight: bold; margin-bottom: 12px;">This channel is not in your whitelist</div>
        <div style="font-size: 16px; opacity: 0.9;">${escapeHtml(channelName)}</div>
        <div style="font-size: 14px; margin-top: 24px; opacity: 0.7;">You cannot watch this video.</div>
      </div>
    `;
    
    document.body.appendChild(overlay);
  }
  
  function removeWatchPageBlock() {
    const overlay = document.getElementById('extension-watch-block-overlay');
    if (overlay) overlay.remove();
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Show a message that the channel is blocked
  function showChannelBlockedMessage(channelName) {
    // Check if we already showed the message
    if (document.querySelector('#extension-channel-blocked-message')) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.id = 'extension-channel-blocked-message';
    messageDiv.style.cssText = `
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #dc3545;
      color: white;
      padding: 15px 30px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 9999;
      font-family: Arial, sans-serif;
      font-size: 16px;
      text-align: center;
      max-width: 600px;
    `;
    messageDiv.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 10px;">🚫</div>
      <div style="font-weight: bold; margin-bottom: 5px;">This channel is not in your whitelist</div>
      <div style="font-size: 14px; opacity: 0.9;">${channelName}</div>
    `;
    
    document.body.appendChild(messageDiv);
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      messageDiv.style.transition = 'opacity 0.5s';
      messageDiv.style.opacity = '0';
      setTimeout(() => messageDiv.remove(), 500);
    }, 5000);
  }
  
  // Alternative: Create a visual "blocked" placeholder for videos
  function createBlockedVideoMessage(videoElement, channelName) {
    const blockedDiv = document.createElement('div');
    blockedDiv.style.cssText = `
      padding: 20px;
      background: #f8d7da;
      border: 1px solid #f5c6cb;
      border-radius: 4px;
      color: #721c24;
      text-align: center;
      margin: 10px 0;
    `;
    blockedDiv.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 5px;">🚫</div>
      <div style="font-weight: bold;">Channel not in whitelist</div>
      <div style="font-size: 12px; margin-top: 5px;">${channelName}</div>
    `;
    
    videoElement.style.display = 'none';
    videoElement.parentNode.insertBefore(blockedDiv, videoElement);
  }
  
  // Observe DOM changes to catch dynamically loaded videos
  const observer = new MutationObserver((mutations) => {
    // Debounce processing
    clearTimeout(observer.timeout);
    observer.timeout = setTimeout(processVideos, 300);
  });
  
  // Run processVideos when whitelist is enabled, with retries to catch late-rendered content (YouTube SPA)
  function scheduleProcessing() {
    if (!youtubeChannelWhitelistEnabled) return;
    processVideos();
    const delays = [100, 500, 1000, 2000, 4000];
    delays.forEach((ms, i) => {
      setTimeout(() => {
        if (youtubeChannelWhitelistEnabled) processVideos();
      }, ms);
    });
  }

  // Start observing when page is ready
  function init() {
    loadWhitelistedChannels();
    
    // Observe a node that exists so we catch dynamically loaded videos (YouTube is a SPA)
    const targetNode = document.querySelector('ytd-app') || document.body;
    observer.observe(targetNode, {
      childList: true,
      subtree: true
    });
    
    // Do NOT run processVideos() here: state is not loaded yet. It runs from loadWhitelistedChannels() callback and from observer.
  }
  
  // Wait for YouTube to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  console.log('YouTube channel whitelist content script loaded');
})();
