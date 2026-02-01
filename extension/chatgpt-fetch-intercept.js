// Runs in PAGE context (injected via script src). Overrides fetch to capture
// POST body to backend-api/files and postMessage to content script.
(function() {
  'use strict';
  var rawFetch = window.fetch;
  if (typeof rawFetch !== 'function') return;
  function tryCaptureBody(parsed, reqUrl) {
    if (parsed && (parsed.file_name !== undefined || parsed.use_case !== undefined)) {
      window.postMessage({ type: 'CHATGPT_FILE_UPLOAD_BODY', payload: parsed, url: reqUrl }, window.location.origin);
    }
  }
  window.fetch = function(url, opts) {
    var isRequest = url && typeof url.clone === 'function';
    var reqUrl = typeof url === 'string' ? url : (url && url.url) || '';
    var method = (opts && opts.method) || (url && url.method) || 'GET';
    if (method.toUpperCase() === 'POST' && reqUrl.indexOf('backend-api/files') !== -1 && reqUrl.indexOf('process_upload_stream') === -1) {
      try {
        if (isRequest && url.body) {
          url.clone().json().then(function(parsed) { tryCaptureBody(parsed, reqUrl); }).catch(function() {});
        } else {
          var body = opts && opts.body;
          if (body && typeof body === 'string') {
            try {
              tryCaptureBody(JSON.parse(body), reqUrl);
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
    return rawFetch.apply(this, arguments);
  };
})();
