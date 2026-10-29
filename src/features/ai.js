// EB Sessions: the AI writing help in e-mail and template editors. Setting: aiWriter.
//
// A foundation stub: it reads its switch and does nothing yet. The AI worker
// builds the feature in this file; shared files stay as they are.
// Model calls go through the service worker (src/bg/ai.js); CKEditor through
// EBS.bridge.call('ckeditor.*').

(() => {
  if (window.__ebsAiLoaded) return;
  window.__ebsAiLoaded = true;

  let enabled = false;
  EBS.watchSettings((settings) => {
    enabled = Boolean(settings.aiWriter);
  });
})();
