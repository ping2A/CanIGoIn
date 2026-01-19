// YouTube-specific content script for channel blocking
// This script hides videos from blocked channels in feeds and search results

(function() {
  'use strict';
  
  let blockedChannels = [];
  let youtubeChannelBlocking = true;
  
  // Load blocked channels from storage
  function loadBlockedChannels() {
    chrome.storage.local.get(['blockedYouTubeChannels', 'youtubeChannelBlocking'], (result) => {
      if (result.blockedYouTubeChannels) {
        blockedChannels = result.blockedYouTubeChannels.map(ch => ch.toLowerCase().trim());
      }
      if (result.youtubeChannelBlocking !== undefined) {
        youtubeChannelBlocking = result.youtubeChannelBlocking;
      }
      
      // Process existing videos when settings are loaded
      if (youtubeChannelBlocking) {
        processVideos();
      }
    });
  }
  
  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.blockedYouTubeChannels) {
      blockedChannels = (changes.blockedYouTubeChannels.newValue || [])
        .map(ch => ch.toLowerCase().trim());
      processVideos();
    }
    if (changes.youtubeChannelBlocking) {
      youtubeChannelBlocking = changes.youtubeChannelBlocking.newValue;
      if (!youtubeChannelBlocking) {
        // Re-show all hidden videos
        document.querySelectorAll('[data-blocked-by-extension]').forEach(el => {
          el.removeAttribute('data-blocked-by-extension');
          el.style.display = '';
        });
      } else {
        processVideos();
      }
    }
  });
  
  // Check if a channel should be blocked
  function isChannelBlocked(channelUrl, channelName) {
    if (!youtubeChannelBlocking || blockedChannels.length === 0) {
      return false;
    }
    
    // Extract channel identifier from URL
    let channelId = null;
    if (channelUrl) {
      const channelMatch = channelUrl.match(/\/channel\/([^\/\?]+)/);
      const handleMatch = channelUrl.match(/\/@([^\/\?]+)/);
      const userMatch = channelUrl.match(/\/user\/([^\/\?]+)/);
      
      if (channelMatch) channelId = channelMatch[1];
      else if (handleMatch) channelId = '@' + handleMatch[1];
      else if (userMatch) channelId = userMatch[1];
    }
    
    // Check against blocked list
    return blockedChannels.some(blocked => {
      const normalizedBlocked = blocked.replace(/^@/, '');
      
      // Check channel ID
      if (channelId) {
        const normalizedId = channelId.toLowerCase().replace(/^@/, '');
        if (normalizedId === normalizedBlocked) return true;
      }
      
      // Check channel name
      if (channelName) {
        const normalizedName = channelName.toLowerCase().trim();
        if (normalizedName === normalizedBlocked) return true;
      }
      
      return false;
    });
  }
  
  // Process video elements and hide those from blocked channels
  function processVideos() {
    if (!youtubeChannelBlocking) return;
    
    // Find all video renderers (home feed, search results, etc.)
    const videoRenderers = document.querySelectorAll(
      'ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer'
    );
    
    videoRenderers.forEach(video => {
      // Skip if already processed
      if (video.hasAttribute('data-checked-by-extension')) return;
      video.setAttribute('data-checked-by-extension', 'true');
      
      // Find channel link
      const channelLink = video.querySelector('a.yt-simple-endpoint.style-scope.yt-formatted-string[href*="/@"], a.yt-simple-endpoint.style-scope.yt-formatted-string[href*="/channel/"], a.yt-simple-endpoint.style-scope.yt-formatted-string[href*="/user/"]');
      
      if (channelLink) {
        const channelUrl = channelLink.href;
        const channelName = channelLink.textContent.trim();
        
        if (isChannelBlocked(channelUrl, channelName)) {
          // Hide the video
          video.style.display = 'none';
          video.setAttribute('data-blocked-by-extension', 'true');
          
          console.log(`Blocked video from channel: ${channelName}`);
          
          // Optionally, you could replace with a message instead of hiding
          // createBlockedVideoMessage(video, channelName);
        }
      }
    });
    
    // Also check for channel pages themselves
    const channelHeader = document.querySelector('ytd-c4-tabbed-header-renderer, ytd-channel-tagline-renderer');
    if (channelHeader) {
      const channelUrl = window.location.href;
      const channelNameEl = document.querySelector('ytd-channel-name #text');
      const channelName = channelNameEl ? channelNameEl.textContent.trim() : '';
      
      if (isChannelBlocked(channelUrl, channelName)) {
        // We're on a blocked channel page, show a message
        showChannelBlockedMessage(channelName);
      }
    }
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
      <div style="font-weight: bold; margin-bottom: 5px;">This YouTube channel is blocked</div>
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
      <div style="font-weight: bold;">Video from blocked channel</div>
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
  
  // Start observing when page is ready
  function init() {
    loadBlockedChannels();
    
    // Observe the main content area for new videos
    const targetNode = document.querySelector('ytd-app');
    if (targetNode) {
      observer.observe(targetNode, {
        childList: true,
        subtree: true
      });
    }
    
    // Initial processing
    processVideos();
  }
  
  // Wait for YouTube to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  console.log('YouTube channel blocker content script loaded');
})();
