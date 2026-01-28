// Runs in PAGE context (injected via script src). Overrides navigator.clipboard.writeText
// so we can detect when page JavaScript calls it; dispatches a custom DOM event with the text
// so the content script (isolated world) can receive it and run clickfix detection.
(function() {
  'use strict';
  var clip = navigator.clipboard;
  if (!clip || typeof clip.writeText !== 'function') return;
  var orig = clip.writeText.bind(clip);
  clip.writeText = function(text) {
    var result = orig(text);
    try {
      document.dispatchEvent(new CustomEvent('__extensionClipboardWriteText', { detail: { text: text } }));
    } catch (e) {}
    return result;
  };
})();
