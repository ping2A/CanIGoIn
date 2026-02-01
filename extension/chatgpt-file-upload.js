// Content script on chatgpt.com: capture fetch body for /backend-api/files to get file_name.
// Injects a script from extension URL (CSP-safe) that runs in page context and overrides fetch.
(function() {
  'use strict';

  var script = document.createElement('script');
  script.src = chrome.runtime.getURL('chatgpt-fetch-intercept.js');
  var root = document.documentElement || document.head;
  root.insertBefore(script, root.firstChild);
  script.onload = function() { script.remove(); };

  window.addEventListener('message', function(event) {
    if (event.source !== window || event.data?.type !== 'CHATGPT_FILE_UPLOAD_BODY') return;
    chrome.runtime.sendMessage({
      type: 'chatgpt_file_upload_body',
      file_name: event.data.payload?.file_name,
      payload: event.data.payload,
      url: event.data.url
    }).catch(() => {});
  });
})();
